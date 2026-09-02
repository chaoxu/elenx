import { afterEach, expect, test } from "bun:test";

import { createCampaign, deriveCandidateStatus, openCampaign } from "elenx";

import {
  auditResult,
  auditorDefinitions,
  verifierFromAuditors,
  type AuditorSet,
} from "../auditors";
import { createPiRoles } from "../pi-roles";
import { allVerifiers, applicationId, type Verifier } from "../roles";
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
const passingAudits: readonly Reply[] = auditorDefinitions.map(({ name }) => ({
  submission: { verdict: "PASS", report: `${name} passed.` },
}));

function config(maxExplorerTurns = 4) {
  const settings = { ...roleSettings(), maxExplorerTurns };
  return workflowConfiguration({
    task,
    settings,
  });
}

function coordinatorSubmission(text = good.text) {
  return {
    filings: [{ finding: 1, summary: text }],
    action: {
      kind: "verify" as const,
      candidateKind: "solution" as const,
      answer: { kind: "finding" as const, finding: 1 },
      support: [],
    },
  };
}

test("auditors share one interface and the verifier short-circuits", async () => {
  const order: string[] = [];
  const implementations: AuditorSet = {
    async requirements() {
      order.push("requirements");
      return auditResult.parse({ verdict: "PASS", report: "target matches" });
    },
    async correctness() {
      order.push("correctness");
      return auditResult.parse({ verdict: "FAIL", report: "false lemma" });
    },
    async adversarial() {
      throw new Error("must be skipped");
    },
  };
  const result = await verifierFromAuditors(implementations)({
    task,
    candidateKind: "solution",
    answer: { id: "n1", summary: "proof", text: good.text },
    support: [],
  });
  expect(result).toEqual({
    verdict: "REJECT",
    report: "correctness: false lemma",
  });
  expect(order).toEqual(["requirements", "correctness"]);
});

test("the durable workflow accepts through the public verifier", async () => {
  const path = campaignPath();
  const workflow = config();
  const campaign = createCampaign(path, applicationId, workflow);
  const drive = dependencies([
    { submission: { findings: [good] } },
    { submission: coordinatorSubmission() },
    ...passingAudits,
  ]);
  const roles = createPiRoles(campaign, workflow.settings, drive);
  const phase = await runWorkflow(campaign, roles);
  expect(phase).toMatchObject({
    kind: "accepted",
    turns: 1,
    answer: { text: good.text },
    verifier: { verdict: "ACCEPT" },
  });
  if (phase.kind !== "accepted") throw new Error("expected acceptance");
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
  for (const audit of drive.calls.slice(2)) {
    expect(audit.system).toContain(
      "PASS means the audit found no blocking defect",
    );
    expect(audit.system).toContain(
      "FAIL requires one concrete blocking defect",
    );
    expect(audit.system).toContain(
      "Do not fail solely for an omitted routine fact",
    );
  }
  expect((await runWorkflow(campaign, roles)).kind).toBe("accepted");
  expect(drive.calls).toHaveLength(5);
  campaign.close();

  const inspection = inspectCampaign(path) as {
    readonly state: string;
    readonly result: {
      readonly candidate: number;
      readonly candidateKind: string;
      readonly answer: { readonly text: string };
    };
    readonly calls: readonly { readonly role: string }[];
  };
  expect(inspection.state).toBe("accepted");
  expect(inspection.result.candidate).toBe(phase.candidate);
  expect(inspection.result.candidateKind).toBe("solution");
  expect(inspection.result.answer.text).toBe(good.text);
  expect(inspection.calls.map(({ role }) => role)).toEqual([
    "explorer",
    "coordinator",
    "verifier",
  ]);
  expect(new TextDecoder().decode(exportCandidate(path))).toBe(good.text);
});

test("a rejection becomes durable repair context", async () => {
  const path = campaignPath();
  const workflow = config();
  const campaign = createCampaign(path, applicationId, workflow);
  const drive = dependencies([
    { submission: { findings: [{ text: "Gap." }] } },
    { submission: coordinatorSubmission("Gap.") },
    { submission: { verdict: "FAIL", report: "Not complete." } },
    { submission: { findings: [good] } },
    { submission: coordinatorSubmission() },
    ...passingAudits,
  ]);
  const phase = await runWorkflow(
    campaign,
    createPiRoles(campaign, workflow.settings, drive),
  );
  expect(phase).toMatchObject({
    kind: "accepted",
    turns: 2,
    answer: { text: good.text },
  });
  expect(drive.calls).toHaveLength(8);
  expect(drive.calls[3]?.prompt).toContain("Previous verifier response");
  expect(drive.calls[3]?.prompt).toContain("Not complete.");
  campaign.close();
});

test("resume reconstructs the next role from the journal", async () => {
  const path = campaignPath();
  const workflow = config();
  let campaign = createCampaign(path, applicationId, workflow);
  const first = dependencies([{ submission: { findings: [good] } }]);
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
    { submission: coordinatorSubmission() },
    ...passingAudits,
  ]);
  const completed = await runWorkflow(
    campaign,
    createPiRoles(campaign, workflow.settings, rest),
  );
  expect(completed.kind).toBe("accepted");
  expect(rest.calls).toHaveLength(4);
  campaign.close();
});

test("multiple public verifiers still compose opaquely", async () => {
  const accept: Verifier = async () => ({ verdict: "ACCEPT", report: "ok" });
  const reject: Verifier = async () => ({ verdict: "REJECT", report: "gap" });
  const result = await allVerifiers(
    accept,
    reject,
  )({
    task,
    candidateKind: "solution",
    answer: { id: "n1", summary: "proof", text: good.text },
    support: [],
  });
  expect(result.verdict).toBe("REJECT");
  expect(result.report).toContain("Verifier 2: REJECT");
});
