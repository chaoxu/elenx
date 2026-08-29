import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Campaign, Json } from "elenx";
import { type PiResult, type PiRunOptions } from "elenx/pi";
import { z } from "zod";

import type { Settings } from "../exploration";
import type { SolveDependencies, SolveModels } from "../solve";
import type {
  SourceCheckRequest,
  SourceResolution,
  SourceCheckResult,
} from "../verifiers/source-check";
import { fakePiRequest, fakePiTelemetry } from "./fake-pi";

const baseModel: PiRunOptions["model"] = {
  id: "base-v1",
  name: "Base",
  api: "openai-responses",
  provider: "base",
  baseUrl: "https://invalid.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 20_000,
};

export const explorerModel = {
  ...baseModel,
  id: "explorer-v1",
  provider: "explorer",
};
export const handoffModel = {
  ...baseModel,
  id: "handoff-v1",
  provider: "handoff",
};
export const premiseModel = {
  ...baseModel,
  id: "premise-v1",
  provider: "premise",
};
export const sourceModel = {
  ...baseModel,
  id: "source-v1",
  provider: "openai-codex",
  api: "openai-codex-responses",
};
export const proofModel = {
  ...baseModel,
  id: "proof-v1",
  provider: "proof",
};
export const archivistModel = {
  ...baseModel,
  id: "archivist-v1",
  provider: "archivist",
};

const modelsList = [
  explorerModel,
  handoffModel,
  premiseModel,
  sourceModel,
  proofModel,
  archivistModel,
] as const;

export const problem = "Prove that the sum of two even integers is even.";
export const criteria =
  "Give one standalone proof for arbitrary even integers.";
export const candidate =
  "Let a and b be even integers. Then a=2r and b=2s for integers r and s. Hence a+b=2(r+s), and r+s is an integer. Therefore a+b is even.";

export function runSettings(overrides: Partial<Settings> = {}): Settings {
  const selection = (model: PiRunOptions["model"]) => ({
    provider: model.provider,
    model: model.id,
    reasoning: "high" as const,
  });
  return {
    protocol: "exploration-v16",
    maxContextTokens: 200_000,
    maxIndexTokens: 100_000,
    explorerGuidance: [],
    explorer: selection(explorerModel),
    curator: selection(handoffModel),
    premiseVerifier: selection(premiseModel),
    sourceChecker: {
      model: sourceModel.id,
      reasoning: "high",
    },
    proofVerifier: selection(proofModel),
    ...overrides,
  };
}

const directories: string[] = [];

export function campaignPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "elenx-solve-test-"));
  directories.push(directory);
  return join(directory, "campaign.db");
}

export function cleanupCampaigns(): void {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
}

export interface Reply {
  readonly submission?: Json | ((campaign: Campaign) => Json);
  readonly state?: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly providerRetryable?: boolean;
  readonly throwAfter?: string;
  readonly costUsd?: number;
}

export type SourceReply =
  SourceCheckResult | ((request: SourceCheckRequest) => SourceCheckResult);

export function sourceResult(
  resolutions: readonly SourceResolution[],
  report = "Source verification completed.",
): Extract<SourceCheckResult, { readonly state: "succeeded" }> {
  const transport = resolutions.map((resolution) => ({
    statement: resolution.statement,
    standing: resolution.standing,
    citation: resolution.standing === "SOURCED" ? resolution.citation : null,
    url: resolution.standing === "SOURCED" ? resolution.url : null,
    locator: resolution.standing === "SOURCED" ? resolution.locator : null,
    exactQuote:
      resolution.standing === "SOURCED" ? resolution.exactQuote : null,
    sourceMatch:
      resolution.standing === "SOURCED" ? resolution.sourceMatch : null,
    candidateCitationMatch:
      resolution.standing === "SOURCED"
        ? resolution.candidateCitationMatch
        : null,
    candidateCitationCheck:
      resolution.standing === "SOURCED"
        ? resolution.candidateCitationCheck
        : null,
    refutationAttempt:
      resolution.standing === "SOURCED" || resolution.standing === "UNRESOLVED"
        ? resolution.refutationAttempt
        : null,
    application:
      resolution.standing === "SOURCED" ? resolution.application : null,
    applicationCheck:
      resolution.standing === "SOURCED" ? resolution.applicationCheck : null,
    refutation:
      resolution.standing === "REFUTED" ? resolution.refutation : null,
    defect: resolution.standing === "MISAPPLIED" ? resolution.defect : null,
    gap: resolution.standing === "UNRESOLVED" ? resolution.gap : null,
  }));
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 40,
    cache_write_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 5,
  };
  const events = [
    { type: "thread.started", thread_id: "thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "web_search", query: "authoritative theorem" },
    },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ report, resolutions: transport }),
      },
    },
    { type: "turn.completed", usage },
  ];
  return {
    state: "succeeded",
    codexVersion: "codex-cli test",
    stdout: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    stderr: "",
  };
}

export function dependencies(
  replies: readonly Reply[],
  sourceReplies: readonly SourceReply[] = [],
): SolveDependencies & {
  readonly calls: PiRunOptions[];
  readonly sourceCalls: SourceCheckRequest[];
} {
  const queue = [...replies];
  const sourceQueue = [...sourceReplies];
  const calls: PiRunOptions[] = [];
  const sourceCalls: SourceCheckRequest[] = [];
  const models: SolveModels = {
    getModel(provider, id) {
      return modelsList.find(
        (model) => model.provider === provider && model.id === id,
      );
    },
    streamSimple() {
      throw new Error("fake runner owns execution");
    },
  };
  return {
    models,
    async run(campaign, options) {
      calls.push(options);
      const reply = queue.shift();
      if (reply === undefined) throw new Error(`no reply for ${options.label}`);
      expect(options.stopAfterToolResult).toBe(true);
      expect(options.transport).toBe("sse");
      const result = await respond(campaign, options, reply);
      if (reply.throwAfter !== undefined) throw new Error(reply.throwAfter);
      return result;
    },
    async sourceCheck(request) {
      sourceCalls.push(request);
      const reply = sourceQueue.shift();
      if (reply === undefined) throw new Error("no source reply");
      return typeof reply === "function" ? reply(request) : reply;
    },
    calls,
    sourceCalls,
    pauseRequested: () => queue.length === 0 && sourceQueue.length === 0,
  };
}

async function respond(
  campaign: Campaign,
  options: PiRunOptions,
  reply: Reply,
): Promise<PiResult> {
  const state = reply.state ?? "succeeded";
  const telemetry = fakePiTelemetry(options, state, reply.costUsd);
  const receipt = await campaign.call(
    {
      label: options.label,
      ...(options.role === undefined ? {} : { role: options.role }),
      request: fakePiRequest(options),
      ...(options.candidate === undefined
        ? {}
        : { candidate: options.candidate }),
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    },
    async ({ tools }) => {
      if (reply.submission !== undefined) {
        try {
          const value =
            typeof reply.submission === "function"
              ? reply.submission(campaign)
              : reply.submission;
          await tools[0]!.execute(value);
        } catch (error) {
          if (!(error instanceof z.ZodError)) throw error;
        }
      }
      return state === "succeeded"
        ? { state, text: "done", transcript: [], telemetry }
        : {
            state,
            text: "partial",
            transcript: [],
            telemetry,
            error: reply.error ?? `${state} call`,
            ...(state === "failed"
              ? {
                  providerRetryable: reply.providerRetryable ?? false,
                  truncated: false,
                }
              : {}),
          };
    },
  );
  if (state === "succeeded") {
    return {
      call: receipt.call,
      state,
      text: "done",
      transcript: [],
      telemetry,
    };
  }
  if (state === "failed") {
    return {
      call: receipt.call,
      state,
      text: "partial",
      transcript: [],
      telemetry,
      error: reply.error ?? "failed call",
      providerRetryable: reply.providerRetryable ?? false,
      truncated: false,
    };
  }
  return {
    call: receipt.call,
    state,
    text: "partial",
    transcript: [],
    telemetry,
    error: reply.error ?? "cancelled call",
  };
}
