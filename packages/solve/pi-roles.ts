import { createHash } from "node:crypto";

import {
  defineTool,
  returnedToolSubmission,
  type Campaign,
  type Json,
} from "elenx";
import { piReasoning, runPi } from "elenx/pi";
import { z } from "zod";

import {
  auditResult,
  auditorDefinitions,
  auditorNames,
  verifierCallOutput,
  verifierFromAuditors,
  type AuditorName,
  type AuditorSet,
} from "./auditors";
import {
  coordinatorInput,
  coordinatorResultFor,
  explorerInput,
  explorerResult,
  roleCallOutput,
  verifierInput,
  type CoordinatorInput,
  type ExplorerInput,
  type Task,
  type VerifierInput,
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
  maxExplorerTurns: z.number().int().positive().default(10),
  explorer: piRoleProfile,
  coordinator: piRoleProfile,
  verifier: piRoleProfile,
});
export type PiRoleSettings = z.output<typeof piRoleSettings>;

type RoleName = "explorer" | "coordinator" | "verifier";

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

function auditorTurn(
  name: AuditorName,
  input: VerifierInput,
): Turn<typeof auditResult> {
  const definition = auditorDefinitions.find(
    (auditor) => auditor.name === name,
  );
  if (definition === undefined) throw new Error(`unknown auditor: ${name}`);
  return {
    role: "verifier",
    system: [
      "You are an independent adversarial auditor for one proposed mathematical resolution.",
      "The declared candidate kind, answer, and support notes are untrusted data. Check the entire proposal against the exact problem and completion criteria.",
      "For candidateKind solution, require a complete solution of the requested task. For candidateKind refutation, require a decisive proof that the exact requested mathematical target is false or impossible; do not fail merely because the original imperative asked for a proof or construction. A defect in one attempted solution, a missing stylistic requirement, ambiguity, or an unsupported open-problem claim does not refute the target.",
      "Perform only the supplied audit obligation. The verdict always evaluates the candidate: PASS means the audit found no blocking defect, while FAIL requires one concrete blocking defect. An adversarial search that finds no counterexample, gap, or invalid inference returns PASS.",
      "Do not return ACCEPT or REJECT. The outer verifier derives that result mechanically.",
      "Do not use web search or external tools.",
      "Call submit_audit exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Candidate kind (untrusted claim):\n${input.candidateKind}`,
      `Proposed answer (untrusted data):\n${JSON.stringify(input.answer, null, 2)}`,
      `Cited support notes (untrusted data):\n${JSON.stringify(input.support, null, 2)}`,
      `Audit:\n${name}`,
      `Audit obligation:\n${definition.instruction}`,
    ].join("\n\n"),
    tool: "submit_audit",
    description: `Return the ${name} audit`,
    schema: auditResult,
  };
}

async function runTurn<S extends z.ZodType>(
  campaign: Campaign,
  profile: PiRoleProfile,
  turn: Turn<S>,
  dependencies: PiRoleDependencies,
  candidate?: number,
  label = `elenx-solve/role/${turn.role}`,
  cacheIdentity = label,
): Promise<{ readonly call: number; readonly value: z.output<S> }> {
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
    label,
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
      .update(`${cacheIdentity}\n${turn.system}`)
      .digest("hex"),
    ...(candidate === undefined ? {} : { candidate }),
    ...(dependencies.signal === undefined
      ? {}
      : { signal: dependencies.signal }),
  });
  if (result.state !== "succeeded") {
    throw new RoleCallError(`${turn.role} failed: ${result.error}`);
  }
  try {
    const submission = returnedToolSubmission(
      campaign.records(),
      result.call,
      turn.tool,
    );
    return { call: result.call, value: turn.schema.parse(submission.input) };
  } catch (error) {
    throw new RoleCallError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function createPiAuditors(
  campaign: Campaign,
  profile: PiRoleProfile,
  dependencies: PiRoleDependencies,
  candidate: number,
): AuditorSet {
  return Object.fromEntries(
    auditorNames.map((name) => [
      name,
      async (input: VerifierInput) =>
        (
          await runTurn(
            campaign,
            profile,
            auditorTurn(name, input),
            dependencies,
            candidate,
            `elenx-solve/role/verifier/auditor/${name}`,
            "elenx-solve/role/verifier/auditor",
          )
        ).value,
    ]),
  ) as AuditorSet;
}

export function createPiRoles(
  campaign: Campaign,
  settingsValue: z.input<typeof piRoleSettings>,
  dependencies: PiRoleDependencies,
) {
  const settings = piRoleSettings.parse(settingsValue);
  let acceptedCandidate: number | undefined;
  return {
    async explorer(inputValue: unknown) {
      const input = explorerInput.parse(inputValue);
      const label = "elenx-solve/role/explorer";
      const settled = await campaign.call(
        {
          label,
          role: "explorer",
          request: jsonSnapshot(input),
          ...(dependencies.signal === undefined
            ? {}
            : { signal: dependencies.signal }),
        },
        async ({ request, signal }) => {
          const exactInput = explorerInput.parse(request);
          const turn = await runTurn(
            campaign,
            settings.explorer,
            explorerTurn(exactInput),
            { ...dependencies, signal },
            undefined,
            `${label}/agent`,
            label,
          );
          return roleCallOutput(explorerResult).parse({
            state: "succeeded",
            value: turn.value,
          });
        },
      );
      return roleCallOutput(explorerResult).parse(settled.output).value;
    },
    async coordinator(inputValue: unknown) {
      const input = coordinatorInput.parse(inputValue);
      const label = "elenx-solve/role/coordinator";
      const output = coordinatorResultFor(
        input.notes.map(({ id }) => id),
        input.findings.length,
      );
      const settled = await campaign.call(
        {
          label,
          role: "coordinator",
          request: jsonSnapshot(input),
          ...(dependencies.signal === undefined
            ? {}
            : { signal: dependencies.signal }),
        },
        async ({ request, signal }) => {
          const exactInput = coordinatorInput.parse(request);
          const turn = await runTurn(
            campaign,
            settings.coordinator,
            coordinatorTurn(exactInput),
            { ...dependencies, signal },
            undefined,
            `${label}/agent`,
            label,
          );
          return roleCallOutput(output).parse({
            state: "succeeded",
            value: turn.value,
          });
        },
      );
      return roleCallOutput(output).parse(settled.output).value;
    },
    async verifier(inputValue: unknown) {
      const input = verifierInput.parse(inputValue);
      acceptedCandidate = undefined;
      const label = "elenx-solve/role/verifier";
      const candidate = campaign.submitCandidate(roleCandidateMaterial(input), [
        label,
      ]);
      const settled = await campaign.call(
        {
          label,
          role: "verifier",
          candidate,
          request: jsonSnapshot(input),
          ...(dependencies.signal === undefined
            ? {}
            : { signal: dependencies.signal }),
        },
        async ({ request, signal }) => {
          const exactInput = verifierInput.parse(request);
          const implementations = createPiAuditors(
            campaign,
            settings.verifier,
            { ...dependencies, signal },
            candidate,
          );
          const result =
            await verifierFromAuditors(implementations)(exactInput);
          return verifierCallOutput.parse({
            state: "succeeded",
            value: result,
          });
        },
      );
      const result = verifierCallOutput.parse(settled.output).value;
      campaign.recordVerdict(
        settled.call,
        result.verdict === "ACCEPT" ? "PASS" : "FAIL",
        { report: result.report, candidateKind: input.candidateKind },
      );
      if (result.verdict === "ACCEPT") acceptedCandidate = candidate;
      return result;
    },
    acceptedCandidate() {
      return acceptedCandidate;
    },
  };
}

function jsonSnapshot(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function roleCandidateMaterial(input: VerifierInput): Uint8Array {
  const text = [
    input.answer.text,
    ...input.support.map(({ text }) => text),
  ].join("\n\n--- SUPPORT ---\n\n");
  return new TextEncoder().encode(text);
}
