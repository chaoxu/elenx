import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  createCampaign,
  openCampaign,
  openReader,
  type Campaign,
  type Entry,
  type Json,
} from "elenx";
import { derivePiSpend } from "elenx/pi";
import { z } from "zod";

import { verifierCallOutput } from "./auditors";
import { trialExecutionReport } from "./execution-contract";
import { createPiRoles, piRoleSettings, type PiRoleSettings } from "./pi-roles";
import {
  coordinatorInput,
  coordinatorResultFor,
  explorerInput,
  explorerResult,
  roleApplication,
  roleCallOutput,
  roleProtocol,
  task,
  verifierInput,
} from "./roles";
import { withSerialToolCalls } from "./serial-tools";
import { withCampaignLock } from "./runtime";
import {
  deriveWorkflow,
  runWorkflow,
  workflowConfig,
  workflowConfiguration,
} from "./workflow";

type RoleName = "explorer" | "coordinator" | "verifier";
const roleCommands = ["explorer", "coordinator", "verifier", "trial"] as const;
export type RoleCommand = (typeof roleCommands)[number];

const nonblank = z.string().refine((value) => value.trim().length > 0);
const positiveInteger = z.number().int().positive();

export function isRoleCommand(value: string | undefined): value is RoleCommand {
  return roleCommands.some((command) => command === value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function readRoleSettings(path: string): Promise<PiRoleSettings> {
  return piRoleSettings.parse(await readJson(path));
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

function assertRoleDeclaration(declaration: Entry | undefined): void {
  if (
    declaration?.kind !== "campaign" ||
    declaration.application !== roleApplication ||
    declarationProtocol(declaration) !== roleProtocol
  ) {
    throw new Error("not a current Elenx role journal");
  }
}

export function openRoleCampaign(path: string, config?: Json): Campaign {
  if (!existsSync(path)) {
    return createCampaign(
      path,
      roleApplication,
      config ?? { protocol: roleProtocol },
    );
  }
  const campaign = openCampaign(path);
  try {
    const declaration = campaign.records()[0];
    assertRoleDeclaration(declaration);
    if (
      declaration?.kind !== "campaign" ||
      (config !== undefined && !isDeepStrictEqual(declaration.config, config))
    ) {
      throw new Error("campaign inputs or settings disagree with the journal");
    }
    return campaign;
  } catch (error) {
    campaign.close();
    throw error;
  }
}

export function isRoleCampaign(path: string): boolean {
  const reader = openReader(path);
  try {
    const declaration = reader.records()[0];
    return (
      declaration?.kind === "campaign" &&
      declaration.application === roleApplication &&
      declarationProtocol(declaration) === roleProtocol
    );
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

function visibleResult(
  call: Extract<Entry, { readonly kind: "call" }>,
  result: Extract<Entry, { readonly kind: "call-result" }> | undefined,
  role: RoleName,
): Json | undefined {
  if (result?.state !== "returned") return undefined;
  try {
    if (role === "explorer") {
      return roleCallOutput(explorerResult).parse(result.output).value;
    }
    if (role === "coordinator") {
      const input = coordinatorInput.parse(call.request);
      return roleCallOutput(
        coordinatorResultFor(
          input.notes.map(({ id }) => id),
          input.findings.length,
        ),
      ).parse(result.output).value;
    }
    return verifierCallOutput.parse(result.output).value;
  } catch {
    return undefined;
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
        (entry): entry is Extract<Entry, { readonly kind: "call" }> =>
          entry.kind === "call" && roleFromLabel(entry.label) !== undefined,
      )
      .map((entry) => {
        const role = roleFromLabel(entry.label)!;
        const result = results.get(entry.seq);
        const visible =
          entry.role === role ? visibleResult(entry, result, role) : undefined;
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
          ...(visible === undefined ? {} : { result: visible }),
          ...(options.includeInputs === true ? { input: entry.request } : {}),
        };
      });
    const declaration = records[0];
    const config = workflowConfig.safeParse(
      declaration?.kind === "campaign" ? declaration.config : undefined,
    );
    const workflow = config.success ? deriveWorkflow(reader) : undefined;
    const phase = workflow?.phase;
    return JSON.parse(
      JSON.stringify({
        ...(workflow === undefined
          ? {}
          : {
              problem: workflow.config.task.problem,
              completionCriteria: workflow.config.task.completionCriteria,
              objective: workflow.config.objective,
              maxExplorerTurns: workflow.config.maxExplorerTurns,
              phase: phase?.kind,
              notes: workflow.notes,
              ...(phase?.kind === "accepted" || phase?.kind === "refuted"
                ? {
                    outcome: phase.outcome,
                    turns: phase.turns,
                    candidate: phase.candidate,
                    candidateKind:
                      phase.kind === "accepted" ? "solution" : "refutation",
                    ...(phase.kind === "accepted"
                      ? { answer: phase.answer }
                      : { refutation: phase.refutation }),
                    verifier: phase.verifier,
                  }
                : phase?.kind === "turn-limit"
                  ? {
                      outcome: phase.outcome,
                      turns: phase.turns,
                      ...(phase.lastVerifierResult === undefined
                        ? {}
                        : { lastVerifierResult: phase.lastVerifierResult }),
                    }
                  : {}),
            }),
        calls,
        spend: derivePiSpend(records).summary,
      }),
    ) as Json;
  } finally {
    reader.close();
  }
}

export function exportRoleAnswer(path: string): Uint8Array {
  const reader = openReader(path);
  try {
    assertRoleDeclaration(reader.records()[0]);
    const phase = deriveWorkflow(reader).phase;
    if (phase.kind !== "accepted" && phase.kind !== "refuted") {
      throw new Error("campaign has no accepted answer");
    }
    return reader.material(phase.candidate);
  } finally {
    reader.close();
  }
}

function modelsPath(environment: NodeJS.ProcessEnv): string | null {
  const value = environment["ELENX_MODELS_PATH"];
  if (value === undefined) return null;
  if (!isAbsolute(value)) throw new Error("ELENX_MODELS_PATH must be absolute");
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

function jsonSnapshot(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
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
  const settings = await readRoleSettings(settingsPath);
  const input = await readJson(inputPath);
  if (command === "explorer") explorerInput.parse(input);
  else if (command === "coordinator") coordinatorInput.parse(input);
  else if (command === "verifier") verifierInput.parse(input);
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
  try {
    return await withCampaignLock(campaignPath, async () => {
      const campaign =
        command === "trial"
          ? openRoleCampaign(
              campaignPath,
              jsonSnapshot(
                workflowConfiguration({
                  ...z
                    .strictObject({
                      task,
                      objective: nonblank,
                      maxExplorerTurns: positiveInteger.default(
                        settings.maxExplorerTurns,
                      ),
                    })
                    .parse(input),
                  settings,
                }),
              ),
            )
          : openRoleCampaign(campaignPath);
      try {
        const roles = createPiRoles(campaign, settings, {
          models,
          signal: controller.signal,
        });
        if (command === "trial") {
          const phase = await runWorkflow(campaign, roles);
          if (
            phase.kind !== "accepted" &&
            phase.kind !== "refuted" &&
            phase.kind !== "turn-limit"
          ) {
            throw new Error("trial interrupted before a terminal result");
          }
          return jsonSnapshot(
            trialExecutionReport(
              phase,
              "candidate" in phase ? phase.candidate : undefined,
            ),
          );
        }
        if (command === "explorer")
          return jsonSnapshot(await roles.explorer(input));
        if (command === "coordinator")
          return jsonSnapshot(await roles.coordinator(input));
        return jsonSnapshot(await roles.verifier(input));
      } finally {
        campaign.close();
      }
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
