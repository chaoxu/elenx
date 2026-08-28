import type { Report } from "./exploration";
import { applicationId, protocolName } from "./exploration-protocol";

export const executionContract = {
  schemaVersion: 1,
  application: applicationId,
  protocol: protocolName,
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
} as const;

export type ExecutionContract = typeof executionContract;

export type ExecutionReport = Report & {
  readonly schemaVersion: 1;
  readonly application: typeof applicationId;
  readonly protocol: typeof protocolName;
};

export function executionReport(report: Report): ExecutionReport {
  return {
    schemaVersion: executionContract.run.report.schemaVersion,
    application: executionContract.application,
    protocol: executionContract.protocol,
    ...report,
  };
}
