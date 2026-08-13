import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createCampaign, openReader } from "../../src";

const directories: string[] = [];

function temporaryPath(name = "campaign.db"): string {
  const directory = mkdtempSync(join(tmpdir(), "elenx-database-"));
  directories.push(directory);
  return join(directory, name);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

describe("campaign database", () => {
  test("creates a private file without overwriting an existing campaign", () => {
    const path = temporaryPath();
    const campaign = createCampaign(path, "first", null);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => createCampaign(path, "second", null)).toThrow(
      "already exists",
    );
    expect(campaign.records()[0]).toMatchObject({
      kind: "campaign",
      application: "first",
    });
  });

  test("removes an artifact when initial validation fails", () => {
    const path = temporaryPath();
    expect(() => createCampaign(path, "test", undefined as never)).toThrow();
    expect(existsSync(path)).toBe(false);
    const campaign = createCampaign(path, "retry", null);
    expect(campaign.records()).toHaveLength(1);
  });

  test("rejects SQLite URI and auxiliary filenames", () => {
    for (const path of [
      "file:campaign.db",
      "FILE:campaign.db",
      ":memory:",
      temporaryPath("campaign.db-wal"),
      temporaryPath("campaign.db-SHM"),
      temporaryPath("campaign.db-journal"),
    ]) {
      expect(() => createCampaign(path, "test", null)).toThrow(TypeError);
    }
  });

  test("database triggers reject record and blob mutation", () => {
    const path = temporaryPath();
    const campaign = createCampaign(path, "test", null);
    campaign.submitCandidate(new TextEncoder().encode("claim"), ["audit/v1"]);
    campaign.close();
    const database = new Database(path, { create: false, readwrite: true });
    expect(() => database.run("UPDATE entries SET kind = 'campaign'")).toThrow(
      "entries are append-only",
    );
    expect(() => database.run("DELETE FROM blobs")).toThrow(
      "blobs are immutable",
    );
    database.close(true);
  });

  test("reader detects blob tampering by hash", () => {
    const path = temporaryPath();
    const campaign = createCampaign(path, "test", null);
    const candidate = campaign.submitCandidate(
      new TextEncoder().encode("claim"),
      ["audit/v1"],
    );
    campaign.close();
    const database = new Database(path, { create: false, readwrite: true });
    database.run("DROP TRIGGER blobs_no_update");
    database.run("UPDATE blobs SET bytes = ? WHERE hash = ?", [
      new TextEncoder().encode("forged"),
      candidate,
    ]);
    database.close(true);
    const reader = openReader(path);
    expect(() => reader.blob(candidate)).toThrow("hash mismatch");
  });

  test("refuses an unsupported schema", () => {
    const path = temporaryPath();
    const database = new Database(path, { create: true });
    database.run("PRAGMA user_version = 1");
    database.close(true);
    expect(() => openReader(path)).toThrow("unsupported campaign schema: 1");
  });

  test("refuses an artifact without its campaign identity", () => {
    const path = temporaryPath();
    createCampaign(path, "test", null).close();
    const database = new Database(path, { create: false, readwrite: true });
    database.run("DROP TRIGGER entries_no_delete");
    database.run("DELETE FROM entries");
    database.close(true);
    expect(() => openReader(path)).toThrow("invalid campaign artifact");
  });

  test("persists a call start before an interrupted external effect", () => {
    const path = temporaryPath();
    const fixture = resolve("tests/v1/fixtures/crash-call.ts");
    const child = Bun.spawnSync([process.execPath, fixture, path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    const reader = openReader(path);
    expect(reader.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
    ]);
  });
});
