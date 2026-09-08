import { afterEach, expect, test } from "bun:test";

import { createCampaign } from "elenx";

import {
  createPiRoles,
  proofCall,
  sourceCall,
  statementCall,
  verifierCall,
} from "../pi-roles";
import {
  applicationId,
  supportClosure,
  verifierInput,
  verifierNames,
  type Note,
  type Verification,
} from "../roles";
import {
  runWorkflow,
  verificationPrefix,
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
  problem: "Prove coverage.",
  completionCriteria: "Prove all regimes.",
};
const note = (id: string, text: string, support: string[] = []): Note => ({
  id,
  text,
  summary: text,
  support,
  verdicts: [],
  verified: true,
  dead: false,
});
const first = note(
  "n1",
  "Coverage holds in the exceptional regime; annotation index is one.",
);
const inherited = note(
  "n2",
  "The union inherits every coverage regime of n1.",
  ["n1"],
);
const target = note("n3", "Use the inherited coverage in n2.", ["n2"]);
const unrelated = note("n4", "UNRELATED PROOF");
const all = [first, inherited, target, unrelated];
const input = {
  task,
  notes: [target],
  support: [first, inherited],
  verify: [{ note: "n3", verifiers: [...verifierNames] }],
};

test("verification requires the complete dependency chain while preserving the direct support edges", () => {
  expect(verifierInput.parse(input)).toEqual(input);
  expect(supportClosure([target], all)).toEqual(["n1", "n2"]);
  expect(target.support).toEqual(["n2"]);
  expect(
    verifierInput.safeParse({ ...input, support: [inherited] }).success,
  ).toBe(false);
  expect(
    verifierInput.safeParse({
      ...input,
      support: [first, inherited, unrelated],
    }).success,
  ).toBe(false);
  expect(
    verifierInput.safeParse({ ...input, support: [inherited, first] }).success,
  ).toBe(false);
});

test("cycles and duplicate notes cannot leak a candidate through reconstruction support", () => {
  const cycle = { ...first, support: ["n3"] };
  expect(
    verifierInput.safeParse({ ...input, support: [cycle, inherited] }).success,
  ).toBe(false);
  expect(
    verifierInput.safeParse({ ...input, support: [first, first, inherited] })
      .success,
  ).toBe(false);
});

test("each verifier and reconstruction stage receives inherited context exactly once", () => {
  const calls = [
    verifierCall("source", input, ["n3"]),
    verifierCall("correctness", input, ["n3"]),
    verifierCall("requirements", input, ["n3"]),
    statementCall(input, target),
    proofCall(input, target, { statement: "Coverage holds." }),
  ];
  const native = sourceCall(
    { provider: "codex", model: "test", reasoning: "low", search: false },
    input,
    ["n3"],
  );
  for (const prompt of [...calls.map((c) => c.prompt), native.request.prompt]) {
    expect(prompt.split(first.text)).toHaveLength(3); // summary plus proof, one note object
    expect(prompt).toContain(inherited.text);
    expect(prompt).not.toContain(unrelated.text);
  }
  const reconstructed = proofCall(input, target, {
    statement: "Coverage holds.",
  });
  expect(reconstructed.prompt).not.toContain(target.text);
  const batch = {
    ...input,
    notes: [inherited, target],
    support: [first],
    verify: [{ note: "n2", verifiers: [...verifierNames] }, ...input.verify],
  };
  const onlyParent = verifierCall("correctness", batch, ["n2"]);
  expect(onlyParent.prompt).toContain(first.text);
  expect(onlyParent.prompt).not.toContain(target.text);
});

test("the verification window counts transitive shared texts once without dropping required support", () => {
  const notes = [
    note("n1", "a".repeat(100)),
    note("n2", "b".repeat(10), ["n1"]),
    note("n3", "c".repeat(10), ["n2"]),
    note("n4", "d".repeat(10), ["n2"]),
  ];
  const verify: Verification[] = [
    { note: "n3", verifiers: ["source", "correctness"] },
    { note: "n4", verifiers: ["source", "correctness"] },
  ];
  expect(verificationPrefix(verify, notes, 125).map((v) => v.note)).toEqual([
    "n3",
  ]);
  expect(verificationPrefix(verify, notes, 130).map((v) => v.note)).toEqual([
    "n3",
    "n4",
  ]);
  expect(verificationPrefix(verify, notes, 1).map((v) => v.note)).toEqual([
    "n3",
  ]);
});

test("workflow construction and per-call selection both retain ancestors across explorer turns", async () => {
  const settings = roleSettings();
  settings.source = settings.correctness;
  settings.maxExplorerTurns = 3;
  const workflow = workflowConfiguration({ task, settings });
  const campaign = createCampaign(campaignPath(), applicationId, workflow);
  const replies: Reply[] = [];
  for (const n of [first, inherited, target]) {
    replies.push(
      { submission: { notes: [{ text: n.text, support: n.support }] } },
      {
        submission: {
          filings: [{ note: n.id, summary: n.summary! }],
          objective: "Complete coverage.",
          support: [n.id],
          verify: [{ note: n.id, verifiers: ["source", "correctness"] }],
        },
      },
      {
        submission: {
          verdicts: [{ note: n.id, verdict: "PASS", report: "Known sources." }],
        },
      },
      {
        submission: {
          verdicts: [
            { note: n.id, verdict: "PASS", report: "Inherited facts apply." },
          ],
        },
      },
    );
  }
  const drive = dependencies(replies);
  try {
    const phase = await runWorkflow(
      campaign,
      createPiRoles(campaign, settings, drive),
    );
    expect(phase.kind).toBe("turn-limit");
    if (phase.kind !== "turn-limit") throw new Error("expected turn limit");
    expect(phase.notes.every((n) => n.verified)).toBe(true);
    const last = drive.calls.at(-1)!;
    expect(last.prompt).toContain(first.text);
    expect(last.prompt).toContain(inherited.text);
    expect(last.prompt).toContain(target.text);
  } finally {
    campaign.close();
  }
});
