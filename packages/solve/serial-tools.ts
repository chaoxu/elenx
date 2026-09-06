import type { SolveModels } from "./runtime";

// Both OpenAI Responses adapters leave terminal tool use optional and parallel
// tool calls in play. Elenx roles have one terminal submission tool, so the
// provider must call it exactly once.
const openAiResponsesApis = new Set([
  "openai-responses",
  "openai-codex-responses",
]);

/**
 * Force the sole terminal tool for OpenAI Responses requests and disable
 * parallel calls. The payload is rewritten before the checkpointing hook sees
 * it so the durable checkpoint matches the sent bytes. Pi 0.85's simple-stream
 * toolChoice supports only auto/none, not required, and has no parallel-call
 * option. Keep this wrapper until both controls are available upstream.
 */
export function withSerialToolCalls(models: SolveModels): SolveModels {
  return {
    ...(models.checkAuth === undefined
      ? {}
      : { checkAuth: (provider: string) => models.checkAuth!(provider) }),
    getModel(provider, id) {
      return models.getModel(provider, id);
    },
    streamSimple(model, context, options) {
      if (!openAiResponsesApis.has(model.api)) {
        return models.streamSimple(model, context, options);
      }
      const inner = options?.onPayload;
      const onPayload = async (
        payload: unknown,
        requestModel: Parameters<NonNullable<typeof inner>>[1],
      ) => {
        // Never require a tool from an empty or absent declaration.
        const serial =
          typeof payload === "object" &&
          payload !== null &&
          ("tools" in payload || "parallel_tool_calls" in payload)
            ? {
                ...payload,
                ...("tools" in payload &&
                Array.isArray(payload.tools) &&
                payload.tools.length > 0
                  ? { tool_choice: "required" }
                  : {}),
                parallel_tool_calls: false,
              }
            : payload;
        return (await inner?.(serial, requestModel)) ?? serial;
      };
      return models.streamSimple(model, context, { ...options, onPayload });
    },
  };
}
