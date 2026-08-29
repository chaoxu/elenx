// The exploration-v16 findings store: a Cozo materialization of note events.
//
// The campaign journal remains the single source of truth. Curator submissions
// recorded there are folded into note events, and this store materializes those
// events for querying: the live index, on-demand full text, and transitive
// dependency cascade. Deleting the store and re-applying the journal's events
// reproduces it exactly; nothing here is authoritative.
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
    ): Promise<{
      rows: unknown[][];
      headers: string[];
    }>;
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
export interface NoteInvalidation {
  readonly id: string;
  readonly verdict: string;
  readonly at: number;
}
export interface IndexEntry {
  readonly id: string;
  readonly summary: string;
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
  ":create invalid {id: String => at: Int, verdict: String}",
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
    const existing = await this.db.run("?[id] := *note{id}, id = $id", {
      id: event.id,
    });
    if (existing.rows.length > 0) {
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

  /** Fold one revision event: append a version; the current view serves it. */
  async applyRevision(event: NoteRevision): Promise<void> {
    const existing = await this.db.run("?[id] := *note{id}, id = $id", {
      id: event.id,
    });
    if (existing.rows.length === 0) {
      throw new Error(`cannot revise unknown note ${event.id}`);
    }
    await this.putVersion(event.id, event.at, event.summary, event.text);
  }

  /** Fold one invalidation event. Idempotent: later verdicts keep the first. */
  async applyInvalidation(event: NoteInvalidation): Promise<void> {
    const existing = await this.db.run("?[id] := *invalid{id}, id = $id", {
      id: event.id,
    });
    if (existing.rows.length > 0) return;
    await this.db.run(
      "?[id, at, verdict] <- $rows :put invalid {id => at, verdict}",
      { rows: [[event.id, event.at, event.verdict]] },
    );
  }

  /** Notes depending on `id`, directly or transitively. */
  async cascade(id: string): Promise<string[]> {
    const result = await this.db.run(
      `affected[n] := *depends{child: n, parent: p}, p = $id
       affected[n] := *depends{child: n, parent: m}, affected[m]
       ?[n] := affected[n]`,
      { id },
    );
    return result.rows.map((row) => row[0] as string).sort();
  }

  /** The index shown to every explorer: latest summaries of live notes. */
  async liveIndex(): Promise<IndexEntry[]> {
    const result = await this.db.run(
      "?[id, summary] := *note{id, summary}, not *invalid{id} :order id",
    );
    return result.rows.map((row) => ({
      id: row[0] as string,
      summary: row[1] as string,
    }));
  }

  /** Invalidated notes with their verdicts, for a curator that shows warnings. */
  async invalidated(): Promise<{ id: string; verdict: string }[]> {
    const result = await this.db.run(
      "?[id, verdict] := *invalid{id, verdict} :order id",
    );
    return result.rows.map((row) => ({
      id: row[0] as string,
      verdict: row[1] as string,
    }));
  }

  /** Latest full text of one live-or-dead note, or null when unknown. */
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

  close(): void {
    this.db.close();
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

function cozoMessage(error: unknown): string {
  const display = (error as { display?: unknown })?.display;
  return typeof display === "string" ? display : String(error);
}
