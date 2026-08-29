// The exploration-v17 campaign fold: the single source of truth for phase
// derivation and inspection. One synchronous walk refolds journal events
// into the note projection, resolves every settled phase in order, and
// stops at the first unresolved one. runCampaign dispatches the fold's
// phase; snapshot projects the rest for the CLI. Everything here is pure
// over the journal. Matching re-derives the frozen bytes in turns.ts, and
// the defect-text builders below author frozen bytes of their own.

import { isDeepStrictEqual } from "node:util";

import {
  deriveCandidateStatus,
  returnedToolSubmission,
  type Entry,
  type EntryId,
  type Json,
  type Reader,
} from "elenx";
import { piRequest, piStoredResult } from "elenx/pi";
import { z } from "zod";

import {
  boundaryModes,
  type Assessment,
  type CurationSubmission,
  type ExplorerSubmission,
  type Finding,
  type ServeSubmission,
  type Task,
  type TriageSubmission,
  type VerificationMode,
} from "./exploration-protocol";
// The external-premises mode reuses the audited premise and source machinery
// verbatim, scoped to one note's exact text instead of a whole candidate.
import {
  boundaryLabel,
  callParameters,
  candidateVerifierLabels,
  curationLabel,
  curationTurn,
  estimatedTextTokens,
  explorerLabel,
  explorerTurn,
  premiseTurn,
  renderIndexBlock,
  serveLabel,
  serveTurn,
  triageLabel,
  triageTurn,
  verdictTurn,
  verifyLabel,
  type CuratorView,
  type ExplorerView,
  type PremiseStatement,
  type ServeView,
  type Standing,
  type StandingEntry,
  type StructuredCall,
  type TriageView,
  type VerifyView,
} from "./turns";
import {
  premiseVerdict,
  type PremiseFinding,
  type PremiseSubmission,
  type UnresolvedPremise,
} from "./verifiers/premise-audit";
import {
  sourceCheckRequestFor,
  sourceCheckResultFor,
  sourceCheckVerdict,
  type SourceCheckRequest,
  type SourceResolution,
} from "./verifiers/source-check";

export interface TurnRecord {
  readonly call: EntryId;
  readonly settled: EntryId;
  readonly submission: ExplorerSubmission;
}

export interface CurationRecord {
  readonly call: EntryId;
  readonly settled: EntryId;
  readonly submission: CurationSubmission;
  readonly minted: readonly string[];
  readonly refined: readonly string[];
}

export interface TriageRecord {
  readonly call: EntryId;
  readonly settled: EntryId;
  readonly submission: TriageSubmission;
}

export interface NoteVerdictRecord {
  readonly note: string;
  readonly mode: string;
  readonly settled: EntryId;
  readonly verdict: Assessment["verdict"];
  readonly report: string;
}

export interface ServeRecord {
  readonly call: EntryId;
  readonly settled: EntryId;
  readonly submission: ServeSubmission;
}

export interface VerdictRecord {
  readonly mode: string;
  readonly record: EntryId;
  readonly verdict: Assessment["verdict"];
  readonly report: string;
}

export interface CandidateRecord {
  readonly id: EntryId;
  readonly originCall: EntryId;
  readonly answer: string;
  readonly goalNote: string;
  readonly verdicts: readonly VerdictRecord[];
}

export type ModelPhase =
  | {
      readonly kind: "explorer";
      readonly label: string;
      readonly after: EntryId;
      readonly view: ExplorerView;
      readonly indexTokens: number;
    }
  | {
      readonly kind: "curation";
      readonly label: string;
      readonly after: EntryId;
      readonly view: CuratorView;
    }
  | {
      readonly kind: "triage";
      readonly label: string;
      readonly after: EntryId;
      readonly view: TriageView;
    }
  | {
      readonly kind: "verify";
      readonly label: string;
      readonly after: EntryId;
      readonly view: VerifyView;
      readonly candidate?: EntryId;
    }
  | {
      readonly kind: "note-source-check";
      readonly label: string;
      readonly after: EntryId;
      readonly note: string;
      readonly request: SourceCheckRequest;
      readonly candidate?: EntryId;
    }
  | {
      readonly kind: "serve";
      readonly label: string;
      readonly after: EntryId;
      readonly view: ServeView;
    };

type Phase =
  | ModelPhase
  | {
      readonly kind: "create-candidate";
      readonly answer: string;
    }
  | {
      readonly kind: "record-verdict";
      readonly candidate: EntryId;
      readonly call: EntryId;
      readonly verdict: Assessment["verdict"];
      readonly evidence: Json;
    }
  | {
      readonly kind: "solved";
      readonly candidate: EntryId;
    }
  | {
      readonly kind: "index-limit";
      readonly tokens: number;
    };

export function phaseRole(phase: ModelPhase): string {
  if (phase.kind === "curation" || phase.kind === "serve") return "curator";
  if (phase.kind === "verify") return "verifier";
  if (phase.kind === "note-source-check") return "source-check";
  return phase.kind;
}

// ---------------------------------------------------------------------------
// Frozen defect texts. These strings become finding and report bytes that
// flow into later prompts and journal evidence, so they are replay-frozen
// exactly like the call surface in turns.ts.
// ---------------------------------------------------------------------------

function mechanicalFinding(
  goal: string,
  gap: {
    readonly report?: boolean;
    readonly unverified: readonly {
      readonly id: string;
      readonly standing: string;
    }[];
    readonly cyclic: boolean;
  },
): Finding {
  const reasons: string[] = [];
  if (gap.report === true) {
    reasons.push("the declared note is a process report, not a claim");
  }
  if (gap.unverified.length > 0) {
    reasons.push(`unverified ancestors: ${JSON.stringify(gap.unverified)}`);
  }
  if (gap.cyclic) reasons.push("the declared note sits on a dependency cycle");
  return {
    text: `Goal declaration for note ${goal} was rejected before verification.\n\nBlocking gaps:\n${reasons.join("\n")}`,
    basedOn: [],
  };
}

function batteryFinding(
  candidate: EntryId,
  goal: string,
  failing: readonly VerdictRecord[],
): Finding {
  const quoted = failing.map(({ mode, verdict, report }) => ({
    mode,
    verdict,
    report,
  }));
  return {
    text: `Goal candidate ${candidate} for note ${goal} failed boundary verification.\n\nFailing verdicts:\n${JSON.stringify(quoted, null, 2)}`,
    basedOn: [],
  };
}

function defectReport(report: string, details: unknown): string {
  return `${report}\n\nExact blocking findings:\n${JSON.stringify(details, null, 2)}`;
}

function premiseRepairFindings(findings: readonly PremiseFinding[]): Json[] {
  const selected: Json[] = [];
  for (const finding of findings) {
    if (finding.standing === "REFUTED") {
      selected.push({
        statement: finding.statement,
        standing: finding.standing,
        refutation: finding.refutation,
      });
    }
    if (finding.standing === "MISAPPLIED") {
      selected.push({
        statement: finding.statement,
        standing: finding.standing,
        defect: finding.defect,
      });
    }
  }
  return selected;
}

function sourceRepairFindings(
  resolutions: readonly SourceResolution[],
): Json[] {
  const selected: Json[] = [];
  for (const resolution of resolutions) {
    if (resolution.standing === "REFUTED") {
      selected.push({
        statement: resolution.statement,
        standing: resolution.standing,
        refutation: resolution.refutation,
      });
    }
    if (resolution.standing === "MISAPPLIED") {
      selected.push({
        statement: resolution.statement,
        standing: resolution.standing,
        defect: resolution.defect,
      });
    }
    if (resolution.standing === "UNRESOLVED") {
      selected.push({
        statement: resolution.statement,
        standing: resolution.standing,
        gap: resolution.gap,
      });
    }
    if (
      resolution.standing === "SOURCED" &&
      resolution.candidateCitationMatch === "MISMATCH"
    ) {
      selected.push({
        statement: resolution.statement,
        standing: "CITATION_MISMATCH",
        defect: resolution.candidateCitationCheck,
      });
    }
  }
  return selected;
}

interface NoteModeContext {
  readonly note: string;
  readonly statement: string;
  readonly text: string;
  readonly premises: readonly PremiseStatement[];
  readonly mode: VerificationMode;
  readonly version: EntryId;
  readonly trigger: EntryId;
  readonly after: EntryId;
}

function resolveNoteMode(
  records: readonly Entry[],
  task: Task,
  context: NoteModeContext,
): { readonly pending: Phase } | { readonly record: NoteVerdictRecord } {
  const label = verifyLabel(context.note, context.mode, context.trigger);
  const view: VerifyView = {
    note: context.note,
    statement: context.statement,
    text: context.text,
    premises: context.premises,
    mode: context.mode,
  };
  const phase: Extract<ModelPhase, { kind: "verify" }> = {
    kind: "verify",
    label,
    after: context.after,
    view,
  };
  if (context.mode !== "external-premises") {
    const judged = findSubmission(records, {
      label,
      after: context.after,
      turn: verdictTurn(task, view),
    });
    if (judged === undefined) return { pending: phase };
    return {
      record: {
        note: context.note,
        mode: context.mode,
        settled: judged.settled,
        verdict: judged.value.verdict,
        report: judged.value.report,
      },
    };
  }

  // For a note-level source check the request's candidate field carries the
  // note's current version seq as deterministic provenance.
  const outcome = resolvePremiseCascade(records, task, {
    subject: "note",
    text: context.text,
    premises: context.premises,
    label,
    after: context.after,
    provenance: context.version,
  });
  if ("pending" in outcome) {
    if (outcome.pending === "offline") return { pending: phase };
    return {
      pending: {
        kind: "note-source-check",
        label,
        after: outcome.after,
        note: context.note,
        request: outcome.request,
      },
    };
  }
  return {
    record: {
      note: context.note,
      mode: context.mode,
      settled: outcome.settled,
      verdict: outcome.verdict,
      report: outcome.report,
    },
  };
}

// The external-premises cascade shared by note verification and the boundary
// battery: the audited offline premise inventory, then isolated source
// verification for unresolved premises, folded into one verdict over the
// subject text.
function resolvePremiseCascade(
  records: readonly Entry[],
  task: Task,
  options: {
    readonly subject: "note" | "candidate";
    readonly text: string;
    readonly premises: readonly PremiseStatement[];
    readonly label: string;
    readonly after: EntryId;
    readonly candidate?: EntryId;
    readonly provenance: EntryId;
  },
):
  | { readonly pending: "offline" }
  | {
      readonly pending: "source";
      readonly after: EntryId;
      readonly request: SourceCheckRequest;
    }
  | {
      readonly call: EntryId;
      readonly settled: EntryId;
      readonly verdict: Assessment["verdict"];
      readonly report: string;
      readonly offline: PremiseSubmission;
      readonly source?: {
        readonly report: string;
        readonly resolutions: readonly SourceResolution[];
      };
    } {
  const offline = findSubmission(records, {
    label: options.label,
    after: options.after,
    candidate: options.candidate,
    turn: premiseTurn(task, options.text, options.premises),
  });
  if (offline === undefined) return { pending: "offline" };
  const initial = premiseVerdict(offline.value.premises);
  if (initial !== "INCONCLUSIVE") {
    return {
      call: offline.call,
      settled: offline.settled,
      verdict: initial,
      report:
        initial === "FAIL"
          ? defectReport(
              `Offline premise verification rejected the ${options.subject}.`,
              premiseRepairFindings(offline.value.premises),
            )
          : offline.value.report,
      offline: offline.value,
    };
  }
  const unresolved = offline.value.premises.filter(
    (item): item is UnresolvedPremise => item.standing === "UNRESOLVED",
  );
  const request = sourceCheckRequestFor(
    options.provenance,
    offline.call,
    unresolved,
    task.sourceChecker,
  );
  const source = findSourceCheck(records, {
    label: options.label,
    after: offline.settled,
    candidate: options.candidate,
    request,
  });
  if (source === undefined) {
    return { pending: "source", after: offline.settled, request };
  }
  const verdict = sourceCheckVerdict(
    request.premises,
    source.result.resolutions,
  );
  return {
    call: source.call,
    settled: source.settled,
    verdict,
    report:
      verdict === "FAIL"
        ? defectReport(
            `Source verification rejected the ${options.subject}.`,
            sourceRepairFindings(source.result.resolutions),
          )
        : source.result.report,
    offline: offline.value,
    source: source.result,
  };
}

interface BoundaryContext {
  readonly statement: string;
  readonly premises: readonly PremiseStatement[];
}

function resolveBoundary(
  records: readonly Entry[],
  task: Task,
  candidate: CandidateRecord,
  context: BoundaryContext,
):
  | { readonly pending: Phase }
  | { readonly candidate: CandidateRecord; readonly solved: boolean } {
  const verdicts: VerdictRecord[] = [];
  let after: EntryId = candidate.id;
  for (const mode of boundaryModes) {
    const label = boundaryLabel(mode);
    const view: VerifyView = {
      note: candidate.goalNote,
      statement: context.statement,
      text: candidate.answer,
      premises: context.premises,
      mode,
    };
    const pendingVerify: Extract<ModelPhase, { kind: "verify" }> = {
      kind: "verify",
      label,
      after,
      view,
      candidate: candidate.id,
    };
    let assessed: Assessment;
    let call: EntryId;
    let evidence: Json;
    if (mode === "external-premises") {
      const outcome = resolvePremiseCascade(records, task, {
        subject: "candidate",
        text: candidate.answer,
        premises: context.premises,
        label,
        after,
        candidate: candidate.id,
        provenance: candidate.id,
      });
      if ("pending" in outcome) {
        if (outcome.pending === "offline") return { pending: pendingVerify };
        return {
          pending: {
            kind: "note-source-check",
            label,
            after: outcome.after,
            note: candidate.goalNote,
            request: outcome.request,
            candidate: candidate.id,
          },
        };
      }
      call = outcome.call;
      // Both evidence shapes are journal-frozen; replay must reproduce the
      // recorded bytes exactly, so do not unify them.
      evidence = jsonSnapshot(
        outcome.source === undefined
          ? {
              report: outcome.offline.report,
              premises: outcome.offline.premises,
              resolutions: [],
            }
          : {
              report: outcome.source.report,
              offline: outcome.offline,
              resolutions: outcome.source.resolutions,
            },
      );
      assessed = { verdict: outcome.verdict, report: outcome.report };
    } else {
      const judged = findSubmission(records, {
        label,
        after,
        candidate: candidate.id,
        turn: verdictTurn(task, view),
      });
      if (judged === undefined) return { pending: pendingVerify };
      call = judged.call;
      assessed = judged.value;
      evidence = judged.value.report;
    }
    const recorded = recordedVerdict(
      records,
      candidate.id,
      label,
      mode,
      after,
      call,
      assessed,
      evidence,
    );
    if (recorded === undefined) {
      return {
        pending: {
          kind: "record-verdict",
          candidate: candidate.id,
          call,
          verdict: assessed.verdict,
          evidence,
        },
      };
    }
    verdicts.push(recorded);
    after = recorded.record;
    if (recorded.verdict !== "PASS") {
      return { candidate: { ...candidate, verdicts }, solved: false };
    }
  }
  const result = { ...candidate, verdicts };
  const solved = deriveCandidateStatus(records, candidate.id).verified;
  return { candidate: result, solved };
}

function findCandidate(
  reader: Reader,
  answer: string,
  after: EntryId,
  originCall: EntryId,
  goalNote: string,
): CandidateRecord | undefined {
  const bytes = new TextEncoder().encode(answer);
  const matches = reader.records().flatMap((entry) => {
    if (
      entry.kind !== "candidate" ||
      entry.seq <= after ||
      !isDeepStrictEqual(reader.material(entry.seq), bytes)
    ) {
      return [];
    }
    if (
      !isDeepStrictEqual(entry.requiredVerifiers, candidateVerifierLabels())
    ) {
      throw new Error("candidate verifier contract changed");
    }
    return [{ id: entry.seq, originCall, answer, goalNote, verdicts: [] }];
  });
  // Identical bytes may recur when a later declaration renames the same goal
  // text. Journal order is deterministic, so each declaration owns the
  // earliest candidate entry after its own settled serve call.
  return matches[0];
}

function findSourceCheck(
  records: readonly Entry[],
  options: {
    readonly label: string;
    readonly after: EntryId;
    readonly candidate?: EntryId | undefined;
    readonly request: SourceCheckRequest;
  },
):
  | {
      readonly call: EntryId;
      readonly settled: EntryId;
      readonly result: {
        readonly report: string;
        readonly resolutions: readonly SourceResolution[];
      };
    }
  | undefined {
  const results = new Map(
    records
      .filter((entry) => entry.kind === "call-result")
      .map((entry) => [entry.parent, entry]),
  );
  const matches = records.flatMap((entry) => {
    if (
      entry.kind !== "call" ||
      entry.seq <= options.after ||
      entry.label !== options.label ||
      entry.candidate !== options.candidate ||
      entry.tools.length !== 0 ||
      !isDeepStrictEqual(entry.request, options.request)
    ) {
      return [];
    }
    const result = results.get(entry.seq);
    if (result?.kind !== "call-result" || result.state !== "returned")
      return [];
    const parsed = sourceCheckResultFor(options.request).safeParse(
      result.output,
    );
    return parsed.success && parsed.data.state === "succeeded"
      ? [
          {
            call: entry.seq,
            settled: result.seq,
            result: parsed.data.parsed.result,
          },
        ]
      : [];
  });
  if (matches.length > 1) throw new Error("duplicate source audit results");
  return matches[0];
}

function recordedVerdict(
  records: readonly Entry[],
  candidate: EntryId,
  label: string,
  mode: string,
  after: EntryId,
  call: EntryId,
  assessmentValue: Assessment,
  evidence: Json,
): VerdictRecord | undefined {
  const calls = new Map(
    records
      .filter((entry) => entry.kind === "call")
      .map((entry) => [entry.seq, entry]),
  );
  const matches = records.filter((entry) => {
    if (entry.kind !== "verdict") return false;
    const owner = calls.get(entry.call);
    return (
      owner?.kind === "call" &&
      owner.seq > after &&
      owner.candidate === candidate &&
      owner.label === label
    );
  });
  if (matches.length > 1) throw new Error("duplicate candidate verdict");
  const match = matches[0];
  if (match?.kind !== "verdict") return undefined;
  if (
    match.call !== call ||
    match.verdict !== assessmentValue.verdict ||
    !isDeepStrictEqual(match.evidence, evidence)
  ) {
    throw new Error("recorded verdict differs from its exact verifier result");
  }
  return {
    mode,
    record: match.seq,
    verdict: match.verdict,
    report: assessmentValue.report,
  };
}

function matchesStructuredCall(
  entry: Extract<Entry, { kind: "call" }>,
  turn: StructuredCall,
): boolean {
  const parsed = piRequest.safeParse(entry.request);
  if (!parsed.success || parsed.data.modelProfile === undefined) return false;
  const { modelProfile: _profile, ...request } = parsed.data;
  void _profile;
  return (
    isDeepStrictEqual(request, {
      protocol: "elenx/pi-run/v1",
      model: {
        provider: turn.profile.provider,
        id: turn.profile.model,
        api: turn.profile.api,
        baseUrl: turn.profile.baseUrl,
      },
      system: turn.system,
      prompt: turn.prompt,
      reasoning: turn.profile.reasoning,
      ...callParameters,
      cacheKey: turn.cacheKey,
    }) &&
    isDeepStrictEqual(entry.tools, [
      {
        name: turn.tool,
        description: turn.description,
        inputSchema: z.toJSONSchema(turn.schema),
      },
    ])
  );
}

function findSubmission<S extends z.ZodType>(
  records: readonly Entry[],
  options: {
    readonly label: string;
    readonly after: EntryId;
    readonly candidate?: EntryId | undefined;
    readonly turn: StructuredCall<S>;
  },
):
  | {
      readonly call: EntryId;
      readonly settled: EntryId;
      readonly value: z.output<S>;
    }
  | undefined {
  const matches = records.flatMap((entry) => {
    if (
      entry.kind !== "call" ||
      entry.seq <= options.after ||
      entry.label !== options.label ||
      entry.candidate !== options.candidate ||
      !matchesStructuredCall(entry, options.turn)
    ) {
      return [];
    }
    const result = records.find(
      (candidate) =>
        candidate.kind === "call-result" && candidate.parent === entry.seq,
    );
    if (result?.kind !== "call-result" || result.state !== "returned")
      return [];
    const outcome = piStoredResult.safeParse(result.output);
    if (!outcome.success || outcome.data.state !== "succeeded") return [];
    try {
      const parsed = options.turn.schema.safeParse(
        returnedToolSubmission(records, entry.seq, options.turn.tool).input,
      );
      return parsed.success
        ? [{ call: entry.seq, settled: result.seq, value: parsed.data }]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length > 1) {
    throw new Error(`duplicate submissions for ${options.label}`);
  }
  return matches[0];
}

export function jsonSnapshot(value: unknown): Json {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("value is not JSON");
  return JSON.parse(encoded) as Json;
}

// Standing is derived, never stored: a triage plan and its mode verdicts
// apply to the note version they were issued against, so a revision stales
// them and the note returns to conjecture until re-triaged. Any valid FAIL
// refutes; an empty valid plan marks a process report; a valid plan whose
// every mode holds a valid PASS verifies — conditionally on the note's
// basedOn statements, which the boundary's mechanical gates re-check.
function deriveStanding(
  versionAt: EntryId,
  plan: { readonly modes: readonly string[]; readonly at: EntryId } | undefined,
  verdicts: readonly {
    mode: string;
    verdict: Assessment["verdict"];
    at: EntryId;
  }[],
): Standing {
  const valid = verdicts.filter((entry) => entry.at > versionAt);
  if (valid.some((entry) => entry.verdict === "FAIL")) return "refuted";
  if (plan === undefined || plan.at <= versionAt) return "conjecture";
  if (plan.modes.length === 0) return "report";
  const passed = new Set(
    valid
      .filter((entry) => entry.verdict === "PASS")
      .map((entry) => entry.mode),
  );
  return plan.modes.every((mode) => passed.has(mode))
    ? "verified"
    : "conjecture";
}

export interface NoteSnapshot {
  readonly id: string;
  readonly summary: string;
  readonly standing: Standing;
  readonly versions: number;
  readonly at: EntryId;
  readonly text: string;
  readonly parents: readonly string[];
}

export interface MechanicalGap {
  readonly serve: EntryId;
  readonly goalNote: string;
  readonly report: boolean;
  readonly unverified: readonly string[];
  readonly cyclic: boolean;
}

export interface CampaignSnapshot {
  readonly phase: Phase["kind"];
  readonly indexTokens: number;
  readonly turns: readonly TurnRecord[];
  readonly curations: readonly CurationRecord[];
  readonly triages: readonly TriageRecord[];
  readonly noteVerdicts: readonly NoteVerdictRecord[];
  readonly serves: readonly ServeRecord[];
  readonly candidates: readonly CandidateRecord[];
  readonly mechanicalGaps: readonly MechanicalGap[];
  readonly notes: readonly NoteSnapshot[];
  readonly solution?: EntryId;
}

interface FoldNote {
  summary: string;
  text: string;
  at: EntryId;
  versions: number;
}

interface State {
  readonly turns: TurnRecord[];
  readonly curations: CurationRecord[];
  readonly triages: TriageRecord[];
  readonly noteVerdicts: NoteVerdictRecord[];
  readonly serves: ServeRecord[];
  readonly candidates: CandidateRecord[];
}

function emptyState(): State {
  return {
    turns: [],
    curations: [],
    triages: [],
    noteVerdicts: [],
    serves: [],
    candidates: [],
  };
}

// The fold result: the first unresolved (or terminal) phase plus everything
// the inspection snapshot projects.
interface CampaignFold extends Omit<CampaignSnapshot, "phase" | "solution"> {
  readonly phase: Phase;
}

export function foldCampaign(reader: Reader, task: Task): CampaignFold {
  const records = reader.records();
  const state = emptyState();
  const mechanicalGaps: MechanicalGap[] = [];

  const notes = new Map<string, FoldNote>();
  const order: string[] = [];
  const parents = new Map<string, readonly string[]>();
  const plans = new Map<
    string,
    { readonly modes: readonly string[]; readonly at: EntryId }
  >();
  const verdictTable = new Map<
    string,
    Map<
      string,
      {
        readonly verdict: Assessment["verdict"];
        readonly at: EntryId;
      }
    >
  >();
  const refuted = new Set<string>();
  let cursor = records[0]?.seq ?? 0;
  let explorerCallLabel = explorerLabel();
  let objective: string | undefined;
  let expandIds: readonly string[] = [];
  let recentIds: readonly string[] = [];
  let failure: ExplorerView["failure"];
  let hints: ServeView["hints"] = { expand: [] };

  const noteOf = (id: string): FoldNote => {
    const note = notes.get(id);
    if (note === undefined) throw new Error(`fold lost note ${id}`);
    return note;
  };
  const standingOf = (id: string): Standing =>
    deriveStanding(
      noteOf(id).at,
      plans.get(id),
      [...(verdictTable.get(id)?.entries() ?? [])].map(([mode, entry]) => ({
        mode,
        verdict: entry.verdict,
        at: entry.at,
      })),
    );
  const liveIndex = (): StandingEntry[] =>
    order.flatMap((id) => {
      const standing = standingOf(id);
      if (standing === "refuted") return [];
      return [{ id, summary: noteOf(id).summary, standing }];
    });
  const summaryOf = (id: string): string => noteOf(id).summary;
  const textOf = (id: string): string => noteOf(id).text;
  const premisesOf = (ids: readonly string[]): PremiseStatement[] =>
    ids.map((id) => ({ id, statement: summaryOf(id) }));
  const ancestorsOf = (id: string): string[] => {
    const seen = new Set<string>();
    const stack = [...(parents.get(id) ?? [])];
    while (stack.length > 0) {
      const parent = stack.pop();
      if (parent === undefined || seen.has(parent)) continue;
      seen.add(parent);
      stack.push(...(parents.get(parent) ?? []));
    }
    return [...seen].sort();
  };
  const expandedNotes = () => {
    const requested = [...recentIds, ...expandIds];
    const selected: { id: string; text: string }[] = [];
    for (const id of requested) {
      if (refuted.has(id) || selected.some((note) => note.id === id)) continue;
      selected.push({ id, text: noteOf(id).text });
    }
    return selected;
  };
  const applyVerdict = (
    id: string,
    mode: string,
    verdict: Assessment["verdict"],
    at: EntryId,
  ) => {
    const modes = verdictTable.get(id) ?? new Map();
    modes.set(mode, { verdict, at });
    verdictTable.set(id, modes);
  };
  const foldCuration = (
    findings: readonly Finding[],
    curated: {
      readonly call: EntryId;
      readonly settled: EntryId;
      readonly value: CurationSubmission;
    },
  ): string[] => {
    const knownBefore = new Set(order);
    const minted: string[] = [];
    const refined: string[] = [];
    for (const filing of curated.value.filings) {
      const finding = findings[filing.finding - 1];
      if (finding === undefined) {
        throw new Error("curation filing references an absent finding");
      }
      if (filing.duplicateOf !== undefined) continue;
      if (filing.summary === undefined) {
        throw new Error("curation filing is missing its summary");
      }
      if (filing.refines !== undefined) {
        const existing = noteOf(filing.refines);
        existing.summary = filing.summary;
        existing.text = finding.text;
        existing.at = curated.settled;
        existing.versions += 1;
        refined.push(filing.refines);
        continue;
      }
      // order is push-only and dependsOn edges point at earlier notes only,
      // so ids stay dense ordinals and mint order stays topological — id
      // minting here and export ordering (inspect.ts) both rest on this.
      const id = `n${order.length + 1}`;
      order.push(id);
      const dependsOn = finding.basedOn.filter(
        (parent) => knownBefore.has(parent) && !refuted.has(parent),
      );
      notes.set(id, {
        summary: filing.summary,
        text: finding.text,
        at: curated.settled,
        versions: 1,
      });
      parents.set(id, dependsOn);
      minted.push(id);
    }
    state.curations.push({
      call: curated.call,
      settled: curated.settled,
      submission: curated.value,
      minted,
      refined,
    });
    recentIds = [...minted, ...refined];
    return [...minted, ...refined];
  };
  const finish = (phase: Phase): CampaignFold => ({
    phase,
    indexTokens: estimatedTextTokens(renderIndexBlock(liveIndex())),
    turns: state.turns,
    curations: state.curations,
    triages: state.triages,
    noteVerdicts: state.noteVerdicts,
    serves: state.serves,
    candidates: state.candidates,
    mechanicalGaps,
    notes: order.map((id) => {
      const note = noteOf(id);
      return {
        id,
        summary: note.summary,
        standing: standingOf(id),
        versions: note.versions,
        at: note.at,
        text: note.text,
        parents: parents.get(id) ?? [],
      };
    }),
  });

  // One explorer or curation submission is consumed per iteration, so the
  // record count bounds the walk.
  let steps = 0;
  const guard = () => {
    steps += 1;
    if (steps > records.length + 2) {
      throw new Error("exploration-v17 replay exceeded its transition bound");
    }
  };

  outer: for (;;) {
    guard();
    const index = liveIndex();
    const indexTokens = estimatedTextTokens(renderIndexBlock(index));
    if (indexTokens > task.maxIndexTokens) {
      return finish({ kind: "index-limit", tokens: indexTokens });
    }
    const view: ExplorerView = {
      first: state.turns.length === 0,
      index,
      expanded: expandedNotes(),
      ...(objective === undefined ? {} : { objective }),
      ...(failure === undefined ? {} : { failure }),
    };
    const explorerPhase: Extract<ModelPhase, { kind: "explorer" }> = {
      kind: "explorer",
      label: explorerCallLabel,
      after: cursor,
      view,
      indexTokens,
    };
    const explored = findSubmission(records, {
      label: explorerCallLabel,
      after: cursor,
      turn: explorerTurn(task, view),
    });
    if (explored === undefined) return finish(explorerPhase);
    state.turns.push({
      call: explored.call,
      settled: explored.settled,
      submission: explored.value,
    });
    failure = undefined;
    hints = {
      expand: explored.value.expand,
      ...(explored.value.nextObjective === undefined
        ? {}
        : { objective: explored.value.nextObjective }),
    };

    let findings: readonly Finding[] = explored.value.findings;
    let curationTrigger = explored.call;
    let curationAfter = explored.settled;
    let defectSegment = false;

    for (;;) {
      guard();
      // The tripwire re-fires at every curation entry: defect segments grow
      // the index without passing the outer explorer check.
      const curationIndex = liveIndex();
      const curationTokens = estimatedTextTokens(
        renderIndexBlock(curationIndex),
      );
      if (curationTokens > task.maxIndexTokens) {
        return finish({ kind: "index-limit", tokens: curationTokens });
      }
      const curatorView: CuratorView = {
        index: curationIndex,
        findings,
      };
      const curationPhase: Extract<ModelPhase, { kind: "curation" }> = {
        kind: "curation",
        label: curationLabel(curationTrigger),
        after: curationAfter,
        view: curatorView,
      };
      const curated = findSubmission(records, {
        label: curationPhase.label,
        after: curationPhase.after,
        turn: curationTurn(task, curatorView),
      });
      if (curated === undefined) return finish(curationPhase);
      const batch = foldCuration(findings, curated);
      let pipelineCursor = curated.settled;
      let serveTrigger = curated.call;

      if (batch.length > 0) {
        const batchViews: TriageView["batch"][number][] = batch.map((id) => ({
          id,
          text: textOf(id),
          basedOn: premisesOf(parents.get(id) ?? []),
        }));
        const triageView: TriageView = { batch: batchViews };
        const triagePhase: Extract<ModelPhase, { kind: "triage" }> = {
          kind: "triage",
          label: triageLabel(curated.call),
          after: curated.settled,
          view: triageView,
        };
        const triaged = findSubmission(records, {
          label: triagePhase.label,
          after: triagePhase.after,
          turn: triageTurn(task, triageView),
        });
        if (triaged === undefined) return finish(triagePhase);
        state.triages.push({
          call: triaged.call,
          settled: triaged.settled,
          submission: triaged.value,
        });
        for (const plan of triaged.value.plans) {
          plans.set(plan.note, { modes: plan.modes, at: triaged.settled });
        }
        pipelineCursor = triaged.settled;
        serveTrigger = triaged.call;

        const planOf = new Map(
          triaged.value.plans.map((plan) => [plan.note, plan.modes]),
        );
        for (const id of batch) {
          const modes = planOf.get(id);
          if (modes === undefined) {
            throw new Error(`triage left note ${id} unplanned`);
          }
          const statement = summaryOf(id);
          const text = textOf(id);
          const premises = premisesOf(parents.get(id) ?? []);
          for (const mode of modes) {
            const outcome = resolveNoteMode(records, task, {
              note: id,
              statement,
              text,
              premises,
              mode,
              version: noteOf(id).at,
              trigger: triaged.call,
              after: pipelineCursor,
            });
            if ("pending" in outcome) return finish(outcome.pending);
            state.noteVerdicts.push(outcome.record);
            applyVerdict(
              id,
              mode,
              outcome.record.verdict,
              outcome.record.settled,
            );
            pipelineCursor = outcome.record.settled;
            if (outcome.record.verdict === "FAIL") {
              refuted.add(id);
              break;
            }
          }
        }
      }

      if (defectSegment) {
        // A defect or mechanical-gap curation hands its failure straight to
        // a fresh explorer: a serve, and with it any goal declaration, can
        // only follow new exploration.
        cursor = pipelineCursor;
        explorerCallLabel = explorerLabel(curated.call);
        continue outer;
      }

      const serveView: ServeView = {
        index: liveIndex(),
        turns: state.turns.length,
        hints,
      };
      const servePhase: Extract<ModelPhase, { kind: "serve" }> = {
        kind: "serve",
        label: serveLabel(serveTrigger),
        after: pipelineCursor,
        view: serveView,
      };
      const served = findSubmission(records, {
        label: servePhase.label,
        after: servePhase.after,
        turn: serveTurn(task, serveView),
      });
      if (served === undefined) return finish(servePhase);
      state.serves.push({
        call: served.call,
        settled: served.settled,
        submission: served.value,
      });

      if (served.value.goalNote === undefined) {
        objective = served.value.objective;
        expandIds = served.value.expand;
        cursor = served.settled;
        explorerCallLabel = explorerLabel(served.call);
        continue outer;
      }

      const goal = served.value.goalNote;
      const goalStanding = standingOf(goal);
      const ancestors = ancestorsOf(goal);
      const unverified = ancestors.filter(
        (ancestor) => standingOf(ancestor) !== "verified",
      );
      const cyclic = ancestors.includes(goal);
      if (goalStanding === "report" || unverified.length > 0 || cyclic) {
        mechanicalGaps.push({
          serve: served.call,
          goalNote: goal,
          report: goalStanding === "report",
          unverified,
          cyclic,
        });
        findings = [
          mechanicalFinding(goal, {
            ...(goalStanding === "report" ? { report: true } : {}),
            unverified: unverified.map((ancestor) => ({
              id: ancestor,
              standing: standingOf(ancestor),
            })),
            cyclic,
          }),
        ];
        objective = undefined;
        expandIds = [];
        curationTrigger = served.call;
        curationAfter = served.settled;
        defectSegment = true;
        continue;
      }

      const goalText = textOf(goal);
      const found = findCandidate(
        reader,
        goalText,
        served.settled,
        served.call,
        goal,
      );
      if (found === undefined) {
        return finish({ kind: "create-candidate", answer: goalText });
      }
      const outcome = resolveBoundary(records, task, found, {
        statement: summaryOf(goal),
        premises: premisesOf(parents.get(goal) ?? []),
      });
      if ("pending" in outcome) return finish(outcome.pending);
      state.candidates.push(outcome.candidate);
      for (const verdict of outcome.candidate.verdicts) {
        applyVerdict(goal, verdict.mode, verdict.verdict, verdict.record);
        if (verdict.verdict === "FAIL") refuted.add(goal);
      }
      if (outcome.solved) {
        return finish({ kind: "solved", candidate: found.id });
      }
      const failing = outcome.candidate.verdicts.filter(
        (verdict) => verdict.verdict !== "PASS",
      );
      const last = outcome.candidate.verdicts.at(-1);
      if (last === undefined) {
        throw new Error("failed boundary battery has no verdicts");
      }
      findings = [batteryFinding(found.id, goal, failing)];
      failure = {
        goalNote: goal,
        text: goalText,
        verdicts: failing.map(({ mode, verdict, report }) => ({
          mode,
          verdict,
          report,
        })),
      };
      objective = undefined;
      expandIds = [];
      curationTrigger = last.record;
      curationAfter = last.record;
      defectSegment = true;
    }
  }
}

export function snapshot(reader: Reader, task: Task): CampaignSnapshot {
  const { phase, ...projection } = foldCampaign(reader, task);
  return {
    ...projection,
    phase: phase.kind,
    ...(phase.kind === "solved" ? { solution: phase.candidate } : {}),
  };
}
