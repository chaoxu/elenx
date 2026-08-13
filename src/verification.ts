import type { CandidateStatus, Entry, EntryId } from "./types";

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
