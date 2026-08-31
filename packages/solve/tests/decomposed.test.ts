import { afterEach, expect, test } from "bun:test";

import { createCampaign } from "elenx";

import {
  coordinatorResponseFor,
  explorerInput,
  requireAllVerifiers,
  runCoordinator,
  runDecomposedLoop,
  runExplorer,
  runVerifier,
  verifierBundleHash,
  verifierInput,
  type Components,
  type VerifierComponent,
} from "../decomposed";
import {
  campaignPath,
  cleanupCampaigns,
  dependencies,
  runSettings,
  type Reply,
} from "./harness";

afterEach(cleanupCampaigns);

const task = {
  problem: "Prove P.",
  completionCriteria: "Give a complete proof of P.",
};

test("explorer, coordinator, and verifier run as standalone Elenx components", async () => {
  const replies: Reply[] = [
    { submission: { findings: [{ text: "Proof of P." }] } },
    {
      submission: {
        filings: [{ finding: 1, summary: "proof of P" }],
        action: {
          kind: "verify",
          answer: { kind: "finding", finding: 1 },
          support: [],
        },
      },
    },
    { submission: { verdict: "ACCEPT", report: "The proof is complete." } },
  ];
  const drive = dependencies(replies);
  const campaign = createCampaign(campaignPath(), "component-test", {});
  const settings = runSettings();
  try {
    const explorer = await runExplorer(
      campaign,
      { task, index: [], context: [], objective: "Prove P." },
      settings.explorer,
      { models: drive.models!, run: drive.run! },
    );
    expect(explorer.response).toEqual({
      findings: [{ text: "Proof of P." }],
    });

    const coordinator = await runCoordinator(
      campaign,
      { task, notes: [], findings: explorer.response.findings },
      settings.curator,
      { models: drive.models!, run: drive.run! },
    );
    expect(coordinator.response.action.kind).toBe("verify");

    const verifierBundle = {
      task,
      answer: { id: "n1", summary: "proof of P", text: "Proof of P." },
      support: [],
    };
    const verifier = await runVerifier(
      campaign,
      {
        ...verifierBundle,
        bundleHash: verifierBundleHash(verifierBundle),
      },
      settings.verifier,
      { models: drive.models!, run: drive.run! },
    );
    expect(verifier.response).toEqual({
      verdict: "ACCEPT",
      report: "The proof is complete.",
    });
    expect(drive.calls.map(({ label }) => label)).toEqual([
      "elenx-solve/decomposed/explorer",
      "elenx-solve/decomposed/coordinator",
      "elenx-solve/decomposed/verifier",
    ]);
  } finally {
    campaign.close();
  }
});

test("the same components recombine into the minimal repair loop", async () => {
  const calls: string[] = [];
  let explorerTurn = 0;
  let coordinatorTurn = 0;
  let verifierTurn = 0;
  const components: Components = {
    async explore(input) {
      calls.push("explorer");
      explorerTurn += 1;
      if (explorerTurn === 1) {
        expect(input.context).toEqual([]);
        return { findings: [{ text: "Lemma L." }] };
      }
      if (explorerTurn === 2) {
        expect(input.context.map(({ id }) => id)).toEqual(["n1"]);
        return { findings: [{ text: "Candidate proof using L." }] };
      }
      expect(input.previousVerifierResponse?.verdict).toBe("REJECT");
      return { findings: [{ text: "Repaired complete proof." }] };
    },
    async coordinate(input) {
      calls.push("coordinator");
      coordinatorTurn += 1;
      if (coordinatorTurn === 1) {
        return {
          filings: [{ finding: 1, summary: "lemma L" }],
          action: {
            kind: "explore",
            objective: "Use L to prove P.",
            context: [{ kind: "finding", finding: 1 }],
          },
        };
      }
      if (coordinatorTurn === 2) {
        return {
          filings: [{ finding: 1, summary: "candidate proof" }],
          action: {
            kind: "verify",
            answer: { kind: "finding", finding: 1 },
            support: [{ kind: "note", id: "n1" }],
          },
        };
      }
      expect(input.previousVerifierResponse?.verdict).toBe("REJECT");
      return {
        filings: [{ finding: 1, summary: "repaired proof" }],
        action: {
          kind: "verify",
          answer: { kind: "finding", finding: 1 },
          support: [],
        },
      };
    },
    async verify(input) {
      calls.push("verifier");
      verifierTurn += 1;
      if (verifierTurn === 1) {
        expect(input.support.map(({ id }) => id)).toEqual(["n1"]);
        return { verdict: "REJECT", report: "One implication is missing." };
      }
      return { verdict: "ACCEPT", report: "The repair closes the gap." };
    },
  };

  const result = await runDecomposedLoop(
    { task, objective: "Prove P.", maxExplorerTurns: 3 },
    components,
  );
  expect(result.outcome).toBe("accepted");
  expect(result.turns).toBe(3);
  expect(calls).toEqual([
    "explorer",
    "coordinator",
    "explorer",
    "coordinator",
    "verifier",
    "explorer",
    "coordinator",
    "verifier",
  ]);
});

test("the loop does not send an unchanged rejected bundle twice", async () => {
  let verifierCalls = 0;
  const result = await runDecomposedLoop(
    { task, objective: "Prove P.", maxExplorerTurns: 2 },
    {
      async explore() {
        return { findings: [{ text: "Unchanged candidate." }] };
      },
      async coordinate(input) {
        return {
          filings: [{ finding: 1, summary: "unchanged candidate" }],
          action:
            input.notes.length === 0
              ? {
                  kind: "verify" as const,
                  answer: { kind: "finding" as const, finding: 1 },
                  support: [],
                }
              : {
                  kind: "verify" as const,
                  answer: { kind: "note" as const, id: "n1" },
                  support: [],
                },
        };
      },
      async verify() {
        verifierCalls += 1;
        return { verdict: "REJECT", report: "Missing implication." };
      },
    },
  );
  expect(result.outcome).toBe("turn-limit");
  expect(verifierCalls).toBe(1);
  if (result.outcome !== "turn-limit") throw new Error("expected turn limit");
  expect(result.lastVerifierResponse?.report).toContain("unchanged");
});

test("multiple verifiers compose behind one verifier response", async () => {
  const accepting: VerifierComponent = async () => ({
    verdict: "ACCEPT",
    report: "No defect found.",
  });
  const rejecting: VerifierComponent = async () => ({
    verdict: "REJECT",
    report: "The converse is missing.",
  });
  const combined = requireAllVerifiers([accepting, rejecting]);
  const bundle = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  const response = await combined({
    ...bundle,
    bundleHash: verifierBundleHash(bundle),
  });
  expect(response.verdict).toBe("REJECT");
  expect(response.report).toContain("Verifier 1: ACCEPT");
  expect(response.report).toContain("Verifier 2: REJECT");
});

test("verifier aggregation turns operational failure into rejection", async () => {
  const failing: VerifierComponent = async () => {
    throw new Error("transport failed");
  };
  const bundle = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  const response = await requireAllVerifiers([failing])({
    ...bundle,
    bundleHash: verifierBundleHash(bundle),
  });
  expect(response.verdict).toBe("REJECT");
  expect(response.report).toContain("transport failed");
});

test("coordinator packets cannot omit findings or invent references", () => {
  const schema = coordinatorResponseFor(["n1"], 2);
  expect(
    schema.safeParse({
      filings: [{ finding: 1, summary: "first" }],
      action: {
        kind: "explore",
        objective: "continue",
        context: [{ kind: "note", id: "n1" }],
      },
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      filings: [
        { finding: 1, summary: "first" },
        { finding: 2, summary: "second" },
      ],
      action: {
        kind: "verify",
        answer: { kind: "note", id: "n9" },
        support: [],
      },
    }).success,
  ).toBe(false);
});

test("explorer and verifier packets bind their supplied material", () => {
  expect(
    explorerInput.safeParse({
      task,
      index: [],
      context: [{ id: "n1", summary: "hidden", text: "Hidden note." }],
      objective: "continue",
    }).success,
  ).toBe(false);

  const bundle = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  expect(
    verifierInput.safeParse({ ...bundle, bundleHash: "0".repeat(64) }).success,
  ).toBe(false);
  expect(
    verifierInput.safeParse({
      ...bundle,
      bundleHash: verifierBundleHash(bundle),
    }).success,
  ).toBe(true);
});
