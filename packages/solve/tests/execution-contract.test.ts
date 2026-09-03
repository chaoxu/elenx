import { expect, test } from "bun:test";

import { executionContract, executionReport } from "../execution-contract";

const note = {
  id: "n1",
  summary: "proof",
  text: "Proof.",
  support: [],
  verdicts: [],
  verified: true,
};

test("publishes one workflow execution contract", () => {
  expect(executionContract).toEqual({
    schemaVersion: 7,
    application: "elenx-solve",
    protocol: "workflow",
    run: {
      command: "run",
      arguments: ["task", "campaign", "settings"],
      report: {
        schemaVersion: 7,
        outcomes: [
          "accepted",
          "turn-limit",
          "paused",
          "call-failure",
          "interrupted",
        ],
        terminalOutcomes: ["accepted", "turn-limit"],
      },
    },
  });
  expect(
    executionReport({
      outcome: "accepted",
      turns: 1,
      note,
      notes: [note],
      candidate: 7,
    }),
  ).toMatchObject({
    schemaVersion: 7,
    application: "elenx-solve",
    protocol: "workflow",
    outcome: "accepted",
    candidate: 7,
  });
});
