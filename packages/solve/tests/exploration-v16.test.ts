import { afterEach, describe, expect, test } from "bun:test";

import { resume, start } from "../exploration-v16";
import { type Settings } from "../exploration-v16-protocol";
import {
  campaignPath,
  candidate,
  cleanupCampaigns,
  criteria,
  dependencies,
  explorerModel,
  handoffModel,
  premiseModel,
  problem,
  proofModel,
  sourceModel,
} from "./harness";

afterEach(cleanupCampaigns);

function v16Settings(overrides: Partial<Settings> = {}): Settings {
  const selection = (model: { provider: string; id: string }) => ({
    provider: model.provider,
    model: model.id,
    reasoning: "high" as const,
  });
  return {
    protocol: "exploration-v16",
    maxContextTokens: 200_000,
    maxIndexTokens: 100_000,
    explorerGuidance: [],
    explorer: selection(explorerModel),
    curator: selection(handoffModel),
    premiseVerifier: selection(premiseModel),
    sourceChecker: { model: sourceModel.id, reasoning: "high" },
    proofVerifier: selection(proofModel),
    ...overrides,
  };
}

const firstTurn = {
  submission: {
    action: "continue",
    findings: [
      { text: "EVEN_SUM_LEMMA_TEXT" },
      { text: "DOUBLING_TEXT", basedOn: [] },
    ],
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
    nextObjective: "OBJECTIVE_TWO",
    expand: ["n2"],
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

const happyReplies = [
  firstTurn,
  firstCuration,
  secondTurn,
  secondCuration,
  submitTurn,
  noPremises,
  proofPass,
] as const;

describe("v16 campaign", () => {
  test("curates findings into the index and verifies the exact candidate", async () => {
    const path = campaignPath();
    const deps = dependencies([...happyReplies]);
    const statuses: string[] = [];
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: v16Settings(),
      },
      { ...deps, status: (message) => statuses.push(message) },
    );
    expect(report).toMatchObject({ outcome: "solved" });
    expect(deps.calls).toHaveLength(7);
    expect(deps.sourceCalls).toHaveLength(0);

    expect(statuses[0]).toMatch(/^exploration \(index ~\d+ tokens\)$/u);
    expect(statuses).toContain("curation");

    const firstExplorer = deps.calls[0]!;
    expect(firstExplorer.system).toContain(
      "You are a fresh explorer working on one exact mathematical goal.",
    );
    expect(firstExplorer.prompt).toContain(
      "No earlier exploration context is available.",
    );

    const curation = deps.calls[1]!;
    expect(curation.system).toContain(
      "You are the curator of the durable note index",
    );
    expect(curation.prompt).toContain("EVEN_SUM_LEMMA_TEXT");
    expect(curation.prompt).toContain("DOUBLING_TEXT");

    const secondExplorer = deps.calls[2]!.prompt;
    expect(secondExplorer).toContain("EVEN_SUM_LEMMA_SUMMARY");
    expect(secondExplorer).toContain("DOUBLING_SUMMARY");
    expect(secondExplorer).toContain("EVEN_SUM_LEMMA_TEXT");
    expect(secondExplorer).toContain("DOUBLING_TEXT");
    expect(secondExplorer).toContain("OBJECTIVE_ONE");
    expect(secondExplorer).not.toContain("No earlier exploration context");

    const thirdExplorer = deps.calls[4]!.prompt;
    expect(thirdExplorer).toContain("SHARPER_LEMMA_SUMMARY");
    expect(thirdExplorer).not.toContain("EVEN_SUM_LEMMA_SUMMARY");
    expect(thirdExplorer).toContain("SHARPER_LEMMA_TEXT");
    expect(thirdExplorer).toContain("DOUBLING_TEXT");
    expect(thirdExplorer).toContain("OBJECTIVE_TWO");

    expect(deps.calls[5]!.prompt).toContain(candidate);
    expect(deps.calls[6]!.prompt).toContain(candidate);
  });

  test("a rejected candidate is ingested as a defect and pruned notes leave the index", async () => {
    const path = campaignPath();
    const deps = dependencies([
      {
        submission: {
          action: "continue",
          findings: [{ text: "PARITY_LEMMA_TEXT" }],
          nextObjective: "Prove the lemma.",
        },
      },
      {
        submission: {
          filings: [{ finding: 1, summary: "PARITY_LEMMA_SUMMARY" }],
        },
      },
      { submission: { action: "submit", answer: candidate, basedOn: ["n1"] } },
      noPremises,
      { submission: { verdict: "FAIL", report: "PROOF_DEFECT" } },
      {
        submission: {
          filings: [{ finding: 1, summary: "DEFECT_NOTE_SUMMARY" }],
          invalidations: [
            { note: "n1", cause: "proof audit FAIL: PROOF_DEFECT" },
          ],
        },
      },
      {
        submission: {
          action: "continue",
          findings: [{ text: "RECOVERY_TEXT" }],
          nextObjective: "Recover.",
        },
      },
    ]);
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: v16Settings(),
      },
      deps,
    );
    expect(report).toMatchObject({ outcome: "paused", phase: "curation" });
    expect(deps.calls).toHaveLength(7);

    const defectCuration = deps.calls[5]!.prompt;
    expect(defectCuration).toContain("Verifier defect being ingested");
    expect(defectCuration).toContain("PROOF_DEFECT");
    expect(defectCuration).toContain("PARITY_LEMMA_SUMMARY");

    const repairExplorer = deps.calls[6]!.prompt;
    expect(repairExplorer).toContain(candidate);
    expect(repairExplorer).toContain("PROOF_DEFECT");
    expect(repairExplorer).toContain("DEFECT_NOTE_SUMMARY");
    expect(repairExplorer).not.toContain("PARITY_LEMMA_SUMMARY");
    expect(repairExplorer).not.toContain("PARITY_LEMMA_TEXT");
  });

  test("pause and resume cross every model boundary without repetition", async () => {
    const oneShot = dependencies([...happyReplies]);
    const oneShotPath = campaignPath();
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: oneShotPath,
          settings: v16Settings(),
        },
        oneShot,
      ),
    ).toMatchObject({ outcome: "solved" });

    for (let cut = 0; cut <= happyReplies.length; cut += 1) {
      const path = campaignPath();
      const first = dependencies(happyReplies.slice(0, cut));
      const initial = await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: v16Settings(),
        },
        first,
      );
      const second = dependencies(happyReplies.slice(cut));
      const completed =
        initial.outcome === "solved"
          ? initial
          : await resume(
              { campaignPath: path, settings: v16Settings() },
              second,
            );
      expect(completed.outcome).toBe("solved");
      expect(first.calls.length + second.calls.length).toBe(
        happyReplies.length,
      );
      if (initial.outcome !== "solved" && second.calls.length > 0) {
        const resumedNext = second.calls[0]!;
        const fresh = oneShot.calls[cut]!;
        expect(resumedNext.system).toBe(fresh.system);
        expect(resumedNext.prompt).toBe(fresh.prompt);
        expect(resumedNext.label).toBe(fresh.label);
      }
    }
  });

  test("an index beyond its ceiling ends the campaign with index-limit", async () => {
    const path = campaignPath();
    const oversized = "OVERSIZED_SUMMARY ".repeat(60).trim();
    const deps = dependencies([
      {
        submission: {
          action: "continue",
          findings: [{ text: "LONG_FINDING_TEXT" }],
          nextObjective: "Grow the index.",
        },
      },
      { submission: { filings: [{ finding: 1, summary: oversized }] } },
    ]);
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: v16Settings({ maxIndexTokens: 60 }),
      },
      deps,
    );
    expect(report).toMatchObject({
      outcome: "index-limit",
      phase: "index-limit",
    });
    expect(deps.calls).toHaveLength(2);

    const resumed = dependencies([]);
    expect(
      await resume(
        { campaignPath: path, settings: v16Settings({ maxIndexTokens: 60 }) },
        resumed,
      ),
    ).toMatchObject({ outcome: "index-limit" });
    expect(resumed.calls).toHaveLength(0);
  });
});
