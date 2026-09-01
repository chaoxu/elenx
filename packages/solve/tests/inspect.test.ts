import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { callSurface } from "../exploration-protocol";
import { exportAnswer, inspectCampaign } from "../inspect";
import {
  cleanupCampaigns,
  solvedReplies,
  startCampaign,
  turn,
} from "./harness";

afterEach(cleanupCampaigns);

const firstTurn = turn([{ text: "LEMMA_TEXT" }], {
  nextObjective: "OBJECTIVE_ONE",
});

const solved = () =>
  solvedReplies({
    lemma: {
      text: "LEMMA_TEXT",
      summary: "LEMMA_SUMMARY",
      rationale: "carries derivation",
      verdictReport: "LEMMA_OK",
    },
    firstObjective: "OBJECTIVE_ONE",
    serveObjective: "OBJECTIVE_TWO",
    goal: {
      text: "GOAL_TEXT",
      summary: "GOAL_SUMMARY",
      rationale: "the goal claim",
      verdictReport: "GOAL_OK",
    },
    battery: {
      proof: "B_PROOF",
      reconstruction: "B_RECONSTRUCTION",
      refutation: "B_REFUTATION",
      premises: "NO_PREMISES",
      criteria: "B_CRITERIA",
    },
  });

test("inspection exposes the v17 policy on a fresh campaign", async () => {
  const { path } = await startCampaign([]);
  expect(inspectCampaign(path)).toMatchObject({
    protocol: "exploration-v17",
    callSurface,
    phase: "explorer",
    maxIndexTokens: 100_000,
    maxExplorerTurns: 50,
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
  const { path, report } = await startCampaign(solved());
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
    reconstruction: { keyIdeas: [], allowedSources: [] },
    standing: "verified",
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
    ["external-premises", "PASS"],
    ["reconstruction", "PASS"],
    ["refutation", "PASS"],
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
      "Statement: GOAL_SUMMARY",
      "",
      "GOAL_TEXT",
      "",
      "--- [n1] LEMMA_SUMMARY",
      "Statement: LEMMA_SUMMARY",
      "",
      "LEMMA_TEXT",
      "",
    ].join("\n"),
  );
});

test("a paused campaign inspects with its current phase and refuses export", async () => {
  const { path } = await startCampaign([firstTurn]);
  const inspection = inspectCampaign(path);
  expect(inspection.phase).toBe("curation");
  expect(inspection.explorations).toHaveLength(1);
  expect(inspection.curations).toHaveLength(0);
  expect(() => exportAnswer(path)).toThrow("no verified v17 goal");
});

test("inspection gates exact requests behind include-inputs", async () => {
  const { path } = await startCampaign([firstTurn]);
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
  const { path } = await startCampaign([]);
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
