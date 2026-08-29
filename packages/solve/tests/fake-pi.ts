import type { Json } from "elenx";
import {
  PI_TELEMETRY_SCHEMA_VERSIONS,
  type PiRunOptions,
  type PiTelemetry,
} from "elenx/pi";

type Outcome = "succeeded" | "failed" | "cancelled";

export function fakePiRequest(options: PiRunOptions): Json {
  const request = {
    protocol: "elenx/pi-run/v1",
    model: {
      provider: options.model.provider,
      id: options.model.id,
      api: options.model.api,
      baseUrl: options.model.baseUrl,
    },
    modelProfile: {
      reasoning: options.model.reasoning,
      thinkingLevelMap: options.model.thinkingLevelMap ?? null,
      contextWindow: options.model.contextWindow,
      maxTokens: options.model.maxTokens,
      samplingParams: options.model.samplingParams ?? null,
      compat: options.model.compat ?? null,
    },
    // The JSON round-trip below drops undefined-valued fields, matching the
    // omit-when-absent shape of real journaled requests.
    system: options.system,
    prompt: options.prompt,
    reasoning: options.reasoning,
    stopAfterToolResult: options.stopAfterToolResult,
    maxRecoveries: options.maxRecoveries,
    maxLengthContinuations: options.maxLengthContinuations,
    cacheKey: options.cacheKey,
  };
  return JSON.parse(JSON.stringify(request)) as Json;
}

export function fakePiTelemetry(
  options: PiRunOptions,
  outcome: Outcome,
): PiTelemetry {
  const stopped =
    outcome === "succeeded"
      ? ("stop" as const)
      : outcome === "cancelled"
        ? ("aborted" as const)
        : ("error" as const);
  return {
    schemaVersions: PI_TELEMETRY_SCHEMA_VERSIONS,
    spans: [
      {
        id: 1,
        parentId: null,
        name: "elenx.pi.run",
        attributes: {
          "elenx.call.label": options.label,
          "elenx.pi.outcome": outcome,
          ...(options.reasoning === undefined
            ? {}
            : { "elenx.pi.reasoning.requested": options.reasoning }),
        },
        events: [],
        status: { status: outcome === "succeeded" ? "ok" : "error" },
        settled: true,
        endSequence: 2,
      },
      {
        id: 2,
        parentId: 1,
        name: "pi.ai.request",
        attributes: {
          "pi.ai.provider": options.model.provider,
          "pi.ai.model": options.model.id,
          "pi.ai.api": options.model.api,
          "pi.ai.response.stop_reason": stopped,
        },
        events: [],
        status: { status: outcome === "succeeded" ? "ok" : "error" },
        settled: true,
        endSequence: 1,
      },
    ],
  };
}
