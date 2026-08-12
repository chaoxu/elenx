import { Defect } from "./errors";
import { isHash } from "./hash";
import {
  RECORD_KINDS,
  assertJson,
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

type UnknownObject = { readonly [key: string]: unknown };

function fail(label: string, reason: string): never {
  throw new TypeError(`${label} ${reason}`);
}

function objectValue(value: unknown, label: string): UnknownObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(label, "must be an object");
  }
  return value as UnknownObject;
}

function exactKeys(
  value: UnknownObject,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(label, `is missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(label, `has unknown field ${key}`);
  }
}

function nonemptyString(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    fail(label, "must be a nonempty string");
  }
}

function prefixedId<T extends string>(
  value: unknown,
  prefix: string,
  label: string,
): asserts value is T {
  nonemptyString(value, label);
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    fail(label, `must start with ${prefix}`);
  }
}

function safeInteger(
  value: unknown,
  label: string,
  minimum = 0,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(label, `must be a safe integer greater than or equal to ${minimum}`);
  }
}

function hashValue(value: unknown, label: string): asserts value is Hash {
  if (!isHash(value))
    fail(label, "must match sha256:<64 lowercase hex digits>");
}

function stringArray(
  value: unknown,
  label: string,
  options: {
    readonly nonempty?: boolean;
    readonly sortedUnique?: boolean;
  } = {},
): asserts value is readonly string[] {
  if (!Array.isArray(value)) fail(label, "must be an array");
  if (options.nonempty === true && value.length === 0) {
    fail(label, "must not be empty");
  }
  for (let index = 0; index < value.length; index += 1) {
    nonemptyString(value[index], `${label}[${index}]`);
  }
  if (options.sortedUnique === true) {
    for (let index = 1; index < value.length; index += 1) {
      if ((value[index - 1] as string) >= (value[index] as string)) {
        fail(label, "must be sorted and unique");
      }
    }
  }
}

function hashArray(
  value: unknown,
  label: string,
  sortedUnique: boolean,
): asserts value is readonly Hash[] {
  if (!Array.isArray(value)) fail(label, "must be an array");
  for (let index = 0; index < value.length; index += 1) {
    hashValue(value[index], `${label}[${index}]`);
  }
  if (sortedUnique) {
    for (let index = 1; index < value.length; index += 1) {
      if ((value[index - 1] as string) >= (value[index] as string)) {
        fail(label, "must be sorted and unique");
      }
    }
  }
}

function handlerKind(
  value: unknown,
  label: string,
): asserts value is HandlerKind {
  if (value !== "worker" && value !== "verifier") {
    fail(label, "must be worker or verifier");
  }
}

function terminalState(
  value: unknown,
  label: string,
): asserts value is TerminalState {
  if (value !== "succeeded" && value !== "failed" && value !== "cancelled") {
    fail(label, "must be succeeded, failed, or cancelled");
  }
}

function verdictValue(value: unknown, label: string): asserts value is Verdict {
  if (value !== "PASS" && value !== "FAIL" && value !== "INCONCLUSIVE") {
    fail(label, "must be PASS, FAIL, or INCONCLUSIVE");
  }
}

function usageRows(
  value: unknown,
  label: string,
): asserts value is readonly Usage[] {
  if (!Array.isArray(value)) fail(label, "must be an array");
  const meters = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const rowLabel = `${label}[${index}]`;
    const row = objectValue(value[index], rowLabel);
    exactKeys(
      row,
      ["meter", "requests"],
      ["input", "cacheRead", "cacheWrite", "output", "reasoning"],
      rowLabel,
    );
    nonemptyString(row.meter, `${rowLabel}.meter`);
    if (meters.has(row.meter))
      fail(label, `contains duplicate meter ${row.meter}`);
    meters.add(row.meter);
    safeInteger(row.requests, `${rowLabel}.requests`, 1);
    for (const field of [
      "input",
      "cacheRead",
      "cacheWrite",
      "output",
      "reasoning",
    ] as const) {
      if (Object.hasOwn(row, field)) {
        safeInteger(row[field], `${rowLabel}.${field}`);
      }
    }
  }
}

function assertCampaignBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(body, ["schemaVersion", "application", "config"], [], label);
  if (body.schemaVersion !== 1) fail(`${label}.schemaVersion`, "must be 1");
  nonemptyString(body.application, `${label}.application`);
  hashValue(body.config, `${label}.config`);
}

function assertProcessBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(body, ["kernelVersion", "handlers", "adapters"], [], label);
  nonemptyString(body.kernelVersion, `${label}.kernelVersion`);
  if (!Array.isArray(body.handlers))
    fail(`${label}.handlers`, "must be an array");
  const handlerNames = new Set<string>();
  for (let index = 0; index < body.handlers.length; index += 1) {
    const itemLabel = `${label}.handlers[${index}]`;
    const item = objectValue(body.handlers[index], itemLabel);
    exactKeys(item, ["name", "kind"], [], itemLabel);
    nonemptyString(item.name, `${itemLabel}.name`);
    handlerKind(item.kind, `${itemLabel}.kind`);
    if (handlerNames.has(item.name)) {
      fail(`${label}.handlers`, `contains duplicate name ${item.name}`);
    }
    handlerNames.add(item.name);
  }
  stringArray(body.adapters, `${label}.adapters`);
  const adapters = body.adapters as readonly string[];
  if (new Set(adapters).size !== adapters.length) {
    fail(`${label}.adapters`, "must contain unique ids");
  }
}

function assertCandidateBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(body, ["material", "requiredVerifiers", "premises"], [], label);
  hashValue(body.material, `${label}.material`);
  stringArray(body.requiredVerifiers, `${label}.requiredVerifiers`, {
    nonempty: true,
    sortedUnique: true,
  });
  hashArray(body.premises, `${label}.premises`, true);
  if ((body.premises as readonly Hash[]).includes(body.material)) {
    fail(`${label}.premises`, "cannot contain the candidate itself");
  }
}

function assertDispatchBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(
    body,
    ["id", "handler", "handlerKind", "input", "meta"],
    ["parent", "target"],
    label,
  );
  prefixedId<DispatchId>(body.id, "dispatch:", `${label}.id`);
  nonemptyString(body.handler, `${label}.handler`);
  handlerKind(body.handlerKind, `${label}.handlerKind`);
  hashValue(body.input, `${label}.input`);
  assertJson(body.meta, `${label}.meta`);
  if (Object.hasOwn(body, "parent")) {
    prefixedId<DispatchId>(body.parent, "dispatch:", `${label}.parent`);
    if (body.parent === body.id) fail(`${label}.parent`, "cannot equal id");
  }
  if (Object.hasOwn(body, "target")) {
    hashValue(body.target, `${label}.target`);
    if (body.handlerKind !== "verifier") {
      fail(`${label}.target`, "is allowed only for verifier dispatches");
    }
  }
}

function assertCallBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(body, ["id", "dispatch", "label", "request"], [], label);
  prefixedId<CallId>(body.id, "call:", `${label}.id`);
  prefixedId<DispatchId>(body.dispatch, "dispatch:", `${label}.dispatch`);
  nonemptyString(body.label, `${label}.label`);
  hashValue(body.request, `${label}.request`);
}

function assertToolCallBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(
    body,
    ["call", "dispatch", "invocation", "tool", "arguments"],
    [],
    label,
  );
  prefixedId<CallId>(body.call, "call:", `${label}.call`);
  prefixedId<DispatchId>(body.dispatch, "dispatch:", `${label}.dispatch`);
  prefixedId<InvocationId>(body.invocation, "tool:", `${label}.invocation`);
  nonemptyString(body.tool, `${label}.tool`);
  hashValue(body.arguments, `${label}.arguments`);
}

function assertToolResultBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(
    body,
    ["call", "dispatch", "invocation", "tool", "state"],
    ["result", "error"],
    label,
  );
  prefixedId<CallId>(body.call, "call:", `${label}.call`);
  prefixedId<DispatchId>(body.dispatch, "dispatch:", `${label}.dispatch`);
  prefixedId<InvocationId>(body.invocation, "tool:", `${label}.invocation`);
  nonemptyString(body.tool, `${label}.tool`);
  terminalState(body.state, `${label}.state`);
  if (body.state === "succeeded") {
    if (!Object.hasOwn(body, "result")) fail(label, "is missing result");
    if (Object.hasOwn(body, "error"))
      fail(label, "cannot contain error on success");
    hashValue(body.result, `${label}.result`);
  } else {
    if (!Object.hasOwn(body, "error")) fail(label, "is missing error");
    if (Object.hasOwn(body, "result"))
      fail(label, "cannot contain result on failure");
    hashValue(body.error, `${label}.error`);
  }
}

function assertCallResultBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(
    body,
    ["call", "dispatch", "label", "state", "usage"],
    ["output", "transcript", "providerModel", "error"],
    label,
  );
  prefixedId<CallId>(body.call, "call:", `${label}.call`);
  prefixedId<DispatchId>(body.dispatch, "dispatch:", `${label}.dispatch`);
  nonemptyString(body.label, `${label}.label`);
  terminalState(body.state, `${label}.state`);
  usageRows(body.usage, `${label}.usage`);
  for (const field of ["output", "transcript", "error"] as const) {
    if (Object.hasOwn(body, field)) hashValue(body[field], `${label}.${field}`);
  }
  if (Object.hasOwn(body, "providerModel")) {
    nonemptyString(body.providerModel, `${label}.providerModel`);
  }
}

function assertCompletionBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(
    body,
    ["dispatch", "handler", "handlerKind", "state"],
    ["output", "error", "candidate", "verdict"],
    label,
  );
  prefixedId<DispatchId>(body.dispatch, "dispatch:", `${label}.dispatch`);
  nonemptyString(body.handler, `${label}.handler`);
  handlerKind(body.handlerKind, `${label}.handlerKind`);
  terminalState(body.state, `${label}.state`);

  if (body.state === "succeeded") {
    if (!Object.hasOwn(body, "output")) fail(label, "is missing output");
    if (Object.hasOwn(body, "error"))
      fail(label, "cannot contain error on success");
    hashValue(body.output, `${label}.output`);
    if (body.handlerKind === "worker") {
      if (Object.hasOwn(body, "candidate") || Object.hasOwn(body, "verdict")) {
        fail(label, "worker success cannot contain a verdict");
      }
    } else {
      if (!Object.hasOwn(body, "candidate"))
        fail(label, "is missing candidate");
      if (!Object.hasOwn(body, "verdict")) fail(label, "is missing verdict");
      hashValue(body.candidate, `${label}.candidate`);
      verdictValue(body.verdict, `${label}.verdict`);
    }
    return;
  }

  if (!Object.hasOwn(body, "error")) fail(label, "is missing error");
  if (Object.hasOwn(body, "verdict")) {
    fail(label, "failed or cancelled completion cannot contain a verdict");
  }
  hashValue(body.error, `${label}.error`);
  if (Object.hasOwn(body, "output")) hashValue(body.output, `${label}.output`);
  if (Object.hasOwn(body, "candidate")) {
    hashValue(body.candidate, `${label}.candidate`);
    if (body.handlerKind !== "verifier") {
      fail(`${label}.candidate`, "is allowed only for verifier completions");
    }
  }
}

function assertPromotionBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(body, ["candidate", "passes"], [], label);
  hashValue(body.candidate, `${label}.candidate`);
  if (!Array.isArray(body.passes) || body.passes.length === 0) {
    fail(`${label}.passes`, "must be a nonempty array");
  }
  const verifiers = new Set<string>();
  for (let index = 0; index < body.passes.length; index += 1) {
    const passLabel = `${label}.passes[${index}]`;
    const pass = objectValue(body.passes[index], passLabel);
    exactKeys(pass, ["verifier", "completionSeq"], [], passLabel);
    nonemptyString(pass.verifier, `${passLabel}.verifier`);
    safeInteger(pass.completionSeq, `${passLabel}.completionSeq`, 1);
    if (verifiers.has(pass.verifier)) {
      fail(`${label}.passes`, `contains duplicate verifier ${pass.verifier}`);
    }
    verifiers.add(pass.verifier);
  }
}

function assertRebuttalBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(
    body,
    ["failingCompletionSeq", "reason", "verifier", "candidate"],
    [],
    label,
  );
  safeInteger(body.failingCompletionSeq, `${label}.failingCompletionSeq`, 1);
  hashValue(body.reason, `${label}.reason`);
  nonemptyString(body.verifier, `${label}.verifier`);
  hashValue(body.candidate, `${label}.candidate`);
}

function assertEventBody(value: unknown, label: string): void {
  const body = objectValue(value, label);
  exactKeys(body, ["topic", "data", "blobs"], [], label);
  nonemptyString(body.topic, `${label}.topic`);
  assertJson(body.data, `${label}.data`);
  hashArray(body.blobs, `${label}.blobs`, false);
}

function isRecordKind(value: unknown): value is RecordKind {
  return (
    typeof value === "string" &&
    (RECORD_KINDS as readonly string[]).includes(value)
  );
}

export function assertRecordBody<K extends RecordKind>(
  kind: K,
  body: unknown,
): asserts body is RecordBodyByKind[K] {
  assertJson(body, `${kind} body`);
  switch (kind) {
    case "campaign":
      assertCampaignBody(body, "campaign body");
      break;
    case "process":
      assertProcessBody(body, "process body");
      break;
    case "candidate":
      assertCandidateBody(body, "candidate body");
      break;
    case "dispatch":
      assertDispatchBody(body, "dispatch body");
      break;
    case "call":
      assertCallBody(body, "call body");
      break;
    case "tool-call":
      assertToolCallBody(body, "tool-call body");
      break;
    case "tool-result":
      assertToolResultBody(body, "tool-result body");
      break;
    case "call-result":
      assertCallResultBody(body, "call-result body");
      break;
    case "completion":
      assertCompletionBody(body, "completion body");
      break;
    case "promotion":
      assertPromotionBody(body, "promotion body");
      break;
    case "rebuttal":
      assertRebuttalBody(body, "rebuttal body");
      break;
    case "event":
      assertEventBody(body, "event body");
      break;
  }
}

export function assertRecordDraft(
  value: unknown,
): asserts value is RecordDraft {
  assertJson(value, "record draft");
  const draft = objectValue(value, "record draft");
  exactKeys(draft, ["kind", "body"], [], "record draft");
  if (!isRecordKind(draft.kind))
    fail("record draft.kind", "is not a record kind");
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

function sameCorrelations(
  row: UnknownObject,
  expected: RecordCorrelations,
  label: string,
): void {
  for (const key of ["dispatch", "name", "candidate"] as const) {
    const present = Object.hasOwn(row, key);
    const wanted = Object.hasOwn(expected, key);
    if (present !== wanted) {
      fail(label, wanted ? `is missing ${key}` : `has unexpected ${key}`);
    }
    if (wanted && row[key] !== expected[key]) {
      fail(label, `${key} does not match its record body`);
    }
  }
}

export function makeLogRecord(
  seq: number,
  atMs: number,
  draft: RecordDraft,
): LogRecord {
  safeInteger(seq, "record seq", 1);
  safeInteger(atMs, "record atMs");
  assertRecordDraft(draft);
  return parseLogRecord({
    seq,
    atMs,
    kind: draft.kind,
    body: draft.body,
    ...projectRecordCorrelations(draft),
  });
}

export function parseLogRecord(value: unknown): LogRecord {
  try {
    assertJson(value, "record");
    const row = objectValue(value, "record");
    if (!isRecordKind(row.kind)) fail("record.kind", "is not a record kind");
    assertRecordBody(row.kind, row.body);
    const draft = { kind: row.kind, body: row.body } as RecordDraft;
    const correlations = projectRecordCorrelations(draft);
    exactKeys(
      row,
      ["seq", "atMs", "kind", "body", ...Object.keys(correlations)],
      [],
      "record",
    );
    safeInteger(row.seq, "record.seq", 1);
    safeInteger(row.atMs, "record.atMs");
    sameCorrelations(row, correlations, "record");
    return value as unknown as LogRecord;
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
