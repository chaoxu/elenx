import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";

import { Refusal } from "../src/core/errors";
import { acquireWriterLock } from "../src/core/lock";

const temporaryDirectories: string[] = [];
const lockModuleUrl = pathToFileURL(
  join(import.meta.dir, "../src/core/lock.ts"),
).href;

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "elenx-lock-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("writer lock", () => {
  test("canonicalizes database aliases to one sidecar", () => {
    const directory = temporaryDirectory();
    const realDirectory = join(directory, "real");
    const aliasDirectory = join(directory, "alias");
    const databasePath = join(realDirectory, "campaign.db");

    mkdirSync(realDirectory);
    symlinkSync(realDirectory, aliasDirectory);

    const lock = acquireWriterLock(databasePath);

    expect(() =>
      acquireWriterLock(join(aliasDirectory, "campaign.db")),
    ).toThrow(Refusal);
    expect(existsSync(`${databasePath}.writer-lock`)).toBe(true);

    lock.close();
  });

  test("close releases the lock but preserves its sidecar", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const sidecarPath = `${databasePath}.writer-lock`;
    const first = acquireWriterLock(databasePath);

    first.close();
    first.close();

    expect(existsSync(sidecarPath)).toBe(true);

    const second = acquireWriterLock(databasePath);
    second.close();

    expect(existsSync(sidecarPath)).toBe(true);
  });

  test("refuses a second process and releases after SIGKILL", async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const holder = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
            import { acquireWriterLock } from ${JSON.stringify(lockModuleUrl)};
            acquireWriterLock(${JSON.stringify(databasePath)});
            process.stdout.write("locked\\n");
            await Bun.sleep(60_000);
          `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    try {
      const ready = await holder.stdout.getReader().read();
      expect(new TextDecoder().decode(ready.value)).toBe("locked\n");

      const contender = Bun.spawnSync([
        process.execPath,
        "-e",
        `
            import { acquireWriterLock } from ${JSON.stringify(lockModuleUrl)};
            import { Refusal } from ${JSON.stringify(pathToFileURL(join(import.meta.dir, "../src/core/errors.ts")).href)};
            try {
              acquireWriterLock(${JSON.stringify(databasePath)});
              process.exit(0);
            } catch (error) {
              process.exit(error instanceof Refusal && error.code === "WRITER_LOCKED" ? 23 : 24);
            }
          `,
      ]);

      expect(contender.exitCode).toBe(23);

      holder.kill(9);
      await holder.exited;

      const afterKill = acquireWriterLock(databasePath);
      afterKill.close();
    } finally {
      if (holder.exitCode === null) {
        holder.kill(9);
        await holder.exited;
      }
    }
  }, 10_000);

  test("canonicalizes an existing database symlink", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const aliasPath = join(directory, "campaign-alias.db");

    writeFileSync(databasePath, "");
    symlinkSync(databasePath, aliasPath);

    const lock = acquireWriterLock(databasePath);

    expect(() => acquireWriterLock(aliasPath)).toThrow(Refusal);

    lock.close();
  });
});
