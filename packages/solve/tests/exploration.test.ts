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
    { submission: { objective: "repair the gap" } },
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
  expect(drive.calls).toHaveLength(10);
  // the defect curation quotes the failing verdict
  const defectCuration = drive.calls[6]!.prompt;
  expect(defectCuration).toContain("failed boundary verification");
  expect(defectCuration).toContain("gap at step 3");
  // the next explorer carries the failure context
  const nextExplorer = drive.calls[9]!.prompt;
  expect(nextExplorer).toContain(
    "Goal declaration that failed boundary verification",
  );
  expect(nextExplorer).toContain("gap at step 3");
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
