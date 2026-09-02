import { Database, SQLiteError } from "bun:sqlite";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { builtinPi } from "elenx/pi";

export type SolveModels = Pick<
  ReturnType<typeof builtinPi>,
  "getModel" | "streamSimple"
>;

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
