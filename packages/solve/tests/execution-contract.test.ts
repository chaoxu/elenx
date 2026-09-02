import { expect, test } from "bun:test";

import { executionContract, executionReport } from "../execution-contract";

test("publishes one workflow execution contract", () => {
  expect(executionContract).toEqual({
    schemaVersion: 1,
    application: "elenx-solve",
    protocol: "workflow",
    run: {
      command: "run",
      arguments: ["task", "campaign", "settings"],
      report: {
        schemaVersion: 1,
        outcomes: [
          "accepted",
          "refuted",
          "turn-limit",
          "paused",
          "call-failure",
          "interrupted",
        ],
        terminalOutcomes: ["accepted", "refuted", "turn-limit"],
      },
    },
  });
  expect(
    executionReport({
      outcome: "accepted",
      turns: 1,
      answer: { id: "n1", summary: "proof", text: "Proof." },
      verifier: { verdict: "ACCEPT", report: "checked" },
      notes: [{ id: "n1", summary: "proof", text: "Proof." }],
      candidate: 7,
      candidateKind: "solution",
    }),
  ).toMatchObject({
    schemaVersion: 1,
    application: "elenx-solve",
    protocol: "workflow",
    outcome: "accepted",
    candidate: 7,
  });
});
