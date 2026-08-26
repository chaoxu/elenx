import { deriveCandidateStatus, openReader, type Entry } from "elenx";
import {
  derivePiSpend,
  piRequest,
  piRequestAttempts,
  piStoredResult,
} from "elenx/pi";

import { callActivity, parseCampaign } from "./exploration-protocol";
import { snapshot } from "./exploration";
import {
  sourceCheckRequest,
  sourceEventPrefix,
  sourceCheckResultFor,
} from "./verifiers/source-check";

export { campaignState, type CampaignState } from "./runtime";

export interface InspectionOptions {
  readonly includeInputs?: boolean;
}

export function inspectCampaign(path: string, options: InspectionOptions = {}) {
  const reader = openReader(path);
  try {
    const records = reader.records();
    const observedAtMs = Date.now();
    const { declaration, task } = parseCampaign(records[0]);
    const semantic = semanticSnapshot(reader, task);
    const results = new Map(
      records
        .filter((entry) => entry.kind === "call-result")
        .map((entry) => [entry.parent, entry]),
    );
    const attempts = piRequestAttempts(records);
    const checkpointCalls = new Set(attempts.map(({ call }) => call));
    const calls = records.filter(
      (entry): entry is Extract<Entry, { kind: "call" }> =>
        entry.kind === "call" && !checkpointCalls.has(entry.seq),
    );
    const spend = derivePiSpend(records);
    const spendByCall = new Map(
      spend.calls.map(({ call, operations, ...summary }) => [
        call,
        { ...summary, operations },
      ]),
    );
    const callRows = calls.map((call) => {
      const result = results.get(call.seq);
      const parsedPi = piRequest.safeParse(call.request);
      const request = parsedPi.success ? parsedPi.data : undefined;
      const parsedSource = sourceCheckRequest.safeParse(call.request);
      const sourceRequest = parsedSource.success
        ? parsedSource.data
        : undefined;
      const parsedPiResult =
        result?.state === "returned"
          ? piStoredResult.safeParse(result.output)
          : undefined;
      const parsedSourceResult =
        sourceRequest !== undefined && result?.state === "returned"
          ? sourceCheckResultFor(sourceRequest).safeParse(result.output)
          : undefined;
      const sourceResult = parsedSourceResult?.success
        ? parsedSourceResult.data
        : undefined;
      const activity = callActivity(call.label);
      return {
        seq: call.seq,
        label: call.label,
        role: sourceRequest === undefined ? activity.role : "source-check",
        ...(activity.triggerCall === undefined
          ? sourceRequest === undefined
            ? {}
            : { triggerCall: sourceRequest.offlineCall }
          : { triggerCall: activity.triggerCall }),
        startedAtMs: call.atMs,
        ...(result === undefined ? {} : { settledAtMs: result.atMs }),
        elapsedMs: Math.max(0, (result?.atMs ?? observedAtMs) - call.atMs),
        settlement: result?.state ?? "unsettled",
        ...(call.candidate === undefined ? {} : { candidate: call.candidate }),
        ...(request === undefined
          ? {}
          : {
              model: {
                provider: request.model.provider,
                id: request.model.id,
                api: request.model.api,
              },
              ...(request.reasoning === undefined
                ? {}
                : { reasoning: request.reasoning }),
              ...(request.cacheKey === undefined
                ? {}
                : { cacheKey: request.cacheKey }),
            }),
        ...(parsedPiResult?.success
          ? {
              piState: parsedPiResult.data.state,
              ...(parsedPiResult.data.text === ""
                ? {}
                : { responseText: parsedPiResult.data.text }),
              ...(parsedPiResult.data.state === "succeeded"
                ? {}
                : { error: parsedPiResult.data.error }),
            }
          : {}),
        ...(sourceRequest === undefined
          ? {}
          : {
              sourceCheck: {
                model: sourceRequest.model,
                reasoning: sourceRequest.reasoning,
                premises: sourceRequest.premises.map(
                  ({ statement }) => statement,
                ),
                state:
                  sourceResult?.state ??
                  (result === undefined
                    ? "unsettled"
                    : result.state === "returned"
                      ? "malformed"
                      : "failed"),
                ...(sourceResult?.state === "succeeded"
                  ? {
                      codexVersion: sourceResult.codexVersion,
                      queries: sourceResult.parsed.queries,
                      usage: sourceResult.parsed.usage,
                    }
                  : sourceResult === undefined
                    ? {}
                    : { error: sourceResult.error }),
                ...(options.includeInputs === true && sourceResult !== undefined
                  ? {
                      events:
                        sourceResult.state === "succeeded"
                          ? sourceResult.parsed.events
                          : sourceEventPrefix(sourceResult.stdout).events,
                      stdout: sourceResult.stdout,
                      stderr: sourceResult.stderr,
                      ...(sourceResult.state === "succeeded"
                        ? { result: sourceResult.parsed.result }
                        : {}),
                    }
                  : options.includeInputs === true &&
                      parsedSourceResult !== undefined &&
                      !parsedSourceResult.success &&
                      result?.state === "returned"
                    ? { rawResult: result.output }
                    : {}),
              },
            }),
        ...(result?.state === "threw" ? { error: result.error } : {}),
        ...(options.includeInputs === true
          ? { request: call.request, declaredTools: call.tools }
          : {}),
        requestCheckpoints: attempts
          .filter(({ parent }) => parent === call.seq)
          .map((attempt) => ({
            checkpoint: attempt.call,
            state: attempt.state,
          })),
        tools: records
          .filter(
            (entry): entry is Extract<Entry, { kind: "tool-call" }> =>
              entry.kind === "tool-call" && entry.call === call.seq,
          )
          .map((entry) => ({ seq: entry.seq, tool: entry.tool })),
        spend: spendByCall.get(call.seq),
      };
    });
    const last = records.at(-1);
    return {
      protocol: task.protocol,
      problem: task.problem,
      completionCriteria: task.completionCriteria,
      maxContextTokens: task.maxContextTokens,
      maxHandoffTokens: task.maxHandoffTokens,
      guidance: task.guidance,
      profiles: {
        explorer: publicProfile(task.explorer),
        handoffVerifier: publicProfile(task.handoffVerifier),
        premiseVerifier: publicProfile(task.premiseVerifier),
        sourceChecker: task.sourceChecker,
        proofVerifier: publicProfile(task.proofVerifier),
      },
      createdAtMs: declaration.atMs,
      lastSeq: last?.seq ?? declaration.seq,
      lastAtMs: last?.atMs ?? declaration.atMs,
      observedAtMs,
      ...semantic,
      calls: callRows,
      spend: spend.summary,
      concurrency: concurrency(callRows),
    };
  } finally {
    reader.close();
  }
}

export function exportAnswer(path: string): Uint8Array {
  const reader = openReader(path);
  try {
    const task = parseCampaign(reader.records()[0]).task;
    const semantic = snapshot(reader, task);
    if (semantic.phase !== "solved" || semantic.solution === undefined) {
      throw new Error("campaign has no accepted v15 candidate");
    }
    if (!deriveCandidateStatus(reader.records(), semantic.solution).verified) {
      throw new Error("accepted candidate verifier contract is unsatisfied");
    }
    return reader.material(semantic.solution);
  } finally {
    reader.close();
  }
}

function semanticSnapshot(
  reader: Parameters<typeof snapshot>[0],
  task: Parameters<typeof snapshot>[1],
) {
  try {
    return snapshot(reader, task);
  } catch (error) {
    return {
      phase: "projection-error" as const,
      projectionError: error instanceof Error ? error.message : String(error),
      explorations: [],
      handoffs: [],
      candidates: [],
      solution: undefined,
    };
  }
}

function publicProfile(profile: {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
}) {
  return {
    provider: profile.provider,
    model: profile.model,
    reasoning: profile.reasoning,
  };
}

function concurrency(
  calls: readonly {
    readonly startedAtMs: number;
    readonly settledAtMs?: number;
  }[],
) {
  const events = calls.flatMap((call) => [
    { at: call.startedAtMs, delta: 1 },
    ...(call.settledAtMs === undefined
      ? []
      : [{ at: call.settledAtMs, delta: -1 }]),
  ]);
  events.sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return {
    active,
    peak,
    peakIsExact: calls.every(({ settledAtMs }) => settledAtMs !== undefined),
  };
}

export type CampaignInspection = ReturnType<typeof inspectCampaign>;
