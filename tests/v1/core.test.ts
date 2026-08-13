import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

import { createCampaign, defineTool, openReader } from "../../src";

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
): Promise<number> {
  const call = await campaign.call(
    { label: verifier, candidate, request: {} },
    async ({ request }) => ({ state: "succeeded", checked: request }),
  );
  return campaign.recordVerdict(call.call, "PASS", {
    reason: "checked",
  });
}

describe("small kernel", () => {
  test("persists exact candidate material for a fresh reader", () => {
    const path = database();
    const campaign = createCampaign(path, "test", { version: 1 });
    const material = new TextEncoder().encode("proof");
    const candidate = campaign.submitCandidate(material, ["audit/v1"]);
    material.fill(0);
    campaign.close();

    const reader = openReader(path);
    const candidateRecord = reader
      .records()
      .find((entry) => entry.kind === "candidate");
    expect(candidateRecord?.seq).toBe(candidate);
    const stored = reader.material(candidate);
    expect(new TextDecoder().decode(stored)).toBe("proof");
    stored.fill(0);
    expect(new TextDecoder().decode(reader.material(candidate))).toBe("proof");
    reader.close();
  });

  test("derives verification from fresh successful verdicts", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1", "compare/v1"],
    );
    expect(campaign.status(candidate)).toEqual({
      verified: false,
      missing: ["audit/v1", "compare/v1"],
      failed: [],
      passes: [],
    });

    const passSequences = [
      await pass(campaign, candidate, "audit/v1"),
      await pass(campaign, candidate, "compare/v1"),
    ];
    expect(campaign.status(candidate)).toEqual({
      verified: true,
      missing: [],
      failed: [],
      passes: passSequences,
    });

    const late = await campaign.call(
      { label: "audit/v1", candidate, request: {} },
      async () => ({ state: "succeeded", result: "late counterexample" }),
    );
    campaign.recordVerdict(late.call, "FAIL", null);
    expect(campaign.status(candidate)).toMatchObject({
      verified: false,
      missing: [],
      failed: ["audit/v1"],
    });
  });

  test("rejects a call that guessed a future candidate sequence", async () => {
    const campaign = createCampaign(database(), "test", null);
    const call = await campaign.call(
      { label: "audit/v1", candidate: 4, request: {} },
      async () => ({ state: "succeeded" }),
    );
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1"],
    );
    expect(candidate).toBe(4);
    expect(() => campaign.recordVerdict(call.call, "PASS", null)).toThrow(
      "fresh successful",
    );
  });

  test("rejects verdicts from failed protocol results and reused calls", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1", "compare/v1"],
    );
    const failed = await campaign.call(
      { label: "audit/v1", candidate, request: {} },
      async () => ({ state: "failed", error: "provider failed" }),
    );
    expect(() => campaign.recordVerdict(failed.call, "PASS", null)).toThrow(
      "fresh successful",
    );

    const passed = await campaign.call(
      { label: "audit/v1", candidate, request: {} },
      async () => ({ state: "succeeded" }),
    );
    campaign.recordVerdict(passed.call, "PASS", null);
    expect(() => campaign.recordVerdict(passed.call, "PASS", null)).toThrow();
  });

  test("keeps candidates unverified on missing or failed verification", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1", "compare/v1"],
    );
    const failed = await campaign.call(
      { label: "audit/v1", candidate, request: {} },
      async () => ({ state: "succeeded", result: "counterexample" }),
    );
    campaign.recordVerdict(failed.call, "FAIL", null);
    await pass(campaign, candidate, "compare/v1");
    expect(campaign.status(candidate)).toMatchObject({
      verified: false,
      missing: ["audit/v1"],
      failed: ["audit/v1"],
    });
  });

  test("keeps identical submissions and their verifier calls independent", async () => {
    const campaign = createCampaign(database(), "test", null);
    const material = new TextEncoder().encode("claim");
    const first = campaign.submitCandidate(material, ["audit/v1"]);
    const second = campaign.submitCandidate(material, ["audit/v1"]);
    expect(second).not.toBe(first);
    await pass(campaign, first, "audit/v1");
    expect(campaign.status(first).verified).toBe(true);
    expect(campaign.status(second).verified).toBe(false);

    const wrongVerifier = await campaign.call(
      { label: "other/v1", candidate: second, request: {} },
      async () => ({ state: "succeeded" }),
    );
    expect(() =>
      campaign.recordVerdict(wrongVerifier.call, "PASS", null),
    ).toThrow("fresh successful");
  });

  test("normalizes verifier sets", () => {
    const campaign = createCampaign(database(), "test", null);
    const material = new TextEncoder().encode("claim");
    const candidate = campaign.submitCandidate(material, [
      "compare/v1",
      "audit/v1",
      "compare/v1",
    ]);
    expect(campaign.status(candidate).missing).toEqual([
      "audit/v1",
      "compare/v1",
    ]);
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
    const records = campaign.records();
    expect(records.map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "tool-call",
      "tool-result",
      "call-result",
    ]);
    const call = records.find((entry) => entry.kind === "call")!;
    const toolCall = records.find((entry) => entry.kind === "tool-call")!;
    expect(receipt.call).toBe(call.seq);
    expect(
      records.some(
        (entry) =>
          entry.kind === "tool-result" && entry.parent === toolCall.seq,
      ),
    ).toBe(true);
    expect(
      records.some(
        (entry) => entry.kind === "call-result" && entry.parent === call.seq,
      ),
    ).toBe(true);
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
});
