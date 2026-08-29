import { afterEach, expect, test } from "bun:test";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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

test("campaign lock resolves path aliases", async () => {
  const path = campaignPath();
  const alias = join(dirname(path), "campaign-alias.db");
  writeFileSync(path, "");
  symlinkSync(basename(path), alias);

  await withCampaignLock(path, async () => {
    await expect(
      withCampaignLock(alias, async () => {
        throw new Error("the alias contender must never run");
      }),
    ).rejects.toThrow("campaign already has a running process");
  });
});
