import type { CandidateStatus, Entry, Hash } from "./types";

export function status(
  records: readonly Entry[],
  candidate: Hash,
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
  const promotable = missing.length === 0 && failed.length === 0;
  const promotion = records.find(
    (entry) => entry.kind === "promotion" && entry.candidate === candidate,
  );
  if (promotion?.kind === "promotion") {
    if (
      !promotable ||
      promotion.verdicts.length !== passes.length ||
      promotion.verdicts.some((seq, index) => seq !== passes[index])
    ) {
      throw new Error(`invalid promotion witness: ${candidate}`);
    }
  }
  return {
    candidate,
    promotable,
    promoted: promotion !== undefined,
    missing,
    failed,
    passes,
  };
}
