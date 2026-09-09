import type { Campaign, Entry, EntryId, Json } from "elenx";
import { z } from "zod";

import { Projection } from "./projection";
import { explorerGuidance, freezeExplorerGuidance } from "./guidance";
import { supportClosure } from "./support";
import {
  codexSource,
  coordinatorCall,
  explorerCall,
  sameRequest,
  solveSettings,
  sourceCall,
  verifierCall,
  type RoleCall,
} from "./pi-roles";
import {
  applicationId,
  coordinatorInput,
  explorerInput,
  journalVerdicts,
  jsonSnapshot,
  judgedBy,
  missingVerdicts,
  noteIdAfter,
  pick,
  succeededSubmission,
  task,
  verificationComplete,
  verifierInput,
  verifierLabels,
  verifierNames,
  type CoordinatorInput,
  type ExplorerInput,
  type Note,
  type RoleName,
  type Roles,
  type Task,
  type Verification,
  type VerifierInput,
} from "./roles";

export const workflowSchemaVersion = 24;
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
  /** The accepted note's transitive support, in id order. */
  readonly closure: readonly string[];
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
  | (Omit<AcceptedPhase, "kind" | "closure"> & { readonly outcome: "accepted" })
  | (Omit<TurnLimitPhase, "kind"> & { readonly outcome: "turn-limit" });

export interface WorkflowSnapshot {
  readonly config: WorkflowConfig;
  readonly notes: readonly Note[];
  readonly phase: WorkflowPhase;
  /** Journal boundary before the next explorer turn, used only by the driver. */
  readonly explorerAfter?: EntryId;
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
  role: RoleName,
  label: string,
  request: Json | RoleCall<z.ZodType>,
): CallEntry | undefined {
  const call = records.find(
    (entry): entry is CallEntry =>
      entry.kind === "call" &&
      entry.seq > after &&
      entry.label === label &&
      entry.role === role,
  );
  if (call === undefined) return undefined;
  if (!sameRequest(call.request, request)) {
    throw new Error(
      `call ${call.seq} does not match the derived ${role} request`,
    );
  }
  return call;
}

function settledCall<S extends z.ZodType>(
  records: readonly Entry[],
  after: EntryId,
  roleCall: RoleCall<S>,
): { readonly settled: EntryId; readonly value: z.output<S> } | undefined {
  for (
    let call = firstCall(
      records,
      after,
      roleCall.role,
      roleCall.label,
      roleCall,
    );
    call !== undefined;
    call = firstCall(records, call.seq, roleCall.role, roleCall.label, roleCall)
  ) {
    const submission = succeededSubmission(records, call.seq, roleCall.tool);
    if (submission === undefined) continue;
    const parsed = roleCall.schema.safeParse(submission.input);
    if (!parsed.success) {
      throw new Error(
        `malformed ${roleCall.role} submission in call ${call.seq}`,
      );
    }
    return { settled: submission.settled, value: parsed.data };
  }
  return undefined;
}

/**
 * The longest prefix of the coordinator's verify list whose note and support
 * texts fit the window, and always its first entry. Texts shared by several
 * notes are read once, so they count once.
 */
export async function verificationPrefix(
  verify: readonly Verification[],
  notes: readonly Note[],
  window: number,
): Promise<Verification[]> {
  const read = new Set<string>();
  let reading = 0;
  let taken = 0;
  for (const entry of verify) {
    const note = pick(notes, entry.note);
    const added = [note.id, ...(await supportClosure([note], notes))].filter(
      (id) => !read.has(id),
    );
    const cost = added.reduce(
      (sum, id) => sum + pick(notes, id).text.length,
      0,
    );
    if (taken > 0 && reading + cost > window) break;
    for (const id of added) read.add(id);
    reading += cost;
    taken += 1;
  }
  return verify.slice(0, taken);
}

export async function deriveWorkflow(
  records: readonly Entry[],
): Promise<WorkflowSnapshot> {
  const config = parseConfig(records[0]);
  const verdicts = journalVerdicts(records);
  const projection = await Projection.open(verdicts);
  try {
    let cursor = records[0]!.seq;
    let guidance = "";
    let support: readonly string[] = [];
    for (let turn = 1; turn <= config.settings.maxExplorerTurns; turn += 1) {
      const known = await projection.at(cursor);
      const explorerRequest = explorerInput.parse({
        task: config.task,
        explorerGuidance: explorerGuidance(records, cursor, guidance),
        notes: known.map(({ text, ...rest }) => rest),
        support: support.map((id) => pick(known, id)),
      });
      const explored = settledCall(
        records,
        cursor,
        explorerCall(explorerRequest),
      );
      if (explored === undefined) {
        return {
          config,
          notes: known,
          phase: { kind: "explorer", input: explorerRequest },
          explorerAfter: cursor,
        };
      }
      cursor = explored.settled;
      await projection.add(
        explored.value.notes.map((entry, position) => ({
          id: noteIdAfter(known.length, position),
          ...entry,
        })),
        cursor,
      );
      const coordinatorRequest = coordinatorInput.parse({
        task: config.task,
        notes: await projection.at(cursor),
      });
      const coordinated = settledCall(
        records,
        cursor,
        coordinatorCall(coordinatorRequest),
      );
      if (coordinated === undefined) {
        return {
          config,
          notes: coordinatorRequest.notes,
          phase: { kind: "coordinator", input: coordinatorRequest },
        };
      }
      cursor = coordinated.settled;
      await projection.file(coordinated.value.filings, cursor);
      guidance = coordinated.value.explorerGuidance;
      support = coordinated.value.support;
      if (coordinated.value.verify.length === 0) continue;

      const filed = await projection.at(cursor);
      const verify = await verificationPrefix(
        coordinated.value.verify,
        filed,
        config.settings.window,
      );
      const listed = verify.map(({ note }) => pick(filed, note));
      const verifierRequest = await verifierInput.parseAsync({
        task: config.task,
        verify,
        notes: listed,
        support: (await supportClosure(listed, filed)).map((id) =>
          pick(filed, id),
        ),
      });
      // The source call opens every verification: a Codex request matched
      // exactly, or a Pi call matched by its prompt bytes.
      const judged = judgedBy(verifierRequest, [], "source");
      const first = firstCall(
        records,
        cursor,
        "verifier",
        verifierLabels.source,
        codexSource(config.settings.source)
          ? jsonSnapshot(
              (
                await sourceCall(
                  config.settings.source,
                  verifierRequest,
                  judged,
                )
              ).request,
            )
          : await verifierCall("source", verifierRequest, judged),
      );
      if (first === undefined) {
        return {
          config,
          notes: filed,
          phase: { kind: "verifier", input: verifierRequest },
        };
      }
      const candidate = first.candidate;
      if (candidate === undefined) {
        throw new Error(
          `verifier call ${first.seq} is not bound to a candidate`,
        );
      }
      const recorded = verdicts.filter(
        (entry) => entry.candidate === candidate,
      );
      cursor = Math.max(cursor, ...recorded.map(({ seq }) => seq));
      const accepted = await projection.accepted(cursor);
      const acceptedId = verify
        .map(({ note }) => note)
        .find((id) => accepted.includes(id));
      if (acceptedId !== undefined) {
        const notes = await projection.at(cursor);
        return {
          config,
          notes,
          phase: {
            kind: "accepted",
            turns: turn,
            note: pick(notes, acceptedId),
            notes,
            candidate,
            closure: await supportClosure([pick(notes, acceptedId)], notes),
          },
        };
      }
      if (
        !verificationComplete(
          verifierRequest,
          recorded.map(({ verdict }) => verdict),
        )
      ) {
        return {
          config,
          notes: await projection.at(cursor),
          phase: { kind: "verifier", input: verifierRequest, candidate },
        };
      }
    }
    const ended = await projection.at(cursor);
    return {
      config,
      notes: ended,
      phase: {
        kind: "turn-limit",
        turns: config.settings.maxExplorerTurns,
        notes: ended,
      },
    };
  } finally {
    projection.close();
  }
}

export function workflowResult(phase: WorkflowTerminal): WorkflowResult {
  if (phase.kind === "accepted") {
    const { kind, closure, ...result } = phase;
    return { ...result, outcome: kind };
  }
  const { kind, ...result } = phase;
  return { ...result, outcome: kind };
}

/** A paused check witnessed by the current candidate's settled verdicts.
 * A newer verifier call invalidates that pause until it has its own verdict.
 */
export function unresolvedVerification(
  records: readonly Entry[],
  phase: WorkflowPhase,
):
  | {
      readonly outcome: "paused";
      readonly at: "verifier";
      readonly reason: string;
    }
  | undefined {
  if (phase.kind !== "verifier" || phase.candidate === undefined)
    return undefined;
  const verdicts = journalVerdicts(records).filter(
    ({ candidate }) => candidate === phase.candidate,
  );
  const lastVerdict = verdicts.at(-1)?.seq;
  if (
    lastVerdict === undefined ||
    records.some(
      (entry) =>
        entry.kind === "call" &&
        entry.role === "verifier" &&
        entry.candidate === phase.candidate &&
        entry.seq > lastVerdict,
    )
  )
    return undefined;
  const recorded = verdicts.map(({ verdict }) => verdict);
  const unresolved = verifierNames.flatMap((name) =>
    missingVerdicts(recorded, name, judgedBy(phase.input, recorded, name)).map(
      (note) =>
        recorded.findLast(
          (verdict) => verdict.verifier === name && verdict.note === note,
        ),
    ),
  );
  if (
    unresolved.length === 0 ||
    unresolved.some((verdict) => verdict?.verdict !== "INCONCLUSIVE")
  )
    return undefined;
  return {
    outcome: "paused",
    at: "verifier",
    reason: unresolved
      .map(
        (verdict) =>
          `${verdict!.verifier} ${verdict!.note}: ${verdict!.report}`,
      )
      .join("\n"),
  };
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
  let snapshot = await deriveWorkflow(campaign.records());
  let phase = snapshot.phase;
  for (;;) {
    if (phase.kind === "accepted" || phase.kind === "turn-limit") {
      return phase;
    }
    if (dependencies.pauseRequested?.()) return phase;
    dependencies.status?.(phase.kind);
    const wasVerifier = phase.kind === "verifier";
    if (phase.kind === "explorer") {
      if (await freezeExplorerGuidance(campaign, snapshot.explorerAfter!)) {
        snapshot = await deriveWorkflow(campaign.records());
        phase = snapshot.phase;
        if (phase.kind !== "explorer")
          throw new Error("explorer boundary changed");
      }
      await roles.explorer(phase.input);
    } else if (phase.kind === "coordinator") {
      await roles.coordinator(phase.input);
    } else {
      await roles.verifier(phase.input, phase.candidate);
    }
    snapshot = await deriveWorkflow(campaign.records());
    phase = snapshot.phase;
    if (wasVerifier && phase.kind === "verifier") return phase;
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
