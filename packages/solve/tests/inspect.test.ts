import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { start } from "../exploration";
import { inspectCampaign } from "../inspect";
import {
  campaignPath,
  cleanupCampaigns,
  criteria,
  dependencies,
  problem,
  runSettings,
} from "./harness";

afterEach(cleanupCampaigns);

test("inspection exposes the v15 policy", async () => {
  const path = campaignPath();
  await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    dependencies([]),
  );
  expect(inspectCampaign(path)).toMatchObject({
    protocol: "exploration-v15",
    phase: "explorer",
    maxHandoffTokens: 24_000,
    explorations: [],
    handoffs: [],
    candidates: [],
    calls: [],
  });
});

test("inspection gates exact requests behind include-inputs", async () => {
  const path = campaignPath();
  await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    dependencies([
      {
        submission: {
          action: "continue",
          notes: ["one note"],
          nextObjective: "continue",
          selectedNotes: [],
        },
      },
    ]),
  );
  expect(inspectCampaign(path).calls[0]).not.toHaveProperty("request");
  const call = inspectCampaign(path, { includeInputs: true }).calls[0]!;
  expect(call.request).toMatchObject({
    protocol: "elenx/pi-run/v1",
    reasoning: "high",
    model: { provider: "explorer", id: "explorer-v1" },
  });
  expect(call.declaredTools).toHaveLength(1);
});

test("CLI inspection emits v15 JSON", async () => {
  const path = campaignPath();
  await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    dependencies([]),
  );
  const result = spawnSync(process.execPath, ["solve.ts", "inspect", path], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    protocol: "exploration-v15",
    phase: "explorer",
  });
});
