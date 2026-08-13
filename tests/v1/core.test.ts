import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

import {
  createCampaign,
  defineTool,
  openCampaign,
  openReader,
} from "../../src";

const directories: string[] = [];

function database(): string {
  const directory = mkdtempSync(join(tmpdir(), "elenx-v1-"));
  directories.push(directory);
  return join(directory, "campaign.db");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

async function pass(
  campaign: ReturnType<typeof createCampaign>,
  candidate: ReturnType<typeof campaign.submitCandidate>,
  verifier: string,
): Promise<void> {
  const call = await campaign.call(
    { label: verifier, request: { candidate } },
    async ({ request }) => ({ state: "succeeded", checked: request }),
  );
  campaign.recordVerdict(candidate, verifier, call.id, "PASS", {
    reason: "checked",
  });
}

describe("small kernel", () => {
  test("persists candidates and content-addressed blobs for a fresh reader", () => {
    const path = database();
    const campaign = createCampaign(path, "test", { version: 1 });
    const material = new TextEncoder().encode("proof");
    const candidate = campaign.submitCandidate(material, ["audit/v1"]);
    campaign.close();

    const reader = openReader(path);
    expect(reader.records()).toHaveLength(2);
    expect(new TextDecoder().decode(reader.blob(candidate))).toBe("proof");
    reader.close();
  });

  test("binds verdicts to fresh successful calls and explicit promotion", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1", "compare/v1"],
    );
    expect(campaign.status(candidate)).toEqual({
      candidate,
      promotable: false,
      promoted: false,
      missing: ["audit/v1", "compare/v1"],
      failed: [],
      passes: [],
    });

    await pass(campaign, candidate, "audit/v1");
    await pass(campaign, candidate, "compare/v1");
    expect(campaign.status(candidate)).toMatchObject({
      promotable: true,
      promoted: false,
    });
    const promotion = campaign.promote(candidate);
    expect(promotion.kind).toBe("promotion");
    expect(campaign.status(candidate)).toMatchObject({
      promotable: true,
      promoted: true,
    });

    const late = await campaign.call(
      { label: "audit/v1", request: null },
      async () => ({ result: "late" }),
    );
    expect(() =>
      campaign.recordVerdict(candidate, "audit/v1", late.id, "FAIL", null),
    ).toThrow("already promoted");
  });

  test("rejects verdicts whose successful call names another candidate", async () => {
    const campaign = createCampaign(database(), "test", null);
    const first = campaign.submitCandidate(new TextEncoder().encode("first"), [
      "audit/v1",
    ]);
    const second = campaign.submitCandidate(
      new TextEncoder().encode("second"),
      ["audit/v1"],
    );
    const call = await campaign.call(
      { label: "audit/v1", request: { candidate: first } },
      async () => ({ state: "succeeded" }),
    );
    expect(() =>
      campaign.recordVerdict(second, "audit/v1", call.id, "PASS", null),
    ).toThrow("fresh successful");
  });

  test("rejects verdicts from failed protocol results and reused calls", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1", "compare/v1"],
    );
    const failed = await campaign.call(
      { label: "audit/v1", request: { candidate } },
      async () => ({ state: "failed", error: "provider failed" }),
    );
    expect(() =>
      campaign.recordVerdict(candidate, "audit/v1", failed.id, "PASS", null),
    ).toThrow("fresh successful");

    const passed = await campaign.call(
      { label: "audit/v1", request: { candidate } },
      async () => ({ state: "succeeded" }),
    );
    campaign.recordVerdict(candidate, "audit/v1", passed.id, "PASS", null);
    expect(() =>
      campaign.recordVerdict(candidate, "audit/v1", passed.id, "PASS", null),
    ).toThrow("already has a verdict");
  });

  test("blocks promotion on missing or failed required verification", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1", "compare/v1"],
    );
    const failed = await campaign.call(
      { label: "audit/v1", request: { candidate } },
      async () => ({ state: "succeeded", result: "counterexample" }),
    );
    campaign.recordVerdict(candidate, "audit/v1", failed.id, "FAIL", null);
    await pass(campaign, candidate, "compare/v1");
    expect(campaign.status(candidate)).toMatchObject({
      promotable: false,
      missing: ["audit/v1"],
      failed: ["audit/v1"],
    });
    expect(() => campaign.promote(candidate)).toThrow("not promotable");
  });

  test("freezes candidate verifier contracts exactly", () => {
    const campaign = createCampaign(database(), "test", null);
    const material = new TextEncoder().encode("claim");
    campaign.submitCandidate(material, ["audit/v1"]);
    expect(() =>
      campaign.submitCandidate(material, ["audit/v1", "compare/v1"]),
    ).toThrow("contract conflict");
  });

  test("treats normalized verifier sets and promotion idempotently", async () => {
    const campaign = createCampaign(database(), "test", null);
    const material = new TextEncoder().encode("claim");
    const candidate = campaign.submitCandidate(material, [
      "compare/v1",
      "audit/v1",
      "compare/v1",
    ]);
    expect(campaign.submitCandidate(material, ["audit/v1", "compare/v1"])).toBe(
      candidate,
    );
    await pass(campaign, candidate, "audit/v1");
    await pass(campaign, candidate, "compare/v1");
    const first = campaign.promote(candidate);
    const second = campaign.promote(candidate);
    expect(second.seq).toBe(first.seq);
    expect(
      campaign.records().filter((entry) => entry.kind === "promotion"),
    ).toHaveLength(1);
  });

  test("records calls and tool effects before returning", async () => {
    const campaign = createCampaign(database(), "test", null);
    const add = defineTool({
      name: "add",
      description: "Add two integers",
      input: z.strictObject({
        left: z.number().int(),
        right: z.number().int(),
      }),
      async run({ left, right }) {
        return { sum: left + right };
      },
    });

    const receipt = await campaign.call(
      { label: "math", request: { prompt: "add" }, tools: [add] },
      async ({ request, tools }) => ({
        request,
        result: await tools[0]!.execute({ left: 2, right: 3 }),
      }),
    );
    expect(receipt.output).toEqual({
      request: { prompt: "add" },
      result: { sum: 5 },
    });
    expect(campaign.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "tool-call",
      "tool-result",
      "call-result",
    ]);
  });

  test("rejects invalid tool input through the promised interface", async () => {
    const campaign = createCampaign(database(), "test", null);
    let ran = false;
    let returnedPromise = false;
    const tool = defineTool({
      name: "restricted",
      description: "Accept only the declared input",
      input: z.strictObject({ safe: z.literal(true) }),
      async run() {
        ran = true;
        return null;
      },
    });

    await expect(
      campaign.call(
        { label: "admission", request: null, tools: [tool] },
        ({ tools }) => {
          const execution = tools[0]!.execute({ safe: false });
          returnedPromise = execution instanceof Promise;
          return execution;
        },
      ),
    ).rejects.toThrow();
    expect(returnedPromise).toBe(true);
    expect(ran).toBe(false);
    expect(campaign.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "call-result",
    ]);
  });

  test("waits for detached tools and rejects late invocations", async () => {
    const campaign = createCampaign(database(), "test", null);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tool = defineTool({
      name: "effect",
      description: "Finish one effect",
      input: z.strictObject({}),
      async run() {
        await blocked;
        return { done: true };
      },
    });
    let retained: (() => Promise<unknown>) | undefined;
    const settlement = campaign.call(
      { label: "detached", request: null, tools: [tool] },
      async ({ tools }) => {
        retained = () => tools[0]!.execute({});
        void retained();
        return { runner: "done" };
      },
    );
    await Promise.resolve();
    expect(campaign.records().at(-1)?.kind).toBe("tool-call");
    expect(() => campaign.close()).toThrow("active calls");
    release();
    await settlement;
    await expect(retained!()).rejects.toThrow("no longer accepting");
    expect(campaign.records().at(-1)?.kind).toBe("call-result");
  });

  test("records thrown calls and tools, then rethrows", async () => {
    const campaign = createCampaign(database(), "test", null);
    const fail = defineTool({
      name: "fail",
      description: "Fail",
      input: z.strictObject({}),
      async run() {
        throw new Error("tool failed");
      },
    });
    await expect(
      campaign.call(
        { label: "failure", request: null, tools: [fail] },
        ({ tools }) => tools[0]!.execute({}),
      ),
    ).rejects.toThrow("tool failed");
    expect(
      campaign
        .records()
        .map((entry) => [
          entry.kind,
          "state" in entry ? entry.state : undefined,
        ]),
    ).toEqual([
      ["campaign", undefined],
      ["call", undefined],
      ["tool-call", undefined],
      ["tool-result", "threw"],
      ["call-result", "threw"],
    ]);
  });

  test("supports concurrent short-lived writers through SQLite transactions", () => {
    const path = database();
    const first = createCampaign(path, "test", null);
    const second = openCampaign(path);
    const material = new TextEncoder().encode("same");
    const candidate = first.submitCandidate(material, ["audit/v1"]);
    expect(second.submitCandidate(material, ["audit/v1"])).toBe(candidate);
    expect(
      first.records().filter((entry) => entry.kind === "candidate"),
    ).toHaveLength(1);
    first.close();
    second.close();
  });
});
