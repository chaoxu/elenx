#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";

import { executionContract, executionReport } from "./execution-contract";
import {
  exportRoleAnswer,
  inspectRoleCampaign,
  isRoleCommand,
  readRoleSettings,
  runRoleCommand,
} from "./role-cli";
import {
  resume,
  settings,
  start,
  type RunDependencies,
  type Settings,
} from "./runner";
import { withSerialToolCalls } from "./serial-tools";

export type { SolveModels } from "./runtime";
export { executionContract, resume, settings, start };
export type { ExecutionContract, ExecutionReport } from "./execution-contract";
export type { RunDependencies, Settings } from "./runner";

const usage = `Usage:
  elenx-solve contract
  elenx-solve run PROBLEM.md CRITERIA.md CAMPAIGN.db SETTINGS.json
  elenx-solve start PROBLEM.md CRITERIA.md CAMPAIGN.db SETTINGS.json
  elenx-solve resume CAMPAIGN.db SETTINGS.json
  elenx-solve explorer INPUT.json CAMPAIGN.db SETTINGS.json
  elenx-solve coordinator INPUT.json CAMPAIGN.db SETTINGS.json
  elenx-solve verifier INPUT.json CAMPAIGN.db SETTINGS.json
  elenx-solve trial TRIAL.json CAMPAIGN.db SETTINGS.json
  elenx-solve inspect [--include-inputs] CAMPAIGN.db
  elenx-solve export CAMPAIGN.db

Explorer, coordinator, and verifier are exact journaled input-output calls.
The coordinator files findings and chooses exploration or verification. The
verifier runs private auditors and exposes only ACCEPT or REJECT. Run, resume,
and trial use the same durable workflow.`;

export function modelRuntimeOptions(environment: NodeJS.ProcessEnv): {
  readonly modelsPath: string | null;
} {
  const modelsPath = environment["ELENX_MODELS_PATH"];
  if (modelsPath === undefined) return { modelsPath: null };
  if (!isAbsolute(modelsPath)) {
    throw new Error("ELENX_MODELS_PATH must be absolute");
  }
  return { modelsPath };
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

async function main(args: readonly string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      "include-inputs": { type: "boolean" },
    },
  });
  if (parsed.values.help) {
    console.log(usage);
    return;
  }
  const [command, ...positionals] = parsed.positionals;
  if (isRoleCommand(command)) {
    if (parsed.values["include-inputs"] === true) throw new Error(usage);
    writeJson(await runRoleCommand(command, positionals));
    return;
  }
  if (command === "contract") {
    if (positionals.length !== 0 || parsed.values["include-inputs"] === true) {
      throw new Error(usage);
    }
    writeJson(executionContract);
    return;
  }
  if (command === "inspect") {
    if (positionals.length !== 1) throw new Error(usage);
    writeJson(
      inspectRoleCampaign(positionals[0]!, {
        includeInputs: parsed.values["include-inputs"] === true,
      }),
    );
    return;
  }
  if (command === "export") {
    if (positionals.length !== 1 || parsed.values["include-inputs"] === true) {
      throw new Error(usage);
    }
    process.stdout.write(exportRoleAnswer(positionals[0]!));
    return;
  }
  if (
    (command !== "run" && command !== "start" && command !== "resume") ||
    positionals.length !== (command === "resume" ? 2 : 4) ||
    parsed.values["include-inputs"] === true
  ) {
    throw new Error(usage);
  }
  const roleSettings = await readRoleSettings(positionals.at(-1)!);
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create(modelRuntimeOptions(process.env));
  await requireCredentials(runtime, [
    roleSettings.explorer.provider,
    roleSettings.coordinator.provider,
    roleSettings.verifier.provider,
  ]);
  const controller = new AbortController();
  let pauseRequested = false;
  const stop = () => {
    if (!pauseRequested) {
      pauseRequested = true;
      console.error("Pausing after the active role call settles...");
    } else {
      controller.abort();
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const dependencies: RunDependencies = {
      models: withSerialToolCalls(runtime),
      signal: controller.signal,
      pauseRequested: () => pauseRequested,
      status: (phase) => console.error(phase),
    };
    const report =
      command === "resume"
        ? await resume(
            { campaignPath: positionals[0]!, settings: roleSettings },
            dependencies,
          )
        : await startOrResume(command, positionals, roleSettings, dependencies);
    writeJson(executionReport(report));
    if (report.outcome === "interrupted") process.exitCode = 130;
    if (report.outcome === "call-failure") process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function startOrResume(
  command: "run" | "start",
  positionals: readonly string[],
  roleSettings: Settings,
  dependencies: RunDependencies,
) {
  const [problemPath, criteriaPath, campaignPath] = positionals as readonly [
    string,
    string,
    string,
    string,
  ];
  const [problem, completionCriteria] = await Promise.all([
    readFile(problemPath, "utf8"),
    readFile(criteriaPath, "utf8"),
  ]);
  if (command === "run" && existsSync(campaignPath)) {
    const inspection = inspectRoleCampaign(campaignPath) as {
      readonly problem?: unknown;
      readonly completionCriteria?: unknown;
    };
    if (
      inspection.problem !== problem ||
      inspection.completionCriteria !== completionCriteria
    ) {
      throw new Error("problem or criteria disagree with the workflow journal");
    }
    return resume({ campaignPath, settings: roleSettings }, dependencies);
  }
  return start(
    { problem, completionCriteria, campaignPath, settings: roleSettings },
    dependencies,
  );
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
