import { Database, SQLiteError } from "bun:sqlite";
import { closeSync, constants, existsSync, openSync, rmSync } from "node:fs";
import { lstatSync, readSync } from "node:fs";
import { basename } from "node:path";
import { isUint8Array } from "node:util/types";

import { ENTRY_KINDS, entry as entrySchema, entryId } from "./schemas";
import type { Entry, EntryDraft, EntryId, Json } from "./types";

const SCHEMA_VERSION = 5;
const ENTRY_KIND_SQL = Object.values(ENTRY_KINDS)
  .map((kind) => `'${kind}'`)
  .join(", ");
const SCHEMA = `
  CREATE TABLE entries (
    seq INTEGER PRIMARY KEY,
    at_ms INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN (${ENTRY_KIND_SQL})),
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
function configure(database: Database): void {
  database.run("PRAGMA synchronous = FULL");
  database.run("PRAGMA journal_mode = DELETE");
}

function copyBytes(value: Uint8Array): Uint8Array {
  if (!isUint8Array(value)) throw new TypeError("candidate must be Uint8Array");
  return new Uint8Array(value);
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

function storedVersion(path: string): number {
  for (const suffix of ["-wal", "-shm"])
    if (lstatSync(path + suffix, { throwIfNoEntry: false }))
      throw new Error("unsupported campaign WAL state");
  const descriptor = openSync(path, constants.O_RDONLY);
  const header = Buffer.alloc(64);
  try {
    const invalid =
      readSync(descriptor, header, 0, header.length, 0) !== header.length ||
      header.toString("utf8", 0, 16) !== "SQLite format 3\0";
    if (invalid) throw new Error("invalid campaign artifact");
    if (header[18] === 2 || header[19] === 2)
      throw new Error("unsupported campaign WAL mode");
    return header.readUInt32BE(60);
  } finally {
    closeSync(descriptor);
  }
}

function open(path: string, create: boolean, readonly = false): Database {
  validatePath(path);
  if (!create && !existsSync(path))
    throw new Error(`campaign does not exist: ${path}`);
  const version = create ? SCHEMA_VERSION : storedVersion(path);
  if (version !== SCHEMA_VERSION)
    throw new Error(`unsupported campaign schema: ${version}`);
  const database = new Database(path, {
    create,
    readonly,
    readwrite: !readonly,
    strict: true,
    safeIntegers: true,
  });
  try {
    database.run("PRAGMA busy_timeout = 5000");
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
    if (!readonly) configure(database);
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
    const sidecars = ["-journal", "-wal", "-shm"].map(
      (suffix) => path + suffix,
    );
    if (sidecars.some((file) => lstatSync(file, { throwIfNoEntry: false })))
      throw new Error(`campaign auxiliary file already exists: ${path}`);
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
      rmSync(path, { force: true });
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
    const storedMaterial = material === undefined ? null : copyBytes(material);
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
    return copyBytes(row.material);
  }

  close(): void {
    this.#database.close(true);
  }
}
