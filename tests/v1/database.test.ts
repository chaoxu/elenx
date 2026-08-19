import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
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

  test("leaves hot-journal recovery to a writer", async () => {
    const path = temporaryPath();
    const marker = join(dirname(path), "ready");
    createCampaign(path, "test", null).close();
    const fixture = resolve("tests/v1/fixtures/hot-journal.ts");
    const child = Bun.spawn([process.execPath, fixture, path, marker], {
      stdout: "pipe",
      stderr: "pipe",
    });
    for (
      let attempt = 0;
      !existsSync(marker) && attempt < 1_000;
      attempt += 1
    ) {
      await Bun.sleep(5);
    }
    if (!existsSync(marker)) {
      child.kill(9);
      throw new Error("hot-journal fixture did not start");
    }
    child.kill(9);
    await child.exited;
    expect(existsSync(`${path}-journal`)).toBe(true);

    const rawReader = new Database(path, { create: false, readonly: true });
    expect(() => rawReader.query("SELECT * FROM entries").all()).toThrow();
    rawReader.close(true);

    const databaseBefore = readFileSync(path);
    const journalBefore = readFileSync(`${path}-journal`);
    expect(() => openReader(path)).toThrow("campaign recovery required");
    expect(readFileSync(path)).toEqual(databaseBefore);
    expect(readFileSync(`${path}-journal`)).toEqual(journalBefore);

    const writer = openCampaign(path);
    expect(writer.records().map(({ kind }) => kind)).toEqual(["campaign"]);
    writer.close();
    expect(existsSync(`${path}-journal`)).toBe(false);

    const reader = openReader(path);
    expect(reader.records().map(({ kind }) => kind)).toEqual(["campaign"]);
    reader.close();
  });

  test("reopens one campaign for later appends", async () => {
    const path = temporaryPath();
    const first = createCampaign(path, "test", null);
    await first.call({ label: "before-close", request: null }, async () => ({
      done: true,
    }));
    first.close();
    const reopened = openCampaign(path);
    await reopened.call({ label: "after-reopen", request: null }, async () => ({
      done: true,
    }));
    expect(reopened.records().map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "call-result",
      "call",
      "call-result",
    ]);
    reopened.close();
  });

  test("removes an artifact when initial validation fails", () => {
    const path = temporaryPath();
    expect(() => createCampaign(path, "test", undefined as never)).toThrow();
    expect(existsSync(path)).toBe(false);
    const campaign = createCampaign(path, "retry", null);
    expect(campaign.records()).toHaveLength(1);
  });

  test("preserves pre-existing auxiliary files", () => {
    const path = temporaryPath();
    writeFileSync(`${path}-journal`, "not ours");
    expect(() => createCampaign(path, "test", null)).toThrow(
      "auxiliary file already exists",
    );
    expect(readFileSync(`${path}-journal`, "utf8")).toBe("not ours");
    expect(existsSync(path)).toBe(false);

    const dangling = temporaryPath("dangling.db");
    symlinkSync("missing-target", `${dangling}-journal`);
    expect(() => createCampaign(dangling, "test", null)).toThrow(
      "auxiliary file already exists",
    );
    expect(lstatSync(`${dangling}-journal`).isSymbolicLink()).toBe(true);
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

  test("does not reconfigure an unsupported writer", () => {
    const path = temporaryPath();
    const database = new Database(path, { create: true });
    database.run("PRAGMA user_version = 999");
    database.close(true);
    const before = readFileSync(path);
    expect(() => openCampaign(path)).toThrow(
      "unsupported campaign schema: 999",
    );
    expect(readFileSync(path)).toEqual(before);
  });

  test("does not recover an unsupported database", async () => {
    const path = temporaryPath();
    const marker = join(dirname(path), "unsupported-ready");
    createCampaign(path, "test", null).close();
    const database = new Database(path, { create: false, readwrite: true });
    database.run("PRAGMA user_version = 999");
    database.close(true);
    const child = Bun.spawn(
      [
        process.execPath,
        resolve("tests/v1/fixtures/hot-journal.ts"),
        path,
        marker,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    for (let attempt = 0; !existsSync(marker) && attempt < 1_000; attempt += 1)
      await Bun.sleep(5);
    if (!existsSync(marker)) {
      child.kill(9);
      await child.exited;
      throw new Error("hot-journal fixture did not start");
    }
    child.kill(9);
    await child.exited;
    const databaseBefore = readFileSync(path);
    const journalBefore = readFileSync(`${path}-journal`);
    expect(() => openCampaign(path)).toThrow(
      "unsupported campaign schema: 999",
    );
    expect(readFileSync(path)).toEqual(databaseBefore);
    expect(readFileSync(`${path}-journal`)).toEqual(journalBefore);
  });

  test("rejects committed WAL state without changing its files", async () => {
    const path = temporaryPath();
    const marker = join(dirname(path), "wal-ready");
    createCampaign(path, "test", null).close();
    const child = Bun.spawn(
      [
        process.execPath,
        resolve("tests/v1/fixtures/wal-schema.ts"),
        path,
        marker,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    for (let attempt = 0; !existsSync(marker) && attempt < 1_000; attempt += 1)
      await Bun.sleep(5);
    if (!existsSync(marker)) {
      child.kill(9);
      await child.exited;
      throw new Error("WAL fixture did not start");
    }
    child.kill(9);
    await child.exited;
    const files = [path, `${path}-wal`, `${path}-shm`];
    expect(files.every(existsSync)).toBe(true);
    const before = files.map((file) => readFileSync(file));
    for (const opener of [openReader, openCampaign]) {
      expect(() => opener(path)).toThrow("unsupported campaign WAL state");
      expect(files.map((file) => readFileSync(file))).toEqual(before);
    }
  });

  test("rejects a clean WAL-format header without changing it", () => {
    const path = temporaryPath();
    createCampaign(path, "test", null).close();
    const database = new Database(path, { create: false, readwrite: true });
    database.run("PRAGMA journal_mode = WAL");
    database.run("PRAGMA wal_checkpoint(TRUNCATE)");
    database.close(true);
    rmSync(`${path}-wal`);
    rmSync(`${path}-shm`);
    const before = readFileSync(path);
    expect([before[18], before[19]]).toEqual([2, 2]);
    for (const opener of [openReader, openCampaign]) {
      expect(() => opener(path)).toThrow("unsupported campaign WAL mode");
      expect(readFileSync(path)).toEqual(before);
    }
  });

  test("preserves normal and dangling WAL auxiliary entries on open", () => {
    for (const suffix of ["-wal", "-shm"]) {
      const normal = temporaryPath(`normal${suffix}.db`);
      createCampaign(normal, "test", null).close();
      writeFileSync(normal + suffix, "not ours");
      expect(() => openReader(normal)).toThrow(
        "unsupported campaign WAL state",
      );
      expect(readFileSync(normal + suffix, "utf8")).toBe("not ours");

      const dangling = temporaryPath(`dangling${suffix}.db`);
      createCampaign(dangling, "test", null).close();
      symlinkSync("missing-target", dangling + suffix);
      expect(() => openCampaign(dangling)).toThrow(
        "unsupported campaign WAL state",
      );
      expect(lstatSync(dangling + suffix).isSymbolicLink()).toBe(true);
    }
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

  test("persists tool intent before an interrupted tool effect", () => {
    const path = temporaryPath();
    const marker = join(dirname(path), "effect.json");
    const fixture = resolve("tests/v1/fixtures/crash-tool.ts");
    const child = Bun.spawnSync([process.execPath, fixture, path, marker], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    const reader = openReader(path);
    const records = reader.records();
    expect(records.map((entry) => entry.kind)).toEqual([
      "campaign",
      "call",
      "tool-call",
    ]);
    expect(records.at(-1)).toMatchObject({
      source: "provider-effect-1",
      input: { value: "durable" },
    });
    const call = records.find((entry) => entry.kind === "call")!;
    const toolCall = records.find((entry) => entry.kind === "tool-call")!;
    expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({
      call: call.seq,
      toolCall: toolCall.seq,
      source: "provider-effect-1",
    });
    reader.close();
  });
});
