import {
  declaredEvidenceDAG,
  renderTask,
  type DeclaredEvidenceDAG,
  type ResolutionAuditInput,
  type Task,
} from "../exploration-protocol";

type TaskInput = Pick<Task, "problem" | "completionCriteria">;

interface ReconstructionInput {
  readonly call: number;
  readonly report: string;
}

const heading = "Declared evidence DAG (authorized assumptions for this gate):";

export function declaredEvidenceBlock(value: DeclaredEvidenceDAG): string {
  return `${heading}\n${JSON.stringify(declaredEvidenceDAG.parse(value), null, 2)}`;
}

export function reconstructionSystem(tool: string): string {
  return `You are a fresh candidate-blind reconstructor. You receive the exact goal and one declared evidence DAG. Every listed claim, prerequisite, and sourced premise is an authorized assumption for this reconstruction gate; do not re-prove its truth. Terminal proof audit owns truth. Check hypotheses and applications, derive an end-to-end resolution, reject any undeclared theorem-class dependency, and identify any obligation you cannot close. You never receive the candidate argument, campaign history, routes, audits, or verdicts. Do not give a verdict. Submit the reconstruction by calling ${tool} exactly once.`;
}

export function reconstructionPrompt(
  task: TaskInput,
  candidate: ResolutionAuditInput,
): string {
  return `${renderTask(task)}\n\n${declaredEvidenceBlock(candidate.declaredEvidence)}`;
}

export function comparisonSystem(tool: string): string {
  return `You are a fresh candidate-bound reconstruction comparator. Every claim, prerequisite, and sourced premise in the declared evidence DAG is an authorized assumption for this gate; do not re-prove its truth. Terminal proof audit owns truth. Check correct hypotheses and applications, reject undeclared theorem-class dependencies, and determine whether the reconstruction establishes the exact requested result and agrees with the candidate conclusion. The arguments may differ. FAIL on a concrete error, contradiction, undeclared dependency, or weaker conclusion; INCONCLUSIVE on the smallest unchecked obligation; PASS only after mapping the reconstruction to the exact goal and candidate. Submit one verdict by calling ${tool} exactly once.`;
}

export function comparisonPrompt(
  task: TaskInput,
  candidate: ResolutionAuditInput,
  reconstruction: ReconstructionInput,
): string {
  const exactCandidate = {
    id: candidate.id,
    envelope: candidate.envelope,
  };
  return `${renderTask(task)}\n\n${declaredEvidenceBlock(candidate.declaredEvidence)}\n\nIndependent candidate-blind reconstruction from call ${reconstruction.call}:\n${reconstruction.report}\n\nExact resolution candidate:\n${JSON.stringify(exactCandidate, null, 2)}`;
}
