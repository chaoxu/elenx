import { expect, test } from "bun:test";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import {
  piSubmissionGate,
  submissionContext,
  submissionFeedback,
} from "../../src/pi-submission";

const gate = {
  tool: "submit_result",
  completeArgument: "complete",
  reserveTokens: 2048,
};
const model = { contextWindow: 16_384, maxTokens: 4096 };
function response(tokens: number, timestamp = 1): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: "test",
    model: "test-v1",
    stopReason: "stop",
    timestamp,
    usage: {
      input: tokens - 100,
      output: 100,
      reasoning: 90,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: tokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
const occupied = (tokens: number): Context => ({
  messages: [response(tokens)],
});

test("the gate uses current occupancy rather than cumulative provider reasoning or repeated system text", () => {
  const state = submissionContext(gate, model, {
    systemPrompt: "Already counted system instructions.".repeat(100),
    messages: [
      response(91_000, 1),
      response(5000, 2),
      { role: "user", content: "12345678", timestamp: 3 },
    ],
  });
  expect(state).toEqual({
    tokens: 5002,
    threshold: 10_240,
    maxTokens: 4096,
    exhausted: false,
  });
  expect(
    submissionContext(gate, model, {
      messages: [{ role: "user", content: "abcd".repeat(100), timestamp: 1 }],
    }).tokens,
  ).toBeGreaterThan(0);
});

test("response caps preserve finalization headroom and report exhausted or unusable space", () => {
  expect(submissionContext(gate, model, occupied(10_230))).toMatchObject({
    maxTokens: 10,
    exhausted: false,
  });
  expect(submissionContext(gate, model, occupied(10_240))).toMatchObject({
    maxTokens: 2048,
    exhausted: false,
  });
  expect(submissionContext(gate, model, occupied(12_288))).toMatchObject({
    maxTokens: 1,
    exhausted: true,
  });
  expect(() =>
    submissionContext({ ...gate, reserveTokens: 12_288 }, model, occupied(100)),
  ).toThrow("leave no usable context");
  expect(
    piSubmissionGate.safeParse({ ...gate, reserveTokens: 0 }).success,
  ).toBe(false);
});

test("near the threshold feedback permits truthful partial work instead of demanding a solution claim", () => {
  expect(
    submissionFeedback(gate, submissionContext(gate, model, occupied(1000))),
  ).toStartWith("Submission declined.");
  expect(
    submissionFeedback(gate, submissionContext(gate, model, occupied(1000))),
  ).toContain("Continue working");
  expect(
    submissionFeedback(gate, submissionContext(gate, model, occupied(10_240))),
  ).toContain("otherwise false");
});
