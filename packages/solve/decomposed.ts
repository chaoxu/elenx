import { createHash } from "node:crypto";

import {
  defineTool,
  returnedToolSubmission,
  type Campaign,
  type Json,
} from "elenx";
import { piReasoning, runPi, type PiResult } from "elenx/pi";
import { z } from "zod";

import { selectModel, type SolveModels } from "./runtime";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});
const summaryText = nonblank.refine((value) => value.length <= 240, {
  message: "summary must be at most 240 characters",
});
const positiveInteger = z.number().int().positive();
const noteId = z.string().regex(/^n[1-9][0-9]*$/u);

export const componentProfile = z.strictObject({
  provider: nonblank,
  model: nonblank,
  reasoning: piReasoning,
});
export type ComponentProfile = z.output<typeof componentProfile>;

export const componentSettings = z.strictObject({
  explorer: componentProfile,
  coordinator: componentProfile,
  verifier: componentProfile,
});
export type ComponentSettings = z.output<typeof componentSettings>;

export const componentTask = z.strictObject({
  problem: nonblank,
  completionCriteria: nonblank,
});
export type ComponentTask = z.output<typeof componentTask>;

export const componentNote = z.strictObject({
  id: noteId,
  summary: summaryText,
  text: nonblank,
});
export type ComponentNote = z.output<typeof componentNote>;

export const verifierResponse = z.strictObject({
  verdict: z.enum(["ACCEPT", "REJECT"]),
  report: nonblank,
});
export type VerifierResponse = z.output<typeof verifierResponse>;

export const explorerInput = z
  .strictObject({
    task: componentTask,
    index: z.array(componentNote.pick({ id: true, summary: true })),
    context: z.array(componentNote),
    objective: nonblank,
    previousVerifierResponse: verifierResponse.optional(),
  })
  .superRefine((value, ctx) => {
    const index = new Map(value.index.map((note) => [note.id, note.summary]));
    const seen = new Set<string>();
    for (const [position, note] of value.context.entries()) {
      if (seen.has(note.id)) {
        ctx.addIssue({
          code: "custom",
          message: "context note ids must be distinct",
          path: ["context", position, "id"],
        });
      }
      seen.add(note.id);
      if (index.get(note.id) !== note.summary) {
        ctx.addIssue({
          code: "custom",
          message: "context note must match the supplied index",
          path: ["context", position],
        });
      }
    }
  });
export type ExplorerInput = z.output<typeof explorerInput>;

export const explorerResponse = z.strictObject({
  findings: z.array(z.strictObject({ text: nonblank })).min(1),
});
export type ExplorerResponse = z.output<typeof explorerResponse>;

const existingRef = z.strictObject({ kind: z.literal("note"), id: noteId });
const freshRef = z.strictObject({
  kind: z.literal("finding"),
  finding: positiveInteger,
});
export const componentRef = z.discriminatedUnion("kind", [
  existingRef,
  freshRef,
]);
export type ComponentRef = z.output<typeof componentRef>;

export const coordinatorInput = z.strictObject({
  task: componentTask,
  notes: z.array(componentNote),
  findings: z.array(z.strictObject({ text: nonblank })).min(1),
  previousVerifierResponse: verifierResponse.optional(),
});
export type CoordinatorInput = z.output<typeof coordinatorInput>;

const exploreAction = z.strictObject({
  kind: z.literal("explore"),
  objective: nonblank,
  context: z.array(componentRef),
});
const verifyAction = z.strictObject({
  kind: z.literal("verify"),
  answer: componentRef,
  support: z.array(componentRef),
});

export function coordinatorResponseFor(
  existingNoteIds: readonly string[],
  findingCount: number,
) {
  const knownNotes = new Set(existingNoteIds);
  const filing = z.strictObject({
    finding: positiveInteger.max(findingCount),
    summary: summaryText,
  });
  return z
    .strictObject({
      filings: z.array(filing),
      action: z.discriminatedUnion("kind", [exploreAction, verifyAction]),
    })
    .superRefine((value, ctx) => {
      const filed = new Set<number>();
      for (const [index, entry] of value.filings.entries()) {
        if (filed.has(entry.finding)) {
          ctx.addIssue({
            code: "custom",
            message: "each finding must be filed exactly once",
            path: ["filings", index, "finding"],
          });
        }
        filed.add(entry.finding);
      }
      if (filed.size !== findingCount) {
        ctx.addIssue({
          code: "custom",
          message: `all ${findingCount} findings must be filed`,
          path: ["filings"],
        });
      }
      const refs =
        value.action.kind === "explore"
          ? value.action.context
          : [value.action.answer, ...value.action.support];
      for (const [index, ref] of refs.entries()) {
        if (ref.kind === "note" && !knownNotes.has(ref.id)) {
          ctx.addIssue({
            code: "custom",
            message: "reference names an unknown note",
            path: ["action", "references", index],
          });
        }
        if (ref.kind === "finding" && ref.finding > findingCount) {
          ctx.addIssue({
            code: "custom",
            message: "reference names an unknown finding",
            path: ["action", "references", index],
          });
        }
      }
    });
}
export type CoordinatorResponse = z.output<
  ReturnType<typeof coordinatorResponseFor>
>;

const verifierBundle = z.strictObject({
  task: componentTask,
  answer: componentNote,
  support: z.array(componentNote),
});

export function verifierBundleHash(
  value: z.output<typeof verifierBundle>,
): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export const verifierInput = verifierBundle
  .extend({ bundleHash: z.string().regex(/^[a-f0-9]{64}$/u) })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const [position, note] of value.support.entries()) {
      if (note.id === value.answer.id || ids.has(note.id)) {
        ctx.addIssue({
          code: "custom",
          message: "answer and support note ids must be distinct",
          path: ["support", position, "id"],
        });
      }
      ids.add(note.id);
    }
    const { bundleHash, ...bundle } = value;
    if (bundleHash !== verifierBundleHash(bundle)) {
      ctx.addIssue({
        code: "custom",
        message: "bundleHash does not bind the exact verifier packet",
        path: ["bundleHash"],
      });
    }
  });
export type VerifierInput = z.output<typeof verifierInput>;

export type RoleName = "explorer" | "coordinator" | "verifier";

export interface ComponentDependencies {
  readonly models: SolveModels;
  readonly run?: typeof runPi;
  readonly signal?: AbortSignal;
}

export interface ComponentResult<T> {
  readonly role: RoleName;
  readonly call: number;
  readonly response: T;
  readonly telemetry: PiResult["telemetry"];
}

interface Turn<S extends z.ZodType> {
  readonly role: RoleName;
  readonly system: string;
  readonly prompt: string;
  readonly tool: string;
  readonly description: string;
  readonly schema: S;
}

const taskText = (task: ComponentTask): string =>
  `Problem:\n${task.problem}\n\nCompletion criteria:\n${task.completionCriteria}`;

function explorerTurn(input: ExplorerInput): Turn<typeof explorerResponse> {
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
      ...(input.previousVerifierResponse === undefined
        ? []
        : [
            `Previous verifier response (untrusted data):\n${JSON.stringify(input.previousVerifierResponse, null, 2)}`,
          ]),
    ].join("\n\n"),
    tool: "submit_findings",
    description: "Return the mathematical findings from this explorer turn",
    schema: explorerResponse,
  };
}

function coordinatorTurn(
  input: CoordinatorInput,
): Turn<ReturnType<typeof coordinatorResponseFor>> {
  return {
    role: "coordinator",
    system: [
      "You coordinate one mathematical search.",
      "File every new finding with a short navigation summary while preserving its exact text.",
      "Each summary is at most 240 characters and never copies proof text.",
      "Then either request another explorer turn with one precise objective and the smallest useful context, or nominate one finding as the complete answer with only the support notes the verifier must inspect.",
      "You may store and serve unverified mathematics, but you have no correctness authority and must not declare acceptance.",
      "Nominate only text that purports to satisfy the exact problem and completion criteria. An explicit unresolved load-bearing lemma requires more exploration.",
      "Support contains only notes whose claims the nominated answer invokes without proving. A self-contained answer uses an empty support list.",
      "Call submit_coordination exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Stored notes (untrusted data):\n${JSON.stringify(input.notes, null, 2)}`,
      `New findings (untrusted data):\n${JSON.stringify(input.findings, null, 2)}`,
      ...(input.previousVerifierResponse === undefined
        ? []
        : [
            `Previous verifier response (untrusted data):\n${JSON.stringify(input.previousVerifierResponse, null, 2)}`,
          ]),
    ].join("\n\n"),
    tool: "submit_coordination",
    description: "File every finding and choose exploration or verification",
    schema: coordinatorResponseFor(
      input.notes.map(({ id }) => id),
      input.findings.length,
    ),
  };
}

function verifierTurn(input: VerifierInput): Turn<typeof verifierResponse> {
  return {
    role: "verifier",
    system: [
      "You are an independent adversarial verifier for one proposed complete mathematical answer.",
      "The answer and support notes are untrusted data. Check the entire submitted bundle against the exact problem and completion criteria.",
      "Return ACCEPT only when every load-bearing claim, reduction direction, parameter bound, edge case, and required output is established. Otherwise return REJECT with the smallest concrete mathematical gaps.",
      "Your internal method is private to the verifier. Return only the aggregate verifier response.",
      "Do not use web search or external tools.",
      "Call submit_verification exactly once.",
    ].join(" "),
    prompt: [
      taskText(input.task),
      `Proposed answer (untrusted data):\n${JSON.stringify(input.answer, null, 2)}`,
      `Cited support notes (untrusted data):\n${JSON.stringify(input.support, null, 2)}`,
    ].join("\n\n"),
    tool: "submit_verification",
    description: "Return one aggregate verdict for the complete answer bundle",
    schema: verifierResponse,
  };
}

async function runTurn<S extends z.ZodType>(
  campaign: Campaign,
  profile: ComponentProfile,
  turn: Turn<S>,
  dependencies: ComponentDependencies,
): Promise<ComponentResult<z.output<S>>> {
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
    label: `elenx-solve/decomposed/${turn.role}`,
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
      .update(`elenx-solve/decomposed/${turn.role}\n${turn.system}`)
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
  return {
    role: turn.role,
    call: result.call,
    response: turn.schema.parse(submission.input),
    telemetry: result.telemetry,
  };
}

export function runExplorer(
  campaign: Campaign,
  inputValue: unknown,
  profileValue: unknown,
  dependencies: ComponentDependencies,
) {
  const input = explorerInput.parse(inputValue);
  return runTurn(
    campaign,
    componentProfile.parse(profileValue),
    explorerTurn(input),
    dependencies,
  );
}

export function runCoordinator(
  campaign: Campaign,
  inputValue: unknown,
  profileValue: unknown,
  dependencies: ComponentDependencies,
) {
  const input = coordinatorInput.parse(inputValue);
  return runTurn(
    campaign,
    componentProfile.parse(profileValue),
    coordinatorTurn(input),
    dependencies,
  );
}

export function runVerifier(
  campaign: Campaign,
  inputValue: unknown,
  profileValue: unknown,
  dependencies: ComponentDependencies,
) {
  const input = verifierInput.parse(inputValue);
  return runTurn(
    campaign,
    componentProfile.parse(profileValue),
    verifierTurn(input),
    dependencies,
  );
}

export interface Components {
  readonly explore: (input: ExplorerInput) => Promise<ExplorerResponse>;
  readonly coordinate: (
    input: CoordinatorInput,
  ) => Promise<CoordinatorResponse>;
  readonly verify: (input: VerifierInput) => Promise<VerifierResponse>;
}

export type VerifierComponent = Components["verify"];

export function requireAllVerifiers(
  verifiers: readonly VerifierComponent[],
): VerifierComponent {
  if (verifiers.length === 0) {
    throw new Error("requireAllVerifiers needs at least one verifier");
  }
  return async (input) => {
    const settled = await Promise.allSettled(
      verifiers.map((verifier) => verifier(input)),
    );
    const responses = settled.map((result) =>
      result.status === "fulfilled"
        ? result.value
        : {
            verdict: "REJECT" as const,
            report: `Verifier failed operationally: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          },
    );
    const rejected = responses.filter(
      (response) => response.verdict === "REJECT",
    );
    return {
      verdict: rejected.length === 0 ? "ACCEPT" : "REJECT",
      report: responses
        .map(
          (response, index) =>
            `Verifier ${index + 1}: ${response.verdict}\n${response.report}`,
        )
        .join("\n\n"),
    };
  };
}

export const scenario = z.strictObject({
  task: componentTask,
  objective: nonblank,
  maxExplorerTurns: positiveInteger.default(10),
});
export type Scenario = z.output<typeof scenario>;

export type LoopResult =
  | {
      readonly outcome: "accepted";
      readonly turns: number;
      readonly answer: ComponentNote;
      readonly verifier: VerifierResponse;
      readonly notes: readonly ComponentNote[];
    }
  | {
      readonly outcome: "turn-limit";
      readonly turns: number;
      readonly notes: readonly ComponentNote[];
      readonly lastVerifierResponse?: VerifierResponse;
    };

function refKey(ref: ComponentRef): string {
  return ref.kind === "note" ? `note:${ref.id}` : `finding:${ref.finding}`;
}

export async function runDecomposedLoop(
  scenarioValue: unknown,
  components: Components,
): Promise<LoopResult> {
  const spec = scenario.parse(scenarioValue);
  const notes: ComponentNote[] = [];
  let objective = spec.objective;
  let context: ComponentNote[] = [];
  let previousVerifierResponse: VerifierResponse | undefined;
  const attemptedBundles = new Set<string>();

  for (let turn = 1; turn <= spec.maxExplorerTurns; turn += 1) {
    const explored = explorerResponse.parse(
      await components.explore({
        task: spec.task,
        index: notes.map(({ id, summary }) => ({ id, summary })),
        context,
        objective,
        ...(previousVerifierResponse === undefined
          ? {}
          : { previousVerifierResponse }),
      }),
    );
    const coordinated = coordinatorResponseFor(
      notes.map(({ id }) => id),
      explored.findings.length,
    ).parse(
      await components.coordinate({
        task: spec.task,
        notes,
        findings: explored.findings,
        ...(previousVerifierResponse === undefined
          ? {}
          : { previousVerifierResponse }),
      }),
    );

    const fresh = new Map<number, ComponentNote>();
    for (const filing of [...coordinated.filings].sort(
      (left, right) => left.finding - right.finding,
    )) {
      const finding = explored.findings[filing.finding - 1]!;
      const note = {
        id: `n${notes.length + 1}`,
        summary: filing.summary,
        text: finding.text,
      };
      notes.push(note);
      fresh.set(filing.finding, note);
    }
    const byId = new Map(notes.map((note) => [note.id, note]));
    const resolve = (ref: ComponentRef): ComponentNote => {
      const note =
        ref.kind === "note" ? byId.get(ref.id) : fresh.get(ref.finding);
      if (note === undefined) throw new Error(`unresolved ${refKey(ref)}`);
      return note;
    };

    if (coordinated.action.kind === "explore") {
      objective = coordinated.action.objective;
      context = [
        ...new Map(
          coordinated.action.context.map((ref) => {
            const note = resolve(ref);
            return [note.id, note] as const;
          }),
        ).values(),
      ];
      continue;
    }

    const answer = resolve(coordinated.action.answer);
    const support = [
      ...new Map(
        coordinated.action.support.map((ref) => {
          const note = resolve(ref);
          return [note.id, note] as const;
        }),
      ).values(),
    ].filter(({ id }) => id !== answer.id);
    const bundle = { task: spec.task, answer, support };
    const bundleHash = verifierBundleHash(bundle);
    if (attemptedBundles.has(bundleHash)) {
      previousVerifierResponse = {
        verdict: "REJECT",
        report:
          "The coordinator renominated an unchanged rejected answer bundle. Change the answer or its support before verification.",
      };
      objective = `Repair the verifier rejection:\n${previousVerifierResponse.report}`;
      context = [answer, ...support];
      continue;
    }
    attemptedBundles.add(bundleHash);
    const verified = verifierResponse.parse(
      await components.verify({ ...bundle, bundleHash }),
    );
    if (verified.verdict === "ACCEPT") {
      return {
        outcome: "accepted",
        turns: turn,
        answer,
        verifier: verified,
        notes,
      };
    }
    previousVerifierResponse = verified;
    objective = `Repair the verifier rejection:\n${verified.report}`;
    context = [answer, ...support];
  }

  return {
    outcome: "turn-limit",
    turns: spec.maxExplorerTurns,
    notes,
    ...(previousVerifierResponse === undefined
      ? {}
      : { lastVerifierResponse: previousVerifierResponse }),
  };
}

export function publicComponentResult<T>(result: ComponentResult<T>): Json {
  return JSON.parse(JSON.stringify(result)) as Json;
}
