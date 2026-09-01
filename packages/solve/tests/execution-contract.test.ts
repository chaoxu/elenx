import { expect, test } from "bun:test";

import {
  executionContract,
  executionReport,
  trialExecutionReport,
} from "../execution-contract";
import type { TrialResult } from "../roles";

test("publishes the versioned run-manager contract", () => {
  expect(executionContract).toEqual({
    schemaVersion: 4,
    application: "elenx-solve",
    protocol: "exploration-v17",
    run: {
      command: "run",
      arguments: ["problem", "completionCriteria", "campaign", "settings"],
      report: {
        schemaVersion: 3,
        outcomes: [
          "solved",
          "paused",
          "call-failure",
          "interrupted",
          "context-limit",
          "index-limit",
          "turn-limit",
        ],
        terminalOutcomes: [
          "solved",
          "context-limit",
          "index-limit",
          "turn-limit",
        ],
        terminalPhases: ["context-limit", "index-limit", "turn-limit"],
      },
    },
    trial: {
      command: "trial",
      arguments: ["trial", "campaign", "settings"],
      application: "elenx-solve-roles",
      protocol: "role-calls.v2",
      inputSchemaVersion: 1,
      settingsSchemaVersion: 1,
      report: {
        schemaVersion: 1,
        outcomes: ["accepted", "refuted", "turn-limit"],
        terminalOutcomes: ["accepted", "refuted", "turn-limit"],
        terminalPhases: [],
      },
    },
  });
});

test("binds CLI reports to the execution contract", () => {
  expect(
    executionReport({ outcome: "solved", phase: "solved", candidate: 7 }),
  ).toEqual({
    schemaVersion: 3,
    application: "elenx-solve",
    protocol: "exploration-v17",
    outcome: "solved",
    phase: "solved",
    candidate: 7,
  });
});

test("binds role-trial reports to their durable candidate", () => {
  const proof = { id: "n1", summary: "proof", text: "Proof." };
  const result: TrialResult = {
    outcome: "accepted",
    turns: 1,
    answer: proof,
    verifier: { verdict: "ACCEPT", report: "Correct." },
    notes: [proof],
  };
  expect(trialExecutionReport(result, 7)).toEqual({
    schemaVersion: 1,
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "accepted",
    phase: "accepted",
    turns: 1,
    candidate: 7,
    candidateKind: "solution",
    answer: proof,
    verifier: { verdict: "ACCEPT", report: "Correct." },
    notes: [proof],
  });
  expect(() => trialExecutionReport(result)).toThrow("durable candidate");
  expect(() => trialExecutionReport(result, 0)).toThrow("durable candidate");
  expect(() =>
    trialExecutionReport(
      {
        ...result,
        verifier: { verdict: "REJECT", report: "Gap." },
      },
      7,
    ),
  ).toThrow("accepting verifier");

  const refutation: TrialResult = {
    outcome: "refuted",
    turns: 2,
    refutation: proof,
    verifier: { verdict: "ACCEPT", report: "Counterexample checked." },
    notes: [proof],
  };
  expect(trialExecutionReport(refutation, 9)).toMatchObject({
    outcome: "refuted",
    phase: "refuted",
    candidate: 9,
    candidateKind: "refutation",
  });

  const unresolved: TrialResult = {
    outcome: "turn-limit",
    turns: 3,
    notes: [proof],
    lastVerifierResult: { verdict: "REJECT", report: "Still incomplete." },
  };
  expect(trialExecutionReport(unresolved)).toEqual({
    schemaVersion: 1,
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "turn-limit",
    phase: "turn-limit",
    turns: 3,
    notes: [proof],
    lastVerifierResult: { verdict: "REJECT", report: "Still incomplete." },
  });
  expect(() => trialExecutionReport(unresolved, 11)).toThrow(
    "cannot name a candidate",
  );
});
