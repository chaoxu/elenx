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
  const declaration = records.find(
    (entry) => entry.kind === "candidate" && entry.seq === candidate,
  );
  if (declaration?.kind !== "candidate") {
    throw new Error(`candidate not found: ${candidate}`);
  }
  const calls = new Map(
    records
      .filter((entry) => entry.kind === "call")
      .map((entry) => [entry.seq, entry]),
  );
  const verdicts = records.flatMap((entry) => {
    if (entry.kind !== "verdict") return [];
    const call = calls.get(entry.call);
    return call?.kind === "call" && call.candidate === candidate
      ? [{ entry, verifier: call.label }]
      : [];
  });
  const missing: string[] = [];
  const failed: string[] = [];
  const passes: EntryId[] = [];
  for (const verifier of declaration.requiredVerifiers) {
    const values = verdicts.filter((value) => value.verifier === verifier);
    const pass = values.find((value) => value.entry.verdict === "PASS");
    if (pass === undefined) {
      missing.push(verifier);
    } else {
      passes.push(pass.entry.seq);
    }
    if (values.some((value) => value.entry.verdict === "FAIL")) {
      failed.push(verifier);
    }
  }
  return {
    verified: missing.length === 0 && failed.length === 0,
    missing,
    failed,
    passes,
  };
}
