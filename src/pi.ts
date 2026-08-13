import {
  convertToLlm,
  runAgentLoop,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  contentText,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
  type TSchema,
} from "@earendil-works/pi-ai";
import { z } from "zod";

import { candidateId, copyJson } from "./schemas";
import type {
  AuditedTool,
  CallId,
  Campaign,
  CandidateId,
  Json,
  Tool,
} from "./types";

export { InMemoryCredentialStore } from "@earendil-works/pi-ai";
export { builtinModels as builtinPi } from "@earendil-works/pi-ai/providers/all";

type PiModels = Pick<Models, "streamSimple">;

export interface PiRunOptions {
  readonly models: PiModels;
  readonly model: Model<Api>;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly candidate?: CandidateId;
  readonly tools?: readonly Tool[];
  readonly signal?: AbortSignal;
}

type PiResultBody = {
  readonly transcript: readonly Json[];
  readonly text: string;
} & (
  | { readonly state: "succeeded" }
  | {
      readonly state: "failed" | "cancelled";
      readonly error: string;
    }
);

export type PiResult = PiResultBody & { readonly call: CallId };

const requestSchema = z.strictObject({
  model: z.strictObject({
    provider: z.string().min(1),
    id: z.string().min(1),
    api: z.string().min(1),
  }),
  system: z.string().optional(),
  prompt: z.string(),
  candidate: candidateId.optional(),
});

function piTool(tool: AuditedTool): AgentTool<TSchema, Json> {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as TSchema,
    executionMode: "sequential",
    async execute(id, input) {
      const output = await tool.execute(input, id);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        details: output,
      };
    },
  };
}

function transcript(messages: readonly AgentMessage[]): readonly Json[] {
  return copyJson(JSON.parse(JSON.stringify(messages))) as readonly Json[];
}

function result(messages: readonly AgentMessage[]): PiResultBody {
  const stored = transcript(messages);
  const final = [...messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
  const text = final === undefined ? "" : contentText(final.content);
  if (final?.stopReason === "aborted") {
    return {
      state: "cancelled",
      text,
      transcript: stored,
      error: final.errorMessage ?? "Pi call was cancelled",
    };
  }
  if (final === undefined || final.stopReason !== "stop") {
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
    ...(options.candidate === undefined
      ? {}
      : { candidate: options.candidate }),
  });
  const request: Json = {
    model: parsed.model,
    prompt: parsed.prompt,
    ...(parsed.system === undefined ? {} : { system: parsed.system }),
    ...(parsed.candidate === undefined ? {} : { candidate: parsed.candidate }),
  };
  const receipt = await campaign.call(
    {
      label: options.label,
      request,
      ...(options.tools === undefined ? {} : { tools: options.tools }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    async ({ request: recorded, tools, signal }) => {
      const exact = requestSchema.parse(recorded);
      const messages = await runAgentLoop(
        [{ role: "user", content: exact.prompt, timestamp: Date.now() }],
        {
          systemPrompt: exact.system ?? "",
          messages: [],
          ...(tools.length === 0 ? {} : { tools: tools.map(piTool) }),
        },
        {
          model: options.model,
          convertToLlm,
          toolExecution: "sequential",
        },
        () => {},
        signal,
        (model, context, streamOptions) =>
          options.models.streamSimple(model, context, streamOptions),
      );
      return result(messages);
    },
  );
  return { call: receipt.id, ...(receipt.output as PiResultBody) };
}
