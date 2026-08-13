import type { CandidateId, CandidateStatus, Entry } from "./types";

export function status(
  records: readonly Entry[],
  candidate: CandidateId,
): CandidateStatus {
  const declaration = records.find(
    (entry) => entry.kind === "candidate" && entry.candidate === candidate,
  );
  if (declaration?.kind !== "candidate") {
    throw new Error(`candidate not found: ${candidate}`);
  }
  const verdicts = records.filter(
    (entry) => entry.kind === "verdict" && entry.candidate === candidate,
  );
  const missing: string[] = [];
  const failed: string[] = [];
  const passes: number[] = [];
  for (const verifier of declaration.requiredVerifiers) {
    const values = verdicts.filter(
      (entry) => entry.kind === "verdict" && entry.verifier === verifier,
    );
    const pass = values.find(
      (entry) => entry.kind === "verdict" && entry.verdict === "PASS",
    );
    if (pass?.kind !== "verdict") {
      missing.push(verifier);
    } else {
      passes.push(pass.seq);
    }
    if (
      values.some(
        (entry) => entry.kind === "verdict" && entry.verdict === "FAIL",
      )
    ) {
      failed.push(verifier);
    }
  }
  return {
    candidate,
    verified: missing.length === 0 && failed.length === 0,
    missing,
    failed,
    passes,
  };
}
