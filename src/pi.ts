import {
  convertToLlm,
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
  type TSchema,
} from "@earendil-works/pi-ai";
import {
  createTypedSpanStarter,
  defineTelemetrySchema,
  InMemoryTelemetryContext,
  NOOP_TELEMETRY_CONTEXT,
  type RecordedTelemetrySpan,
} from "@earendil-works/pi-telemetry";
import { z } from "zod";

import { copyJson } from "./schemas";
import type { AuditedTool, Campaign, EntryId, Json, Tool } from "./types";

export { InMemoryCredentialStore } from "@earendil-works/pi-ai";
export { builtinModels as builtinPi } from "@earendil-works/pi-ai/providers/all";

type PiModels = Pick<Models, "streamSimple">;

export interface PiRunOptions {
  readonly models: PiModels;
  readonly model: Model<Api>;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
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

export interface PiTelemetry {
  readonly schemaVersions: {
    readonly "elenx.pi": 1;
    readonly "pi.ai": 1;
  };
  readonly spans: readonly RecordedTelemetrySpan[];
}

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

const requestSchema = z.strictObject({
  model: z.strictObject({
    provider: z.string().min(1),
    id: z.string().min(1),
    api: z.string().min(1),
  }),
  system: z.string().optional(),
  prompt: z.string(),
  stopAfterToolResult: z.literal(true).optional(),
});

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
    executionMode: "sequential",
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

function transcript(messages: readonly AgentMessage[]): readonly Json[] {
  return copyJson(JSON.parse(JSON.stringify(messages))) as readonly Json[];
}

function result(
  messages: readonly AgentMessage[],
  stopAfterToolResult: boolean,
  signal: AbortSignal | undefined,
): PiOutcome {
  const stored = transcript(messages);
  const final = [...messages]
    .reverse()
    .find(
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

function measuredStream(models: PiModels): StreamFn {
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
        const stream = models.streamSimple(model, context, {
          ...options,
          telemetryContext: span,
          onResponse: async (response, responseModel) => {
            httpStatus = response.status;
            await options?.onResponse?.(response, responseModel);
          },
        });
        const final = await stream.result();
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
  const parsed = requestSchema.parse({
    model: {
      provider: options.model?.provider,
      id: options.model?.id,
      api: options.model?.api,
    },
    ...(options.system === undefined ? {} : { system: options.system }),
    prompt: options.prompt,
    ...(options.stopAfterToolResult === true
      ? { stopAfterToolResult: true as const }
      : {}),
  });
  const request = copyJson(parsed);
  let completed: PiResultBody | undefined;
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
    async ({ request: recorded, tools, signal }) => {
      const exact = requestSchema.parse(recorded);
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
            },
            () => {},
            signal,
            measuredStream(options.models),
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
      completed = {
        ...body,
        telemetry: {
          schemaVersions: { "elenx.pi": 1, "pi.ai": 1 },
          spans: telemetry.getSpans(),
        },
      } satisfies PiResultBody;
      return completed;
    },
  );
  if (completed === undefined) throw new Error("Pi call returned no result");
  return { call: receipt.call, ...completed };
}
