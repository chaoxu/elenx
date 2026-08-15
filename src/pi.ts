import {
  AI_TELEMETRY_SCHEMA,
  convertToLlm,
  createTypedSpanStarter,
  defineTelemetrySchema,
  InMemoryTelemetryContext,
  NOOP_TELEMETRY_CONTEXT,
  runAgentLoop,
  startAiSpan,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  contentText,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  type TSchema,
} from "@earendil-works/pi-ai";
import { z } from "zod";

import { copyJson, entryId, json } from "./schemas";
import type {
  AuditedTool,
  Campaign,
  Entry,
  EntryId,
  Json,
  Tool,
} from "./types";

export { InMemoryCredentialStore } from "@earendil-works/pi-ai";
export { builtinModels as builtinPi } from "@earendil-works/pi-ai/providers/all";

type PiModels = Pick<Models, "streamSimple">;
const reasoningLevels = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[];
export const piReasoning = z.enum(reasoningLevels);

export interface PiRunOptions {
  readonly models: PiModels;
  readonly model: Model<Api>;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly reasoning?: ThinkingLevel;
  readonly candidate?: EntryId;
  readonly tools?: readonly Tool[];
  readonly stopAfterToolResult?: true;
  readonly signal?: AbortSignal;
}

type PiOutcome = {
  readonly transcript: readonly Json[];
  readonly text: string;
} & (
  | { readonly state: "succeeded" }
  | {
      readonly state: "failed" | "cancelled";
      readonly error: string;
    }
);

type PiResultBody = PiOutcome & { readonly telemetry: PiTelemetry };

export type PiResult = PiResultBody & { readonly call: EntryId };

export const ELENX_PI_TELEMETRY_SCHEMA = defineTelemetrySchema({
  version: 1,
  spans: {
    "elenx.pi.run": {
      description: "One Pi agent loop inside an Elenx logical call.",
      parents: { kind: "root_or_external" },
      startAttributes: {
        "elenx.call.label": {
          type: "string",
          required: true,
          cardinality: "high",
          description: "Application-defined reason for the call.",
        },
        "elenx.candidate": {
          type: "number",
          required: false,
          cardinality: "high",
          description: "Candidate sequence when the call evaluates one.",
        },
        "elenx.pi.reasoning.requested": {
          type: "string",
          required: false,
          values: reasoningLevels,
          cardinality: "low",
          description:
            "Pi reasoning level requested for every turn in the loop.",
        },
      },
      endAttributes: {
        "elenx.pi.outcome": {
          type: "string",
          values: ["succeeded", "failed", "cancelled"],
          cardinality: "low",
          description: "Normalized result of the complete Pi loop.",
        },
      },
      events: {},
      status: {
        default: "ok",
        errorWhen: "The loop fails, is cancelled, or throws.",
      },
    },
  },
} as const);

export const PI_TELEMETRY_SCHEMA_VERSIONS = {
  "elenx.pi": ELENX_PI_TELEMETRY_SCHEMA.version,
  "pi.ai": AI_TELEMETRY_SCHEMA.version,
} as const;

const telemetryAttribute = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()).readonly(),
  z.array(z.number()).readonly(),
  z.array(z.boolean()).readonly(),
  z.undefined(),
]);
const telemetryAttributes = z.record(z.string(), telemetryAttribute).readonly();
const telemetryStatus = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok") }),
  z.strictObject({
    status: z.literal("error"),
    error: z.strictObject({ name: z.string(), message: z.string() }).optional(),
  }),
]);
const telemetrySpan = z
  .strictObject({
    id: z.number().int().positive(),
    parentId: z.number().int().positive().nullable(),
    name: z.string(),
    attributes: telemetryAttributes,
    events: z
      .array(
        z.strictObject({ name: z.string(), attributes: telemetryAttributes }),
      )
      .readonly(),
    status: telemetryStatus,
    settled: z.boolean(),
    endSequence: z.number().int().positive().optional(),
  })
  .readonly();

export const piTelemetry = z
  .strictObject({
    schemaVersions: z
      .strictObject({
        "elenx.pi": z.literal(PI_TELEMETRY_SCHEMA_VERSIONS["elenx.pi"]),
        "pi.ai": z.literal(PI_TELEMETRY_SCHEMA_VERSIONS["pi.ai"]),
      })
      .readonly(),
    spans: z.array(telemetrySpan).readonly(),
  })
  .readonly();

export type PiTelemetry = z.output<typeof piTelemetry>;

const piModel = z.strictObject({
  provider: z.string().min(1),
  id: z.string().min(1),
  api: z.string().min(1),
});

export const piRequest = z.strictObject({
  model: piModel,
  system: z.string().optional(),
  prompt: z.string(),
  reasoning: piReasoning.optional(),
  stopAfterToolResult: z.literal(true).optional(),
});

const piRequestLabel = "elenx/pi-request";
const piRequestAttempt = z.strictObject({
  protocol: z.literal("pi"),
  parent: entryId,
  model: piModel,
  payload: json,
});

export type PiRequestAttempt = z.output<typeof piRequestAttempt> & {
  readonly call: EntryId;
} & ({ readonly state: "completed" } | { readonly state: "unsettled" });

export function piRequestAttempts(
  entries: readonly Entry[],
  parent?: EntryId,
): readonly PiRequestAttempt[] {
  const selected = parent === undefined ? undefined : entryId.parse(parent);
  const calls = new Map(
    entries
      .filter((entry) => entry.kind === "call")
      .map((entry) => [entry.seq, entry]),
  );
  const results = new Map(
    entries
      .filter((entry) => entry.kind === "call-result")
      .map((entry) => [entry.parent, entry]),
  );
  return [...calls.values()].flatMap((call) => {
    if (call.label !== piRequestLabel) return [];
    const parsed = piRequestAttempt.safeParse(call.request);
    if (!parsed.success) return [];
    const attempt = parsed.data;
    if (selected !== undefined && attempt.parent !== selected) return [];
    const owner = calls.get(attempt.parent);
    if (
      owner === undefined ||
      owner.seq >= call.seq ||
      !piRequest.safeParse(owner.request).success
    ) {
      throw new Error(`invalid Pi request checkpoint call ${call.seq}`);
    }
    const settled = results.get(call.seq);
    const state =
      settled?.state === "returned"
        ? ({ state: "completed" } as const)
        : ({ state: "unsettled" } as const);
    return [{ call: call.seq, ...attempt, ...state }];
  });
}

export const piStoredResult = z.object({
  state: z.enum(["succeeded", "failed", "cancelled"]),
  text: z.string(),
  error: z.string().optional(),
  telemetry: piTelemetry.optional(),
});

const nonnegative = z.number().finite().nonnegative();
const stopReason = z.enum([
  "stop",
  "length",
  "tool_use",
  "error",
  "aborted",
  "deferred",
]);
const requestAttributes = z.object({
  "pi.ai.provider": z.string().min(1),
  "pi.ai.model": z.string().min(1),
  "pi.ai.api": z.string().min(1),
  "pi.ai.response.model": z.string().min(1).optional(),
  "pi.ai.response.stop_reason": stopReason.optional(),
});
const usageAttributes = z
  .object({
    "pi.ai.usage.input_tokens": nonnegative,
    "pi.ai.usage.output_tokens": nonnegative,
    "pi.ai.usage.cache_read_tokens": nonnegative,
    "pi.ai.usage.cache_write_tokens": nonnegative,
    "pi.ai.usage.total_tokens": nonnegative,
    "pi.ai.usage.cost": nonnegative,
    "pi.ai.usage.reasoning_tokens": nonnegative.optional(),
  })
  .transform((usage) => ({
    input: usage["pi.ai.usage.input_tokens"],
    output: usage["pi.ai.usage.output_tokens"],
    cacheRead: usage["pi.ai.usage.cache_read_tokens"],
    cacheWrite: usage["pi.ai.usage.cache_write_tokens"],
    totalTokens: usage["pi.ai.usage.total_tokens"],
    estimatedCostUsd: usage["pi.ai.usage.cost"],
    ...(usage["pi.ai.usage.reasoning_tokens"] === undefined
      ? {}
      : { reasoning: usage["pi.ai.usage.reasoning_tokens"] }),
  }));
const usageKeys = [
  "pi.ai.usage.input_tokens",
  "pi.ai.usage.output_tokens",
  "pi.ai.usage.cache_read_tokens",
  "pi.ai.usage.cache_write_tokens",
  "pi.ai.usage.total_tokens",
  "pi.ai.usage.cost",
] as const;

export type PiMeasuredUsage = z.output<typeof usageAttributes>;

export interface PiSpendOperation {
  readonly provider: string;
  readonly requestedModel: string;
  readonly servedModel?: string;
  readonly api: string;
  readonly stopReason?: z.output<typeof stopReason>;
  readonly error: boolean;
  readonly usage: PiMeasuredUsage | null;
}

export type PiSpendScope =
  | { readonly call: EntryId; readonly candidate?: never }
  | { readonly candidate: EntryId; readonly call?: never };

function measuredUsage(
  attributes: Record<string, unknown>,
): PiMeasuredUsage | null {
  const present = usageKeys.filter((key) => attributes[key] !== undefined);
  const reasoning = attributes["pi.ai.usage.reasoning_tokens"] !== undefined;
  if (present.length === 0 && !reasoning) return null;
  if (present.length !== usageKeys.length) {
    throw new Error("partial Pi usage measurement");
  }
  return usageAttributes.parse(attributes);
}

function spendSummary(operations: readonly PiSpendOperation[]) {
  const measured = operations.flatMap(({ usage }) =>
    usage === null ? [] : [usage],
  );
  const sum = (key: keyof Omit<PiMeasuredUsage, "reasoning">) =>
    measured.reduce((total, usage) => total + usage[key], 0);
  const summary = {
    logicalProviderRequests: operations.length,
    requestErrors: operations.filter(({ error }) => error).length,
    unmeasuredRequests: operations.length - measured.length,
  };
  if (measured.length === 0) return summary;
  const completeReasoning = measured.every(
    ({ reasoning }) => reasoning !== undefined,
  );
  return {
    ...summary,
    measuredUsage: {
      input: sum("input"),
      output: sum("output"),
      cacheRead: sum("cacheRead"),
      cacheWrite: sum("cacheWrite"),
      totalTokens: sum("totalTokens"),
      estimatedCostUsd: sum("estimatedCostUsd"),
      ...(completeReasoning
        ? {
            reasoning: measured.reduce(
              (total, usage) => total + usage.reasoning!,
              0,
            ),
          }
        : {}),
    },
  };
}

export type PiSpendSummary = ReturnType<typeof spendSummary>;

export function derivePiSpend(entries: readonly Entry[], scope?: PiSpendScope) {
  if (scope !== undefined && "call" in scope && "candidate" in scope) {
    throw new Error("Pi spend scope selects either call or candidate");
  }
  const selectedCall =
    scope !== undefined && "call" in scope
      ? entryId.parse(scope.call)
      : undefined;
  const selectedCandidate =
    scope !== undefined && "candidate" in scope
      ? entryId.parse(scope.candidate)
      : undefined;
  const calls = entries.filter(
    (item): item is Extract<Entry, { kind: "call" }> =>
      item.kind === "call" &&
      piRequest.safeParse(item.request).success &&
      (selectedCall === undefined || item.seq === selectedCall) &&
      (selectedCandidate === undefined || item.candidate === selectedCandidate),
  );
  if (selectedCall !== undefined && calls.length !== 1)
    throw new Error(`Pi call not found: ${selectedCall}`);
  const results = new Map(
    entries
      .filter((item) => item.kind === "call-result")
      .map((item) => [item.parent, item]),
  );
  const accounted = [] as (PiSpendSummary & {
    call: EntryId;
    operations: PiSpendOperation[];
  })[];
  const unaccountedCalls: EntryId[] = [];
  for (const call of calls) {
    const result = results.get(call.seq);
    if (result?.state !== "returned") {
      unaccountedCalls.push(call.seq);
      continue;
    }
    const stored = piStoredResult.parse(result.output);
    if (stored.telemetry === undefined) {
      unaccountedCalls.push(call.seq);
      continue;
    }
    const { spans } = stored.telemetry;
    if (new Set(spans.map(({ id }) => id)).size !== spans.length)
      throw new Error(`duplicate Pi telemetry span in call ${call.seq}`);
    const roots = spans.filter(
      ({ name, parentId }) => name === "elenx.pi.run" && parentId === null,
    );
    if (roots.length !== 1 || !roots[0]!.settled)
      throw new Error(`invalid Pi telemetry root in call ${call.seq}`);
    const operations = spans.flatMap((span): PiSpendOperation[] => {
      if (span.name !== "pi.ai.request" || span.parentId !== roots[0]!.id)
        return [];
      if (!span.settled)
        throw new Error(`unsettled Pi request span in call ${call.seq}`);
      const attributes = requestAttributes.parse(span.attributes);
      return [
        {
          provider: attributes["pi.ai.provider"],
          requestedModel: attributes["pi.ai.model"],
          ...(attributes["pi.ai.response.model"] === undefined
            ? {}
            : { servedModel: attributes["pi.ai.response.model"] }),
          api: attributes["pi.ai.api"],
          ...(attributes["pi.ai.response.stop_reason"] === undefined
            ? {}
            : { stopReason: attributes["pi.ai.response.stop_reason"] }),
          error: span.status.status === "error",
          usage: measuredUsage(span.attributes),
        },
      ];
    });
    accounted.push({ call: call.seq, operations, ...spendSummary(operations) });
  }
  const potentialRequests = unaccountedCalls.flatMap((call) =>
    piRequestAttempts(entries, call).flatMap((attempt) =>
      attempt.state === "completed"
        ? [{ call, checkpoint: attempt.call, model: attempt.model }]
        : [],
    ),
  );
  return {
    calls: accounted,
    unaccountedCalls,
    potentialRequests,
    summary: spendSummary(accounted.flatMap(({ operations }) => operations)),
  };
}

export type PiSpend = ReturnType<typeof derivePiSpend>;

function piTool(
  tool: AuditedTool,
  stopAfterToolResult: boolean,
): AgentTool<TSchema, Json> {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as TSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(id, input) {
      const output = await tool.execute(input, id);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        details: output,
        ...(stopAfterToolResult ? { terminate: true } : {}),
      };
    },
  };
}

function jsonSnapshot(value: unknown): Json {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Pi value is not JSON");
  return JSON.parse(encoded) as Json;
}

function result(
  messages: readonly AgentMessage[],
  stopAfterToolResult: boolean,
  signal: AbortSignal | undefined,
): PiOutcome {
  const stored = jsonSnapshot(messages) as readonly Json[];
  const final = messages.findLast(
    (message): message is AssistantMessage => message.role === "assistant",
  );
  const text = final === undefined ? "" : contentText(final.content);
  if (signal?.aborted || final?.stopReason === "aborted") {
    return {
      state: "cancelled",
      text,
      transcript: stored,
      error: final?.errorMessage ?? "Pi call was cancelled",
    };
  }
  const last = messages.at(-1);
  const stoppedAfterTool =
    stopAfterToolResult &&
    final?.stopReason === "toolUse" &&
    last?.role === "toolResult" &&
    !last.isError;
  if (
    final === undefined ||
    (final.stopReason !== "stop" && !stoppedAfterTool)
  ) {
    return {
      state: "failed",
      text,
      transcript: stored,
      error:
        final?.errorMessage ??
        (final === undefined
          ? "Pi returned no assistant message"
          : `Pi stopped with ${final.stopReason}`),
    };
  }
  return { state: "succeeded", text, transcript: stored };
}

function telemetryStopReason(
  value: AssistantMessage["stopReason"],
): "stop" | "length" | "tool_use" | "error" | "aborted" | "deferred" {
  if (value === "toolUse") return "tool_use";
  return value === "pending" ? "error" : value;
}

function measuredStream(
  campaign: Campaign,
  parent: EntryId,
  models: PiModels,
): StreamFn {
  return (model, context, options) =>
    startAiSpan(
      options?.telemetryContext ?? NOOP_TELEMETRY_CONTEXT,
      "pi.ai.request",
      {
        "pi.ai.operation": "stream",
        "pi.ai.provider": model.provider,
        "pi.ai.model": model.id,
        "pi.ai.api": model.api,
        "pi.ai.streaming": true,
      },
      async (span) => {
        let httpStatus: number | undefined;
        let hookCalls = 0;
        let checkpointed = false;
        const stream = models.streamSimple(model, context, {
          ...options,
          telemetryContext: span,
          onPayload: async (payload, requestModel) => {
            hookCalls += 1;
            if (hookCalls !== 1) {
              throw new Error(
                "Pi adapter must invoke onPayload exactly once per request",
              );
            }
            const replacement = await options?.onPayload?.(
              payload,
              requestModel,
            );
            const effective = replacement === undefined ? payload : replacement;
            const snapshot = jsonSnapshot(effective);
            await campaign.call(
              {
                label: piRequestLabel,
                request: {
                  protocol: "pi",
                  parent,
                  model: {
                    provider: requestModel.provider,
                    id: requestModel.id,
                    api: requestModel.api,
                  },
                  payload: snapshot,
                },
              },
              async () => null,
            );
            checkpointed = true;
            return effective;
          },
          onResponse: async (response, responseModel) => {
            httpStatus = response.status;
            await options?.onResponse?.(response, responseModel);
          },
        });
        const final = await stream.result();
        const failedBeforeCheckpoint =
          hookCalls <= 1 &&
          !checkpointed &&
          (final.stopReason === "error" || final.stopReason === "aborted");
        if ((hookCalls !== 1 || !checkpointed) && !failedBeforeCheckpoint) {
          throw new Error(
            "Pi adapter must invoke onPayload exactly once per request",
          );
        }
        const hasUsage = [
          final.usage.input,
          final.usage.output,
          final.usage.cacheRead,
          final.usage.cacheWrite,
          final.usage.totalTokens,
        ].some((value) => value !== 0);
        span.setAttributes({
          ...(final.responseModel === undefined
            ? {}
            : { "pi.ai.response.model": final.responseModel }),
          ...(final.responseId === undefined
            ? {}
            : { "pi.ai.response.id": final.responseId }),
          "pi.ai.response.stop_reason": telemetryStopReason(final.stopReason),
          ...(httpStatus === undefined
            ? {}
            : { "pi.ai.http.status_code": httpStatus }),
          ...(hasUsage
            ? {
                "pi.ai.usage.input_tokens": final.usage.input,
                "pi.ai.usage.output_tokens": final.usage.output,
                "pi.ai.usage.cache_read_tokens": final.usage.cacheRead,
                "pi.ai.usage.cache_write_tokens": final.usage.cacheWrite,
                ...(final.usage.reasoning === undefined
                  ? {}
                  : {
                      "pi.ai.usage.reasoning_tokens": final.usage.reasoning,
                    }),
                "pi.ai.usage.total_tokens": final.usage.totalTokens,
                "pi.ai.usage.cost": final.usage.cost.total,
              }
            : {}),
        });
        if (final.stopReason === "error" || final.stopReason === "aborted") {
          span.setStatus({
            status: "error",
            error: {
              name:
                final.stopReason === "aborted" ? "AbortError" : "ProviderError",
              message: final.errorMessage ?? `Pi request ${final.stopReason}`,
            },
          });
        }
        return stream;
      },
    );
}

export async function runPi(
  campaign: Campaign,
  options: PiRunOptions,
): Promise<PiResult> {
  if (typeof options.models?.streamSimple !== "function") {
    throw new TypeError("Pi models must provide streamSimple");
  }
  const parsed = piRequest.parse({
    model: {
      provider: options.model?.provider,
      id: options.model?.id,
      api: options.model?.api,
    },
    ...(options.system === undefined ? {} : { system: options.system }),
    prompt: options.prompt,
    ...(options.reasoning === undefined
      ? {}
      : { reasoning: options.reasoning }),
    ...(options.stopAfterToolResult === true
      ? { stopAfterToolResult: true as const }
      : {}),
  });
  const request = copyJson(parsed);
  const receipt = await campaign.call(
    {
      label: options.label,
      ...(options.candidate === undefined
        ? {}
        : { candidate: options.candidate }),
      request,
      ...(options.tools === undefined ? {} : { tools: options.tools }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    async ({ call, request: recorded, tools, signal }) => {
      const exact = piRequest.parse(recorded);
      const telemetry = new InMemoryTelemetryContext();
      const startSpan = createTypedSpanStarter(telemetry, [
        ELENX_PI_TELEMETRY_SCHEMA,
      ]);
      const body = await startSpan(
        "elenx.pi.run",
        {
          "elenx.call.label": options.label,
          ...(options.candidate === undefined
            ? {}
            : { "elenx.candidate": options.candidate }),
          ...(exact.reasoning === undefined
            ? {}
            : { "elenx.pi.reasoning.requested": exact.reasoning }),
        },
        async (span) => {
          const messages = await runAgentLoop(
            [{ role: "user", content: exact.prompt, timestamp: Date.now() }],
            {
              systemPrompt: exact.system ?? "",
              messages: [],
              ...(tools.length === 0
                ? {}
                : {
                    tools: tools.map((tool) =>
                      piTool(tool, exact.stopAfterToolResult === true),
                    ),
                  }),
            },
            {
              model: options.model,
              convertToLlm,
              toolExecution: "sequential",
              telemetryContext: span,
              ...(exact.reasoning === undefined
                ? {}
                : { reasoning: exact.reasoning }),
            },
            () => {},
            signal,
            measuredStream(campaign, call, options.models),
          );
          const outcome = result(
            messages,
            exact.stopAfterToolResult === true,
            signal,
          );
          span.setAttributes({
            "elenx.pi.outcome": outcome.state,
          });
          if (outcome.state !== "succeeded") {
            span.setStatus({
              status: "error",
              error: { name: "PiRunError", message: outcome.error },
            });
          }
          return outcome;
        },
      );
      return {
        ...body,
        telemetry: {
          schemaVersions: PI_TELEMETRY_SCHEMA_VERSIONS,
          spans: telemetry.getSpans(),
        },
      } satisfies PiResultBody;
    },
  );
  return { call: receipt.call, ...(receipt.output as unknown as PiResultBody) };
}
