import { expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Campaign, Json } from "elenx";
import { type PiResult, type PiRunOptions, type PiTelemetry } from "elenx/pi";

import { start, type Settings } from "../exploration";
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

const explorerModel = {
  ...baseModel,
  id: "explorer-v1",
  provider: "explorer",
};
const curatorModel = {
  ...baseModel,
  id: "curator-v1",
  provider: "curator",
};
const triageModel = {
  ...baseModel,
  id: "triage-v1",
  provider: "triage",
};
const sourceModel = {
  ...baseModel,
  id: "source-v1",
  provider: "openai-codex",
  api: "openai-codex-responses",
};
const verifierModel = {
  ...baseModel,
  id: "verifier-v1",
  provider: "verifier",
};
const modelsList = [
  explorerModel,
  curatorModel,
  triageModel,
  sourceModel,
  verifierModel,
] as const;

const problem = "Prove that the sum of two even integers is even.";
const criteria = "Give one standalone proof for arbitrary even integers.";

export function runSettings(overrides: Partial<Settings> = {}): Settings {
  const selection = (model: PiRunOptions["model"]) => ({
    provider: model.provider,
    model: model.id,
    reasoning: "high" as const,
  });
  return {
    protocol: "exploration-v17",
    maxContextTokens: 200_000,
    maxIndexTokens: 100_000,
    explorerGuidance: [],
    explorer: selection(explorerModel),
    curator: selection(curatorModel),
    triage: selection(triageModel),
    verifier: selection(verifierModel),
    sourceChecker: {
      model: sourceModel.id,
      reasoning: "high",
    },
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
  readonly submission?: Json;
  readonly state?: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly providerRetryable?: boolean;
}

export function sourceResult(
  resolutions: readonly SourceResolution[],
): Extract<SourceCheckResult, { readonly state: "succeeded" }> {
  // Transport shape: every field present, null unless the variant carries it.
  // The spread overrides cleanly because every SourceResolution variant is a
  // strict object with all of its fields required — none arrives undefined.
  const transport = resolutions.map((resolution) => ({
    citation: null,
    url: null,
    locator: null,
    exactQuote: null,
    sourceMatch: null,
    candidateCitationMatch: null,
    candidateCitationCheck: null,
    refutationAttempt: null,
    application: null,
    applicationCheck: null,
    refutation: null,
    defect: null,
    gap: null,
    ...resolution,
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
        text: JSON.stringify({
          report: "Source verification completed.",
          resolutions: transport,
        }),
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
  sourceReplies: readonly SourceCheckResult[] = [],
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
      return respond(campaign, options, reply);
    },
    async sourceCheck(request) {
      sourceCalls.push(request);
      const reply = sourceQueue.shift();
      if (reply === undefined) throw new Error("no source reply");
      return reply;
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
  const telemetry = fakePiTelemetry(options, state);
  const body = replyBody(state, reply, telemetry);
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
        await tools[0]!.execute(reply.submission);
      }
      return body;
    },
  );
  return { call: receipt.call, ...body };
}

function replyBody(
  state: NonNullable<Reply["state"]>,
  reply: Reply,
  telemetry: PiTelemetry,
) {
  switch (state) {
    case "succeeded":
      return { state, text: "done", transcript: [], telemetry };
    case "failed":
      return {
        state,
        text: "partial",
        transcript: [],
        telemetry,
        error: reply.error ?? "failed call",
        providerRetryable: reply.providerRetryable ?? false,
        truncated: false,
      };
    case "cancelled":
      return {
        state,
        text: "partial",
        transcript: [],
        telemetry,
        error: reply.error ?? "cancelled call",
      };
  }
}

// ---------------------------------------------------------------------------
// Scripted-reply constructors and the shared campaign starter.
// ---------------------------------------------------------------------------

export const turn = (
  findings: readonly {
    text: string;
    basedOn?: readonly string[];
    basedOnFindings?: readonly number[];
  }[],
  extra: {
    readonly nextObjective?: string;
    readonly expand?: readonly string[];
  } = {},
): Reply => ({ submission: { findings, ...extra } as unknown as Json });

export const curation = (
  filings: readonly {
    finding: number;
    summary?: string;
    refines?: string;
    duplicateOf?: string;
  }[],
): Reply => ({ submission: { filings } as unknown as Json });

export const triage = (
  plans: readonly {
    note: string;
    modes: readonly string[];
    rationale: string;
  }[],
): Reply => ({ submission: { plans } as unknown as Json });

export const verdict = (
  value: "PASS" | "FAIL" | "INCONCLUSIVE",
  report: string,
): Reply => ({ submission: { verdict: value, report } });

export const serve = (expand: readonly string[], objective: string): Reply => ({
  submission: { expand, objective } as unknown as Json,
});

export const goalServe = (goalNote: string): Reply => ({
  submission: { goalNote },
});

export interface BatteryReports {
  readonly proof: string;
  readonly reconstruction: string;
  readonly refutation: string;
  readonly premises: string;
  readonly criteria: string;
}

const batteryPasses = (reports: BatteryReports): Reply[] => [
  verdict("PASS", reports.proof),
  verdict("PASS", reports.reconstruction),
  verdict("PASS", reports.refutation),
  { submission: { report: reports.premises, premises: [] } },
  verdict("PASS", reports.criteria),
];

export interface SolvedSpec {
  readonly lemma: {
    readonly text: string;
    readonly summary: string;
    readonly rationale: string;
    readonly verdictReport: string;
  };
  readonly route?: {
    readonly text: string;
    readonly summary: string;
    readonly rationale: string;
  };
  readonly firstObjective?: string;
  readonly serveObjective: string;
  readonly goal: {
    readonly text: string;
    readonly summary: string;
    readonly rationale: string;
    readonly verdictReport: string;
  };
  readonly battery: BatteryReports;
}

// The canonical two-turn solved campaign: a verified lemma, an optional
// process note, a goal resting on the lemma, and a passing boundary battery.
export function solvedReplies(spec: SolvedSpec): Reply[] {
  const goalId = spec.route === undefined ? "n2" : "n3";
  return [
    turn(
      [
        { text: spec.lemma.text },
        ...(spec.route === undefined
          ? []
          : [{ text: spec.route.text, basedOn: [] as readonly string[] }]),
      ],
      spec.firstObjective === undefined
        ? {}
        : { nextObjective: spec.firstObjective },
    ),
    curation([
      { finding: 1, summary: spec.lemma.summary },
      ...(spec.route === undefined
        ? []
        : [{ finding: 2, summary: spec.route.summary }]),
    ]),
    triage([
      { note: "n1", modes: ["proof-audit"], rationale: spec.lemma.rationale },
      ...(spec.route === undefined
        ? []
        : [{ note: "n2", modes: [], rationale: spec.route.rationale }]),
    ]),
    verdict("PASS", spec.lemma.verdictReport),
    serve(["n1"], spec.serveObjective),
    turn([{ text: spec.goal.text, basedOn: ["n1"] }]),
    curation([{ finding: 1, summary: spec.goal.summary }]),
    triage([
      { note: goalId, modes: ["proof-audit"], rationale: spec.goal.rationale },
    ]),
    verdict("PASS", spec.goal.verdictReport),
    goalServe(goalId),
    ...batteryPasses(spec.battery),
  ];
}

export async function startCampaign(
  replies: readonly Reply[],
  options: {
    readonly settings?: Partial<Settings>;
    readonly sourceReplies?: readonly SourceCheckResult[];
    readonly statuses?: string[];
  } = {},
): Promise<{
  readonly path: string;
  readonly drive: ReturnType<typeof dependencies>;
  readonly report: Awaited<ReturnType<typeof start>>;
}> {
  const path = campaignPath();
  const drive = dependencies(replies, options.sourceReplies ?? []);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(options.settings ?? {}),
    },
    options.statuses === undefined
      ? drive
      : { ...drive, status: (message) => options.statuses!.push(message) },
  );
  return { path, drive, report };
}
