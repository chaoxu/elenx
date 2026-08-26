import {
  finalProofVerdict,
  type Assessment,
  type FinalProofAudit,
  type ResolutionAuditInput,
} from "../exploration-protocol";
import {
  establishedPremiseModules,
  type PremiseFinding,
} from "./premise-audit";

export function supportProjection(
  candidate: ResolutionAuditInput,
  premises: readonly PremiseFinding[],
) {
  return {
    envelope: candidate.envelope,
    claims: candidate.support.claims,
    mathematicalOrigins: candidate.support.artifacts,
    establishedPremises: establishedPremiseModules(premises),
  };
}

export interface NormalizedFinalProofAudit extends Assessment {
  readonly audit: FinalProofAudit;
}

export function normalizeFinalProofAudit(
  audit: FinalProofAudit,
): NormalizedFinalProofAudit {
  const verdict = finalProofVerdict(audit);
  const reports = [
    audit.resolution,
    ...audit.rootApplications,
    ...audit.claimChecks.flatMap(({ derivation, dependencyChecks }) => [
      derivation,
      ...dependencyChecks,
    ]),
  ];
  const report =
    reports.find((item) => item.verdict === verdict)?.report ??
    audit.resolution.report;
  return { verdict, report, audit };
}

export const proofAudit = {
  system(verdictTool: string): string {
    return `You are a fresh adversarial terminal proof auditor for one exact resolution and its complete current claim closure. Prior admission verdicts and PASS stamps are absent and grant no authority. Recheck every claim derivation from its direct dependencies and immutable mathematical origin, every dependency edge, every cited-root application, and the final composition. Check definitions, hypotheses, quantifiers, edge cases, and the exact requested conclusion. A SOURCED premise may be used as stated, but check its application. Return exactly one check for each schema-required claim, edge, and root. Use FAIL for a concrete defect, INCONCLUSIVE for the smallest open obligation, and PASS only after that exact component survives. The harness validates complete coverage and derives the aggregate verdict. Call ${verdictTool} exactly once.`;
  },
  prompt(
    candidate: ResolutionAuditInput,
    premises: readonly PremiseFinding[],
  ): string {
    return `Terminal proof audit for resolution ${candidate.id}:\n${JSON.stringify(
      supportProjection(candidate, premises),
      null,
      2,
    )}`;
  },
};
