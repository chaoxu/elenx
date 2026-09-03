import { createRequire } from "node:module";

import type { EntryId } from "elenx";

import {
  byId,
  note as noteSchema,
  type JournalVerdict,
  type Note,
} from "./roles";

const require = createRequire(import.meta.url);
// cozo-node is CommonJS with a native addon; require keeps Bun and Node happy.
const { CozoDb } = require("cozo-node") as {
  CozoDb: new (
    engine: string,
    path: string,
  ) => {
    run(
      script: string,
      params?: Record<string, unknown>,
    ): Promise<{ headers: string[]; rows: unknown[][] }>;
    close(): void;
  };
};

// The journal is the only source of truth. The projection is an in-memory
// Cozo database of notes, summaries, support, and verdicts that the fold
// rebuilds on every derivation; notes, summaries, and verdicts carry the
// journal sequence that produced them, so a question about any point in the
// journal is a filter on that sequence.
const relations = [
  ":create note {id: String => seq: Int, text: String}",
  ":create summary {note: String => seq: Int, summary: String}",
  ":create support {note: String, support: String}",
  ":create verdict {seq: Int, note: String => candidate: Int, verifier: String, verdict: String, report: String}",
];

// Verified, dead, and accepted are derived from the verdict rows and the
// support edges alone. A note is dead when correctness, source, or
// reconstruction failed it or a note in its support is dead; verified when
// one candidate passed correctness and source and it is not dead; accepted
// when one candidate passed every verifier.
const derivedRules = `passed[candidate, note, verifier] := *verdict{seq, candidate, verifier, note, verdict: "PASS"}, seq <= $seq
dead[note] := *verdict{seq, verifier, note, verdict: "FAIL"}, seq <= $seq, verifier != "requirements"
dead[note] := *support{note, support}, dead[support]
verified[note] := passed[candidate, note, "correctness"], passed[candidate, note, "source"], not dead[note]
accepted[note] := passed[candidate, note, "correctness"], passed[candidate, note, "source"], passed[candidate, note, "requirements"], passed[candidate, note, "reconstruction"], not dead[note]`;

export class Projection {
  private constructor(private readonly db: InstanceType<typeof CozoDb>) {}

  static async open(verdicts: readonly JournalVerdict[]): Promise<Projection> {
    const projection = new Projection(new CozoDb("mem", ""));
    try {
      for (const relation of relations) await projection.db.run(relation);
      if (verdicts.length > 0) {
        await projection.db.run(
          "?[seq, note, candidate, verifier, verdict, report] <- $rows :put verdict {seq, note => candidate, verifier, verdict, report}",
          {
            rows: verdicts.map(({ seq, candidate, verdict }) => [
              seq,
              verdict.note,
              candidate,
              verdict.verifier,
              verdict.verdict,
              verdict.report,
            ]),
          },
        );
      }
      return projection;
    } catch (error) {
      projection.close();
      throw error;
    }
  }

  async add(
    entries: readonly {
      readonly id: string;
      readonly text: string;
      readonly support: readonly string[];
    }[],
    seq: EntryId,
  ): Promise<void> {
    await this.db.run("?[id, seq, text] <- $rows :put note {id => seq, text}", {
      rows: entries.map(({ id, text }) => [id, seq, text]),
    });
    const edges = entries.flatMap(({ id, support }) =>
      support.map((supportId) => [id, supportId]),
    );
    if (edges.length > 0) {
      await this.db.run(
        "?[note, support] <- $rows :put support {note, support}",
        {
          rows: edges,
        },
      );
    }
  }

  async file(
    filings: readonly { readonly note: string; readonly summary: string }[],
    seq: EntryId,
  ): Promise<void> {
    if (filings.length === 0) return;
    await this.db.run(
      "?[note, seq, summary] <- $rows :put summary {note => seq, summary}",
      { rows: filings.map(({ note, summary }) => [note, seq, summary]) },
    );
  }

  /** Every note that exists at `seq`, with the summary, verdicts, and flags derived by then, in id order. */
  async at(seq: EntryId): Promise<Note[]> {
    const [notes, summaries, support, verdicts, flags] = await Promise.all([
      this.db.run("?[id, text] := *note{id, seq, text}, seq <= $seq", { seq }),
      this.db.run(
        "?[note, summary] := *summary{note, seq, summary}, seq <= $seq",
        { seq },
      ),
      this.db.run("?[note, support] := *support{note, support}"),
      this.db.run(
        "?[seq, verifier, note, verdict, report] := *verdict{seq, note, verifier, verdict, report}, seq <= $seq :order seq, note",
        { seq },
      ),
      this.db.run(
        `${derivedRules}
?[note, flag] := verified[note], flag = "verified"
?[note, flag] := dead[note], flag = "dead"`,
        { seq },
      ),
    ]);
    const flagged = (flag: string): Set<unknown> =>
      new Set(
        flags.rows.filter(([, value]) => value === flag).map(([note]) => note),
      );
    const verifiedNotes = flagged("verified");
    const deadNotes = flagged("dead");
    const summaryOf = new Map(
      summaries.rows.map(([note, summary]) => [note, summary]),
    );
    return notes.rows
      .map(([id, text]) =>
        noteSchema.parse({
          id,
          ...(summaryOf.has(id) ? { summary: summaryOf.get(id) } : {}),
          text,
          support: support.rows
            .filter(([note]) => note === id)
            .map(([, supportId]) => supportId as string)
            .sort(byId),
          verdicts: verdicts.rows
            .filter(([, , note]) => note === id)
            .map(([, verifier, note, verdict, report]) => ({
              verifier,
              note,
              verdict,
              report,
            })),
          verified: verifiedNotes.has(id),
          dead: deadNotes.has(id),
        }),
      )
      .sort((left, right) => byId(left.id, right.id));
  }

  /** The notes accepted at `seq`: every verifier passed them on one candidate, in id order. */
  async accepted(seq: EntryId): Promise<string[]> {
    const result = await this.db.run(
      `${derivedRules}
?[note] := accepted[note]`,
      { seq },
    );
    return result.rows.map(([note]) => note as string).sort(byId);
  }

  /** The transitive support of a note, in id order. */
  async closure(id: string): Promise<string[]> {
    const result = await this.db.run(
      `closure[note, support] := *support{note, support}
closure[note, support] := closure[note, between], *support{note: between, support}
?[support] := closure[$note, support]`,
      { note: id },
    );
    return result.rows.map(([supportId]) => supportId as string).sort(byId);
  }

  close(): void {
    this.db.close();
  }
}
