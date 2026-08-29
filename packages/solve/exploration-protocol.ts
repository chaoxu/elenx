import { type Entry } from "elenx";
import { piReasoning } from "elenx/pi";
import { z } from "zod";

export const applicationId = "elenx-solve";
export const protocolName = "exploration-v17";

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
    problem: nonblank,
    completionCriteria: nonblank,
    maxContextTokens: positiveInteger,
    maxIndexTokens: positiveInteger,
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

const finding = z.strictObject({
  text: nonblank,
  basedOn: z.array(noteId).default([]),
});
export type Finding = z.output<typeof finding>;

export const explorerSubmission = z.strictObject({
  findings: z.array(finding).min(1),
  nextObjective: nonblank.optional(),
  expand: z.array(noteId).default([]),
});
export type ExplorerSubmission = z.output<typeof explorerSubmission>;

// ---------------------------------------------------------------------------
// Curator ingest
//
// The curator files every finding of a turn exactly once: minted as a new
// note, recorded as a new version of an existing note it refines, or dropped
// as a duplicate. Text is the finding's exact bytes; the curator writes only
// the summary. The curator holds no verification power: standing comes from
// triage plans and verifier verdicts alone.
// ---------------------------------------------------------------------------

export function curationSubmissionFor(
  findingCount: number,
  existingNoteIds: readonly string[],
) {
  const knownNote = noteIdIn(existingNoteIds, "unknown note id");
  const filing = z
    .strictObject({
      finding: positiveInteger.max(findingCount),
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
  return z
    .strictObject({
      filings: z.array(filing),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<number>();
      const refined = new Set<string>();
      for (const [index, entry] of value.filings.entries()) {
        if (seen.has(entry.finding)) {
          ctx.addIssue({
            code: "custom",
            message: "each finding is filed exactly once",
            path: ["filings", index, "finding"],
          });
        }
        seen.add(entry.finding);
        if (entry.refines !== undefined) {
          // One version per note per curation: a second same-turn revision
          // would share the first's journal seq and silently replace it.
          if (refined.has(entry.refines)) {
            ctx.addIssue({
              code: "custom",
              message: "each note is refined at most once per curation",
              path: ["filings", index, "refines"],
            });
          }
          refined.add(entry.refines);
        }
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
export const boundaryModes = [...verificationModes, "criteria-match"] as const;

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

// ---------------------------------------------------------------------------
// Curator serve
//
// The curator's second call site. Each cycle it reads the criteria, the
// standing-annotated index, and the previous turn's requests, then either
// composes the next explorer's working set or points at the goal note whose
// statement meets the completion criteria. Declaring the goal excludes
// serving: the boundary battery decides what happens next.
// ---------------------------------------------------------------------------

export function serveSubmissionFor(liveNoteIds: readonly string[]) {
  const knownNote = noteIdIn(liveNoteIds, "unknown note id");
  return z
    .strictObject({
      expand: z.array(knownNote).default([]),
      objective: nonblank.optional(),
      goalNote: knownNote.optional(),
    })
    .superRefine((value, ctx) => {
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
