import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  assessment,
  assessmentFor,
  callSurface,
  callActivity,
  boundaryModes,
  bundleCertificationFor,
  curationSubmissionFor,
  explorerSubmissionFor,
  parseCampaign,
  reconstructionArtifactFor,
  reconstructionComparison,
  serveSubmissionFor,
  settingsSchema,
  taskSchema,
  triageSubmissionFor,
  verificationModes,
} from "../exploration-protocol";

const profile = {
  provider: "codex-lb",
  model: "gpt-5.6-sol",
  reasoning: "max",
} as const;
const settings = {
  protocol: "exploration-v17",
  explorer: profile,
  curator: profile,
  triage: profile,
  verifier: profile,
  sourceChecker: { model: "gpt-5.6-sol", reasoning: "max" },
} as const;

describe("v17 settings", () => {
  test("applies context, index, and guidance defaults", () => {
    const parsed = settingsSchema.parse(settings);
    expect(parsed.maxContextTokens).toBe(200_000);
    expect(parsed.maxIndexTokens).toBe(100_000);
    expect(parsed.maxExplorerTurns).toBe(50);
    expect(parsed.explorerGuidance).toEqual([]);
  });

  test("rejects an index budget above the context budget", () => {
    expect(
      settingsSchema.safeParse({
        ...settings,
        maxContextTokens: 50_000,
        maxIndexTokens: 60_000,
      }).success,
    ).toBe(false);
  });

  test("rejects a foreign protocol literal", () => {
    expect(
      settingsSchema.safeParse({ ...settings, protocol: "exploration-v16" })
        .success,
    ).toBe(false);
  });

  test("requires every role profile", () => {
    for (const role of [
      "explorer",
      "curator",
      "triage",
      "verifier",
      "sourceChecker",
    ] as const) {
      const { [role]: _dropped, ...partial } = settings;
      expect(settingsSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("v17 explorer submissions", () => {
  const explorerSubmission = explorerSubmissionFor(["n1", "n2"]);

  test("a turn carries prior-note and earlier-finding dependencies", () => {
    const parsed = explorerSubmission.parse({
      findings: [
        { text: "lemma L holds" },
        {
          text: "route B dies",
          basedOn: ["n2"],
          basedOnFindings: [1],
        },
      ],
      nextObjective: "close the parity case",
      expand: ["n1"],
    });
    expect(parsed.findings[0]?.basedOn).toEqual([]);
    expect(parsed.findings[0]?.basedOnFindings).toEqual([]);
    expect(parsed.findings[1]?.basedOn).toEqual(["n2"]);
    expect(parsed.findings[1]?.basedOnFindings).toEqual([1]);
    expect(parsed.expand).toEqual(["n1"]);
  });

  test("provider-visible dependency fields mean logical premises only", () => {
    const json = JSON.stringify(z.toJSONSchema(explorerSubmission));
    expect(json).toContain("Logical premises only");
    expect(json).toContain("Never cite provenance");
    expect(json).toContain("never provenance or shared drafting context");
  });

  test("finding-local dependencies must point backward", () => {
    expect(
      explorerSubmission.safeParse({
        findings: [
          { text: "first", basedOnFindings: [1] },
          { text: "second", basedOnFindings: [2] },
        ],
      }).success,
    ).toBe(false);
    expect(
      explorerSubmission.safeParse({
        findings: [{ text: "first" }, { text: "second", basedOnFindings: [1] }],
      }).success,
    ).toBe(true);
  });

  test("a turn requires at least one finding", () => {
    expect(explorerSubmission.safeParse({ findings: [] }).success).toBe(false);
  });

  test("there is no submit path", () => {
    expect(
      explorerSubmission.safeParse({
        findings: [{ text: "finding" }],
        action: "submit",
      }).success,
    ).toBe(false);
    expect(
      explorerSubmission.safeParse({
        findings: [{ text: "finding" }],
        answer: "standalone proof",
      }).success,
    ).toBe(false);
  });

  test("note ids follow the minted format", () => {
    for (const bad of ["n0", "x1", "n01", "note1"]) {
      expect(
        explorerSubmission.safeParse({
          findings: [{ text: "finding", basedOn: [bad] }],
        }).success,
      ).toBe(false);
      expect(
        explorerSubmission.safeParse({
          findings: [{ text: "finding" }],
          expand: [bad],
        }).success,
      ).toBe(false);
    }
  });

  test("prior-note dependencies are restricted to notes visible this turn", () => {
    expect(
      explorerSubmission.safeParse({
        findings: [{ text: "finding", basedOn: ["n2"] }],
      }).success,
    ).toBe(true);
    expect(
      explorerSubmission.safeParse({
        findings: [{ text: "finding", basedOn: ["n3"] }],
      }).success,
    ).toBe(false);
    expect(
      explorerSubmissionFor([]).safeParse({
        findings: [{ text: "first-turn finding", basedOn: ["n1"] }],
      }).success,
    ).toBe(false);
  });
});

describe("v17 curation submissions", () => {
  const schema = curationSubmissionFor(2);

  test("files every finding exactly once", () => {
    expect(
      schema.safeParse({
        filings: [
          {
            finding: 1,
            summary: "first",
            statement: "First claim",
            reconstruction: { keyIdeas: [], allowedSources: [] },
          },
          {
            finding: 2,
            summary: "second",
            statement: "Second claim",
            reconstruction: { keyIdeas: [], allowedSources: [] },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        filings: [{ finding: 1, summary: "only", statement: "Only claim" }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first", statement: "First claim" },
          { finding: 1, summary: "again", statement: "Again claim" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first", statement: "First claim" },
          { finding: 3, summary: "beyond", statement: "Beyond claim" },
        ],
      }).success,
    ).toBe(false);
  });

  test("every finding requires a summary", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1 },
          { finding: 2, summary: "second", statement: "Second claim" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          {
            finding: 1,
            summary: "first",
            statement: "First claim",
            reconstruction: { keyIdeas: [], allowedSources: [] },
          },
          {
            finding: 2,
            summary: "second",
            statement: "Second claim",
            reconstruction: { keyIdeas: [], allowedSources: [] },
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("every finding requires a complete statement distinct from navigation", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first" },
          { finding: 2, summary: "second", statement: "Second claim" },
        ],
      }).success,
    ).toBe(false);
  });

  test("the provider-visible schema defines statement as proposition-only", () => {
    const json = JSON.stringify(z.toJSONSchema(schema));
    expect(json).toContain("The theorem, lemma, claim, or process status only");
    expect(json).toContain("no proof steps");
  });

  test("every filing carries a reconstruction interface", () => {
    const filing = {
      finding: 1,
      summary: "claim",
      statement: "Claim P.",
    };
    expect(
      curationSubmissionFor(1).safeParse({ filings: [filing] }).success,
    ).toBe(false);
    expect(
      curationSubmissionFor(1).safeParse({
        filings: [
          {
            ...filing,
            reconstruction: {
              keyIdeas: ["orient around invariant I"],
              allowedSources: [],
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("the curator cannot replace, merge, or drop findings", () => {
    for (const mutation of [{ refines: "n1" }, { duplicateOf: "n1" }]) {
      expect(
        schema.safeParse({
          filings: [
            { finding: 1, summary: "first", ...mutation },
            { finding: 2, summary: "second" },
          ],
        }).success,
      ).toBe(false);
    }
  });

  test("the curator holds no invalidation power", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first" },
          { finding: 2, summary: "second" },
        ],
        invalidations: [{ note: "n1", cause: "refuted" }],
      }).success,
    ).toBe(false);
  });
});

describe("v17 triage submissions", () => {
  const schema = triageSubmissionFor(["n1", "n2"]);

  test("plans every batch note exactly once", () => {
    expect(
      schema.safeParse({
        plans: [
          { note: "n1", modes: ["proof-audit"], rationale: "derivation" },
          { note: "n2", modes: [], rationale: "process report" },
        ],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        plans: [{ note: "n1", modes: [], rationale: "only one" }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        plans: [
          { note: "n1", modes: [], rationale: "first" },
          { note: "n1", modes: [], rationale: "again" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        plans: [
          { note: "n1", modes: [], rationale: "first" },
          { note: "n9", modes: [], rationale: "foreign" },
        ],
      }).success,
    ).toBe(false);
  });

  test("modes are distinct and from the frozen menu", () => {
    expect(
      schema.safeParse({
        plans: [
          {
            note: "n1",
            modes: ["proof-audit", "proof-audit"],
            rationale: "dup",
          },
          { note: "n2", modes: [], rationale: "report" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        plans: [
          { note: "n1", modes: ["criteria-match"], rationale: "boundary" },
          { note: "n2", modes: [], rationale: "report" },
        ],
      }).success,
    ).toBe(false);
  });

  test("every plan carries a rationale", () => {
    expect(
      schema.safeParse({
        plans: [
          { note: "n1", modes: ["refutation"] },
          { note: "n2", modes: [], rationale: "report" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("v17 serve submissions", () => {
  const schema = serveSubmissionFor({
    expandableNoteIds: ["n1", "n2", "n3"],
    goalNoteIds: ["n1", "n2"],
    retriableNoteIds: ["n2"],
  });

  test("a plain serve carries a working set and an objective", () => {
    const parsed = schema.parse({
      expand: ["n1", "n2"],
      objective: "close the parity case",
    });
    expect(parsed.expand).toEqual(["n1", "n2"]);
    expect(parsed.goalNote).toBeUndefined();
  });

  test("an empty serve parses with defaults", () => {
    expect(schema.parse({}).expand).toEqual([]);
    expect(schema.parse({}).retriage).toEqual([]);
  });

  test("expansions must reference live notes", () => {
    expect(schema.safeParse({ expand: ["n9"] }).success).toBe(false);
  });

  test("declaring the goal excludes serving", () => {
    expect(schema.safeParse({ goalNote: "n1" }).success).toBe(true);
    expect(schema.safeParse({ goalNote: "n1", expand: ["n2"] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ goalNote: "n1", objective: "keep going" }).success,
    ).toBe(false);
    expect(schema.safeParse({ goalNote: "n9" }).success).toBe(false);
  });

  test("re-triage is exclusive and restricted to eligible notes", () => {
    expect(schema.safeParse({ retriage: ["n2"] }).success).toBe(true);
    expect(schema.safeParse({ retriage: ["n1"] }).success).toBe(false);
    expect(
      schema.safeParse({ retriage: ["n2"], objective: "keep going" }).success,
    ).toBe(false);
  });
});

describe("v17 verification vocabulary", () => {
  test("assessment verdicts are the fixed trio with a report", () => {
    for (const verdict of ["PASS", "FAIL", "INCONCLUSIVE"] as const) {
      expect(
        assessment.safeParse({ verdict, report: "reasoned" }).success,
      ).toBe(true);
    }
    expect(
      assessment.safeParse({ verdict: "MAYBE", report: "reasoned" }).success,
    ).toBe(false);
    expect(
      assessment.safeParse({ verdict: "PASS", report: "  " }).success,
    ).toBe(false);
  });

  test("truth-establishing PASS certifies statement form and fidelity", () => {
    const proofAudit = assessmentFor("proof-audit");
    expect(
      proofAudit.safeParse({
        verdict: "PASS",
        report: "valid",
        statementForm: "PROPOSITION_ONLY",
        statementFidelity: "MATCH",
      }).success,
    ).toBe(true);
    expect(
      proofAudit.safeParse({
        verdict: "PASS",
        report: "copied proof",
        statementForm: "CONTAINS_SUPPORT",
        statementFidelity: "MATCH",
      }).success,
    ).toBe(false);

    expect(
      assessmentFor("proof-audit", "boundary").safeParse({
        verdict: "PASS",
        report: "the candidate proves the campaign target",
        goalStatementMatch: "MATCH",
      }).success,
    ).toBe(true);
    expect(
      assessmentFor("proof-audit", "boundary").safeParse({
        verdict: "PASS",
        report: "stored statement is stronger than the target",
        goalStatementMatch: "MISMATCH",
      }).success,
    ).toBe(false);
    expect(
      proofAudit.safeParse({
        verdict: "PASS",
        report: "overclaim",
        statementForm: "PROPOSITION_ONLY",
        statementFidelity: "MISMATCH",
      }).success,
    ).toBe(false);

    const reconstruction = assessmentFor("reconstruction");
    expect(
      reconstruction.safeParse({
        verdict: "PASS",
        report: "independent proof",
        statementForm: "PROPOSITION_ONLY",
      }).success,
    ).toBe(true);
    expect(
      reconstruction.safeParse({
        verdict: "PASS",
        report: "proof leaked through the target",
        statementForm: "CONTAINS_SUPPORT",
      }).success,
    ).toBe(false);
  });

  test("reconstruction stages bind direct premises and the derivation call", () => {
    const certification = bundleCertificationFor(["n2"]);
    const safe = {
      verdict: "PASS",
      report: "safe",
      keyIdeas: "SAFE",
      allowedSources: "SAFE",
      premises: [
        {
          note: "n2",
          disposition: "RELEVANT_LOGICAL_PREMISE",
          report: "used by the candidate",
        },
      ],
      closure: [],
    };
    expect(certification.safeParse(safe).success).toBe(true);
    expect(certification.safeParse({ ...safe, premises: [] }).success).toBe(
      false,
    );
    expect(
      certification.safeParse({
        ...safe,
        premises: [
          {
            note: "n2",
            disposition: "IRRELEVANT_OR_PROVED_INLINE",
            report: "unused",
          },
        ],
      }).success,
    ).toBe(false);

    const towerCertification = bundleCertificationFor(["n2"], ["n1"]);
    expect(
      towerCertification.safeParse({
        ...safe,
        closure: [
          {
            note: "n1",
            disposition: "TARGET_OR_PROOF_LEAK",
            report: "deep ancestor restates the target",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      towerCertification.safeParse({
        ...safe,
        closure: [
          {
            note: "n1",
            disposition: "SAFE",
            report: "deep ancestor is noncircular",
          },
        ],
      }).success,
    ).toBe(true);

    const artifact = reconstructionArtifactFor(["n2"]);
    expect(
      artifact.safeParse({ proof: "proof", usedPremises: ["n2"] }).success,
    ).toBe(true);
    expect(
      artifact.safeParse({ proof: "proof", usedPremises: ["n1"] }).success,
    ).toBe(false);
    expect(
      artifact.safeParse({ proof: "proof", usedPremises: ["n2", "n2"] })
        .success,
    ).toBe(false);

    const comparison = reconstructionComparison;
    expect(
      comparison.safeParse({
        verdict: "PASS",
        report: "exact",
        targetCoverage: "EXACT",
        undeclaredPremises: [],
      }).success,
    ).toBe(true);
    expect(
      comparison.safeParse({
        verdict: "PASS",
        report: "undeclared dependency",
        targetCoverage: "EXACT",
        undeclaredPremises: ["External theorem X"],
      }).success,
    ).toBe(false);
  });

  test("the mode menu and boundary battery are frozen", () => {
    expect(verificationModes).toEqual([
      "proof-audit",
      "reconstruction",
      "refutation",
      "external-premises",
    ]);
    expect(boundaryModes).toEqual([
      "proof-audit",
      "external-premises",
      "reconstruction",
      "refutation",
      "criteria-match",
    ]);
  });
});

describe("call activity", () => {
  test("labels resolve to roles with numeric triggers only", () => {
    const prefix = "elenx-solve/exploration-v17";
    expect(callActivity(`${prefix}/explorer/initial`)).toEqual({
      role: "explorer",
    });
    expect(callActivity(`${prefix}/explorer/12`)).toEqual({
      role: "explorer",
      triggerCall: 12,
    });
    expect(callActivity(`${prefix}/curation/7`)).toEqual({
      role: "curation",
      triggerCall: 7,
    });
    expect(callActivity(`${prefix}/verify/n3/proof-audit/19`)).toEqual({
      role: "verify",
      triggerCall: 19,
    });
    expect(callActivity(`${prefix}/candidate/criteria-match`)).toEqual({
      role: "candidate",
    });
    expect(callActivity("elenx-solve/other/explorer/1")).toEqual({
      role: "unknown",
    });
  });
});

describe("v17 campaign parsing", () => {
  test("same-protocol campaigns require the current call surface", () => {
    const runtimeProfile = {
      ...profile,
      api: "openai-responses",
      baseUrl: "https://invalid.test/v1",
    };
    const current = taskSchema.parse({
      protocol: "exploration-v17",
      callSurface,
      problem: "Prove P.",
      completionCriteria: "Give a proof of P.",
      maxContextTokens: 200_000,
      maxIndexTokens: 100_000,
      maxExplorerTurns: 50,
      guidance: [],
      explorer: runtimeProfile,
      curator: runtimeProfile,
      triage: runtimeProfile,
      verifier: runtimeProfile,
      sourceChecker: settings.sourceChecker,
    });
    const { callSurface: _oldSurface, ...oldConfig } = current;
    expect(() =>
      parseCampaign({
        seq: 1,
        atMs: 1,
        kind: "campaign",
        application: "elenx-solve",
        config: oldConfig,
      }),
    ).toThrow("invalid elenx-solve exploration-v17 campaign config");
  });

  test("campaigns from earlier protocols are unsupported", () => {
    for (const protocol of ["exploration-v15", "exploration-v16"]) {
      expect(() =>
        parseCampaign({
          seq: 1,
          atMs: 1,
          kind: "campaign",
          application: "elenx-solve",
          config: { protocol },
        }),
      ).toThrow(`unsupported elenx-solve protocol: ${protocol}`);
    }
  });
});
