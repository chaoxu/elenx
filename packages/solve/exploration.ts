import { isDeepStrictEqual } from "node:util";

import {
  createCampaign,
  defineTool,
  openCampaign,
  returnedToolSubmission,
  type Campaign,
  type EntryId,
} from "elenx";
import { builtinPi, runPi, type PiRunOptions } from "elenx/pi";
import { z } from "zod";

import {
  applicationId,
  parseCampaign,
  protocolName,
  settingsSchema,
  taskSchema,
  type GuidanceModule,
  type RuntimeProfile,
  type Settings,
  type Task,
} from "./exploration-protocol";
import {
  candidateVerifierLabels,
  foldCampaign,
  jsonSnapshot,
  phaseRole,
  type ModelPhase,
} from "./fold";
import {
  CallFailure,
  DEFAULT_CALL_FAILURE_RETRY,
  selectModel,
  withCampaignLock,
  type PreparedPiOptions,
  type SolveDependencies,
  type SolveModels,
} from "./runtime";
import {
  curationTurn,
  ensureContextFits,
  ensureSourceContextFits,
  explorerTurn,
  initialView,
  premiseTurn,
  serveTurn,
  triageTurn,
  verdictTurn,
  type StructuredCall,
} from "./turns";
import {
  runCodexSourceCheck,
  sourceCheckResultFor,
} from "./verifiers/source-check";

export const settings = settingsSchema;
export type { Settings } from "./exploration-protocol";

export interface Report {
  readonly outcome:
    "solved" | "paused" | "call-failure" | "interrupted" | "index-limit";
  readonly phase: string;
  readonly candidate?: EntryId;
  readonly call?: EntryId;
  readonly reason?: string;
}

const startRequest = z.strictObject({
  problem: z.string().min(1),
  completionCriteria: z.string().min(1),
  campaignPath: z.string().min(1),
  settings: settingsSchema,
});
const resumeRequest = z.strictObject({
  campaignPath: z.string().min(1),
  settings: settingsSchema,
});

const guidanceMeta =
  "Guidance changes exploration strategy, not verification or acceptance.";

function resolveGuidance(values: readonly string[]): GuidanceModule[] {
  return [
    { origin: "default", text: guidanceMeta },
    ...values.map((text) => ({ origin: "user" as const, text })),
  ];
}

function resolveProfile<P extends Settings["explorer"]>(
  models: SolveModels,
  profile: P,
): P & { readonly api: string; readonly baseUrl: string } {
  const model = selectModel(models, {
    provider: profile.provider,
    modelId: profile.model,
  });
  return { ...profile, api: model.api, baseUrl: model.baseUrl };
}

function freezeTask(
  request: z.output<typeof startRequest>,
  models: SolveModels,
): Task {
  const value = request.settings;
  return taskSchema.parse({
    protocol: protocolName,
    problem: request.problem,
    completionCriteria: request.completionCriteria,
    maxContextTokens: value.maxContextTokens,
    maxIndexTokens: value.maxIndexTokens,
    guidance: resolveGuidance(value.explorerGuidance),
    explorer: resolveProfile(models, value.explorer),
    curator: resolveProfile(models, value.curator),
    triage: resolveProfile(models, value.triage),
    verifier: resolveProfile(models, value.verifier),
    sourceChecker: value.sourceChecker,
  });
}

export async function start(
  input: z.input<typeof startRequest>,
  dependencies: SolveDependencies = {},
): Promise<Report> {
  const request = startRequest.parse(input);
  const models = dependencies.models ?? builtinPi();
  const task = freezeTask(request, models);
  ensureContextFits(task, explorerTurn(task, initialView()));
  return withCampaignLock(request.campaignPath, () => {
    const campaign = createCampaign(request.campaignPath, applicationId, task);
    return runCampaign(campaign, task, { ...dependencies, models });
  });
}

export async function resume(
  input: z.input<typeof resumeRequest>,
  dependencies: SolveDependencies = {},
): Promise<Report> {
  const request = resumeRequest.parse(input);
  const models = dependencies.models ?? builtinPi();
  return withCampaignLock(request.campaignPath, () => {
    const campaign = openCampaign(request.campaignPath);
    try {
      const task = parseCampaign(campaign.records()[0]).task;
      const frozen = freezeTask(
        {
          campaignPath: request.campaignPath,
          problem: task.problem,
          completionCriteria: task.completionCriteria,
          settings: request.settings,
        },
        models,
      );
      if (!isDeepStrictEqual(task, frozen)) {
        throw new Error("settings disagree with the frozen campaign settings");
      }
      return runCampaign(campaign, task, { ...dependencies, models });
    } catch (error) {
      campaign.close();
      throw error;
    }
  });
}

async function structuredTurn(
  campaign: Campaign,
  dependencies: SolveDependencies,
  options: Omit<
    PiRunOptions,
    "tools" | "stopAfterToolResult" | "system" | "prompt"
  >,
  turn: StructuredCall,
): Promise<void> {
  const tool = defineTool({
    name: turn.tool,
    description: turn.description,
    input: turn.schema,
    replay: "safe",
    async run() {
      return null;
    },
  });
  const result = await (dependencies.run ?? runPi)(campaign, {
    transport: "sse",
    ...options,
    system: turn.system,
    prompt: turn.prompt,
    tools: [tool],
    stopAfterToolResult: true,
    maxRecoveries: 1,
    maxLengthContinuations: 8,
  });
  if (result.state !== "succeeded") {
    throw new CallFailure(
      result.call,
      result.state,
      result.error,
      result.state === "failed" && result.providerRetryable,
    );
  }
  try {
    const submission = returnedToolSubmission(
      campaign.records(),
      result.call,
      turn.tool,
    );
    if (!turn.schema.safeParse(submission.input).success) {
      throw new Error("terminal submission failed schema validation");
    }
  } catch (error) {
    throw new CallFailure(
      result.call,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function executePhase(
  campaign: Campaign,
  task: Task,
  phase: ModelPhase,
  dependencies: SolveDependencies,
  prepare: (key: string, profile: RuntimeProfile) => PreparedPiOptions,
): Promise<void> {
  if (phase.kind === "note-source-check") {
    ensureSourceContextFits(task, phase.request);
    const receipt = await campaign.call(
      {
        label: phase.label,
        role: phaseRole(phase),
        ...(phase.candidate === undefined
          ? {}
          : { candidate: phase.candidate }),
        request: jsonSnapshot(phase.request),
        ...(dependencies.signal === undefined
          ? {}
          : { signal: dependencies.signal }),
      },
      async ({ signal }) => {
        try {
          return await (dependencies.sourceCheck ?? runCodexSourceCheck)(
            phase.request,
            signal,
          );
        } catch (error) {
          return {
            state: signal.aborted
              ? ("cancelled" as const)
              : ("failed" as const),
            stdout: "",
            stderr: "",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    const parsed = sourceCheckResultFor(phase.request).safeParse(
      receipt.output,
    );
    if (!parsed.success) {
      throw new CallFailure(receipt.call, "failed", parsed.error.message);
    }
    if (parsed.data.state !== "succeeded") {
      throw new CallFailure(receipt.call, parsed.data.state, parsed.data.error);
    }
    return;
  }
  const turn =
    phase.kind === "explorer"
      ? explorerTurn(task, phase.view)
      : phase.kind === "curation"
        ? curationTurn(task, phase.view)
        : phase.kind === "triage"
          ? triageTurn(task, phase.view)
          : phase.kind === "serve"
            ? serveTurn(task, phase.view)
            : phase.view.mode === "external-premises"
              ? premiseTurn(task, phase.view.text, phase.view.premises)
              : verdictTurn(task, phase.view);
  ensureContextFits(task, turn);
  const prepared = prepare(turn.key, turn.profile);
  await structuredTurn(
    campaign,
    dependencies,
    {
      ...prepared,
      label: phase.label,
      role: phaseRole(phase),
      ...(phase.kind === "verify" && phase.candidate !== undefined
        ? { candidate: phase.candidate }
        : {}),
      cacheKey: turn.cacheKey,
    },
    turn,
  );
}

async function interruptibleDelay(
  totalMs: number,
  dependencies: SolveDependencies,
): Promise<void> {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    if (dependencies.pauseRequested?.() || dependencies.signal?.aborted) return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1_000, until - Date.now())),
    );
  }
}

async function runCampaign(
  campaign: Campaign,
  task: Task,
  dependencies: SolveDependencies,
): Promise<Report> {
  const models = dependencies.models ?? builtinPi();
  const prepared = new Map<string, PreparedPiOptions>();
  const prepare = (key: string, profile: RuntimeProfile) => {
    const existing = prepared.get(key);
    if (existing !== undefined) return existing;
    const model = selectModel(models, {
      provider: profile.provider,
      modelId: profile.model,
    });
    if (model.api !== profile.api || model.baseUrl !== profile.baseUrl) {
      throw new Error(`${profile.provider}/${profile.model} runtime changed`);
    }
    const value = {
      models,
      model,
      reasoning: profile.reasoning,
      ...(dependencies.signal === undefined
        ? {}
        : { signal: dependencies.signal }),
    };
    prepared.set(key, value);
    return value;
  };
  let consecutiveFailures = 0;
  try {
    for (;;) {
      const phase = foldCampaign(campaign, task).phase;
      if (phase.kind === "solved") {
        return {
          outcome: "solved",
          phase: "solved",
          candidate: phase.candidate,
        };
      }
      if (phase.kind === "index-limit") {
        return {
          outcome: "index-limit",
          phase: "index-limit",
          reason: `index estimate ${phase.tokens} exceeds maxIndexTokens ${task.maxIndexTokens}`,
        };
      }
      if (phase.kind === "create-candidate") {
        campaign.submitCandidate(
          new TextEncoder().encode(phase.answer),
          candidateVerifierLabels(),
        );
        continue;
      }
      if (phase.kind === "record-verdict") {
        campaign.recordVerdict(phase.call, phase.verdict, phase.evidence);
        continue;
      }
      if (dependencies.pauseRequested?.()) {
        return { outcome: "paused", phase: phase.kind };
      }
      dependencies.status?.(phaseStatus(phase));
      try {
        await executePhase(campaign, task, phase, dependencies, prepare);
        consecutiveFailures = 0;
      } catch (error) {
        if (
          !(error instanceof CallFailure) ||
          error.state !== "failed" ||
          !error.providerRetryable
        ) {
          throw error;
        }
        const retry =
          dependencies.callFailureRetry ?? DEFAULT_CALL_FAILURE_RETRY;
        consecutiveFailures += 1;
        if (consecutiveFailures >= retry.attempts) throw error;
        const delayMs =
          consecutiveFailures === 1
            ? 0
            : Math.min(
                retry.baseDelayMs * 2 ** (consecutiveFailures - 2),
                retry.maxDelayMs,
              );
        dependencies.status?.(
          `call ${error.call} failed (${error.message}); retrying in ${delayMs / 1000}s`,
        );
        await interruptibleDelay(delayMs, dependencies);
      }
    }
  } catch (error) {
    const phase = foldCampaign(campaign, task).phase;
    if (phase.kind === "solved") {
      return { outcome: "solved", phase: "solved", candidate: phase.candidate };
    }
    if (error instanceof CallFailure) {
      return {
        outcome: error.state === "cancelled" ? "interrupted" : "call-failure",
        phase: phase.kind,
        call: error.call,
        reason: error.message,
      };
    }
    if (dependencies.signal?.aborted) {
      return {
        outcome: "interrupted",
        phase: phase.kind,
        reason: "operator interruption",
      };
    }
    throw error;
  } finally {
    campaign.close();
  }
}

function phaseStatus(phase: ModelPhase): string {
  if (phase.kind === "explorer") {
    return `exploration (index ~${phase.indexTokens} tokens)`;
  }
  if (phase.kind === "curation") return "curation";
  if (phase.kind === "triage") return "triage";
  if (phase.kind === "verify") {
    return phase.candidate === undefined
      ? `verify ${phase.view.note} (${phase.view.mode})`
      : `boundary verify ${phase.view.note} (${phase.view.mode})`;
  }
  if (phase.kind === "note-source-check") {
    return phase.candidate === undefined
      ? `verify ${phase.note} (external-premises: sources)`
      : `boundary verify ${phase.note} (external-premises: sources)`;
  }
  return "serve";
}
