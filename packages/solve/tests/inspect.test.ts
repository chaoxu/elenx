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

test("inspection exposes v14 policy", async () => {
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
  const inspection = inspectCampaign(path);
  expect(inspection).toMatchObject({
    protocol: "exploration-v14",
    phase: "explorer",
    memory: "claims-and-routes",
    claims: [],
    routes: [],
    admissionAudits: [],
    resolutions: [],
    deliveryCandidates: [],
    calls: [],
  });
});

test("inspection gates exact request and tool payloads behind include-inputs", async () => {
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
          rawReport: "A partial factorization attempt.",
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: false,
          citedClaims: [],
        },
      },
    ]),
  );
  expect(inspectCampaign(path).calls[0]).not.toHaveProperty("request");
  const call = inspectCampaign(path, { includeInputs: true }).calls[0]!;
  expect(call.request).toMatchObject({
    protocol: "elenx/pi-run/v1",
    reasoning: "max",
    stopAfterToolResult: true,
    maxRecoveries: 1,
    maxLengthContinuations: 8,
    model: {
      provider: "explorer",
      id: "explorer-v1",
      baseUrl: "https://invalid.test/v1",
    },
  });
  expect(call.declaredTools).toHaveLength(1);
});

test("CLI inspection emits complete JSON", async () => {
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
    protocol: "exploration-v14",
    phase: "explorer",
  });
});
