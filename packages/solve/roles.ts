import type { Json } from "elenx";
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
  "requirements",
  "correctness",
  "adversarial",
] as const;
export type VerifierName = (typeof verifierNames)[number];
export const roleLabels = {
  explorer: `${applicationId}/explorer`,
  coordinator: `${applicationId}/coordinator`,
  verifier: `${applicationId}/verifier`,
} as const satisfies Readonly<Record<RoleName, string>>;
export const verifierLabels = {
  requirements: `${roleLabels.verifier}/requirements`,
  correctness: `${roleLabels.verifier}/correctness`,
  adversarial: `${roleLabels.verifier}/adversarial`,
} as const satisfies Readonly<Record<VerifierName, string>>;

export function roleFromLabel(label: string): RoleName | undefined {
  return roleNames.find((name) => roleLabels[name] === label);
}

export function verifierFromLabel(label: string): VerifierName | undefined {
  return verifierNames.find((name) => verifierLabels[name] === label);
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

export const explorerInput = z.strictObject({
  task,
  objective: nonblank,
  notes: z.array(note),
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

export function coordinatorResultFor(
  notes: readonly Pick<Note, "id" | "summary">[],
) {
  const known = new Set(notes.map(({ id }) => id));
  const withoutSummary = new Set(
    notes.filter(({ summary }) => summary === undefined).map(({ id }) => id),
  );
  return z
    .strictObject({
      filings: z.array(z.strictObject({ note: noteId, summary: nonblank })),
      objective: nonblank,
      verify: z
        .strictObject({ note: noteId, support: z.array(noteId) })
        .optional(),
    })
    .superRefine((value, ctx) => {
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
      if (value.verify === undefined) return;
      const ids = [value.verify.note, ...value.verify.support];
      const seen = new Set<string>();
      for (const [index, id] of ids.entries()) {
        if (!known.has(id) || seen.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: "verify must reference distinct known notes",
            path: index === 0 ? ["verify", "note"] : ["verify", "support"],
          });
        }
        seen.add(id);
      }
    });
}
export type CoordinatorResult = z.output<
  ReturnType<typeof coordinatorResultFor>
>;

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

export const verifierResult = z.array(verdict);
export type VerifierResult = z.output<typeof verifierResult>;

export function candidateMaterial(input: VerifierInput): Uint8Array {
  const text = [input.note.text, ...input.support.map(({ text }) => text)].join(
    "\n\n--- SUPPORT ---\n\n",
  );
  return new TextEncoder().encode(text);
}

export interface Roles {
  readonly explorer: (input: ExplorerInput) => Promise<ExplorerResult>;
  readonly coordinator: (input: CoordinatorInput) => Promise<CoordinatorResult>;
  readonly verifier: (input: VerifierInput) => Promise<VerifierResult>;
}
