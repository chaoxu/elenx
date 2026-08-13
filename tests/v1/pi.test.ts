import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";

import { createCampaign, defineTool } from "../../src";
import { runPi } from "../../src/pi";

type PiModels = Pick<Models, "streamSimple">;

const model: Model<Api> = {
  id: "test-v1",
  name: "Test",
  api: "openai-responses",
  provider: "fake",
  baseUrl: "https://invalid.test",
  reasoning: false,
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

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
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
  inspect?: (context: Context) => void,
): PiModels {
  let index = 0;
  return {
    streamSimple(_model, context) {
      inspect?.(context);
      const reply = replies[index++];
      if (reply === undefined) throw new Error("no scripted Pi reply");
      const stream = createAssistantMessageEventStream();
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
      return stream;
    },
  } as PiModels;
}

describe("thin Pi runner", () => {
  test("runs a fresh Pi loop and stores its native transcript", async () => {
    const store = campaign();
    const candidate = store.submitCandidate(
      new TextEncoder().encode("answer"),
      ["answer/v1"],
    );
    const result = await runPi(store, {
      models: models([assistant([{ type: "text", text: "answer" }], "stop")]),
      model,
      label: "answer/v1",
      candidate,
      system: "Answer exactly.",
      prompt: "Question",
    });

    expect(result).toMatchObject({ state: "succeeded", text: "answer" });
    const records = store.records();
    expect(records.map((entry) => entry.kind)).toEqual([
      "campaign",
      "candidate",
      "call",
      "call-result",
    ]);
    expect(records.find((entry) => entry.kind === "call")).toMatchObject({
      seq: result.call,
      candidate,
    });
    const terminal = records.at(-1);
    expect(terminal?.kind).toBe("call-result");
    if (terminal?.kind !== "call-result" || terminal.state !== "returned") {
      throw new Error("missing Pi result");
    }
    expect(terminal.output).toMatchObject({
      state: "succeeded",
      transcript: [{ role: "user" }, { role: "assistant" }],
    });
  });

  test("gives Pi only the selected audited Zod tools", async () => {
    const store = campaign();
    const contexts: Context[] = [];
    const add = defineTool({
      name: "add",
      description: "Add integers",
      input: z.strictObject({
        left: z.number().int(),
        right: z.number().int(),
      }),
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
        (context) => contexts.push(context),
      ),
      model,
      label: "math/v1",
      prompt: "Add 2 and 5",
      tools: [add],
    });

    expect(result).toMatchObject({ state: "succeeded", text: "7" });
    expect(contexts[0]?.tools).toMatchObject([
      {
        name: "add",
        constrainedSampling: { type: "json_schema", strict: "prefer" },
      },
    ]);
    expect(store.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "tool-call",
      "tool-result",
      "call-result",
    ]);
    expect(
      store.records().find((entry) => entry.kind === "tool-call"),
    ).toMatchObject({ source: "add-1", input: { left: 2, right: 5 } });
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
      models: models([assistant([], "error")]),
      model,
      label: "failure/v1",
      prompt: "Fail",
    });
    expect(failed.state).toBe("failed");

    const cancelled = await runPi(campaign(), {
      models: models([assistant([], "aborted")]),
      model,
      label: "cancel/v1",
      prompt: "Cancel",
    });
    expect(cancelled.state).toBe("cancelled");
  });
});
