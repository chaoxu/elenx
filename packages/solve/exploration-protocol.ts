import { type Entry } from "elenx";
import { piReasoning } from "elenx/pi";
import { z } from "zod";

export const applicationId = "elenx-solve";
export const protocolName = "exploration-v17";
// The file tests/fixtures/call-surfaces/<callSurface>.json pins the exact
// structured call identity for this stamp. The updater refuses to replace an
// existing file, so changed prompt or schema bytes require a new stamp.
export const callSurface =
  "certified-statements-durable-control-budgeted-bundle-reconstruction";

const modelProfile = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoning: piReasoning,
});
const runtimeProfile = modelProfile.extend({
  api: z.string().min(1),
  baseUrl: z.string().min(1),
});
const sourceProfile = z.strictObject({
  model: z.string().min(1),
  reasoning: piReasoning,
});
const positiveInteger = z.number().int().positive();
const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});
const userGuidance = z.array(nonblank);
const guidanceModule = z.strictObject({
  origin: z.enum(["default", "user"]),
  text: nonblank,
});
const noteId = z.string().regex(/^n[1-9][0-9]*$/u);

export const reconstructionGuide = z.strictObject({
  keyIdeas: z
    .array(nonblank)
    .describe(
      "High-level mathematical ideas that orient an independent reconstruction without giving a stepwise paraphrase of the finding's proof.",
    ),
  allowedSources: z
    .array(nonblank)
    .describe(
      "Exact external results or sources that the finding itself invokes and that reconstruction may use. Empty when the finding is self-contained.",
    ),
});
export type ReconstructionGuide = z.output<typeof reconstructionGuide>;

function noteIdIn(ids: readonly string[], message: string) {
  const known = new Set(ids);
  return noteId.refine((value) => known.has(value), { message });
}

const boundsRefinement = (
  {
    maxContextTokens,
    maxIndexTokens,
  }: {
    maxContextTokens: number;
    maxIndexTokens: number;
  },
  ctx: z.RefinementCtx,
) => {
  if (maxIndexTokens > maxContextTokens) {
    ctx.addIssue({
      code: "custom",
      message: "maxIndexTokens cannot exceed maxContextTokens",
      path: ["maxIndexTokens"],
    });
  }
};

export const settingsSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    maxContextTokens: positiveInteger.default(200_000),
    maxIndexTokens: positiveInteger.default(100_000),
    maxExplorerTurns: positiveInteger.default(50),
    explorerGuidance: userGuidance.default([]),
    explorer: modelProfile,
    curator: modelProfile,
    triage: modelProfile,
    verifier: modelProfile,
    sourceChecker: sourceProfile,
  })
  .superRefine(boundsRefinement);
export type Settings = z.output<typeof settingsSchema>;

export const taskSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    callSurface: z.literal(callSurface),
    problem: nonblank,
    completionCriteria: nonblank,
    maxContextTokens: positiveInteger,
    maxIndexTokens: positiveInteger,
    maxExplorerTurns: positiveInteger,
    guidance: z.array(guidanceModule),
    explorer: runtimeProfile,
    curator: runtimeProfile,
    triage: runtimeProfile,
    verifier: runtimeProfile,
    sourceChecker: sourceProfile,
  })
  .superRefine(boundsRefinement);
export type Task = z.output<typeof taskSchema>;
export type ModelProfile = z.output<typeof modelProfile>;
export type RuntimeProfile = z.output<typeof runtimeProfile>;
export type SourceProfile = z.output<typeof sourceProfile>;
export type GuidanceModule = z.output<typeof guidanceModule>;

type CampaignDeclaration = Extract<Entry, { kind: "campaign" }>;

export function parseCampaign(declaration: Entry | undefined): {
  readonly declaration: CampaignDeclaration;
  readonly task: Task;
} {
  if (
    declaration?.kind !== "campaign" ||
    declaration.application !== applicationId
  ) {
    throw new Error(`not an ${applicationId} campaign`);
  }
  const parsed = taskSchema.safeParse(declaration.config);
  if (!parsed.success) {
    const declaredProtocol =
      declaration.config !== null &&
      typeof declaration.config === "object" &&
      !Array.isArray(declaration.config) &&
      "protocol" in declaration.config
        ? declaration.config.protocol
        : undefined;
    if (declaredProtocol === protocolName) {
      throw new Error(
        `invalid ${applicationId} ${protocolName} campaign config: ${parsed.error.message}`,
      );
    }
    throw new Error(
      `unsupported ${applicationId} protocol: ${String(declaredProtocol)}`,
    );
  }
  return { declaration, task: parsed.data };
}

// ---------------------------------------------------------------------------
// Explorer turn
//
// The explorer is a pure reasoner with exactly one output: findings. Results,
// failed attempts, and open questions alike, as self-contained free text with
// optional basedOn references to the notes each finding rests on. There is no
// submit path: completion is the curator's judgment, not an explorer impulse.
// ---------------------------------------------------------------------------

export function explorerSubmissionFor(visibleNoteIds: readonly string[]) {
  const visibleNote = noteIdIn(visibleNoteIds, "unknown note id");
  const finding = z.strictObject({
    text: nonblank,
    basedOn: z
      .array(visibleNote)
      .default([])
      .describe(
        "Logical premises only. Include a note id exactly when this finding assumes that note's statement instead of proving it in its own text. Never cite provenance, inspiration, expanded repair context, or a note whose mathematics has been incorporated into this self-contained finding.",
      ),
    basedOnFindings: z
      .array(positiveInteger)
      .default([])
      .describe(
        "Earlier same-turn findings used as logical premises only, never provenance or shared drafting context.",
      ),
  });
  return z
    .strictObject({
      findings: z.array(finding).min(1),
      nextObjective: nonblank.optional(),
      expand: z.array(noteId).default([]),
    })
    .superRefine((value, ctx) => {
      for (const [index, entry] of value.findings.entries()) {
        const position = index + 1;
        for (const [
          referenceIndex,
          reference,
        ] of entry.basedOnFindings.entries()) {
          if (reference >= position) {
            ctx.addIssue({
              code: "custom",
              message:
                "finding-local dependencies must reference an earlier finding",
              path: ["findings", index, "basedOnFindings", referenceIndex],
            });
          }
        }
      }
    });
}
export type ExplorerSubmission = z.output<
  ReturnType<typeof explorerSubmissionFor>
>;
export type Finding = ExplorerSubmission["findings"][number];

// ---------------------------------------------------------------------------
// Curator ingest
//
// The curator gives every finding one navigational summary and one complete
// statement. Findings are immutable: the fold mints each exact (summary,
// statement, text, dependencies) tuple and mechanically reuses only an exact
// repeat. The curator holds no replacement, deduplication, or verification
// power.
// ---------------------------------------------------------------------------

export function curationSubmissionFor(findingCount: number) {
  const filing = z.strictObject({
    finding: positiveInteger.max(findingCount),
    summary: nonblank.describe(
      "Short navigational label for this finding, not its proof.",
    ),
    statement: nonblank.describe(
      "The theorem, lemma, claim, or process status only. Include its hypotheses and conclusion, but no proof steps, proof assumptions, constructions, evidence, citations, reasoning, or justification.",
    ),
    reconstruction: reconstructionGuide.describe(
      "A reconstruction interface, not proof text: high-level ideas plus only the external results actually invoked by this finding.",
    ),
  });
  return z
    .strictObject({
      filings: z.array(filing),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<number>();
      for (const [index, entry] of value.filings.entries()) {
        if (seen.has(entry.finding)) {
          ctx.addIssue({
            code: "custom",
            message: "each finding is filed exactly once",
            path: ["filings", index, "finding"],
          });
        }
        seen.add(entry.finding);
      }
      if (seen.size !== findingCount) {
        ctx.addIssue({
          code: "custom",
          message: `all ${findingCount} findings must be filed`,
          path: ["filings"],
        });
      }
    });
}
export type CurationSubmission = z.output<
  ReturnType<typeof curationSubmissionFor>
>;

// ---------------------------------------------------------------------------
// Verification
//
// One subsystem, two call sites. Triage plans each newly filed or revised
// note from the frozen mode menu; the loop executes each planned mode as its
// own fresh verifier call returning an assessment. Conditional inside: a
// note's audit treats its basedOn statements as given premises. Unconditional
// authority at the boundary: the goal battery always runs every mode plus
// criteria-match, and only its verdicts confer acceptance.
// ---------------------------------------------------------------------------

export const verificationModes = [
  "proof-audit",
  "reconstruction",
  "refutation",
  "external-premises",
] as const;
const verificationMode = z.enum(verificationModes);
export type VerificationMode = z.output<typeof verificationMode>;

// The boundary battery: every mode, plus the boundary-only criteria match.
export const boundaryModes = [
  "proof-audit",
  "external-premises",
  "reconstruction",
  "refutation",
  "criteria-match",
] as const;

export function triageSubmissionFor(newNoteIds: readonly string[]) {
  const freshNote = noteIdIn(newNoteIds, "not a note of this triage batch");
  const plan = z.strictObject({
    note: freshNote,
    modes: z.array(verificationMode),
    rationale: nonblank,
  });
  return z
    .strictObject({
      plans: z.array(plan),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      for (const [index, entry] of value.plans.entries()) {
        if (seen.has(entry.note)) {
          ctx.addIssue({
            code: "custom",
            message: "each note is planned exactly once",
            path: ["plans", index, "note"],
          });
        }
        seen.add(entry.note);
        if (new Set(entry.modes).size !== entry.modes.length) {
          ctx.addIssue({
            code: "custom",
            message: "modes must be distinct",
            path: ["plans", index, "modes"],
          });
        }
      }
      if (seen.size !== newNoteIds.length) {
        ctx.addIssue({
          code: "custom",
          message: `all ${newNoteIds.length} notes must be planned`,
          path: ["plans"],
        });
      }
    });
}
export type TriageSubmission = z.output<ReturnType<typeof triageSubmissionFor>>;

export const assessment = z.strictObject({
  verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  report: nonblank,
});
export type Assessment = z.output<typeof assessment>;

const bundlePremiseDisposition = z.enum([
  "RELEVANT_LOGICAL_PREMISE",
  "IRRELEVANT_OR_PROVED_INLINE",
  "TARGET_OR_PROOF_LEAK",
]);

export function bundleCertificationFor(
  directPremiseIds: readonly string[],
  closureIds: readonly string[] = [],
) {
  const directPremise = noteIdIn(
    directPremiseIds,
    "not a declared direct logical premise",
  );
  const closureNote = noteIdIn(closureIds, "not an audit-only closure note");
  return z
    .strictObject({
      verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
      report: nonblank,
      keyIdeas: z.enum(["SAFE", "LEAKS_PROOF"]),
      allowedSources: z.enum([
        "SAFE",
        "IRRELEVANT_OR_NEW_PREMISE",
        "LEAKS_PROOF",
      ]),
      premises: z.array(
        z.strictObject({
          note: directPremise,
          disposition: bundlePremiseDisposition,
          report: nonblank,
        }),
      ),
      closure: z.array(
        z.strictObject({
          note: closureNote,
          disposition: z.enum(["SAFE", "TARGET_OR_PROOF_LEAK"]),
          report: nonblank,
        }),
      ),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<string>();
      for (const [index, premise] of value.premises.entries()) {
        if (seen.has(premise.note)) {
          ctx.addIssue({
            code: "custom",
            message: "each direct premise must be certified exactly once",
            path: ["premises", index, "note"],
          });
        }
        seen.add(premise.note);
      }
      if (seen.size !== directPremiseIds.length) {
        ctx.addIssue({
          code: "custom",
          message: "every direct premise must be certified exactly once",
          path: ["premises"],
        });
      }
      const seenClosure = new Set<string>();
      for (const [index, premise] of value.closure.entries()) {
        if (seenClosure.has(premise.note)) {
          ctx.addIssue({
            code: "custom",
            message: "each audit-only closure note must be certified once",
            path: ["closure", index, "note"],
          });
        }
        seenClosure.add(premise.note);
      }
      if (seenClosure.size !== closureIds.length) {
        ctx.addIssue({
          code: "custom",
          message: "every audit-only closure note must be certified once",
          path: ["closure"],
        });
      }
      if (
        value.verdict === "PASS" &&
        (value.keyIdeas !== "SAFE" ||
          value.allowedSources !== "SAFE" ||
          value.premises.some(
            ({ disposition }) => disposition !== "RELEVANT_LOGICAL_PREMISE",
          ) ||
          value.closure.some(({ disposition }) => disposition !== "SAFE"))
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "PASS requires a nonleaking guide and only relevant direct logical premises",
          path: ["verdict"],
        });
      }
    });
}
export type BundleCertification = z.output<
  ReturnType<typeof bundleCertificationFor>
>;

export function reconstructionArtifactFor(directPremiseIds: readonly string[]) {
  const directPremise = noteIdIn(
    directPremiseIds,
    "not a supplied direct premise",
  );
  return z
    .strictObject({
      proof: nonblank,
      usedPremises: z.array(directPremise),
    })
    .superRefine((value, ctx) => {
      if (new Set(value.usedPremises).size !== value.usedPremises.length) {
        ctx.addIssue({
          code: "custom",
          message: "usedPremises must be distinct",
          path: ["usedPremises"],
        });
      }
    });
}
export type ReconstructionArtifact = z.output<
  ReturnType<typeof reconstructionArtifactFor>
>;

export const reconstructionComparison = assessment
  .extend({
    targetCoverage: z.enum(["EXACT", "WEAKER", "STRONGER", "MISSING"]),
    undeclaredPremises: z.array(nonblank),
  })
  .superRefine((value, ctx) => {
    if (
      value.verdict === "PASS" &&
      (value.targetCoverage !== "EXACT" || value.undeclaredPremises.length > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "PASS requires exact target coverage and no undeclared premises",
        path: ["verdict"],
      });
    }
  });
export type ReconstructionComparison = z.output<
  typeof reconstructionComparison
>;

const statementForm = z
  .enum(["PROPOSITION_ONLY", "CONTAINS_SUPPORT"])
  .describe(
    "Classify only the separately labeled statement field, never the exact note text. The note text is expected to contain proof. PROPOSITION_ONLY means the statement field itself contains only the claim and its hypotheses and conclusion.",
  );
const statementFidelity = z
  .enum(["MATCH", "MISMATCH"])
  .describe(
    "Whether the exact note text establishes the separately labeled statement without changing its hypotheses or conclusion.",
  );

export function assessmentFor(
  mode: (typeof boundaryModes)[number],
  scope: "note" | "boundary" = "note",
): z.ZodType<Assessment & Record<string, unknown>> {
  if (mode === "proof-audit" && scope === "note") {
    return assessment
      .extend({ statementForm, statementFidelity })
      .superRefine((value, ctx) => {
        if (
          value.verdict === "PASS" &&
          (value.statementForm !== "PROPOSITION_ONLY" ||
            value.statementFidelity !== "MATCH")
        ) {
          ctx.addIssue({
            code: "custom",
            message:
              "PASS requires a proposition-only statement that matches the exact text",
            path: ["verdict"],
          });
        }
      });
  }
  if (mode === "proof-audit" && scope === "boundary") {
    return assessment
      .extend({ goalStatementMatch: z.enum(["MATCH", "MISMATCH"]) })
      .superRefine((value, ctx) => {
        if (value.verdict === "PASS" && value.goalStatementMatch !== "MATCH") {
          ctx.addIssue({
            code: "custom",
            message:
              "PASS requires the stored goal statement to match the campaign target",
            path: ["verdict"],
          });
        }
      });
  }
  if (mode === "reconstruction" && scope === "note") {
    return assessment.extend({ statementForm }).superRefine((value, ctx) => {
      if (
        value.verdict === "PASS" &&
        value.statementForm !== "PROPOSITION_ONLY"
      ) {
        ctx.addIssue({
          code: "custom",
          message: "PASS requires a proposition-only target statement",
          path: ["verdict"],
        });
      }
    });
  }
  return assessment;
}

// ---------------------------------------------------------------------------
// Curator serve
//
// The curator's second call site. Each cycle it reads the criteria, the
// standing-annotated index, and the previous turn's requests, then either
// composes the next explorer's working set or points at the goal note whose
// statement meets the completion criteria. Declaring the goal excludes
// serving: the boundary battery decides what happens next.
// ---------------------------------------------------------------------------

export function serveSubmissionFor(options: {
  readonly expandableNoteIds: readonly string[];
  readonly goalNoteIds: readonly string[];
  readonly retriableNoteIds: readonly string[];
  readonly expansionFits?: (
    ids: readonly string[],
    objective: string | undefined,
  ) => boolean;
}) {
  const expandableNote = noteIdIn(
    options.expandableNoteIds,
    "note is not expandable",
  );
  const goalNote = noteIdIn(options.goalNoteIds, "note is not goal-eligible");
  const retriableNote = noteIdIn(
    options.retriableNoteIds,
    "note is not eligible for re-triage",
  );
  return z
    .strictObject({
      expand: z.array(expandableNote).default([]),
      objective: nonblank.optional(),
      goalNote: goalNote.optional(),
      retriage: z.array(retriableNote).default([]),
    })
    .superRefine((value, ctx) => {
      if (new Set(value.expand).size !== value.expand.length) {
        ctx.addIssue({
          code: "custom",
          message: "expanded note ids must be distinct",
          path: ["expand"],
        });
      }
      if (new Set(value.retriage).size !== value.retriage.length) {
        ctx.addIssue({
          code: "custom",
          message: "re-triage note ids must be distinct",
          path: ["retriage"],
        });
      }
      if (value.goalNote !== undefined) {
        if (value.expand.length > 0) {
          ctx.addIssue({
            code: "custom",
            message: "declaring the goal excludes serving a working set",
            path: ["expand"],
          });
        }
        if (value.objective !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: "declaring the goal excludes an objective",
            path: ["objective"],
          });
        }
        if (value.retriage.length > 0) {
          ctx.addIssue({
            code: "custom",
            message: "declaring the goal excludes re-triage",
            path: ["retriage"],
          });
        }
      }
      if (value.retriage.length > 0) {
        if (value.expand.length > 0) {
          ctx.addIssue({
            code: "custom",
            message: "re-triage excludes serving a working set",
            path: ["expand"],
          });
        }
        if (value.objective !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: "re-triage excludes an objective",
            path: ["objective"],
          });
        }
      }
      if (
        options.expansionFits !== undefined &&
        !options.expansionFits(value.expand, value.objective)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "selected expansion exceeds maxContextTokens",
          path: ["expand"],
        });
      }
    });
}
export type ServeSubmission = z.output<ReturnType<typeof serveSubmissionFor>>;

export function callActivity(label: string): {
  readonly role: string;
  readonly triggerCall?: number;
} {
  const parts = label.split("/");
  if (
    parts[0] !== applicationId ||
    parts[1] !== protocolName ||
    parts[2] === undefined
  ) {
    return { role: "unknown" };
  }
  const role = parts[2];
  // Verify labels carry their trigger after the note and mode segments;
  // every other label carries it directly after the role. Non-numeric
  // segments (explorer/initial, candidate/<mode>) yield no trigger.
  const trigger = parts[role === "verify" ? 5 : 3];
  return trigger !== undefined && /^[0-9]+$/u.test(trigger)
    ? { role, triggerCall: Number(trigger) }
    : { role };
}

export function renderTask(
  task: Pick<Task, "problem" | "completionCriteria">,
): string {
  return `Problem:\n${task.problem}\n\nCompletion criteria:\n${task.completionCriteria}`;
}

export const turnTool = "submit_turn";
export const curationTool = "submit_curation";
export const triageTool = "submit_triage";
export const serveTool = "submit_serving";
export const verdictTool = "submit_verdict";
