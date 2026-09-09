import { afterEach, expect, test } from "bun:test";

import { createCampaign, openCampaign } from "elenx";

import { createPiRoles } from "../pi-roles";
import {
  applicationId,
  reconstructionResultFor,
  verifierLabels,
  verifierNames,
} from "../roles";
import { inspectCampaign } from "../role-cli";
import {
  deriveWorkflow,
  runWorkflow,
  workflowConfiguration,
} from "../workflow";
import {
  campaignPath,
  cleanupCampaigns,
  dependencies,
  roleSettings,
  type Reply,
} from "./harness";

afterEach(cleanupCampaigns);

const task = { problem: "Prove P.", completionCriteria: "Prove P fully." };
const text = "ORIGINAL_PROOF: P follows by the argument written here.";

function config() {
  const settings = roleSettings();
  return workflowConfiguration({
    task,
    settings: { ...settings, source: settings.correctness },
  });
}

function verdict(note = "n1", value = "PASS") {
  return { note, verdict: value, report: `Check ${value.toLowerCase()}.` };
}

const check = (value = "PASS", note = "n1"): Reply => ({
  submission: { verdicts: [verdict(note, value)] },
});
const reconstruction = (value = "PASS", note = "n1"): Reply => ({
  submission: { statement: null, verdicts: [verdict(note, value)] },
});
const correction = (statement: string): Reply => ({
  submission: { statement, verdicts: [] },
});
const proof = (value = "Independent proof."): Reply => ({
  submission: { proof: value },
});

const start: readonly Reply[] = [
  { submission: { notes: [{ text, support: [] }] } },
  {
    submission: {
      filings: [{ note: "n1", summary: "P holds." }],
      explorerGuidance: "Prove P fully.",
      support: ["n1"],
      verify: [{ note: "n1", verifiers: [...verifierNames] }],
    },
  },
];

const beforeReconstruction: readonly Reply[] = [
  ...start,
  check(),
  check(),
  check(),
  { submission: { statement: "P holds." } },
  proof(),
];

test("unconfirmed sources pause the same verification without killing the note", async () => {
  const path = campaignPath();
  const configuration = config();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([...start, check("INCONCLUSIVE")]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).toMatchObject({ kind: "verifier" });
  const snapshot = await deriveWorkflow(campaign.records());
  expect(snapshot.notes).toHaveLength(1);
  expect(snapshot.notes[0]).toMatchObject({ verified: false, dead: false });
  expect(snapshot.notes[0]?.verdicts).toMatchObject([
    { verifier: "source", verdict: "INCONCLUSIVE" },
  ]);
  expect(first.calls).toHaveLength(3);
  const candidates = campaign
    .records()
    .filter((entry) => entry.kind === "candidate");
  campaign.close();

  expect(await inspectCampaign(path)).toMatchObject({
    result: {
      schemaVersion: 8,
      outcome: "paused",
      at: "verifier",
      reason: "source n1: Check inconclusive.",
    },
  });

  campaign = openCampaign(path);
  const resumed = dependencies([
    check(),
    check(),
    check(),
    { submission: { statement: "P holds." } },
    proof(),
    reconstruction(),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, resumed),
    ),
  ).toMatchObject({ kind: "accepted", turns: 1, note: { id: "n1", text } });
  expect(resumed.calls[0]?.label).toBe(verifierLabels.source);
  expect(
    campaign.records().filter((entry) => entry.kind === "candidate"),
  ).toEqual(candidates);
  campaign.close();
});

test("an in-progress or failed retry is not reported as the previous inconclusive pause", async () => {
  const path = campaignPath();
  const configuration = config();
  const campaign = createCampaign(path, applicationId, configuration);
  const drive = dependencies([...start, check("INCONCLUSIVE")]);
  await runWorkflow(
    campaign,
    createPiRoles(campaign, configuration.settings, drive),
  );
  const snapshot = await deriveWorkflow(campaign.records());
  if (
    snapshot.phase.kind !== "verifier" ||
    snapshot.phase.candidate === undefined
  )
    throw new Error("expected verifier candidate");
  const candidate = snapshot.phase.candidate;
  await campaign.call(
    { label: verifierLabels.source, role: "verifier", candidate, request: {} },
    async () => {
      expect(await inspectCampaign(path)).not.toHaveProperty("result");
      return { state: "failed", error: "provider disconnected" };
    },
  );
  expect(await inspectCampaign(path)).not.toHaveProperty("result");
  campaign.close();
});

test("inconclusive reconstruction retries only its proof and verdict after reopening", async () => {
  const path = campaignPath();
  const configuration = config();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([
    ...beforeReconstruction,
    reconstruction("INCONCLUSIVE"),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).toMatchObject({ kind: "verifier" });
  expect((await deriveWorkflow(campaign.records())).notes[0]).toMatchObject({
    verified: true,
    dead: false,
  });
  campaign.close();

  campaign = openCampaign(path);
  const resumed = dependencies([
    proof("Completed independent proof."),
    reconstruction(),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, resumed),
    ),
  ).toMatchObject({ kind: "accepted", turns: 1 });
  expect(resumed.calls.map(({ label }) => label)).toEqual([
    `${verifierLabels.reconstruction}/proof`,
    verifierLabels.reconstruction,
  ]);
  expect(
    campaign.records().filter((entry) => entry.kind === "candidate"),
  ).toHaveLength(1);
  campaign.close();
});

test("native source verification resumes an inconclusive lookup on the same candidate", async () => {
  const configuration = workflowConfiguration({
    task,
    settings: roleSettings(),
  });
  const path = campaignPath();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([
    ...start,
    {
      codex: { verdicts: [{ ...verdict("n1", "INCONCLUSIVE"), sources: [] }] },
    },
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).toMatchObject({ kind: "verifier" });
  campaign.close();

  campaign = openCampaign(path);
  const resumed = dependencies([
    { codex: { verdicts: [{ ...verdict(), sources: [] }] } },
    check(),
    check(),
    { submission: { statement: "P holds." } },
    proof(),
    reconstruction(),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, resumed),
    ),
  ).toMatchObject({ kind: "accepted", turns: 1 });
  expect(resumed.codexCalls).toHaveLength(1);
  expect(resumed.calls).toHaveLength(5);
  expect(
    campaign.records().filter((entry) => entry.kind === "candidate"),
  ).toHaveLength(1);
  campaign.close();
});

test("a corrected reconstruction statement preserves the note and all successful checks", async () => {
  const path = campaignPath();
  const configuration = config();
  const campaign = createCampaign(path, applicationId, configuration);
  const drive = dependencies([
    ...beforeReconstruction,
    correction("The precise proposition P."),
    proof("A proof from the corrected statement."),
    reconstruction(),
  ]);
  const phase = await runWorkflow(
    campaign,
    createPiRoles(campaign, configuration.settings, drive),
  );
  expect(phase).toMatchObject({
    kind: "accepted",
    turns: 1,
    note: { id: "n1", text },
  });
  expect(drive.calls.map(({ label }) => label)).toEqual([
    "elenx-solve/explorer",
    "elenx-solve/coordinator",
    verifierLabels.source,
    verifierLabels.correctness,
    verifierLabels.requirements,
    `${verifierLabels.reconstruction}/statement`,
    `${verifierLabels.reconstruction}/proof`,
    verifierLabels.reconstruction,
    `${verifierLabels.reconstruction}/proof`,
    verifierLabels.reconstruction,
  ]);
  expect(drive.calls[8]?.prompt).toContain("The precise proposition P.");
  expect(drive.calls[8]?.prompt).not.toContain("ORIGINAL_PROOF");
  expect(
    campaign.records().filter((entry) => entry.kind === "candidate"),
  ).toHaveLength(1);
  expect(
    campaign.records().filter((entry) => entry.kind === "verdict"),
  ).toHaveLength(4);
  const noCalls = dependencies([]);
  await runWorkflow(
    campaign,
    createPiRoles(campaign, configuration.settings, noCalls),
  );
  expect(noCalls.calls).toHaveLength(0);
  campaign.close();
  const inspected = (await inspectCampaign(path)) as {
    calls: { submission?: unknown }[];
  };
  expect(inspected.calls[7]?.submission).toMatchObject({
    statement: "The precise proposition P.",
    verdicts: [],
  });
});

test("reopening after a corrected proof settled reuses it and retries only the failed verdict call", async () => {
  const path = campaignPath();
  const configuration = config();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([
    ...beforeReconstruction,
    correction("The precise proposition P."),
    proof("Corrected proof."),
    { state: "failed", error: "interrupted verifier" },
  ]);
  await expect(
    runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).rejects.toThrow("interrupted verifier");
  campaign.close();

  campaign = openCampaign(path);
  const resumed = dependencies([reconstruction()]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, resumed),
    ),
  ).toMatchObject({ kind: "accepted", turns: 1 });
  expect(resumed.calls.map(({ label }) => label)).toEqual([
    verifierLabels.reconstruction,
  ]);
  expect(resumed.calls[0]?.prompt).toContain("Corrected proof.");
  campaign.close();
});

test("a corrected statement cannot also submit a mathematical verdict", () => {
  const schema = reconstructionResultFor("n1");
  expect(schema.safeParse({ statement: "P.", verdicts: [] }).success).toBe(
    true,
  );
  expect(
    schema.safeParse({ statement: "P.", verdicts: [verdict()] }).success,
  ).toBe(false);
  expect(schema.safeParse({ statement: null, verdicts: [] }).success).toBe(
    false,
  );
  expect(
    schema.safeParse({ statement: null, verdicts: [verdict("n2")] }).success,
  ).toBe(false);
});

test("a resumed source batch retries only unconfirmed notes and preserves the others' checks", async () => {
  const path = campaignPath();
  const configuration = config();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([
    {
      submission: {
        notes: [
          { text: "Lemma L.", support: [] },
          { text: "P.", support: [] },
        ],
      },
    },
    {
      submission: {
        filings: [
          { note: "n1", summary: "L holds." },
          { note: "n2", summary: "P holds." },
        ],
        explorerGuidance: "Prove P.",
        support: [],
        verify: [
          { note: "n1", verifiers: ["source", "correctness"] },
          { note: "n2", verifiers: [...verifierNames] },
        ],
      },
    },
    {
      submission: { verdicts: [verdict("n1"), verdict("n2", "INCONCLUSIVE")] },
    },
    check(),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).toMatchObject({ kind: "verifier" });
  expect(
    (await deriveWorkflow(campaign.records())).notes.map(
      ({ verified }) => verified,
    ),
  ).toEqual([true, false]);
  campaign.close();

  campaign = openCampaign(path);
  const resumed = dependencies([
    check("PASS", "n2"),
    check("PASS", "n2"),
    check("PASS", "n2"),
    { submission: { statement: "P holds." } },
    proof(),
    reconstruction("PASS", "n2"),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, resumed),
    ),
  ).toMatchObject({ kind: "accepted", turns: 1 });
  expect(resumed.calls).toHaveLength(6);
  expect(resumed.calls[0]?.prompt).not.toContain('"id": "n1"');
  expect(resumed.calls[1]?.prompt).not.toContain('"id": "n1"');
  campaign.close();
});

test("an accepted answer ends the workflow even when an unrelated note is unresolved", async () => {
  const configuration = config();
  const campaign = createCampaign(campaignPath(), applicationId, configuration);
  const drive = dependencies([
    {
      submission: {
        notes: [
          { text: "An unrelated lemma.", support: [] },
          { text: "Proof of P.", support: [] },
        ],
      },
    },
    {
      submission: {
        filings: [
          { note: "n1", summary: "Lemma." },
          { note: "n2", summary: "P holds." },
        ],
        explorerGuidance: "Prove P.",
        support: [],
        verify: [
          { note: "n1", verifiers: [...verifierNames] },
          { note: "n2", verifiers: [...verifierNames] },
        ],
      },
    },
    {
      submission: { verdicts: [verdict("n1", "INCONCLUSIVE"), verdict("n2")] },
    },
    check("PASS", "n2"),
    check("PASS", "n2"),
    { submission: { statement: "P holds." } },
    proof(),
    reconstruction("PASS", "n2"),
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, drive),
    ),
  ).toMatchObject({ kind: "accepted", note: { id: "n2" } });
  expect(drive.calls).toHaveLength(8);
  campaign.close();
});

test("repeated statement corrections stop automatic retries and remain resumable", async () => {
  const path = campaignPath();
  const configuration = config();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([
    ...beforeReconstruction,
    correction("Corrected P, first try."),
    proof(),
    correction("Corrected P, second try."),
  ]);
  await expect(
    runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).rejects.toThrow("statement");
  expect((await deriveWorkflow(campaign.records())).notes[0]).toMatchObject({
    verified: true,
    dead: false,
  });
  expect(
    campaign.records().filter((entry) => entry.kind === "verdict"),
  ).toHaveLength(3);
  campaign.close();

  campaign = openCampaign(path);
  const resumed = dependencies([proof(), reconstruction()]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, resumed),
    ),
  ).toMatchObject({ kind: "accepted", turns: 1 });
  expect(resumed.calls).toHaveLength(2);
  expect(resumed.calls[0]?.prompt).toContain("Corrected P, second try.");
  campaign.close();
});

test("an unresolved supporting lemma cannot verify its dependent note, and passed conditional checks are reused", async () => {
  const path = campaignPath();
  const configuration = config();
  let campaign = createCampaign(path, applicationId, configuration);
  const first = dependencies([
    {
      submission: {
        notes: [
          { text: "Lemma L.", support: [] },
          { text: "P from L.", support: ["n1"] },
        ],
      },
    },
    {
      submission: {
        filings: [
          { note: "n1", summary: "L holds." },
          { note: "n2", summary: "P holds." },
        ],
        explorerGuidance: "Prove P.",
        support: ["n1"],
        verify: [
          { note: "n1", verifiers: ["source", "correctness"] },
          { note: "n2", verifiers: [...verifierNames] },
        ],
      },
    },
    { submission: { verdicts: [verdict("n1"), verdict("n2")] } },
    {
      submission: { verdicts: [verdict("n1", "INCONCLUSIVE"), verdict("n2")] },
    },
  ]);
  expect(
    await runWorkflow(
      campaign,
      createPiRoles(campaign, configuration.settings, first),
    ),
  ).toMatchObject({ kind: "verifier" });
  expect(
    (await deriveWorkflow(campaign.records())).notes.map(
      ({ verified, dead }) => [verified, dead],
    ),
  ).toEqual([
    [false, false],
    [false, false],
  ]);
  campaign.close();

  campaign = openCampaign(path);
  const resumed = dependencies([
    check(),
    check("PASS", "n2"),
    { submission: { statement: "P holds." } },
    proof(),
    reconstruction("PASS", "n2"),
  ]);
  const phase = await runWorkflow(
    campaign,
    createPiRoles(campaign, configuration.settings, resumed),
  );
  expect(phase).toMatchObject({
    kind: "accepted",
    turns: 1,
    note: { id: "n2", verified: true },
  });
  expect(resumed.calls).toHaveLength(5);
  expect(resumed.calls[0]?.label).toBe(verifierLabels.correctness);
  expect(resumed.calls[0]?.prompt.split("Support notes")[0]).not.toContain(
    '"id": "n2"',
  );
  campaign.close();
});
