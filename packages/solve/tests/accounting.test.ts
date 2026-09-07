import { afterEach, expect, test } from "bun:test";
import { createCampaign, type Entry } from "elenx";
import { derivePiSpend, type PiRunOptions } from "elenx/pi";

import { campaignAccounting } from "../accounting";
import { inspectCampaign } from "../role-cli";
import { fakePiRequest, fakePiTelemetry } from "./fake-pi";
import { campaignPath, cleanupCampaigns } from "./harness";

afterEach(cleanupCampaigns);

const options: PiRunOptions = {
  models: {
    streamSimple() {
      throw new Error("no model call");
    },
  },
  model: {
    id: "test",
    name: "Test",
    provider: "test",
    api: "openai-responses",
    baseUrl: "https://invalid.test/v1",
    reasoning: false,
    input: ["text"],
    contextWindow: 1000,
    maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  label: "elenx-solve/explorer",
  prompt: "Test accounting",
};

function records(measured: boolean): Entry[] {
  const telemetry = structuredClone(fakePiTelemetry(options, "succeeded"));
  if (measured)
    Object.assign(telemetry.spans[1]!.attributes, {
      "pi.ai.usage.input_tokens": 10,
      "pi.ai.usage.output_tokens": 2,
      "pi.ai.usage.cache_read_tokens": 0,
      "pi.ai.usage.cache_write_tokens": 0,
      "pi.ai.usage.total_tokens": 12,
      "pi.ai.usage.cost": 0,
    });
  return [
    {
      kind: "campaign",
      seq: 1,
      atMs: 1,
      application: "elenx-solve",
      config: { kind: "calls" },
    },
    {
      kind: "call",
      seq: 2,
      atMs: 2,
      label: options.label,
      request: fakePiRequest(options),
      tools: [],
    },
    {
      kind: "call-result",
      seq: 3,
      atMs: 3,
      parent: 2,
      state: "returned",
      output: JSON.parse(
        JSON.stringify({
          state: "succeeded",
          text: "",
          transcript: [],
          telemetry,
        }),
      ),
    },
  ];
}

test("known zero-priced usage is complete but absent usage is unknown", () => {
  expect(campaignAccounting(records(true))).toEqual({
    complete: true,
    measuredCostUsd: 0,
    unmeasuredRequests: 0,
    unaccountedCalls: [],
    potentialRequests: [],
    unpricedCalls: [],
  });
  expect(campaignAccounting(records(false))).toMatchObject({
    complete: false,
    measuredCostUsd: null,
    unmeasuredRequests: 1,
  });
});

test("an unsettled call prevents complete accounting even before a usage result", () => {
  expect(campaignAccounting(records(true).slice(0, 2))).toMatchObject({
    complete: false,
    measuredCostUsd: null,
    unmeasuredRequests: 0,
    unaccountedCalls: [2],
  });
});

test("inspection exposes completeness without modifying the journal", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "elenx-solve", { kind: "calls" });
  const result = records(false)[2] as Extract<
    Entry,
    { kind: "call-result"; state: "returned" }
  >;
  await campaign.call(
    { label: options.label, request: fakePiRequest(options), tools: [] },
    async () => result.output,
  );
  const spend = derivePiSpend(campaign.records()).summary;
  campaign.close();
  const before = await Bun.file(path).arrayBuffer();
  expect(await inspectCampaign(path)).toMatchObject({
    spend,
    accounting: {
      complete: false,
      measuredCostUsd: null,
      unmeasuredRequests: 1,
    },
  });
  expect(await Bun.file(path).arrayBuffer()).toEqual(before);
});
