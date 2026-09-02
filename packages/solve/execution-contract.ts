import type { RunResult } from "./runner";
import { applicationId, workflowProtocol } from "./roles";

export const workflowOutcomes = [
  "accepted",
  "refuted",
  "turn-limit",
  "paused",
  "call-failure",
  "interrupted",
] as const;

export const executionContract = {
  schemaVersion: 1,
  application: applicationId,
  protocol: workflowProtocol,
  run: {
    command: "run",
    arguments: ["task", "campaign", "settings"],
    report: {
      schemaVersion: 1,
      outcomes: workflowOutcomes,
      terminalOutcomes: ["accepted", "refuted", "turn-limit"],
    },
  },
} as const;

export type ExecutionContract = typeof executionContract;
export type ExecutionReport = RunResult & {
  readonly schemaVersion: 1;
  readonly application: typeof applicationId;
  readonly protocol: typeof workflowProtocol;
};

export function executionReport(report: RunResult): ExecutionReport {
  return {
    schemaVersion: executionContract.run.report.schemaVersion,
    application: applicationId,
    protocol: workflowProtocol,
    ...report,
  };
}
