import { type EntryId, type Json } from "elenx";

import { type Finding } from "./exploration-protocol";
import { type PremiseFinding } from "./verifiers/premise-audit";
import { type SourceResolution } from "./verifiers/source-check";

interface FailingVerdict {
  readonly mode: string;
  readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly report: string;
}

// These values become finding and report bytes in later calls and journal
// evidence. The fold and call-surface golden share these exact renderers.
export function mechanicalFinding(
  goal: string,
  gap: {
    readonly report?: boolean;
    readonly unverified: readonly {
      readonly id: string;
      readonly standing: string;
    }[];
    readonly cyclic: boolean;
  },
): Finding {
  const reasons: string[] = [];
  if (gap.report === true) {
    reasons.push("the declared note is a process report, not a claim");
  }
  if (gap.unverified.length > 0) {
    reasons.push(`unverified ancestors: ${JSON.stringify(gap.unverified)}`);
  }
  if (gap.cyclic) reasons.push("the declared note sits on a dependency cycle");
  return {
    text: `Goal declaration for note ${goal} was rejected before verification.\n\nBlocking gaps:\n${reasons.join("\n")}`,
    basedOn: [],
    basedOnFindings: [],
  };
}

export function batteryFinding(
  candidate: EntryId,
  goal: string,
  failing: readonly FailingVerdict[],
): Finding {
  const quoted = failing.map(({ mode, verdict, report }) => ({
    mode,
    verdict,
    report,
  }));
  return {
    text: `Goal candidate ${candidate} for note ${goal} failed boundary verification.\n\nFailing verdicts:\n${JSON.stringify(quoted, null, 2)}`,
    basedOn: [],
    basedOnFindings: [],
  };
}

export function defectReport(report: string, details: unknown): string {
  return `${report}\n\nExact blocking findings:\n${JSON.stringify(details, null, 2)}`;
}

export type RejectionSubject = "note" | "candidate";

export function offlinePremiseRejection(
  subject: RejectionSubject,
  details: unknown,
): string {
  return defectReport(
    `Offline premise verification rejected the ${subject}.`,
    details,
  );
}

export function sourceVerificationRejection(
  subject: RejectionSubject,
  details: unknown,
): string {
  return defectReport(`Source verification rejected the ${subject}.`, details);
}

export function premiseRepairFindings(
  findings: readonly PremiseFinding[],
): Json[] {
  const selected: Json[] = [];
  for (const finding of findings) {
    if (finding.standing === "REFUTED") {
      selected.push({
        statement: finding.statement,
        standing: finding.standing,
        refutation: finding.refutation,
      });
    }
    if (finding.standing === "MISAPPLIED") {
      selected.push({
        statement: finding.statement,
        standing: finding.standing,
        defect: finding.defect,
      });
    }
  }
  return selected;
}

export function sourceRepairFindings(
  resolutions: readonly SourceResolution[],
): Json[] {
  const selected: Json[] = [];
  for (const resolution of resolutions) {
    if (resolution.standing === "REFUTED") {
      selected.push({
        statement: resolution.statement,
        standing: resolution.standing,
        refutation: resolution.refutation,
      });
    }
    if (resolution.standing === "MISAPPLIED") {
      selected.push({
        statement: resolution.statement,
        standing: resolution.standing,
        defect: resolution.defect,
      });
    }
    if (resolution.standing === "UNRESOLVED") {
      selected.push({
        statement: resolution.statement,
        standing: resolution.standing,
        gap: resolution.gap,
      });
    }
    if (
      resolution.standing === "SOURCED" &&
      resolution.candidateCitationMatch === "MISMATCH"
    ) {
      selected.push({
        statement: resolution.statement,
        standing: "CITATION_MISMATCH",
        defect: resolution.candidateCitationCheck,
      });
    }
  }
  return selected;
}
