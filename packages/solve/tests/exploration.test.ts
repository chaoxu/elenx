import { afterEach, expect, test } from "bun:test";

import { openReader } from "elenx";

import { resume, start } from "../exploration";
import {
  campaignPath,
  cleanupCampaigns,
  criteria,
  dependencies,
  problem,
  runSettings,
  type Reply,
} from "./harness";

afterEach(cleanupCampaigns);

const lemmaText =
  "Every even integer equals 2k for an integer k, by definition of evenness.";
const routeText =
  "Plan: derive the goal by writing both summands in the 2k form and factoring.";
const goalText =
  "Let a and b be even integers. Then a=2r and b=2s for integers r and s, so a+b=2(r+s) with r+s an integer. Therefore a+b is even.";

function happyReplies(): Reply[] {
  return [
    // turn 1: explorer reports a claim and a process note
    {
      submission: {
        findings: [{ text: lemmaText }, { text: routeText, basedOn: [] }],
      },
    },
    // curation mints n1 (claim) and n2 (process note)
    {
      submission: {
        filings: [
          { finding: 1, summary: "lemma: an even integer is 2k" },
          { finding: 2, summary: "plan: factor the 2k forms" },
        ],
      },
    },
    // triage: n1 gets a proof audit, n2 is a report
    {
      submission: {
        plans: [
          { note: "n1", modes: ["proof-audit"], rationale: "own derivation" },
          { note: "n2", modes: [], rationale: "process note" },
        ],
      },
    },
    // n1 proof audit passes
    { submission: { verdict: "PASS", report: "derivation holds" } },
    // serve: expand n1, set the objective
    {
      submission: { expand: ["n1"], objective: "state the goal from n1" },
    },
    // turn 2: explorer states the goal, resting on n1
    { submission: { findings: [{ text: goalText, basedOn: ["n1"] }] } },
    // curation mints n3
    {
      submission: {
        filings: [
          { finding: 1, summary: "goal: the sum of two even integers is even" },
        ],
      },
    },
    // triage plans n3
    {
      submission: {
        plans: [
          { note: "n3", modes: ["proof-audit"], rationale: "goal derivation" },
        ],
      },
    },
    // n3 proof audit passes
    { submission: { verdict: "PASS", report: "goal derivation holds" } },
    // serve declares the goal
    { submission: { goalNote: "n3" } },
    // boundary battery, in boundaryModes order
    { submission: { verdict: "PASS", report: "boundary proof audit holds" } },
    {
      submission: { verdict: "PASS", report: "independent derivation agrees" },
    },
    { submission: { verdict: "PASS", report: "no counterexample found" } },
    { submission: { report: "No external premises.", premises: [] } },
    {
      submission: { verdict: "PASS", report: "statement matches the criteria" },
    },
  ];
}

const happyTotal = 15;

test("a full cycle mints, triages, verifies, serves, and solves at the boundary", async () => {
  const path = campaignPath();
  const drive = dependencies(happyReplies());
  const statuses: string[] = [];
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    { ...drive, status: (message) => statuses.push(message) },
  );

  expect(report.outcome).toBe("solved");
  expect(report.candidate).toBeDefined();
  expect(drive.calls).toHaveLength(happyTotal);
  expect(drive.sourceCalls).toHaveLength(0);

  // call order by label
  const labels = drive.calls.map((call) => call.label);
  const p = "elenx-solve/exploration-v17";
  expect(labels[0]).toBe(`${p}/explorer/initial`);
  expect(labels[2]).toMatch(new RegExp(`^${p}/triage/`));
  expect(labels[3]).toMatch(new RegExp(`^${p}/verify/n1/proof-audit/`));
  expect(labels[4]).toMatch(new RegExp(`^${p}/serve/`));
  expect(labels[5]).toMatch(new RegExp(`^${p}/explorer/`));
  expect(labels.slice(10)).toEqual([
    `${p}/candidate/proof-audit`,
    `${p}/candidate/reconstruction`,
    `${p}/candidate/refutation`,
    `${p}/candidate/external-premises`,
    `${p}/candidate/criteria-match`,
  ]);

  // the second explorer sees standings, the expanded text, and the objective
  const secondExplorer = drive.calls[5]!.prompt;
  expect(secondExplorer).toContain('"standing": "verified"');
  expect(secondExplorer).toContain('"standing": "report"');
  expect(secondExplorer).toContain("lemma: an even integer is 2k");
  expect(secondExplorer).toContain(lemmaText);
  expect(secondExplorer).toContain("state the goal from n1");

  // boundary verify prompts carry the goal text; reconstruction withholds it
  expect(drive.calls[10]!.prompt).toContain(goalText);
  expect(drive.calls[11]!.prompt).not.toContain(goalText);
  expect(drive.calls[11]!.prompt).toContain(
    "goal: the sum of two even integers is even",
  );

  // the goal note's basedOn premises reach the boundary premise auditor as
  // established givens, and the system prompt carries the guard sentence
  const premiseAudit = drive.calls[13]!;
  expect(premiseAudit.prompt).toContain(
    "Given premises, already established for this audit; do not inventory them:",
  );
  expect(premiseAudit.prompt).toContain("lemma: an even integer is 2k");
  expect(premiseAudit.system).toContain(
    "Treat any listed given premises as already established for this audit and never inventory them.",
  );

  // statuses
  expect(statuses[0]).toStartWith("exploration (index ~");
  expect(statuses).toContain("triage");
  expect(statuses).toContain("serve");
  expect(statuses).toContain("verify n1 (proof-audit)");
  expect(statuses).toContain("boundary verify n3 (criteria-match)");

  // the accepted candidate holds the goal note's exact bytes
  const reader = openReader(path);
  const candidates = reader
    .records()
    .filter((entry) => entry.kind === "candidate");
  expect(candidates).toHaveLength(1);
  expect(reader.material(candidates[0]!.seq)).toEqual(
    new TextEncoder().encode(goalText),
  );
});

test("a refutation FAIL hides the note and skips its remaining modes", async () => {
  const path = campaignPath();
  const drive = dependencies([
    { submission: { findings: [{ text: "Claim: 1 = 2 after rescaling." }] } },
    {
      submission: {
        filings: [{ finding: 1, summary: "claim: 1 equals 2" }],
      },
    },
    {
      submission: {
        plans: [
          {
            note: "n1",
            modes: ["refutation", "proof-audit"],
            rationale: "attack first",
          },
        ],
      },
    },
    {
      submission: {
        verdict: "FAIL",
        report: "counterexample: rescaling preserves inequality",
      },
    },
    { submission: { objective: "try a different route" } },
    {
      submission: { findings: [{ text: "New direction without the claim." }] },
    },
  ]);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    drive,
  );

  expect(report.outcome).toBe("paused");
  expect(drive.calls).toHaveLength(6);
  const verifyCalls = drive.calls.filter((call) =>
    call.label.includes("/verify/"),
  );
  // the FAIL on refutation skips the planned proof-audit
  expect(verifyCalls).toHaveLength(1);
  expect(verifyCalls[0]!.label).toContain("/verify/n1/refutation/");
  // the refuted note is gone from the next explorer's index
  const nextExplorer = drive.calls[5]!.prompt;
  expect(nextExplorer).not.toContain("claim: 1 equals 2");
});

test("a failed boundary battery recycles as a defect finding with failure context", async () => {
  const path = campaignPath();
  const drive = dependencies([
    { submission: { findings: [{ text: goalText }] } },
    {
      submission: {
        filings: [{ finding: 1, summary: "goal statement, unsupported" }],
      },
    },
    {
      submission: {
        plans: [
          { note: "n1", modes: ["proof-audit"], rationale: "derivation" },
        ],
      },
    },
    { submission: { verdict: "PASS", report: "note audit holds" } },
    { submission: { goalNote: "n1" } },
    // boundary proof-audit fails
    { submission: { verdict: "FAIL", report: "gap at step 3" } },
    // defect curation files the synthesized finding
    {
      submission: {
        filings: [{ finding: 1, summary: "boundary failure on n1" }],
      },
    },
    {
      submission: {
        plans: [{ note: "n2", modes: [], rationale: "defect record" }],
      },
    },
    { submission: { findings: [{ text: "Repair attempt for the gap." }] } },
  ]);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    drive,
  );

  expect(report.outcome).toBe("paused");
  expect(drive.calls).toHaveLength(9);
  // exactly one serve: the defect segment hands straight to an explorer
  expect(
    drive.calls.filter((call) => call.label.includes("/serve/")),
  ).toHaveLength(1);
  // the defect curation quotes the failing verdict
  const defectCuration = drive.calls[6]!.prompt;
  expect(defectCuration).toContain("failed boundary verification");
  expect(defectCuration).toContain("gap at step 3");
  // the post-defect explorer follows the defect curation with failure context
  const nextExplorer = drive.calls[8]!;
  expect(nextExplorer.label).toMatch(
    /^elenx-solve\/exploration-v17\/explorer\/\d+$/,
  );
  expect(nextExplorer.prompt).toContain(
    "Goal declaration that failed boundary verification",
  );
  expect(nextExplorer.prompt).toContain("gap at step 3");
});

test("a goal on an unverified ancestor is rejected mechanically, without battery calls", async () => {
  const path = campaignPath();
  const statuses: string[] = [];
  const drive = dependencies([
    { submission: { findings: [{ text: lemmaText }] } },
    {
      submission: {
        filings: [{ finding: 1, summary: "lemma: an even integer is 2k" }],
      },
    },
    {
      submission: {
        plans: [
          { note: "n1", modes: ["proof-audit"], rationale: "derivation" },
        ],
      },
    },
    { submission: { verdict: "INCONCLUSIVE", report: "open obligation" } },
    { submission: { objective: "build on the lemma" } },
    { submission: { findings: [{ text: goalText, basedOn: ["n1"] }] } },
    { submission: { filings: [{ finding: 1, summary: "goal statement" }] } },
    {
      submission: {
        plans: [
          { note: "n2", modes: ["proof-audit"], rationale: "derivation" },
        ],
      },
    },
    { submission: { verdict: "PASS", report: "holds given n1" } },
    { submission: { goalNote: "n2" } },
    // mechanical rejection: the gap finding re-enters curation
    {
      submission: {
        filings: [{ finding: 1, summary: "goal blocked on unverified n1" }],
      },
    },
  ]);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    { ...drive, status: (message) => statuses.push(message) },
  );

  expect(report.outcome).toBe("paused");
  expect(drive.calls).toHaveLength(11);
  expect(statuses.some((status) => status.includes("boundary"))).toBe(false);
  expect(drive.calls.some((call) => call.label.includes("/candidate/"))).toBe(
    false,
  );
  const gapCuration = drive.calls[10]!.prompt;
  expect(gapCuration).toContain("unverified ancestors");
  expect(gapCuration).toContain('"n1"');
  expect(gapCuration).toContain("conjecture");
});

test("every resume cut replays byte-exactly and completes without re-issued work", async () => {
  const oneShotPath = campaignPath();
  const oneShot = dependencies(happyReplies());
  const oneShotReport = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: oneShotPath,
      settings: runSettings(),
    },
    oneShot,
  );
  expect(oneShotReport.outcome).toBe("solved");

  for (const cut of [2, 4, 5, 10, 12]) {
    const path = campaignPath();
    const first = dependencies(happyReplies().slice(0, cut));
    const paused = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      first,
    );
    expect(paused.outcome).toBe("paused");
    expect(first.calls).toHaveLength(cut);

    const second = dependencies(happyReplies().slice(cut));
    const finished = await resume(
      { campaignPath: path, settings: runSettings() },
      second,
    );
    expect(finished.outcome).toBe("solved");
    expect(first.calls.length + second.calls.length).toBe(happyTotal);

    const resumed = second.calls[0]!;
    const reference = oneShot.calls[cut]!;
    expect(resumed.label).toBe(reference.label);
    expect(resumed.system).toBe(reference.system);
    expect(resumed.prompt).toBe(reference.prompt);
  }
});

test("a tiny maxIndexTokens ends the campaign as index-limit and resumes without dispatch", async () => {
  const path = campaignPath();
  const drive = dependencies([]);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings({ maxIndexTokens: 1 }),
    },
    drive,
  );
  expect(report).toMatchObject({
    outcome: "index-limit",
    phase: "index-limit",
  });
  expect(report.reason).toContain("exceeds maxIndexTokens");
  expect(drive.calls).toHaveLength(0);

  const again = dependencies([]);
  const resumed = await resume(
    { campaignPath: path, settings: runSettings({ maxIndexTokens: 1 }) },
    again,
  );
  expect(resumed.outcome).toBe("index-limit");
  expect(again.calls).toHaveLength(0);
});

test("the index tripwire also fires at a defect-segment curation entry", async () => {
  const path = campaignPath();
  const bigSummary = `wide note: ${"the pairing route needs every residue class tracked separately; ".repeat(12)}`;
  const drive = dependencies([
    {
      submission: {
        findings: [{ text: goalText }, { text: routeText, basedOn: [] }],
      },
    },
    {
      submission: {
        filings: [
          { finding: 1, summary: "goal statement, unsupported" },
          { finding: 2, summary: bigSummary },
        ],
      },
    },
    {
      submission: {
        plans: [
          { note: "n1", modes: ["proof-audit"], rationale: "derivation" },
          { note: "n2", modes: [], rationale: "process note" },
        ],
      },
    },
    { submission: { verdict: "PASS", report: "note audit holds" } },
    { submission: { goalNote: "n1" } },
    // the battery failure refutes n1; the surviving wide n2 trips the wire
    { submission: { verdict: "FAIL", report: "gap at step 3" } },
  ]);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings({ maxIndexTokens: 30 }),
    },
    drive,
  );
  expect(report).toMatchObject({
    outcome: "index-limit",
    phase: "index-limit",
  });
  // the tripwire fired before the defect curation could dispatch
  expect(drive.calls).toHaveLength(6);
  expect(
    drive.calls.filter((call) => call.label.includes("/curation/")),
  ).toHaveLength(1);
});

test("a finding based on a refuted note mints with that edge dropped", async () => {
  const path = campaignPath();
  const drive = dependencies([
    { submission: { findings: [{ text: "Claim: 1 = 2 after rescaling." }] } },
    {
      submission: {
        filings: [{ finding: 1, summary: "claim: 1 equals 2" }],
      },
    },
    {
      submission: {
        plans: [{ note: "n1", modes: ["refutation"], rationale: "attack it" }],
      },
    },
    { submission: { verdict: "FAIL", report: "concrete counterexample" } },
    { submission: { objective: "restart without the claim" } },
    { submission: { findings: [{ text: goalText, basedOn: ["n1"] }] } },
    { submission: { filings: [{ finding: 1, summary: "goal statement" }] } },
    {
      submission: {
        plans: [
          { note: "n2", modes: ["proof-audit"], rationale: "derivation" },
        ],
      },
    },
    { submission: { verdict: "PASS", report: "derivation holds" } },
    { submission: { goalNote: "n2" } },
    // the edge onto refuted n1 was dropped, so the battery starts instead of
    // a mechanical unverified-ancestor rejection
    { submission: { verdict: "FAIL", report: "boundary gap" } },
  ]);
  const report = await start(
    {
      problem,
      completionCriteria: criteria,
      campaignPath: path,
      settings: runSettings(),
    },
    drive,
  );
  expect(report.outcome).toBe("paused");
  expect(drive.calls).toHaveLength(11);
  expect(
    drive.calls.some((call) => call.label.includes("/candidate/proof-audit")),
  ).toBe(true);
  for (const call of drive.calls) {
    expect(call.prompt).not.toContain("unverified ancestors");
  }
});
