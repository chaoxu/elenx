import type { CompletionRecord, LogRecord } from "./records";

export type JsonPrimitive = null | boolean | number | string;
export type JsonArray = readonly Json[];
export type JsonObject = { readonly [key: string]: Json };
export type Json = JsonPrimitive | JsonArray | JsonObject;
export type JsonSchema = JsonObject;

export type Hash = `sha256:${string}`;
export type DispatchId = `dispatch:${string}`;
export type CallId = `call:${string}`;
export type InvocationId = `tool:${string}`;

export const RECORD_KINDS = [
  "campaign",
  "process",
  "candidate",
  "dispatch",
  "call",
  "tool-call",
  "tool-result",
  "call-result",
  "completion",
  "promotion",
  "rebuttal",
  "event",
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];
export type HandlerKind = "worker" | "verifier";
export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export type TerminalState = "succeeded" | "failed" | "cancelled";

export interface JsonViolation {
  readonly path: string;
  readonly reason: string;
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function findJsonViolation(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): JsonViolation | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? undefined
      : { path, reason: "JSON numbers must be finite" };
  }

  if (typeof value !== "object") {
    return { path, reason: `unsupported JSON value of type ${typeof value}` };
  }

  if (ancestors.has(value)) {
    return { path, reason: "cyclic values are not JSON" };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) {
          return { path, reason: "JSON arrays cannot have custom properties" };
        }
      }

      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (descriptor === undefined) {
          return {
            path: `${path}[${index}]`,
            reason: "sparse arrays are not accepted at the JSON boundary",
          };
        }
        if (!("value" in descriptor) || !descriptor.enumerable) {
          return {
            path: `${path}[${index}]`,
            reason: "JSON array elements must be enumerable data properties",
          };
        }
        const violation = findJsonViolation(
          descriptor.value,
          `${path}[${index}]`,
          ancestors,
        );
        if (violation !== undefined) return violation;
      }
      return undefined;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { path, reason: "JSON objects must be plain objects" };
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return { path, reason: "JSON objects cannot have symbol keys" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      ) {
        return {
          path: propertyPath(path, key),
          reason: "JSON members must be enumerable data properties",
        };
      }
      const violation = findJsonViolation(
        descriptor.value,
        propertyPath(path, key),
        ancestors,
      );
      if (violation !== undefined) return violation;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

export function jsonViolation(value: unknown): JsonViolation | undefined {
  return findJsonViolation(value, "$", new WeakSet());
}

export function isJson(value: unknown): value is Json {
  return jsonViolation(value) === undefined;
}

export function assertJson(
  value: unknown,
  label = "value",
): asserts value is Json {
  const violation = jsonViolation(value);
  if (violation !== undefined) {
    throw new TypeError(
      `${label} is not JSON at ${violation.path}: ${violation.reason}`,
    );
  }
}

export interface CandidateContract {
  readonly requiredVerifiers: readonly string[];
  readonly premises?: readonly Hash[];
}

export interface Usage {
  readonly meter: string;
  readonly requests: number;
  readonly input?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly output?: number;
  readonly reasoning?: number;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(args: Json, signal: AbortSignal): Promise<Json>;
}

export interface WrappedTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(invocationId: InvocationId, args: Json): Promise<Json>;
}

export interface ModelRequest {
  readonly adapter: string;
  readonly model: string;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly tools?: readonly Tool[];
  readonly adapterOptions?: Json;
}

export interface AdapterRequest {
  readonly model: string;
  readonly system?: string;
  readonly prompt: string;
  readonly tools: readonly WrappedTool[];
  readonly adapterOptions?: Json;
  readonly signal: AbortSignal;
}

export interface AdapterResult {
  readonly state: TerminalState;
  readonly output?: string;
  readonly transcript?: Json;
  readonly usage: readonly Usage[];
  readonly providerModel?: string;
  readonly error?: string;
}

export type ModelResult = AdapterResult;

export interface ModelAdapter {
  readonly id: string;
  validateOptions(options: Json | undefined): void;
  run(request: AdapterRequest): Promise<AdapterResult>;
}

export type HandlerReply =
  | { readonly output: Uint8Array }
  | {
      readonly output: Uint8Array;
      readonly candidate: Hash;
      readonly verdict: Verdict;
    };

export interface Handler {
  readonly name: string;
  readonly kind: HandlerKind;
  run(
    context: HandlerContext,
    input: Uint8Array,
    meta: Json,
  ): Promise<HandlerReply>;
}

export interface HandlerContext {
  readonly dispatchId: DispatchId;
  readonly signal: AbortSignal;
  call(request: ModelRequest): Promise<ModelResult>;
  submitCandidate(
    material: Uint8Array,
    contract: CandidateContract,
  ): Promise<Hash>;
  dispatch(
    name: string,
    input: Uint8Array,
    meta?: Json,
  ): Promise<DispatchHandle>;
  promote(candidate: Hash): Promise<void>;
  appendEvent(
    topic: string,
    data: Json,
    blobs?: readonly Uint8Array[],
  ): Promise<void>;
  records(selector?: RecordSelector): Promise<readonly LogRecord[]>;
  blob(hash: Hash): Promise<Uint8Array>;
  verdicts(candidate: Hash): Promise<readonly VerdictView[]>;
  promotable(candidate: Hash): Promise<PromotionCheck>;
  accepted(candidate: Hash): Promise<AcceptanceCheck>;
}

export interface DispatchHandle {
  readonly id: DispatchId;
  readonly settled: Promise<CompletionRecord>;
  cancel(reason?: string): Promise<CompletionRecord>;
}

export interface RecordSelector {
  readonly kind?: RecordKind;
  readonly dispatch?: DispatchId;
  readonly name?: string;
  readonly candidate?: Hash;
}

export interface VerdictView {
  readonly completionSeq: number;
  readonly dispatch: DispatchId;
  readonly verifier: string;
  readonly candidate: Hash;
  readonly verdict: Verdict;
  readonly output: Hash;
  readonly rebuttalSeqs: readonly number[];
  readonly standing: boolean;
}

export type PromotionBlocker =
  | { readonly kind: "candidate-missing"; readonly candidate: Hash }
  | { readonly kind: "missing-pass"; readonly verifier: string }
  | {
      readonly kind: "standing-fail";
      readonly verifier: string;
      readonly completionSeq: number;
    }
  | { readonly kind: "premise-not-accepted"; readonly premise: Hash }
  | { readonly kind: "premise-cycle"; readonly cycle: readonly Hash[] };

export type PromotionCheck =
  | {
      readonly ok: true;
      readonly candidate: Hash;
      readonly passes: readonly {
        readonly verifier: string;
        readonly completionSeq: number;
      }[];
    }
  | {
      readonly ok: false;
      readonly candidate: Hash;
      readonly blockers: readonly PromotionBlocker[];
    };

export type AcceptanceBlocker =
  | { readonly kind: "candidate-missing"; readonly candidate: Hash }
  | { readonly kind: "not-promoted" }
  | { readonly kind: "standing-fail"; readonly completionSeq: number }
  | { readonly kind: "premise-not-accepted"; readonly premise: Hash }
  | { readonly kind: "premise-cycle"; readonly cycle: readonly Hash[] };

export type AcceptanceCheck =
  | {
      readonly ok: true;
      readonly candidate: Hash;
      readonly promotionSeq: number;
    }
  | {
      readonly ok: false;
      readonly candidate: Hash;
      readonly blockers: readonly AcceptanceBlocker[];
    };

export interface Reader {
  records(selector?: RecordSelector): Promise<readonly LogRecord[]>;
  blob(hash: Hash): Promise<Uint8Array>;
  verdicts(candidate: Hash): Promise<readonly VerdictView[]>;
  promotable(candidate: Hash): Promise<PromotionCheck>;
  accepted(candidate: Hash): Promise<AcceptanceCheck>;
  close(): Promise<void>;
}

export interface Kernel extends Reader {
  submitCandidate(
    material: Uint8Array,
    contract: CandidateContract,
  ): Promise<Hash>;
  dispatch(
    name: string,
    input: Uint8Array,
    meta?: Json,
  ): Promise<DispatchHandle>;
  rebut(failingCompletionSeq: number, reason: Uint8Array): Promise<void>;
  promote(candidate: Hash): Promise<void>;
  appendEvent(
    topic: string,
    data: Json,
    blobs?: readonly Uint8Array[],
  ): Promise<void>;
}

export interface CreateCampaignOptions {
  readonly application: string;
  readonly config: Uint8Array;
  readonly handlers: readonly Handler[];
  readonly adapters: readonly ModelAdapter[];
}

export interface OpenCampaignOptions {
  readonly handlers: readonly Handler[];
  readonly adapters: readonly ModelAdapter[];
}

export interface ReaderActivity {
  readonly inFlightDispatches: readonly DispatchId[];
  readonly abandonedDispatches: readonly DispatchId[];
  readonly inFlightCalls: readonly CallId[];
  readonly abandonedCalls: readonly CallId[];
  readonly inFlightTools: readonly InvocationId[];
  readonly abandonedTools: readonly InvocationId[];
}
