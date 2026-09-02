import {
  returnedToolSubmission,
  type Entry,
  type EntryId,
  type Json,
} from "elenx";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});
const noteId = z.string().regex(/^n[1-9][0-9]*$/u);

export const applicationId = "elenx-solve";
export const workflowProtocol = "workflow";
export const roleNames = ["explorer", "coordinator", "verifier"] as const;
export type RoleName = (typeof roleNames)[number];
export const verifierNames = [
  "correctness",
  "adversarial",
  "requirements",
] as const;
export type VerifierName = (typeof verifierNames)[number];
export const roleLabels = {
  explorer: `${applicationId}/explorer`,
  coordinator: `${applicationId}/coordinator`,
  verifier: `${applicationId}/verifier`,
} as const satisfies Readonly<Record<RoleName, string>>;
export const verifierLabels = {
  correctness: `${roleLabels.verifier}/correctness`,
  adversarial: `${roleLabels.verifier}/adversarial`,
  requirements: `${roleLabels.verifier}/requirements`,
} as const satisfies Readonly<Record<VerifierName, string>>;
export const roleTools = {
  explorer: "submit_notes",
  coordinator: "submit_coordination",
  verifier: "submit_verdict",
} as const satisfies Readonly<Record<RoleName, string>>;

export function verifierFromLabel(label: string): VerifierName | undefined {
  return verifierNames.find((name) => verifierLabels[name] === label);
}

export function roleFromLabel(label: string): RoleName | undefined {
  if (verifierFromLabel(label) !== undefined) return "verifier";
  return roleNames.find((name) => roleLabels[name] === label);
}

export function jsonSnapshot(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export const task = z.strictObject({
  problem: nonblank,
  completionCriteria: nonblank,
});
export type Task = z.output<typeof task>;

export const verdict = z.strictObject({
  verifier: z.enum(verifierNames),
  note: noteId,
  verdict: z.enum(["PASS", "FAIL"]),
  report: nonblank,
});
export type Verdict = z.output<typeof verdict>;

export const note = z.strictObject({
  id: noteId,
  summary: nonblank.optional(),
  text: nonblank,
  verdicts: z.array(verdict),
});
export type Note = z.output<typeof note>;

function distinctKnown(
  known: ReadonlySet<string>,
  ids: readonly string[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        message: "references must name distinct known notes",
        path: [...path],
      });
    }
    seen.add(id);
  }
}

export const explorerInput = z
  .strictObject({
    task,
    objective: nonblank,
    notes: z.array(note.omit({ text: true })),
    support: z.array(note),
  })
  .superRefine((value, ctx) => {
    distinctKnown(
      new Set(value.notes.map(({ id }) => id)),
      value.support.map(({ id }) => id),
      ctx,
      ["support"],
    );
  });
export type ExplorerInput = z.output<typeof explorerInput>;

export const explorerResult = z.strictObject({
  notes: z.array(z.strictObject({ text: nonblank })).min(1),
});
export type ExplorerResult = z.output<typeof explorerResult>;

export const coordinatorInput = z.strictObject({
  task,
  notes: z.array(note),
});
export type CoordinatorInput = z.output<typeof coordinatorInput>;

export const coordinatorResult = z.strictObject({
  filings: z.array(z.strictObject({ note: noteId, summary: nonblank })),
  objective: nonblank,
  support: z.array(noteId),
  verify: z.strictObject({ note: noteId, support: z.array(noteId) }).optional(),
});
export type CoordinatorResult = z.output<typeof coordinatorResult>;

export function coordinatorResultFor(
  notes: readonly Pick<Note, "id" | "summary">[],
) {
  const known = new Set(notes.map(({ id }) => id));
  const withoutSummary = new Set(
    notes.filter(({ summary }) => summary === undefined).map(({ id }) => id),
  );
  return coordinatorResult.superRefine((value, ctx) => {
    const filed = new Set<string>();
    for (const [index, filing] of value.filings.entries()) {
      if (!withoutSummary.has(filing.note) || filed.has(filing.note)) {
        ctx.addIssue({
          code: "custom",
          message: "each note without a summary must be filed exactly once",
          path: ["filings", index, "note"],
        });
      }
      filed.add(filing.note);
    }
    if (filed.size !== withoutSummary.size) {
      ctx.addIssue({
        code: "custom",
        message: `all ${withoutSummary.size} notes without a summary must be filed`,
        path: ["filings"],
      });
    }
    distinctKnown(known, value.support, ctx, ["support"]);
    if (value.verify === undefined) return;
    distinctKnown(known, [value.verify.note, ...value.verify.support], ctx, [
      "verify",
    ]);
  });
}

export const verifierInput = z
  .strictObject({
    task,
    note,
    support: z.array(note),
  })
  .superRefine((value, ctx) => {
    const ids = new Set([value.note.id]);
    for (const [position, entry] of value.support.entries()) {
      if (ids.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          message: "note and support ids must be distinct",
          path: ["support", position, "id"],
        });
      }
      ids.add(entry.id);
    }
  });
export type VerifierInput = z.output<typeof verifierInput>;

export function verdictFor(input: VerifierInput) {
  const ids = [input.note.id, ...input.support.map(({ id }) => id)] as [
    string,
    ...string[],
  ];
  return verdict
    .omit({ verifier: true })
    .extend({ note: z.enum(ids) })
    .refine(
      (value) => value.verdict === "FAIL" || value.note === input.note.id,
      { message: "PASS names the note, not a support note", path: ["note"] },
    );
}

export type VerifierResult = readonly Verdict[];

export function candidateMaterial(input: VerifierInput): Uint8Array {
  const text = [input.note.text, ...input.support.map(({ text }) => text)].join(
    "\n\n--- SUPPORT ---\n\n",
  );
  return new TextEncoder().encode(text);
}

export interface JournalVerdict {
  readonly seq: EntryId;
  readonly candidate: EntryId;
  readonly verdict: Verdict;
}

export function journalVerdicts(
  records: readonly Entry[],
): readonly JournalVerdict[] {
  const calls = new Map(
    records
      .filter((entry) => entry.kind === "call")
      .map((entry) => [entry.seq, entry]),
  );
  const verdicts: JournalVerdict[] = [];
  for (const entry of records) {
    if (entry.kind !== "verdict") continue;
    const call = calls.get(entry.call);
    const verifier =
      call?.kind === "call" ? verifierFromLabel(call.label) : undefined;
    if (call?.kind !== "call" || verifier === undefined) continue;
    const parsed = verdict.safeParse({
      verifier,
      verdict: entry.verdict,
      ...(typeof entry.evidence === "object" && entry.evidence !== null
        ? entry.evidence
        : {}),
    });
    if (!parsed.success || call.candidate === undefined) {
      throw new Error(`malformed verdict ${entry.seq}`);
    }
    verdicts.push({
      seq: entry.seq,
      candidate: call.candidate,
      verdict: parsed.data,
    });
  }
  return verdicts;
}

export function succeededSubmission(
  records: readonly Entry[],
  call: EntryId,
  tool: string,
): { readonly settled: EntryId; readonly input: Json } | undefined {
  const result = records.find(
    (entry) => entry.kind === "call-result" && entry.parent === call,
  );
  if (result?.kind !== "call-result" || result.state !== "returned") {
    return undefined;
  }
  const output = result.output;
  if (
    typeof output !== "object" ||
    output === null ||
    (output as { readonly state?: Json }).state !== "succeeded"
  ) {
    return undefined;
  }
  try {
    return {
      settled: result.seq,
      input: returnedToolSubmission(records, call, tool).input,
    };
  } catch {
    return undefined;
  }
}

export interface Roles {
  readonly explorer: (input: ExplorerInput) => Promise<ExplorerResult>;
  readonly coordinator: (input: CoordinatorInput) => Promise<CoordinatorResult>;
  readonly verifier: (
    input: VerifierInput,
    candidate?: EntryId,
  ) => Promise<VerifierResult>;
}
