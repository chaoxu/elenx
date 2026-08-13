import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runHostileAudit } from "../../examples/v1/hostile-audit";

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true });
  directory = undefined;
});

test("Coverify-shaped reference slice verifies one candidate", async () => {
  directory = mkdtempSync(join(tmpdir(), "elenx-reference-"));
  const report = await runHostileAudit(join(directory, "campaign.db"));
  expect(report).toMatchObject({ verdict: "PASS", verified: true });
});
