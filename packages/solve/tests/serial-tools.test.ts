import { expect, test } from "bun:test";

import type { PiRunOptions } from "elenx/pi";

import { withSerialToolCalls } from "../serial-tools";
import type { SolveModels } from "../solve";

const platformModel: PiRunOptions["model"] = {
  id: "gpt-platform-test",
  name: "Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://pool.test/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};
const codexModel: PiRunOptions["model"] = {
  ...platformModel,
  id: "gpt-codex-test",
  api: "openai-codex-responses",
  provider: "openai-codex",
};
const foreignModel: PiRunOptions["model"] = {
  ...platformModel,
  id: "foreign-test",
  api: "anthropic-messages",
  provider: "anthropic",
};

function fakeModels(observed: { options?: unknown }): SolveModels {
  return {
    getModel(provider, id) {
      return [platformModel, codexModel, foreignModel].find(
        (model) => model.provider === provider && model.id === id,
      );
    },
    streamSimple(_model, _context, options) {
      observed.options = options;
      throw new Error("stream not exercised");
    },
  };
}

async function observedRewrite(
  model: PiRunOptions["model"],
  payload: unknown,
): Promise<unknown> {
  const observed: { options?: unknown } = {};
  const models = withSerialToolCalls(fakeModels(observed));
  expect(() =>
    models.streamSimple(
      model,
      { messages: [] },
      {
        onPayload: async (sent) => sent,
      },
    ),
  ).toThrow("stream not exercised");
  const options = observed.options as {
    onPayload?: (payload: unknown, model: unknown) => Promise<unknown>;
  };
  return options.onPayload!(payload, model);
}

test("openai platform payloads require one serial terminal tool", async () => {
  expect(
    await observedRewrite(platformModel, { model: "m", tools: [{}] }),
  ).toEqual({
    model: "m",
    tools: [{}],
    tool_choice: "required",
    parallel_tool_calls: false,
  });
});

test("payloads without tools stay untouched", async () => {
  expect(await observedRewrite(platformModel, { model: "m" })).toEqual({
    model: "m",
  });
});

test("empty tool declarations are never required", async () => {
  expect(
    await observedRewrite(platformModel, { model: "m", tools: [] }),
  ).toEqual({ model: "m", tools: [], parallel_tool_calls: false });
});

test("codex payloads have parallel_tool_calls forced to false", async () => {
  expect(
    await observedRewrite(codexModel, {
      model: "m",
      tools: [{}],
      parallel_tool_calls: true,
    }),
  ).toEqual({
    model: "m",
    tools: [{}],
    tool_choice: "required",
    parallel_tool_calls: false,
  });
});

test("getModel passes through unchanged", () => {
  const observed: { options?: unknown } = {};
  const models = withSerialToolCalls(fakeModels(observed));
  expect(models.getModel("openai", "gpt-platform-test")).toBe(platformModel);
});

test("non-openai APIs stream with untouched options", () => {
  const observed: { options?: unknown } = {};
  const models = withSerialToolCalls(fakeModels(observed));
  expect(() => models.streamSimple(foreignModel, { messages: [] }, {})).toThrow(
    "stream not exercised",
  );
  expect(observed.options).toEqual({});
});
