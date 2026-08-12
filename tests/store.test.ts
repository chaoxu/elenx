import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";

import { Defect, Refusal } from "../src/core/errors";
import { hashBytes } from "../src/core/hash";
import {
  createSqliteWriter,
  openSqliteReader,
  openSqliteWriter,
  type SqliteReader,
  type SqliteWriter,
} from "../src/core/store";
import type { Hash } from "../src/core/types";

const temporaryDirectories: string[] = [];
const openHandles: { close(): void }[] = [];
const encoder = new TextEncoder();

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "elenx-store-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "campaign.db");
}

function track<T extends { close(): void }>(handle: T): T {
  openHandles.push(handle);
  return handle;
}

function close(handle: { close(): void }): void {
  handle.close();
  const index = openHandles.lastIndexOf(handle);
  if (index !== -1) openHandles.splice(index, 1);
}

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function rawWriter(path: string): Database {
  const database = track(
    new Database(path, {
      create: false,
      readwrite: true,
      safeIntegers: true,
      strict: true,
    }),
  );
  database.run("PRAGMA recursive_triggers = ON");
  return database;
}

function connectionOf(store: SqliteReader | SqliteWriter): Database {
  const connection = Reflect.get(store, "database");
  if (!(connection instanceof Database)) {
    throw new Error("store did not retain its SQLite connection");
  }
  return connection;
}

function expectDefect(
  error: unknown,
  code: Defect["code"],
  operation?: string,
): boolean {
  expect(error).toBeInstanceOf(Defect);
  expect((error as Defect).code).toBe(code);
  if (operation !== undefined)
    expect((error as Defect).operation).toBe(operation);
  return true;
}

function expectRefusal(
  error: unknown,
  code: Refusal["code"],
  operation?: string,
): boolean {
  expect(error).toBeInstanceOf(Refusal);
  expect((error as Refusal).code).toBe(code);
  if (operation !== undefined)
    expect((error as Refusal).operation).toBe(operation);
  return true;
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected action to throw");
}

afterEach(() => {
  for (const handle of openHandles.splice(0).reverse()) {
    try {
      handle.close();
    } catch {
      // A failed assertion must not keep a temporary database open.
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite store", () => {
  test("creates the strict WAL schema with full synchronization", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const database = connectionOf(writer);

    expect(
      database.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get(),
    ).toEqual({ journal_mode: "wal" });
    expect(
      database.query<{ synchronous: bigint }, []>("PRAGMA synchronous").get(),
    ).toEqual({ synchronous: 2n });
    expect(
      database
        .query<{ recursive_triggers: bigint }, []>("PRAGMA recursive_triggers")
        .get(),
    ).toEqual({ recursive_triggers: 1n });
    expect(
      database
        .query<
          { name: string; strict: bigint },
          []
        >("SELECT name, strict FROM pragma_table_list WHERE name IN ('blobs', 'records') ORDER BY name")
        .all(),
    ).toEqual([
      { name: "blobs", strict: 1n },
      { name: "records", strict: 1n },
    ]);
  });

  test("puts blobs idempotently and returns detached, hash-checked bytes", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const original = bytes("immutable material");

    const first = writer.putBlob(original);
    const second = writer.putBlob(Uint8Array.from(original));

    expect(second).toBe(first);
    expect(writer.blob(first)).toEqual(original);
    const returned = writer.blob(first);
    returned[0] = 0;
    expect(writer.blob(first)).toEqual(original);
    expect(
      connectionOf(writer)
        .query<{ count: bigint }, []>("SELECT count(*) AS count FROM blobs")
        .get(),
    ).toEqual({ count: 1n });
  });

  test("append-only triggers reject record and blob mutation", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const material = writer.putBlob(bytes("event attachment"));
    writer.append({
      kind: "event",
      body: { topic: "observation", data: { round: 1 }, blobs: [material] },
    });
    const raw = rawWriter(path);

    expect(() =>
      raw.run("UPDATE records SET name = 'forged' WHERE seq = 1"),
    ).toThrow("records are append-only");
    expect(() => raw.run("DELETE FROM records WHERE seq = 1")).toThrow(
      "records are append-only",
    );
    expect(() =>
      raw.run("UPDATE blobs SET bytes = ? WHERE hash = ?", [
        bytes("replacement"),
        material,
      ]),
    ).toThrow("blobs are immutable");
    expect(() =>
      raw.run("DELETE FROM blobs WHERE hash = ?", [material]),
    ).toThrow("blobs are immutable");
    expect(() =>
      raw.run("INSERT OR REPLACE INTO blobs(hash, bytes) VALUES (?, ?)", [
        material,
        bytes("replacement"),
      ]),
    ).toThrow("blobs are immutable");
  });

  test("detects blob corruption on read", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const hash = writer.putBlob(bytes("expected bytes"));
    const raw = rawWriter(path);

    raw.run("DROP TRIGGER blobs_no_update");
    raw.run("UPDATE blobs SET bytes = ? WHERE hash = ?", [
      bytes("corrupted bytes"),
      hash,
    ]);

    expectDefect(
      thrown(() => writer.blob(hash)),
      "HASH_MISMATCH",
    );
  });

  test("hash-checks every referenced blob before append and selector filtering", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const damaged = writer.putBlob(bytes("damaged later"));
    writer.append({
      kind: "event",
      body: { topic: "damaged", data: null, blobs: [damaged] },
    });
    writer.append({
      kind: "event",
      body: { topic: "selected", data: null, blobs: [] },
    });
    const raw = rawWriter(path);

    raw.run("DROP TRIGGER blobs_no_update");
    raw.run("UPDATE blobs SET bytes = ? WHERE hash = ?", [
      bytes("different bytes"),
      damaged,
    ]);

    const readError = thrown(() => writer.records({ name: "selected" }));
    expectDefect(readError, "HASH_MISMATCH", "read-records");
    expect((readError as Defect).refs).toEqual([{ seq: 1 }]);

    const appendError = thrown(() =>
      writer.append({
        kind: "event",
        body: { topic: "new-reference", data: null, blobs: [damaged] },
      }),
    );
    expectDefect(appendError, "HASH_MISMATCH", "append-record");
    expect(
      connectionOf(writer)
        .query<{ count: bigint }, []>("SELECT count(*) AS count FROM records")
        .get(),
    ).toEqual({ count: 2n });
  });

  test("validates record bodies, derives correlations, and requires blobs", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const input = writer.putBlob(bytes("input"));
    const target = writer.putBlob(bytes("candidate"));

    const record = writer.append({
      kind: "dispatch",
      body: {
        id: "dispatch:one",
        handler: "auditor",
        handlerKind: "verifier",
        input,
        meta: { attempt: 1 },
        target,
      },
    });

    expect(record).toMatchObject({
      seq: 1,
      kind: "dispatch",
      dispatch: "dispatch:one",
      name: "auditor",
      candidate: target,
    });
    expect(
      connectionOf(writer)
        .query<
          { dispatch: string; name: string; candidate: string },
          []
        >("SELECT dispatch, name, candidate FROM records WHERE seq = 1")
        .get(),
    ).toEqual({ dispatch: "dispatch:one", name: "auditor", candidate: target });

    const missing = hashBytes(bytes("not stored"));
    expectDefect(
      thrown(() =>
        writer.append({
          kind: "event",
          body: { topic: "bad-reference", data: null, blobs: [missing] },
        }),
      ),
      "MISSING_BLOB",
    );

    expect(() =>
      writer.append({
        kind: "candidate",
        body: {
          material: target,
          requiredVerifiers: [],
          premises: [],
        },
      }),
    ).toThrow(TypeError);
    expect(writer.records()).toHaveLength(1);
  });

  test("rejects stored bodies whose indexed correlations were forged", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const raw = rawWriter(path);

    raw.run(
      `INSERT INTO records(at_ms, kind, dispatch, name, candidate, body)
       VALUES (?, 'event', NULL, 'forged', NULL, ?)`,
      [Date.now(), JSON.stringify({ topic: "actual", data: null, blobs: [] })],
    );

    expectDefect(
      thrown(() => writer.records({ name: "different" })),
      "CORRUPT_RECORD",
    );
  });

  test("maps duplicate start and terminal records to typed defects", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const input = writer.putBlob(bytes("input"));
    const output = writer.putBlob(bytes("output"));
    const dispatch = {
      kind: "dispatch",
      body: {
        id: "dispatch:duplicate",
        handler: "worker",
        handlerKind: "worker",
        input,
        meta: null,
      },
    } as const;
    writer.append(dispatch);

    const duplicateStart = thrown(() => writer.append(dispatch));
    expectDefect(duplicateStart, "DUPLICATE_START", "append-record");
    expect((duplicateStart as Defect).refs).toEqual([
      { dispatch: "dispatch:duplicate", name: "worker" },
    ]);

    const completion = {
      kind: "completion",
      body: {
        dispatch: "dispatch:duplicate",
        handler: "worker",
        handlerKind: "worker",
        state: "succeeded",
        output,
      },
    } as const;
    writer.append(completion);

    const duplicateTerminal = thrown(() => writer.append(completion));
    expectDefect(duplicateTerminal, "DUPLICATE_TERMINAL", "append-record");
    expect((duplicateTerminal as Defect).refs).toEqual([
      { dispatch: "dispatch:duplicate", name: "worker" },
    ]);
  });

  test("exact selectors combine with AND and preserve append order", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const input = writer.putBlob(bytes("input"));
    const firstTarget = writer.putBlob(bytes("first candidate"));
    const secondTarget = writer.putBlob(bytes("second candidate"));

    writer.append({
      kind: "dispatch",
      body: {
        id: "dispatch:first",
        handler: "audit-a",
        handlerKind: "verifier",
        input,
        meta: null,
        target: firstTarget,
      },
    });
    writer.append({
      kind: "dispatch",
      body: {
        id: "dispatch:second",
        handler: "audit-a",
        handlerKind: "verifier",
        input,
        meta: null,
        target: secondTarget,
      },
    });
    writer.append({
      kind: "dispatch",
      body: {
        id: "dispatch:third",
        handler: "audit-b",
        handlerKind: "verifier",
        input,
        meta: null,
        target: firstTarget,
      },
    });

    expect(writer.records().map((record) => record.seq)).toEqual([1, 2, 3]);
    expect(
      writer
        .records({
          kind: "dispatch",
          name: "audit-a",
          candidate: firstTarget,
        })
        .map((record) => record.dispatch),
    ).toEqual(["dispatch:first"]);
    expect(
      writer.records({ dispatch: "dispatch:third", candidate: secondTarget }),
    ).toEqual([]);
  });

  test("a reader opened before an append observes it and is descriptor-readonly", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    const reader = track(openSqliteReader(path));

    expect(reader.records()).toEqual([]);
    writer.append({
      kind: "event",
      body: { topic: "later", data: { visible: true }, blobs: [] },
    });
    expect(reader.records({ kind: "event", name: "later" })).toHaveLength(1);
    expect(() =>
      connectionOf(reader).run(
        "INSERT INTO records(at_ms, kind, body) VALUES (?, 'event', ?)",
        [Date.now(), JSON.stringify({ topic: "write", data: null, blobs: [] })],
      ),
    ).toThrow("readonly");
  });

  test("create, open, lock, and close have distinct behavior", () => {
    const path = temporaryDatabase();

    expectRefusal(
      thrown(() => openSqliteWriter(path)),
      "CAMPAIGN_NOT_FOUND",
    );
    expectRefusal(
      thrown(() => openSqliteReader(path)),
      "CAMPAIGN_NOT_FOUND",
    );

    const first = track(createSqliteWriter(path));
    expect(existsSync(path)).toBe(true);
    expectRefusal(
      thrown(() => createSqliteWriter(path)),
      "WRITER_LOCKED",
      "create-campaign",
    );
    expectRefusal(
      thrown(() => openSqliteWriter(path)),
      "WRITER_LOCKED",
      "open-campaign",
    );

    close(first);
    const reopened = track(openSqliteWriter(path));
    reopened.append({
      kind: "event",
      body: { topic: "reopened", data: null, blobs: [] },
    });
    close(reopened);

    const reader = track(openSqliteReader(path));
    expect(reader.records({ name: "reopened" })).toHaveLength(1);
    close(reader);
    expectRefusal(
      thrown(() => reader.records()),
      "CLOSED",
    );
  });

  test("refuses unsupported schemas and releases a failed writer lock", () => {
    const path = temporaryDatabase();
    const writer = track(createSqliteWriter(path));
    close(writer);
    const raw = rawWriter(path);
    raw.run("PRAGMA user_version = 2");
    close(raw);

    expectDefect(
      thrown(() => openSqliteReader(path)),
      "UNSUPPORTED_SCHEMA",
    );
    expectDefect(
      thrown(() => openSqliteWriter(path)),
      "UNSUPPORTED_SCHEMA",
    );
    expectDefect(
      thrown(() => openSqliteWriter(path)),
      "UNSUPPORTED_SCHEMA",
    );
  });

  test("refuses creation over an existing non-campaign file without retaining a lock", () => {
    const path = temporaryDatabase();
    writeFileSync(path, "not a campaign");

    expectRefusal(
      thrown(() => createSqliteWriter(path)),
      "CAMPAIGN_EXISTS",
      "create-campaign",
    );
    expectRefusal(
      thrown(() => createSqliteWriter(path)),
      "CAMPAIGN_EXISTS",
    );
  });

  test("types and relabels invalid paths at each factory boundary", () => {
    const path = temporaryDatabase();
    const directory = join(path, "..");

    expectRefusal(
      thrown(() => createSqliteWriter("")),
      "INVALID_ARGUMENT",
      "create-campaign",
    );
    expectRefusal(
      thrown(() => createSqliteWriter(directory)),
      "INVALID_ARGUMENT",
      "create-campaign",
    );
    expectRefusal(
      thrown(() => openSqliteWriter(directory)),
      "INVALID_ARGUMENT",
      "open-campaign",
    );
    expectDefect(
      thrown(() => openSqliteReader(directory)),
      "DATABASE",
      "open-reader",
    );
  });
});
