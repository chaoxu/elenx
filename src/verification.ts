import { z } from "zod";

import { entryId as entryIdSchema } from "./schemas";
import {
  type CandidateStatus,
  type Entry,
  type EntryId,
  type Json,
} from "./types";

export function returnedToolSubmission(
  records: readonly Entry[],
  callValue: EntryId,
  toolValue: string,
): {
  readonly toolCall: EntryId;
  readonly toolResult: EntryId;
  readonly input: Json;
  readonly output: Json;
} {
  const call = entryIdSchema.parse(callValue);
  const tool = z.string().min(1).parse(toolValue);
  const submissions = records.filter(
    (entry): entry is Extract<Entry, { kind: "tool-call" }> =>
      entry.kind === "tool-call" && entry.call === call && entry.tool === tool,
  );
  if (submissions.length !== 1) {
    throw new Error(`${tool} requires exactly one submission`);
  }
  const submission = submissions[0]!;
  const results = records.filter(
    (entry): entry is Extract<Entry, { kind: "tool-result" }> =>
      entry.kind === "tool-result" && entry.parent === submission.seq,
  );
  if (results.length !== 1 || results[0]!.state !== "returned") {
    throw new Error(`${tool} requires one returned tool result`);
  }
  const result = results[0]!;
  return {
    toolCall: submission.seq,
    toolResult: result.seq,
    input: submission.input,
    output: result.output,
  };
}

export function deriveCandidateStatus(
  records: readonly Entry[],
  candidate: EntryId,
): CandidateStatus {
  const status = deriveCandidateStatuses(records).get(candidate);
  if (status === undefined) {
    throw new Error(`candidate not found: ${candidate}`);
  }
  return status;
}

export function deriveCandidateStatuses(
  records: readonly Entry[],
): ReadonlyMap<EntryId, CandidateStatus> {
  const calls = new Map(
    records
      .filter((entry) => entry.kind === "call")
      .map((entry) => [entry.seq, entry]),
  );
  const verdicts = new Map<
    EntryId,
    Map<string, { pass?: EntryId; failed: boolean }>
  >();
  for (const entry of records) {
    if (entry.kind !== "verdict") continue;
    const call = calls.get(entry.call);
    if (call?.kind !== "call" || call.candidate === undefined) continue;
    const byVerifier = verdicts.get(call.candidate) ?? new Map();
    const outcome = byVerifier.get(call.label) ?? { failed: false };
    if (entry.verdict === "PASS" && outcome.pass === undefined) {
      outcome.pass = entry.seq;
    }
    if (entry.verdict === "FAIL") outcome.failed = true;
    byVerifier.set(call.label, outcome);
    verdicts.set(call.candidate, byVerifier);
  }
  const statuses = new Map<EntryId, CandidateStatus>();
  for (const declaration of records) {
    if (declaration.kind !== "candidate") continue;
    const values = verdicts.get(declaration.seq);
    const missing: string[] = [];
    const failed: string[] = [];
    const passes: EntryId[] = [];
    for (const verifier of declaration.requiredVerifiers) {
      const outcome = values?.get(verifier);
      if (outcome?.pass === undefined) missing.push(verifier);
      else passes.push(outcome.pass);
      if (outcome?.failed === true) failed.push(verifier);
    }
    statuses.set(declaration.seq, {
      verified: missing.length === 0 && failed.length === 0,
      missing,
      failed,
      passes,
    });
  }
  return statuses;
}
