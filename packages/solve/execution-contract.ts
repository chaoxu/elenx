import type { RunResult } from "./runner";
import { applicationId, workflowProtocol } from "./roles";
import { workflowSchemaVersion } from "./workflow";

export const workflowOutcomes = [
  "accepted",
  "turn-limit",
  "paused",
  "call-failure",
  "interrupted",
] as const;

export const executionContract = {
  schemaVersion: workflowSchemaVersion,
  application: applicationId,
  protocol: workflowProtocol,
  run: {
    command: "run",
    arguments: ["task", "campaign", "settings"],
    report: {
      schemaVersion: workflowSchemaVersion,
      outcomes: workflowOutcomes,
      terminalOutcomes: ["accepted", "turn-limit"],
    },
  },
} as const;

export type ExecutionContract = typeof executionContract;
export type ExecutionReport = RunResult & {
  readonly schemaVersion: typeof workflowSchemaVersion;
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
