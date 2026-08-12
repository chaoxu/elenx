import type { CallId, DispatchId, Hash, InvocationId } from "./types";

export interface ErrorRef {
  readonly seq?: number;
  readonly candidate?: Hash;
  readonly dispatch?: DispatchId;
  readonly call?: CallId;
  readonly invocation?: InvocationId;
  readonly name?: string;
}

export type RefusalCode =
  | "CAMPAIGN_EXISTS"
  | "CAMPAIGN_NOT_FOUND"
  | "WRITER_LOCKED"
  | "INVALID_ARGUMENT"
  | "UNKNOWN_HANDLER"
  | "UNKNOWN_ADAPTER"
  | "CANDIDATE_CONTRACT_CONFLICT"
  | "INVALID_REBUTTAL"
  | "NOT_PROMOTABLE"
  | "IN_FLIGHT"
  | "UNSUPPORTED_ADAPTER_OPTIONS"
  | "CLOSED";

export type DefectCode =
  | "UNSUPPORTED_SCHEMA"
  | "CORRUPT_RECORD"
  | "MISSING_BLOB"
  | "HASH_MISMATCH"
  | "DUPLICATE_START"
  | "DUPLICATE_TERMINAL"
  | "HANDLER_CONTRACT"
  | "ADAPTER_CONTRACT"
  | "DATABASE"
  | "INVARIANT";

interface ErrorDetails {
  readonly operation: string;
  readonly refs?: readonly ErrorRef[];
  readonly cause?: unknown;
}

export class Refusal extends Error {
  override readonly name = "Refusal";
  readonly code: RefusalCode;
  readonly operation: string;
  readonly refs: readonly ErrorRef[];

  constructor(code: RefusalCode, message: string, details: ErrorDetails) {
    super(message);
    this.code = code;
    this.operation = details.operation;
    this.refs = details.refs ?? [];
  }
}

export class Defect extends Error {
  override readonly name = "Defect";
  readonly code: DefectCode;
  readonly operation: string;
  readonly refs: readonly ErrorRef[];

  constructor(code: DefectCode, message: string, details: ErrorDetails) {
    super(
      message,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.code = code;
    this.operation = details.operation;
    this.refs = details.refs ?? [];
  }
}

export function isRefusal(error: unknown): error is Refusal {
  return error instanceof Refusal;
}

export function isDefect(error: unknown): error is Defect {
  return error instanceof Defect;
}
