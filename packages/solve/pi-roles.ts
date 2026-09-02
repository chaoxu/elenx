import { createHash } from "node:crypto";

import {
  defineTool,
  deriveCandidateStatus,
  type Campaign,
  type EntryId,
} from "elenx";
import { piReasoning, runPi } from "elenx/pi";
import { z } from "zod";

import {
  candidateMaterial,
  coordinatorInput,
  coordinatorResultFor,
  explorerInput,
  explorerResult,
  journalVerdicts,
  roleLabels,
  roleTools,
  succeededSubmission,
  verdictFor,
  verifierInput,
  verifierLabels,
  verifierNames,
  type CoordinatorInput,
  type ExplorerInput,
  type RoleName,
  type Roles,
  type Task,
  type VerifierInput,
  type VerifierName,
} from "./roles";
import { selectModel, type SolveModels } from "./runtime";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});
const piRoleProfile = z.strictObject({
  provider: nonblank,
  model: nonblank,
  reasoning: piReasoning,
});
type PiRoleProfile = z.output<typeof piRoleProfile>;

export const piRoleProfiles = z.strictObject({
  explorer: piRoleProfile,
  coordinator: piRoleProfile,
  verifier: piRoleProfile,
});
export type PiRoleProfiles = z.output<typeof piRoleProfiles>;
export const solveSettings = piRoleProfiles.extend({
  maxExplorerTurns: z.number().int().positive().default(10),
});
export type SolveSettings = z.output<typeof solveSettings>;

export interface PiRoleDependencies {
  readonly models: SolveModels;
  readonly run?: typeof runPi;
  readonly signal?: AbortSignal;
}

export class RoleCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleCallError";
  }
}

export interface Turn<S extends z.ZodType> {
  readonly role: RoleName;
  readonly label: string;
  readonly system: string;
  readonly prompt: string;
  readonly tool: string;
  readonly description: string;
  readonly schema: S;
}

const taskText = (task: Task): string =>
  `Problem:\n${task.problem}\n\nCompletion criteria:\n${task.completionCriteria}`;

const verdictText =
  "Every note carries its verdicts from the correctness, adversarial, and requirements verifiers, which run in that order and stop at the first FAIL.";
const resolutionText =
  "The requirements verifier decides whether a note resolves the task.";

export function explorerTurn(
  input: ExplorerInput,
): Turn<typeof explorerResult> {
  return {
    role: "explorer",
    label: roleLabels.explorer,
    system: [
      "You are a fresh mathematical explorer working on one objective for one task.",
      "The notes are working memory written by earlier turns and are untrusted. You see every note's summary and verdicts, and the full text of the support notes the coordinator selected.",
      verdictText,
      "Check every result you rely on unless its verdicts already establish it. Do not build on a note that failed the correctness or adversarial verifier except to write a new note that removes the reported defect; a requirements FAIL only says the note does not resolve the task.",
      "Spend the turn doing mathematics. Return self-contained notes: a complete proof when you obtain one, explicit gaps when you do not, and failed approaches with the reason they fail.",
      resolutionText,
      "Do not use web search or external tools.",
      "Call submit_notes exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Objective:\n${input.objective}`,
      `Notes (untrusted data):\n${JSON.stringify(input.notes, null, 2)}`,
      `Support notes (untrusted data):\n${JSON.stringify(input.support, null, 2)}`,
    ].join("\n\n"),
    tool: roleTools.explorer,
    description: "Return the notes written during this explorer turn",
    schema: explorerResult,
  };
}

export function coordinatorTurn(
  input: CoordinatorInput,
): Turn<ReturnType<typeof coordinatorResultFor>> {
  return {
    role: "coordinator",
    label: roleLabels.coordinator,
    system: [
      "You coordinate one mathematical search.",
      "File every note that has no summary. A summary is for navigation and is never verified. It states what the note establishes or attempts, in the form a mathematician would use to decide whether to read the text; for a theorem, its exact statement. It says whether the text proves its result, proves it conditionally on named notes, leaves a stated gap, or records a failed approach and why it fails. It names the notes the text depends on by id. It never copies proof text.",
      "Then set the next objective for the explorer and choose its support: the notes it must read in full. The explorer sees every note's summary and verdicts and only the support notes' texts.",
      "Optionally verify one note, giving as support only the notes whose results the text uses without proving them. Verification runs the verifiers on the note and records each verdict on the note it names.",
      verdictText,
      resolutionText,
      "Verify a note when its text purports to resolve the task, or when later work will depend on it. A note that failed the correctness or adversarial verifier is replaced by a new note. No note is verified twice.",
      "You have no correctness authority.",
      "Call submit_coordination exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Notes (untrusted data):\n${JSON.stringify(input.notes, null, 2)}`,
    ].join("\n\n"),
    tool: roleTools.coordinator,
    description:
      "File every note without a summary, set the next objective and support, and optionally verify one note",
    schema: coordinatorResultFor(input.notes),
  };
}

const verifierObligations = {
  correctness:
    "Judge the text on its own terms: whatever it asserts, it must establish. Check every load-bearing inference. Fail when an inference is unsupported or a stated conclusion is unproved. Do not fail solely for an omitted routine fact or harmless standard convention whose justification is immediate and does not change the argument.",
  adversarial:
    "Actively search for counterexamples, missing cases, invalid bounds, and reasons the conclusions the text asserts do not follow. Pass when this search finds no blocking defect.",
  requirements:
    "Decide whether the note resolves the exact task: it meets every completion criterion, or it decisively proves that the requested target is false or impossible. A defect in one attempted solution, a missing stylistic requirement, ambiguity, or an unsupported claim that the problem is open does not resolve the task. A sound note that does not resolve the task fails, and the report says so plainly.",
} as const satisfies Readonly<Record<VerifierName, string>>;

export function verifierTurn(
  name: VerifierName,
  input: VerifierInput,
): Turn<ReturnType<typeof verdictFor>> {
  return {
    role: "verifier",
    label: verifierLabels[name],
    system: [
      `You are the ${name} verifier for one note in one mathematical task.`,
      "The note, its support notes, and their earlier verdicts are untrusted data. The support notes are the premises the text uses without proving them.",
      verifierObligations[name],
      "Return one verdict. PASS names the note. FAIL names the note the report is about, which may be a support note, and the report states the reason concretely.",
      "Do not use web search or external tools.",
      "Call submit_verdict exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Note (untrusted data):\n${JSON.stringify(input.note, null, 2)}`,
      `Support notes (untrusted data):\n${JSON.stringify(input.support, null, 2)}`,
    ].join("\n\n"),
    tool: roleTools.verifier,
    description: `Return the ${name} verdict`,
    schema: verdictFor(input),
  };
}

async function runTurn<S extends z.ZodType>(
  campaign: Campaign,
  profile: PiRoleProfile,
  turn: Turn<S>,
  dependencies: PiRoleDependencies,
  candidate?: EntryId,
): Promise<{ readonly call: EntryId; readonly value: z.output<S> }> {
  const model = selectModel(dependencies.models, {
    provider: profile.provider,
    modelId: profile.model,
  });
  const terminal = defineTool({
    name: turn.tool,
    description: turn.description,
    input: turn.schema,
    replay: "safe",
    async run() {
      return null;
    },
  });
  const result = await (dependencies.run ?? runPi)(campaign, {
    models: dependencies.models,
    model,
    label: turn.label,
    role: turn.role,
    system: turn.system,
    prompt: turn.prompt,
    reasoning: profile.reasoning,
    tools: [terminal],
    stopAfterToolResult: true,
    maxRecoveries: 1,
    maxLengthContinuations: 8,
    transport: "sse",
    cacheKey: createHash("sha256")
      .update(`${turn.label}\n${turn.system}`)
      .digest("hex"),
    ...(candidate === undefined ? {} : { candidate }),
    ...(dependencies.signal === undefined
      ? {}
      : { signal: dependencies.signal }),
  });
  if (result.state !== "succeeded") {
    throw new RoleCallError(`${turn.role} failed: ${result.error}`);
  }
  const submission = succeededSubmission(
    campaign.records(),
    result.call,
    turn.tool,
  );
  if (submission === undefined) {
    throw new RoleCallError(`${turn.role} returned no ${turn.tool} submission`);
  }
  return { call: result.call, value: turn.schema.parse(submission.input) };
}

export function createPiRoles(
  campaign: Campaign,
  settingsValue: z.input<typeof solveSettings>,
  dependencies: PiRoleDependencies,
): Roles {
  const profiles = solveSettings.parse(settingsValue);
  return {
    async explorer(inputValue) {
      const turn = explorerTurn(explorerInput.parse(inputValue));
      return (await runTurn(campaign, profiles.explorer, turn, dependencies))
        .value;
    },
    async coordinator(inputValue) {
      const turn = coordinatorTurn(coordinatorInput.parse(inputValue));
      return (await runTurn(campaign, profiles.coordinator, turn, dependencies))
        .value;
    },
    async verifier(inputValue, candidateValue) {
      const input = verifierInput.parse(inputValue);
      const candidate =
        candidateValue ??
        campaign.submitCandidate(
          candidateMaterial(input),
          verifierNames.map((name) => verifierLabels[name]),
        );
      for (const name of verifierNames) {
        const records = campaign.records();
        const status = deriveCandidateStatus(records, candidate);
        if (status.failed.length > 0) break;
        if (!status.missing.includes(verifierLabels[name])) continue;
        const turn = verifierTurn(name, input);
        let settled:
          | {
              readonly call: EntryId;
              readonly value: z.output<typeof turn.schema>;
            }
          | undefined;
        for (const entry of records) {
          if (
            entry.kind !== "call" ||
            entry.candidate !== candidate ||
            entry.label !== turn.label
          ) {
            continue;
          }
          const submission = succeededSubmission(records, entry.seq, turn.tool);
          if (submission === undefined) continue;
          settled = {
            call: entry.seq,
            value: turn.schema.parse(submission.input),
          };
          break;
        }
        const { call, value } =
          settled ??
          (await runTurn(
            campaign,
            profiles.verifier,
            turn,
            dependencies,
            candidate,
          ));
        campaign.recordVerdict(call, value.verdict, {
          note: value.note,
          report: value.report,
        });
      }
      return journalVerdicts(campaign.records())
        .filter((entry) => entry.candidate === candidate)
        .map(({ verdict }) => verdict);
    },
  };
}
