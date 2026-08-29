// The exploration-v17 findings store: a Cozo materialization of note events.
//
// The campaign journal remains the single source of truth. Curator, triage,
// and verifier submissions recorded there are folded into events, and this
// store materializes them for querying: the standing-annotated live index,
// on-demand full text, version history, and the dependency graph queries the
// protocol needs (ancestor closure, cycle detection, refutation cascade).
// Deleting the store and re-applying the journal's events reproduces it
// exactly; nothing here is authoritative.
//
// Standing is derived, never stored: a triage plan and its mode verdicts
// apply to the note version they were issued against, so a revision stales
// them and the note returns to conjecture until re-triaged. Any valid FAIL
// refutes; an empty valid plan marks a process report; a valid plan whose
// every mode holds a valid PASS verifies — conditionally on the note's
// dependsOn statements, which is what makes the cascade meaningful.
//
// Ids and event ordering come from the caller (the campaign loop), which
// derives them from journal state. The store never invents identity.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// cozo-node is CommonJS with a native addon; require keeps Bun and Node happy.
const { CozoDb } = require("cozo-node") as {
  CozoDb: new (
    engine?: string,
    path?: string,
  ) => {
    run(
      script: string,
      params?: Record<string, unknown>,
    ): Promise<{ rows: unknown[][]; headers: string[] }>;
    close(): void;
  };
};

export interface NoteMint {
  readonly id: string;
  readonly summary: string;
  readonly text: string;
  readonly dependsOn: readonly string[];
  readonly at: number;
}
export interface NoteRevision {
  readonly id: string;
  readonly summary: string;
  readonly text: string;
  readonly at: number;
}
export interface NotePlan {
  readonly id: string;
  readonly modes: readonly string[];
  readonly at: number;
}
export interface NoteVerdict {
  readonly id: string;
  readonly mode: string;
  readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly report: string;
  readonly at: number;
}
export type Standing = "verified" | "conjecture" | "report" | "refuted";
export interface StandingEntry {
  readonly id: string;
  readonly summary: string;
  readonly standing: Standing;
}
export interface NoteVersion {
  readonly at: number;
  readonly summary: string;
  readonly text: string;
}

const RELATIONS = [
  ":create note {id: String => summary: String, text: String, at: Int}",
  ":create note_history {id: String, at: Int => summary: String, text: String}",
  ":create depends {child: String, parent: String}",
  ":create plan {id: String => modes: String, at: Int}",
  ":create verdict {id: String, mode: String => verdict: String, report: String, at: Int}",
] as const;

export class NoteStore {
  private constructor(private readonly db: InstanceType<typeof CozoDb>) {}

  /** Open a store. `mem` for a fresh rebuildable projection, `sqlite` to persist. */
  static async open(
    engine: "mem" | "sqlite" = "mem",
    path = "",
  ): Promise<NoteStore> {
    const store = new NoteStore(new CozoDb(engine, path));
    for (const relation of RELATIONS) {
      try {
        await store.db.run(relation);
      } catch (error) {
        if (!/exist|conflict/iu.test(cozoMessage(error))) throw error;
      }
    }
    return store;
  }

  /** Fold one mint event. Rejects duplicate ids: the journal never re-mints. */
  async applyMint(event: NoteMint): Promise<void> {
    if (await this.exists(event.id)) {
      throw new Error(`note ${event.id} already minted`);
    }
    await this.putVersion(event.id, event.at, event.summary, event.text);
    if (event.dependsOn.length > 0) {
      await this.db.run(
        "?[child, parent] <- $rows :put depends {child, parent}",
        { rows: event.dependsOn.map((parent) => [event.id, parent]) },
      );
    }
  }

  /** Fold one revision event: a new version; stale plans and verdicts lapse. */
  async applyRevision(event: NoteRevision): Promise<void> {
    if (!(await this.exists(event.id))) {
      throw new Error(`cannot revise unknown note ${event.id}`);
    }
    await this.putVersion(event.id, event.at, event.summary, event.text);
  }

  /** Fold one triage plan. Latest wins; an empty mode list marks a report. */
  async applyPlan(event: NotePlan): Promise<void> {
    if (!(await this.exists(event.id))) {
      throw new Error(`cannot plan unknown note ${event.id}`);
    }
    await this.db.run("?[id, modes, at] <- $rows :put plan {id => modes, at}", {
      rows: [[event.id, JSON.stringify(event.modes), event.at]],
    });
  }

  /** Fold one mode verdict. Latest per (note, mode) wins. */
  async applyVerdict(event: NoteVerdict): Promise<void> {
    if (!(await this.exists(event.id))) {
      throw new Error(`cannot judge unknown note ${event.id}`);
    }
    await this.db.run(
      "?[id, mode, verdict, report, at] <- $rows :put verdict {id, mode => verdict, report, at}",
      { rows: [[event.id, event.mode, event.verdict, event.report, event.at]] },
    );
  }

  /** Derived standing for every note, in mint order. */
  async standings(): Promise<StandingEntry[]> {
    const notes = await this.db.run(
      "?[id, summary, at] := *note{id, summary, at}",
    );
    const plans = await this.db.run("?[id, modes, at] := *plan{id, modes, at}");
    const verdicts = await this.db.run(
      "?[id, mode, verdict, at] := *verdict{id, mode, verdict, at}",
    );
    const planOf = new Map<string, { modes: string[]; at: number }>();
    for (const [id, modes, at] of plans.rows) {
      planOf.set(id as string, {
        modes: JSON.parse(modes as string) as string[],
        at: at as number,
      });
    }
    const verdictsOf = new Map<
      string,
      { mode: string; verdict: string; at: number }[]
    >();
    for (const [id, mode, verdict, at] of verdicts.rows) {
      const list = verdictsOf.get(id as string) ?? [];
      list.push({
        mode: mode as string,
        verdict: verdict as string,
        at: at as number,
      });
      verdictsOf.set(id as string, list);
    }
    const entries: StandingEntry[] = [];
    for (const [id, summary, at] of notes.rows) {
      entries.push({
        id: id as string,
        summary: summary as string,
        standing: deriveStanding(
          at as number,
          planOf.get(id as string),
          verdictsOf.get(id as string) ?? [],
        ),
      });
    }
    return entries.sort((a, b) => noteOrdinal(a.id) - noteOrdinal(b.id));
  }

  /** The index shown to explorers: every non-refuted note with its standing. */
  async liveIndex(): Promise<StandingEntry[]> {
    return (await this.standings()).filter(
      (entry) => entry.standing !== "refuted",
    );
  }

  /** Latest full text of one note, or null when unknown. */
  async text(id: string): Promise<string | null> {
    const result = await this.db.run("?[text] := *note{id, text}, id = $id", {
      id,
    });
    const first = result.rows[0];
    return first === undefined ? null : (first[0] as string);
  }

  /** Every recorded version of a note, oldest first, for replay and audit. */
  async history(id: string): Promise<NoteVersion[]> {
    const result = await this.db.run(
      "?[at, summary, text] := *note_history{id, at, summary, text}, id = $id :order at",
      { id },
    );
    return result.rows.map((row) => ({
      at: row[0] as number,
      summary: row[1] as string,
      text: row[2] as string,
    }));
  }

  /** Verdicts valid for the current version of a note, for reports and audit. */
  async verdicts(id: string): Promise<NoteVerdict[]> {
    const version = await this.db.run("?[at] := *note{id, at}, id = $id", {
      id,
    });
    const current = version.rows[0]?.[0] as number | undefined;
    if (current === undefined) return [];
    const result = await this.db.run(
      "?[mode, verdict, report, at] := *verdict{id, mode, verdict, report, at}, id = $id :order mode",
      { id },
    );
    return result.rows
      .filter((row) => (row[3] as number) > current)
      .map((row) => ({
        id,
        mode: row[0] as string,
        verdict: row[1] as NoteVerdict["verdict"],
        report: row[2] as string,
        at: row[3] as number,
      }));
  }

  /** Transitive dependsOn closure of `id` (its ancestors), via Datalog. */
  async ancestors(id: string): Promise<string[]> {
    const result = await this.db.run(
      `above[p] := *depends{child, parent: p}, child = $id
       above[p] := *depends{child: m, parent: p}, above[m]
       ?[p] := above[p]`,
      { id },
    );
    return result.rows.map((row) => row[0] as string).sort();
  }

  /** Notes resting on `id`, directly or transitively (its dependents). */
  async cascade(id: string): Promise<string[]> {
    const result = await this.db.run(
      `affected[n] := *depends{child: n, parent: p}, p = $id
       affected[n] := *depends{child: n, parent: m}, affected[m]
       ?[n] := affected[n]`,
      { id },
    );
    return result.rows.map((row) => row[0] as string).sort();
  }

  /** True when `id` participates in a dependency cycle. */
  async inCycle(id: string): Promise<boolean> {
    return (await this.ancestors(id)).includes(id);
  }

  close(): void {
    this.db.close();
  }

  private async exists(id: string): Promise<boolean> {
    const result = await this.db.run("?[id] := *note{id}, id = $id", { id });
    return result.rows.length > 0;
  }

  private async putVersion(
    id: string,
    at: number,
    summary: string,
    text: string,
  ): Promise<void> {
    await this.db.run(
      "?[id, summary, text, at] <- $rows :put note {id => summary, text, at}",
      { rows: [[id, summary, text, at]] },
    );
    await this.db.run(
      "?[id, at, summary, text] <- $rows :put note_history {id, at => summary, text}",
      { rows: [[id, at, summary, text]] },
    );
  }
}

function deriveStanding(
  versionAt: number,
  plan: { modes: string[]; at: number } | undefined,
  verdicts: readonly { mode: string; verdict: string; at: number }[],
): Standing {
  const valid = verdicts.filter((entry) => entry.at > versionAt);
  if (valid.some((entry) => entry.verdict === "FAIL")) return "refuted";
  if (plan === undefined || plan.at <= versionAt) return "conjecture";
  if (plan.modes.length === 0) return "report";
  const passed = new Set(
    valid
      .filter((entry) => entry.verdict === "PASS")
      .map((entry) => entry.mode),
  );
  return plan.modes.every((mode) => passed.has(mode))
    ? "verified"
    : "conjecture";
}

function noteOrdinal(id: string): number {
  return Number(id.slice(1));
}

function cozoMessage(error: unknown): string {
  const display = (error as { display?: unknown })?.display;
  return typeof display === "string" ? display : String(error);
}
