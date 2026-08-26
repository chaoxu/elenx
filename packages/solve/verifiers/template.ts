import type { ResolutionAuditInput } from "../exploration-protocol";
import type { PremiseFinding } from "./premise-audit";
import { supportProjection } from "./proof-audit";

export const templateAudit = {
  system(method: string, verdictTool: string): string {
    return `${method} You audit one exact proposed resolution as a fresh assessor. PASS only when the artifact survives your complete check. On FAIL give the smallest decisive defect; on INCONCLUSIVE give the smallest open obligation. Call ${verdictTool} exactly once.`;
  },
  prompt(
    projection: "support" | "argument",
    candidate: ResolutionAuditInput,
    premises: readonly PremiseFinding[],
  ): string {
    const body =
      projection === "support"
        ? supportProjection(candidate, premises)
        : { envelope: candidate.envelope };
    return `Resolution candidate ${candidate.id}:\n${JSON.stringify(body, null, 2)}`;
  },
};
