import * as z from "zod";

import { Defect } from "./errors";
import { isHash } from "./hash";
import {
  RECORD_KINDS,
  assertJson,
  isJson,
  type CallId,
  type DispatchId,
  type HandlerKind,
  type Hash,
  type InvocationId,
  type Json,
  type RecordKind,
  type TerminalState,
  type Usage,
  type Verdict,
} from "./types";

export interface CampaignBody {
  readonly schemaVersion: 1;
  readonly application: string;
  readonly config: Hash;
}

export interface ProcessBody {
  readonly kernelVersion: string;
  readonly handlers: readonly {
    readonly name: string;
    readonly kind: HandlerKind;
  }[];
  readonly adapters: readonly string[];
}

export interface CandidateBody {
  readonly material: Hash;
  readonly requiredVerifiers: readonly string[];
  readonly premises: readonly Hash[];
}

export interface DispatchBody {
  readonly id: DispatchId;
  readonly handler: string;
  readonly handlerKind: HandlerKind;
  readonly input: Hash;
  readonly meta: Json;
  readonly parent?: DispatchId;
  readonly target?: Hash;
}

export interface CallBody {
  readonly id: CallId;
  readonly dispatch: DispatchId;
  readonly label: string;
  readonly request: Hash;
}

export interface StoredToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Json;
}

export interface StoredModelRequest {
  readonly adapter: string;
  readonly model: string;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly tools: readonly StoredToolDeclaration[];
  readonly adapterOptions?: Json;
}

export interface ToolCallBody {
  readonly call: CallId;
  readonly dispatch: DispatchId;
  readonly invocation: InvocationId;
  readonly tool: string;
  readonly arguments: Hash;
}

export type ToolResultBody =
  | {
      readonly call: CallId;
      readonly dispatch: DispatchId;
      readonly invocation: InvocationId;
      readonly tool: string;
      readonly state: "succeeded";
      readonly result: Hash;
    }
  | {
      readonly call: CallId;
      readonly dispatch: DispatchId;
      readonly invocation: InvocationId;
      readonly tool: string;
      readonly state: "failed" | "cancelled";
      readonly error: Hash;
    };

export interface CallResultBody {
  readonly call: CallId;
  readonly dispatch: DispatchId;
  readonly label: string;
  readonly state: TerminalState;
  readonly output?: Hash;
  readonly transcript?: Hash;
  readonly usage: readonly Usage[];
  readonly providerModel?: string;
  readonly error?: Hash;
}

export type CompletionBody =
  | {
      readonly dispatch: DispatchId;
      readonly handler: string;
      readonly handlerKind: "worker";
      readonly state: "succeeded";
      readonly output: Hash;
    }
  | {
      readonly dispatch: DispatchId;
      readonly handler: string;
      readonly handlerKind: "verifier";
      readonly state: "succeeded";
      readonly output: Hash;
      readonly candidate: Hash;
      readonly verdict: Verdict;
    }
  | {
      readonly dispatch: DispatchId;
      readonly handler: string;
      readonly handlerKind: "worker";
      readonly state: "failed" | "cancelled";
      readonly output?: Hash;
      readonly error: Hash;
    }
  | {
      readonly dispatch: DispatchId;
      readonly handler: string;
      readonly handlerKind: "verifier";
      readonly state: "failed" | "cancelled";
      readonly output?: Hash;
      readonly error: Hash;
      readonly candidate?: Hash;
    };

export interface PromotionBody {
  readonly candidate: Hash;
  readonly passes: readonly {
    readonly verifier: string;
    readonly completionSeq: number;
  }[];
}

export interface RebuttalBody {
  readonly failingCompletionSeq: number;
  readonly reason: Hash;
  readonly verifier: string;
  readonly candidate: Hash;
}

export interface EventBody {
  readonly topic: string;
  readonly data: Json;
  readonly blobs: readonly Hash[];
}

export interface RecordBodyByKind {
  readonly campaign: CampaignBody;
  readonly process: ProcessBody;
  readonly candidate: CandidateBody;
  readonly dispatch: DispatchBody;
  readonly call: CallBody;
  readonly "tool-call": ToolCallBody;
  readonly "tool-result": ToolResultBody;
  readonly "call-result": CallResultBody;
  readonly completion: CompletionBody;
  readonly promotion: PromotionBody;
  readonly rebuttal: RebuttalBody;
  readonly event: EventBody;
}

export type RecordBody = RecordBodyByKind[RecordKind];

export type RecordDraft = {
  readonly [K in RecordKind]: {
    readonly kind: K;
    readonly body: RecordBodyByKind[K];
  };
}[RecordKind];

interface RecordHeader<K extends RecordKind, B> {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: K;
  readonly body: B;
}

type WithoutDispatch = { readonly dispatch?: never };
type WithoutName = { readonly name?: never };
type WithoutCandidate = { readonly candidate?: never };

export type CampaignRecord = RecordHeader<"campaign", CampaignBody> &
  WithoutDispatch &
  WithoutCandidate & { readonly name: string };

export type ProcessRecord = RecordHeader<"process", ProcessBody> &
  WithoutDispatch &
  WithoutName &
  WithoutCandidate;

export type CandidateRecord = RecordHeader<"candidate", CandidateBody> &
  WithoutDispatch &
  WithoutName & { readonly candidate: Hash };

export type DispatchRecord = RecordHeader<"dispatch", DispatchBody> & {
  readonly dispatch: DispatchId;
  readonly name: string;
  readonly candidate?: Hash;
};

export type CallRecord = RecordHeader<"call", CallBody> &
  WithoutCandidate & {
    readonly dispatch: DispatchId;
    readonly name: string;
  };

export type ToolCallRecord = RecordHeader<"tool-call", ToolCallBody> &
  WithoutCandidate & {
    readonly dispatch: DispatchId;
    readonly name: string;
  };

export type ToolResultRecord = RecordHeader<"tool-result", ToolResultBody> &
  WithoutCandidate & {
    readonly dispatch: DispatchId;
    readonly name: string;
  };

export type CallResultRecord = RecordHeader<"call-result", CallResultBody> &
  WithoutCandidate & {
    readonly dispatch: DispatchId;
    readonly name: string;
  };

export type CompletionRecord = RecordHeader<"completion", CompletionBody> & {
  readonly dispatch: DispatchId;
  readonly name: string;
  readonly candidate?: Hash;
};

export type PromotionRecord = RecordHeader<"promotion", PromotionBody> &
  WithoutDispatch &
  WithoutName & { readonly candidate: Hash };

export type RebuttalRecord = RecordHeader<"rebuttal", RebuttalBody> &
  WithoutDispatch & {
    readonly name: string;
    readonly candidate: Hash;
  };

export type EventRecord = RecordHeader<"event", EventBody> &
  WithoutDispatch &
  WithoutCandidate & { readonly name: string };

export type LogRecord =
  | CampaignRecord
  | ProcessRecord
  | CandidateRecord
  | DispatchRecord
  | CallRecord
  | ToolCallRecord
  | ToolResultRecord
  | CallResultRecord
  | CompletionRecord
  | PromotionRecord
  | RebuttalRecord
  | EventRecord;

export type Completion = CompletionRecord;

export interface RecordCorrelations {
  readonly dispatch?: DispatchId;
  readonly name?: string;
  readonly candidate?: Hash;
}

const nonemptyStringSchema = z.string().min(1, "must be a nonempty string");
const safeNonnegativeIntegerSchema = z
  .number()
  .refine(
    (value) => Number.isSafeInteger(value) && value >= 0,
    "must be a nonnegative safe integer",
  );
const safePositiveIntegerSchema = z
  .number()
  .refine(
    (value) => Number.isSafeInteger(value) && value >= 1,
    "must be a positive safe integer",
  );
const hashSchema = z.custom<Hash>(
  isHash,
  "must match sha256:<64 lowercase hex digits>",
);
const dispatchIdSchema = z.custom<DispatchId>(
  (value) =>
    typeof value === "string" &&
    value.startsWith("dispatch:") &&
    value.length > "dispatch:".length,
  "must be a nonempty dispatch: id",
);
const callIdSchema = z.custom<CallId>(
  (value) =>
    typeof value === "string" &&
    value.startsWith("call:") &&
    value.length > "call:".length,
  "must be a nonempty call: id",
);
const invocationIdSchema = z.custom<InvocationId>(
  (value) =>
    typeof value === "string" &&
    value.startsWith("tool:") &&
    value.length > "tool:".length,
  "must be a nonempty tool: id",
);
const jsonSchema = z.custom<Json>(isJson, "must be JSON");
const handlerKindSchema = z.enum(["worker", "verifier"]);
const verdictSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);
const failureStateSchema = z.enum(["failed", "cancelled"]);

function addUniqueIssue<T>(
  values: readonly string[],
  context: z.core.$RefinementCtx<T>,
  noun: string,
): void {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as string;
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `contains duplicate ${noun} ${value}`,
      });
    }
    seen.add(value);
  }
}

function addSortedUniqueIssue<T>(
  values: readonly string[],
  context: z.core.$RefinementCtx<T>,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] as string) >= (values[index] as string)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: "must be sorted and unique",
      });
    }
  }
}

const uniqueStringArraySchema = z
  .array(nonemptyStringSchema)
  .superRefine((values, context) => addUniqueIssue(values, context, "id"));
const sortedUniqueStringArraySchema = z
  .array(nonemptyStringSchema)
  .superRefine(addSortedUniqueIssue);
const sortedUniqueHashArraySchema = z
  .array(hashSchema)
  .superRefine(addSortedUniqueIssue);
const uniqueHashArraySchema = z
  .array(hashSchema)
  .superRefine((values, context) => addUniqueIssue(values, context, "hash"));

const usageSchema = z.strictObject({
  meter: nonemptyStringSchema,
  requests: safePositiveIntegerSchema,
  input: safeNonnegativeIntegerSchema.optional(),
  cacheRead: safeNonnegativeIntegerSchema.optional(),
  cacheWrite: safeNonnegativeIntegerSchema.optional(),
  output: safeNonnegativeIntegerSchema.optional(),
  reasoning: safeNonnegativeIntegerSchema.optional(),
});

const usageRowsSchema = z.array(usageSchema).superRefine((rows, context) => {
  const meters = rows.map((row) => row.meter);
  addUniqueIssue(meters, context, "meter");
});

const campaignBodySchema = z.strictObject({
  schemaVersion: z.literal(1),
  application: nonemptyStringSchema,
  config: hashSchema,
});

const processBodySchema = z.strictObject({
  kernelVersion: nonemptyStringSchema,
  handlers: z
    .array(
      z.strictObject({
        name: nonemptyStringSchema,
        kind: handlerKindSchema,
      }),
    )
    .superRefine((handlers, context) => {
      addUniqueIssue(
        handlers.map((handler) => handler.name),
        context,
        "name",
      );
    }),
  adapters: uniqueStringArraySchema,
});

const candidateBodySchema = z
  .strictObject({
    material: hashSchema,
    requiredVerifiers: sortedUniqueStringArraySchema.min(1),
    premises: sortedUniqueHashArraySchema,
  })
  .superRefine((body, context) => {
    if (body.premises.includes(body.material)) {
      context.addIssue({
        code: "custom",
        path: ["premises"],
        message: "cannot contain the candidate itself",
      });
    }
  });

const dispatchBaseShape = {
  id: dispatchIdSchema,
  handler: nonemptyStringSchema,
  input: hashSchema,
  meta: jsonSchema,
  parent: dispatchIdSchema.optional(),
};
const dispatchBodySchema = z.union([
  z
    .strictObject({
      ...dispatchBaseShape,
      handlerKind: z.literal("worker"),
    })
    .refine((body) => body.parent !== body.id, {
      path: ["parent"],
      message: "cannot equal id",
    }),
  z
    .strictObject({
      ...dispatchBaseShape,
      handlerKind: z.literal("verifier"),
      target: hashSchema.optional(),
    })
    .refine((body) => body.parent !== body.id, {
      path: ["parent"],
      message: "cannot equal id",
    }),
]);

const callBodySchema = z.strictObject({
  id: callIdSchema,
  dispatch: dispatchIdSchema,
  label: nonemptyStringSchema,
  request: hashSchema,
});

const toolCorrelationShape = {
  call: callIdSchema,
  dispatch: dispatchIdSchema,
  invocation: invocationIdSchema,
  tool: nonemptyStringSchema,
};
const toolCallBodySchema = z.strictObject({
  ...toolCorrelationShape,
  arguments: hashSchema,
});
const toolResultBodySchema = z.union([
  z.strictObject({
    ...toolCorrelationShape,
    state: z.literal("succeeded"),
    result: hashSchema,
  }),
  z.strictObject({
    ...toolCorrelationShape,
    state: failureStateSchema,
    error: hashSchema,
  }),
]);

const callResultBaseShape = {
  call: callIdSchema,
  dispatch: dispatchIdSchema,
  label: nonemptyStringSchema,
  transcript: hashSchema.optional(),
  usage: usageRowsSchema,
  providerModel: nonemptyStringSchema.optional(),
};
const callResultBodySchema = z.union([
  z.strictObject({
    ...callResultBaseShape,
    state: z.literal("succeeded"),
    output: hashSchema,
  }),
  z.strictObject({
    ...callResultBaseShape,
    state: failureStateSchema,
    output: hashSchema.optional(),
    error: hashSchema,
  }),
]);

const completionBaseShape = {
  dispatch: dispatchIdSchema,
  handler: nonemptyStringSchema,
};
const completionBodySchema = z.union([
  z.strictObject({
    ...completionBaseShape,
    handlerKind: z.literal("worker"),
    state: z.literal("succeeded"),
    output: hashSchema,
  }),
  z.strictObject({
    ...completionBaseShape,
    handlerKind: z.literal("verifier"),
    state: z.literal("succeeded"),
    output: hashSchema,
    candidate: hashSchema,
    verdict: verdictSchema,
  }),
  z.strictObject({
    ...completionBaseShape,
    handlerKind: z.literal("worker"),
    state: failureStateSchema,
    output: hashSchema.optional(),
    error: hashSchema,
  }),
  z.strictObject({
    ...completionBaseShape,
    handlerKind: z.literal("verifier"),
    state: failureStateSchema,
    output: hashSchema.optional(),
    error: hashSchema,
    candidate: hashSchema.optional(),
  }),
]);

const promotionBodySchema = z.strictObject({
  candidate: hashSchema,
  passes: z
    .array(
      z.strictObject({
        verifier: nonemptyStringSchema,
        completionSeq: safePositiveIntegerSchema,
      }),
    )
    .min(1)
    .superRefine((passes, context) => {
      addUniqueIssue(
        passes.map((pass) => pass.verifier),
        context,
        "verifier",
      );
    }),
});

const rebuttalBodySchema = z.strictObject({
  failingCompletionSeq: safePositiveIntegerSchema,
  reason: hashSchema,
  verifier: nonemptyStringSchema,
  candidate: hashSchema,
});

const eventBodySchema = z.strictObject({
  topic: nonemptyStringSchema,
  data: jsonSchema,
  blobs: uniqueHashArraySchema,
});

const recordBodySchemas: Record<RecordKind, z.ZodType> = {
  campaign: campaignBodySchema,
  process: processBodySchema,
  candidate: candidateBodySchema,
  dispatch: dispatchBodySchema,
  call: callBodySchema,
  "tool-call": toolCallBodySchema,
  "tool-result": toolResultBodySchema,
  "call-result": callResultBodySchema,
  completion: completionBodySchema,
  promotion: promotionBodySchema,
  rebuttal: rebuttalBodySchema,
  event: eventBodySchema,
};

const recordKindSchema = z.enum(RECORD_KINDS);
const recordDraftEnvelopeSchema = z.strictObject({
  kind: recordKindSchema,
  body: z.unknown(),
});
const recordEnvelopeSchema = z.strictObject({
  seq: safePositiveIntegerSchema,
  atMs: safeNonnegativeIntegerSchema,
  kind: recordKindSchema,
  body: z.unknown(),
  dispatch: dispatchIdSchema.optional(),
  name: nonemptyStringSchema.optional(),
  candidate: hashSchema.optional(),
});

function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new TypeError(
    `${label}${issue?.path.length ? `.${issue.path.join(".")}` : ""} ${issue?.message ?? "is invalid"}`,
  );
}

function assertSchema(schema: z.ZodType, value: unknown, label: string): void {
  parseSchema(schema, value, label);
}

export function assertRecordBody<K extends RecordKind>(
  kind: K,
  body: unknown,
): asserts body is RecordBodyByKind[K] {
  assertJson(body, `${kind} body`);
  assertSchema(recordBodySchemas[kind], body, `${kind} body`);
}

export function assertRecordDraft(
  value: unknown,
): asserts value is RecordDraft {
  assertJson(value, "record draft");
  const draft = parseSchema(recordDraftEnvelopeSchema, value, "record draft");
  assertRecordBody(draft.kind, draft.body);
}

export function isRecordDraft(value: unknown): value is RecordDraft {
  try {
    assertRecordDraft(value);
    return true;
  } catch {
    return false;
  }
}

function withCandidate(
  base: Omit<RecordCorrelations, "candidate">,
  candidate: Hash | undefined,
): RecordCorrelations {
  return candidate === undefined ? base : { ...base, candidate };
}

export function projectRecordCorrelations(
  draft: RecordDraft,
): RecordCorrelations {
  switch (draft.kind) {
    case "campaign":
      return { name: draft.body.application };
    case "process":
      return {};
    case "candidate":
      return { candidate: draft.body.material };
    case "dispatch":
      return withCandidate(
        { dispatch: draft.body.id, name: draft.body.handler },
        draft.body.target,
      );
    case "call":
    case "call-result":
      return { dispatch: draft.body.dispatch, name: draft.body.label };
    case "tool-call":
    case "tool-result":
      return { dispatch: draft.body.dispatch, name: draft.body.tool };
    case "completion":
      return withCandidate(
        { dispatch: draft.body.dispatch, name: draft.body.handler },
        "candidate" in draft.body ? draft.body.candidate : undefined,
      );
    case "promotion":
      return { candidate: draft.body.candidate };
    case "rebuttal":
      return { name: draft.body.verifier, candidate: draft.body.candidate };
    case "event":
      return { name: draft.body.topic };
  }
}

export function makeLogRecord(
  seq: number,
  atMs: number,
  draft: RecordDraft,
): LogRecord {
  assertSchema(safePositiveIntegerSchema, seq, "record seq");
  assertSchema(safeNonnegativeIntegerSchema, atMs, "record atMs");
  assertRecordDraft(draft);
  const snapshot = JSON.parse(JSON.stringify(draft)) as RecordDraft;
  return parseLogRecord({
    seq,
    atMs,
    kind: snapshot.kind,
    body: snapshot.body,
    ...projectRecordCorrelations(snapshot),
  });
}

export function parseLogRecord(value: unknown): LogRecord {
  try {
    assertJson(value, "record");
    const row = parseSchema(recordEnvelopeSchema, value, "record");
    assertRecordBody(row.kind, row.body);
    const draft = { kind: row.kind, body: row.body } as RecordDraft;
    const correlations = projectRecordCorrelations(draft);
    const correlationShape = {
      ...(correlations.dispatch === undefined
        ? {}
        : { dispatch: z.literal(correlations.dispatch) }),
      ...(correlations.name === undefined
        ? {}
        : { name: z.literal(correlations.name) }),
      ...(correlations.candidate === undefined
        ? {}
        : { candidate: z.literal(correlations.candidate) }),
    };
    assertSchema(
      z.strictObject({
        seq: safePositiveIntegerSchema,
        atMs: safeNonnegativeIntegerSchema,
        kind: z.literal(row.kind),
        body: recordBodySchemas[row.kind],
        ...correlationShape,
      }),
      value,
      "record",
    );
    return JSON.parse(JSON.stringify(value)) as LogRecord;
  } catch (error) {
    if (error instanceof Defect) throw error;
    throw new Defect("CORRUPT_RECORD", "Stored record failed validation", {
      operation: "read-record",
      cause: error,
    });
  }
}

export function recordBlobReferences(
  record: RecordDraft | LogRecord,
): readonly Hash[] {
  const draft: RecordDraft = {
    kind: record.kind,
    body: record.body,
  } as RecordDraft;
  switch (draft.kind) {
    case "campaign":
      return [draft.body.config];
    case "process":
      return [];
    case "candidate":
      return [draft.body.material, ...draft.body.premises];
    case "dispatch":
      return draft.body.target === undefined
        ? [draft.body.input]
        : [draft.body.input, draft.body.target];
    case "call":
      return [draft.body.request];
    case "tool-call":
      return [draft.body.arguments];
    case "tool-result":
      return draft.body.state === "succeeded"
        ? [draft.body.result]
        : [draft.body.error];
    case "call-result":
      return [
        draft.body.output,
        draft.body.transcript,
        draft.body.error,
      ].filter(isHash);
    case "completion":
      return [
        draft.body.output,
        "error" in draft.body ? draft.body.error : undefined,
        "candidate" in draft.body ? draft.body.candidate : undefined,
      ].filter(isHash);
    case "promotion":
      return [draft.body.candidate];
    case "rebuttal":
      return [draft.body.reason, draft.body.candidate];
    case "event":
      return draft.body.blobs;
  }
}
