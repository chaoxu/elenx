import { describe, expect, test } from "bun:test";

import {
  curationSubmissionFor,
  explorerSubmission,
  parseCampaign,
  settingsSchema,
} from "../exploration-protocol";

const profile = {
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  reasoning: "max",
} as const;
const settings = {
  protocol: "exploration-v16",
  explorer: profile,
  curator: profile,
  premiseVerifier: profile,
  sourceChecker: { model: "gpt-5.6-sol", reasoning: "max" },
  proofVerifier: profile,
} as const;

describe("v16 settings", () => {
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
      settingsSchema.safeParse({ ...settings, protocol: "exploration-v15" })
        .success,
    ).toBe(false);
  });

  test("requires every role profile", () => {
    for (const role of [
      "explorer",
      "curator",
      "premiseVerifier",
      "sourceChecker",
      "proofVerifier",
    ] as const) {
      const { [role]: _dropped, ...partial } = settings;
      expect(settingsSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("v16 explorer submissions", () => {
  test("continue carries findings and defaults their basedOn", () => {
    const parsed = explorerSubmission.parse({
      action: "continue",
      findings: [
        { text: "lemma L holds" },
        { text: "route B dies", basedOn: ["n2"] },
      ],
      nextObjective: "close the parity case",
      expand: ["n1"],
    });
    expect(parsed.findings[0]?.basedOn).toEqual([]);
    expect(parsed.findings[1]?.basedOn).toEqual(["n2"]);
  });

  test("continue requires at least one finding", () => {
    expect(
      explorerSubmission.safeParse({ action: "continue", findings: [] })
        .success,
    ).toBe(false);
  });

  test("continue cannot carry an answer or submit-level basedOn", () => {
    expect(
      explorerSubmission.safeParse({
        action: "continue",
        findings: [{ text: "finding" }],
        answer: "answer",
      }).success,
    ).toBe(false);
    expect(
      explorerSubmission.safeParse({
        action: "continue",
        findings: [{ text: "finding" }],
        basedOn: ["n1"],
      }).success,
    ).toBe(false);
  });

  test("submit carries one answer with optional provenance", () => {
    const parsed = explorerSubmission.parse({
      action: "submit",
      answer: "standalone proof",
      basedOn: ["n1", "n3"],
    });
    expect(parsed.answer).toBe("standalone proof");
    expect(parsed.basedOn).toEqual(["n1", "n3"]);
  });

  test("submit requires the answer", () => {
    expect(explorerSubmission.safeParse({ action: "submit" }).success).toBe(
      false,
    );
  });

  test("submit cannot carry findings, an objective, or expands", () => {
    for (const extra of [
      { findings: [{ text: "finding" }] },
      { nextObjective: "keep going" },
      { expand: ["n1"] },
    ]) {
      expect(
        explorerSubmission.safeParse({
          action: "submit",
          answer: "proof",
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  test("note ids follow the minted format", () => {
    for (const bad of ["n0", "x1", "n01", "note1"]) {
      expect(
        explorerSubmission.safeParse({
          action: "submit",
          answer: "proof",
          basedOn: [bad],
        }).success,
      ).toBe(false);
    }
  });
});

describe("v16 curation submissions", () => {
  const schema = curationSubmissionFor(2, ["n1", "n2"], false);
  const withVerdict = curationSubmissionFor(1, ["n1"], true);

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

  test("invalidation requires an ingested verdict and a known note", () => {
    expect(
      schema.safeParse({
        filings: [
          { finding: 1, summary: "first" },
          { finding: 2, summary: "second" },
        ],
        invalidations: [{ note: "n1", cause: "refuted by proof audit" }],
      }).success,
    ).toBe(false);
    expect(
      withVerdict.safeParse({
        filings: [{ finding: 1, summary: "defect recorded" }],
        invalidations: [{ note: "n1", cause: "refuted by proof audit" }],
      }).success,
    ).toBe(true);
    expect(
      withVerdict.safeParse({
        filings: [{ finding: 1, summary: "defect recorded" }],
        invalidations: [{ note: "n9", cause: "refuted by proof audit" }],
      }).success,
    ).toBe(false);
  });
});

describe("v16 campaign parsing", () => {
  test("a v15 campaign names its replay release", () => {
    expect(() =>
      parseCampaign({
        seq: 1,
        atMs: 1,
        kind: "campaign",
        application: "elenx-solve",
        config: { protocol: "exploration-v15" },
      }),
    ).toThrow("exploration-v15 requires elenx-solve v0.34.0");
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
