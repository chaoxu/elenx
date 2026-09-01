import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { createCampaign } from "elenx";

import {
  createPiRoles,
  piVerifierSubmission,
  verifierResultFromSubmission,
} from "../pi-roles";
import { inspectRoleCampaign } from "../role-cli";
import {
  coordinatorResultFor,
  explorerInput,
  allVerifiers,
  runTrial,
  verifierInput,
  verifierResult,
  type Roles,
  type Verifier,
} from "../roles";
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

const passingAuditSubmission = {
  audits: {
    correctness: { verdict: "PASS", report: "Correctness passed." },
    requirements: { verdict: "PASS", report: "Requirements passed." },
    refutation: { verdict: "PASS", report: "Refutation passed." },
  },
} as const;

test("explorer, coordinator, and verifier each run one model session", async () => {
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
    { submission: passingAuditSubmission },
  ];
  const drive = dependencies(replies);
  const path = campaignPath();
  const campaign = createCampaign(path, "elenx-solve-roles", {
    protocol: "role-calls.v1",
  });
  const settings = runSettings();
  try {
    const roles = createPiRoles(
      campaign,
      {
        explorer: settings.explorer,
        coordinator: settings.curator,
        verifier: settings.verifier,
      },
      { models: drive.models!, run: drive.run! },
    );
    const explorer = await roles.explorer({
      task,
      index: [],
      context: [],
      objective: "Prove P.",
    });
    expect(explorer).toEqual({
      findings: [{ text: "Proof of P." }],
    });

    const coordinator = await roles.coordinator({
      task,
      notes: [],
      findings: explorer.findings,
    });
    expect(coordinator.action.kind).toBe("verify");

    const verifierProposal = {
      task,
      answer: { id: "n1", summary: "proof of P", text: "Proof of P." },
      support: [],
    };
    const verifier = await roles.verifier(verifierProposal);
    expect(verifier).toEqual({
      verdict: "ACCEPT",
      report: "Every required audit completed without a blocking defect.",
    });
    expect(drive.calls.map(({ label }) => label)).toEqual([
      "elenx-solve/role/explorer",
      "elenx-solve/role/coordinator",
      "elenx-solve/role/verifier",
    ]);
  } finally {
    campaign.close();
  }
  const inspection = inspectRoleCampaign(path) as {
    readonly calls: readonly {
      readonly role?: string;
      readonly result?: unknown;
    }[];
  };
  const visible = inspection.calls.find(({ role }) => role === "verifier");
  expect(visible?.result).toEqual({
    verdict: "ACCEPT",
    report: "Every required audit completed without a blocking defect.",
  });
  expect(JSON.stringify(visible)).not.toContain('"PASS"');
  expect(JSON.stringify(visible)).not.toContain('"audits"');
});

test("verifier accepts exactly when every required audit passes", () => {
  expect(verifierResultFromSubmission(passingAuditSubmission)).toEqual({
    verdict: "ACCEPT",
    report: "Every required audit completed without a blocking defect.",
  });

  for (const audit of ["correctness", "requirements", "refutation"] as const) {
    const failed = {
      audits: {
        ...passingAuditSubmission.audits,
        [audit]: {
          verdict: "FAIL" as const,
          report: `${audit} failed.`,
        },
      },
    };
    expect(verifierResultFromSubmission(failed)).toEqual({
      verdict: "REJECT",
      report: `${audit}: ${audit} failed.`,
    });
  }

  expect(
    verifierResultFromSubmission({
      audits: {
        ...passingAuditSubmission.audits,
        correctness: { verdict: "FAIL", report: "Bad lemma." },
        refutation: { verdict: "FAIL", report: "Counterexample." },
      },
    }),
  ).toEqual({
    verdict: "REJECT",
    report: "correctness: Bad lemma.\n\nrefutation: Counterexample.",
  });

  expect(
    piVerifierSubmission.safeParse({
      audits: {
        correctness: passingAuditSubmission.audits.correctness,
        requirements: passingAuditSubmission.audits.requirements,
      },
    }).success,
  ).toBe(false);
  expect(
    piVerifierSubmission.safeParse({
      audits: {
        ...passingAuditSubmission.audits,
        extra: { verdict: "PASS", report: "Extra." },
      },
    }).success,
  ).toBe(false);
  expect(
    verifierResult.safeParse({ verdict: "PASS", report: "One audit passed." })
      .success,
  ).toBe(false);
});

test("inspection exposes no verdict from failed or malformed verifier calls", async () => {
  const proposal = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  const replies: Reply[] = [
    {
      submission: passingAuditSubmission,
      state: "failed",
      error: "transport failed",
    },
    {
      submission: {
        verdict: "ACCEPT",
        report: "Forged aggregate without audits.",
      },
    },
  ];

  for (const reply of replies) {
    const path = campaignPath();
    const campaign = createCampaign(path, "elenx-solve-roles", {
      protocol: "role-calls.v1",
    });
    const drive = dependencies([reply]);
    const settings = runSettings();
    const roles = createPiRoles(
      campaign,
      {
        explorer: settings.explorer,
        coordinator: settings.curator,
        verifier: settings.verifier,
      },
      { models: drive.models!, run: drive.run! },
    );
    try {
      await expect(roles.verifier(proposal)).rejects.toThrow();
    } finally {
      campaign.close();
    }
    const inspection = inspectRoleCampaign(path) as {
      readonly calls: readonly {
        readonly role?: string;
        readonly result?: unknown;
      }[];
    };
    expect(
      inspection.calls.find(({ role }) => role === "verifier")?.result,
    ).toBeUndefined();
  }
});

test("inspection lists unsettled role calls without exposing a result", async () => {
  const path = campaignPath();
  const campaign = createCampaign(path, "elenx-solve-roles", {
    protocol: "role-calls.v1",
  });
  let settle!: () => void;
  const pending = campaign.call(
    {
      label: "elenx-solve/role/explorer",
      role: "explorer",
      request: {},
    },
    () =>
      new Promise((resolve) => {
        settle = () => resolve({ state: "succeeded" });
      }),
  );
  try {
    const inspection = inspectRoleCampaign(path) as {
      readonly calls: readonly {
        readonly call: number;
        readonly result?: unknown;
      }[];
      readonly unsettledCalls: readonly number[];
    };
    expect(inspection.unsettledCalls).toEqual([inspection.calls[0]!.call]);
    expect(inspection.calls[0]!.result).toBeUndefined();
  } finally {
    settle();
    await pending;
    campaign.close();
  }
});

test("the same roles recombine into the trial workflow", async () => {
  const calls: string[] = [];
  let explorerTurn = 0;
  let coordinatorTurn = 0;
  let verifierTurn = 0;
  const roles: Roles = {
    async explorer(input) {
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
      expect(input.previousVerifierResult?.verdict).toBe("REJECT");
      return { findings: [{ text: "Repaired complete proof." }] };
    },
    async coordinator(input) {
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
      expect(input.previousVerifierResult?.verdict).toBe("REJECT");
      return {
        filings: [{ finding: 1, summary: "repaired proof" }],
        action: {
          kind: "verify",
          answer: { kind: "finding", finding: 1 },
          support: [],
        },
      };
    },
    async verifier(input) {
      calls.push("verifier");
      verifierTurn += 1;
      if (verifierTurn === 1) {
        expect(input.support.map(({ id }) => id)).toEqual(["n1"]);
        return { verdict: "REJECT", report: "One implication is missing." };
      }
      return { verdict: "ACCEPT", report: "The repair closes the gap." };
    },
  };

  const result = await runTrial(
    { task, objective: "Prove P.", maxExplorerTurns: 3 },
    roles,
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

test("trial does not send an unchanged rejected proposal twice", async () => {
  let verifierCalls = 0;
  const result = await runTrial(
    { task, objective: "Prove P.", maxExplorerTurns: 2 },
    {
      async explorer() {
        return { findings: [{ text: "Unchanged candidate." }] };
      },
      async coordinator(input) {
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
      async verifier() {
        verifierCalls += 1;
        return { verdict: "REJECT", report: "Missing implication." };
      },
    },
  );
  expect(result.outcome).toBe("turn-limit");
  expect(verifierCalls).toBe(1);
  if (result.outcome !== "turn-limit") throw new Error("expected turn limit");
  expect(result.lastVerifierResult?.report).toContain("unchanged");
});

test("multiple verifiers compose behind one verifier response", async () => {
  const accepting: Verifier = async () => ({
    verdict: "ACCEPT",
    report: "No defect found.",
  });
  const rejecting: Verifier = async () => ({
    verdict: "REJECT",
    report: "The converse is missing.",
  });
  const combined = allVerifiers(accepting, rejecting);
  const proposal = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  const response = await combined(proposal);
  expect(response.verdict).toBe("REJECT");
  expect(response.report).toContain("Verifier 1: ACCEPT");
  expect(response.report).toContain("Verifier 2: REJECT");
  expect((await allVerifiers(accepting, accepting)(proposal)).verdict).toBe(
    "ACCEPT",
  );
});

test("verifier aggregation propagates operational failure", async () => {
  const failing: Verifier = async () => {
    throw new Error("transport failed");
  };
  const proposal = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  await expect(allVerifiers(failing)(proposal)).rejects.toThrow(
    "transport failed",
  );
  const invalid = (async () => ({
    verdict: "PASS",
    report: "Only one audit passed.",
  })) as unknown as Verifier;
  await expect(allVerifiers(invalid)(proposal)).rejects.toThrow();
  expect(() => allVerifiers()).toThrow("at least one verifier");
});

test("coordinator packets cannot omit findings or invent references", () => {
  const schema = coordinatorResultFor(["n1"], 2);
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
  expect(
    coordinatorResultFor(["n1"], 1).safeParse({
      filings: [{ finding: 1, summary: "first" }],
      action: {
        kind: "explore",
        objective: "continue",
        context: [
          { kind: "note", id: "n1" },
          { kind: "note", id: "n1" },
        ],
      },
    }).success,
  ).toBe(false);
  expect(
    coordinatorResultFor(["n1"], 1).safeParse({
      filings: [{ finding: 1, summary: "first" }],
      action: {
        kind: "verify",
        answer: { kind: "finding", finding: 1 },
        support: [{ kind: "finding", finding: 1 }],
      },
    }).success,
  ).toBe(false);
});

test("explorer and verifier inputs validate their supplied material", () => {
  expect(
    explorerInput.safeParse({
      task,
      index: [],
      context: [{ id: "n1", summary: "hidden", text: "Hidden note." }],
      objective: "continue",
    }).success,
  ).toBe(false);

  const proposal = {
    task,
    answer: { id: "n1", summary: "candidate", text: "Candidate proof." },
    support: [],
  };
  expect(verifierInput.safeParse(proposal).success).toBe(true);
});

test("the main CLI inspects a role journal", () => {
  const path = campaignPath();
  createCampaign(path, "elenx-solve-roles", {
    protocol: "role-calls.v1",
  }).close();
  const inspected = spawnSync(process.execPath, ["solve.ts", "inspect", path], {
    cwd: import.meta.dir + "/..",
    encoding: "utf8",
  });
  expect(inspected.status).toBe(0);
  expect(JSON.parse(inspected.stdout)).toEqual({
    calls: [],
    spend: {
      logicalProviderRequests: 0,
      requestErrors: 0,
      unmeasuredRequests: 0,
    },
  });
});
