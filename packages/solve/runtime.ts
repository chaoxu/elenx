import { Database, SQLiteError } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { builtinPi, type PiRunOptions } from "elenx/pi";

import type { SourceCheck } from "./verifiers/source-check";

export type SolveModels = Pick<
  ReturnType<typeof builtinPi>,
  "getModel" | "streamSimple"
>;

export interface SolveDependencies {
  readonly models?: SolveModels;
  readonly run?: typeof import("elenx/pi").runPi;
  readonly sourceCheck?: SourceCheck;
  readonly signal?: AbortSignal;
  readonly pauseRequested?: () => boolean;
  readonly status?: (message: string) => void;
  readonly callFailureRetry?: CallFailureRetry;
}

export interface CallFailureRetry {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

// Transient provider failures are absorbed inside the campaign loop: a
// failed call stays in the journal, the phase is re-derived, and a fresh
// call runs after capped exponential backoff. Only this many consecutive
// failures end the session with a call-failure report.
export const DEFAULT_CALL_FAILURE_RETRY: CallFailureRetry = {
  attempts: 12,
  baseDelayMs: 60_000,
  maxDelayMs: 600_000,
};

function runnerLockPath(campaignPath: string): string {
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(campaignPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    canonicalPath = join(
      realpathSync(dirname(campaignPath)),
      basename(campaignPath),
    );
  }
  return `${canonicalPath}.runner.lock`;
}

export async function withCampaignLock<T>(
  campaignPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  using lock = new Database(runnerLockPath(campaignPath), {
    create: true,
  });
  lock.run("PRAGMA busy_timeout = 0");
  try {
    lock.run("BEGIN EXCLUSIVE");
  } catch (error) {
    if (error instanceof SQLiteError && error.code?.startsWith("SQLITE_BUSY")) {
      throw new Error(
        `campaign already has a running process: ${campaignPath}`,
        { cause: error },
      );
    }
    throw error;
  }
  return await operation();
}

export function selectModel(
  models: SolveModels,
  selection: { readonly provider: string; readonly modelId: string },
) {
  const model = models.getModel(selection.provider, selection.modelId);
  if (model === undefined) {
    throw new Error(
      `unknown Pi model: ${selection.provider}/${selection.modelId}`,
    );
  }
  return model;
}

export type PreparedPiOptions = Pick<PiRunOptions, "models" | "model"> &
  Partial<Pick<PiRunOptions, "reasoning" | "signal">>;

export class CallFailure extends Error {
  readonly call: number;
  readonly state: "failed" | "cancelled";
  readonly providerRetryable: boolean;

  constructor(
    call: number,
    state: "failed" | "cancelled",
    message: string,
    providerRetryable = false,
  ) {
    super(message);
    this.name = "CallFailure";
    this.call = call;
    this.state = state;
    this.providerRetryable = providerRetryable;
  }
}
