import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { entryId as entryIdSchema, json, verdict } from "./schemas";
import {
  defineTool,
  type Campaign,
  type CandidateStatus,
  type Entry,
  type EntryId,
} from "./types";

const verdictSubmission = z.strictObject({
  verdict,
  evidence: json,
});

export const submitVerdictTool = defineTool({
  name: "submit_verdict",
  description: "Submit the final verdict and its evidence",
  input: verdictSubmission,
  replay: "safe",
  async run(submission) {
    return submission;
  },
});

export function finalizeVerdict(
  campaign: Campaign,
  callValue: EntryId,
): EntryId {
  const call = entryIdSchema.parse(callValue);
  const records = campaign.records();
  const submissions = records.filter(
    (entry): entry is Extract<Entry, { kind: "tool-call" }> =>
      entry.kind === "tool-call" &&
      entry.call === call &&
      entry.tool === submitVerdictTool.name,
  );
  if (submissions.length !== 1) {
    throw new Error("verdict requires exactly one submission");
  }
  const submission = submissions[0]!;
  const result = records.find(
    (entry) => entry.kind === "tool-result" && entry.parent === submission.seq,
  );
  if (
    result?.kind !== "tool-result" ||
    result.state !== "returned" ||
    !isDeepStrictEqual(result.output, submission.input)
  ) {
    throw new Error("verdict submission requires its matching returned result");
  }
  const report = verdictSubmission.parse(submission.input);
  return campaign.recordVerdict(call, report.verdict, report.evidence);
}

export function status(
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
