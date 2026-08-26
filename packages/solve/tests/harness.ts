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
  SourceAuditRequest,
  SourceResolution,
  SourceSearchResult,
} from "../verifiers/source-audit";
import { fakePiRequest, fakePiTelemetry } from "./fake-pi";

export const coordinatorModel: PiRunOptions["model"] = {
  id: "coordinator-v1",
  name: "Coordinator",
  api: "openai-responses",
  provider: "coordinator",
  baseUrl: "https://invalid.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

export const explorerModel: PiRunOptions["model"] = {
  ...coordinatorModel,
  id: "explorer-v1",
  name: "Explorer",
  provider: "explorer",
};
export const reviewerModel: PiRunOptions["model"] = {
  ...coordinatorModel,
  id: "reviewer-v1",
  name: "Reviewer",
  provider: "reviewer",
};
export const verifierModel: PiRunOptions["model"] = {
  ...coordinatorModel,
  id: "verifier-v1",
  name: "Verifier",
  provider: "verifier",
};
export const secondVerifierModel: PiRunOptions["model"] = {
  ...coordinatorModel,
  id: "verifier-v2",
  name: "Second verifier",
  provider: "openai-codex",
};
export const reconstructorModel: PiRunOptions["model"] = {
  ...coordinatorModel,
  id: "reconstructor-v1",
  name: "Reconstructor",
  provider: "reconstructor",
};

export const problem = "Determine all integers n such that n^2+3n+2 is prime.";
export const criteria =
  "State the exact set of integers and prove both inclusions.";
export const candidate =
  "Since n^2+3n+2=(n+1)(n+2), primality holds exactly for n=-3 and n=0.";

export function runSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    protocol: "exploration-v14",
    memory: "claims-and-routes",
    maxContextTokens: 200_000,
    explorerGuidance: [],
    coordinatorGuidance: [],
    coordinator: {
      provider: coordinatorModel.provider,
      model: coordinatorModel.id,
      reasoning: "max",
    },
    explorer: {
      provider: explorerModel.provider,
      model: explorerModel.id,
      reasoning: "max",
    },
    admissionAuditors: [
      {
        name: "scope",
        provider: reviewerModel.provider,
        model: reviewerModel.id,
        reasoning: "high",
      },
    ],
    resolutionAuditors: [
      {
        kind: "premise-audit",
        provider: secondVerifierModel.provider,
        model: secondVerifierModel.id,
        reasoning: "max",
      },
      {
        kind: "proof-audit",
        provider: verifierModel.provider,
        model: verifierModel.id,
        reasoning: "max",
      },
      {
        kind: "reconstruction",
        provider: reconstructorModel.provider,
        model: reconstructorModel.id,
        reasoning: "max",
      },
    ],
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

function failedFields(reply: Reply) {
  return {
    providerRetryable: reply.providerRetryable ?? false,
    truncated: reply.truncated ?? false,
  };
}

export interface Reply {
  readonly submission?: Json | ((campaign: Campaign) => Json);
  readonly text?: string;
  readonly state?: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly truncated?: boolean;
  readonly providerRetryable?: boolean;
  readonly costUsd?: number;
  readonly throwAfter?: string;
}

export type SourceReply =
  | SourceSearchResult
  | ((
      request: SourceAuditRequest,
    ) => SourceSearchResult | Promise<SourceSearchResult>);

export function sourceResult(
  resolutions: readonly SourceResolution[],
  report = "Source audit completed.",
): Extract<SourceSearchResult, { readonly state: "succeeded" }> {
  const query = "authoritative theorem source";
  const usage = {
    inputTokens: 100,
    cachedInputTokens: 40,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 5,
  };
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
    candidateSourceMatch:
      resolution.standing === "SOURCED"
        ? resolution.candidateSourceMatch
        : null,
    candidateSourceCheck:
      resolution.standing === "SOURCED"
        ? resolution.candidateSourceCheck
        : null,
    refutationAttempt:
      resolution.standing === "REFUTED" ? null : resolution.refutationAttempt,
    refutation:
      resolution.standing === "REFUTED" ? resolution.refutation : null,
    gap: resolution.standing === "UNESTABLISHED" ? resolution.gap : null,
    application:
      resolution.standing === "REFUTED" ? null : resolution.application,
    applicationCheck:
      resolution.standing === "REFUTED" ? null : resolution.applicationCheck,
  }));
  const events = [
    { type: "thread.started", thread_id: "test-thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "web_search", query },
    },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ report, resolutions: transport }),
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        cache_write_input_tokens: usage.cacheWriteInputTokens,
        output_tokens: usage.outputTokens,
        reasoning_output_tokens: usage.reasoningOutputTokens,
      },
    },
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
  readonly sourceCalls: SourceAuditRequest[];
  readonly statuses: string[];
} {
  const queue = [...replies];
  const sourceQueue = [...sourceReplies];
  const calls: PiRunOptions[] = [];
  const sourceCalls: SourceAuditRequest[] = [];
  const statuses: string[] = [];
  const models: SolveModels = {
    getModel(provider, id) {
      return [
        coordinatorModel,
        explorerModel,
        reviewerModel,
        verifierModel,
        secondVerifierModel,
        reconstructorModel,
      ].find((model) => model.provider === provider && model.id === id);
    },
    streamSimple() {
      throw new Error("fake runner owns execution");
    },
  };
  const run = async (
    campaign: Campaign,
    options: PiRunOptions,
  ): Promise<PiResult> => {
    calls.push(options);
    const reply = queue.shift();
    if (reply === undefined) throw new Error(`no reply for ${options.label}`);
    expect(options.stopAfterToolResult).toBe(true);
    expect(options.maxRecoveries).toBe(1);
    expect(options.maxLengthContinuations).toBe(8);
    expect(options.transport).toBe("sse");
    expect(options.tools).toHaveLength(1);
    const result = await respond(campaign, options, reply);
    if (reply.throwAfter !== undefined) throw new Error(reply.throwAfter);
    return result;
  };
  return {
    models,
    run,
    async sourceSearch(request) {
      sourceCalls.push(request);
      const reply = sourceQueue.shift();
      if (reply === undefined) throw new Error("no source reply");
      return typeof reply === "function" ? await reply(request) : reply;
    },
    calls,
    sourceCalls,
    statuses,
    status: (message) => statuses.push(message),
    pauseRequested: () => queue.length === 0 && sourceQueue.length === 0,
  };
}

async function respond(
  campaign: Campaign,
  options: PiRunOptions,
  reply: Reply,
  request: Json = fakePiRequest(options),
): Promise<PiResult> {
  const state = reply.state ?? "succeeded";
  const text = reply.text ?? (state === "succeeded" ? "done" : "partial");
  const telemetry = fakePiTelemetry(options, state, reply.costUsd);
  const receipt = await campaign.call(
    {
      label: options.label,
      request,
      ...(options.candidate === undefined
        ? {}
        : { candidate: options.candidate }),
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    },
    async ({ tools }) => {
      if (reply.submission !== undefined) {
        try {
          const submission =
            typeof reply.submission === "function"
              ? reply.submission(campaign)
              : reply.submission;
          await tools[0]!.execute(submission);
        } catch (error) {
          if (!(error instanceof z.ZodError)) throw error;
        }
      }
      if (state === "succeeded") {
        return { state, text, transcript: [], telemetry };
      }
      return {
        state,
        text,
        transcript: [],
        telemetry,
        error: reply.error ?? `${state} call`,
        ...(state === "failed" ? failedFields(reply) : {}),
      };
    },
  );
  if (state === "succeeded") {
    return { call: receipt.call, state, text, transcript: [], telemetry };
  }
  if (state === "failed") {
    return {
      call: receipt.call,
      state,
      text,
      transcript: [],
      telemetry,
      error: reply.error ?? `${state} call`,
      ...failedFields(reply),
    };
  }
  return {
    call: receipt.call,
    state,
    text,
    transcript: [],
    telemetry,
    error: reply.error ?? `${state} call`,
  };
}
