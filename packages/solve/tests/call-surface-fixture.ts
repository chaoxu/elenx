import { createHash } from "node:crypto";

import {
  batteryFinding,
  defectReport,
  mechanicalFinding,
  offlinePremiseRejection,
  premiseRepairFindings,
  sourceRepairFindings,
  sourceVerificationRejection,
} from "../fold-authored";
import { callSurface, protocolName, type Task } from "../exploration-protocol";
import {
  boundaryLabel,
  blindReconstructionTurn,
  callParameters,
  candidateVerifierLabels,
  curationLabel,
  curationTurn,
  estimatedTextTokens,
  explorerLabel,
  explorerTurn,
  premiseTurn,
  reconstructionCertificationLabel,
  reconstructionCertificationTurn,
  reconstructionComparisonTurn,
  reconstructionDerivationLabel,
  serveLabel,
  serveTurn,
  structuredCallReplayIdentity,
  triageLabel,
  triageTurn,
  verdictTurn,
  verifyLabel,
  type VerifyView,
} from "../turns";
import { sourceCheckRequestFor } from "../verifiers/source-check";

// This corpus guards structured Pi calls, source-check requests, and the
// fold-authored findings and reports that become later call or evidence bytes.
const runtimeProfile = {
  provider: "fixture-provider",
  model: "fixture-model",
  reasoning: "high",
  api: "openai-responses",
  baseUrl: "https://fixture.invalid/v1",
} as const;

const task: Task = {
  protocol: protocolName,
  callSurface,
  problem: "Prove fixture theorem P for every integer m >= 1.",
  completionCriteria:
    "Define P, prove the base and inductive cases, and state the conclusion.",
  maxContextTokens: 200_000,
  maxIndexTokens: 100_000,
  maxExplorerTurns: 50,
  guidance: [
    { origin: "default", text: "Use a durable proof graph." },
    { origin: "user", text: "Try induction and attack edge cases." },
  ],
  explorer: { ...runtimeProfile, model: "fixture-explorer" },
  curator: { ...runtimeProfile, model: "fixture-curator" },
  triage: { ...runtimeProfile, model: "fixture-triage" },
  verifier: { ...runtimeProfile, model: "fixture-verifier" },
  sourceChecker: { model: "fixture-source-checker", reasoning: "max" },
};

const explorerIndex = [
  { id: "n1", summary: "P holds at one", standing: "verified" as const },
  {
    id: "n2",
    summary: "P(m) implies P(m+1)",
    standing: "conjecture" as const,
  },
  { id: "n4", summary: "Try induction next", standing: "report" as const },
];
const serveIndex = [
  {
    id: "n1",
    summary: "P holds at one",
    statement: "P holds at one",
    standing: "verified" as const,
    parents: [],
    textTokens: 8,
    recent: false,
    plan: ["proof-audit"],
    verdicts: [
      {
        mode: "proof-audit",
        verdict: "PASS" as const,
        report: "Base proof is sound.",
      },
    ],
    closureVerified: true,
    boundaryAttempts: [],
    goalEligible: true,
    retriable: false,
  },
  {
    id: "n2",
    summary: "P(m) implies P(m+1)",
    statement: "For m >= 1, P(m) implies P(m+1)",
    standing: "conjecture" as const,
    parents: ["n1"],
    textTokens: 18,
    recent: true,
    plan: ["proof-audit", "reconstruction"],
    verdicts: [
      {
        mode: "reconstruction",
        verdict: "INCONCLUSIVE" as const,
        report: "The inductive hypothesis is underspecified.",
      },
    ],
    closureVerified: true,
    boundaryAttempts: [],
    goalEligible: true,
    retriable: true,
  },
  {
    id: "n4",
    summary: "Try induction next",
    statement: "Process plan: try induction next",
    standing: "report" as const,
    parents: [],
    textTokens: 5,
    recent: false,
    plan: [],
    verdicts: [],
    closureVerified: true,
    boundaryAttempts: [],
    goalEligible: false,
    retriable: false,
  },
];
const premises = [
  { id: "n1", statement: "P holds at one" },
  { id: "n2", statement: "P(m) implies P(m+1)" },
];
const reconstructionBundle = {
  note: "n5",
  target: task.problem,
  keyIdeas: ["Use induction on m and preserve invariant P."],
  allowedSources: ["The induction principle on positive integers."],
  premises: [premises[1]!],
};

function verifyView(
  scope: VerifyView["scope"],
  mode: VerifyView["mode"],
): VerifyView {
  return {
    scope,
    note: "n5",
    statement: "P holds for every integer m >= 1",
    text: "Base case. Inductive step. Therefore P holds for every m >= 1.",
    ...(scope === "boundary"
      ? { storedStatement: "P holds for every integer m >= 1" }
      : {}),
    premises,
    mode,
  };
}

function fixtureTurns() {
  return {
    explorerInitial: explorerTurn(task, {
      first: true,
      index: [],
      expanded: [],
    }),
    explorerWorking: explorerTurn(task, {
      first: false,
      index: explorerIndex,
      expanded: [{ id: "n7", text: "Full expanded-note proof." }],
      objective: "Integrate the induction proof.",
    }),
    explorerFailure: explorerTurn(task, {
      first: false,
      index: explorerIndex,
      expanded: [],
      failure: {
        goalNote: "n5",
        text: "Candidate proof bytes.",
        reconstruction: {
          keyIdeas: ["Use induction."],
          allowedSources: [],
        },
        verdicts: [
          {
            mode: "proof-audit",
            verdict: "FAIL",
            report: "The induction step omits its hypothesis.",
          },
        ],
      },
    }),
    curation: curationTurn(task, {
      index: explorerIndex,
      findings: [
        { text: "P holds at one.", basedOn: [], basedOnFindings: [] },
        {
          text: "P(m) implies P(m+1).",
          basedOn: ["n1"],
          basedOnFindings: [1],
        },
      ],
    }),
    curationRepair: curationTurn(task, {
      index: explorerIndex,
      findings: [
        {
          text: "Candidate proof bytes.",
          basedOn: ["n1"],
          basedOnFindings: [],
        },
      ],
      repair: {
        goalNote: "n5",
        reconstruction: {
          keyIdeas: ["Leaky stepwise guide."],
          allowedSources: [],
        },
        verdicts: [
          {
            mode: "reconstruction-certification",
            verdict: "FAIL",
            report: "The key ideas copy the proof.",
          },
        ],
      },
    }),
    triage: triageTurn(task, {
      batch: [
        {
          id: "n5",
          statement: "P holds at one",
          text: "Base-case proof.",
          basedOn: [],
          priorVerdicts: [],
        },
        {
          id: "n6",
          statement: "P(m) implies P(m+1)",
          text: "Induction-step proof.",
          basedOn: premises,
          priorVerdicts: [],
        },
      ],
    }),
    serve: serveTurn(task, {
      index: serveIndex,
      explorerIndex,
      expansions: [
        { id: "n1", text: "Base-case proof." },
        { id: "n2", text: "Induction-step proof." },
        { id: "n4", text: "Try induction next." },
      ],
      turns: 3,
      history: [
        {
          expand: ["n1"],
          objective: "Develop the induction step.",
          retriage: [],
        },
      ],
      hints: { expand: ["n1", "n2"], objective: "Finish induction." },
    }),
    noteProofAudit: verdictTurn(task, verifyView("note", "proof-audit")),
    boundaryProofAudit: verdictTurn(
      task,
      verifyView("boundary", "proof-audit"),
    ),
    noteReconstruction: verdictTurn(task, verifyView("note", "reconstruction")),
    reconstructionCertification: reconstructionCertificationTurn(task, {
      candidate: "Base case. Inductive step. Therefore P holds.",
      bundle: reconstructionBundle,
      trustedClosure: [premises[0]!],
    }),
    blindReconstruction: blindReconstructionTurn(task, reconstructionBundle),
    reconstructionComparison: reconstructionComparisonTurn(task, {
      candidate: "Base case. Inductive step. Therefore P holds.",
      bundle: reconstructionBundle,
      reconstruction: {
        call: 41,
        artifact: {
          proof: "An independent induction proves P for every m.",
          usedPremises: ["n2"],
        },
      },
    }),
    noteRefutation: verdictTurn(task, verifyView("note", "refutation")),
    boundaryRefutation: verdictTurn(task, verifyView("boundary", "refutation")),
    boundaryCriteria: verdictTurn(
      task,
      verifyView("boundary", "criteria-match"),
    ),
    premise: premiseTurn(
      task,
      "A candidate cites external theorem Q and external theorem R.",
      premises,
    ),
  };
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalize(item),
    );
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .flatMap((key) => {
          const item = record[key];
          return item === undefined ? [] : [[key, canonicalize(item)]];
        }),
    );
  }
  throw new Error(`unsupported golden value: ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

export function callSurfaceCorpus(): Record<string, unknown> {
  const turns = fixtureTurns();
  const validExplorer = {
    findings: [
      { text: "base", basedOn: ["n1"] },
      { text: "step", basedOnFindings: [1] },
    ],
  };
  const validCuration = {
    filings: [
      {
        finding: 1,
        summary: "base",
        statement: "P holds at one",
        reconstruction: { keyIdeas: ["check m=1"], allowedSources: [] },
      },
      {
        finding: 2,
        summary: "step",
        statement: "P(m) implies P(m+1)",
        reconstruction: {
          keyIdeas: ["apply the inductive transition"],
          allowedSources: [],
        },
      },
    ],
  };
  const validTriage = {
    plans: [
      { note: "n5", modes: ["proof-audit"], rationale: "derivation" },
      { note: "n6", modes: [], rationale: "process report" },
    ],
  };
  const premiseRepairs = premiseRepairFindings([
    {
      statement: "Offline premise A",
      hypotheses: ["hypothesis A"],
      application: "A supports the construction",
      answerQuote: "uses premise A",
      standing: "REFUTED",
      refutation: "parameter value zero contradicts A",
    },
    {
      statement: "Offline premise B",
      hypotheses: ["hypothesis B"],
      application: "B supports the bound",
      answerQuote: "uses premise B",
      standing: "MISAPPLIED",
      defect: "hypothesis B is absent",
    },
    {
      statement: "Offline premise C",
      hypotheses: ["hypothesis C"],
      application: "C supports the citation",
      answerQuote: "uses premise C",
      standing: "UNRESOLVED",
      refutationAttempt: "small cases survived",
      gap: "an authoritative source is needed",
    },
  ]);
  const sourceRepairs = sourceRepairFindings([
    {
      statement: "Source premise A",
      standing: "REFUTED",
      refutation: "the source states the opposite",
    },
    {
      statement: "Source premise B",
      standing: "MISAPPLIED",
      defect: "the source hypothesis is absent",
    },
    {
      statement: "Source premise C",
      standing: "UNRESOLVED",
      refutationAttempt: "no counterexample was found",
      gap: "the exact theorem was not located",
    },
    {
      statement: "Source premise D",
      standing: "SOURCED",
      citation: "Fixture source D",
      url: "https://fixture.invalid/d",
      locator: "Theorem D",
      exactQuote: "Source premise D holds.",
      sourceMatch: "The quote matches D.",
      candidateCitationMatch: "MISMATCH",
      candidateCitationCheck: "The candidate names the wrong theorem.",
      refutationAttempt: "No refutation found.",
      application: "APPLIES",
      applicationCheck: "D applies directly.",
    },
    {
      statement: "Source premise E",
      standing: "SOURCED",
      citation: "Fixture source E",
      url: "https://fixture.invalid/e",
      locator: "Theorem E",
      exactQuote: "Source premise E holds.",
      sourceMatch: "The quote matches E.",
      candidateCitationMatch: "MATCH",
      candidateCitationCheck: "The candidate citation matches.",
      refutationAttempt: "No refutation found.",
      application: "APPLIES",
      applicationCheck: "E applies directly.",
    },
  ]);

  return {
    "turn.explorer.initial": structuredCallReplayIdentity(
      turns.explorerInitial,
    ),
    "turn.explorer.working": structuredCallReplayIdentity(
      turns.explorerWorking,
    ),
    "turn.explorer.failure": structuredCallReplayIdentity(
      turns.explorerFailure,
    ),
    "turn.curation": structuredCallReplayIdentity(turns.curation),
    "turn.curation.repair": structuredCallReplayIdentity(turns.curationRepair),
    "turn.triage": structuredCallReplayIdentity(turns.triage),
    "turn.serve": structuredCallReplayIdentity(turns.serve),
    "turn.verify.note.proof-audit": structuredCallReplayIdentity(
      turns.noteProofAudit,
    ),
    "turn.verify.boundary.proof-audit": structuredCallReplayIdentity(
      turns.boundaryProofAudit,
    ),
    "turn.verify.note.reconstruction": structuredCallReplayIdentity(
      turns.noteReconstruction,
    ),
    "turn.verify.boundary.reconstruction-certification":
      structuredCallReplayIdentity(turns.reconstructionCertification),
    "turn.verify.boundary.reconstruction-derive": structuredCallReplayIdentity(
      turns.blindReconstruction,
    ),
    "turn.verify.boundary.reconstruction-comparison":
      structuredCallReplayIdentity(turns.reconstructionComparison),
    "turn.verify.note.refutation": structuredCallReplayIdentity(
      turns.noteRefutation,
    ),
    "turn.verify.boundary.refutation": structuredCallReplayIdentity(
      turns.boundaryRefutation,
    ),
    "turn.verify.boundary.criteria-match": structuredCallReplayIdentity(
      turns.boundaryCriteria,
    ),
    "turn.verify.external-premises": structuredCallReplayIdentity(
      turns.premise,
    ),
    "fold.mechanicalFinding": mechanicalFinding("n9", {
      report: true,
      unverified: [
        { id: "n2", standing: "conjecture" },
        { id: "n3", standing: "refuted" },
      ],
      cyclic: true,
    }),
    "fold.batteryFinding": batteryFinding(41, "n9", [
      {
        mode: "proof-audit",
        verdict: "FAIL",
        report: "the reduction loses one edge",
      },
      {
        mode: "criteria-match",
        verdict: "INCONCLUSIVE",
        report: "the parameter bound is unstated",
      },
    ]),
    "fold.premiseRepairFindings": premiseRepairs,
    "fold.sourceRepairFindings": sourceRepairs,
    "fold.defectReport": defectReport(
      "Source verification rejected the note.",
      {
        premiseRepairs,
        sourceRepairs,
      },
    ),
    "fold.offlinePremiseRejection.note": offlinePremiseRejection(
      "note",
      premiseRepairs,
    ),
    "fold.offlinePremiseRejection.candidate": offlinePremiseRejection(
      "candidate",
      premiseRepairs,
    ),
    "fold.sourceVerificationRejection.note": sourceVerificationRejection(
      "note",
      sourceRepairs,
    ),
    "fold.sourceVerificationRejection.candidate": sourceVerificationRejection(
      "candidate",
      sourceRepairs,
    ),
    "schema.normalized": {
      explorer: turns.explorerWorking.schema.parse(validExplorer),
      curation: turns.curation.schema.parse(validCuration),
      triage: turns.triage.schema.parse(validTriage),
      serve: turns.serve.schema.parse({}),
      verdict: turns.noteProofAudit.schema.parse({
        verdict: "PASS",
        report: "checked",
        statementForm: "PROPOSITION_ONLY",
        statementFidelity: "MATCH",
      }),
      premise: turns.premise.schema.parse({
        report: "no open premises",
        premises: [],
      }),
      reconstructionCertification:
        turns.reconstructionCertification.schema.parse({
          verdict: "PASS",
          report: "bundle is safe",
          keyIdeas: "SAFE",
          allowedSources: "SAFE",
          premises: [
            {
              note: "n2",
              disposition: "RELEVANT_LOGICAL_PREMISE",
              report: "the candidate invokes the induction step",
            },
          ],
          closure: [
            {
              note: "n1",
              disposition: "SAFE",
              report: "the base statement is noncircular",
            },
          ],
        }),
      blindReconstruction: turns.blindReconstruction.schema.parse({
        proof: "independent induction",
        usedPremises: ["n2"],
      }),
      reconstructionComparison: turns.reconstructionComparison.schema.parse({
        verdict: "PASS",
        report: "exact target reached",
        targetCoverage: "EXACT",
        undeclaredPremises: [],
      }),
    },
    "schema.acceptance": {
      firstTurnPredictedNote: turns.explorerInitial.schema.safeParse({
        findings: [{ text: "claim", basedOn: ["n1"] }],
      }).success,
      visibleIndexNote: turns.explorerWorking.schema.safeParse({
        findings: [{ text: "claim", basedOn: ["n1"] }],
      }).success,
      visibleReportNote: turns.explorerWorking.schema.safeParse({
        findings: [{ text: "claim", basedOn: ["n4"] }],
      }).success,
      expandedOnlyNote: turns.explorerWorking.schema.safeParse({
        findings: [{ text: "claim", basedOn: ["n7"] }],
      }).success,
      hiddenNote: turns.explorerWorking.schema.safeParse({
        findings: [{ text: "claim", basedOn: ["n8"] }],
      }).success,
      backwardFinding:
        turns.explorerWorking.schema.safeParse(validExplorer).success,
      forwardFinding: turns.explorerWorking.schema.safeParse({
        findings: [{ text: "claim", basedOnFindings: [1] }],
      }).success,
      incompleteCuration: turns.curation.schema.safeParse({
        filings: [
          { finding: 1, summary: "only one", statement: "Only one claim" },
        ],
      }).success,
      duplicateTriageMode: turns.triage.schema.safeParse({
        plans: [
          {
            note: "n5",
            modes: ["proof-audit", "proof-audit"],
            rationale: "duplicate",
          },
          { note: "n6", modes: [], rationale: "report" },
        ],
      }).success,
      proofAuditPassWithSupport: turns.noteProofAudit.schema.safeParse({
        verdict: "PASS",
        report: "proof leaked into statement",
        statementForm: "CONTAINS_SUPPORT",
        statementFidelity: "MATCH",
      }).success,
      reconstructionPassWithSupport: turns.noteReconstruction.schema.safeParse({
        verdict: "PASS",
        report: "proof leaked into target",
        statementForm: "CONTAINS_SUPPORT",
      }).success,
      goalWithObjective: turns.serve.schema.safeParse({
        goalNote: "n1",
        objective: "keep exploring",
      }).success,
      nonverbatimPremiseQuote: turns.premise.schema.safeParse({
        report: "one open premise",
        premises: [
          {
            statement: "External theorem Q",
            hypotheses: [],
            application: "used here",
            answerQuote: "absent quote",
            standing: "UNRESOLVED",
            refutationAttempt: "none found",
            gap: "source needed",
          },
        ],
      }).success,
    },
    labels: {
      explorerInitial: explorerLabel(),
      explorer: explorerLabel(11),
      curation: curationLabel(13),
      triage: triageLabel(17),
      serve: serveLabel(19),
      verify: verifyLabel("n5", "proof-audit", 23),
      boundary: boundaryLabel("criteria-match"),
      reconstructionCertification: reconstructionCertificationLabel(),
      reconstructionDerivation: reconstructionDerivationLabel(),
      candidateVerifiers: candidateVerifierLabels(),
      candidateBinding: {
        label: boundaryLabel("proof-audit"),
        candidate: 41,
      },
    },
    callParameters,
    sourceCheck: sourceCheckRequestFor(
      41,
      43,
      [
        {
          statement: "External theorem Q",
          hypotheses: ["m is positive"],
          application: "Q supplies the induction step",
          answerQuote: "cites external theorem Q",
          standing: "UNRESOLVED",
          refutationAttempt: "Checked the smallest positive values",
          gap: "The cited theorem must be located",
          claimedCitation: {
            citation: "Author, Theorem Q",
            url: "https://fixture.invalid/q",
            locator: "Theorem 2",
          },
        },
        {
          statement: "External theorem R",
          hypotheses: ["m is odd"],
          application: "R supplies the parity claim",
          answerQuote: "external theorem R",
          standing: "UNRESOLVED",
          refutationAttempt: "Checked the first odd values",
          gap: "No source is given",
        },
      ],
      task.sourceChecker,
    ),
    tokenEstimates: [
      "fixed replay boundary text",
      "mathematical symbols: ∀m ≥ 1, P(m)",
    ].map((text) => ({ text, tokens: estimatedTextTokens(text) })),
  };
}

export function callSurfaceGolden() {
  const corpus = callSurfaceCorpus();
  return {
    callSurface,
    aggregate: digest(corpus),
    cases: Object.fromEntries(
      Object.entries(corpus)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([name, value]) => [name, digest(value)]),
    ),
  };
}

export function callSurfaceGoldenText(): string {
  return `${JSON.stringify(callSurfaceGolden(), null, 2)}\n`;
}

export function callSurfaceGoldenUrl(): URL {
  return new URL(
    `./fixtures/call-surfaces/${callSurface}.json`,
    import.meta.url,
  );
}
