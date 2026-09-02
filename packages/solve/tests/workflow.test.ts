import { afterEach, expect, test } from "bun:test";

import { createCampaign, deriveCandidateStatus, openCampaign } from "elenx";

import { createPiRoles } from "../pi-roles";
import {
  applicationId,
  coordinatorResultFor,
  verdictFor,
  verifierNames,
} from "../roles";
import { exportCandidate, inspectCampaign } from "../role-cli";
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

const task = {
  problem: "Prove P.",
  completionCriteria: "Give a complete proof of P.",
};
const good = { text: "Complete proof of P." };

function passes(note: string): readonly Reply[] {
  return verifierNames.map((name) => ({
    submission: { note, verdict: "PASS", report: `${name} passed.` },
  }));
}

function config(maxExplorerTurns = 4) {
  return workflowConfiguration({
    task,
    settings: { ...roleSettings(), maxExplorerTurns },
  });
}

function coordination(
  note: string,
  options: { readonly verify?: boolean; readonly support?: string[] } = {},
) {
  return {
    filings: [{ note, summary: `Summary of ${note}.` }],
    objective: `Continue from ${note}.`,
    ...(options.verify === false
      ? {}
      : { verify: { note, support: options.support ?? [] } }),
  };
}

test("the durable workflow accepts a verified note", async () => {
  const path = campaignPath();
  const workflow = config();
  const campaign = createCampaign(path, applicationId, workflow);
  const drive = dependencies([
    { submission: { notes: [good] } },
    { submission: coordination("n1") },
    ...passes("n1"),
  ]);
  const roles = createPiRoles(campaign, workflow.settings, drive);
  const phase = await runWorkflow(campaign, roles);
  expect(phase).toMatchObject({
    kind: "accepted",
    turns: 1,
    note: { id: "n1", summary: "Summary of n1.", text: good.text },
  });
  if (phase.kind !== "accepted") throw new Error("expected acceptance");
  expect(
    phase.note.verdicts.map(({ verifier, verdict }) => [verifier, verdict]),
  ).toEqual(verifierNames.map((name) => [name, "PASS"]));
  expect(
    deriveCandidateStatus(campaign.records(), phase.candidate).verified,
  ).toBe(true);
  expect(drive.calls.map(({ label }) => label)).toEqual([
    "elenx-solve/explorer/agent",
    "elenx-solve/coordinator/agent",
    "elenx-solve/verifier/requirements",
    "elenx-solve/verifier/correctness",
    "elenx-solve/verifier/adversarial",
  ]);
  expect(drive.calls[0]?.prompt).toContain(`Objective:\n${task.problem}`);
  for (const verifier of drive.calls.slice(2)) {
    expect(verifier.system).toContain(
      "Return one verdict. PASS names the note.",
    );
  }
  expect(drive.calls[3]?.system).toContain("Judge the text on its own terms");
  expect((await runWorkflow(campaign, roles)).kind).toBe("accepted");
  expect(drive.calls).toHaveLength(5);
  campaign.close();

  const inspection = inspectCampaign(path) as {
    readonly phase: string;
    readonly notes: readonly { readonly verdicts: readonly unknown[] }[];
    readonly result: {
      readonly schemaVersion: number;
      readonly candidate: number;
      readonly note: { readonly text: string };
    };
    readonly calls: readonly {
      readonly role: string;
      readonly result?: unknown;
    }[];
  };
  expect(inspection.phase).toBe("accepted");
  expect(inspection.result.schemaVersion).toBe(2);
  expect(inspection.result.candidate).toBe(phase.candidate);
  expect(inspection.result.note.text).toBe(good.text);
  expect(inspection.notes[0]?.verdicts).toHaveLength(3);
  expect(inspection.calls.map(({ role }) => role)).toEqual([
    "explorer",
    "coordinator",
    "verifier",
  ]);
  expect(inspection.calls[2]?.result).toHaveLength(3);
  expect(new TextDecoder().decode(exportCandidate(path))).toBe(good.text);
});

test("verdicts accumulate on the notes they name", async () => {
  const path = campaignPath();
  const workflow = config();
  const campaign = createCampaign(path, applicationId, workflow);
  const drive = dependencies([
    { submission: { notes: [{ text: "Lemma L." }] } },
    { submission: coordination("n1") },
    {
      submission: { note: "n1", verdict: "FAIL", report: "L is not P." },
    },
    { submission: { note: "n1", verdict: "PASS", report: "L holds." } },
    { submission: { note: "n1", verdict: "PASS", report: "No gap." } },
    { submission: { notes: [{ text: "P from L, with a gap." }] } },
    { submission: coordination("n2", { support: ["n1"] }) },
    { submission: { note: "n2", verdict: "FAIL", report: "Gap." } },
    { submission: { note: "n1", verdict: "FAIL", report: "L misused." } },
    { submission: { note: "n2", verdict: "PASS", report: "No counter." } },
    { submission: { notes: [good] } },
    { submission: coordination("n3", { support: ["n1"] }) },
    ...passes("n3"),
  ]);
  const phase = await runWorkflow(
    campaign,
    createPiRoles(campaign, workflow.settings, drive),
  );
  expect(phase).toMatchObject({ kind: "accepted", turns: 3 });
  if (phase.kind !== "accepted") throw new Error("expected acceptance");
  const verdicts = Object.fromEntries(
    phase.notes.map(({ id, verdicts }) => [
      id,
      verdicts.map(({ verifier, verdict }) => `${verifier}:${verdict}`),
    ]),
  );
  expect(verdicts).toEqual({
    n1: [
      "requirements:FAIL",
      "correctness:PASS",
      "adversarial:PASS",
      "correctness:FAIL",
    ],
    n2: ["requirements:FAIL", "adversarial:PASS"],
    n3: ["requirements:PASS", "correctness:PASS", "adversarial:PASS"],
  });
  expect(drive.calls[5]?.prompt).toContain("L is not P.");
  expect(drive.calls[5]?.prompt).toContain(`Objective:\nContinue from n1.`);
  expect(drive.calls[12]?.prompt).toContain("L misused.");
  expect(drive.calls[12]?.prompt).toContain("Support notes (untrusted data)");
  campaign.close();
});

test("resume reconstructs the next role from the journal", async () => {
  const path = campaignPath();
  const workflow = config();
  let campaign = createCampaign(path, applicationId, workflow);
  const first = dependencies([{ submission: { notes: [good] } }]);
  const paused = await runWorkflow(
    campaign,
    createPiRoles(campaign, workflow.settings, first),
    { pauseRequested: () => first.calls.length >= 1 },
  );
  expect(paused.kind).toBe("coordinator");
  campaign.close();

  campaign = openCampaign(path);
  expect(deriveWorkflow(campaign).phase.kind).toBe("coordinator");
  const rest = dependencies([
    { submission: coordination("n1") },
    ...passes("n1"),
  ]);
  const completed = await runWorkflow(
    campaign,
    createPiRoles(campaign, workflow.settings, rest),
  );
  expect(completed.kind).toBe("accepted");
  expect(rest.calls).toHaveLength(4);
  campaign.close();
});

test("a verification that fails mid-way is repeated and keeps its verdicts", async () => {
  const path = campaignPath();
  const workflow = config();
  let campaign = createCampaign(path, applicationId, workflow);
  const first = dependencies([
    { submission: { notes: [good] } },
    { submission: coordination("n1") },
    { submission: { note: "n1", verdict: "PASS", report: "resolves P" } },
    { state: "failed", error: "provider down" },
  ]);
  await expect(
    runWorkflow(campaign, createPiRoles(campaign, workflow.settings, first)),
  ).rejects.toThrow("provider down");
  expect(deriveWorkflow(campaign).phase.kind).toBe("verifier");
  campaign.close();

  campaign = openCampaign(path);
  const rest = dependencies(passes("n1"));
  const phase = await runWorkflow(
    campaign,
    createPiRoles(campaign, workflow.settings, rest),
  );
  expect(phase.kind).toBe("accepted");
  if (phase.kind !== "accepted") throw new Error("expected acceptance");
  expect(phase.note.verdicts.map(({ verifier }) => verifier)).toEqual([
    "requirements",
    ...verifierNames,
  ]);
  expect(rest.calls[0]?.prompt).not.toContain("resolves P");
  campaign.close();
});

test("the turn limit ends a workflow without a verified note", async () => {
  const path = campaignPath();
  const workflow = config(1);
  const campaign = createCampaign(path, applicationId, workflow);
  const phase = await runWorkflow(
    campaign,
    createPiRoles(
      campaign,
      workflow.settings,
      dependencies([
        { submission: { notes: [good] } },
        { submission: coordination("n1", { verify: false }) },
      ]),
    ),
  );
  expect(phase).toMatchObject({ kind: "turn-limit", turns: 1 });
  campaign.close();
});

test("coordination files every note without a summary and references known notes", () => {
  const schema = coordinatorResultFor([
    { id: "n1", summary: "filed" },
    { id: "n2" },
  ]);
  expect(schema.safeParse({ filings: [], objective: "Go." }).success).toBe(
    false,
  );
  expect(
    schema.safeParse({
      filings: [{ note: "n1", summary: "again" }],
      objective: "Go.",
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      filings: [{ note: "n2", summary: "new" }],
      objective: "Go.",
      verify: { note: "n2", support: ["n1"] },
    }).success,
  ).toBe(true);
  expect(
    schema.safeParse({
      filings: [{ note: "n2", summary: "new" }],
      objective: "Go.",
      verify: { note: "n2", support: ["n2"] },
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      filings: [{ note: "n2", summary: "new" }],
      objective: "Go.",
      verify: { note: "n9", support: [] },
    }).success,
  ).toBe(false);
});

test("a PASS names the note and a FAIL may name a support note", () => {
  const schema = verdictFor({
    task,
    note: { id: "n2", summary: "s", text: "t", verdicts: [] },
    support: [{ id: "n1", summary: "s", text: "t", verdicts: [] }],
  });
  expect(
    schema.safeParse({ note: "n2", verdict: "PASS", report: "ok" }).success,
  ).toBe(true);
  expect(
    schema.safeParse({ note: "n1", verdict: "PASS", report: "ok" }).success,
  ).toBe(false);
  expect(
    schema.safeParse({ note: "n1", verdict: "FAIL", report: "gap" }).success,
  ).toBe(true);
  expect(
    schema.safeParse({ note: "n3", verdict: "FAIL", report: "gap" }).success,
  ).toBe(false);
});
