import { roleApplication, roleProtocol, type TrialResult } from "./roles";
import type { RunReport } from "./workflow";

export const executionContract = {
  schemaVersion: 4,
  application: roleApplication,
  protocol: roleProtocol,
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
        "turn-limit",
      ],
      terminalOutcomes: ["solved", "turn-limit"],
      terminalPhases: ["turn-limit"],
    },
  },
  trial: {
    command: "trial",
    arguments: ["trial", "campaign", "settings"],
    application: roleApplication,
    protocol: roleProtocol,
    inputSchemaVersion: 1,
    settingsSchemaVersion: 1,
    report: {
      schemaVersion: 1,
      outcomes: ["accepted", "refuted", "turn-limit"],
      terminalOutcomes: ["accepted", "refuted", "turn-limit"],
      terminalPhases: [],
    },
  },
} as const;

export type ExecutionContract = typeof executionContract;
export type ExecutionReport = RunReport & {
  readonly schemaVersion: 3;
  readonly application: typeof roleApplication;
  readonly protocol: typeof roleProtocol;
};

type TrialExecutionReportBase = {
  readonly schemaVersion: 1;
  readonly application: typeof roleApplication;
  readonly protocol: typeof roleProtocol;
};

export type TrialExecutionReport =
  | (Extract<TrialResult, { readonly outcome: "accepted" }> &
      TrialExecutionReportBase & {
        readonly phase: "accepted";
        readonly candidate: number;
        readonly candidateKind: "solution";
      })
  | (Extract<TrialResult, { readonly outcome: "refuted" }> &
      TrialExecutionReportBase & {
        readonly phase: "refuted";
        readonly candidate: number;
        readonly candidateKind: "refutation";
      })
  | (Extract<TrialResult, { readonly outcome: "turn-limit" }> &
      TrialExecutionReportBase & {
        readonly phase: "turn-limit";
      });

export function executionReport(report: RunReport): ExecutionReport {
  return {
    schemaVersion: executionContract.run.report.schemaVersion,
    application: roleApplication,
    protocol: roleProtocol,
    ...report,
  };
}

export function trialExecutionReport(
  report: TrialResult,
  candidate?: number,
): TrialExecutionReport {
  const base = {
    schemaVersion: 1,
    application: roleApplication,
    protocol: roleProtocol,
  } as const;
  if (report.outcome === "turn-limit") {
    if (candidate !== undefined) {
      throw new Error("unresolved trial cannot name a candidate");
    }
    return { ...base, ...report, phase: "turn-limit" };
  }
  if (
    candidate === undefined ||
    !Number.isSafeInteger(candidate) ||
    candidate <= 0
  ) {
    throw new Error("terminal trial has no durable candidate");
  }
  if (report.verifier.verdict !== "ACCEPT") {
    throw new Error("terminal trial has no accepting verifier result");
  }
  return report.outcome === "accepted"
    ? {
        ...base,
        ...report,
        phase: "accepted",
        candidate,
        candidateKind: "solution",
      }
    : {
        ...base,
        ...report,
        phase: "refuted",
        candidate,
        candidateKind: "refutation",
      };
}
