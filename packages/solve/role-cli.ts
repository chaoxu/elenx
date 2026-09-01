import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  createCampaign,
  openCampaign,
  openReader,
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
import {
  coordinatorInput,
  explorerInput,
  runTrial,
  verifierInput,
  verifierResult,
} from "./roles";
import { withSerialToolCalls } from "./serial-tools";

const application = "elenx-solve-roles";
const protocol = "role-calls.v1";

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
        (entry) =>
          entry.kind === "call" && entry.label.startsWith("elenx-solve/role/"),
      )
      .map((entry) => {
        if (entry.kind !== "call") throw new Error("lost call narrowing");
        const result = results.get(entry.seq);
        const terminal = records.find(
          (candidate) =>
            candidate.kind === "tool-call" && candidate.call === entry.seq,
        );
        const parsed =
          result?.kind === "call-result" && result.state === "returned"
            ? piStoredResult.safeParse(result.output)
            : undefined;
        return {
          call: entry.seq,
          role: entry.role,
          label: `elenx-solve/role/${entry.role ?? "unknown"}`,
          startedAtMs: entry.atMs,
          ...(result === undefined
            ? {}
            : {
                settledAtMs: result.atMs,
                elapsedMs: result.atMs - entry.atMs,
                settlement: result.state,
              }),
          ...(terminal?.kind === "tool-call"
            ? { result: publicRoleResult(entry.role, terminal.input) }
            : {}),
          ...(parsed?.success === true
            ? { piState: parsed.data.state, telemetry: parsed.data.telemetry }
            : {}),
          ...(options.includeInputs === true
            ? { request: entry.request, declaredTools: entry.tools }
            : {}),
        };
      });
    return JSON.parse(
      JSON.stringify({ calls, spend: derivePiSpend(records).summary }),
    ) as Json;
  } finally {
    reader.close();
  }
}

function publicRoleResult(role: string | undefined, value: Json): Json {
  if (role !== "verifier") return value;
  const existing = verifierResult.safeParse(value);
  if (existing.success) return existing.data;
  const internal = isJsonObject(value) ? { audits: value["audits"] } : value;
  return verifierResultFromSubmission(internal);
}

function isJsonObject(value: Json): value is { readonly [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
      return toJson(await roles.explorer(explorerInput.parse(input)));
    }
    if (command === "coordinator") {
      return toJson(await roles.coordinator(coordinatorInput.parse(input)));
    }
    if (command === "verifier") {
      return toJson(await roles.verifier(verifierInput.parse(input)));
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
