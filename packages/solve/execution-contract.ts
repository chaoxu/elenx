import type { Report } from "./exploration";
import { applicationId, protocolName } from "./exploration-protocol";

export const executionContract = {
  schemaVersion: 3,
  application: applicationId,
  protocol: protocolName,
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
} as const;

export type ExecutionContract = typeof executionContract;

export type ExecutionReport = Report & {
  readonly schemaVersion: 3;
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
