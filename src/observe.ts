import { openReader } from "./campaign";
import {
  derivePiSpend,
  piRequest,
  piRequestAttempts,
  piStoredResult,
  summarizePiSpend,
  type PiRequestAttempt,
  type PiSpendOperation,
  type PiSpendSummary,
} from "./pi";
import { deriveCandidateStatuses } from "./verification";
import type { CandidateStatus, Entry, EntryId, Json, Reader } from "./types";

type CallEntry = Extract<Entry, { kind: "call" }>;
type CallResultEntry = Extract<Entry, { kind: "call-result" }>;
type ToolCallEntry = Extract<Entry, { kind: "tool-call" }>;
type CandidateEntry = Extract<Entry, { kind: "candidate" }>;

export interface CoreCampaignObservationV1 {
  readonly schema: "elenx.core-observation/v1";
  readonly application: string;
  readonly applicationConfig: Json;
  readonly createdAtMs: number;
  readonly lastSeq: number;
  readonly lastAtMs: number;
  readonly calls: readonly CoreCallObservationV1[];
  readonly candidates: readonly CoreCandidateObservationV1[];
  readonly spend: PiSpendSummary & {
    readonly unsupportedCalls: readonly EntryId[];
    readonly unaccountedCalls: readonly EntryId[];
  };
}

export interface CoreCampaignSummaryV1 {
  readonly schema: "elenx.core-observation-summary/v1";
  readonly application: string;
  readonly createdAtMs: number;
  readonly lastSeq: number;
  readonly lastAtMs: number;
  readonly callCount: number;
  readonly callsWithoutResult?: {
    readonly count: number;
    readonly oldestStartedAtMs: number;
  };
  readonly candidateCount: number;
  readonly verifiedCandidateCount: number;
  readonly spend: PiSpendSummary & {
    readonly unsupportedCalls: number;
    readonly unaccountedCalls: number;
  };
}

export interface CoreCallObservationV1 {
  readonly id: EntryId;
  readonly label: string;
  readonly candidateId?: EntryId;
  readonly startedAtMs: number;
  readonly settledAtMs?: number;
  readonly settlement: "returned" | "threw" | "unsettled";
  readonly error?: string;
  readonly tools: readonly { readonly id: EntryId; readonly name: string }[];
  readonly pi?: {
    readonly requested: {
      readonly provider: string;
      readonly model: string;
      readonly api: string;
      readonly reasoning?: string;
    };
    readonly outcome?: "succeeded" | "failed" | "cancelled";
    readonly responseText?: string;
    readonly checkpoints: readonly {
      readonly id: EntryId;
      readonly state: "completed" | "unsettled";
    }[];
    readonly accounting: PiAccountingObservationV1;
  };
}

export type PiAccountingObservationV1 =
  | {
      readonly state: "available";
      readonly operations: readonly PiSpendOperation[];
      readonly spend: PiSpendSummary;
    }
  | { readonly state: "unaccounted" }
  | { readonly state: "unsupported" };

export interface CoreCandidateObservationV1 {
  readonly id: EntryId;
  readonly requiredVerifiers: readonly string[];
  readonly material:
    | {
        readonly bytes: number;
        readonly encoding: "utf8";
        readonly text: string;
      }
    | {
        readonly bytes: number;
        readonly encoding: "base64";
        readonly base64: string;
      };
  readonly status: CandidateStatus;
  readonly verdicts: readonly CoreVerdictObservationV1[];
}

export interface CoreVerdictObservationV1 {
  readonly call: EntryId;
  readonly verifier: string;
  readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly evidence: Json;
}

interface RecordIndex {
  readonly declaration: Extract<Entry, { kind: "campaign" }>;
  readonly last: Entry;
  readonly calls: readonly CallEntry[];
  readonly results: ReadonlyMap<EntryId, CallResultEntry>;
  readonly tools: ReadonlyMap<EntryId, readonly ToolCallEntry[]>;
  readonly attemptsByParent: ReadonlyMap<EntryId, readonly PiRequestAttempt[]>;
  readonly callsById: ReadonlyMap<EntryId, CallEntry>;
  readonly candidates: readonly CandidateEntry[];
  readonly verdicts: ReadonlyMap<EntryId, readonly CoreVerdictObservationV1[]>;
  readonly statuses: ReadonlyMap<EntryId, CandidateStatus>;
}

interface AccountingIndex {
  readonly byCall: ReadonlyMap<EntryId, PiAccountingObservationV1>;
  readonly spend: PiSpendSummary;
  readonly unsupportedCalls: readonly EntryId[];
  readonly unaccountedCalls: readonly EntryId[];
}

export function inspectCoreCampaign(path: string): CoreCampaignObservationV1 {
  const reader = openReader(path);
  try {
    return projectCoreCampaign(reader, reader.records());
  } finally {
    reader.close();
  }
}

export function inspectCoreCampaignSummary(
  path: string,
): CoreCampaignSummaryV1 {
  const reader = openReader(path);
  try {
    return projectCoreCampaignSummary(reader.records());
  } finally {
    reader.close();
  }
}

function projectCoreCampaign(
  reader: Reader,
  records: readonly Entry[],
): CoreCampaignObservationV1 {
  const index = indexRecords(records);
  const accounting = indexAccounting(index);
  return {
    schema: "elenx.core-observation/v1",
    application: index.declaration.application,
    applicationConfig: index.declaration.config,
    createdAtMs: index.declaration.atMs,
    lastSeq: index.last.seq,
    lastAtMs: index.last.atMs,
    calls: index.calls.map((call) => projectCall(index, accounting, call)),
    candidates: index.candidates.map((candidate) =>
      projectCandidate(reader, index, candidate),
    ),
    spend: {
      ...accounting.spend,
      unsupportedCalls: accounting.unsupportedCalls,
      unaccountedCalls: accounting.unaccountedCalls,
    },
  };
}

function projectCoreCampaignSummary(
  records: readonly Entry[],
): CoreCampaignSummaryV1 {
  const index = indexRecords(records);
  const accounting = indexAccounting(index);
  const unsettled = index.calls.filter(
    (call) => index.results.get(call.seq) === undefined,
  );
  return {
    schema: "elenx.core-observation-summary/v1",
    application: index.declaration.application,
    createdAtMs: index.declaration.atMs,
    lastSeq: index.last.seq,
    lastAtMs: index.last.atMs,
    callCount: index.calls.length,
    ...(unsettled.length === 0
      ? {}
      : {
          callsWithoutResult: {
            count: unsettled.length,
            oldestStartedAtMs: Math.min(...unsettled.map(({ atMs }) => atMs)),
          },
        }),
    candidateCount: index.candidates.length,
    verifiedCandidateCount: index.candidates.filter(
      ({ seq }) => candidateStatus(index, seq).verified,
    ).length,
    spend: {
      ...accounting.spend,
      unsupportedCalls: accounting.unsupportedCalls.length,
      unaccountedCalls: accounting.unaccountedCalls.length,
    },
  };
}

function indexRecords(records: readonly Entry[]): RecordIndex {
  const declaration = records[0];
  if (declaration?.kind !== "campaign") {
    throw new Error("campaign declaration is unavailable");
  }
  const callsById = new Map<EntryId, CallEntry>();
  const results = new Map<EntryId, CallResultEntry>();
  const tools = new Map<EntryId, ToolCallEntry[]>();
  const candidates: CandidateEntry[] = [];
  for (const entry of records) {
    if (entry.kind === "call") callsById.set(entry.seq, entry);
    else if (entry.kind === "call-result") results.set(entry.parent, entry);
    else if (entry.kind === "tool-call") {
      const values = tools.get(entry.call) ?? [];
      values.push(entry);
      tools.set(entry.call, values);
    } else if (entry.kind === "candidate") candidates.push(entry);
  }
  const attempts = piRequestAttempts(records);
  const attemptIds = new Set(attempts.map(({ call }) => call));
  const attemptsByParent = new Map<EntryId, PiRequestAttempt[]>();
  for (const attempt of attempts) {
    const values = attemptsByParent.get(attempt.parent) ?? [];
    values.push(attempt);
    attemptsByParent.set(attempt.parent, values);
  }
  const verdicts = new Map<EntryId, CoreVerdictObservationV1[]>();
  for (const entry of records) {
    if (entry.kind !== "verdict") continue;
    const call = callsById.get(entry.call);
    if (call?.candidate === undefined) continue;
    const values = verdicts.get(call.candidate) ?? [];
    values.push({
      call: entry.call,
      verifier: call.label,
      verdict: entry.verdict,
      evidence: entry.evidence,
    });
    verdicts.set(call.candidate, values);
  }
  return {
    declaration,
    last: records.at(-1) ?? declaration,
    calls: [...callsById.values()].filter(({ seq }) => !attemptIds.has(seq)),
    results,
    tools,
    attemptsByParent,
    callsById,
    candidates,
    verdicts,
    statuses: deriveCandidateStatuses(records),
  };
}

function indexAccounting(index: RecordIndex): AccountingIndex {
  const byCall = new Map<EntryId, PiAccountingObservationV1>();
  const understoodOperations: PiSpendOperation[] = [];
  const unsupportedCalls: EntryId[] = [];
  const unaccountedCalls: EntryId[] = [];
  for (const call of index.calls) {
    if (!piRequest.safeParse(call.request).success) continue;
    const result = index.results.get(call.seq);
    if (result?.state !== "returned") {
      byCall.set(call.seq, { state: "unaccounted" });
      unaccountedCalls.push(call.seq);
      continue;
    }
    try {
      const projected = derivePiSpend(piEntries(index, call));
      const row = projected.calls.find(({ call: id }) => id === call.seq);
      if (row === undefined)
        throw new Error("settled Pi call was not accounted");
      const { operations, call: _, ...spend } = row;
      understoodOperations.push(...operations);
      byCall.set(call.seq, { state: "available", operations, spend });
    } catch {
      byCall.set(call.seq, { state: "unsupported" });
      unsupportedCalls.push(call.seq);
    }
  }
  return {
    byCall,
    spend: summarizePiSpend(understoodOperations),
    unsupportedCalls,
    unaccountedCalls,
  };
}

function piEntries(index: RecordIndex, call: CallEntry): readonly Entry[] {
  const entries: Entry[] = [call];
  const result = index.results.get(call.seq);
  if (result !== undefined) entries.push(result);
  for (const attempt of index.attemptsByParent.get(call.seq) ?? []) {
    const attemptCall = index.callsById.get(attempt.call);
    if (attemptCall !== undefined) entries.push(attemptCall);
    const attemptResult = index.results.get(attempt.call);
    if (attemptResult !== undefined) entries.push(attemptResult);
  }
  return entries;
}

function projectCall(
  index: RecordIndex,
  accounting: AccountingIndex,
  call: CallEntry,
): CoreCallObservationV1 {
  const result = index.results.get(call.seq);
  const request = piRequest.safeParse(call.request);
  const stored =
    result?.state === "returned"
      ? piStoredResult.safeParse(result.output)
      : undefined;
  const parsed = stored?.success === true ? stored.data : undefined;
  const callAccounting = accounting.byCall.get(call.seq);
  return {
    id: call.seq,
    label: call.label,
    ...(call.candidate === undefined ? {} : { candidateId: call.candidate }),
    startedAtMs: call.atMs,
    ...(result === undefined ? {} : { settledAtMs: result.atMs }),
    settlement: result?.state ?? "unsettled",
    ...(result?.state === "threw" ? { error: result.error } : {}),
    tools: (index.tools.get(call.seq) ?? []).map(({ seq, tool }) => ({
      id: seq,
      name: tool,
    })),
    ...(request.success && callAccounting !== undefined
      ? {
          pi: {
            requested: {
              provider: request.data.model.provider,
              model: request.data.model.id,
              api: request.data.model.api,
              ...(request.data.reasoning === undefined
                ? {}
                : { reasoning: request.data.reasoning }),
            },
            ...(parsed === undefined
              ? {}
              : {
                  outcome: parsed.state,
                  ...(parsed.text === "" ? {} : { responseText: parsed.text }),
                }),
            checkpoints: (index.attemptsByParent.get(call.seq) ?? []).map(
              (attempt) => ({ id: attempt.call, state: attempt.state }),
            ),
            accounting: callAccounting,
          },
        }
      : {}),
  };
}

function projectCandidate(
  reader: Reader,
  index: RecordIndex,
  candidate: CandidateEntry,
): CoreCandidateObservationV1 {
  const material = reader.material(candidate.seq);
  const utf8 = decodedUtf8(material);
  return {
    id: candidate.seq,
    requiredVerifiers: candidate.requiredVerifiers,
    material:
      utf8 === undefined
        ? {
            bytes: material.byteLength,
            encoding: "base64",
            base64: Buffer.from(material).toString("base64"),
          }
        : { bytes: material.byteLength, encoding: "utf8", text: utf8 },
    status: candidateStatus(index, candidate.seq),
    verdicts: index.verdicts.get(candidate.seq) ?? [],
  };
}

function candidateStatus(
  index: RecordIndex,
  candidate: EntryId,
): CandidateStatus {
  const status = index.statuses.get(candidate);
  if (status === undefined)
    throw new Error(`candidate not found: ${candidate}`);
  return status;
}

function decodedUtf8(material: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(material);
  } catch {
    return undefined;
  }
}
