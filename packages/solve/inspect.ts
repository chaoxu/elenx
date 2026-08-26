import { deriveCandidateStatus, openReader, type Entry } from "elenx";
import {
  derivePiSpend,
  piRequest,
  piRequestAttempts,
  piStoredResult,
} from "elenx/pi";

import {
  callActivity,
  candidateEnvelope,
  deliveryArtifact,
  parseCampaign,
} from "./exploration-protocol";
import { resolutionPresentationLabel, snapshot } from "./exploration";
import {
  sourceAuditRequest,
  sourceEventPrefix,
  sourceSearchResultFor,
} from "./verifiers/source-audit";

export { coordinatorState, type CoordinatorState } from "./runtime";

export interface InspectionOptions {
  readonly includeInputs?: boolean;
}

type ExplorationSnapshot = ReturnType<typeof snapshot>;

interface SemanticInspection {
  readonly phase: ExplorationSnapshot["phase"] | "projection-error";
  readonly claims?: ExplorationSnapshot["claims"];
  readonly routes?: ExplorationSnapshot["routes"];
  readonly explorations?: ExplorationSnapshot["explorations"];
  readonly admissionAudits?: ExplorationSnapshot["admissionAudits"];
  readonly deliveries?: ExplorationSnapshot["deliveries"];
  readonly projectionError?: string;
}

export function inspectCampaign(path: string, options: InspectionOptions = {}) {
  const reader = openReader(path);
  try {
    const records = reader.records();
    const observedAtMs = Date.now();
    const { declaration, task } = parseCampaign(records[0]);
    const candidateEntries = records.filter(
      (record): record is Extract<Entry, { kind: "candidate" }> =>
        record.kind === "candidate",
    );
    const classifiedCandidates = candidateEntries.map((entry) => ({
      entry,
      parsed: parseCandidateMaterial(reader.material(entry.seq)),
    }));
    const resolutionEntries = classifiedCandidates.filter(
      ({ parsed }) => parsed.kind === "resolution",
    );
    const deliveryEntries = classifiedCandidates.filter(
      ({ parsed }) => parsed.kind === "delivery",
    );
    const resolutionLabels = new Map(
      resolutionEntries.map(({ entry: { seq } }) => [
        seq,
        resolutionPresentationLabel(records, seq),
      ]),
    );
    const candidateKinds = new Map(
      classifiedCandidates.map(({ entry, parsed }) => [entry.seq, parsed.kind]),
    );
    const results = new Map(
      records
        .filter((record) => record.kind === "call-result")
        .map((record) => [record.parent, record]),
    );
    const toolResults = new Map(
      records
        .filter((record) => record.kind === "tool-result")
        .map((record) => [record.parent, record]),
    );
    const attempts = piRequestAttempts(records);
    const checkpointCalls = new Set(attempts.map(({ call }) => call));
    const calls = records.filter(
      (record): record is Extract<Entry, { kind: "call" }> =>
        record.kind === "call" && !checkpointCalls.has(record.seq),
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
      const parsedRequest = piRequest.safeParse(call.request);
      const request = parsedRequest.success ? parsedRequest.data : undefined;
      const parsedSourceRequest = sourceAuditRequest.safeParse(call.request);
      const sourceRequest = parsedSourceRequest.success
        ? parsedSourceRequest.data
        : undefined;
      const piResult =
        result?.state === "returned"
          ? piStoredResult.safeParse(result.output)
          : undefined;
      const parsedSourceResult =
        sourceRequest !== undefined && result?.state === "returned"
          ? sourceSearchResultFor(sourceRequest).safeParse(result.output)
          : undefined;
      const sourceResult = parsedSourceResult?.success
        ? parsedSourceResult.data
        : undefined;
      const sourceParseError =
        parsedSourceResult !== undefined && !parsedSourceResult.success
          ? parsedSourceResult.error.message
          : undefined;
      const activity = callActivity(call.label);
      return {
        seq: call.seq,
        label: call.label,
        role: sourceRequest === undefined ? activity.role : "source-audit",
        ...(sourceRequest === undefined
          ? activity.triggerCall === undefined
            ? {}
            : { triggerCall: activity.triggerCall }
          : { triggerCall: sourceRequest.offlineCall }),
        ...(activity.audit === undefined
          ? {}
          : {
              audit:
                sourceRequest === undefined
                  ? activity.audit
                  : {
                      ...activity.audit,
                      method: "premise-audit/source-resolution",
                    },
            }),
        startedAtMs: call.atMs,
        ...(result === undefined ? {} : { settledAtMs: result.atMs }),
        elapsedMs: Math.max(0, (result?.atMs ?? observedAtMs) - call.atMs),
        settlement: result?.state ?? "unsettled",
        ...(call.candidate === undefined
          ? {}
          : {
              candidate: call.candidate,
              candidateType: candidateKinds.get(call.candidate) ?? "unknown",
              ...(resolutionLabels.get(call.candidate) === undefined
                ? {}
                : { resolutionLabel: resolutionLabels.get(call.candidate) }),
            }),
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
            }),
        ...(piResult?.success
          ? {
              piState: piResult.data.state,
              ...(piResult.data.text === ""
                ? {}
                : { responseText: piResult.data.text }),
              ...(piResult.data.state === "succeeded"
                ? {}
                : {
                    error: piResult.data.error,
                    ...(piResult.data.state === "failed"
                      ? {
                          providerRetryable: piResult.data.providerRetryable,
                          truncated: piResult.data.truncated,
                        }
                      : {}),
                  }),
            }
          : {}),
        ...(sourceRequest === undefined
          ? {}
          : {
              sourceAudit: {
                model: sourceRequest.model,
                reasoning: sourceRequest.reasoning,
                state:
                  sourceResult?.state ??
                  (result === undefined
                    ? "unsettled"
                    : result.state === "returned"
                      ? "malformed"
                      : "failed"),
                ...(sourceResult?.codexVersion === undefined
                  ? {}
                  : { codexVersion: sourceResult.codexVersion }),
                ...(sourceResult?.state === "succeeded"
                  ? {
                      queries: sourceResult.parsed.queries,
                      usage: sourceResult.parsed.usage,
                    }
                  : sourceResult === undefined
                    ? sourceParseError === undefined
                      ? {}
                      : { error: sourceParseError }
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
                      sourceParseError !== undefined &&
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
          .filter((attempt) => attempt.parent === call.seq)
          .map(({ call: checkpoint, state }) => ({ checkpoint, state })),
        tools: records
          .filter(
            (record): record is Extract<Entry, { kind: "tool-call" }> =>
              record.kind === "tool-call" && record.call === call.seq,
          )
          .map((toolCall) => {
            const toolResult = toolResults.get(toolCall.seq);
            return {
              seq: toolCall.seq,
              name: toolCall.tool,
              input: toolCall.input,
              startedAtMs: toolCall.atMs,
              ...(toolResult === undefined
                ? {}
                : { settledAtMs: toolResult.atMs }),
              elapsedMs: Math.max(
                0,
                (toolResult?.atMs ?? observedAtMs) - toolCall.atMs,
              ),
              settlement: toolResult?.state ?? "unsettled",
              ...(toolResult?.state === "returned"
                ? { output: toolResult.output }
                : {}),
              ...(toolResult?.state === "threw"
                ? { error: toolResult.error }
                : {}),
            };
          }),
        ...(spendByCall.has(call.seq)
          ? { spend: spendByCall.get(call.seq) }
          : {}),
      };
    });
    const { semantic, resolutions: semanticResolutions } = semanticSnapshot(
      reader,
      task,
    );
    const shared = {
      observedAtMs,
      createdAtMs: declaration.atMs,
      lastAtMs: records.at(-1)?.atMs ?? declaration.atMs,
      protocol: task.protocol,
      problem: task.problem,
      completionCriteria: task.completionCriteria,
      lastSeq: records.at(-1)?.seq ?? declaration.seq,
      concurrency: concurrency(records, new Set(calls.map(({ seq }) => seq))),
      spend: {
        ...spend.summary,
        unaccountedCalls: spend.unaccountedCalls,
        potentialRequests: spend.potentialRequests.map(
          ({ call, checkpoint, model }) => ({
            call,
            checkpoint,
            model: {
              provider: model.provider,
              id: model.id,
              api: model.api,
            },
          }),
        ),
      },
      calls: callRows,
      resolutions: resolutionEntries.map(({ entry: candidate, parsed }) => {
        const feedback = semanticResolutions.find(
          ({ id }) => id === candidate.seq,
        );
        return {
          ...candidate,
          label: resolutionLabels.get(candidate.seq),
          content: parsed.value,
          status: deriveCandidateStatus(records, candidate.seq),
          ...(feedback === undefined ? {} : { feedback }),
        };
      }),
      deliveryCandidates: deliveryEntries.map(
        ({ entry: candidate, parsed }) => ({
          ...candidate,
          content: parsed.value,
          status: deriveCandidateStatus(records, candidate.seq),
        }),
      ),
      ...(options.includeInputs === true
        ? {
            requestAttempts: attempts,
          }
        : {}),
    };
    return {
      ...shared,
      ...semantic,
      memory: task.memory,
      maxContextTokens: task.maxContextTokens,
      guidance: task.guidance,
      profiles: {
        coordinator: publicProfile(task.coordinator),
        explorer: publicProfile(task.explorer),
        admissionAuditors: task.admissionAuditors.map(
          ({ name, ...profile }) => ({
            name,
            ...publicProfile(profile),
          }),
        ),
        resolutionAuditors: task.resolutionAuditors.map(
          ({ api, baseUrl, ...auditor }) => {
            void api;
            void baseUrl;
            return auditor;
          },
        ),
      },
    };
  } finally {
    reader.close();
  }
}

export function exportAnswer(path: string): Uint8Array {
  const reader = openReader(path);
  try {
    const records = reader.records();
    const { task } = parseCampaign(records[0]);
    const semantic = snapshot(reader, task);
    if (semantic.phase !== "solved" || semantic.solution === undefined) {
      throw new Error(
        "campaign has no strictly replayed v14 solution and delivery",
      );
    }
    const parsed = parseCandidateMaterial(
      reader.material(semantic.solution.delivery),
    );
    if (
      parsed.kind !== "delivery" ||
      parsed.value.resolution !== semantic.solution.resolution ||
      !deriveCandidateStatus(records, semantic.solution.resolution).verified ||
      !deriveCandidateStatus(records, semantic.solution.delivery).verified
    ) {
      throw new Error(
        "strict v14 solution and delivery contract is unsatisfied",
      );
    }
    return new TextEncoder().encode(parsed.value.answer);
  } finally {
    reader.close();
  }
}

function parseCandidateMaterial(bytes: Uint8Array):
  | {
      readonly kind: "resolution";
      readonly value: ReturnType<typeof candidateEnvelope.parse>;
    }
  | {
      readonly kind: "delivery";
      readonly value: ReturnType<typeof deliveryArtifact.parse>;
    }
  | { readonly kind: "unknown"; readonly value: string } {
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "unknown", value: text };
  }
  const resolution = candidateEnvelope.safeParse(value);
  if (resolution.success) return { kind: "resolution", value: resolution.data };
  const delivery = deliveryArtifact.safeParse(value);
  return delivery.success
    ? { kind: "delivery", value: delivery.data }
    : { kind: "unknown", value: text };
}

function semanticSnapshot(
  reader: Parameters<typeof snapshot>[0],
  task: Parameters<typeof snapshot>[1],
): {
  readonly semantic: SemanticInspection;
  readonly resolutions: ExplorationSnapshot["resolutions"];
} {
  try {
    const { resolutions, ...semantic } = snapshot(reader, task);
    return { semantic, resolutions };
  } catch (error) {
    return {
      semantic: {
        phase: "projection-error" as const,
        projectionError: error instanceof Error ? error.message : String(error),
      },
      resolutions: [],
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

function concurrency(records: readonly Entry[], calls: ReadonlySet<number>) {
  let active = 0;
  let peak = 0;
  for (const record of records) {
    if (record.kind === "call" && calls.has(record.seq)) {
      active += 1;
      peak = Math.max(peak, active);
    } else if (record.kind === "call-result" && calls.has(record.parent)) {
      active -= 1;
    }
  }
  return { active, peak, peakIsExact: active === 0 };
}

export type CampaignInspection = ReturnType<typeof inspectCampaign>;
