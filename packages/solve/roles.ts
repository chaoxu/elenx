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
/** The verifiers in the order they run; the coordinator asks for a prefix of this order. */
export const verifierNames = [
  "source",
  "correctness",
  "requirements",
  "reconstruction",
] as const;
export type VerifierName = (typeof verifierNames)[number];
export const roleLabels = {
  explorer: `${applicationId}/explorer`,
  coordinator: `${applicationId}/coordinator`,
  verifier: `${applicationId}/verifier`,
} as const satisfies Readonly<Record<RoleName, string>>;
export const verifierLabels = {
  source: `${roleLabels.verifier}/source`,
  correctness: `${roleLabels.verifier}/correctness`,
  requirements: `${roleLabels.verifier}/requirements`,
  reconstruction: `${roleLabels.verifier}/reconstruction`,
} as const satisfies Readonly<Record<VerifierName, string>>;
/** The reconstruction verifier's two calls before its verdict: their labels and submit tools. */
export const reconstructionCalls = {
  statement: {
    label: `${verifierLabels.reconstruction}/statement`,
    tool: "submit_statement",
  },
  proof: {
    label: `${verifierLabels.reconstruction}/proof`,
    tool: "submit_proof",
  },
} as const;
export const roleTools = {
  explorer: "submit_notes",
  coordinator: "submit_coordination",
  verifier: "submit_verdict",
} as const satisfies Readonly<Record<RoleName, string>>;

export function verifierFromLabel(label: string): VerifierName | undefined {
  return verifierNames.find(
    (name) =>
      verifierLabels[name] === label ||
      label.startsWith(`${verifierLabels[name]}/`),
  );
}

export function roleFromLabel(label: string): RoleName | undefined {
  if (verifierFromLabel(label) !== undefined) return "verifier";
  return roleNames.find((name) => roleLabels[name] === label);
}

export function jsonSnapshot(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/** Note ids in numeric order. */
export const byId = (left: string, right: string): number =>
  Number(left.slice(1)) - Number(right.slice(1));

export const task = z.strictObject({
  problem: nonblank,
  completionCriteria: nonblank,
});
export type Task = z.output<typeof task>;

// INCONCLUSIVE is the reconstruction verifier's third verdict: the
// independent proof left something unproved and no defect was found, or the
// statement misstated or gave away the note. It blocks acceptance without
// marking the note defective.
export const verdict = z.strictObject({
  verifier: z.enum(verifierNames),
  note: noteId,
  verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
  report: nonblank,
});
export type Verdict = z.output<typeof verdict>;

const distinctSupport = [
  (value: { readonly support: readonly string[] }) =>
    new Set(value.support).size === value.support.length,
  { message: "support ids must be distinct", path: ["support"] },
] as [
  (value: { readonly support: readonly string[] }) => boolean,
  { message: string; path: string[] },
];
const passOrFail = z.enum(["PASS", "FAIL"]);
// The projection derives the two flags from the verdict rows and the support
// edges. A note is verified when one verification passed source and
// correctness and it is not dead, so its result can be built on; it is dead when
// correctness, source, or reconstruction failed it or a note in its support
// is dead, so it can never be verified. A note is accepted when one
// verification passed every verifier.
const noteFields = z.strictObject({
  id: noteId,
  summary: nonblank.optional(),
  text: nonblank,
  support: z.array(noteId),
  verdicts: z.array(verdict),
  verified: z.boolean(),
  dead: z.boolean(),
});
export const note = noteFields.refine(...distinctSupport);
export type Note = z.output<typeof note>;

function distinctKnown(
  known: ReadonlySet<string>,
  ids: readonly string[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message = "references must name distinct known notes",
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) {
      ctx.addIssue({ code: "custom", message, path: [...path] });
    }
    seen.add(id);
  }
}

export const explorerInput = z
  .strictObject({
    task,
    guidance: z.array(nonblank),
    objective: nonblank,
    notes: z.array(noteFields.omit({ text: true }).refine(...distinctSupport)),
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
  notes: z
    .array(z.strictObject({ text: nonblank, support: z.array(noteId) }))
    .min(1),
});
export type ExplorerResult = z.output<typeof explorerResult>;

/** The explorer's notes are numbered after the notes it received, in order. */
export function noteIdAfter(count: number, position: number): string {
  return `n${count + position + 1}`;
}

/**
 * Support names a live note the explorer received or an earlier note of the
 * same turn. A text that names such a note by id names it as support too, so
 * a result a text spells out is never left undeclared; ids that cannot be
 * support, the note's own, a later note's, or a dead note's, are provenance
 * and pass.
 */
export function explorerResultFor(notes: readonly Pick<Note, "id" | "dead">[]) {
  return explorerResult.superRefine((value, ctx) => {
    const allowed = new Set(
      notes.filter(({ dead }) => !dead).map(({ id }) => id),
    );
    for (const [position, entry] of value.notes.entries()) {
      distinctKnown(
        allowed,
        entry.support,
        ctx,
        ["notes", position, "support"],
        "support must name distinct notes that are not dead",
      );
      const named = [
        ...new Set(entry.text.match(/\bn[1-9][0-9]*\b/gu) ?? []),
      ].filter((id) => allowed.has(id) && !entry.support.includes(id));
      if (named.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `the text names ${named.join(", ")} but its support does not: name the note as support if the text uses its result, or drop the id if it does not`,
          path: ["notes", position, "text"],
        });
      }
      allowed.add(noteIdAfter(notes.length, position));
    }
  });
}

export const coordinatorInput = z.strictObject({
  task,
  notes: z.array(note),
});
export type CoordinatorInput = z.output<typeof coordinatorInput>;

/** One entry of a verify list: a note and the verifiers to run on it, a prefix of the verifier order. */
const verification = z
  .strictObject({
    note: noteId,
    verifiers: z.array(z.enum(verifierNames)).min(1),
  })
  .refine(
    (value) =>
      value.verifiers.every((name, index) => name === verifierNames[index]),
    {
      message: `verifiers must be a prefix of ${verifierNames.join(", ")}`,
      path: ["verifiers"],
    },
  );
export type Verification = z.output<typeof verification>;

export const coordinatorResult = z.strictObject({
  filings: z.array(z.strictObject({ note: noteId, summary: nonblank })),
  objective: nonblank,
  support: z.array(noteId),
  verify: z.array(verification),
});
export type CoordinatorResult = z.output<typeof coordinatorResult>;

export function coordinatorResultFor(
  notes: readonly Pick<
    Note,
    "id" | "summary" | "support" | "verified" | "dead"
  >[],
) {
  const known = new Set(notes.map(({ id }) => id));
  const withoutSummary = new Set(
    notes.filter(({ summary }) => summary === undefined).map(({ id }) => id),
  );
  const verified = new Set(
    notes.filter(({ verified }) => verified).map(({ id }) => id),
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
    distinctKnown(
      known,
      value.verify.map(({ note }) => note),
      ctx,
      ["verify"],
    );
    // A note is verified only over verified support: every note in its
    // support is verified already or listed earlier with the correctness
    // verifier, so it is verified in the same verification first.
    const listedWithCorrectness = new Set<string>();
    for (const [index, entry] of value.verify.entries()) {
      const target = notes.find(({ id }) => id === entry.note);
      if (target === undefined) continue;
      if (target.dead) {
        ctx.addIssue({
          code: "custom",
          message: "a dead note is not verified again",
          path: ["verify", index, "note"],
        });
      }
      if (
        target.support.some(
          (id) => !verified.has(id) && !listedWithCorrectness.has(id),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "a note is verified only after every note in its support is verified or listed earlier with the correctness verifier",
          path: ["verify", index, "note"],
        });
      }
      if (entry.verifiers.includes("correctness")) {
        listedWithCorrectness.add(entry.note);
      }
    }
  });
}

/** The distinct support of `notes` outside them, in id order. */
export function supportOf(
  notes: readonly Pick<Note, "id" | "support">[],
): string[] {
  const own = new Set(notes.map(({ id }) => id));
  return [...new Set(notes.flatMap(({ support }) => support))]
    .filter((id) => !own.has(id))
    .sort(byId);
}

export const verifierInput = z
  .strictObject({
    task,
    verify: z.array(verification).min(1),
    notes: z.array(note),
    support: z.array(note),
  })
  .superRefine((value, ctx) => {
    const listed = value.verify.map(({ note }) => note);
    if (new Set(listed).size !== listed.length) {
      ctx.addIssue({
        code: "custom",
        message: "verify must list distinct notes",
        path: ["verify"],
      });
    }
    if (value.notes.map(({ id }) => id).join(",") !== listed.join(",")) {
      ctx.addIssue({
        code: "custom",
        message: "notes must be the notes listed in verify, in order",
        path: ["notes"],
      });
    }
    if (
      value.support.map(({ id }) => id).join(",") !==
      supportOf(value.notes).join(",")
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "support must be the support of the notes outside them, in id order",
        path: ["support"],
      });
    }
  });
export type VerifierInput = z.output<typeof verifierInput>;

export function pick<T extends { readonly id: string }>(
  notes: readonly T[],
  id: string,
): T {
  const found = notes.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`unknown note ${id}`);
  return found;
}

const verifierIndex = (name: VerifierName): number =>
  verifierNames.indexOf(name);

/**
 * The notes one verifier judges in a verification, in the order listed,
 * given the verdicts recorded on its candidate: the notes that asked for it,
 * passed every verifier before it, and are not dead in the verification. A
 * note is dead in the verification when correctness, source, or
 * reconstruction failed it or a note in its support, listed or handed over in
 * full, is dead. The
 * verifiers that judge their notes in one call judge from the verdicts of the
 * verifiers before them; reconstruction judges one note at a time, also from
 * the reconstruction verdicts of the notes listed before it.
 */
export function judgedBy(
  input: Pick<VerifierInput, "verify" | "notes" | "support">,
  recorded: readonly Verdict[],
  verifier: VerifierName,
): string[] {
  const position = new Map(
    input.verify.map(({ note }, index) => [note, index]),
  );
  const known = [...input.notes, ...input.support];
  const judged: string[] = [];
  for (const [index, entry] of input.verify.entries()) {
    if (!entry.verifiers.includes(verifier)) continue;
    const prior = recorded.filter(
      (value) =>
        verifierIndex(value.verifier) < verifierIndex(verifier) ||
        (verifier === "reconstruction" &&
          value.verifier === "reconstruction" &&
          (position.get(value.note) ?? Number.POSITIVE_INFINITY) < index),
    );
    const passed = (id: string, name: VerifierName): boolean =>
      prior.some(
        (value) =>
          value.note === id &&
          value.verifier === name &&
          value.verdict === "PASS",
      );
    const dead = (id: string): boolean =>
      prior.some(
        (value) =>
          value.note === id &&
          value.verifier !== "requirements" &&
          value.verdict === "FAIL",
      ) || (known.find((note) => note.id === id)?.support ?? []).some(dead);
    if (
      verifierNames
        .slice(0, verifierIndex(verifier))
        .every((name) => passed(entry.note, name)) &&
      !dead(entry.note)
    ) {
      judged.push(entry.note);
    }
  }
  return judged;
}

/** Whether every verdict the verification calls for is recorded. */
export function verificationComplete(
  input: Pick<VerifierInput, "verify" | "notes" | "support">,
  recorded: readonly Verdict[],
): boolean {
  return verifierNames.every((name) =>
    judgedBy(input, recorded, name).every((id) =>
      recorded.some((value) => value.verifier === name && value.note === id),
    ),
  );
}

/** Binds a verdict list to the notes one call judges: one verdict per note under verification. */
function verdictsOver<T extends z.ZodRawShape>(
  entry: z.ZodObject<T>,
  judged: readonly string[],
) {
  const ids = [...judged] as [string, ...string[]];
  const expected = [...judged].sort(byId).join(",");
  return z
    .strictObject({ verdicts: z.array(entry.extend({ note: z.enum(ids) })) })
    .refine(
      (value) =>
        (
          value as { readonly verdicts: readonly { readonly note: string }[] }
        ).verdicts
          .map(({ note }) => note)
          .sort(byId)
          .join(",") === expected,
      {
        message: "one verdict per note under verification",
        path: ["verdicts"],
      },
    );
}

/** The verdicts of one correctness or requirements call. */
export const verdicts = z.strictObject({
  verdicts: z.array(verdict.omit({ verifier: true })),
});
export function verdictsFor(judged: readonly string[]) {
  return verdictsOver(
    verdict.omit({ verifier: true }).extend({ verdict: passOrFail }),
    judged,
  );
}

export function reconstructionVerdictFor(noteId: string) {
  return verdictsOver(verdict.omit({ verifier: true }), [noteId]);
}

/** What a text establishes, with nothing of how: one or several propositions. */
export const statement = z.strictObject({ statement: nonblank });
export type Statement = z.output<typeof statement>;

/** The proof the reconstruction verifier writes from the statement and the support notes alone. */
export const proof = z.strictObject({ proof: nonblank });

/** What the source verifier confirmed: one entry per external result the text invokes. */
// A plain string in the schema because the provider's structured output
// rejects the JSON Schema "uri" format; the shape is checked after parsing.
export const sources = z.array(
  z.strictObject({
    result: nonblank,
    source: nonblank,
    url: z.string().refine((value) => URL.canParse(value), "must be a URL"),
  }),
);
const sourceVerdict = verdict
  .omit({ verifier: true })
  .extend({ verdict: passOrFail, sources });
/** The verdicts of one source call. */
export const sourceVerdicts = z.strictObject({
  verdicts: z.array(sourceVerdict),
});
export function sourceVerdictsFor(judged: readonly string[]) {
  return verdictsOver(sourceVerdict, judged);
}

export type VerifierResult = readonly Verdict[];

export function candidateMaterial(input: VerifierInput): Uint8Array {
  const text = [...input.notes, ...input.support]
    .map(({ id, text }) => `--- ${id} ---\n\n${text}`)
    .join("\n\n");
  return new TextEncoder().encode(text);
}

export interface JournalVerdict {
  readonly seq: EntryId;
  readonly candidate: EntryId;
  readonly verdict: Verdict;
}

// The kernel records one verdict per call, on the candidate. A verifier call
// judges one or several notes, so its kernel verdict is the verdict on the
// candidate, PASS only when every note it judged passed, and its evidence
// lists the verdict of each note. The projection reads the evidence.
const verdictEvidence = verdicts.extend({
  verdicts: verdicts.shape.verdicts.min(1),
});
export function candidateVerdict(
  values: readonly Pick<Verdict, "verdict">[],
): Verdict["verdict"] {
  if (values.every(({ verdict }) => verdict === "PASS")) return "PASS";
  return values.some(({ verdict }) => verdict === "FAIL")
    ? "FAIL"
    : "INCONCLUSIVE";
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
    const parsed = verdictEvidence.safeParse(entry.evidence);
    if (
      !parsed.success ||
      call.candidate === undefined ||
      candidateVerdict(parsed.data.verdicts) !== entry.verdict
    ) {
      throw new Error(`malformed verdict ${entry.seq}`);
    }
    for (const value of parsed.data.verdicts) {
      verdicts.push({
        seq: entry.seq,
        candidate: call.candidate,
        verdict: { verifier, ...value },
      });
    }
  }
  return verdicts;
}

/** The returned call-result of a call, if it settled by returning. */
export function returnedOutput(
  records: readonly Entry[],
  call: EntryId,
): { readonly settled: EntryId; readonly output: Json } | undefined {
  const result = records.find(
    (entry) => entry.kind === "call-result" && entry.parent === call,
  );
  return result?.kind === "call-result" && result.state === "returned"
    ? { settled: result.seq, output: result.output }
    : undefined;
}

export function succeededSubmission(
  records: readonly Entry[],
  call: EntryId,
  tool: string,
): { readonly settled: EntryId; readonly input: Json } | undefined {
  const returned = returnedOutput(records, call);
  if (
    returned === undefined ||
    typeof returned.output !== "object" ||
    returned.output === null ||
    (returned.output as { readonly state?: Json }).state !== "succeeded"
  ) {
    return undefined;
  }
  try {
    return {
      settled: returned.settled,
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
