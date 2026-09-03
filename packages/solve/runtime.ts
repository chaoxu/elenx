import { Database, SQLiteError } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

import { builtinPi } from "elenx/pi";

export type SolveModels = Pick<
  ReturnType<typeof builtinPi>,
  "getModel" | "streamSimple"
>;

export function codexCommand(environment: NodeJS.ProcessEnv): string {
  return environment["ELENX_CODEX_COMMAND"] ?? "codex";
}

export function modelRegistryPath(
  environment: NodeJS.ProcessEnv,
): string | null {
  const value = environment["ELENX_MODELS_PATH"];
  if (value === undefined) return null;
  if (!isAbsolute(value)) throw new Error("ELENX_MODELS_PATH must be absolute");
  return value;
}

export async function requireCredentials(
  runtime: { readonly checkAuth: (provider: string) => Promise<unknown> },
  providers: readonly string[],
): Promise<void> {
  const missing = (
    await Promise.all(
      [...new Set(providers)].map(async (provider) =>
        (await runtime.checkAuth(provider)) === undefined ? [provider] : [],
      ),
    )
  ).flat();
  if (missing.length > 0) {
    throw new Error(`No credential for provider(s): ${missing.join(", ")}`);
  }
}

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
