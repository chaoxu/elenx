import { expect, test } from "bun:test";

import { executionContract, executionReport } from "../execution-contract";

test("publishes the versioned run-manager contract", () => {
  expect(executionContract).toEqual({
    schemaVersion: 2,
    application: "elenx-solve",
    protocol: "exploration-v17",
    run: {
      command: "run",
      arguments: ["problem", "completionCriteria", "campaign", "settings"],
      report: {
        schemaVersion: 2,
        outcomes: [
          "solved",
          "paused",
          "call-failure",
          "interrupted",
          "index-limit",
        ],
        terminalOutcomes: ["solved", "index-limit"],
        terminalPhases: ["index-limit"],
      },
    },
  });
});

test("binds CLI reports to the execution contract", () => {
  expect(
    executionReport({ outcome: "solved", phase: "solved", candidate: 7 }),
  ).toEqual({
    schemaVersion: 2,
    application: "elenx-solve",
    protocol: "exploration-v17",
    outcome: "solved",
    phase: "solved",
    candidate: 7,
  });
});
