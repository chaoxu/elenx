#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
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
  componentSettings,
  publicComponentResult,
  runCoordinator,
  runDecomposedLoop,
  runExplorer,
  runVerifier,
  type ComponentResult,
  type ComponentSettings,
} from "./decomposed";
import { settingsSchema } from "./exploration-protocol";
import { withSerialToolCalls } from "./serial-tools";

const application = "elenx-solve-decomposed";
const protocol = "decomposed-components";

const usage = `Usage:
  bun decomposed-cli.ts explorer INPUT.json CAMPAIGN.db SETTINGS.json
  bun decomposed-cli.ts coordinator INPUT.json CAMPAIGN.db SETTINGS.json
  bun decomposed-cli.ts verifier INPUT.json CAMPAIGN.db SETTINGS.json
  bun decomposed-cli.ts loop-once SCENARIO.json CAMPAIGN.db SETTINGS.json
  bun decomposed-cli.ts inspect CAMPAIGN.db

Run the explorer, coordinator, or opaque verifier as one real Elenx call, or
compose the same operations in the one-shot scratch loop. Individual calls are
journaled; loop-once does not reconstruct loop state after a process restart.
Existing V17 campaign databases are never accepted here.`;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readSettings(path: string): Promise<ComponentSettings> {
  const value = await readJson(path);
  const direct = componentSettings.safeParse(value);
  if (direct.success) return direct.data;
  const v17 = settingsSchema.parse(value);
  return {
    explorer: v17.explorer,
    coordinator: v17.curator,
    verifier: v17.verifier,
  };
}

function openScratchCampaign(path: string): Campaign {
  if (!existsSync(path)) {
    return createCampaign(path, application, { protocol });
  }
  const campaign = openCampaign(path);
  try {
    assertScratchDeclaration(campaign.records()[0]);
  } catch (error) {
    campaign.close();
    throw error;
  }
  return campaign;
}

function assertScratchDeclaration(declaration: Entry | undefined): void {
  if (
    declaration?.kind !== "campaign" ||
    declaration.application !== application ||
    declaration.config === null ||
    typeof declaration.config !== "object" ||
    Array.isArray(declaration.config) ||
    (declaration.config as { readonly [key: string]: Json })["protocol"] !==
      protocol
  ) {
    throw new Error("not a decomposed scratch campaign");
  }
}

function inspectScratchCampaign(path: string): Json {
  const reader = openReader(path);
  try {
    const records = reader.records();
    assertScratchDeclaration(records[0]);
    const results = new Map(
      records
        .filter((entry) => entry.kind === "call-result")
        .map((entry) => [entry.parent, entry]),
    );
    const calls = records
      .filter(
        (entry) =>
          entry.kind === "call" &&
          entry.label.startsWith("elenx-solve/decomposed/"),
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
          label: entry.label,
          startedAtMs: entry.atMs,
          ...(result === undefined
            ? {}
            : {
                settledAtMs: result.atMs,
                elapsedMs: result.atMs - entry.atMs,
                settlement: result.state,
              }),
          ...(terminal?.kind === "tool-call"
            ? { response: terminal.input }
            : {}),
          ...(parsed?.success === true
            ? { piState: parsed.data.state, telemetry: parsed.data.telemetry }
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

async function main(args: readonly string[]): Promise<void> {
  if (args[0] === "inspect") {
    if (args[1] === "--help" || args[1] === "-h") {
      console.log(usage);
      return;
    }
    if (args.length !== 2) throw new Error(usage);
    process.stdout.write(
      `${JSON.stringify(inspectScratchCampaign(args[1]!), null, 2)}\n`,
    );
    return;
  }
  if (args.length !== 4 || args[0] === "--help" || args[0] === "-h") {
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
      console.log(usage);
      return;
    }
    throw new Error(usage);
  }
  const [role, inputPath, campaignPath, settingsPath] = args;
  if (
    role !== "explorer" &&
    role !== "coordinator" &&
    role !== "verifier" &&
    role !== "loop-once"
  ) {
    throw new Error(usage);
  }
  const settings = await readSettings(settingsPath!);
  const runtime = await ModelRuntime.create({
    modelsPath: modelsPath(process.env),
  });
  await requireCredentials(
    runtime,
    role === "loop-once"
      ? [
          settings.explorer.provider,
          settings.coordinator.provider,
          settings.verifier.provider,
        ]
      : [settings[role].provider],
  );
  const models = withSerialToolCalls(runtime);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const campaign = openScratchCampaign(campaignPath!);
  try {
    const dependencies = { models, signal: controller.signal };
    const input = await readJson(inputPath!);
    let output: Json;
    if (role === "explorer") {
      output = publicComponentResult(
        await runExplorer(campaign, input, settings.explorer, dependencies),
      );
    } else if (role === "coordinator") {
      output = publicComponentResult(
        await runCoordinator(
          campaign,
          input,
          settings.coordinator,
          dependencies,
        ),
      );
    } else if (role === "verifier") {
      output = publicComponentResult(
        await runVerifier(campaign, input, settings.verifier, dependencies),
      );
    } else {
      const calls: ComponentResult<unknown>[] = [];
      const result = await runDecomposedLoop(input, {
        explore: async (packet) => {
          const call = await runExplorer(
            campaign,
            packet,
            settings.explorer,
            dependencies,
          );
          calls.push(call);
          return call.response;
        },
        coordinate: async (packet) => {
          const call = await runCoordinator(
            campaign,
            packet,
            settings.coordinator,
            dependencies,
          );
          calls.push(call);
          return call.response;
        },
        verify: async (packet) => {
          const call = await runVerifier(
            campaign,
            packet,
            settings.verifier,
            dependencies,
          );
          calls.push(call);
          return call.response;
        },
      });
      output = JSON.parse(JSON.stringify({ result, calls })) as Json;
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    campaign.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
