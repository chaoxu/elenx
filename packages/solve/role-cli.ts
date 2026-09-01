import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  createCampaign,
  openCampaign,
  openReader,
  returnedToolSubmission,
  type Campaign,
  type Entry,
  type Json,
} from "elenx";
import { derivePiSpend, piStoredResult } from "elenx/pi";

import {
  createPiRoles,
  piRoleSettings,
  verifierResultFromSubmission,
  type PiRoleSettings,
} from "./pi-roles";
import { runTrial } from "./roles";
import { withSerialToolCalls } from "./serial-tools";

const application = "elenx-solve-roles";
const protocol = "role-calls.v1";
const roleTools = {
  explorer: "submit_findings",
  coordinator: "submit_coordination",
  verifier: "submit_verification",
} as const;
type RoleName = keyof typeof roleTools;

const roleCommands = ["explorer", "coordinator", "verifier", "trial"] as const;
export type RoleCommand = (typeof roleCommands)[number];

export function isRoleCommand(value: string | undefined): value is RoleCommand {
  return roleCommands.some((command) => command === value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readSettings(path: string): Promise<PiRoleSettings> {
  return piRoleSettings.parse(await readJson(path));
}

function openRoleCampaign(path: string): Campaign {
  if (!existsSync(path)) {
    return createCampaign(path, application, { protocol });
  }
  const campaign = openCampaign(path);
  try {
    assertRoleDeclaration(campaign.records()[0]);
  } catch (error) {
    campaign.close();
    throw error;
  }
  return campaign;
}

function validateExistingRoleCampaign(path: string): void {
  if (!existsSync(path)) return;
  const campaign = openCampaign(path);
  try {
    assertRoleDeclaration(campaign.records()[0]);
  } finally {
    campaign.close();
  }
}

function declarationProtocol(declaration: Entry | undefined): unknown {
  if (
    declaration?.kind !== "campaign" ||
    declaration.config === null ||
    typeof declaration.config !== "object" ||
    Array.isArray(declaration.config)
  ) {
    return undefined;
  }
  return (declaration.config as { readonly [key: string]: Json })["protocol"];
}

function isRoleDeclaration(declaration: Entry | undefined): boolean {
  if (declaration?.kind !== "campaign") return false;
  return (
    declaration.application === application &&
    declarationProtocol(declaration) === protocol
  );
}

function assertRoleDeclaration(declaration: Entry | undefined): void {
  if (!isRoleDeclaration(declaration)) {
    throw new Error("not an Elenx role journal");
  }
}

export function isRoleCampaign(path: string): boolean {
  const reader = openReader(path);
  try {
    return isRoleDeclaration(reader.records()[0]);
  } finally {
    reader.close();
  }
}

export function inspectRoleCampaign(
  path: string,
  options: { readonly includeInputs?: boolean } = {},
): Json {
  const reader = openReader(path);
  try {
    const records = reader.records();
    assertRoleDeclaration(records[0]);
    const results = new Map(
      records
        .filter((entry) => entry.kind === "call-result")
        .map((entry) => [entry.parent, entry]),
    );
    const calls = records
      .filter(
        (entry): entry is Extract<Entry, { kind: "call" }> =>
          entry.kind === "call" && roleFromLabel(entry.label) !== undefined,
      )
      .map((entry) => {
        const role = roleFromLabel(entry.label)!;
        const result = results.get(entry.seq);
        const parsed =
          result?.kind === "call-result" && result.state === "returned"
            ? piStoredResult.safeParse(result.output)
            : undefined;
        const visibleResult =
          entry.role === role &&
          result?.kind === "call-result" &&
          result.state === "returned" &&
          parsed?.success === true &&
          parsed.data.state === "succeeded"
            ? settledRoleResult(records, entry.seq, role)
            : undefined;
        return {
          call: entry.seq,
          role,
          label: entry.label,
          startedAtMs: entry.atMs,
          ...(result === undefined
            ? {}
            : {
                settledAtMs: result.atMs,
                elapsedMs: result.atMs - entry.atMs,
                settlement: result.state,
              }),
          ...(visibleResult === undefined ? {} : { result: visibleResult }),
          ...(parsed?.success === true
            ? { piState: parsed.data.state, telemetry: parsed.data.telemetry }
            : {}),
          ...(options.includeInputs === true
            ? { request: entry.request, declaredTools: entry.tools }
            : {}),
        };
      });
    const unsettledCalls = calls
      .filter(({ settlement }) => settlement === undefined)
      .map(({ call }) => call);
    return JSON.parse(
      JSON.stringify({
        calls,
        ...(unsettledCalls.length === 0 ? {} : { unsettledCalls }),
        spend: derivePiSpend(records).summary,
      }),
    ) as Json;
  } finally {
    reader.close();
  }
}

function roleFromLabel(label: string): RoleName | undefined {
  if (label === "elenx-solve/role/explorer") return "explorer";
  if (label === "elenx-solve/role/coordinator") return "coordinator";
  if (label === "elenx-solve/role/verifier") return "verifier";
  return undefined;
}

function settledRoleResult(
  records: readonly Entry[],
  call: number,
  role: RoleName,
): Json | undefined {
  try {
    const input = returnedToolSubmission(records, call, roleTools[role]).input;
    return role === "verifier" ? verifierResultFromSubmission(input) : input;
  } catch {
    return undefined;
  }
}

function modelsPath(environment: NodeJS.ProcessEnv): string | null {
  const value = environment["ELENX_MODELS_PATH"];
  if (value === undefined) return null;
  if (!isAbsolute(value)) {
    throw new Error("ELENX_MODELS_PATH must be absolute");
  }
  return value;
}

async function requireCredentials(
  runtime: { readonly checkAuth: (provider: string) => Promise<unknown> },
  providers: readonly string[],
): Promise<void> {
  const missing = (
    await Promise.all(
      [...new Set(providers)].map(async (provider) =>
        (await runtime.checkAuth(provider)) === undefined ? [provider] : [],
      ),
    )
  ).flat();
  if (missing.length > 0) {
    throw new Error(`No credential for provider(s): ${missing.join(", ")}`);
  }
}

export async function runRoleCommand(
  command: RoleCommand,
  positionals: readonly string[],
): Promise<Json> {
  if (positionals.length !== 3) {
    throw new Error(`${command} requires INPUT.json CAMPAIGN.db SETTINGS.json`);
  }
  const [inputPath, campaignPath, settingsPath] = positionals as readonly [
    string,
    string,
    string,
  ];
  if (command === "trial" && existsSync(campaignPath)) {
    throw new Error(
      "trial requires a new campaign database because trial state is not resumable",
    );
  }
  validateExistingRoleCampaign(campaignPath);
  const settings = await readSettings(settingsPath);
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create({
    modelsPath: modelsPath(process.env),
  });
  await requireCredentials(
    runtime,
    command === "trial"
      ? [
          settings.explorer.provider,
          settings.coordinator.provider,
          settings.verifier.provider,
        ]
      : [settings[command].provider],
  );
  const models = withSerialToolCalls(runtime);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const campaign = openRoleCampaign(campaignPath);
  try {
    const dependencies = { models, signal: controller.signal };
    const roles = createPiRoles(campaign, settings, dependencies);
    const input = await readJson(inputPath);
    if (command === "explorer") {
      return toJson(await roles.explorer(input));
    }
    if (command === "coordinator") {
      return toJson(await roles.coordinator(input));
    }
    if (command === "verifier") {
      return toJson(await roles.verifier(input));
    }
    return toJson(await runTrial(input, roles));
  } finally {
    campaign.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}
