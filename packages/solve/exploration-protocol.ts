import { type Entry, type EntryId } from "elenx";
import { piReasoning } from "elenx/pi";
import { z } from "zod";

export const applicationId = "elenx-solve";
export const protocolName = "exploration-v15";

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
const nonnegativeInteger = z.number().int().min(0);
const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});
const userGuidance = z.array(nonblank);
const guidanceModule = z.strictObject({
  origin: z.enum(["default", "user"]),
  text: nonblank,
});

export const settingsSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    maxContextTokens: positiveInteger.default(200_000),
    maxHandoffTokens: positiveInteger.default(24_000),
    maxRepairDepth: nonnegativeInteger.nullable().default(null),
    explorerGuidance: userGuidance.default([]),
    explorer: modelProfile,
    handoffVerifier: modelProfile,
    premiseVerifier: modelProfile,
    sourceChecker: sourceProfile,
    proofVerifier: modelProfile,
  })
  .superRefine(({ maxContextTokens, maxHandoffTokens }, ctx) => {
    if (maxHandoffTokens > maxContextTokens) {
      ctx.addIssue({
        code: "custom",
        message: "maxHandoffTokens cannot exceed maxContextTokens",
        path: ["maxHandoffTokens"],
      });
    }
  });
export type Settings = z.output<typeof settingsSchema>;

export const taskSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    problem: nonblank,
    completionCriteria: nonblank,
    maxContextTokens: positiveInteger,
    maxHandoffTokens: positiveInteger,
    maxRepairDepth: nonnegativeInteger.nullable().default(null),
    guidance: z.array(guidanceModule),
    explorer: runtimeProfile,
    handoffVerifier: runtimeProfile,
    premiseVerifier: runtimeProfile,
    sourceChecker: sourceProfile,
    proofVerifier: runtimeProfile,
  })
  .superRefine(({ maxContextTokens, maxHandoffTokens }, ctx) => {
    if (maxHandoffTokens > maxContextTokens) {
      ctx.addIssue({
        code: "custom",
        message: "maxHandoffTokens cannot exceed maxContextTokens",
        path: ["maxHandoffTokens"],
      });
    }
  });
export type Task = z.output<typeof taskSchema>;
export type RuntimeProfile = z.output<typeof runtimeProfile>;
export type SourceProfile = z.output<typeof sourceProfile>;
export type GuidanceModule = z.output<typeof guidanceModule>;

type CampaignDeclaration = Extract<Entry, { kind: "campaign" }>;

const replayReleases: Readonly<Record<string, string>> = {
  "exploration-v12": "v0.31.0",
  "exploration-v13": "v0.32.0",
  "exploration-v14": "v0.33.0",
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

const selectedNote = z.strictObject({
  note: z.number().int().positive(),
  intendedUse: nonblank,
});

const continueSubmission = z
  .strictObject({
    action: z.literal("continue"),
    notes: z.array(nonblank),
    nextObjective: nonblank,
    selectedNotes: z.array(selectedNote),
  })
  .superRefine(({ notes, selectedNotes }, ctx) => {
    const positions = selectedNotes.map(({ note }) => note);
    if (new Set(positions).size !== positions.length) {
      ctx.addIssue({
        code: "custom",
        message: "selected note positions must be unique",
        path: ["selectedNotes"],
      });
    }
    for (const [index, position] of positions.entries()) {
      if (position > notes.length) {
        ctx.addIssue({
          code: "custom",
          message: "selected note position is absent from notes",
          path: ["selectedNotes", index, "note"],
        });
      }
    }
  });
const submitSubmission = z.strictObject({
  action: z.literal("submit"),
  answer: nonblank,
});

export const explorerSubmission = z.discriminatedUnion("action", [
  continueSubmission,
  submitSubmission,
]);
export type ExplorerSubmission = z.output<typeof explorerSubmission>;
export type ContinueSubmission = z.output<typeof continueSubmission>;

export interface Note {
  readonly id: `note-${number}-${number}`;
  readonly text: string;
  readonly originCall: EntryId;
}

export interface Handoff {
  readonly sourceCall: EntryId;
  readonly nextObjective: string;
  readonly notes: readonly {
    readonly id: Note["id"];
    readonly text: string;
    readonly intendedUse: string;
  }[];
}

export function handoffContent(handoff: Handoff) {
  return {
    nextObjective: handoff.nextObjective,
    notes: handoff.notes.map(({ text, intendedUse }) => ({
      text,
      intendedUse,
    })),
  };
}

export function handoffFor(
  sourceCall: EntryId,
  submission: ContinueSubmission,
): Handoff {
  return {
    sourceCall,
    nextObjective: submission.nextObjective,
    notes: submission.selectedNotes.map(({ note, intendedUse }) => ({
      id: `note-${sourceCall}-${note}`,
      text: submission.notes[note - 1]!,
      intendedUse,
    })),
  };
}

export const assessment = z.strictObject({
  verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  report: nonblank,
});
export type Assessment = z.output<typeof assessment>;

export const turnTool = "submit_turn";
export const reviewTool = "submit_review";
export const premiseTool = "submit_premises";
export const proofTool = "submit_proof_audit";

const prefix = `${applicationId}/${protocolName}`;

export function explorerLabel(trigger?: EntryId): string {
  return trigger === undefined
    ? `${prefix}/explorer/initial`
    : `${prefix}/explorer/${trigger}`;
}

export function handoffReviewLabel(source: EntryId): string {
  return `${prefix}/handoff/${source}`;
}

export function premiseAuditLabel(): string {
  return `${prefix}/candidate/premises`;
}

export function proofAuditLabel(): string {
  return `${prefix}/candidate/proof`;
}

export function callActivity(label: string): {
  readonly role: string;
  readonly triggerCall?: EntryId;
} {
  const parts = label.split("/");
  if (parts[0] !== applicationId || parts[1] !== protocolName) {
    return { role: "unknown" };
  }
  if (parts[2] === "explorer") {
    return {
      role: "explorer",
      ...(parts[3] === "initial" ? {} : { triggerCall: Number(parts[3]) }),
    };
  }
  if (parts[2] === "handoff") {
    return { role: "handoff-review", triggerCall: Number(parts[3]) };
  }
  if (parts[2] === "candidate") {
    return { role: parts[3] === "premises" ? "premise-audit" : "proof-audit" };
  }
  return { role: "unknown" };
}

export function renderTask(
  task: Pick<Task, "problem" | "completionCriteria">,
): string {
  return `Problem:\n${task.problem}\n\nCompletion criteria:\n${task.completionCriteria}`;
}
