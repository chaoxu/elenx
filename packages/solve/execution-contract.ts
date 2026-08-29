import type { Report } from "./exploration";
import { applicationId, protocolName } from "./exploration-protocol";

export const executionContract = {
  schemaVersion: 2,
  application: applicationId,
  protocol: protocolName,
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
} as const;

export type ExecutionContract = typeof executionContract;

export type ExecutionReport = Report & {
  readonly schemaVersion: 2;
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
