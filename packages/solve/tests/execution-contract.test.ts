import { expect, test } from "bun:test";

import {
  executionContract,
  executionReport,
  trialExecutionReport,
} from "../execution-contract";
import type { TrialResult } from "../roles";

test("run and trial publish one workflow contract", () => {
  expect(executionContract).toMatchObject({
    schemaVersion: 4,
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    run: {
      command: "run",
      report: {
        outcomes: [
          "solved",
          "paused",
          "call-failure",
          "interrupted",
          "turn-limit",
        ],
      },
    },
    trial: {
      command: "trial",
      application: "elenx-solve-roles",
      protocol: "role-calls.v2",
    },
  });
  expect(
    executionReport({ outcome: "solved", phase: "solved", candidate: 7 }),
  ).toMatchObject({
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "solved",
    candidate: 7,
  });
});

test("trial reports bind terminal answers to durable candidates", () => {
  const proof = { id: "n1", summary: "proof", text: "Proof." };
  const accepted: TrialResult = {
    outcome: "accepted",
    turns: 1,
    answer: proof,
    verifier: { verdict: "ACCEPT", report: "Correct." },
    notes: [proof],
  };
  expect(trialExecutionReport(accepted, 7)).toMatchObject({
    outcome: "accepted",
    candidate: 7,
    candidateKind: "solution",
  });
  expect(() => trialExecutionReport(accepted)).toThrow("durable candidate");
  const limited: TrialResult = {
    outcome: "turn-limit",
    turns: 2,
    notes: [proof],
  };
  expect(trialExecutionReport(limited)).toMatchObject({
    outcome: "turn-limit",
    phase: "turn-limit",
  });
});
