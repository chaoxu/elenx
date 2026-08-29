import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { start } from "../exploration";
import { exportAnswer, inspectCampaign } from "../inspect";
import {
  campaignPath,
  cleanupCampaigns,
  criteria,
  dependencies,
  problem,
  runSettings,
} from "./harness";

afterEach(cleanupCampaigns);

const firstTurn = {
  submission: {
    findings: [{ text: "LEMMA_TEXT" }],
    nextObjective: "OBJECTIVE_ONE",
  },
} as const;
const firstCuration = {
  submission: { filings: [{ finding: 1, summary: "LEMMA_SUMMARY" }] },
} as const;
const firstTriage = {
  submission: {
    plans: [
      { note: "n1", modes: ["proof-audit"], rationale: "carries derivation" },
    ],
  },
} as const;
const lemmaVerdict = {
  submission: { verdict: "PASS", report: "LEMMA_OK" },
} as const;
const firstServe = {
  submission: { expand: ["n1"], objective: "OBJECTIVE_TWO" },
} as const;
const secondTurn = {
  submission: { findings: [{ text: "GOAL_TEXT", basedOn: ["n1"] }] },
} as const;
const secondCuration = {
  submission: { filings: [{ finding: 1, summary: "GOAL_SUMMARY" }] },
} as const;
const secondTriage = {
  submission: {
    plans: [
      { note: "n2", modes: ["proof-audit"], rationale: "the goal claim" },
    ],
  },
} as const;
const goalVerdict = {
  submission: { verdict: "PASS", report: "GOAL_OK" },
} as const;
const goalServe = { submission: { goalNote: "n2" } } as const;
const batteryPass = (report: string) =>
  ({ submission: { verdict: "PASS", report } }) as const;
const noPremises = {
  submission: { report: "NO_PREMISES", premises: [] },
} as const;

const solvedReplies = [
  firstTurn,
  firstCuration,
  firstTriage,
  lemmaVerdict,
  firstServe,
  secondTurn,
  secondCuration,
  secondTriage,
  goalVerdict,
  goalServe,
  batteryPass("B_PROOF"),
  batteryPass("B_RECONSTRUCTION"),
  batteryPass("B_REFUTATION"),
  noPremises,
  batteryPass("B_CRITERIA"),
] as const;

test("inspection exposes the v17 policy on a fresh campaign", async () => {
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
    protocol: "exploration-v17",
    phase: "explorer",
    maxIndexTokens: 100_000,
    explorations: [],
    curations: [],
    triages: [],
    verdicts: [],
    serves: [],
    notes: [],
    candidates: [],
    calls: [],
  });
  expect(inspectCampaign(path).profiles.triage).toMatchObject({
    model: "triage-v1",
  });
});

test("inspection reports the verified tower and export unfolds it", async () => {
  const path = campaignPath();
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    dependencies([...solvedReplies]),
  );
  expect(report.outcome).toBe("solved");

  const inspection = inspectCampaign(path);
  expect(inspection).toMatchObject({
    protocol: "exploration-v17",
    phase: "solved",
  });
  expect(inspection.indexTokens).toBeGreaterThan(0);

  expect(inspection.explorations).toHaveLength(2);
  expect(inspection.explorations[0]).toMatchObject({
    findings: 1,
    nextObjective: "OBJECTIVE_ONE",
  });

  expect(inspection.curations).toHaveLength(2);
  expect(inspection.curations[0]).toMatchObject({
    minted: ["n1"],
    refined: [],
    duplicates: 0,
  });
  expect(inspection.curations[1]).toMatchObject({ minted: ["n2"] });

  expect(inspection.triages).toHaveLength(2);
  expect(inspection.triages[0]!.plans).toEqual([
    { note: "n1", modes: ["proof-audit"] },
  ]);

  expect(inspection.verdicts).toEqual([
    expect.objectContaining({
      note: "n1",
      mode: "proof-audit",
      verdict: "PASS",
    }),
    expect.objectContaining({
      note: "n2",
      mode: "proof-audit",
      verdict: "PASS",
    }),
  ]);
  expect(inspection.verdicts[0]).not.toHaveProperty("report");

  expect(inspection.serves).toHaveLength(2);
  expect(inspection.serves[0]).toMatchObject({
    expand: ["n1"],
    objective: "OBJECTIVE_TWO",
  });
  expect(inspection.serves[1]).toMatchObject({ goalNote: "n2" });

  expect(inspection.notes).toHaveLength(2);
  expect(inspection.notes[0]).toMatchObject({
    id: "n1",
    summary: "LEMMA_SUMMARY",
    standing: "verified",
    versions: 1,
  });
  expect(inspection.notes[1]).toMatchObject({
    id: "n2",
    standing: "verified",
    parents: ["n1"],
  });
  expect(inspection.notes[0]).not.toHaveProperty("text");
  expect(inspection).not.toHaveProperty("mechanicalGaps");

  expect(inspection.candidates).toHaveLength(1);
  expect(inspection.candidates[0]).toMatchObject({
    goalNote: "n2",
    verified: true,
  });
  expect(
    inspection.candidates[0]!.verdicts.map(({ mode, verdict }) => [
      mode,
      verdict,
    ]),
  ).toEqual([
    ["proof-audit", "PASS"],
    ["reconstruction", "PASS"],
    ["refutation", "PASS"],
    ["external-premises", "PASS"],
    ["criteria-match", "PASS"],
  ]);
  expect(inspection.solution).toBe(inspection.candidates[0]!.id);
  expect(inspection.spend).toBeDefined();

  const withInputs = inspectCampaign(path, { includeInputs: true });
  expect(withInputs.notes[0]).toMatchObject({ text: "LEMMA_TEXT" });
  expect(withInputs.verdicts[0]).toMatchObject({ report: "LEMMA_OK" });

  expect(new TextDecoder().decode(exportAnswer(path))).toBe(
    [
      "[n2] GOAL_SUMMARY",
      "",
      "GOAL_TEXT",
      "",
      "--- [n1] LEMMA_SUMMARY",
      "",
      "LEMMA_TEXT",
      "",
    ].join("\n"),
  );
});

test("a paused campaign inspects with its current phase and refuses export", async () => {
  const path = campaignPath();
  await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    dependencies([firstTurn]),
  );
  const inspection = inspectCampaign(path);
  expect(inspection.phase).toBe("curation");
  expect(inspection.explorations).toHaveLength(1);
  expect(inspection.curations).toHaveLength(0);
  expect(() => exportAnswer(path)).toThrow("no verified v17 goal");
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
    dependencies([firstTurn]),
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

test("CLI inspection emits v17 JSON", async () => {
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
    protocol: "exploration-v17",
    phase: "explorer",
  });
});
