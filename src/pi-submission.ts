import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { z } from "zod";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});

export const piSubmissionGate = z.strictObject({
  tool: nonblank,
  completeArgument: nonblank,
  reserveTokens: z.number().int().positive(),
});
export type PiSubmissionGate = z.output<typeof piSubmissionGate>;

type SubmissionModel = Pick<Model<Api>, "contextWindow" | "maxTokens">;
const safetyTokens = 4096;

/** Pi's context estimate, anchored to its latest applicable usage when available. */
export function submissionContext(
  gate: PiSubmissionGate,
  model: SubmissionModel,
  context: Context,
) {
  const threshold = model.contextWindow - gate.reserveTokens - safetyTokens;
  if (!(threshold > 0))
    throw new Error(
      "submission reserve and 4096 safety tokens leave no usable context",
    );
  const estimate = estimateContextTokens(context);
  const limit = model.contextWindow - safetyTokens;
  return {
    tokens: estimate.tokens,
    threshold,
    exhausted: estimate.tokens >= limit,
    maxTokens: Math.min(
      model.maxTokens,
      Math.max(
        1,
        (estimate.tokens < threshold ? threshold : limit) - estimate.tokens,
      ),
    ),
  };
}

export function submissionFeedback(
  gate: PiSubmissionGate,
  state: ReturnType<typeof submissionContext>,
): string {
  const occupancy = `Estimated context occupancy: ${state.tokens} tokens; submission threshold: ${state.threshold} tokens.`;
  return state.tokens < state.threshold
    ? `Submission declined. ${occupancy} Continue working toward the original task from the current progress without restarting. Submit with ${gate.tool} when you can truthfully set ${gate.completeArgument}=true, or when the threshold is reached.`
    : `${occupancy} Finalize now with ${gate.tool}. Set ${gate.completeArgument} truthfully: true only if the task is complete, otherwise false.`;
}
