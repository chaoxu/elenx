import {
  deliveryAuditVerdict,
  renderTask,
  type Assessment,
  type DeliveryAssemblyInput,
  type DeliveryAudit,
  type DeliveryAuditInput,
} from "../exploration-protocol";

export function deliveryAssemblySystem(tool: string): string {
  return `You assemble one standalone answer for the original reader from a verified modular resolution, its complete mathematical support closure, and established sourced premise statements. Include every load-bearing definition, construction, lemma, and proof. Resolve internal claim references into ordinary prose. Preserve exact hypotheses and applications of sourced theorems. The answer must contain no campaign, claim, route, revision, or audit references and no assertion that hidden modules were supplied. Submit only the answer by calling ${tool} exactly once.`;
}

export function deliveryAssemblyPrompt(input: DeliveryAssemblyInput): string {
  return `${renderTask(input.task)}\n\nVerified modular resolution and full mathematical support:\n${JSON.stringify(
    {
      resolution: input.resolution,
      support: input.support,
      sourcedPremises: input.sourcedPremises,
    },
    null,
    2,
  )}`;
}

export function deliveryAuditSystem(tool: string): string {
  return `You are a fresh candidate-only auditor for the exact public answer bytes. You receive only the original task, the answer, and established sourced premise statements. Inventory and check every theorem-class conclusion in the answer, then check self-containment, absence of internal campaign references, and the exact requested result. You have no internal claim DAG, support artifacts, audit history, or prior verdicts. PASS each component only after it survives; use FAIL for a concrete defect and INCONCLUSIVE for the smallest open obligation. The harness derives the aggregate verdict. Call ${tool} exactly once.`;
}

export function deliveryAuditPrompt(input: DeliveryAuditInput): string {
  return `${renderTask(input.task)}\n\nEstablished sourced premise statements:\n${
    input.sourcedPremises.length === 0
      ? "none"
      : JSON.stringify(input.sourcedPremises, null, 2)
  }\n\nExact public answer:\n${input.answer}`;
}

export interface NormalizedDeliveryAudit extends Assessment {
  readonly audit: DeliveryAudit;
}

export function normalizeDeliveryAudit(
  audit: DeliveryAudit,
): NormalizedDeliveryAudit {
  const verdict = deliveryAuditVerdict(audit);
  const checks = [
    audit.resolution,
    audit.selfContainment,
    audit.internalReferenceHygiene,
    ...audit.theoremChecks,
  ];
  const report =
    checks.find((check) => check.verdict === verdict)?.report ??
    audit.resolution.report;
  return { verdict, report, audit };
}
