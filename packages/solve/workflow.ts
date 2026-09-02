import { isDeepStrictEqual } from "node:util";

import {
  deriveCandidateStatus,
  type Campaign,
  type Entry,
  type EntryId,
  type Json,
  type Reader,
} from "elenx";
import { z } from "zod";

import { solveSettings } from "./pi-roles";
import {
  applicationId,
  coordinatorInput,
  coordinatorResultFor,
  explorerInput,
  explorerResult,
  roleCallOutput,
  roleLabels,
  task,
  verifierCallOutput,
  verifierInput,
  verifierInputHash,
  verifierRecord,
  type CoordinatorInput,
  type ExplorerInput,
  type Note,
  type NoteRef,
  type RoleName,
  type Roles,
  type Task,
  type VerifierInput,
  type VerifierResult,
} from "./roles";

const initialObjective =
  "Produce a complete solution or a decisive refutation.";

export const workflowConfig = z.strictObject({
  kind: z.literal("workflow"),
  task,
  settings: solveSettings,
});
export type WorkflowConfig = z.output<typeof workflowConfig>;

type AcceptedPhase = {
  readonly kind: "accepted";
  readonly turns: number;
  readonly answer: Note;
  readonly verifier: VerifierResult;
  readonly notes: readonly Note[];
  readonly candidate: EntryId;
};
type RefutedPhase = {
  readonly kind: "refuted";
  readonly turns: number;
  readonly refutation: Note;
  readonly verifier: VerifierResult;
  readonly notes: readonly Note[];
  readonly candidate: EntryId;
};
type TurnLimitPhase = {
  readonly kind: "turn-limit";
  readonly turns: number;
  readonly notes: readonly Note[];
  readonly lastVerifierResult?: VerifierResult;
};

export type WorkflowTerminal = AcceptedPhase | RefutedPhase | TurnLimitPhase;
export type WorkflowPhase =
  | { readonly kind: "explorer"; readonly input: ExplorerInput }
  | { readonly kind: "coordinator"; readonly input: CoordinatorInput }
  | { readonly kind: "verifier"; readonly input: VerifierInput }
  | {
      readonly kind: "record-verdict";
      readonly call: EntryId;
      readonly verdict: "PASS" | "FAIL";
      readonly evidence: Json;
    }
  | WorkflowTerminal;

export type WorkflowResult =
  | (Omit<AcceptedPhase, "kind"> & {
      readonly outcome: "accepted";
      readonly candidateKind: "solution";
    })
  | (Omit<RefutedPhase, "kind"> & {
      readonly outcome: "refuted";
      readonly candidateKind: "refutation";
    })
  | (Omit<TurnLimitPhase, "kind"> & { readonly outcome: "turn-limit" });

export interface WorkflowSnapshot {
  readonly config: WorkflowConfig;
  readonly notes: readonly Note[];
  readonly phase: WorkflowPhase;
}

interface SettledCall<T> {
  readonly call: Extract<Entry, { readonly kind: "call" }>;
  readonly settled: EntryId;
  readonly value: T;
}

function jsonSnapshot(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function parseConfig(declaration: Entry | undefined): WorkflowConfig {
  if (
    declaration?.kind !== "campaign" ||
    declaration.application !== applicationId
  ) {
    throw new Error("not an Elenx workflow campaign");
  }
  const parsed = workflowConfig.safeParse(declaration.config);
  if (!parsed.success) {
    throw new Error(`invalid workflow campaign: ${parsed.error.message}`);
  }
  return parsed.data;
}

function settledCall<S extends z.ZodType>(
  records: readonly Entry[],
  after: EntryId,
  role: RoleName,
  input: unknown,
  output: S,
): SettledCall<z.output<S>> | undefined {
  const results = new Map(
    records
      .filter((entry) => entry.kind === "call-result")
      .map((entry) => [entry.parent, entry]),
  );
  for (const call of records) {
    if (
      call.kind !== "call" ||
      call.seq <= after ||
      call.label !== roleLabels[role] ||
      call.role !== role ||
      !isDeepStrictEqual(call.request, jsonSnapshot(input))
    ) {
      continue;
    }
    const result = results.get(call.seq);
    if (result?.state !== "returned") continue;
    const parsed = output.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`malformed returned ${role} result`);
    }
    return { call, settled: result.seq, value: parsed.data };
  }
  return undefined;
}

function resolveRef(
  ref: NoteRef,
  notes: readonly Note[],
  fresh: ReadonlyMap<number, Note>,
): Note {
  const note =
    ref.kind === "note"
      ? notes.find(({ id }) => id === ref.id)
      : fresh.get(ref.finding);
  if (note === undefined) {
    throw new Error(
      ref.kind === "note"
        ? `unresolved note:${ref.id}`
        : `unresolved finding:${ref.finding}`,
    );
  }
  return note;
}

export function deriveWorkflow(reader: Reader): WorkflowSnapshot {
  const records = reader.records();
  const config = parseConfig(records[0]);
  const notes: Note[] = [];
  const attempted = new Set<string>();
  let cursor = records[0]!.seq;
  let objective = initialObjective;
  let context: Note[] = [];
  let previousVerifierResult: VerifierResult | undefined;

  for (let turn = 1; turn <= config.settings.maxExplorerTurns; turn += 1) {
    const explorerRequest = explorerInput.parse({
      task: config.task,
      index: notes.map(({ id, summary }) => ({ id, summary })),
      context,
      objective,
      ...(previousVerifierResult === undefined
        ? {}
        : { previousVerifierResult }),
    });
    const explored = settledCall(
      records,
      cursor,
      "explorer",
      explorerRequest,
      roleCallOutput(explorerResult),
    );
    if (explored === undefined) {
      return {
        config,
        notes,
        phase: { kind: "explorer", input: explorerRequest },
      };
    }
    cursor = explored.settled;
    const coordinatorRequest = coordinatorInput.parse({
      task: config.task,
      notes,
      findings: explored.value.value.findings,
      ...(previousVerifierResult === undefined
        ? {}
        : { previousVerifierResult }),
    });
    const coordinated = settledCall(
      records,
      cursor,
      "coordinator",
      coordinatorRequest,
      roleCallOutput(
        coordinatorResultFor(
          notes.map(({ id }) => id),
          coordinatorRequest.findings.length,
        ),
      ),
    );
    if (coordinated === undefined) {
      return {
        config,
        notes,
        phase: { kind: "coordinator", input: coordinatorRequest },
      };
    }
    cursor = coordinated.settled;
    const fresh = new Map<number, Note>();
    for (const filing of [...coordinated.value.value.filings].sort(
      (left, right) => left.finding - right.finding,
    )) {
      const finding = coordinatorRequest.findings[filing.finding - 1]!;
      const note = {
        id: `n${notes.length + 1}`,
        summary: filing.summary,
        text: finding.text,
      };
      notes.push(note);
      fresh.set(filing.finding, note);
    }
    const action = coordinated.value.value.action;
    if (action.kind === "explore") {
      objective = action.objective;
      context = action.context.map((ref) => resolveRef(ref, notes, fresh));
      continue;
    }

    const answer = resolveRef(action.answer, notes, fresh);
    const support = action.support.map((ref) => resolveRef(ref, notes, fresh));
    const proposal = verifierInput.parse({
      task: config.task,
      candidateKind: action.candidateKind,
      answer,
      support,
    });
    const hash = verifierInputHash(proposal);
    if (attempted.has(hash)) {
      previousVerifierResult = {
        verdict: "REJECT",
        report:
          "The coordinator renominated an unchanged rejected answer proposal. Change the answer or its support before verification.",
      };
      objective = `Repair the verifier rejection:\n${previousVerifierResult.report}`;
      context = [answer, ...support];
      continue;
    }
    const verified = settledCall(
      records,
      cursor,
      "verifier",
      proposal,
      verifierCallOutput,
    );
    if (verified === undefined) {
      return { config, notes, phase: { kind: "verifier", input: proposal } };
    }
    attempted.add(hash);
    cursor = verified.settled;
    const candidate = verified.call.candidate;
    if (candidate === undefined) {
      throw new Error("verifier result is not bound to a candidate");
    }
    const result = verified.value.value;
    const status = deriveCandidateStatus(records, candidate);
    const record = verifierRecord(result, proposal.candidateKind);
    if (
      (result.verdict === "ACCEPT" && !status.verified) ||
      (result.verdict === "REJECT" &&
        !status.failed.includes(roleLabels.verifier))
    ) {
      return {
        config,
        notes,
        phase: {
          kind: "record-verdict",
          call: verified.call.seq,
          verdict: record.verdict,
          evidence: record.evidence,
        },
      };
    }
    if (result.verdict === "ACCEPT") {
      return proposal.candidateKind === "solution"
        ? {
            config,
            notes,
            phase: {
              kind: "accepted",
              turns: turn,
              answer,
              verifier: result,
              notes,
              candidate,
            },
          }
        : {
            config,
            notes,
            phase: {
              kind: "refuted",
              turns: turn,
              refutation: answer,
              verifier: result,
              notes,
              candidate,
            },
          };
    }
    previousVerifierResult = result;
    objective = `Repair the verifier rejection:\n${result.report}`;
    context = [answer, ...support];
  }

  return {
    config,
    notes,
    phase: {
      kind: "turn-limit",
      turns: config.settings.maxExplorerTurns,
      notes,
      ...(previousVerifierResult === undefined
        ? {}
        : { lastVerifierResult: previousVerifierResult }),
    },
  };
}

export function workflowResult(phase: WorkflowTerminal): WorkflowResult {
  if (phase.kind === "accepted") {
    const { kind, ...result } = phase;
    return { ...result, outcome: kind, candidateKind: "solution" };
  }
  if (phase.kind === "refuted") {
    const { kind, ...result } = phase;
    return { ...result, outcome: kind, candidateKind: "refutation" };
  }
  const { kind, ...result } = phase;
  return { ...result, outcome: kind };
}

export interface WorkflowDependencies {
  readonly pauseRequested?: () => boolean;
  readonly status?: (message: string) => void;
}

export async function runWorkflow(
  campaign: Campaign,
  roles: Roles,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowPhase> {
  for (;;) {
    const phase = deriveWorkflow(campaign).phase;
    if (
      phase.kind === "accepted" ||
      phase.kind === "refuted" ||
      phase.kind === "turn-limit"
    ) {
      return phase;
    }
    if (dependencies.pauseRequested?.()) return phase;
    dependencies.status?.(phase.kind);
    if (phase.kind === "record-verdict") {
      campaign.recordVerdict(phase.call, phase.verdict, phase.evidence);
    } else if (phase.kind === "explorer") {
      await roles.explorer(phase.input);
    } else if (phase.kind === "coordinator") {
      await roles.coordinator(phase.input);
    } else {
      await roles.verifier(phase.input);
    }
  }
}

export function workflowConfiguration(options: {
  readonly task: Task;
  readonly settings: z.output<typeof solveSettings>;
}): WorkflowConfig {
  return workflowConfig.parse({ kind: "workflow", ...options });
}
