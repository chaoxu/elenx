import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  createCampaign,
  openCampaign,
  type Campaign,
  type EntryId,
  type Json,
} from "elenx";
import { piRequest } from "elenx/pi";

import { resume, settings, start } from "../exploration";
import {
  actionSchema,
  declaredEvidenceDAG,
  finalProofAuditFor,
  finalProofVerdict,
  explorerReportFor,
  type DeclaredEvidenceDAG,
  type FinalProofAudit,
} from "../exploration-protocol";
import { exportAnswer, inspectCampaign } from "../inspect";
import { declaredEvidenceBlock } from "../verifiers/reconstruction";
import {
  campaignPath,
  candidate,
  cleanupCampaigns,
  criteria,
  dependencies,
  problem,
  runSettings,
  type Reply,
} from "./harness";

afterEach(cleanupCampaigns);

const claim1 = "claim-1";
const claim2 = "claim-2";
const route1 = "route-1";
const standalone = `${candidate}\nFor all other integers, both factors have absolute value different from one or yield a nonpositive product, so the value is not prime.`;

const firstReport: Reply = {
  submission: {
    rawReport:
      "The factorization is n^2+3n+2=(n+1)(n+2). Checking when consecutive factors give a positive prime leaves n=-3 and n=0.",
    nominatedClaims: [
      {
        statement: "For every integer n, n^2+3n+2=(n+1)(n+2).",
        basedOnClaims: [],
      },
      {
        statement: "The integer (n+1)(n+2) is prime exactly when n is -3 or 0.",
        basedOnClaims: [],
      },
    ],
    nominatedRoutes: [
      {
        attempt: "Factor the quadratic and inspect consecutive factors.",
        outcome: "The route reduces the problem to two factor cases.",
        evidenceClaims: [],
      },
    ],
    claimsComplete: false,
    citedClaims: [],
  },
};

const retainBatch: Reply = {
  submission: {
    action: "continue",
    changes: [
      {
        action: "add_claim",
        claim: claim1,
        statement: "For every integer n, n^2+3n+2=(n+1)(n+2).",
        dependsOn: [],
      },
      {
        action: "add_claim",
        claim: claim2,
        statement: "The integer (n+1)(n+2) is prime exactly when n is -3 or 0.",
        dependsOn: [claim1],
      },
      {
        action: "add_route",
        route: route1,
        attempt: "Factor the quadratic and inspect consecutive factors.",
        outcome: "The route reduces the problem to two factor cases.",
        evidenceClaims: [claim1],
      },
    ],
  },
};

const admissionPass: Reply = {
  submission: {
    assessments: [
      { claim: claim1, report: "The identity is proved.", premises: [] },
      { claim: claim2, report: "The factor cases are proved.", premises: [] },
      {
        route: route1,
        verdict: "PASS",
        report: "The route accurately records the source attempt.",
      },
    ],
  },
};

const completeReport: Reply = {
  submission: {
    rawReport: candidate,
    nominatedClaims: [],
    nominatedRoutes: [],
    claimsComplete: true,
    citedClaims: [claim2],
  },
};

const premisePass: Reply = {
  submission: {
    report: "The argument and its claim origins are self-contained.",
    premises: [],
  },
};

function finalAudit(
  claim2Verdict: "PASS" | "FAIL" | "INCONCLUSIVE" = "PASS",
  rootVerdict: "PASS" | "FAIL" | "INCONCLUSIVE" = "PASS",
): FinalProofAudit {
  return {
    claimChecks: [
      {
        claim: claim1,
        dependencyChecks: [],
        derivation: { verdict: "PASS", report: "Identity checked." },
      },
      {
        claim: claim2,
        dependencyChecks: [
          {
            dependency: claim1,
            verdict: "PASS",
            report: "The factorization is applied correctly.",
          },
        ],
        derivation: {
          verdict: claim2Verdict,
          report:
            claim2Verdict === "PASS"
              ? "All factor cases checked."
              : "The claimed factor classification has a gap.",
        },
      },
    ],
    rootApplications: [
      {
        claim: claim2,
        verdict: rootVerdict,
        report:
          rootVerdict === "PASS"
            ? "The root claim is applied within its hypotheses."
            : "The true claim is applied outside its hypotheses.",
      },
    ],
    resolution: { verdict: "PASS", report: "The exact goal is resolved." },
  };
}

const reconstruction: Reply = { submission: { report: candidate } };
const comparisonPass: Reply = {
  submission: (campaign: Campaign): Json => ({
    verdict: "PASS",
    report: "The reconstruction uses only the declared DAG and agrees.",
    reconstructionCall: latestCall(campaign, "/reconstruction/derive"),
  }),
};
function deliveryAudit(
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE" = "PASS",
): Reply {
  return {
    submission: {
      theoremChecks: [
        {
          conclusion: "The exact integer set is {-3,0}.",
          verdict,
          report:
            verdict === "PASS"
              ? "The factor proof is complete."
              : "A central factor lemma is omitted.",
        },
      ],
      selfContainment: {
        verdict,
        report:
          verdict === "PASS"
            ? "Every load-bearing step is present."
            : "The answer relies on hidden support.",
      },
      internalReferenceHygiene: {
        verdict: "PASS",
        report: "No internal identifiers occur.",
      },
      resolution: {
        verdict,
        report:
          verdict === "PASS"
            ? "The requested result is established."
            : "The requested proof is incomplete.",
      },
    },
  };
}

function happyReplies(
  options: {
    readonly admission?: boolean;
    readonly proofVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
    readonly answer?: string;
    readonly deliveryVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  } = {},
): Reply[] {
  const admission = options.admission ?? true;
  return [
    firstReport,
    retainBatch,
    ...(admission ? [admissionPass] : []),
    completeReport,
    premisePass,
    { submission: finalAudit(options.proofVerdict) },
    ...(options.proofVerdict !== undefined && options.proofVerdict !== "PASS"
      ? []
      : [
          reconstruction,
          comparisonPass,
          { submission: { answer: options.answer ?? standalone } },
          deliveryAudit(options.deliveryVerdict),
        ]),
  ];
}

function latestCall(campaign: Campaign, fragment: string): EntryId {
  const call = campaign
    .records()
    .findLast(
      (entry) => entry.kind === "call" && entry.label.includes(fragment),
    );
  if (call?.kind !== "call") throw new Error(`missing call ${fragment}`);
  return call.seq;
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const expectedDAG: DeclaredEvidenceDAG = {
  roots: [claim2],
  claims: [
    {
      id: claim1,
      statement: "For every integer n, n^2+3n+2=(n+1)(n+2).",
      dependsOn: [],
    },
    {
      id: claim2,
      statement: "The integer (n+1)(n+2) is prime exactly when n is -3 or 0.",
      dependsOn: [claim1],
    },
  ],
  sourcedPremises: [],
};

const threeLevelDAG: DeclaredEvidenceDAG = {
  roots: ["claim-3"],
  claims: [
    { id: claim1, statement: "Base claim.", dependsOn: [] },
    { id: claim2, statement: "Middle claim.", dependsOn: [claim1] },
    {
      id: "claim-3",
      statement: "Root claim.",
      dependsOn: [claim2],
    },
  ],
  sourcedPremises: [],
};

describe("v14 protocol schemas", () => {
  test("omitted and explicit defaults normalize identically", () => {
    const explicit = runSettings({ admissionAuditors: [] });
    const {
      maxContextTokens: _maxContextTokens,
      explorerGuidance: _explorerGuidance,
      coordinatorGuidance: _coordinatorGuidance,
      admissionAuditors: _admissionAuditors,
      ...omitted
    } = explicit;
    expect(settings.parse(omitted)).toEqual(explicit);
  });

  test("claim and route IDs are structurally disjoint", () => {
    const schema = explorerReportFor("claims-and-routes", new Set([claim1]));
    expect(
      schema.safeParse({
        rawReport: "work",
        nominatedClaims: [],
        nominatedRoutes: [],
        claimsComplete: true,
        citedClaims: [route1],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        rawReport: "work",
        nominatedClaims: [],
        nominatedRoutes: [],
        claimsComplete: true,
        citedClaims: [claim1],
      }).success,
    ).toBe(true);
  });

  test("one atomic batch must repair every dependent claim and route", () => {
    const schema = actionSchema({
      memory: "claims-and-routes",
      nextClaim: "claim-3",
      nextRoute: "route-2",
      claims: [
        {
          id: claim1,
          dependsOn: [],
          provisional: false,
          retainable: false,
        },
        {
          id: claim2,
          dependsOn: [claim1],
          provisional: false,
          retainable: false,
        },
      ],
      routes: [
        {
          id: route1,
          evidenceClaims: [claim1],
          provisional: false,
          retainable: false,
        },
      ],
    });
    expect(
      schema.safeParse({
        action: "continue",
        changes: [{ action: "drop_claim", claim: claim1 }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        action: "continue",
        changes: [
          { action: "drop_claim", claim: claim1 },
          {
            action: "revise_claim",
            claim: "claim-3",
            replaces: claim2,
            statement: "Repaired independent claim.",
            dependsOn: [],
          },
          {
            action: "revise_route",
            route: "route-2",
            replaces: route1,
            attempt: "Repaired route.",
            outcome: "Uses the repaired claim.",
            evidenceClaims: ["claim-3"],
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("declared DAG is exactly the acyclic root closure", () => {
    expect(declaredEvidenceDAG.parse(expectedDAG)).toEqual(expectedDAG);
    expect(
      declaredEvidenceDAG.safeParse({
        ...expectedDAG,
        claims: [
          ...expectedDAG.claims,
          { id: "claim-3", statement: "Foreign", dependsOn: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      declaredEvidenceDAG.safeParse({
        roots: [claim1],
        claims: [
          { id: claim1, statement: "cycle 1", dependsOn: [claim2] },
          { id: claim2, statement: "cycle 2", dependsOn: [claim1] },
        ],
        sourcedPremises: [],
      }).success,
    ).toBe(false);
  });

  test("terminal coverage rejects missing, duplicate, and foreign checks", () => {
    const schema = finalProofAuditFor(expectedDAG);
    expect(schema.safeParse(finalAudit()).success).toBe(true);
    expect(
      schema.safeParse({
        ...finalAudit(),
        claimChecks: [finalAudit().claimChecks[0]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...finalAudit(),
        claimChecks: [...finalAudit().claimChecks, finalAudit().claimChecks[0]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...finalAudit(),
        rootApplications: [
          { claim: claim1, verdict: "PASS", report: "foreign root" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...finalAudit(),
        claimChecks: finalAudit().claimChecks.map((check) =>
          check.claim === claim2 ? { ...check, dependencyChecks: [] } : check,
        ),
      }).success,
    ).toBe(false);
  });

  test("terminal coverage accepts one complete three-level claim closure", () => {
    const audit: FinalProofAudit = {
      claimChecks: [
        {
          claim: claim1,
          dependencyChecks: [],
          derivation: { verdict: "PASS", report: "Base checked." },
        },
        {
          claim: claim2,
          dependencyChecks: [
            {
              dependency: claim1,
              verdict: "PASS",
              report: "First edge checked.",
            },
          ],
          derivation: { verdict: "PASS", report: "Middle checked." },
        },
        {
          claim: "claim-3",
          dependencyChecks: [
            {
              dependency: claim2,
              verdict: "PASS",
              report: "Second edge checked.",
            },
          ],
          derivation: { verdict: "PASS", report: "Root checked." },
        },
      ],
      rootApplications: [
        {
          claim: "claim-3",
          verdict: "PASS",
          report: "Root application checked.",
        },
      ],
      resolution: { verdict: "PASS", report: "Composition checked." },
    };
    expect(finalProofAuditFor(threeLevelDAG).parse(audit)).toEqual(audit);
  });

  test("terminal verdict precedence is mechanical", () => {
    expect(finalProofVerdict(finalAudit())).toBe("PASS");
    expect(finalProofVerdict(finalAudit("INCONCLUSIVE"))).toBe("INCONCLUSIVE");
    expect(finalProofVerdict(finalAudit("FAIL"))).toBe("FAIL");
  });
});

describe("v14 campaign", () => {
  test("full claim, route, terminal, reconstruction, and delivery path solves", async () => {
    const path = campaignPath();
    const deps = dependencies(happyReplies());
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      deps,
    );
    expect(report.outcome).toBe("solved");
    expect(deps.calls).toHaveLength(10);

    const inspection = inspectCampaign(path, { includeInputs: true });
    expect(inspection.phase).toBe("solved");
    if (inspection.claims === undefined || inspection.routes === undefined) {
      throw new Error("semantic inspection failed");
    }
    expect(inspection.claims.map(({ id, live }) => ({ id, live }))).toEqual([
      { id: claim1, live: true },
      { id: claim2, live: true },
    ]);
    expect(inspection.routes).toHaveLength(1);
    expect(inspection.routes[0]!.evidenceClaims).toEqual([claim1]);
    expect(inspection.resolutions).toHaveLength(1);
    expect(inspection.deliveryCandidates).toHaveLength(1);
    const deliveryContent = inspection.deliveryCandidates[0]!.content;
    if (
      typeof deliveryContent === "string" ||
      deliveryContent.protocol !== "elenx-solve/exploration-v14/delivery/v1"
    ) {
      throw new Error("delivery candidate was not parsed");
    }
    expect(deliveryContent.answer).toBe(standalone);
    expect(inspection.spend.unaccountedCalls).toEqual([]);
    expect(inspection.concurrency.peak).toBe(1);

    const derive = deps.calls.find(({ label }) =>
      label?.endsWith("/reconstruction/derive"),
    );
    const compare = deps.calls.find(({ label }) =>
      label?.endsWith("/reconstruction"),
    );
    const block = declaredEvidenceBlock(expectedDAG);
    expect(derive?.prompt.includes(block)).toBe(true);
    expect(compare?.prompt.includes(block)).toBe(true);
    expect(derive?.prompt).not.toContain(candidate);

    const proof = deps.calls.find(({ label }) =>
      label?.endsWith("/proof-audit"),
    );
    expect(proof?.prompt).not.toContain("admission stamps");
    expect(proof?.prompt).not.toContain("route-1");

    const deliveryCall = deps.calls.find(({ label }) =>
      label?.endsWith("/audit/delivery"),
    );
    expect(deliveryCall?.prompt).toContain(standalone);
    expect(deliveryCall?.prompt).not.toContain("claim-1");
    expect(deliveryCall?.prompt).not.toContain("newArgument");
    expect(deliveryCall?.prompt).not.toContain("sourceReport");
    expect(exportAnswer(path)).toEqual(new TextEncoder().encode(standalone));
    const exported = spawnSync(process.execPath, ["solve.ts", "export", path], {
      cwd: new URL("..", import.meta.url),
    });
    expect(exported.status).toBe(0);
    expect(exported.stdout).toEqual(Buffer.from(standalone));

    for (const call of inspection.calls) {
      const request = piRequest.parse(call.request);
      expect(request.stopAfterToolResult).toBe(true);
      expect(request.maxRecoveries).toBe(1);
      expect(request.maxLengthContinuations).toBe(8);
      expect(request.model.baseUrl).toBe("https://invalid.test/v1");
      expect(call.declaredTools).toHaveLength(1);
    }

    const resumed = dependencies([]);
    expect(
      await resume({ campaignPath: path, settings: runSettings() }, resumed),
    ).toMatchObject({ outcome: "solved", delivery: report.delivery });
    expect(resumed.calls).toHaveLength(0);
  });

  test("fresh terminal failure overrides admission PASS and blocks delivery", async () => {
    const path = campaignPath();
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      dependencies(happyReplies({ proofVerdict: "FAIL" })),
    );
    expect(report.outcome).toBe("paused");
    const inspection = inspectCampaign(path);
    expect(inspection.phase).toBe("coordinator");
    expect(inspection.resolutions[0]!.status.verified).toBe(false);
    expect(inspection.resolutions[0]!.feedback?.verdicts.at(-1)).toMatchObject({
      verifier: "proof-audit",
      verdict: "FAIL",
    });
    expect(inspection.deliveryCandidates).toHaveLength(0);
  });

  test("a true claim applied outside its hypotheses blocks delivery", async () => {
    const path = campaignPath();
    const replies: Reply[] = [
      firstReport,
      retainBatch,
      admissionPass,
      completeReport,
      premisePass,
      { submission: finalAudit("PASS", "FAIL") },
    ];
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      dependencies(replies),
    );
    expect(report).toMatchObject({ outcome: "paused", phase: "coordinator" });
    const inspection = inspectCampaign(path);
    const audit = inspection.resolutions[0]!.feedback?.verdicts.find(
      ({ verifier }) => verifier === "proof-audit",
    )?.audit as FinalProofAudit;
    expect(audit.rootApplications[0]).toMatchObject({
      claim: claim2,
      verdict: "FAIL",
    });
    expect(inspection.deliveryCandidates).toHaveLength(0);
  });

  test("claims with no admission auditors still receive terminal coverage", async () => {
    const path = campaignPath();
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings({ admissionAuditors: [] }),
      },
      dependencies(happyReplies({ admission: false })),
    );
    expect(report.outcome).toBe("solved");
    const inspection = inspectCampaign(path);
    expect(inspection.admissionAudits).toEqual([]);
    expect(
      inspection.resolutions[0]!.feedback?.verdicts.find(
        ({ verifier }) => verifier === "proof-audit",
      )?.audit,
    ).toEqual(finalAudit());
  });

  test("an incomplete public answer fails candidate-only delivery audit", async () => {
    const path = campaignPath();
    const report = await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      dependencies(
        happyReplies({
          answer: "The result follows by the retained claim.",
          deliveryVerdict: "FAIL",
        }),
      ),
    );
    expect(report.outcome).toBe("delivery-failure");
    expect(() => exportAnswer(path)).toThrow(
      "campaign has no strictly replayed v14 solution",
    );
    const inspection = inspectCampaign(path);
    expect(inspection.resolutions[0]!.status.verified).toBe(true);
    expect(inspection.deliveryCandidates[0]!.status.verified).toBe(false);
  });

  test("export rejects candidates verified through foreign labels and calls", async () => {
    const path = campaignPath();
    await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      dependencies([]),
    );
    const campaign = openCampaign(path);
    const resolution = campaign.submitCandidate(
      new TextEncoder().encode(
        JSON.stringify({
          protocol: "elenx-solve/exploration-v14/resolution/v1",
          problem,
          completionCriteria: criteria,
          citedClaims: [],
          newArgument: "UNAUDITED",
          sourceReport: 1,
        }),
      ),
      ["bogus-resolution"],
    );
    const resolutionCall = await campaign.call(
      {
        label: "bogus-resolution",
        candidate: resolution,
        request: null,
      },
      async () => ({ state: "succeeded" }),
    );
    campaign.recordVerdict(resolutionCall.call, "PASS", "bogus");
    const delivery = campaign.submitCandidate(
      new TextEncoder().encode(
        JSON.stringify({
          protocol: "elenx-solve/exploration-v14/delivery/v1",
          resolution,
          answer: "UNAUDITED",
        }),
      ),
      ["bogus-delivery"],
    );
    const deliveryCall = await campaign.call(
      { label: "bogus-delivery", candidate: delivery, request: null },
      async () => ({ state: "succeeded" }),
    );
    campaign.recordVerdict(deliveryCall.call, "PASS", "bogus");
    campaign.close();
    expect(() => exportAnswer(path)).toThrow(
      "campaign has no strictly replayed v14 solution",
    );
  });

  test("terminal support preserves mathematics from a failed reconstruction", async () => {
    const sentinel = "RECONSTRUCTION_ONLY_LEMMA";
    const path = campaignPath();
    const replies: Reply[] = [
      {
        submission: {
          rawReport: "First candidate.",
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: true,
          citedClaims: [],
        },
      },
      premisePass,
      {
        submission: {
          claimChecks: [],
          rootApplications: [],
          resolution: { verdict: "PASS", report: "Candidate checked." },
        },
      },
      { submission: { report: `${sentinel}: a complete proof.` } },
      {
        submission: (campaign: Campaign): Json => ({
          verdict: "FAIL",
          report: "The candidate did not state the reconstructed lemma.",
          reconstructionCall: latestCall(campaign, "/reconstruction/derive"),
        }),
      },
      {
        submission: {
          action: "continue",
          changes: [
            {
              action: "add_claim",
              claim: claim1,
              statement: sentinel,
              dependsOn: [],
            },
          ],
        },
      },
      {
        submission: {
          rawReport: "Apply the retained reconstruction lemma.",
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: true,
          citedClaims: [claim1],
        },
      },
      premisePass,
      {
        submission: {
          claimChecks: [
            {
              claim: claim1,
              dependencyChecks: [],
              derivation: {
                verdict: "FAIL",
                report: "Stop after observing the origin projection.",
              },
            },
          ],
          rootApplications: [
            {
              claim: claim1,
              verdict: "PASS",
              report: "Application checked.",
            },
          ],
          resolution: { verdict: "PASS", report: "Composition checked." },
        },
      },
    ];
    const deps = dependencies(replies);
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings({ admissionAuditors: [] }),
        },
        deps,
      ),
    ).toMatchObject({ outcome: "paused", phase: "coordinator" });
    const laterProof = deps.calls.filter(({ label }) =>
      label?.endsWith("/proof-audit"),
    )[1];
    expect(laterProof?.prompt).toContain(`${sentinel}: a complete proof.`);
    expect(laterProof?.prompt).not.toContain("verdicts");
  });

  test("terminal and delivery support preserve sanitized admission-audit mathematics", async () => {
    const sentinel = "ADMISSION_DISCOVERED_PROOF_SENTINEL";
    const auditProse = "ADMISSION_AUDIT_PROSE_SENTINEL";
    const path = campaignPath();
    const proofOnly = runSettings().resolutionAuditors.filter(
      ({ kind }) => kind === "proof-audit",
    );
    const oneClaimAudit: FinalProofAudit = {
      claimChecks: [
        {
          claim: claim2,
          dependencyChecks: [],
          derivation: { verdict: "PASS", report: "Origin proof checked." },
        },
      ],
      rootApplications: [
        {
          claim: claim2,
          verdict: "PASS",
          report: "Application checked.",
        },
      ],
      resolution: { verdict: "PASS", report: "Composition checked." },
    };
    const deps = dependencies([
      {
        submission: {
          rawReport: "The factorization is asserted without its algebra.",
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: false,
          citedClaims: [],
        },
      },
      {
        submission: {
          action: "continue",
          changes: [
            {
              action: "add_claim",
              claim: claim1,
              statement: "For every integer n, n^2+3n+2=(n+1)(n+2).",
              dependsOn: [],
            },
          ],
        },
      },
      {
        submission: {
          assessments: [
            {
              claim: claim1,
              report: `${auditProse}: the unchanged claim is inconclusive.`,
              mathematicalFinding: `${sentinel}: expand (n+1)(n+2)=n^2+3n+2 term by term.`,
              premises: [
                {
                  statement: "For every integer n, n^2+3n+2=(n+1)(n+2).",
                  standing: "UNESTABLISHED",
                  refutationAttempt: "No counterexample was found.",
                  gap: "The unchanged source omitted the expansion.",
                  application: "APPLIES",
                  applicationCheck: "The resolution uses this identity.",
                },
              ],
            },
          ],
        },
      },
      {
        submission: {
          action: "continue",
          changes: [
            {
              action: "revise_claim",
              claim: claim2,
              replaces: claim1,
              statement: "For every integer n, n^2+3n+2=(n+1)(n+2).",
              dependsOn: [],
            },
          ],
        },
      },
      {
        submission: {
          assessments: [
            {
              claim: claim2,
              report: "The prior mathematical finding supplies the expansion.",
              premises: [],
            },
          ],
        },
      },
      {
        submission: {
          rawReport: candidate,
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: true,
          citedClaims: [claim2],
        },
      },
      { submission: oneClaimAudit },
      { submission: { answer: standalone } },
      deliveryAudit(),
    ]);
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings({ resolutionAuditors: proofOnly }),
        },
        deps,
      ),
    ).toMatchObject({ outcome: "solved" });
    for (const call of deps.calls.filter(
      ({ label }) =>
        label?.endsWith("/proof-audit") ||
        label?.endsWith("/delivery/assemble"),
    )) {
      expect(call.prompt).toContain(sentinel);
      expect(call.prompt).not.toContain(auditProse);
      expect(call.prompt).not.toContain('"verdict"');
      expect(call.prompt).not.toContain('"standing"');
    }
  });

  test("retired and replaced claims stay outside terminal and delivery support", async () => {
    const retired = "OLD_RETIRED_SENTINEL";
    const replacement = "NEW_REPLACEMENT_SENTINEL";
    const path = campaignPath();
    const proofOnly = runSettings().resolutionAuditors.filter(
      ({ kind }) => kind === "proof-audit",
    );
    const oneClaimAudit: FinalProofAudit = {
      claimChecks: [
        {
          claim: claim2,
          dependencyChecks: [],
          derivation: { verdict: "PASS", report: "Replacement checked." },
        },
      ],
      rootApplications: [
        { claim: claim2, verdict: "PASS", report: "Application checked." },
      ],
      resolution: { verdict: "PASS", report: "Composition checked." },
    };
    const deps = dependencies([
      {
        submission: {
          rawReport: `${retired}: old argument.`,
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: false,
          citedClaims: [],
        },
      },
      {
        submission: {
          action: "continue",
          changes: [
            {
              action: "add_claim",
              claim: claim1,
              statement: "Old claim.",
              dependsOn: [],
            },
          ],
        },
      },
      {
        submission: {
          rawReport: `${replacement}: corrected argument.`,
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: false,
          citedClaims: [claim1],
        },
      },
      {
        submission: {
          action: "continue",
          changes: [
            {
              action: "revise_claim",
              claim: claim2,
              replaces: claim1,
              statement: "Corrected claim.",
              dependsOn: [],
            },
          ],
        },
      },
      {
        submission: {
          rawReport: candidate,
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: true,
          citedClaims: [claim2],
        },
      },
      { submission: oneClaimAudit },
      { submission: { answer: standalone } },
      deliveryAudit(),
    ]);
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings({
            admissionAuditors: [],
            resolutionAuditors: proofOnly,
          }),
        },
        deps,
      ),
    ).toMatchObject({ outcome: "solved" });
    for (const call of deps.calls.filter(
      ({ label }) =>
        label?.endsWith("/proof-audit") ||
        label?.endsWith("/delivery/assemble"),
    )) {
      expect(call.prompt).toContain(replacement);
      expect(call.prompt).not.toContain(retired);
      expect(call.prompt).not.toContain('"id": "claim-1"');
    }
  });

  test("route admission deduplicates the exact zero-claim source packet", async () => {
    const sentinel = "ZERO_CLAIM_ROUTE_SOURCE";
    const path = campaignPath();
    const deps = dependencies([
      {
        submission: {
          rawReport: `${sentinel}: tried parity and reached a dead end.`,
          nominatedClaims: [],
          nominatedRoutes: [
            {
              attempt: "Try parity.",
              outcome: "It does not distinguish the prime cases.",
              evidenceClaims: [],
            },
            {
              attempt: "Try residues modulo three.",
              outcome: "It also fails to isolate the prime cases.",
              evidenceClaims: [],
            },
          ],
          claimsComplete: false,
          citedClaims: [],
        },
      },
      {
        submission: {
          action: "continue",
          changes: [
            {
              action: "add_route",
              route: route1,
              attempt: "Try parity.",
              outcome: "It does not distinguish the prime cases.",
              evidenceClaims: [],
            },
            {
              action: "add_route",
              route: "route-2",
              attempt: "Try residues modulo three.",
              outcome: "It also fails to isolate the prime cases.",
              evidenceClaims: [],
            },
          ],
        },
      },
      {
        submission: {
          assessments: [
            {
              route: route1,
              verdict: "PASS",
              report: "The route matches the source packet.",
            },
            {
              route: "route-2",
              verdict: "PASS",
              report: "The second route matches the same source packet.",
            },
          ],
        },
      },
    ]);
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings(),
        },
        deps,
      ),
    ).toMatchObject({ outcome: "paused", phase: "explorer" });
    const audit = deps.calls.find(({ label }) =>
      label?.includes("/audit/admission/"),
    );
    expect(audit?.system).toContain(
      "Explorer nominations are advisory rather than an exact target schema.",
    );
    expect(audit?.prompt).toContain(sentinel);
    expect(audit?.prompt).toContain('"sourcePackets"');
    expect(audit?.prompt.split(sentinel)).toHaveLength(2);
  });

  test("resume after assembly never repeats the assembler", async () => {
    const path = campaignPath();
    const replies = happyReplies();
    const assembler = replies.at(-2)!;
    await expect(
      start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings(),
        },
        dependencies([
          ...replies.slice(0, -2),
          { ...assembler, throwAfter: "crash after assembly" },
        ]),
      ),
    ).rejects.toThrow("crash after assembly");

    const resumed = dependencies([deliveryAudit()]);
    expect(
      await resume({ campaignPath: path, settings: runSettings() }, resumed),
    ).toMatchObject({ outcome: "solved" });
    expect(resumed.calls.map(({ label }) => label)).toEqual([
      "elenx-solve/exploration-v14/audit/delivery",
    ]);
  });

  test("resume after delivery submission records its verdict without another call", async () => {
    const path = campaignPath();
    const replies = happyReplies();
    await expect(
      start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings(),
        },
        dependencies([
          ...replies.slice(0, -1),
          { ...replies.at(-1)!, throwAfter: "crash after delivery audit" },
        ]),
      ),
    ).rejects.toThrow("crash after delivery audit");

    const resumed = dependencies([]);
    expect(
      await resume({ campaignPath: path, settings: runSettings() }, resumed),
    ).toMatchObject({ outcome: "solved" });
    expect(resumed.calls).toHaveLength(0);
  });

  test("pause and resume cross every new model boundary without repeating work", async () => {
    const replies = happyReplies();
    for (let split = 0; split < replies.length; split += 1) {
      const path = campaignPath();
      const first = dependencies(replies.slice(0, split));
      expect(
        await start(
          {
            problem,
            completionCriteria: criteria,
            campaignPath: path,
            settings: runSettings(),
          },
          first,
        ),
      ).toMatchObject({ outcome: "paused" });
      const second = dependencies(replies.slice(split));
      expect(
        await resume({ campaignPath: path, settings: runSettings() }, second),
      ).toMatchObject({ outcome: "solved" });
      expect(first.calls.length + second.calls.length).toBe(replies.length);
    }
  }, 30_000);

  test("provider-retryable failure restarts the same phase and deterministic failure does not", async () => {
    const retryPath = campaignPath();
    const retrying = dependencies([
      {
        state: "failed",
        error: "stream_incomplete: Upstream closed stream without completion",
        providerRetryable: true,
        truncated: false,
      },
      firstReport,
    ]);
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: retryPath,
          settings: runSettings(),
        },
        {
          ...retrying,
          callFailureRetry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
        },
      ),
    ).toMatchObject({ outcome: "paused", phase: "coordinator" });
    expect(retrying.calls).toHaveLength(2);
    expect(
      retrying.statuses.some(
        (status) =>
          status.includes(
            "stream_incomplete: Upstream closed stream without completion",
          ) && status.includes("retrying"),
      ),
    ).toBe(true);

    const deterministicPath = campaignPath();
    const deterministic = dependencies([{ submission: { invalid: true } }]);
    expect(
      await start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: deterministicPath,
          settings: runSettings(),
        },
        deterministic,
      ),
    ).toMatchObject({ outcome: "call-failure" });
    expect(deterministic.calls).toHaveLength(1);
  });

  test("the global context ceiling blocks a later oversized call before dispatch", async () => {
    const path = campaignPath();
    const huge = "x".repeat(40_000);
    const deps = dependencies([
      {
        submission: {
          rawReport: huge,
          nominatedClaims: [],
          nominatedRoutes: [],
          claimsComplete: false,
          citedClaims: [],
        },
      },
    ]);
    await expect(
      start(
        {
          problem,
          completionCriteria: criteria,
          campaignPath: path,
          settings: runSettings({ maxContextTokens: 3_000 }),
        },
        { ...deps, pauseRequested: () => false },
      ),
    ).rejects.toThrow("exceeds maxContextTokens");
    expect(deps.calls).toHaveLength(1);
  });

  test("a real v0.31 database fixture fails with its release instruction and no writes", async () => {
    const path = campaignPath();
    const database = new Database(path, { create: true });
    database.exec(
      readFileSync(
        new URL("./fixtures/exploration-v12-minimal.sql", import.meta.url),
        "utf8",
      ),
    );
    database.close();
    const before = fileHash(path);
    const deps = dependencies([]);
    await expect(
      resume({ campaignPath: path, settings: runSettings() }, deps),
    ).rejects.toThrow("exploration-v12 requires elenx-solve v0.31.0");
    expect(deps.calls).toHaveLength(0);
    expect(fileHash(path)).toBe(before);
  });

  test("a real v0.32 database fixture fails with its release instruction and no writes", async () => {
    const path = campaignPath();
    const database = new Database(path, { create: true });
    database.exec(
      readFileSync(
        new URL("./fixtures/exploration-v13-minimal.sql", import.meta.url),
        "utf8",
      ),
    );
    database.close();
    const before = fileHash(path);
    const deps = dependencies([]);
    await expect(
      resume({ campaignPath: path, settings: runSettings() }, deps),
    ).rejects.toThrow("exploration-v13 requires elenx-solve v0.32.0");
    expect(deps.calls).toHaveLength(0);
    expect(fileHash(path)).toBe(before);
  });

  test("malformed v14 and unknown protocols have distinct read-only errors", () => {
    const malformedPath = campaignPath();
    createCampaign(malformedPath, "elenx-solve", {
      protocol: "exploration-v14",
    }).close();
    const malformedHash = fileHash(malformedPath);
    expect(() => inspectCampaign(malformedPath)).toThrow(
      "invalid elenx-solve exploration-v14 campaign config",
    );
    expect(fileHash(malformedPath)).toBe(malformedHash);

    const unknownPath = campaignPath();
    createCampaign(unknownPath, "elenx-solve", {
      protocol: "exploration-v99",
    }).close();
    const unknownHash = fileHash(unknownPath);
    expect(() => inspectCampaign(unknownPath)).toThrow(
      "unsupported elenx-solve protocol: exploration-v99",
    );
    expect(fileHash(unknownPath)).toBe(unknownHash);
  });

  test("frozen setting mismatches make no calls or writes", async () => {
    const path = campaignPath();
    await start(
      {
        problem,
        completionCriteria: criteria,
        campaignPath: path,
        settings: runSettings(),
      },
      dependencies([]),
    );
    const before = fileHash(path);
    const mismatches = [
      runSettings({ memory: "claims" }),
      runSettings({ maxContextTokens: 199_999 }),
      runSettings({ explorerGuidance: ["Different guidance."] }),
      runSettings({
        coordinator: {
          ...runSettings().coordinator,
          reasoning: "high",
        },
      }),
      runSettings({
        resolutionAuditors: runSettings().resolutionAuditors.filter(
          ({ kind }) => kind !== "reconstruction",
        ),
      }),
    ];
    for (const settings of mismatches) {
      const deps = dependencies([]);
      await expect(
        resume({ campaignPath: path, settings }, deps),
      ).rejects.toThrow("settings disagree");
      expect(deps.calls).toHaveLength(0);
      expect(fileHash(path)).toBe(before);
    }

    const drift = dependencies([]);
    const originalModels = drift.models!;
    const driftModels: typeof originalModels = {
      ...originalModels,
      getModel(provider: string, id: string) {
        const model = originalModels.getModel(provider, id);
        return model === undefined
          ? undefined
          : { ...model, baseUrl: "https://drift.invalid/v1" };
      },
    };
    await expect(
      resume(
        { campaignPath: path, settings: runSettings() },
        { ...drift, models: driftModels },
      ),
    ).rejects.toThrow("settings disagree");
    expect(drift.calls).toHaveLength(0);
    expect(fileHash(path)).toBe(before);
  });
});
