import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

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

import { executionReport } from "./execution-contract";
import { createPiRoles, solveSettings, type SolveSettings } from "./pi-roles";
import {
  applicationId,
  coordinatorInput,
  coordinatorResultFor,
  explorerInput,
  explorerResult,
  roleCallOutput,
  roleFromLabel,
  roleNames,
  verifierCallOutput,
  verifierInput,
  type RoleName,
} from "./roles";
import {
  modelRegistryPath,
  requireCredentials,
  withCampaignLock,
} from "./runtime";
import { withSerialToolCalls } from "./serial-tools";
import { deriveWorkflow, workflowConfig, workflowResult } from "./workflow";

const callsConfig = z.strictObject({ kind: z.literal("calls") });
export type RoleCommand = RoleName;

export function isRoleCommand(value: string | undefined): value is RoleCommand {
  return roleNames.some((command) => command === value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function readSettings(path: string): Promise<SolveSettings> {
  return solveSettings.parse(await readJson(path));
}

function assertApplication(declaration: Entry | undefined): void {
  if (
    declaration?.kind !== "campaign" ||
    declaration.application !== applicationId
  ) {
    throw new Error("not a current Elenx solver journal");
  }
}

function openCalls(path: string): Campaign {
  if (!existsSync(path)) {
    return createCampaign(path, applicationId, { kind: "calls" });
  }
  const campaign = openCampaign(path);
  try {
    const declaration = campaign.records()[0];
    assertApplication(declaration);
    callsConfig.parse(
      declaration?.kind === "campaign" ? declaration.config : undefined,
    );
    return campaign;
  } catch (error) {
    campaign.close();
    throw error;
  }
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

export function inspectCampaign(
  path: string,
  options: { readonly includeInputs?: boolean } = {},
): Json {
  const reader = openReader(path);
  try {
    const records = reader.records();
    assertApplication(records[0]);
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
    const snapshot = config.success ? deriveWorkflow(reader) : undefined;
    const phase = snapshot?.phase;
    const terminal =
      phase?.kind === "accepted" ||
      phase?.kind === "refuted" ||
      phase?.kind === "turn-limit"
        ? executionReport(workflowResult(phase))
        : undefined;
    return JSON.parse(
      JSON.stringify({
        ...(snapshot === undefined
          ? {}
          : {
              task: snapshot.config.task,
              state: phase?.kind,
              notes: snapshot.notes,
              ...(terminal === undefined ? {} : { result: terminal }),
            }),
        calls,
        spend: derivePiSpend(records).summary,
      }),
    ) as Json;
  } finally {
    reader.close();
  }
}

export function exportCandidate(path: string): Uint8Array {
  const reader = openReader(path);
  try {
    assertApplication(reader.records()[0]);
    const phase = deriveWorkflow(reader).phase;
    if (phase.kind !== "accepted" && phase.kind !== "refuted") {
      throw new Error("workflow has no accepted candidate");
    }
    return reader.material(phase.candidate);
  } finally {
    reader.close();
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
  const settings = await readSettings(settingsPath);
  const input = await readJson(inputPath);
  if (command === "explorer") explorerInput.parse(input);
  else if (command === "coordinator") coordinatorInput.parse(input);
  else verifierInput.parse(input);
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create({
    modelsPath: modelRegistryPath(process.env),
  });
  await requireCredentials(runtime, [settings[command].provider]);
  const models = withSerialToolCalls(runtime);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    return await withCampaignLock(campaignPath, async () => {
      const campaign = openCalls(campaignPath);
      try {
        const roles = createPiRoles(campaign, settings, {
          models,
          signal: controller.signal,
        });
        return jsonSnapshot(await roles[command](input as never));
      } finally {
        campaign.close();
      }
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
