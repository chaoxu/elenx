import { Database, SQLiteError } from "bun:sqlite";
import { closeSync, constants, existsSync, openSync, rmSync } from "node:fs";
import { basename } from "node:path";

import { entry as entrySchema, entryId } from "./schemas";
import type { Entry, EntryDraft, EntryId, Json } from "./types";

const SCHEMA_VERSION = 4;
const SCHEMA = `
  CREATE TABLE entries (
    seq INTEGER PRIMARY KEY,
    at_ms INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('campaign', 'candidate', 'call', 'call-result', 'tool-call', 'tool-result', 'verdict')),
    body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body) = 'object'),
    material BLOB CHECK((kind = 'candidate') = (material IS NOT NULL))
  ) STRICT;
  CREATE UNIQUE INDEX one_campaign ON entries(kind) WHERE kind = 'campaign';
  CREATE UNIQUE INDEX one_result ON entries(json_extract(body, '$.parent')) WHERE kind IN ('call-result', 'tool-result');
  CREATE UNIQUE INDEX one_verdict_call ON entries(json_extract(body, '$.call')) WHERE kind = 'verdict';
  CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
  CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
  PRAGMA user_version = ${SCHEMA_VERSION};
`;

interface EntryRow {
  readonly seq: number | bigint;
  readonly atMs: number | bigint;
  readonly kind: string;
  readonly body: string;
}
interface MaterialRow {
  readonly material: Uint8Array;
}
interface VersionRow {
  readonly user_version: number | bigint;
}

function configure(database: Database): void {
  database.run("PRAGMA synchronous = FULL");
  database.run("PRAGMA journal_mode = DELETE");
}

function validatePath(path: string): void {
  if (typeof path !== "string") {
    throw new TypeError("campaign path must be a nonempty filesystem path");
  }
  const leaf = basename(path).toLowerCase();
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path === ":memory:" ||
    path.toLowerCase().startsWith("file:") ||
    ["-wal", "-shm", "-journal"].some((suffix) => leaf.endsWith(suffix))
  ) {
    throw new TypeError("campaign path must be a nonempty filesystem path");
  }
}

function open(path: string, create: boolean, readonly = false): Database {
  validatePath(path);
  if (!create && !existsSync(path))
    throw new Error(`campaign does not exist: ${path}`);
  const database = new Database(path, {
    create,
    readonly,
    readwrite: !readonly,
    strict: true,
    safeIntegers: true,
  });
  try {
    database.run("PRAGMA busy_timeout = 5000");
    if (!readonly) configure(database);
    const rawVersion = database
      .query<VersionRow, []>("PRAGMA user_version")
      .get()?.user_version;
    const version = rawVersion === undefined ? undefined : Number(rawVersion);
    if (!create && version !== SCHEMA_VERSION) {
      throw new Error(`unsupported campaign schema: ${String(version)}`);
    }
    if (!create) {
      const campaign = database
        .query<{ readonly count: number | bigint }, []>(
          "SELECT COUNT(*) AS count FROM entries WHERE seq = 1 AND kind = 'campaign'",
        )
        .get();
      if (Number(campaign?.count ?? 0) !== 1) {
        throw new Error("invalid campaign artifact");
      }
    }
    return database;
  } catch (error) {
    database.close(true);
    throw error;
  }
}

export class Journal {
  readonly #database: Database;

  private constructor(database: Database) {
    this.#database = database;
  }

  static create(path: string, application: string, config: Json): Journal {
    validatePath(path);
    let descriptor: number;
    try {
      descriptor = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
        0o600,
      );
    } catch (error) {
      if (existsSync(path)) throw new Error(`campaign already exists: ${path}`);
      throw error;
    }
    closeSync(descriptor);
    let database: Database | undefined;
    try {
      const created = open(path, true);
      database = created;
      const journal = new Journal(created);
      created
        .transaction(() => {
          created.run(SCHEMA);
          journal.append({ kind: "campaign", application, config });
        })
        .immediate();
      return journal;
    } catch (error) {
      database?.close(true);
      for (const owned of [path, `${path}-journal`]) {
        rmSync(owned, { force: true });
      }
      throw error;
    }
  }

  static open(path: string, access: "read" | "write"): Journal {
    if (access === "write") return new Journal(open(path, false));
    try {
      return new Journal(open(path, false, true));
    } catch (error) {
      if (
        error instanceof SQLiteError &&
        error.code === "SQLITE_READONLY_ROLLBACK"
      ) {
        throw new Error(
          "campaign recovery required: reopen it for writing before reading",
          { cause: error },
        );
      }
      throw error;
    }
  }

  append(draft: EntryDraft, material?: Uint8Array): Entry {
    const atMs = Date.now();
    const checked = entrySchema.parse({ ...draft, seq: 1, atMs });
    const body: Record<string, unknown> = { ...checked };
    delete body.kind;
    delete body.seq;
    delete body.atMs;
    const storedMaterial =
      material === undefined ? null : Uint8Array.from(material);
    const result = this.#database.run(
      "INSERT INTO entries(at_ms, kind, body, material) VALUES (?, ?, ?, ?)",
      [atMs, checked.kind, JSON.stringify(body), storedMaterial],
    );
    return {
      ...checked,
      seq: Number(result.lastInsertRowid),
    };
  }

  records(): readonly Entry[] {
    return this.#database
      .query<EntryRow, []>(
        "SELECT seq, at_ms AS atMs, kind, body FROM entries ORDER BY seq",
      )
      .all()
      .map((row) =>
        entrySchema.parse({
          seq: Number(row.seq),
          atMs: Number(row.atMs),
          kind: row.kind,
          ...JSON.parse(row.body),
        }),
      );
  }

  material(value: EntryId): Uint8Array {
    const candidate = entryId.parse(value);
    const row = this.#database
      .query<MaterialRow, [EntryId]>(
        "SELECT material FROM entries WHERE kind = 'candidate' AND seq = ?",
      )
      .get(candidate);
    if (row === null) throw new Error(`candidate not found: ${candidate}`);
    return Uint8Array.from(row.material);
  }

  close(): void {
    this.#database.close(true);
  }
}
