import {
  deriveCandidateStatus,
  type Campaign,
  type Entry,
  type EntryId,
  type Reader,
} from "elenx";
import { piRequest } from "elenx/pi";
import { z } from "zod";

import {
  coordinatorTurn,
  explorerTurn,
  solveSettings,
  verifierTurn,
  type Turn,
} from "./pi-roles";
import {
  applicationId,
  coordinatorInput,
  explorerInput,
  journalVerdicts,
  succeededSubmission,
  task,
  verifierInput,
  verifierNames,
  type CoordinatorInput,
  type ExplorerInput,
  type Note,
  type Roles,
  type Task,
  type VerifierInput,
} from "./roles";

export const workflowSchemaVersion = 4;
export const workflowConfig = z.strictObject({
  kind: z.literal("workflow"),
  schemaVersion: z.literal(workflowSchemaVersion),
  task,
  settings: solveSettings,
});
export type WorkflowConfig = z.output<typeof workflowConfig>;

type AcceptedPhase = {
  readonly kind: "accepted";
  readonly turns: number;
  readonly note: Note;
  readonly notes: readonly Note[];
  readonly candidate: EntryId;
};
type TurnLimitPhase = {
  readonly kind: "turn-limit";
  readonly turns: number;
  readonly notes: readonly Note[];
};

export type WorkflowTerminal = AcceptedPhase | TurnLimitPhase;
export type WorkflowPhase =
  | { readonly kind: "explorer"; readonly input: ExplorerInput }
  | { readonly kind: "coordinator"; readonly input: CoordinatorInput }
  | {
      readonly kind: "verifier";
      readonly input: VerifierInput;
      readonly candidate?: EntryId;
    }
  | WorkflowTerminal;

export type WorkflowResult =
  | (Omit<AcceptedPhase, "kind"> & { readonly outcome: "accepted" })
  | (Omit<TurnLimitPhase, "kind"> & { readonly outcome: "turn-limit" });

export interface WorkflowSnapshot {
  readonly config: WorkflowConfig;
  readonly notes: readonly Note[];
  readonly phase: WorkflowPhase;
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

type CallEntry = Extract<Entry, { readonly kind: "call" }>;

function firstCall(
  records: readonly Entry[],
  after: EntryId,
  turn: Turn<z.ZodType>,
): CallEntry | undefined {
  const call = records.find(
    (entry): entry is CallEntry =>
      entry.kind === "call" &&
      entry.seq > after &&
      entry.label === turn.label &&
      entry.role === turn.role,
  );
  if (call === undefined) return undefined;
  const request = piRequest.safeParse(call.request);
  if (
    !request.success ||
    request.data.system !== turn.system ||
    request.data.prompt !== turn.prompt
  ) {
    throw new Error(
      `call ${call.seq} does not match the derived ${turn.role} request`,
    );
  }
  return call;
}

function settledCall<S extends z.ZodType>(
  records: readonly Entry[],
  after: EntryId,
  turn: Turn<S>,
): { readonly settled: EntryId; readonly value: z.output<S> } | undefined {
  for (
    let call = firstCall(records, after, turn);
    call !== undefined;
    call = firstCall(records, call.seq, turn)
  ) {
    const submission = succeededSubmission(records, call.seq, turn.tool);
    if (submission === undefined) continue;
    const parsed = turn.schema.safeParse(submission.input);
    if (!parsed.success) {
      throw new Error(`malformed ${turn.role} submission in call ${call.seq}`);
    }
    return { settled: submission.settled, value: parsed.data };
  }
  return undefined;
}

export function deriveWorkflow(reader: Reader): WorkflowSnapshot {
  const records = reader.records();
  const config = parseConfig(records[0]);
  const verdicts = journalVerdicts(records);
  const minted: { id: string; summary?: string; text: string }[] = [];
  let cursor = records[0]!.seq;
  let objective = config.task.problem;
  let support: string[] = [];
  const notesAt = (seq: EntryId): Note[] =>
    minted.map((entry) => ({
      ...entry,
      verdicts: verdicts
        .filter(
          ({ seq: at, verdict }) => at <= seq && verdict.note === entry.id,
        )
        .map(({ verdict }) => verdict),
    }));
  const noteAt = (id: string, seq: EntryId): Note => {
    const found = notesAt(seq).find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`unresolved note ${id}`);
    return found;
  };

  for (let turn = 1; turn <= config.settings.maxExplorerTurns; turn += 1) {
    const explorerRequest = explorerInput.parse({
      task: config.task,
      objective,
      notes: notesAt(cursor).map(({ text, ...rest }) => rest),
      support: support.map((id) => noteAt(id, cursor)),
    });
    const explored = settledCall(
      records,
      cursor,
      explorerTurn(explorerRequest),
    );
    if (explored === undefined) {
      return {
        config,
        notes: notesAt(cursor),
        phase: { kind: "explorer", input: explorerRequest },
      };
    }
    cursor = explored.settled;
    for (const { text } of explored.value.notes) {
      minted.push({ id: `n${minted.length + 1}`, text });
    }
    const coordinatorRequest = coordinatorInput.parse({
      task: config.task,
      notes: notesAt(cursor),
    });
    const coordinated = settledCall(
      records,
      cursor,
      coordinatorTurn(coordinatorRequest),
    );
    if (coordinated === undefined) {
      return {
        config,
        notes: notesAt(cursor),
        phase: { kind: "coordinator", input: coordinatorRequest },
      };
    }
    cursor = coordinated.settled;
    for (const filing of coordinated.value.filings) {
      minted.find(({ id }) => id === filing.note)!.summary = filing.summary;
    }
    objective = coordinated.value.objective;
    support = coordinated.value.support;
    if (coordinated.value.verify === undefined) continue;

    const verifierRequest = verifierInput.parse({
      task: config.task,
      note: noteAt(coordinated.value.verify.note, cursor),
      support: coordinated.value.verify.support.map((id) => noteAt(id, cursor)),
    });
    const first = firstCall(
      records,
      cursor,
      verifierTurn(verifierNames[0], verifierRequest),
    );
    if (first === undefined) {
      return {
        config,
        notes: notesAt(cursor),
        phase: { kind: "verifier", input: verifierRequest },
      };
    }
    const candidate = first.candidate;
    if (candidate === undefined) {
      throw new Error(`verifier call ${first.seq} is not bound to a candidate`);
    }
    for (const name of verifierNames) {
      const recorded = verdicts.find(
        (entry) =>
          entry.seq > cursor &&
          entry.candidate === candidate &&
          entry.verdict.verifier === name,
      );
      if (recorded === undefined) {
        return {
          config,
          notes: notesAt(cursor),
          phase: { kind: "verifier", input: verifierRequest, candidate },
        };
      }
      cursor = recorded.seq;
      if (recorded.verdict.verdict === "FAIL") break;
    }
    if (deriveCandidateStatus(records, candidate).verified) {
      const notes = notesAt(cursor);
      return {
        config,
        notes,
        phase: {
          kind: "accepted",
          turns: turn,
          note: notes.find(({ id }) => id === verifierRequest.note.id)!,
          notes,
          candidate,
        },
      };
    }
  }

  return {
    config,
    notes: notesAt(cursor),
    phase: {
      kind: "turn-limit",
      turns: config.settings.maxExplorerTurns,
      notes: notesAt(cursor),
    },
  };
}

export function workflowResult(phase: WorkflowTerminal): WorkflowResult {
  if (phase.kind === "accepted") {
    const { kind, ...result } = phase;
    return { ...result, outcome: kind };
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
    if (phase.kind === "accepted" || phase.kind === "turn-limit") {
      return phase;
    }
    if (dependencies.pauseRequested?.()) return phase;
    dependencies.status?.(phase.kind);
    if (phase.kind === "explorer") {
      await roles.explorer(phase.input);
    } else if (phase.kind === "coordinator") {
      await roles.coordinator(phase.input);
    } else {
      await roles.verifier(phase.input, phase.candidate);
    }
  }
}

export function workflowConfiguration(options: {
  readonly task: Task;
  readonly settings: z.output<typeof solveSettings>;
}): WorkflowConfig {
  return workflowConfig.parse({
    kind: "workflow",
    schemaVersion: workflowSchemaVersion,
    ...options,
  });
}
