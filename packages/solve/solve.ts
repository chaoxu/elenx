#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { executionContract, executionReport } from "./execution-contract";
import {
  exportCandidate,
  guideCampaign,
  inspectCampaign,
  isRoleCommand,
  readSettings,
  runRoleCommand,
} from "./role-cli";
import { run, settings, type RunDependencies, type Settings } from "./runner";
import { task } from "./roles";
import {
  createModelRuntime,
  modelRegistryPath,
  type SolveModels,
} from "./runtime";
import { withSerialToolCalls } from "./serial-tools";

export { executionContract, guideCampaign, run, settings };
export type { ExecutionContract, ExecutionReport } from "./execution-contract";
export type { RunDependencies, Settings, SolveModels };

const usage = `Usage:
  elenx-solve contract
  elenx-solve run TASK.json CAMPAIGN.db SETTINGS.json
  elenx-solve explorer INPUT.json CAMPAIGN.db SETTINGS.json
  elenx-solve coordinator INPUT.json CAMPAIGN.db SETTINGS.json
  elenx-solve verifier INPUT.json CAMPAIGN.db SETTINGS.json
  elenx-solve guide [--id ID] CAMPAIGN.db GUIDANCE.txt
  elenx-solve inspect [--include-requests] [--include-guidance] CAMPAIGN.db
  elenx-solve export CAMPAIGN.db

run starts or resumes the durable explorer, coordinator, and verifier workflow.
guide appends explorer guidance from a UTF-8 file (or - for stdin).
Guidance takes effect at the next unfrozen explorer turn. Reuse --id for retries.
Standalone role commands execute the same role boundaries independently.`;

export function modelRuntimeOptions(environment: NodeJS.ProcessEnv): {
  readonly modelsPath: string | null;
} {
  return { modelsPath: modelRegistryPath(environment) };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function main(args: readonly string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      "include-requests": { type: "boolean" },
      "include-guidance": { type: "boolean" },
      id: { type: "string" },
    },
  });
  if (parsed.values.help) {
    console.log(usage);
    return;
  }
  const [command, ...positionals] = parsed.positionals;
  if (parsed.values["include-guidance"] === true && command !== "inspect")
    throw new Error(usage);
  if (parsed.values.id !== undefined && command !== "guide")
    throw new Error(usage);
  if (command === "guide") {
    if (positionals.length !== 2 || parsed.values["include-requests"] === true)
      throw new Error(usage);
    const text =
      positionals[1] === "-"
        ? await Bun.stdin.text()
        : await readFile(positionals[1]!, "utf8");
    writeJson(await guideCampaign(positionals[0]!, text, parsed.values.id));
    return;
  }
  if (isRoleCommand(command)) {
    if (parsed.values["include-requests"] === true) throw new Error(usage);
    writeJson(await runRoleCommand(command, positionals));
    return;
  }
  if (command === "contract") {
    if (
      positionals.length !== 0 ||
      parsed.values["include-requests"] === true
    ) {
      throw new Error(usage);
    }
    writeJson(executionContract);
    return;
  }
  if (command === "inspect") {
    if (positionals.length !== 1) throw new Error(usage);
    writeJson(
      await inspectCampaign(positionals[0]!, {
        includeRequests: parsed.values["include-requests"] === true,
        includeGuidance: parsed.values["include-guidance"] === true,
      }),
    );
    return;
  }
  if (command === "export") {
    if (
      positionals.length !== 1 ||
      parsed.values["include-requests"] === true
    ) {
      throw new Error(usage);
    }
    process.stdout.write(await exportCandidate(positionals[0]!));
    return;
  }
  if (
    command !== "run" ||
    positionals.length !== 3 ||
    parsed.values["include-requests"] === true
  ) {
    throw new Error(usage);
  }

  const taskPath = positionals[0]!;
  const campaignPath = positionals[1]!;
  const settingsPath = positionals[2]!;
  const workflowSettings = await readSettings(settingsPath);
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
    const result = await run(
      {
        task: task.parse(await readJson(taskPath)),
        campaignPath,
        settings: workflowSettings,
      },
      {
        models: async () => {
          return withSerialToolCalls(
            await createModelRuntime(modelRuntimeOptions(process.env)),
          );
        },
        signal: controller.signal,
        pauseRequested: () => pauseRequested,
        status: (phase) => console.error(phase),
      },
    );
    writeJson(executionReport(result));
    if (result.outcome === "interrupted") process.exitCode = 130;
    if (result.outcome === "call-failure") process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
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
