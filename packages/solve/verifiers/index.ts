import {
  assessment,
  finalProofAudit,
  deliveryAudit,
  type Assessment,
  type DeliveryAudit,
  type FinalProofAudit,
  type ResolutionAuditInput,
} from "../exploration-protocol";
import {
  premiseAudit,
  premiseVerdictFor,
  type OfflinePremiseSubmission,
  type PremiseSubmission,
} from "./premise-audit";
import {
  normalizeFinalProofAudit,
  proofAudit,
  type NormalizedFinalProofAudit,
} from "./proof-audit";
import {
  normalizeDeliveryAudit,
  type NormalizedDeliveryAudit,
} from "./delivery";
import type { DirectVerifierKind } from "./kinds";

interface DirectVerifier {
  readonly system: (verdictTool: string) => string;
  readonly prompt: (
    candidate: ResolutionAuditInput,
    premises: PremiseInventory,
  ) => string;
}

type PremiseVerifierSubmission = PremiseSubmission &
  Pick<Assessment, "verdict">;
export type VerifierSubmission =
  | Assessment
  | PremiseVerifierSubmission
  | NormalizedFinalProofAudit
  | NormalizedDeliveryAudit;
export type VerifierToolSubmission =
  Assessment | OfflinePremiseSubmission | FinalProofAudit | DeliveryAudit;
export type PremiseInventory = Readonly<PremiseSubmission["premises"]>;

const directVerifiers: Record<DirectVerifierKind, DirectVerifier> = {
  "proof-audit": proofAudit,
  "premise-audit": premiseAudit,
};

export function directVerifier(kind: DirectVerifierKind): DirectVerifier {
  return directVerifiers[kind];
}

export function normalizeVerifierSubmission(
  method: string,
  submission: VerifierToolSubmission,
): VerifierSubmission {
  if (method === "delivery-audit") {
    const parsed = deliveryAudit.safeParse(submission);
    if (!parsed.success) {
      throw new Error("delivery auditor omitted structured coverage");
    }
    return normalizeDeliveryAudit(parsed.data);
  }
  if (method === "proof-audit") {
    const parsed = finalProofAudit.safeParse(submission);
    if (!parsed.success) {
      throw new Error("proof auditor omitted structured terminal coverage");
    }
    return normalizeFinalProofAudit(parsed.data);
  }
  if (method === "premise-audit") {
    if (!("premises" in submission)) {
      throw new Error("premise auditor omitted its premise inventory");
    }
    return {
      ...submission,
      verdict: premiseVerdictFor(submission.premises),
    };
  }
  if ("premises" in submission) {
    throw new Error("assessment auditor submitted a premise inventory");
  }
  const parsed =
    "verdict" in submission && "report" in submission
      ? assessment.safeParse({
          verdict: submission.verdict,
          report: submission.report,
        })
      : assessment.safeParse(submission);
  if (!parsed.success) {
    throw new Error("assessment auditor omitted its verdict and report");
  }
  return parsed.data;
}
