import {
  existsSync,
  linkSync,
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

function expectRefusal(
  action: () => unknown,
  code: Refusal["code"],
  operation: string,
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Refusal);
    expect(error).toMatchObject({ code, operation });
    return;
  }
  throw new Error("expected action to refuse");
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

    const lock = acquireWriterLock(databasePath, "create-campaign");

    expectRefusal(
      () =>
        acquireWriterLock(join(aliasDirectory, "campaign.db"), "open-campaign"),
      "WRITER_LOCKED",
      "open-campaign",
    );
    expect(existsSync(`${databasePath}.writer-lock`)).toBe(true);

    lock.close();
  });

  test("close releases the lock but preserves its sidecar", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const sidecarPath = `${databasePath}.writer-lock`;
    const first = acquireWriterLock(databasePath, "create-campaign");

    first.close();
    first.close();

    expect(existsSync(sidecarPath)).toBe(true);

    const second = acquireWriterLock(databasePath, "open-campaign");
    second.close();

    expect(existsSync(sidecarPath)).toBe(true);
  });

  test("carries the caller operation on writer contention", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const first = acquireWriterLock(databasePath, "open-campaign");

    expectRefusal(
      () => acquireWriterLock(databasePath, "create-campaign"),
      "WRITER_LOCKED",
      "create-campaign",
    );

    first.close();
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
            acquireWriterLock(${JSON.stringify(databasePath)}, "create-campaign");
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
              acquireWriterLock(${JSON.stringify(databasePath)}, "open-campaign");
              process.exit(0);
            } catch (error) {
              process.exit(error instanceof Refusal && error.code === "WRITER_LOCKED" ? 23 : 24);
            }
          `,
      ]);

      expect(contender.exitCode).toBe(23);

      holder.kill(9);
      await holder.exited;

      const afterKill = acquireWriterLock(databasePath, "open-campaign");
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

    expectRefusal(
      () => acquireWriterLock(aliasPath, "open-campaign"),
      "INVALID_ARGUMENT",
      "open-campaign",
    );
  });

  test("refuses hard-linked database aliases", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const aliasPath = join(directory, "campaign-alias.db");

    writeFileSync(databasePath, "");
    linkSync(databasePath, aliasPath);

    expectRefusal(
      () => acquireWriterLock(databasePath, "open-campaign"),
      "INVALID_ARGUMENT",
      "open-campaign",
    );
    expectRefusal(
      () => acquireWriterLock(aliasPath, "open-campaign"),
      "INVALID_ARGUMENT",
      "open-campaign",
    );
  });

  test("refuses a dangling database symlink", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const aliasPath = join(directory, "campaign-alias.db");

    symlinkSync(databasePath, aliasPath);

    expectRefusal(
      () => acquireWriterLock(aliasPath, "open-campaign"),
      "INVALID_ARGUMENT",
      "open-campaign",
    );
  });

  test("refuses a writer-lock symlink", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const redirectedPath = join(directory, "redirected");

    writeFileSync(redirectedPath, "");
    symlinkSync(redirectedPath, `${databasePath}.writer-lock`);

    expectRefusal(
      () => acquireWriterLock(databasePath, "create-campaign"),
      "INVALID_ARGUMENT",
      "create-campaign",
    );
  });

  test("refuses malformed and unusable database paths with caller operation", () => {
    const directory = temporaryDirectory();

    expectRefusal(
      () => acquireWriterLock("", "create-campaign"),
      "INVALID_ARGUMENT",
      "create-campaign",
    );
    expectRefusal(
      () => acquireWriterLock("bad\0path", "open-campaign"),
      "INVALID_ARGUMENT",
      "open-campaign",
    );
    expectRefusal(
      () =>
        acquireWriterLock(
          join(directory, "missing", "campaign.db"),
          "create-campaign",
        ),
      "INVALID_ARGUMENT",
      "create-campaign",
    );
  });

  test("refuses a hard-linked writer-lock sidecar", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "campaign.db");
    const lockPath = `${databasePath}.writer-lock`;
    const aliasPath = join(directory, "lock-alias");

    writeFileSync(lockPath, "");
    linkSync(lockPath, aliasPath);

    expectRefusal(
      () => acquireWriterLock(databasePath, "create-campaign"),
      "INVALID_ARGUMENT",
      "create-campaign",
    );
  });
});
