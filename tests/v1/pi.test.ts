import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type Models,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple as streamSimpleOpenAIResponses } from "@earendil-works/pi-ai/api/openai-responses";

import { createCampaign, defineTool, openReader, type Entry } from "../../src";
import {
  PI_TELEMETRY_SCHEMA_VERSIONS,
  derivePiSpend,
  piRequest,
  piRequestAttempts,
  piStoredResult,
  piTelemetry,
  runPi,
} from "../../src/pi";

type PiModels = Pick<Models, "streamSimple">;

const model: Model<"openai-responses"> = {
  id: "test-v1",
  name: "Test",
  api: "openai-responses",
  provider: "fake",
  baseUrl: "https://invalid.test",
  reasoning: true,
  thinkingLevelMap: { max: "max" },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

function campaign() {
  const directory = mkdtempSync(join(tmpdir(), "elenx-pi-"));
  directories.push(directory);
  return createCampaign(join(directory, "campaign.db"), "pi-test", null);
}

function spendEntries(
  attributes: Record<string, string | number | boolean>,
  error = false,
): Entry[] {
  return [
    {
      seq: 1,
      atMs: 1,
      kind: "campaign",
      application: "test",
      config: null,
    },
    {
      seq: 2,
      atMs: 2,
      kind: "call",
      label: "test/v1",
      request: {
        model: { provider: "fake", id: "test-v1", api: "openai-responses" },
        prompt: "test",
      },
      tools: [],
    },
    {
      seq: 3,
      atMs: 3,
      kind: "call-result",
      parent: 2,
      state: "returned",
      output: {
        state: "succeeded",
        text: "done",
        telemetry: {
          schemaVersions: PI_TELEMETRY_SCHEMA_VERSIONS,
          spans: [
            {
              id: 1,
              parentId: null,
              name: "elenx.pi.run",
              attributes: {},
              events: [],
              status: { status: "ok" },
              settled: true,
            },
            {
              id: 2,
              parentId: 1,
              name: "pi.ai.request",
              attributes,
              events: [],
              status: error
                ? { status: "error", error: { name: "Error", message: "x" } }
                : { status: "ok" },
              settled: true,
            },
          ],
        },
      },
    },
  ];
}

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  reasoning?: number,
  measured = true,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    responseModel: "served-test-v1",
    usage: measured
      ? {
          input: 11,
          output: 7,
          cacheRead: 5,
          cacheWrite: 0,
          ...(reasoning === undefined ? {} : { reasoning }),
          totalTokens: 23,
          cost: {
            input: 0.011,
            output: 0.014,
            cacheRead: 0.001,
            cacheWrite: 0,
            total: 0.026,
          },
        }
      : {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
    stopReason,
    timestamp: 1,
  };
}

function models(
  replies: readonly AssistantMessage[],
  inspect?: (
    context: Context,
    options: SimpleStreamOptions | undefined,
  ) => void,
): PiModels {
  let index = 0;
  return {
    streamSimple(requestModel, context, options) {
      inspect?.(context, options);
      const reply = replies[index++];
      if (reply === undefined) throw new Error("no scripted Pi reply");
      const stream = createAssistantMessageEventStream();
      void (async () => {
        await options?.onPayload?.(
          { model: requestModel.id, context },
          requestModel,
        );
        if (reply.stopReason === "error" || reply.stopReason === "aborted") {
          stream.push({
            type: "error",
            reason: reply.stopReason,
            error: reply,
          });
        } else if (reply.stopReason !== "pending") {
          stream.push({
            type: "done",
            reason: reply.stopReason,
            message: reply,
          });
        } else {
          throw new Error("pending is not a terminal Pi event");
        }
      })();
      return stream;
    },
  } as PiModels;
}

function payloadModels(
  replies: readonly AssistantMessage[],
  payloads: readonly unknown[],
  sent: unknown[],
): PiModels {
  let index = 0;
  return {
    streamSimple(requestModel, _context, options) {
      const turn = index++;
      const reply = replies[turn];
      if (reply === undefined) throw new Error("no scripted Pi reply");
      const stream = createAssistantMessageEventStream();
      void (async () => {
        const payload = payloads[turn];
        const replacement = await options?.onPayload?.(payload, requestModel);
        sent.push(replacement === undefined ? payload : replacement);
        stream.push({
          type: "done",
          reason: reply.stopReason as "stop" | "toolUse",
          message: reply,
        });
      })();
      return stream;
    },
  } as PiModels;
}

function invalidPayloadModels(calls: number): PiModels {
  return {
    streamSimple(requestModel, _context, options) {
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          for (let index = 0; index < calls; index++) {
            await options?.onPayload?.({ index }, requestModel);
          }
          const reply = assistant([{ type: "text", text: "done" }], "stop");
          stream.push({ type: "done", reason: "stop", message: reply });
        } catch (error) {
          const reply = {
            ...assistant([], "error", undefined, false),
            errorMessage:
              error instanceof Error ? error.message : String(error),
          };
          stream.push({ type: "error", reason: "error", error: reply });
        }
      })();
      return stream;
    },
  } as PiModels;
}

describe("thin Pi runner", () => {
  test("treats complete zero usage as measured and rejects partial usage", () => {
    const attributes = {
      "pi.ai.provider": "fake",
      "pi.ai.model": "test-v1",
      "pi.ai.api": "openai-responses",
      "pi.ai.response.stop_reason": "error",
      "pi.ai.usage.input_tokens": 0,
      "pi.ai.usage.output_tokens": 0,
      "pi.ai.usage.cache_read_tokens": 0,
      "pi.ai.usage.cache_write_tokens": 0,
      "pi.ai.usage.total_tokens": 0,
      "pi.ai.usage.cost": 0,
    };
    expect(derivePiSpend(spendEntries(attributes, true)).summary).toEqual({
      logicalProviderRequests: 1,
      requestErrors: 1,
      unmeasuredRequests: 0,
      measuredUsage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    });
    const { "pi.ai.usage.cost": _cost, ...partial } = attributes;
    expect(() => derivePiSpend(spendEntries(partial))).toThrow(
      "partial Pi usage measurement",
    );
    expect(() =>
      derivePiSpend(
        spendEntries({
          "pi.ai.provider": "fake",
          "pi.ai.model": "test-v1",
          "pi.ai.api": "openai-responses",
          "pi.ai.usage.reasoning_tokens": 1,
        }),
      ),
    ).toThrow("partial Pi usage measurement");
    expect(() =>
      derivePiSpend(spendEntries(attributes), {
        call: 2,
        candidate: 3,
      } as never),
    ).toThrow("either call or candidate");
  });

  test("runs a fresh Pi loop and stores its native transcript", async () => {
    const store = campaign();
    const requests: (SimpleStreamOptions | undefined)[] = [];
    const candidate = store.submitCandidate(
      new TextEncoder().encode("answer"),
      ["answer/v1"],
    );
    const result = await runPi(store, {
      models: models(
        [assistant([{ type: "text", text: "answer" }], "stop", 3)],
        (_context, options) => requests.push(options),
      ),
      model,
      label: "answer/v1",
      candidate,
      system: "Answer exactly.",
      prompt: "Question",
      reasoning: "max",
    });

    expect(result).toMatchObject({ state: "succeeded", text: "answer" });
    expect(requests.map((options) => options?.reasoning)).toEqual(["max"]);
    const [runSpan, requestSpan] = result.telemetry.spans;
    expect(runSpan).toMatchObject({
      name: "elenx.pi.run",
      parentId: null,
      settled: true,
      status: { status: "ok" },
      attributes: {
        "elenx.call.label": "answer/v1",
        "elenx.candidate": candidate,
        "elenx.pi.reasoning.requested": "max",
        "elenx.pi.outcome": "succeeded",
      },
    });
    expect(requestSpan).toMatchObject({
      name: "pi.ai.request",
      parentId: runSpan?.id,
      settled: true,
      status: { status: "ok" },
      attributes: {
        "pi.ai.operation": "stream",
        "pi.ai.provider": model.provider,
        "pi.ai.model": model.id,
        "pi.ai.response.model": "served-test-v1",
        "pi.ai.response.stop_reason": "stop",
        "pi.ai.usage.input_tokens": 11,
        "pi.ai.usage.output_tokens": 7,
        "pi.ai.usage.cache_read_tokens": 5,
        "pi.ai.usage.reasoning_tokens": 3,
        "pi.ai.usage.total_tokens": 23,
        "pi.ai.usage.cost": 0.026,
      },
    });
    const records = store.records();
    expect(records.map((entry) => entry.kind)).toEqual([
      "campaign",
      "candidate",
      "call",
      "call",
      "call-result",
      "call-result",
    ]);
    const call = records.find((entry) => entry.kind === "call");
    expect(call).toMatchObject({
      seq: result.call,
      candidate,
      request: { reasoning: "max" },
    });
    if (call?.kind !== "call") throw new Error("missing Pi call");
    expect(piRequest.parse(call.request)).toMatchObject({ reasoning: "max" });
    const terminal = records.at(-1);
    expect(terminal?.kind).toBe("call-result");
    if (terminal?.kind !== "call-result" || terminal.state !== "returned") {
      throw new Error("missing Pi result");
    }
    expect(terminal.output).toMatchObject({
      state: "succeeded",
      transcript: [{ role: "user" }, { role: "assistant" }],
      telemetry: result.telemetry,
    });
    expect(piStoredResult.parse(terminal.output)).toMatchObject({
      state: "succeeded",
      text: "answer",
      telemetry: result.telemetry,
    });
    expect(piTelemetry.safeParse(result.telemetry).success).toBe(true);
    const spend = derivePiSpend(records, { candidate });
    expect(spend).toMatchObject({
      calls: [
        {
          call: result.call,
          logicalProviderRequests: 1,
          requestErrors: 0,
          unmeasuredRequests: 0,
          operations: [
            {
              provider: "fake",
              requestedModel: "test-v1",
              servedModel: "served-test-v1",
              api: "openai-responses",
              stopReason: "stop",
              error: false,
              usage: {
                input: 11,
                output: 7,
                cacheRead: 5,
                cacheWrite: 0,
                reasoning: 3,
                totalTokens: 23,
                estimatedCostUsd: 0.026,
              },
            },
          ],
        },
      ],
      unaccountedCalls: [],
      potentialRequests: [],
      summary: {
        logicalProviderRequests: 1,
        requestErrors: 0,
        unmeasuredRequests: 0,
        measuredUsage: { totalTokens: 23, reasoning: 3 },
      },
    });
    expect(derivePiSpend(records, { call: result.call })).toEqual(spend);
    expect(
      piStoredResult.safeParse({
        state: "succeeded",
        text: "answer",
        telemetry: {},
      }).success,
    ).toBe(false);
  });

  test("gives Pi only the selected audited Zod tools", async () => {
    const store = campaign();
    const contexts: Context[] = [];
    const reasoning: (SimpleStreamOptions["reasoning"] | undefined)[] = [];
    const add = defineTool({
      name: "add",
      description: "Add integers",
      input: z.strictObject({
        left: z.number().int(),
        right: z.number().int(),
      }),
      replay: "safe",
      async run({ left, right }) {
        return { sum: left + right };
      },
    });
    const result = await runPi(store, {
      models: models(
        [
          assistant(
            [
              {
                type: "toolCall",
                id: "add-1",
                name: "add",
                arguments: { left: 2, right: 5 },
              },
            ],
            "toolUse",
          ),
          assistant([{ type: "text", text: "7" }], "stop"),
        ],
        (context, options) => {
          contexts.push(context);
          reasoning.push(options?.reasoning);
        },
      ),
      model,
      label: "math/v1",
      prompt: "Add 2 and 5",
      reasoning: "max",
      tools: [add],
    });

    expect(result).toMatchObject({ state: "succeeded", text: "7" });
    const requests = result.telemetry.spans.filter(
      ({ name }) => name === "pi.ai.request",
    );
    expect(requests).toHaveLength(2);
    expect(reasoning).toEqual(["max", "max"]);
    expect(
      requests.every(
        ({ attributes }) => !("pi.ai.usage.reasoning_tokens" in attributes),
      ),
    ).toBe(true);
    expect(
      requests.every(
        ({ parentId }) => parentId === result.telemetry.spans[0]?.id,
      ),
    ).toBe(true);
    expect(contexts[0]?.tools).toMatchObject([
      {
        name: "add",
        constrainedSampling: { type: "json_schema", strict: "prefer" },
      },
    ]);
    expect(store.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "call",
      "call-result",
      "tool-call",
      "tool-result",
      "call",
      "call-result",
      "call-result",
    ]);
    expect(
      store.records().find((entry) => entry.kind === "tool-call"),
    ).toMatchObject({ source: "add-1", input: { left: 2, right: 5 } });
    expect(derivePiSpend(store.records()).summary).toEqual({
      logicalProviderRequests: 2,
      requestErrors: 0,
      unmeasuredRequests: 0,
      measuredUsage: {
        input: 22,
        output: 14,
        cacheRead: 10,
        cacheWrite: 0,
        totalTokens: 46,
        estimatedCostUsd: 0.052,
      },
    });
  });

  test("reconstructs every adapter-expanded request from durable checkpoints", async () => {
    const store = campaign();
    const payloads = [
      {
        instructions: "Use the adder.",
        input: [{ role: "user", content: "Add 2 and 5" }],
        tools: [{ name: "add", strict: true }],
        reasoning: { effort: "high" },
        prompt_cache_key: undefined,
      },
      {
        instructions: "Use the adder.",
        input: [
          { role: "user", content: "Add 2 and 5" },
          { type: "function_call", call_id: "add-1" },
          { type: "function_call_output", output: '{"sum":7}' },
        ],
        tools: [{ name: "add", strict: true }],
        reasoning: { effort: "high" },
      },
    ];
    const sent: unknown[] = [];
    const add = defineTool({
      name: "add",
      description: "Add integers",
      input: z.strictObject({
        left: z.number().int(),
        right: z.number().int(),
      }),
      replay: "safe",
      async run({ left, right }) {
        return { sum: left + right };
      },
    });

    const result = await runPi(store, {
      models: payloadModels(
        [
          assistant(
            [
              {
                type: "toolCall",
                id: "add-1",
                name: "add",
                arguments: { left: 2, right: 5 },
              },
            ],
            "toolUse",
          ),
          assistant([{ type: "text", text: "7" }], "stop"),
        ],
        payloads,
        sent,
      ),
      model,
      label: "checkpoint/v1",
      system: "Use the adder.",
      prompt: "Add 2 and 5",
      reasoning: "max",
      tools: [add],
    });

    expect(sent).toEqual(payloads);
    const attempts = piRequestAttempts(store.records(), result.call);
    expect(attempts.map(({ payload }) => payload)).toEqual(
      JSON.parse(JSON.stringify(payloads)),
    );
    expect(attempts.map(({ call }) => call)).toEqual([3, 7]);
    expect(attempts.map(({ state }) => state)).toEqual([
      "completed",
      "completed",
    ]);
    expect(store.records().map(({ kind }) => kind)).toEqual([
      "campaign",
      "call",
      "call",
      "call-result",
      "tool-call",
      "tool-result",
      "call",
      "call-result",
      "call-result",
    ]);
  });

  test("keeps a pre-dispatch payload after a hard provider crash", () => {
    const directory = mkdtempSync(join(tmpdir(), "elenx-pi-crash-"));
    directories.push(directory);
    const path = join(directory, "campaign.db");
    const fixture = resolve("tests/v1/fixtures/crash-pi-request.ts");
    const child = Bun.spawnSync([process.execPath, fixture, path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    const reader = openReader(path);
    const records = reader.records();
    expect(records.map(({ kind }) => kind)).toEqual([
      "campaign",
      "call",
      "call",
      "call-result",
    ]);
    expect(piRequestAttempts(records)).toMatchObject([
      {
        parent: 2,
        call: 3,
        payload: { input: "durable request" },
        state: "completed",
      },
    ]);
    expect(derivePiSpend(records)).toMatchObject({
      calls: [],
      unaccountedCalls: [2],
      potentialRequests: [
        {
          call: 2,
          checkpoint: 3,
          model: {
            provider: "fake",
            id: "crash-test",
            api: "openai-responses",
          },
        },
      ],
      summary: {
        logicalProviderRequests: 0,
        requestErrors: 0,
        unmeasuredRequests: 0,
      },
    });
    reader.close();
  });

  test("rejects adapters that omit or repeat the pre-send hook", async () => {
    for (const calls of [0, 2]) {
      const store = campaign();
      await expect(
        runPi(store, {
          models: invalidPayloadModels(calls),
          model,
          label: `invalid-hook/${calls}`,
          prompt: "Test adapter contract",
        }),
      ).rejects.toThrow("exactly once");
      expect(piRequestAttempts(store.records())).toHaveLength(
        calls === 0 ? 0 : 1,
      );
    }
  });

  test("allows an adapter to fail before it constructs a payload", async () => {
    const store = campaign();
    const preflightFailure: PiModels = {
      streamSimple() {
        const stream = createAssistantMessageEventStream();
        const failure = {
          ...assistant([], "error", undefined, false),
          errorMessage: "missing credentials",
        };
        stream.push({ type: "error", reason: "error", error: failure });
        return stream;
      },
    };
    const result = await runPi(store, {
      models: preflightFailure,
      model,
      label: "preflight-failure/v1",
      prompt: "Test adapter preflight",
    });

    expect(result).toMatchObject({
      state: "failed",
      error: "missing credentials",
    });
    expect(piRequestAttempts(store.records())).toEqual([]);
  });

  test("projects completed and unsettled request attempts", async () => {
    const store = campaign();
    let release!: () => void;
    let observed: ReturnType<typeof piRequestAttempts> = [];
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await store.call(
      {
        label: "owner",
        request: {
          model: { provider: model.provider, id: model.id, api: model.api },
          prompt: "test",
        },
      },
      async ({ call }) => {
        const request = {
          protocol: "pi" as const,
          parent: call,
          model: { provider: model.provider, id: model.id, api: model.api },
          payload: { input: "test" },
        };
        await store.call(
          { label: "elenx/pi-request", request },
          async () => null,
        );
        const pending = store.call(
          { label: "elenx/pi-request", request },
          async () => {
            await blocked;
            return null;
          },
        );
        await Promise.resolve();
        observed = piRequestAttempts(store.records(), call);
        release();
        await pending;
        return null;
      },
    );

    expect(observed.map(({ state }) => state)).toEqual([
      "completed",
      "unsettled",
    ]);
  });

  test("checkpoints the real Pi OpenAI adapter before a stub transport", async () => {
    const store = campaign();
    let fetches = 0;
    const stubFetch: typeof fetch = Object.assign(
      async (..._args: Parameters<typeof fetch>): Promise<Response> => {
        fetches += 1;
        throw new Error("stub transport stopped here");
      },
      { preconnect: fetch.preconnect },
    );
    const adapter: PiModels = {
      streamSimple(_requestModel, context, options) {
        return streamSimpleOpenAIResponses(model, context, {
          ...options,
          apiKey: "stub-key",
          maxRetries: 0,
          fetch: stubFetch,
        });
      },
    };
    const result = await runPi(store, {
      models: adapter,
      model,
      label: "real-adapter/v1",
      system: "Answer briefly.",
      prompt: "Test",
      reasoning: "max",
    });

    expect(result.state).toBe("failed");
    expect(fetches).toBe(1);
    expect(piRequestAttempts(store.records(), result.call)).toMatchObject([
      {
        parent: result.call,
        model: {
          provider: model.provider,
          id: model.id,
          api: model.api,
        },
        payload: {
          model: model.id,
          stream: true,
          input: [
            { role: "developer", content: "Answer briefly." },
            {
              role: "user",
              content: [{ type: "input_text", text: "Test" }],
            },
          ],
          reasoning: { effort: "max" },
        },
        state: "completed",
      },
    ]);
  });

  test("keeps concurrent Pi request checkpoints under their own calls", async () => {
    const store = campaign();
    const results = await Promise.all(
      ["first", "second"].map((name) =>
        runPi(store, {
          models: models([assistant([{ type: "text", text: name }], "stop")]),
          model,
          label: `concurrent/${name}`,
          prompt: name,
        }),
      ),
    );
    const first = results[0]!;
    const second = results[1]!;

    expect(first.text).toBe("first");
    expect(second.text).toBe("second");
    expect(piRequestAttempts(store.records(), first.call)).toHaveLength(1);
    expect(piRequestAttempts(store.records(), second.call)).toHaveLength(1);
  });

  test("can stop after a successful structured tool result", async () => {
    const store = campaign();
    const submit = defineTool({
      name: "submit",
      description: "Submit one answer",
      input: z.strictObject({ answer: z.number().int() }),
      replay: "safe",
      async run(input) {
        return input;
      },
    });
    let requests = 0;
    const result = await runPi(store, {
      models: models(
        [
          assistant(
            [
              {
                type: "toolCall",
                id: "submit-1",
                name: "submit",
                arguments: { answer: 7 },
              },
            ],
            "toolUse",
          ),
        ],
        () => {
          requests += 1;
        },
      ),
      model,
      label: "structured/v1",
      prompt: "Submit 7",
      tools: [submit],
      stopAfterToolResult: true,
    });

    expect(result).toMatchObject({ state: "succeeded", text: "" });
    expect(requests).toBe(1);
    expect(result.transcript).toMatchObject([
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult" },
    ]);
    expect(
      store.records().find((entry) => entry.kind === "call"),
    ).toMatchObject({ request: { stopAfterToolResult: true } });
  });

  test("does not accept a terminal tool result after cancellation", async () => {
    const controller = new AbortController();
    const submit = defineTool({
      name: "submit",
      description: "Submit one answer",
      input: z.strictObject({ answer: z.number().int() }),
      replay: "safe",
      async run(input) {
        controller.abort();
        return input;
      },
    });
    const result = await runPi(campaign(), {
      models: models([
        assistant(
          [
            {
              type: "toolCall",
              id: "submit-1",
              name: "submit",
              arguments: { answer: 7 },
            },
          ],
          "toolUse",
        ),
      ]),
      model,
      label: "structured/v1",
      prompt: "Submit 7",
      tools: [submit],
      stopAfterToolResult: true,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ state: "cancelled" });
  });

  test("does not accept incomplete Pi completions as successful", async () => {
    for (const stopReason of ["length", "deferred", "toolUse"] as const) {
      const store = campaign();
      const result = await runPi(store, {
        models: models([
          assistant([{ type: "text", text: "PASS" }], stopReason),
        ]),
        model,
        label: "audit/v1",
        prompt: "Audit",
      });
      expect(result).toMatchObject({
        state: "failed",
        error: `Pi stopped with ${stopReason}`,
      });
    }
  });

  test("preserves Pi failure and cancellation states", async () => {
    const failed = await runPi(campaign(), {
      models: models([assistant([], "error", undefined, false)]),
      model,
      label: "failure/v1",
      prompt: "Fail",
    });
    expect(failed.state).toBe("failed");
    expect(
      failed.telemetry.spans.every(({ status }) => status.status === "error"),
    ).toBe(true);
    const failedRequest = failed.telemetry.spans.find(
      ({ name }) => name === "pi.ai.request",
    );
    expect(
      failedRequest === undefined
        ? undefined
        : Object.hasOwn(failedRequest.attributes, "pi.ai.usage.total_tokens"),
    ).toBe(false);

    const cancelled = await runPi(campaign(), {
      models: models([assistant([], "aborted", undefined, false)]),
      model,
      label: "cancel/v1",
      prompt: "Cancel",
    });
    expect(cancelled.state).toBe("cancelled");
    expect(
      cancelled.telemetry.spans.every(
        ({ status }) => status.status === "error",
      ),
    ).toBe(true);
    const cancelledRequest = cancelled.telemetry.spans.find(
      ({ name }) => name === "pi.ai.request",
    );
    expect(
      cancelledRequest === undefined
        ? undefined
        : Object.hasOwn(
            cancelledRequest.attributes,
            "pi.ai.usage.total_tokens",
          ),
    ).toBe(false);
  });
});
