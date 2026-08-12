import { existsSync } from "node:fs";

import { Database, SQLiteError } from "bun:sqlite";

import { Defect, Refusal, type ErrorRef } from "./errors";
import { assertHash, hashBytes, hashMatches } from "./hash";
import { acquireWriterLock } from "./lock";
import {
  assertRecordDraft,
  makeLogRecord,
  parseLogRecord,
  projectRecordCorrelations,
  recordBlobReferences,
  type LogRecord,
  type RecordDraft,
} from "./records";
import { RECORD_KINDS, type Hash, type RecordSelector } from "./types";

export const DATABASE_SCHEMA_VERSION = 1;

type WriterLock = ReturnType<typeof acquireWriterLock>;
type WriterOperation = Parameters<typeof acquireWriterLock>[1];

const HASH_SQL = `
  length(hash) = 71
  AND substr(hash, 1, 7) = 'sha256:'
  AND substr(hash, 8) NOT GLOB '*[^0-9a-f]*'
`;

const SCHEMA_SQL = `
  BEGIN IMMEDIATE;

  CREATE TABLE blobs (
    hash TEXT PRIMARY KEY CHECK (${HASH_SQL}),
    bytes BLOB NOT NULL
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at_ms INTEGER NOT NULL CHECK (at_ms >= 0),
    kind TEXT NOT NULL CHECK (kind IN (
      'campaign', 'process', 'candidate', 'dispatch',
      'call', 'tool-call', 'tool-result', 'call-result',
      'completion', 'promotion', 'rebuttal', 'event'
    )),
    dispatch TEXT CHECK (dispatch IS NULL OR length(dispatch) > 0),
    name TEXT CHECK (name IS NULL OR length(name) > 0),
    candidate TEXT CHECK (
      candidate IS NULL OR (
        length(candidate) = 71
        AND substr(candidate, 1, 7) = 'sha256:'
        AND substr(candidate, 8) NOT GLOB '*[^0-9a-f]*'
      )
    ),
    body TEXT NOT NULL CHECK (json_valid(body) AND json_type(body) = 'object')
  ) STRICT;

  CREATE INDEX records_kind_seq ON records(kind, seq);
  CREATE INDEX records_dispatch_seq ON records(dispatch, seq)
    WHERE dispatch IS NOT NULL;
  CREATE INDEX records_name_seq ON records(name, seq)
    WHERE name IS NOT NULL;
  CREATE INDEX records_candidate_seq ON records(candidate, seq)
    WHERE candidate IS NOT NULL;

  CREATE UNIQUE INDEX one_campaign ON records(kind)
    WHERE kind = 'campaign';
  CREATE UNIQUE INDEX one_candidate_contract ON records(candidate)
    WHERE kind = 'candidate';
  CREATE UNIQUE INDEX one_dispatch_start ON records(dispatch)
    WHERE kind = 'dispatch';
  CREATE UNIQUE INDEX one_dispatch_completion ON records(dispatch)
    WHERE kind = 'completion';
  CREATE UNIQUE INDEX one_call_start ON records((json_extract(body, '$.id')))
    WHERE kind = 'call';
  CREATE UNIQUE INDEX one_call_result ON records((json_extract(body, '$.call')))
    WHERE kind = 'call-result';
  CREATE UNIQUE INDEX one_tool_call ON records((json_extract(body, '$.invocation')))
    WHERE kind = 'tool-call';
  CREATE UNIQUE INDEX one_tool_result ON records((json_extract(body, '$.invocation')))
    WHERE kind = 'tool-result';
  CREATE UNIQUE INDEX one_promotion ON records(candidate)
    WHERE kind = 'promotion';

  CREATE TRIGGER records_no_update
  BEFORE UPDATE ON records
  BEGIN
    SELECT RAISE(ABORT, 'records are append-only');
  END;

  CREATE TRIGGER records_no_delete
  BEFORE DELETE ON records
  BEGIN
    SELECT RAISE(ABORT, 'records are append-only');
  END;

  CREATE TRIGGER blobs_no_update
  BEFORE UPDATE ON blobs
  BEGIN
    SELECT RAISE(ABORT, 'blobs are immutable');
  END;

  CREATE TRIGGER blobs_no_delete
  BEFORE DELETE ON blobs
  BEGIN
    SELECT RAISE(ABORT, 'blobs are immutable');
  END;

  PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
  COMMIT;
`;

interface StoredBlobRow {
  readonly bytes: unknown;
}

interface StoredRecordRow {
  readonly seq: unknown;
  readonly atMs: unknown;
  readonly kind: unknown;
  readonly dispatch: unknown;
  readonly name: unknown;
  readonly candidate: unknown;
  readonly body: unknown;
}

interface JournalModeRow {
  readonly journal_mode: unknown;
}

interface SchemaVersionRow {
  readonly user_version: unknown;
}

function databaseDefect(operation: string, cause: unknown): Defect {
  return new Defect(
    "DATABASE",
    `SQLite failed while attempting to ${operation}`,
    {
      operation,
      cause,
    },
  );
}

function unsupportedSchema(found: unknown, operation: string): Defect {
  return new Defect(
    "UNSUPPORTED_SCHEMA",
    `Campaign schema version ${String(found)} is unsupported; expected ${DATABASE_SCHEMA_VERSION}`,
    { operation },
  );
}

function closed(operation: string): Refusal {
  return new Refusal("CLOSED", "The campaign database is already closed", {
    operation,
  });
}

function missingCampaign(path: string, operation: string): Refusal {
  return new Refusal("CAMPAIGN_NOT_FOUND", `Campaign does not exist: ${path}`, {
    operation,
  });
}

function assertDatabasePath(path: string, operation: string): void {
  if (typeof path !== "string" || path.length === 0) {
    throw new Refusal("INVALID_ARGUMENT", "Database path must be nonempty", {
      operation,
    });
  }
  if (path.includes("\0")) {
    throw new Refusal("INVALID_ARGUMENT", "Database path contains NUL", {
      operation,
    });
  }
}

function toSafeNumber(value: unknown, label: string): number {
  const number =
    typeof value === "bigint"
      ? value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n
        ? Number(value)
        : Number.NaN
      : value;
  if (!Number.isSafeInteger(number) || (number as number) < 0) {
    throw new Defect("CORRUPT_RECORD", `${label} is not a safe integer`, {
      operation: "read-record",
    });
  }
  return number as number;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function configureWriter(database: Database): void {
  const row = database
    .query<JournalModeRow, []>("PRAGMA journal_mode = WAL")
    .get();
  if (row?.journal_mode !== "wal") {
    throw databaseDefect("enable WAL", row?.journal_mode);
  }
  database.run("PRAGMA synchronous = FULL");
  database.run("PRAGMA recursive_triggers = ON");
}

function checkSchemaVersion(database: Database, operation: string): void {
  let row: SchemaVersionRow | null;
  try {
    row = database.query<SchemaVersionRow, []>("PRAGMA user_version").get();
  } catch (error) {
    throw databaseDefect("read the schema version", error);
  }
  const found = row?.user_version;
  if (found !== BigInt(DATABASE_SCHEMA_VERSION)) {
    throw unsupportedSchema(found, operation);
  }
}

function acquireCampaignLock(
  path: string,
  operation: WriterOperation,
): WriterLock {
  try {
    return acquireWriterLock(path, operation);
  } catch (error) {
    if (error instanceof Refusal) {
      throw new Refusal(error.code, error.message, {
        operation,
        refs: error.refs,
        cause: error,
      });
    }
    if (error instanceof TypeError) {
      throw new Refusal("INVALID_ARGUMENT", error.message, {
        operation,
        cause: error,
      });
    }
    if (error instanceof Defect) throw error;
    throw databaseDefect(operation, error);
  }
}

function closeAfterFailure(
  database: Database | undefined,
  lock: WriterLock | undefined,
): void {
  try {
    database?.close();
  } finally {
    lock?.close();
  }
}

function parseStoredRecord(row: StoredRecordRow): LogRecord {
  try {
    if (typeof row.body !== "string") {
      throw new TypeError("record body is not text");
    }
    const body = JSON.parse(row.body) as unknown;
    const value: Record<string, unknown> = {
      seq: toSafeNumber(row.seq, "record seq"),
      atMs: toSafeNumber(row.atMs, "record timestamp"),
      kind: row.kind,
      body,
    };
    if (row.dispatch !== null) value.dispatch = row.dispatch;
    if (row.name !== null) value.name = row.name;
    if (row.candidate !== null) value.candidate = row.candidate;
    return parseLogRecord(value);
  } catch (error) {
    if (error instanceof Defect) throw error;
    throw new Defect("CORRUPT_RECORD", "Stored record failed validation", {
      operation: "read-record",
      cause: error,
    });
  }
}

function normalizedDraft(draft: RecordDraft): RecordDraft {
  assertRecordDraft(draft);
  const serialized = JSON.stringify(draft);
  const parsed = JSON.parse(serialized) as unknown;
  assertRecordDraft(parsed);
  return parsed;
}

function validateSelector(selector: RecordSelector | undefined): void {
  if (selector === undefined) return;
  if (selector === null || typeof selector !== "object") {
    throw new TypeError("record selector must be an object");
  }
  for (const key of Object.keys(selector)) {
    if (!["kind", "dispatch", "name", "candidate"].includes(key)) {
      throw new TypeError(`record selector has unknown field ${key}`);
    }
  }
  if (
    selector.kind !== undefined &&
    !(RECORD_KINDS as readonly string[]).includes(selector.kind)
  ) {
    throw new TypeError("record selector kind is invalid");
  }
  for (const key of ["dispatch", "name"] as const) {
    const value = selector[key];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length === 0)
    ) {
      throw new TypeError(`record selector ${key} must be a nonempty string`);
    }
  }
  if (selector.candidate !== undefined) {
    assertHash(selector.candidate, "record selector candidate");
  }
}

function recordMatchesSelector(
  record: LogRecord,
  selector: RecordSelector | undefined,
): boolean {
  if (selector === undefined) return true;
  if (selector.kind !== undefined && record.kind !== selector.kind)
    return false;
  for (const key of ["dispatch", "name", "candidate"] as const) {
    const expected = selector[key];
    if (
      expected !== undefined &&
      (!(key in record) || record[key] !== expected)
    ) {
      return false;
    }
  }
  return true;
}

function duplicateRefs(draft: RecordDraft): readonly ErrorRef[] {
  switch (draft.kind) {
    case "campaign":
      return [{ name: draft.body.application }];
    case "process":
    case "event":
      return [];
    case "candidate":
      return [{ candidate: draft.body.material }];
    case "dispatch":
      return [
        draft.body.target === undefined
          ? { dispatch: draft.body.id, name: draft.body.handler }
          : {
              dispatch: draft.body.id,
              name: draft.body.handler,
              candidate: draft.body.target,
            },
      ];
    case "call":
      return [
        {
          call: draft.body.id,
          dispatch: draft.body.dispatch,
          name: draft.body.label,
        },
      ];
    case "tool-call":
    case "tool-result":
      return [
        {
          call: draft.body.call,
          dispatch: draft.body.dispatch,
          invocation: draft.body.invocation,
          name: draft.body.tool,
        },
      ];
    case "call-result":
      return [
        {
          call: draft.body.call,
          dispatch: draft.body.dispatch,
          name: draft.body.label,
        },
      ];
    case "completion":
      return [
        "candidate" in draft.body && draft.body.candidate !== undefined
          ? {
              dispatch: draft.body.dispatch,
              name: draft.body.handler,
              candidate: draft.body.candidate,
            }
          : { dispatch: draft.body.dispatch, name: draft.body.handler },
      ];
    case "promotion":
      return [{ candidate: draft.body.candidate }];
    case "rebuttal":
      return [{ candidate: draft.body.candidate, name: draft.body.verifier }];
  }
}

function duplicateRecordDefect(
  error: unknown,
  draft: RecordDraft,
): Defect | undefined {
  if (
    !(error instanceof SQLiteError) ||
    error.code !== "SQLITE_CONSTRAINT_UNIQUE"
  ) {
    return undefined;
  }

  const starts = new Set<RecordDraft["kind"]>([
    "campaign",
    "candidate",
    "dispatch",
    "call",
    "tool-call",
  ]);
  const terminals = new Set<RecordDraft["kind"]>([
    "completion",
    "call-result",
    "tool-result",
    "promotion",
  ]);
  const code = starts.has(draft.kind)
    ? "DUPLICATE_START"
    : terminals.has(draft.kind)
      ? "DUPLICATE_TERMINAL"
      : undefined;
  if (code === undefined) return undefined;

  return new Defect(code, `Duplicate ${draft.kind} record`, {
    operation: "append-record",
    refs: duplicateRefs(draft),
    cause: error,
  });
}

export class SqliteReader {
  protected readonly database: Database;
  private isClosed = false;

  constructor(database: Database) {
    this.database = database;
  }

  protected assertOpen(operation: string): void {
    if (this.isClosed) throw closed(operation);
  }

  protected checkedBlob(
    hash: Hash,
    operation: string,
    refs: readonly ErrorRef[] = [],
  ): Uint8Array {
    let row: StoredBlobRow | null;
    try {
      row = this.database
        .query<StoredBlobRow, [Hash]>("SELECT bytes FROM blobs WHERE hash = ?")
        .get(hash);
    } catch (error) {
      throw databaseDefect(operation, error);
    }
    if (row === null) {
      throw new Defect("MISSING_BLOB", `Blob is missing: ${hash}`, {
        operation,
        refs,
      });
    }
    if (!(row.bytes instanceof Uint8Array) || !hashMatches(hash, row.bytes)) {
      throw new Defect("HASH_MISMATCH", `Blob bytes do not match ${hash}`, {
        operation,
        refs,
      });
    }
    return row.bytes;
  }

  blob(hash: Hash): Uint8Array {
    this.assertOpen("read-blob");
    assertHash(hash);
    return Uint8Array.from(this.checkedBlob(hash, "read-blob"));
  }

  records(selector?: RecordSelector): readonly LogRecord[] {
    this.assertOpen("read-records");
    validateSelector(selector);

    let rows: readonly StoredRecordRow[];
    try {
      rows = this.database
        .query<
          StoredRecordRow,
          []
        >("SELECT seq, at_ms AS atMs, kind, dispatch, name, candidate, body FROM records ORDER BY seq")
        .all();
    } catch (error) {
      throw databaseDefect("read records", error);
    }

    const records = rows.map(parseStoredRecord);
    for (const record of records) {
      for (const hash of recordBlobReferences(record)) {
        this.checkedBlob(hash, "read-records", [{ seq: record.seq }]);
      }
    }
    return records.filter((record) => recordMatchesSelector(record, selector));
  }

  close(): void {
    if (this.isClosed) return;
    try {
      this.database.close(true);
      this.isClosed = true;
    } catch (error) {
      throw databaseDefect("close the database", error);
    }
  }
}

export class SqliteWriter extends SqliteReader {
  private readonly writerLock: WriterLock;

  constructor(database: Database, writerLock: WriterLock) {
    super(database);
    this.writerLock = writerLock;
  }

  putBlob(bytes: Uint8Array): Hash {
    this.assertOpen("put-blob");
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("blob bytes must be a Uint8Array");
    }
    const hash = hashBytes(bytes);
    try {
      return this.database
        .transaction(() => {
          this.database.run(
            "INSERT OR IGNORE INTO blobs(hash, bytes) VALUES (?, ?)",
            [hash, bytes],
          );
          const row = this.database
            .query<
              StoredBlobRow,
              [Hash]
            >("SELECT bytes FROM blobs WHERE hash = ?")
            .get(hash);
          if (
            row === null ||
            !(row.bytes instanceof Uint8Array) ||
            !hashMatches(hash, row.bytes) ||
            !sameBytes(bytes, row.bytes)
          ) {
            throw new Defect(
              "HASH_MISMATCH",
              `Stored blob does not match ${hash}`,
              { operation: "put-blob" },
            );
          }
          return hash;
        })
        .immediate();
    } catch (error) {
      if (error instanceof Defect) throw error;
      throw databaseDefect("store a blob", error);
    }
  }

  append(draft: RecordDraft): LogRecord {
    this.assertOpen("append-record");
    const snapshot = normalizedDraft(draft);
    const correlations = projectRecordCorrelations(snapshot);
    const body = JSON.stringify(snapshot.body);
    const atMs = Date.now();

    try {
      return this.database
        .transaction(() => {
          for (const hash of recordBlobReferences(snapshot)) {
            this.checkedBlob(hash, "append-record", duplicateRefs(snapshot));
          }

          const result = this.database.run(
            `INSERT INTO records(at_ms, kind, dispatch, name, candidate, body)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              atMs,
              snapshot.kind,
              correlations.dispatch ?? null,
              correlations.name ?? null,
              correlations.candidate ?? null,
              body,
            ],
          );
          const seq = toSafeNumber(result.lastInsertRowid, "record seq");
          return makeLogRecord(seq, atMs, snapshot);
        })
        .immediate();
    } catch (error) {
      if (error instanceof Defect || error instanceof TypeError) throw error;
      const duplicate = duplicateRecordDefect(error, snapshot);
      if (duplicate !== undefined) throw duplicate;
      throw databaseDefect("append a record", error);
    }
  }

  override close(): void {
    super.close();
    this.writerLock.close();
  }
}

export function createSqliteWriter(path: string): SqliteWriter {
  const operation = "create-campaign";
  assertDatabasePath(path, operation);
  const lock = acquireCampaignLock(path, operation);
  let database: Database | undefined;
  try {
    if (existsSync(path)) {
      throw new Refusal("CAMPAIGN_EXISTS", `Campaign already exists: ${path}`, {
        operation,
      });
    }
    database = new Database(path, {
      create: true,
      readwrite: true,
      safeIntegers: true,
      strict: true,
    });
    configureWriter(database);
    database.run(SCHEMA_SQL);
    checkSchemaVersion(database, operation);
    return new SqliteWriter(database, lock);
  } catch (error) {
    closeAfterFailure(database, lock);
    if (error instanceof Defect || error instanceof Refusal) throw error;
    throw databaseDefect(operation, error);
  }
}

export function openSqliteWriter(path: string): SqliteWriter {
  const operation = "open-campaign";
  assertDatabasePath(path, operation);
  if (!existsSync(path)) throw missingCampaign(path, operation);
  const lock = acquireCampaignLock(path, operation);
  let database: Database | undefined;
  try {
    if (!existsSync(path)) throw missingCampaign(path, operation);
    database = new Database(path, {
      create: false,
      readwrite: true,
      safeIntegers: true,
      strict: true,
    });
    checkSchemaVersion(database, operation);
    configureWriter(database);
    return new SqliteWriter(database, lock);
  } catch (error) {
    closeAfterFailure(database, lock);
    if (error instanceof Defect || error instanceof Refusal) throw error;
    throw databaseDefect(operation, error);
  }
}

export function openSqliteReader(path: string): SqliteReader {
  const operation = "open-reader";
  assertDatabasePath(path, operation);
  if (!existsSync(path)) throw missingCampaign(path, operation);
  let database: Database | undefined;
  try {
    database = new Database(path, {
      create: false,
      readonly: true,
      safeIntegers: true,
      strict: true,
    });
    checkSchemaVersion(database, operation);
    return new SqliteReader(database);
  } catch (error) {
    closeAfterFailure(database, undefined);
    if (error instanceof Defect || error instanceof Refusal) throw error;
    throw databaseDefect(operation, error);
  }
}
