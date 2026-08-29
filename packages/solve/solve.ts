#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";

import { resume, settings, start, type Settings } from "./exploration";
import { executionContract, executionReport } from "./execution-contract";
import {
  exportAnswer,
  inspectCampaign,
  type CampaignInspection,
} from "./inspect";
import { withSerialToolCalls } from "./serial-tools";

export type { SolveDependencies, SolveModels } from "./runtime";
export { resume, settings, start } from "./exploration";
export type { Report, Settings } from "./exploration";
export { executionContract } from "./execution-contract";
export type { ExecutionContract, ExecutionReport } from "./execution-contract";

const usage = `Usage:
  elenx-solve contract
  elenx-solve run PROBLEM.md CRITERIA.md CAMPAIGN.db SETTINGS.json
  elenx-solve start PROBLEM.md CRITERIA.md CAMPAIGN.db SETTINGS.json
  elenx-solve resume CAMPAIGN.db SETTINGS.json
  elenx-solve inspect [--include-inputs] CAMPAIGN.db
  elenx-solve export CAMPAIGN.db

Run a serial exploration-v17 campaign. Fresh explorers report findings; a
curator files every finding and serves each turn's working set; one
verification subsystem audits notes as they enter and decides completion at a
declared goal note. Pause and resume are safe. Inspect prints state and
accounting. Export writes the verified goal note and its ancestor closure.

run starts the campaign, or resumes it when CAMPAIGN.db already exists, so a
killed process restarts with the identical invocation. The campaign runner retries
transient call failures in place with capped exponential backoff; a run report
with outcome call-failure means that retry budget was exhausted by consecutive
failures.`;

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
      inspectCampaign(positionals[0]!, {
        includeInputs: parsed.values["include-inputs"] === true,
      }),
    );
    return;
  }
  if (command === "export") {
    if (positionals.length !== 1 || parsed.values["include-inputs"] === true) {
      throw new Error(usage);
    }
    process.stdout.write(exportAnswer(positionals[0]!));
    return;
  }
  if (
    (command !== "run" && command !== "start" && command !== "resume") ||
    positionals.length !== (command === "resume" ? 2 : 4) ||
    parsed.values["include-inputs"] === true
  ) {
    throw new Error(usage);
  }
  const settings = await readSettingsFile(positionals.at(-1)!);
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create(modelRuntimeOptions(process.env));
  await requireCredentials(runtime, providers(settings));
  const models = withSerialToolCalls(runtime);
  const controller = new AbortController();
  let pauseRequested = false;
  const stop = () => {
    if (!pauseRequested) {
      pauseRequested = true;
      console.error("Pausing after the active turn settles...");
      return;
    }
    if (!controller.signal.aborted) {
      console.error("Aborting the active provider operation...");
      controller.abort();
      return;
    }
    process.exit(130);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const dependencies = {
      models,
      signal: controller.signal,
      pauseRequested: () => pauseRequested,
      status: (message: string) => console.error(message),
    };
    const startOnce = async () =>
      start(
        {
          problem: await readFile(positionals[0]!, "utf8"),
          completionCriteria: await readFile(positionals[1]!, "utf8"),
          campaignPath: positionals[2]!,
          settings,
        },
        dependencies,
      );
    const resumeOnce = (campaignPath: string) =>
      resume({ campaignPath, settings }, dependencies);
    const report =
      command === "run"
        ? existsSync(positionals[2]!)
          ? await resumeExisting(positionals, settings, dependencies)
          : await startOnce()
        : command === "start"
          ? await startOnce()
          : await resumeOnce(positionals[0]!);
    writeJson(executionReport(report));
    if (report.outcome === "interrupted") process.exitCode = 130;
    if (report.outcome === "call-failure") process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

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

// run resumes with the same file arguments it started with; a problem or
// criteria file that no longer matches the frozen campaign inputs must
// fail-stop, exactly as disagreeing settings do, instead of silently
// continuing with the frozen text.
async function resumeExisting(
  positionals: readonly string[],
  settings: Settings,
  dependencies: Parameters<typeof resume>[1],
) {
  const campaignPath = positionals[2]!;
  let frozen: CampaignInspection;
  try {
    frozen = inspectCampaign(campaignPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`existing campaign cannot be resumed: ${reason}`);
  }
  const problem = await readFile(positionals[0]!, "utf8");
  const completionCriteria = await readFile(positionals[1]!, "utf8");
  if (
    problem !== frozen.problem ||
    completionCriteria !== frozen.completionCriteria
  ) {
    throw new Error(
      "problem or criteria file disagrees with the frozen campaign inputs",
    );
  }
  return resume({ campaignPath, settings }, dependencies);
}

async function readSettingsFile(path: string): Promise<Settings> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return settings.parse(value);
}

function providers(settings: Settings): readonly string[] {
  return [
    settings.explorer.provider,
    settings.curator.provider,
    settings.triage.provider,
    settings.verifier.provider,
  ];
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

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
