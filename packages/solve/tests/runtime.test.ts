import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { coordinatorState } from "../inspect";
import { withCoordinatorLock } from "../runtime";
import { campaignPath, cleanupCampaigns } from "./harness";

afterEach(cleanupCampaigns);

test("only one coordinator may own a campaign", async () => {
  const path = campaignPath();
  await withCoordinatorLock(path, async () => {
    expect(existsSync(`${path}.coordinator.lock`)).toBe(true);
    await expect(
      withCoordinatorLock(path, async () => {
        throw new Error("the contender must never run");
      }),
    ).rejects.toThrow("campaign already has a running coordinator");
  });
});

test("coordinator state is read-only and distinguishes an active owner", async () => {
  const path = campaignPath();
  const lockPath = `${path}.coordinator.lock`;
  expect(coordinatorState(path)).toBe("not-running");
  expect(existsSync(lockPath)).toBe(false);

  await withCoordinatorLock(path, async () => {
    const before = readFileSync(lockPath);
    const modifiedAtMs = statSync(lockPath).mtimeMs;
    expect(coordinatorState(path)).toBe("running");
    expect(readFileSync(lockPath)).toEqual(before);
    expect(statSync(lockPath).mtimeMs).toBe(modifiedAtMs);
  });

  expect(coordinatorState(path)).toBe("not-running");
});

test("coordinator state shares canonical path handling with lock ownership", async () => {
  const path = campaignPath();
  const alias = join(dirname(path), "campaign-alias.db");
  writeFileSync(path, "");
  symlinkSync(basename(path), alias);

  await withCoordinatorLock(path, async () => {
    expect(coordinatorState(alias)).toBe("running");
    await expect(
      withCoordinatorLock(alias, async () => {
        throw new Error("the alias contender must never run");
      }),
    ).rejects.toThrow("campaign already has a running coordinator");
  });
});

test("coordinator state does not follow a symlinked lock", () => {
  const path = campaignPath();
  const target = join(dirname(path), "other.lock");
  writeFileSync(target, "");
  symlinkSync(basename(target), `${path}.coordinator.lock`);
  expect(coordinatorState(path)).toBe("unknown");
  expect(readFileSync(target)).toEqual(Buffer.from(""));
});
