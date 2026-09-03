import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCampaign } from "../../src";
import {
  inspectCoreCampaign,
  inspectCoreCampaignSummary,
} from "../../src/observe";
import { PI_TELEMETRY_SCHEMA_VERSIONS } from "../../src/pi";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function campaignPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "elenx-observe-v1-"));
  directories.push(directory);
  return join(directory, "campaign.db");
}

function piRequest() {
  return {
    protocol: "elenx/pi-run/v1" as const,
    model: { provider: "provider", id: "model", api: "responses" },
    modelProfile: null,
    prompt: "test",
  };
}

function piResult(
  attributes: Record<string, string | number | boolean>,
  transcript: readonly unknown[] = [],
  additionalOperations: readonly Record<
    string,
    string | number | boolean
  >[] = [],
) {
  return {
    state: "succeeded" as const,
    text: "done",
    transcript,
    telemetry: {
      schemaVersions: PI_TELEMETRY_SCHEMA_VERSIONS,
      spans: [
        {
          id: 1,
          parentId: null,
          name: "elenx.pi.run",
          attributes: {},
          events: [],
          status: { status: "ok" as const },
          settled: true,
        },
        ...[attributes, ...additionalOperations].map((operation, at) => ({
          id: at + 2,
          parentId: 1,
          name: "pi.ai.request",
          attributes: operation,
          events: [],
          status: { status: "ok" as const },
          settled: true,
        })),
      ],
    },
  };
}

const firstUsage = {
  input: 8,
  output: 5,
  cacheRead: 2,
  cacheWrite: 1,
  reasoning: 3,
  totalTokens: 16,
  cost: { input: 1, output: 8, cacheRead: 0.5, cacheWrite: 0.5, total: 10 },
};
const secondUsage = {
  input: 0,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  totalTokens: 5,
  cost: { input: 0, output: 10, cacheRead: 0, cacheWrite: 0, total: 10 },
};
const attributes = (usage: typeof firstUsage) => ({
  "pi.ai.provider": "provider",
  "pi.ai.model": "model",
  "pi.ai.api": "responses",
  "pi.ai.usage.input_tokens": usage.input,
  "pi.ai.usage.output_tokens": usage.output,
  "pi.ai.usage.cache_read_tokens": usage.cacheRead,
  "pi.ai.usage.cache_write_tokens": usage.cacheWrite,
  "pi.ai.usage.reasoning_tokens": usage.reasoning,
  "pi.ai.usage.total_tokens": usage.totalTokens,
  "pi.ai.usage.cost": usage.cost.total,
});
const message = (usage: typeof firstUsage) => ({ role: "assistant", usage });

test("derives token buckets and prices reasoning per response", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "changing-workflow", null);
  try {
    await campaign.call(
      { label: "workflow/measured", request: piRequest() },
      async () =>
        piResult(
          attributes(firstUsage),
          [message(firstUsage), message(secondUsage)],
          [attributes(secondUsage)],
        ),
    );
  } finally {
    campaign.close();
  }

  const expected = {
    freshInputTokens: 9,
    cachedInputTokens: 2,
    reasoningOutputTokens: 3,
    nonReasoningOutputTokens: 7,
    estimatedReasoningCostUsd: 4.8,
    reasoningCostShareOfMeasuredCost: 0.24,
  };
  const observation = inspectCoreCampaign(path);
  expect(observation.spend.breakdown).toEqual(expected);
  expect(observation.calls[0]!.pi?.accounting).toMatchObject({
    state: "available",
    spend: { breakdown: expected },
  });
  expect(inspectCoreCampaignSummary(path).spend.breakdown).toEqual(expected);
});

test("omits reasoning cost when measured retry usage is absent from transcript", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "changing-workflow", null);
  try {
    await campaign.call(
      { label: "workflow/measured", request: piRequest() },
      async () =>
        piResult(
          attributes(firstUsage),
          [message(firstUsage)],
          [attributes(secondUsage)],
        ),
    );
  } finally {
    campaign.close();
  }

  expect(inspectCoreCampaign(path).spend.breakdown).toEqual({
    freshInputTokens: 9,
    cachedInputTokens: 2,
    reasoningOutputTokens: 3,
    nonReasoningOutputTokens: 7,
  });
});

test("projects opaque application data, calls, candidates, and verdicts", async () => {
  const path = campaignPath();
  const config = { protocol: "rapid-v37", future: { value: true } };
  const campaign = createCampaign(path, "changing-workflow", config);
  try {
    const candidate = campaign.submitCandidate(new TextEncoder().encode("x"), [
      "proof",
    ]);
    const { call } = await campaign.call(
      {
        label: "proof",
        role: "proof-auditor",
        candidate,
        request: { custom: true },
      },
      async () => ({ state: "succeeded" }),
    );
    campaign.recordVerdict(call, "PASS", { checked: "directly" });
  } finally {
    campaign.close();
  }

  expect(inspectCoreCampaign(path)).toMatchObject({
    schema: "elenx.core-observation/v1",
    application: "changing-workflow",
    applicationConfig: config,
    calls: [
      {
        label: "proof",
        role: "proof-auditor",
        settlement: "returned",
        candidateId: 2,
        tools: [],
      },
    ],
    candidates: [
      {
        id: 2,
        requiredVerifiers: ["proof"],
        material: { bytes: 1, encoding: "utf8", text: "x" },
        status: { verified: true, missing: [], failed: [] },
        verdicts: [
          {
            call: 3,
            verifier: "proof",
            verdict: "PASS",
            evidence: { checked: "directly" },
          },
        ],
      },
    ],
  });
});

test("preserves non-UTF-8 candidate bytes without invented text", () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "binary-workflow", null);
  try {
    campaign.submitCandidate(new Uint8Array([0xff]), ["proof"]);
  } finally {
    campaign.close();
  }

  expect(inspectCoreCampaign(path).candidates[0]!.material).toEqual({
    bytes: 1,
    encoding: "base64",
    base64: "/w==",
  });
});

test("summarizes without response, evidence, operation, or material payloads", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "changing-workflow", { opaque: true });
  try {
    campaign.submitCandidate(new TextEncoder().encode("large material"), [
      "proof",
    ]);
    await campaign.call(
      { label: "workflow/call", request: { opaque: true } },
      async () => ({ response: "large response" }),
    );
  } finally {
    campaign.close();
  }

  const summary = inspectCoreCampaignSummary(path);
  expect(summary).toMatchObject({
    schema: "elenx.core-observation-summary/v1",
    application: "changing-workflow",
    callCount: 1,
    candidateCount: 1,
    verifiedCandidateCount: 0,
  });
  expect(JSON.stringify(summary)).not.toContain("large material");
  expect(JSON.stringify(summary)).not.toContain("large response");
  expect(summary).not.toHaveProperty("applicationConfig");
});

test("keeps understood spend when another Pi telemetry record is unsupported", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "changing-workflow", null);
  try {
    await campaign.call(
      { label: "workflow/measured", request: piRequest() },
      async () =>
        piResult({
          "pi.ai.provider": "provider",
          "pi.ai.model": "model",
          "pi.ai.api": "responses",
          "pi.ai.usage.input_tokens": 8,
          "pi.ai.usage.output_tokens": 5,
          "pi.ai.usage.cache_read_tokens": 2,
          "pi.ai.usage.cache_write_tokens": 0,
          "pi.ai.usage.total_tokens": 13,
          "pi.ai.usage.cost": 0.25,
        }),
    );
    await campaign.call(
      { label: "workflow/future", request: piRequest() },
      async () => ({
        state: "succeeded",
        text: "done",
        transcript: [],
        telemetry: { schemaVersions: { future: 1 }, spans: [] },
      }),
    );
  } finally {
    campaign.close();
  }

  const observation = inspectCoreCampaign(path);
  expect(observation.calls.map((call) => call.pi?.accounting.state)).toEqual([
    "available",
    "unsupported",
  ]);
  expect(observation.spend).toEqual({
    logicalProviderRequests: 1,
    requestErrors: 0,
    unmeasuredRequests: 0,
    measuredUsage: {
      input: 8,
      output: 5,
      cacheRead: 2,
      cacheWrite: 0,
      totalTokens: 13,
      estimatedCostUsd: 0.25,
    },
    unsupportedCalls: [4],
    unaccountedCalls: [],
  });
});

test("reports missing usage as unmeasured instead of zero", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "changing-workflow", null);
  try {
    await campaign.call(
      { label: "workflow/unmeasured", request: piRequest() },
      async () =>
        piResult({
          "pi.ai.provider": "provider",
          "pi.ai.model": "model",
          "pi.ai.api": "responses",
        }),
    );
  } finally {
    campaign.close();
  }

  expect(inspectCoreCampaign(path).spend).toEqual({
    logicalProviderRequests: 1,
    requestErrors: 0,
    unmeasuredRequests: 1,
    unsupportedCalls: [],
    unaccountedCalls: [],
  });
});

test("distinguishes an unsettled Pi call from unsupported telemetry", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "changing-workflow", null);
  let finish!: () => void;
  const pending = campaign.call(
    { label: "workflow/running", request: piRequest() },
    () => new Promise<null>((resolve) => (finish = () => resolve(null))),
  );
  try {
    await Bun.sleep(0);
    expect(inspectCoreCampaign(path)).toMatchObject({
      calls: [
        {
          settlement: "unsettled",
          pi: { accounting: { state: "unaccounted" } },
        },
      ],
      spend: { unsupportedCalls: [], unaccountedCalls: [2] },
    });
  } finally {
    finish();
    await pending;
    campaign.close();
  }
});
