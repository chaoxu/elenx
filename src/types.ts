import { z } from "zod";

import type {
  CallId,
  Entry,
  Hash,
  Json,
  ToolDeclaration,
  Verdict,
} from "./schemas";

export type {
  CallId,
  Entry,
  EntryDraft,
  Hash,
  Json,
  ToolCallId,
  ToolDeclaration,
  Verdict,
} from "./schemas";

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodObject;
  run(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export interface AuditedTool extends ToolDeclaration {
  execute(input: unknown, source?: string): Promise<Json>;
}

export interface CandidateStatus {
  readonly candidate: Hash;
  readonly promotable: boolean;
  readonly promoted: boolean;
  readonly missing: readonly string[];
  readonly failed: readonly string[];
  readonly passes: readonly number[];
}

export interface Reader {
  records(): readonly Entry[];
  blob(hash: Hash): Uint8Array;
  status(candidate: Hash): CandidateStatus;
  close(): void;
}

export interface CallOptions {
  readonly label: string;
  readonly request: Json;
  readonly tools?: readonly Tool[];
  readonly signal?: AbortSignal;
}

export interface CallContext {
  readonly request: Json;
  readonly tools: readonly AuditedTool[];
  readonly signal: AbortSignal;
}

export interface CallReceipt {
  readonly id: CallId;
  readonly output: Json;
}

export interface Campaign extends Reader {
  submitCandidate(
    material: Uint8Array,
    requiredVerifiers: readonly string[],
  ): Hash;
  recordVerdict(
    candidate: Hash,
    verifier: string,
    call: CallId,
    verdict: Verdict,
    evidence: Json,
  ): Entry;
  promote(candidate: Hash): Entry;
  call(
    options: CallOptions,
    runner: (context: CallContext) => Promise<unknown>,
  ): Promise<CallReceipt>;
}

export interface ToolDefinition<S extends z.ZodObject> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  run(input: z.output<S>, signal: AbortSignal): Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(
  definition: ToolDefinition<S>,
): Tool {
  return {
    name: definition.name,
    description: definition.description,
    input: definition.input,
    run(input, signal) {
      return definition.run(input as z.output<S>, signal);
    },
  };
}
