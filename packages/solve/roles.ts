import { createHash } from "node:crypto";

import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});
const summaryText = nonblank.refine((value) => value.length <= 240, {
  message: "summary must be at most 240 characters",
});
const positiveInteger = z.number().int().positive();
const noteId = z.string().regex(/^n[1-9][0-9]*$/u);

export const task = z.strictObject({
  problem: nonblank,
  completionCriteria: nonblank,
});
export type Task = z.output<typeof task>;

export const note = z.strictObject({
  id: noteId,
  summary: summaryText,
  text: nonblank,
});
export type Note = z.output<typeof note>;

export const verifierResult = z.strictObject({
  verdict: z.enum(["ACCEPT", "REJECT"]),
  report: nonblank,
});
export type VerifierResult = z.output<typeof verifierResult>;

export const explorerInput = z
  .strictObject({
    task: task,
    index: z.array(note.pick({ id: true, summary: true })),
    context: z.array(note),
    objective: nonblank,
    previousVerifierResult: verifierResult.optional(),
  })
  .superRefine((value, ctx) => {
    const index = new Map(value.index.map((note) => [note.id, note.summary]));
    const seen = new Set<string>();
    for (const [position, note] of value.context.entries()) {
      if (seen.has(note.id)) {
        ctx.addIssue({
          code: "custom",
          message: "context note ids must be distinct",
          path: ["context", position, "id"],
        });
      }
      seen.add(note.id);
      if (index.get(note.id) !== note.summary) {
        ctx.addIssue({
          code: "custom",
          message: "context note must match the supplied index",
          path: ["context", position],
        });
      }
    }
  });
export type ExplorerInput = z.output<typeof explorerInput>;

export const explorerResult = z.strictObject({
  findings: z.array(z.strictObject({ text: nonblank })).min(1),
});
export type ExplorerResult = z.output<typeof explorerResult>;

const existingRef = z.strictObject({ kind: z.literal("note"), id: noteId });
const freshRef = z.strictObject({
  kind: z.literal("finding"),
  finding: positiveInteger,
});
export const noteRef = z.discriminatedUnion("kind", [existingRef, freshRef]);
export type NoteRef = z.output<typeof noteRef>;

export const coordinatorInput = z.strictObject({
  task: task,
  notes: z.array(note),
  findings: z.array(z.strictObject({ text: nonblank })).min(1),
  previousVerifierResult: verifierResult.optional(),
});
export type CoordinatorInput = z.output<typeof coordinatorInput>;

const exploreAction = z.strictObject({
  kind: z.literal("explore"),
  objective: nonblank,
  context: z.array(noteRef),
});
const verifyAction = z.strictObject({
  kind: z.literal("verify"),
  answer: noteRef,
  support: z.array(noteRef),
});

export function coordinatorResultFor(
  existingNoteIds: readonly string[],
  findingCount: number,
) {
  const knownNotes = new Set(existingNoteIds);
  const filing = z.strictObject({
    finding: positiveInteger.max(findingCount),
    summary: summaryText,
  });
  return z
    .strictObject({
      filings: z.array(filing),
      action: z.discriminatedUnion("kind", [exploreAction, verifyAction]),
    })
    .superRefine((value, ctx) => {
      const filed = new Set<number>();
      for (const [index, entry] of value.filings.entries()) {
        if (filed.has(entry.finding)) {
          ctx.addIssue({
            code: "custom",
            message: "each finding must be filed exactly once",
            path: ["filings", index, "finding"],
          });
        }
        filed.add(entry.finding);
      }
      if (filed.size !== findingCount) {
        ctx.addIssue({
          code: "custom",
          message: `all ${findingCount} findings must be filed`,
          path: ["filings"],
        });
      }
      const refs =
        value.action.kind === "explore"
          ? value.action.context
          : [value.action.answer, ...value.action.support];
      const seenRefs = new Set<string>();
      for (const [index, ref] of refs.entries()) {
        const key = refKey(ref);
        if (seenRefs.has(key)) {
          ctx.addIssue({
            code: "custom",
            message: "action references must be distinct",
            path: ["action", "references", index],
          });
        }
        seenRefs.add(key);
        if (ref.kind === "note" && !knownNotes.has(ref.id)) {
          ctx.addIssue({
            code: "custom",
            message: "reference names an unknown note",
            path: ["action", "references", index],
          });
        }
        if (ref.kind === "finding" && ref.finding > findingCount) {
          ctx.addIssue({
            code: "custom",
            message: "reference names an unknown finding",
            path: ["action", "references", index],
          });
        }
      }
    });
}
export type CoordinatorResult = z.output<
  ReturnType<typeof coordinatorResultFor>
>;

export const verifierInput = z
  .strictObject({
    task: task,
    answer: note,
    support: z.array(note),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const [position, note] of value.support.entries()) {
      if (note.id === value.answer.id || ids.has(note.id)) {
        ctx.addIssue({
          code: "custom",
          message: "answer and support note ids must be distinct",
          path: ["support", position, "id"],
        });
      }
      ids.add(note.id);
    }
  });
export type VerifierInput = z.output<typeof verifierInput>;

function verifierInputHash(value: VerifierInput): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface Roles {
  readonly explorer: (input: ExplorerInput) => Promise<ExplorerResult>;
  readonly coordinator: (input: CoordinatorInput) => Promise<CoordinatorResult>;
  readonly verifier: (input: VerifierInput) => Promise<VerifierResult>;
}

export type Verifier = Roles["verifier"];

export function allVerifiers(...verifiers: readonly Verifier[]): Verifier {
  if (verifiers.length === 0) {
    throw new Error("allVerifiers needs at least one verifier");
  }
  return async (input) => {
    const responses = (
      await Promise.all(verifiers.map((verifier) => verifier(input)))
    ).map((response) => verifierResult.parse(response));
    const rejected = responses.filter(
      (response) => response.verdict === "REJECT",
    );
    return {
      verdict: rejected.length === 0 ? "ACCEPT" : "REJECT",
      report: responses
        .map(
          (response, index) =>
            `Verifier ${index + 1}: ${response.verdict}\n${response.report}`,
        )
        .join("\n\n"),
    };
  };
}

export const trialInput = z.strictObject({
  task: task,
  objective: nonblank,
  maxExplorerTurns: positiveInteger.default(10),
});
export type TrialInput = z.output<typeof trialInput>;

export type TrialResult =
  | {
      readonly outcome: "accepted";
      readonly turns: number;
      readonly answer: Note;
      readonly verifier: VerifierResult;
      readonly notes: readonly Note[];
    }
  | {
      readonly outcome: "turn-limit";
      readonly turns: number;
      readonly notes: readonly Note[];
      readonly lastVerifierResult?: VerifierResult;
    };

function refKey(ref: NoteRef): string {
  return ref.kind === "note" ? `note:${ref.id}` : `finding:${ref.finding}`;
}

export async function runTrial(
  inputValue: unknown,
  roles: Roles,
): Promise<TrialResult> {
  const spec = trialInput.parse(inputValue);
  const notes: Note[] = [];
  let objective = spec.objective;
  let context: Note[] = [];
  let previousVerifierResult: VerifierResult | undefined;
  const attemptedProposals = new Set<string>();

  for (let turn = 1; turn <= spec.maxExplorerTurns; turn += 1) {
    const explored = explorerResult.parse(
      await roles.explorer({
        task: spec.task,
        index: notes.map(({ id, summary }) => ({ id, summary })),
        context,
        objective,
        ...(previousVerifierResult === undefined
          ? {}
          : { previousVerifierResult }),
      }),
    );
    const coordinated = coordinatorResultFor(
      notes.map(({ id }) => id),
      explored.findings.length,
    ).parse(
      await roles.coordinator({
        task: spec.task,
        notes,
        findings: explored.findings,
        ...(previousVerifierResult === undefined
          ? {}
          : { previousVerifierResult }),
      }),
    );

    const fresh = new Map<number, Note>();
    for (const filing of [...coordinated.filings].sort(
      (left, right) => left.finding - right.finding,
    )) {
      const finding = explored.findings[filing.finding - 1]!;
      const note = {
        id: `n${notes.length + 1}`,
        summary: filing.summary,
        text: finding.text,
      };
      notes.push(note);
      fresh.set(filing.finding, note);
    }
    const byId = new Map(notes.map((note) => [note.id, note]));
    const resolve = (ref: NoteRef): Note => {
      const note =
        ref.kind === "note" ? byId.get(ref.id) : fresh.get(ref.finding);
      if (note === undefined) throw new Error(`unresolved ${refKey(ref)}`);
      return note;
    };

    if (coordinated.action.kind === "explore") {
      objective = coordinated.action.objective;
      context = coordinated.action.context.map(resolve);
      continue;
    }

    const answer = resolve(coordinated.action.answer);
    const support = coordinated.action.support.map(resolve);
    const proposal = verifierInput.parse({ task: spec.task, answer, support });
    const proposalHash = verifierInputHash(proposal);
    if (attemptedProposals.has(proposalHash)) {
      previousVerifierResult = {
        verdict: "REJECT",
        report:
          "The coordinator renominated an unchanged rejected answer proposal. Change the answer or its support before verification.",
      };
      objective = `Repair the verifier rejection:\n${previousVerifierResult.report}`;
      context = [answer, ...support];
      continue;
    }
    attemptedProposals.add(proposalHash);
    const verified = verifierResult.parse(await roles.verifier(proposal));
    if (verified.verdict === "ACCEPT") {
      return {
        outcome: "accepted",
        turns: turn,
        answer,
        verifier: verified,
        notes,
      };
    }
    previousVerifierResult = verified;
    objective = `Repair the verifier rejection:\n${verified.report}`;
    context = [answer, ...support];
  }

  return {
    outcome: "turn-limit",
    turns: spec.maxExplorerTurns,
    notes,
    ...(previousVerifierResult === undefined
      ? {}
      : { lastVerifierResult: previousVerifierResult }),
  };
}
