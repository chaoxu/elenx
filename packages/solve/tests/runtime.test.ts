import { afterEach, expect, test } from "bun:test";
import { existsSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { withCampaignLock } from "../runtime";
import { run } from "../runner";
import {
  campaignPath,
  cleanupCampaigns,
  dependencies,
  roleSettings,
} from "./harness";

afterEach(cleanupCampaigns);

test("run honors an injected source executor instead of invoking the CLI", async () => {
  const path = campaignPath();
  const previous = process.env["ELENX_CODEX_COMMAND"];
  process.env["ELENX_CODEX_COMMAND"] = join(
    dirname(path),
    "codex-must-not-run",
  );
  try {
    const drive = dependencies([
      { submission: { notes: [{ text: "Proof of P.", support: [] }] } },
      {
        submission: {
          filings: [{ note: "n1", summary: "P holds." }],
          objective: "Prove P.",
          support: [],
          verify: [{ note: "n1", verifiers: ["source", "correctness"] }],
        },
      },
      {
        codex: {
          verdicts: [
            {
              note: "n1",
              verdict: "INCONCLUSIVE",
              report: "Source unavailable.",
              sources: [],
            },
          ],
        },
      },
    ]);
    expect(
      await run(
        {
          task: { problem: "Prove P.", completionCriteria: "Prove P fully." },
          campaignPath: path,
          settings: roleSettings(),
        },
        drive,
      ),
    ).toMatchObject({ outcome: "paused", at: "verifier" });
    expect(drive.codexCalls).toHaveLength(1);
    expect(drive.calls).toHaveLength(2);
  } finally {
    if (previous === undefined) delete process.env["ELENX_CODEX_COMMAND"];
    else process.env["ELENX_CODEX_COMMAND"] = previous;
  }
});

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
