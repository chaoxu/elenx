import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { campaignState } from "../inspect";
import { withCampaignLock } from "../runtime";
import { campaignPath, cleanupCampaigns } from "./harness";

afterEach(cleanupCampaigns);

test("only one process may own a campaign", async () => {
  const path = campaignPath();
  await withCampaignLock(path, async () => {
    expect(existsSync(`${path}.runner.lock`)).toBe(true);
    await expect(
      withCampaignLock(path, async () => {
        throw new Error("the contender must never run");
      }),
    ).rejects.toThrow("campaign already has a running process");
  });
});

test("campaign state is read-only and distinguishes an active owner", async () => {
  const path = campaignPath();
  const lockPath = `${path}.runner.lock`;
  expect(campaignState(path)).toBe("not-running");
  expect(existsSync(lockPath)).toBe(false);

  await withCampaignLock(path, async () => {
    const before = readFileSync(lockPath);
    const modifiedAtMs = statSync(lockPath).mtimeMs;
    expect(campaignState(path)).toBe("running");
    expect(readFileSync(lockPath)).toEqual(before);
    expect(statSync(lockPath).mtimeMs).toBe(modifiedAtMs);
  });

  expect(campaignState(path)).toBe("not-running");
});

test("campaign state shares canonical path handling with lock ownership", async () => {
  const path = campaignPath();
  const alias = join(dirname(path), "campaign-alias.db");
  writeFileSync(path, "");
  symlinkSync(basename(path), alias);

  await withCampaignLock(path, async () => {
    expect(campaignState(alias)).toBe("running");
    await expect(
      withCampaignLock(alias, async () => {
        throw new Error("the alias contender must never run");
      }),
    ).rejects.toThrow("campaign already has a running process");
  });
});

test("campaign state does not follow a symlinked lock", () => {
  const path = campaignPath();
  const target = join(dirname(path), "other.lock");
  writeFileSync(target, "");
  symlinkSync(basename(target), `${path}.runner.lock`);
  expect(campaignState(path)).toBe("unknown");
  expect(readFileSync(target)).toEqual(Buffer.from(""));
});
