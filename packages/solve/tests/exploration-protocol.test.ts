import { describe, expect, test } from "bun:test";

import {
  assessment,
  boundaryModes,
  curationSubmissionFor,
  explorerSubmission,
  parseCampaign,
  serveSubmissionFor,
  settingsSchema,
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
  test("a turn carries findings and defaults their basedOn", () => {
    const parsed = explorerSubmission.parse({
      findings: [
        { text: "lemma L holds" },
        { text: "route B dies", basedOn: ["n2"] },
      ],
      nextObjective: "close the parity case",
      expand: ["n1"],
    });
    expect(parsed.findings[0]?.basedOn).toEqual([]);
    expect(parsed.findings[1]?.basedOn).toEqual(["n2"]);
    expect(parsed.expand).toEqual(["n1"]);
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
});

describe("v17 curation submissions", () => {
  const schema = curationSubmissionFor(2, ["n1", "n2"]);

  test("files every finding exactly once", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first" },
          { finding: 2, summary: "second" },
        ],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ filings: [{ finding: 1, summary: "only" }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first" },
          { finding: 1, summary: "again" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first" },
          { finding: 3, summary: "beyond" },
        ],
      }).success,
    ).toBe(false);
  });

  test("minting and refining require a summary; duplicates do not", () => {
    expect(
      schema.safeParse({
        filings: [{ finding: 1 }, { finding: 2, summary: "second" }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, duplicateOf: "n1" },
          { finding: 2, summary: "second" },
        ],
      }).success,
    ).toBe(true);
  });

  test("a filing cannot refine and duplicate at once", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "s", refines: "n1", duplicateOf: "n2" },
          { finding: 2, summary: "second" },
        ],
      }).success,
    ).toBe(false);
  });

  test("each note is refined at most once per curation", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first pass", refines: "n1" },
          { finding: 2, summary: "second pass", refines: "n1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first", refines: "n1" },
          { finding: 2, summary: "second", refines: "n2" },
        ],
      }).success,
    ).toBe(true);
  });

  test("refinement and duplicate targets must exist", () => {
    for (const target of [{ refines: "n9" }, { duplicateOf: "n9" }]) {
      expect(
        schema.safeParse({
          filings: [
            { finding: 1, summary: "s", ...target },
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
  const schema = serveSubmissionFor(["n1", "n2"]);

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

  test("the mode menu and boundary battery are frozen", () => {
    expect(verificationModes).toEqual([
      "proof-audit",
      "reconstruction",
      "refutation",
      "external-premises",
    ]);
    expect(boundaryModes).toEqual([
      "proof-audit",
      "reconstruction",
      "refutation",
      "external-premises",
      "criteria-match",
    ]);
  });
});

describe("v17 campaign parsing", () => {
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

  test("an unknown protocol is unsupported", () => {
    expect(() =>
      parseCampaign({
        seq: 1,
        atMs: 1,
        kind: "campaign",
        application: "elenx-solve",
        config: { protocol: "exploration-v99" },
      }),
    ).toThrow("unsupported elenx-solve protocol: exploration-v99");
  });
});
