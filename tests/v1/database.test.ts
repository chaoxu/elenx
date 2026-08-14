import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createCampaign, openCampaign, openReader } from "../../src";

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

  test("opens a copied closed campaign as one file", () => {
    const path = temporaryPath("source.db");
    const copy = join(dirname(path), "copy.db");
    createCampaign(path, "test", null).close();
    copyFileSync(path, copy);
    const reader = openReader(copy);
    expect(reader.records()).toHaveLength(1);
    reader.close();
  });

  test("reopens one campaign for serialized concurrent appends", async () => {
    const path = temporaryPath();
    createCampaign(path, "test", null).close();
    const first = openCampaign(path);
    const second = openCampaign(path);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = first.call({ label: "slow", request: null }, async () => {
      await blocked;
      return { done: "slow" };
    });
    const fast = await second.call(
      { label: "fast", request: null },
      async () => ({ done: "fast" }),
    );
    release();
    const settled = await slow;

    expect([settled.call, fast.call]).toEqual([2, 3]);
    expect(first.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "call",
      "call-result",
      "call-result",
    ]);
    expect(
      first
        .records()
        .filter((entry) => entry.kind === "call-result")
        .map((entry) => entry.parent),
    ).toEqual([fast.call, settled.call]);
    first.close();
    second.close();
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

  test("database triggers reject record and material mutation", () => {
    const path = temporaryPath();
    const campaign = createCampaign(path, "test", null);
    campaign.submitCandidate(new TextEncoder().encode("claim"), ["audit/v1"]);
    campaign.close();
    const database = new Database(path, { create: false, readwrite: true });
    expect(() =>
      database.run("UPDATE entries SET material = material"),
    ).toThrow("entries are append-only");
    expect(() => database.run("DELETE FROM entries")).toThrow(
      "entries are append-only",
    );
    database.close(true);
  });

  test("refuses an unsupported schema", () => {
    const path = temporaryPath();
    const database = new Database(path, { create: true });
    database.run("PRAGMA user_version = 3");
    database.close(true);
    expect(() => openReader(path)).toThrow("unsupported campaign schema: 3");
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
