import { entryIdSchema, type EntryId } from "elenx";
import { z } from "zod";

import {
  assessment,
  type Assessment,
  type ResolutionAuditInput,
} from "../exploration-protocol";

export const nonblankText = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "must contain non-whitespace text",
  });
export const premiseApplication = {
  application: z.enum(["APPLIES", "MISAPPLIED"]),
  applicationCheck: nonblankText,
};
const premiseStatement = nonblankText;
export const nonEllipsizedQuote = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "must contain non-whitespace text",
  })
  .refine((value) => !value.includes("...") && !value.includes("…"), {
    message: "must be one contiguous verbatim quote without ellipses",
  });
export const givenPremise = z.strictObject({
  statement: premiseStatement,
  standing: z.literal("GIVEN"),
  problemQuote: nonblankText,
  ...premiseApplication,
});
export const provedPremise = z.strictObject({
  statement: premiseStatement,
  standing: z.literal("PROVED"),
  proof: nonblankText,
  supportCall: entryIdSchema,
  refutationAttempt: nonblankText,
  ...premiseApplication,
});
export const refutedPremise = z.strictObject({
  statement: premiseStatement,
  standing: z.literal("REFUTED"),
  refutation: nonblankText,
});
export const unestablishedPremise = z.strictObject({
  statement: premiseStatement,
  standing: z.literal("UNESTABLISHED"),
  refutationAttempt: nonblankText,
  gap: nonblankText,
  ...premiseApplication,
});
export const sourcedPremise = z.strictObject({
  statement: premiseStatement,
  standing: z.literal("SOURCED"),
  citation: nonblankText,
  url: z.httpUrl(),
  locator: nonblankText,
  exactQuote: nonEllipsizedQuote,
  sourceMatch: nonblankText,
  candidateSourceMatch: z.enum(["NONE", "MATCH", "MISMATCH"]),
  candidateSourceCheck: nonblankText,
  refutationAttempt: nonblankText,
  ...premiseApplication,
});
export const offlinePremiseFinding = z.discriminatedUnion("standing", [
  givenPremise,
  provedPremise,
  refutedPremise,
  unestablishedPremise,
]);
export type OfflinePremiseFinding = z.output<typeof offlinePremiseFinding>;
export const premiseFinding = z.discriminatedUnion("standing", [
  givenPremise,
  provedPremise,
  refutedPremise,
  unestablishedPremise,
  sourcedPremise,
]);
export type PremiseFinding = z.output<typeof premiseFinding>;

export const premiseSubmission = assessment
  .omit({ verdict: true })
  .extend({ premises: z.array(premiseFinding) });
export type PremiseSubmission = z.output<typeof premiseSubmission>;

export interface PremiseProofSupport {
  readonly call: EntryId;
  readonly artifact: unknown;
}

export interface PremiseBindingIssue {
  readonly field: "problemQuote" | "supportCall" | "proof";
  readonly message: string;
}

export function premiseBindingIssue(
  problem: string,
  artifacts: ReadonlyMap<EntryId, unknown>,
  premise: OfflinePremiseFinding,
): PremiseBindingIssue | undefined {
  if (premise.standing === "GIVEN") {
    return problem.includes(premise.problemQuote)
      ? undefined
      : {
          field: "problemQuote",
          message: "problemQuote must occur verbatim in the problem",
        };
  }
  if (premise.standing !== "PROVED") return undefined;
  const artifact = artifacts.get(premise.supportCall);
  if (artifact === undefined) {
    return {
      field: "supportCall",
      message: "supportCall must belong to this claim's exact support",
    };
  }
  return containsText(artifact, premise.proof)
    ? undefined
    : {
        field: "proof",
        message: "proof must occur verbatim in the named support artifact",
      };
}

export function premiseSubmissionFor(
  problem: string,
  proofSupport: readonly PremiseProofSupport[],
) {
  const artifacts = new Map(
    proofSupport.map(({ call, artifact }) => [call, artifact]),
  );
  return assessment
    .omit({ verdict: true })
    .extend({ premises: z.array(offlinePremiseFinding) })
    .superRefine(({ premises }, context) => {
      for (const [index, premise] of premises.entries()) {
        const issue = premiseBindingIssue(problem, artifacts, premise);
        if (issue === undefined) continue;
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: ["premises", index, issue.field],
        });
      }
    });
}
export type OfflinePremiseSubmission = z.output<
  ReturnType<typeof premiseSubmissionFor>
>;

interface PremiseVerdictInput {
  readonly standing: PremiseFinding["standing"];
  readonly application?: "APPLIES" | "MISAPPLIED";
  readonly candidateSourceMatch?: "NONE" | "MATCH" | "MISMATCH";
}

export function premiseVerdictFor(
  premises: readonly PremiseVerdictInput[],
): Assessment["verdict"] {
  if (
    premises.some(
      (premise) =>
        premise.standing === "REFUTED" ||
        premise.application === "MISAPPLIED" ||
        (premise.standing === "SOURCED" &&
          premise.candidateSourceMatch === "MISMATCH"),
    )
  ) {
    return "FAIL";
  }
  return premises.some(({ standing }) => standing === "UNESTABLISHED")
    ? "INCONCLUSIVE"
    : "PASS";
}

export function premiseDefectsForCoordinator(
  premises: readonly OfflinePremiseFinding[],
): unknown[] {
  const defects: unknown[] = [];
  for (const premise of premises) {
    if (premise.standing === "REFUTED") {
      defects.push({
        statement: premise.statement,
        standing: premise.standing,
        refutation: premise.refutation,
      });
      continue;
    }
    if (premise.standing === "UNESTABLISHED") {
      defects.push({
        statement: premise.statement,
        standing: premise.standing,
        gap: premise.gap,
        ...(premise.application === "MISAPPLIED"
          ? {
              application: premise.application,
              applicationCheck: premise.applicationCheck,
            }
          : {}),
      });
      continue;
    }
    if (premise.application === "MISAPPLIED") {
      defects.push({
        statement: premise.statement,
        standing: premise.standing,
        application: premise.application,
        applicationCheck: premise.applicationCheck,
      });
      continue;
    }
  }
  return defects;
}

export function premiseOutcomesForCoordinator(
  premises: readonly PremiseFinding[],
): unknown[] {
  return premises.flatMap((premise) => {
    const misapplied =
      premise.standing !== "REFUTED" && premise.application === "MISAPPLIED";
    const sourceMismatch = isCandidateSourceMismatch(premise);
    return premise.standing === "REFUTED" ||
      premise.standing === "UNESTABLISHED" ||
      misapplied ||
      sourceMismatch
      ? [
          {
            statement: premise.statement,
            standing: premise.standing,
            ...(misapplied ? { application: premise.application } : {}),
            ...(sourceMismatch
              ? { candidateSourceMatch: premise.candidateSourceMatch }
              : {}),
          },
        ]
      : [];
  });
}

function isCandidateSourceMismatch(premise: PremiseFinding): premise is Extract<
  PremiseFinding,
  { readonly standing: "SOURCED" }
> & {
  readonly candidateSourceMatch: "MISMATCH";
} {
  return (
    premise.standing === "SOURCED" &&
    premise.candidateSourceMatch === "MISMATCH"
  );
}

export function establishedPremiseModules(
  premises: readonly PremiseFinding[],
): unknown[] {
  const modules: unknown[] = [];
  for (const premise of premises) {
    if (premise.standing === "PROVED") {
      modules.push({
        standing: premise.standing,
        statement: premise.statement,
        proof: premise.proof,
      });
      continue;
    }
    if (premise.standing === "SOURCED") {
      modules.push({
        standing: premise.standing,
        statement: premise.statement,
      });
    }
  }
  return modules;
}

export const premiseAuditInstruction =
  "Inventory the smallest set of non-routine open premises used by the artifact. Omit its conclusion, unused material, routine definitions and axioms, and steps correctly derived from earlier premises. If a derivation fails, inventory its smallest unsupported or false step. GIVEN requires an exact problem quote. PROVED requires a complete proof already present verbatim in an allowed support artifact; return that proof and its call. A theorem name, citation, familiarity, prior audit, or proof invented during this audit does not establish a premise. A newly found proof leaves the unchanged artifact UNESTABLISHED. Try to refute each non-given premise and check its hypotheses and application. Use REFUTED for a decisive error and UNESTABLISHED when neither proof nor refutation succeeds. An empty inventory is valid when no open premise remains.";

export const premiseAudit = {
  system(verdictTool: string): string {
    return `You are a fresh premise auditor for one exact proposed resolution. ${premiseAuditInstruction} Put a newly found proof in report as repair material. The resolution's new argument is allowed support. Circular use of the requested conclusion is UNESTABLISHED. The harness derives FAIL from a refuted or misapplied premise, INCONCLUSIVE from an unestablished premise, and PASS otherwise. Call ${verdictTool} exactly once with the complete inventory; do not choose the verdict.`;
  },
  prompt(candidate: ResolutionAuditInput) {
    return `Resolution candidate ${candidate.id} without prior audit stamps. The exact new argument is envelope.newArgument, and its allowed PROVED supportCall is envelope.sourceReport (${candidate.envelope.sourceReport}). Other allowed support calls are the call fields in support.artifacts:\n${JSON.stringify(candidate, null, 2)}`;
  },
};

function containsText(value: unknown, text: string): boolean {
  if (typeof value === "string") return value.includes(text);
  if (Array.isArray(value))
    return value.some((item) => containsText(item, text));
  return value !== null && typeof value === "object"
    ? Object.values(value).some((item) => containsText(item, text))
    : false;
}
