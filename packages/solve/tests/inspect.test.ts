import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { start } from "../exploration";
import { exportAnswer, inspectCampaign } from "../inspect";
import {
  campaignPath,
  candidate,
  cleanupCampaigns,
  criteria,
  dependencies,
  problem,
  runSettings,
} from "./harness";

afterEach(cleanupCampaigns);

const firstTurn = {
  submission: {
    action: "continue",
    findings: [{ text: "EVEN_SUM_LEMMA_TEXT" }, { text: "DOUBLING_TEXT" }],
    nextObjective: "OBJECTIVE_ONE",
  },
} as const;
const firstCuration = {
  submission: {
    filings: [
      { finding: 1, summary: "EVEN_SUM_LEMMA_SUMMARY" },
      { finding: 2, summary: "DOUBLING_SUMMARY" },
    ],
  },
} as const;
const secondTurn = {
  submission: {
    action: "continue",
    findings: [{ text: "SHARPER_LEMMA_TEXT", basedOn: ["n1"] }],
  },
} as const;
const secondCuration = {
  submission: {
    filings: [{ finding: 1, summary: "SHARPER_LEMMA_SUMMARY", refines: "n1" }],
  },
} as const;
const submitTurn = {
  submission: { action: "submit", answer: candidate, basedOn: ["n1"] },
} as const;
const noPremises = {
  submission: { report: "NO_PREMISES", premises: [] },
} as const;
const proofPass = {
  submission: { verdict: "PASS", report: "PROOF_PASS" },
} as const;

const solvedReplies = [
  firstTurn,
  firstCuration,
  secondTurn,
  secondCuration,
  submitTurn,
  noPremises,
  proofPass,
] as const;

test("inspection exposes the v16 policy on a fresh campaign", async () => {
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
    protocol: "exploration-v16",
    phase: "explorer",
    maxIndexTokens: 100_000,
    explorations: [],
    curations: [],
    notes: [],
    candidates: [],
    calls: [],
  });
});

test("inspection reports the notes projection, curations, and candidates", async () => {
  const path = campaignPath();
  await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    dependencies([...solvedReplies]),
  );
  const inspection = inspectCampaign(path);
  expect(inspection).toMatchObject({
    protocol: "exploration-v16",
    phase: "solved",
  });
  expect(inspection.profiles.curator).toMatchObject({ model: "handoff-v1" });
  expect(inspection.indexTokens).toBeGreaterThan(0);

  expect(inspection.explorations).toHaveLength(3);
  expect(inspection.explorations[0]).toMatchObject({
    action: "continue",
    findings: 2,
    nextObjective: "OBJECTIVE_ONE",
  });
  expect(inspection.explorations[2]).toMatchObject({
    action: "submit",
    basedOn: ["n1"],
  });

  expect(inspection.curations).toHaveLength(2);
  expect(inspection.curations[0]).toMatchObject({
    minted: ["n1", "n2"],
    refined: [],
    duplicates: 0,
    invalidations: [],
  });
  expect(inspection.curations[1]).toMatchObject({
    minted: [],
    refined: ["n1"],
  });

  expect(inspection.notes).toHaveLength(2);
  expect(inspection.notes[0]).toMatchObject({
    id: "n1",
    summary: "SHARPER_LEMMA_SUMMARY",
    versions: 2,
  });
  expect(inspection.notes[0]).not.toHaveProperty("invalidated");
  expect(inspection.notes[0]).not.toHaveProperty("text");
  expect(inspectCampaign(path, { includeInputs: true }).notes[0]).toMatchObject(
    { text: "SHARPER_LEMMA_TEXT" },
  );

  expect(inspection.candidates).toHaveLength(1);
  expect(inspection.candidates[0]).toMatchObject({
    answer: candidate,
    basedOn: ["n1"],
    verified: true,
  });
  expect(
    inspection.candidates[0]!.verdicts.map(({ verdict }) => verdict),
  ).toEqual(["PASS", "PASS"]);
  expect(inspection.solution).toBe(inspection.candidates[0]!.id);
  expect(inspection.spend).toBeDefined();

  expect(new TextDecoder().decode(exportAnswer(path))).toBe(candidate);
});

test("a paused campaign inspects with its current phase", async () => {
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
  expect(() => exportAnswer(path)).toThrow("no accepted v16 candidate");
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

test("CLI inspection emits v16 JSON", async () => {
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
    protocol: "exploration-v16",
    phase: "explorer",
  });
});
