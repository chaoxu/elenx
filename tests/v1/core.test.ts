import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

import {
  createCampaign,
  defineTool,
  deriveCandidateStatus,
  finalizeVerdict,
  openReader,
  submitVerdictTool,
  type Tool,
  type ToolExecutionContext,
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
    expect(deriveCandidateStatus(campaign.records(), candidate)).toEqual({
      verified: false,
      missing: ["audit/v1", "compare/v1"],
      failed: [],
      passes: [],
    });

    const passSequences = [
      await pass(campaign, candidate, "audit/v1"),
      await pass(campaign, candidate, "compare/v1"),
    ];
    expect(deriveCandidateStatus(campaign.records(), candidate)).toEqual({
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
    expect(deriveCandidateStatus(campaign.records(), candidate)).toMatchObject({
      verified: false,
      missing: [],
      failed: ["audit/v1"],
    });
  });

  test("records each returned structured verdict exactly", async () => {
    for (const submitted of ["PASS", "FAIL", "INCONCLUSIVE"] as const) {
      const campaign = createCampaign(database(), "test", null);
      const candidate = campaign.submitCandidate(
        new TextEncoder().encode("claim"),
        ["audit/v1"],
      );
      const audit = await campaign.call(
        {
          label: "audit/v1",
          candidate,
          request: null,
          tools: [submitVerdictTool],
        },
        async ({ tools }) => {
          await tools[0]!.execute({
            verdict: submitted,
            evidence: { submitted },
          });
          return { state: "succeeded" };
        },
      );
      const verdict = finalizeVerdict(campaign, audit.call);
      expect(
        campaign.records().find((entry) => entry.seq === verdict),
      ).toMatchObject({
        kind: "verdict",
        verdict: submitted,
        evidence: { submitted },
      });
      expect(
        deriveCandidateStatus(campaign.records(), candidate).verified,
      ).toBe(submitted === "PASS");
    }
  });

  test("rejects unmatched or duplicate verdict submissions", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1"],
    );
    const mismatched = defineTool({
      ...submitVerdictTool,
      async run() {
        return null;
      },
    });
    const bad = await campaign.call(
      {
        label: "audit/v1",
        candidate,
        request: null,
        tools: [mismatched],
      },
      async ({ tools }) => {
        await tools[0]!.execute({ verdict: "PASS", evidence: null });
        return { state: "succeeded" };
      },
    );
    expect(() => finalizeVerdict(campaign, bad.call)).toThrow(
      "matching returned result",
    );

    const duplicate = await campaign.call(
      {
        label: "audit/v1",
        candidate,
        request: null,
        tools: [submitVerdictTool],
      },
      async ({ tools }) => {
        await tools[0]!.execute({ verdict: "PASS", evidence: null });
        await tools[0]!.execute({ verdict: "FAIL", evidence: null });
        return { state: "succeeded" };
      },
    );
    expect(() => finalizeVerdict(campaign, duplicate.call)).toThrow(
      "exactly one submission",
    );

    const throwing = defineTool({
      ...submitVerdictTool,
      async run() {
        throw new Error("submission failed");
      },
    });
    await expect(
      campaign.call(
        {
          label: "audit/v1",
          candidate,
          request: null,
          tools: [throwing],
        },
        ({ tools }) => tools[0]!.execute({ verdict: "PASS", evidence: null }),
      ),
    ).rejects.toThrow("submission failed");
    const thrown = campaign
      .records()
      .findLast((entry) => entry.kind === "call")!;
    expect(() => finalizeVerdict(campaign, thrown.seq)).toThrow(
      "matching returned result",
    );
  });

  test("requires a finished successful verifier call", async () => {
    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1"],
    );
    const empty = await campaign.call(
      {
        label: "audit/v1",
        candidate,
        request: null,
        tools: [submitVerdictTool],
      },
      async () => ({ state: "succeeded" }),
    );
    expect(() => finalizeVerdict(campaign, empty.call)).toThrow(
      "exactly one submission",
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = defineTool({
      ...submitVerdictTool,
      async run(input) {
        await blocked;
        return input;
      },
    });
    const audit = await campaign.call(
      {
        label: "audit/v1",
        candidate,
        request: null,
        tools: [delayed],
      },
      async ({ call, tools }) => {
        const pending = tools[0]!.execute({
          verdict: "PASS",
          evidence: null,
        });
        expect(() => finalizeVerdict(campaign, call)).toThrow(
          "matching returned result",
        );
        release();
        await pending;
        expect(() => finalizeVerdict(campaign, call)).toThrow(
          "fresh successful verifier call",
        );
        return { state: "succeeded" };
      },
    );
    finalizeVerdict(campaign, audit.call);
    expect(() => finalizeVerdict(campaign, audit.call)).toThrow();
    expect(
      campaign.records().filter((entry) => entry.kind === "verdict"),
    ).toHaveLength(1);
  });

  test("rejects failed, cancelled, and thrown verifier calls", async () => {
    for (const state of ["failed", "cancelled"] as const) {
      const campaign = createCampaign(database(), "test", null);
      const candidate = campaign.submitCandidate(
        new TextEncoder().encode("claim"),
        ["audit/v1"],
      );
      const audit = await campaign.call(
        {
          label: "audit/v1",
          candidate,
          request: null,
          tools: [submitVerdictTool],
        },
        async ({ tools }) => {
          await tools[0]!.execute({ verdict: "PASS", evidence: null });
          return { state };
        },
      );
      expect(() => finalizeVerdict(campaign, audit.call)).toThrow(
        "fresh successful verifier call",
      );
      expect(campaign.records().some((entry) => entry.kind === "verdict")).toBe(
        false,
      );
    }

    const campaign = createCampaign(database(), "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1"],
    );
    await expect(
      campaign.call(
        {
          label: "audit/v1",
          candidate,
          request: null,
          tools: [submitVerdictTool],
        },
        async ({ tools }) => {
          await tools[0]!.execute({ verdict: "PASS", evidence: null });
          throw new Error("outer failure");
        },
      ),
    ).rejects.toThrow("outer failure");
    const call = campaign.records().findLast((entry) => entry.kind === "call")!;
    expect(() => finalizeVerdict(campaign, call.seq)).toThrow(
      "fresh successful verifier call",
    );
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
    expect(deriveCandidateStatus(campaign.records(), candidate)).toMatchObject({
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
    expect(deriveCandidateStatus(campaign.records(), first).verified).toBe(
      true,
    );
    expect(deriveCandidateStatus(campaign.records(), second).verified).toBe(
      false,
    );

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
    expect(
      deriveCandidateStatus(campaign.records(), candidate).missing,
    ).toEqual(["audit/v1", "compare/v1"]);
  });

  test("records calls and tool effects before returning", async () => {
    const campaign = createCampaign(database(), "test", null);
    let executionContext: ToolExecutionContext | undefined;
    const add = defineTool({
      name: "add",
      description: "Add two integers",
      input: z.strictObject({
        left: z.number().int(),
        right: z.number().int(),
      }),
      replay: "safe",
      async run({ left, right }, context) {
        executionContext = context;
        return { sum: left + right };
      },
    });

    const receipt = await campaign.call(
      { label: "math", request: { prompt: "add" }, tools: [add] },
      async ({ request, tools }) => ({
        request,
        result: await tools[0]!.execute(
          { left: 2, right: 3 },
          "provider-add-1",
        ),
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
    expect(executionContext).toMatchObject({
      call: call.seq,
      toolCall: toolCall.seq,
      source: "provider-add-1",
    });
    expect(executionContext?.signal).toBeInstanceOf(AbortSignal);
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

  test("runs against the request snapshot stored with the call", async () => {
    const campaign = createCampaign(database(), "test", null);
    const request = { value: "before" };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = campaign.call(
      { label: "snapshot", request },
      async ({ request: recorded }) => {
        await blocked;
        return recorded;
      },
    );
    request.value = "after";
    release();

    expect((await running).output).toEqual({ value: "before" });
    expect(
      campaign.records().find((entry) => entry.kind === "call")?.request,
    ).toEqual({ value: "before" });
  });

  test("rejects invalid tool input through the promised interface", async () => {
    const campaign = createCampaign(database(), "test", null);
    let ran = false;
    let returnedPromise = false;
    const tool = defineTool({
      name: "restricted",
      description: "Accept only the declared input",
      input: z.strictObject({ safe: z.literal(true) }),
      replay: "safe",
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
      replay: "safe",
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

  test("handles a detached tool rejection on the promise it returns", () => {
    const path = database();
    const fixture = resolve("tests/v1/fixtures/detached-tool-rejection.ts");
    const child = Bun.spawnSync([process.execPath, fixture, path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);

    const reader = openReader(path);
    expect(reader.records().map(({ kind }) => kind)).toEqual([
      "campaign",
      "call",
      "tool-call",
      "tool-result",
      "call-result",
    ]);
    reader.close();
  });

  test("records thrown calls and tools, then rethrows", async () => {
    const campaign = createCampaign(database(), "test", null);
    const fail = defineTool({
      name: "fail",
      description: "Fail",
      input: z.strictObject({}),
      replay: "safe",
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

  test("rejects tools without an explicit replay-safe contract", async () => {
    const campaign = createCampaign(database(), "test", null);
    const unsafe = {
      name: "effect",
      description: "Unclassified effect",
      input: z.strictObject({}),
      async run() {
        return null;
      },
    } as unknown as Tool;

    await expect(
      campaign.call(
        { label: "unsafe", request: null, tools: [unsafe] },
        async () => null,
      ),
    ).rejects.toThrow();
    expect(campaign.records().map((entry) => entry.kind)).toEqual(["campaign"]);
  });
});
