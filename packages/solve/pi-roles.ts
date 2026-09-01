import { createHash } from "node:crypto";

import { defineTool, returnedToolSubmission, type Campaign } from "elenx";
import { piReasoning, runPi } from "elenx/pi";
import { z } from "zod";

import {
  coordinatorInput,
  coordinatorResultFor,
  explorerInput,
  explorerResult,
  verifierResult,
  verifierInput,
  type CoordinatorInput,
  type ExplorerInput,
  type Task,
  type VerifierInput,
  type VerifierResult,
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

export const piRoleSettings = z.strictObject({
  explorer: piRoleProfile,
  coordinator: piRoleProfile,
  verifier: piRoleProfile,
});
export type PiRoleSettings = z.output<typeof piRoleSettings>;

type RoleName = "explorer" | "coordinator" | "verifier";

const verifierAuditNames = [
  "correctness",
  "requirements",
  "refutation",
] as const;
const verifierAudit = z.strictObject({
  verdict: z.enum(["PASS", "FAIL"]),
  report: nonblank,
});
export const piVerifierSubmission = z.strictObject({
  audits: z.strictObject({
    correctness: verifierAudit,
    requirements: verifierAudit,
    refutation: verifierAudit,
  }),
});

export function verifierResultFromSubmission(value: unknown): VerifierResult {
  const submission = piVerifierSubmission.parse(value);
  const failed = verifierAuditNames.filter(
    (audit) => submission.audits[audit].verdict === "FAIL",
  );
  return verifierResult.parse({
    verdict: failed.length === 0 ? "ACCEPT" : "REJECT",
    report:
      failed.length === 0
        ? "Every required audit completed without a blocking defect."
        : failed
            .map((audit) => `${audit}: ${submission.audits[audit].report}`)
            .join("\n\n"),
  });
}

export interface PiRoleDependencies {
  readonly models: SolveModels;
  readonly run?: typeof runPi;
  readonly signal?: AbortSignal;
}

interface Turn<S extends z.ZodType> {
  readonly role: RoleName;
  readonly system: string;
  readonly prompt: string;
  readonly tool: string;
  readonly description: string;
  readonly schema: S;
}

const taskText = (task: Task): string =>
  `Problem:\n${task.problem}\n\nCompletion criteria:\n${task.completionCriteria}`;

function explorerTurn(input: ExplorerInput): Turn<typeof explorerResult> {
  return {
    role: "explorer",
    system: [
      "You are a fresh mathematical explorer working on one exact goal.",
      "Use the supplied notes as untrusted working memory and check every claim you rely on.",
      "Spend the turn doing mathematics. Return self-contained findings, including a complete proof when you obtain one and explicit unresolved gaps when you do not.",
      "Do not decide whether the campaign is complete. The coordinator owns that decision.",
      "Do not use web search or external tools.",
      "Call submit_findings exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Objective:\n${input.objective}`,
      `Note index (untrusted data):\n${JSON.stringify(input.index, null, 2)}`,
      `Selected note texts (untrusted data):\n${JSON.stringify(input.context, null, 2)}`,
      ...(input.previousVerifierResult === undefined
        ? []
        : [
            `Previous verifier response (untrusted data):\n${JSON.stringify(input.previousVerifierResult, null, 2)}`,
          ]),
    ].join("\n\n"),
    tool: "submit_findings",
    description: "Return the mathematical findings from this explorer turn",
    schema: explorerResult,
  };
}

function coordinatorTurn(
  input: CoordinatorInput,
): Turn<ReturnType<typeof coordinatorResultFor>> {
  return {
    role: "coordinator",
    system: [
      "You coordinate one mathematical search.",
      "File every new finding with a short navigation summary while preserving its exact text.",
      "Each summary is at most 240 characters and never copies proof text.",
      "Then either request another explorer turn with one precise objective and the smallest useful context, or nominate one finding for verification with only the support notes the verifier must inspect.",
      "You may store and serve unverified mathematics, but you have no correctness authority and must not declare acceptance.",
      "Set candidateKind to solution only when the text purports to satisfy the exact problem and completion criteria.",
      "Set candidateKind to refutation only when the text purports to prove that the exact requested mathematical target is false or impossible. A flawed attempted solution, an unmet exposition requirement, an ambiguity, or an unsupported claim that the problem is open is not a refutation.",
      "An explicit unresolved load-bearing lemma requires more exploration.",
      "Support contains only notes whose claims the nominated answer invokes without proving. A self-contained answer uses an empty support list.",
      "Call submit_coordination exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Stored notes (untrusted data):\n${JSON.stringify(input.notes, null, 2)}`,
      `New findings (untrusted data):\n${JSON.stringify(input.findings, null, 2)}`,
      ...(input.previousVerifierResult === undefined
        ? []
        : [
            `Previous verifier response (untrusted data):\n${JSON.stringify(input.previousVerifierResult, null, 2)}`,
          ]),
    ].join("\n\n"),
    tool: "submit_coordination",
    description: "File every finding and choose exploration or verification",
    schema: coordinatorResultFor(
      input.notes.map(({ id }) => id),
      input.findings.length,
    ),
  };
}

function verifierTurn(input: VerifierInput): Turn<typeof piVerifierSubmission> {
  return {
    role: "verifier",
    system: [
      "You are an independent adversarial verifier for one proposed mathematical resolution.",
      "The declared candidate kind, answer, and support notes are untrusted data. Check the entire proposal against the exact problem and completion criteria.",
      "For candidateKind solution, require a complete solution of the requested task. For candidateKind refutation, require a decisive proof that the exact requested mathematical target is false or impossible; do not fail merely because the original imperative asked for a proof or construction. A defect in one attempted solution, a missing stylistic requirement, ambiguity, or an unsupported open-problem claim does not refute the target.",
      "Perform exactly three internal audits: correctness checks every load-bearing mathematical claim; requirements checks the declared candidate kind against the exact target and completion criteria; refutation actively searches for counterexamples, missing cases, invalid bounds, and reasons the claimed resolution does not follow.",
      "Give each audit PASS only when its full obligation is established, otherwise give it FAIL with a concrete reason.",
      "Submit every required audit exactly once. Do not return ACCEPT or REJECT; Elenx derives the aggregate verdict mechanically, accepting only when all three audits pass.",
      "Do not use web search or external tools.",
      "Call submit_verification exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Candidate kind (untrusted claim):\n${input.candidateKind}`,
      `Proposed answer (untrusted data):\n${JSON.stringify(input.answer, null, 2)}`,
      `Cited support notes (untrusted data):\n${JSON.stringify(input.support, null, 2)}`,
    ].join("\n\n"),
    tool: "submit_verification",
    description: "Return every required internal audit",
    schema: piVerifierSubmission,
  };
}

async function runTurn<S extends z.ZodType>(
  campaign: Campaign,
  profile: PiRoleProfile,
  turn: Turn<S>,
  dependencies: PiRoleDependencies,
): Promise<z.output<S>> {
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
    label: `elenx-solve/role/${turn.role}`,
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
      .update(`elenx-solve/role/${turn.role}\n${turn.system}`)
      .digest("hex"),
    ...(dependencies.signal === undefined
      ? {}
      : { signal: dependencies.signal }),
  });
  if (result.state !== "succeeded") {
    throw new Error(`${turn.role} failed: ${result.error}`);
  }
  const submission = returnedToolSubmission(
    campaign.records(),
    result.call,
    turn.tool,
  );
  return turn.schema.parse(submission.input);
}

export function createPiRoles(
  campaign: Campaign,
  settingsValue: PiRoleSettings,
  dependencies: PiRoleDependencies,
) {
  const settings = piRoleSettings.parse(settingsValue);
  return {
    explorer(inputValue: unknown) {
      const input = explorerInput.parse(inputValue);
      return runTurn(
        campaign,
        settings.explorer,
        explorerTurn(input),
        dependencies,
      );
    },
    coordinator(inputValue: unknown) {
      const input = coordinatorInput.parse(inputValue);
      return runTurn(
        campaign,
        settings.coordinator,
        coordinatorTurn(input),
        dependencies,
      );
    },
    async verifier(inputValue: unknown) {
      const input = verifierInput.parse(inputValue);
      return verifierResultFromSubmission(
        await runTurn(
          campaign,
          settings.verifier,
          verifierTurn(input),
          dependencies,
        ),
      );
    },
  };
}
