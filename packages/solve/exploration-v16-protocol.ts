import { type Entry } from "elenx";
import { piReasoning } from "elenx/pi";
import { z } from "zod";

export const applicationId = "elenx-solve";
export const protocolName = "exploration-v16";

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
    explorerGuidance: userGuidance.default([]),
    explorer: modelProfile,
    curator: modelProfile,
    premiseVerifier: modelProfile,
    sourceChecker: sourceProfile,
    proofVerifier: modelProfile,
  })
  .superRefine(boundsRefinement);
export type Settings = z.output<typeof settingsSchema>;

export const taskSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    problem: nonblank,
    completionCriteria: nonblank,
    maxContextTokens: positiveInteger,
    maxIndexTokens: positiveInteger,
    guidance: z.array(guidanceModule),
    explorer: runtimeProfile,
    curator: runtimeProfile,
    premiseVerifier: runtimeProfile,
    sourceChecker: sourceProfile,
    proofVerifier: runtimeProfile,
  })
  .superRefine(boundsRefinement);
export type Task = z.output<typeof taskSchema>;
export type RuntimeProfile = z.output<typeof runtimeProfile>;
export type SourceProfile = z.output<typeof sourceProfile>;
export type GuidanceModule = z.output<typeof guidanceModule>;

type CampaignDeclaration = Extract<Entry, { kind: "campaign" }>;

const replayReleases: Readonly<Record<string, string>> = {
  "exploration-v12": "v0.31.0",
  "exploration-v13": "v0.32.0",
  "exploration-v14": "v0.33.0",
  "exploration-v15": "v0.34.0",
};

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
    if (typeof declaredProtocol === "string") {
      const release = replayReleases[declaredProtocol];
      if (release !== undefined) {
        throw new Error(
          `${declaredProtocol} requires elenx-solve ${release} for replay or inspection`,
        );
      }
    }
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
// The explorer is a pure reasoner. It reports raw findings (results, failed
// attempts, and open questions alike, as self-contained free text) or submits
// one standalone answer. It never authors index entries and never selects what
// survives: the curator files every reported finding. The schema root is one
// flat object with an action discriminant so strict tool-schema modes that
// forbid a root oneOf accept it unchanged.
// ---------------------------------------------------------------------------

const finding = z.strictObject({
  text: nonblank,
  basedOn: z.array(noteId).default([]),
});
export type Finding = z.output<typeof finding>;

export const explorerSubmission = z
  .strictObject({
    action: z.enum(["continue", "submit"]),
    findings: z.array(finding).default([]),
    nextObjective: nonblank.optional(),
    expand: z.array(noteId).default([]),
    answer: nonblank.optional(),
    basedOn: z.array(noteId).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.action === "continue") {
      if (value.findings.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "continue requires at least one finding",
          path: ["findings"],
        });
      }
      if (value.answer !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "continue cannot carry an answer",
          path: ["answer"],
        });
      }
      if (value.basedOn.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: "basedOn belongs to submit; findings carry their own",
          path: ["basedOn"],
        });
      }
    } else {
      if (value.answer === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "submit requires the standalone answer",
          path: ["answer"],
        });
      }
      for (const [path, present] of [
        ["findings", value.findings.length > 0],
        ["nextObjective", value.nextObjective !== undefined],
        ["expand", value.expand.length > 0],
      ] as const) {
        if (present) {
          ctx.addIssue({
            code: "custom",
            message: `submit cannot carry ${path}`,
            path: [path],
          });
        }
      }
    }
  });
export type ExplorerSubmission = z.output<typeof explorerSubmission>;

// ---------------------------------------------------------------------------
// Curator ingest
//
// The curator files every finding of a turn: each one is minted as a new note,
// recorded as a new version of an existing note it refines, or dropped as a
// duplicate of an existing note. Nothing is silently lost — every finding
// index must be covered exactly once. Text is the finding's exact bytes; the
// curator writes only the summary. Invalidations are permitted solely while
// ingesting a verifier defect, and each must quote its verdict as cause.
// ---------------------------------------------------------------------------

const positiveIndex = z.number().int().positive();

export function curationSubmissionFor(
  findingCount: number,
  existingNoteIds: readonly string[],
  verdictPresent: boolean,
) {
  const known = new Set(existingNoteIds);
  const knownNote = noteId.refine((value) => known.has(value), {
    message: "unknown note id",
  });
  const filing = z
    .strictObject({
      finding: positiveIndex.max(findingCount),
      summary: nonblank.optional(),
      refines: knownNote.optional(),
      duplicateOf: knownNote.optional(),
    })
    .superRefine((value, ctx) => {
      if (value.refines !== undefined && value.duplicateOf !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a filing is a mint, a refinement, or a duplicate",
          path: ["refines"],
        });
      }
      if (value.duplicateOf === undefined && value.summary === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "minting or refining requires a summary",
          path: ["summary"],
        });
      }
    });
  const invalidation = z.strictObject({
    note: knownNote,
    cause: nonblank,
  });
  return z
    .strictObject({
      filings: z.array(filing),
      invalidations: z.array(invalidation).default([]),
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
      if (!verdictPresent && value.invalidations.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: "invalidation requires a verifier verdict to ingest",
          path: ["invalidations"],
        });
      }
    });
}
export type CurationSubmission = z.output<
  ReturnType<typeof curationSubmissionFor>
>;

export const turnTool = "submit_turn";
export const curationTool = "submit_curation";
