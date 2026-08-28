import { expect, test } from "bun:test";

import { executionContract, executionReport } from "../execution-contract";

test("publishes the versioned run-manager contract", () => {
  expect(executionContract).toEqual({
    schemaVersion: 1,
    application: "elenx-solve",
    protocol: "exploration-v15",
    run: {
      command: "run",
      arguments: ["problem", "completionCriteria", "campaign", "settings"],
      report: {
        schemaVersion: 1,
        outcomes: ["solved", "paused", "call-failure", "interrupted"],
        terminalOutcomes: ["solved"],
        terminalPhases: ["repair-limit"],
      },
    },
  });
});

test("binds CLI reports to the execution contract", () => {
  expect(
    executionReport({ outcome: "solved", phase: "solved", candidate: 7 }),
  ).toEqual({
    schemaVersion: 1,
    application: "elenx-solve",
    protocol: "exploration-v15",
    outcome: "solved",
    phase: "solved",
    candidate: 7,
  });
});
