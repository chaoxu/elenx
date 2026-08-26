import { z } from "zod";

import {
  assessment,
  claimIdSchema,
  routeIdSchema,
  type Assessment,
  type ClaimId,
  type ClaimSupportBundle,
  type RouteId,
} from "../exploration-protocol";
import {
  givenPremise,
  premiseAuditInstruction,
  premiseBindingIssue,
  premiseVerdictFor,
  provedPremise,
  refutedPremise,
  unestablishedPremise,
} from "./premise-audit";

export const claimPremiseFinding = z.discriminatedUnion("standing", [
  givenPremise,
  provedPremise,
  refutedPremise,
  unestablishedPremise,
]);
export type ClaimPremiseFinding = z.output<typeof claimPremiseFinding>;
export type ClaimPremiseInventory = readonly ClaimPremiseFinding[];

const claimAssessment = z.strictObject({
  claim: claimIdSchema,
  report: z.string().min(1),
  mathematicalFinding: z.string().min(1).optional(),
  premises: z.array(claimPremiseFinding),
});
const routeAssessment = assessment.extend({ route: routeIdSchema });
const admissionAssessment = z.union([claimAssessment, routeAssessment]);

export type AdmissionTarget =
  | {
      readonly kind: "claim";
      readonly id: ClaimId;
      readonly statement: string;
      readonly supportCalls: readonly number[];
    }
  | {
      readonly kind: "route";
      readonly id: RouteId;
      readonly attempt: string;
      readonly outcome: string;
      readonly evidenceClaims: readonly ClaimId[];
      readonly retryCondition?: string | undefined;
      readonly originCall: number;
    };

export function admissionAuditDescription(
  targets: readonly AdmissionTarget[],
): string {
  const allowed = Object.fromEntries(
    targets.flatMap((target) =>
      target.kind === "claim" ? [[target.id, target.supportCalls]] : [],
    ),
  );
  return `Audit every changed claim and route. Allowed PROVED support calls by claim: ${JSON.stringify(allowed)}`;
}

export function admissionAuditSystem(tool: string): string {
  return `You are a fresh admission auditor for one atomic batch. Explorer nominations are advisory rather than an exact target schema. A coordinator may extract packet-grounded material and may link a route to a claim created earlier in the same batch when the source packet supports both; check semantic accuracy rather than nomination-field equality. For each claim: ${premiseAuditInstruction} Put any newly discovered proof, refutation, or derivation that may support a repaired claim in mathematicalFinding as standalone mathematical text; keep audit status and commentary in report. A conditional result must state its hypotheses inside the exact implication; there is no assumed standing. The harness derives each claim verdict from its premise inventory. For each route, check that its attempt, outcome, scope, referenced claims, and retry condition accurately reflect the source packet. A source packet given as a string reference is byte-identical to the support artifact carrying the same call id. A route PASS grants no mathematical proof standing. Report the smallest defect or the check performed. Call ${tool} exactly once with every supplied claim and route and no others.`;
}

export function admissionAuditSubmissionFor(
  problem: string,
  targets: readonly AdmissionTarget[],
  support: ClaimSupportBundle,
) {
  const expected = new Map(targets.map((target) => [target.id, target]));
  if (expected.size === 0 || expected.size !== targets.length) {
    throw new Error("admission audit targets must be nonempty and unique");
  }
  const artifacts = new Map(
    support.artifacts.map(({ call, artifact }) => [call, artifact]),
  );
  return z
    .strictObject({
      assessments: z.array(admissionAssessment).length(expected.size),
    })
    .superRefine(({ assessments }, context) => {
      const issue = (message: string, path: PropertyKey[]) =>
        context.addIssue({ code: "custom", message, path });
      const ids = assessments.map((item) =>
        "claim" in item ? item.claim : item.route,
      );
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== expected.size ||
        ids.some((id) => !expected.has(id))
      ) {
        issue("audit must assess every exact target exactly once", [
          "assessments",
        ]);
      }
      for (const [position, item] of assessments.entries()) {
        const id = "claim" in item ? item.claim : item.route;
        const target = expected.get(id);
        if (target === undefined) continue;
        if ((target.kind === "claim") !== "premises" in item) {
          issue(
            target.kind === "claim"
              ? "claim requires a premise inventory"
              : "route requires a direct verdict",
            ["assessments", position],
          );
          continue;
        }
        if (target.kind !== "claim" || !("premises" in item)) continue;
        const allowedArtifacts = new Map(
          target.supportCalls.flatMap((call) => {
            const artifact = artifacts.get(call);
            return artifact === undefined ? [] : [[call, artifact] as const];
          }),
        );
        for (const [premisePosition, premise] of item.premises.entries()) {
          const binding = premiseBindingIssue(
            problem,
            allowedArtifacts,
            premise,
          );
          if (binding !== undefined) {
            issue(binding.message, [
              "assessments",
              position,
              "premises",
              premisePosition,
              binding.field,
            ]);
          }
        }
      }
    });
}

export type AdmissionAuditSubmission = z.output<
  ReturnType<typeof admissionAuditSubmissionFor>
>;

export interface AdmissionAuditAssessment extends Assessment {
  readonly target: ClaimId | RouteId;
  readonly targetKind: "claim" | "route";
  readonly premises?: ClaimPremiseInventory;
  readonly mathematicalFinding?: string;
}

export function normalizeAdmissionAuditSubmission(
  submission: AdmissionAuditSubmission,
): { readonly assessments: readonly AdmissionAuditAssessment[] } {
  return {
    assessments: submission.assessments.map((item) =>
      "premises" in item
        ? {
            target: item.claim,
            targetKind: "claim" as const,
            report: item.report,
            ...(item.mathematicalFinding === undefined
              ? {}
              : { mathematicalFinding: item.mathematicalFinding }),
            premises: item.premises,
            verdict: premiseVerdictFor(item.premises),
          }
        : {
            target: item.route,
            targetKind: "route" as const,
            verdict: item.verdict,
            report: item.report,
          },
    ),
  };
}
