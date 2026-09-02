import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { createCampaign, openCampaign, type Campaign } from "elenx";
import { builtinPi } from "elenx/pi";
import { z } from "zod";

import {
  createPiRoles,
  RoleCallError,
  solveSettings,
  type PiRoleDependencies,
  type SolveSettings,
} from "./pi-roles";
import { applicationId, task } from "./roles";
import { withCampaignLock } from "./runtime";
import {
  deriveWorkflow,
  runWorkflow,
  workflowConfig,
  workflowConfiguration,
  workflowResult,
  type WorkflowConfig,
  type WorkflowResult,
} from "./workflow";

export const settings = solveSettings;
export type Settings = SolveSettings;

const runRequest = z.strictObject({
  task,
  campaignPath: z.string().min(1),
  settings: solveSettings,
});

export interface RunDependencies extends Omit<PiRoleDependencies, "models"> {
  readonly models?: PiRoleDependencies["models"];
  readonly pauseRequested?: () => boolean;
  readonly status?: (message: string) => void;
}

export type RunResult =
  | WorkflowResult
  | {
      readonly outcome: "paused" | "call-failure" | "interrupted";
      readonly at: string;
      readonly reason?: string;
    };

async function drive(
  campaign: Campaign,
  config: WorkflowConfig,
  dependencies: RunDependencies,
): Promise<RunResult> {
  const models = dependencies.models ?? builtinPi();
  const roles = createPiRoles(campaign, config.settings, {
    models,
    ...(dependencies.run === undefined ? {} : { run: dependencies.run }),
    ...(dependencies.signal === undefined
      ? {}
      : { signal: dependencies.signal }),
  });
  try {
    const phase = await runWorkflow(campaign, roles, dependencies);
    if (phase.kind === "accepted" || phase.kind === "turn-limit") {
      return workflowResult(phase);
    }
    return { outcome: "paused", at: phase.kind };
  } catch (error) {
    let at: string;
    try {
      at = deriveWorkflow(campaign).phase.kind;
    } catch {
      throw error;
    }
    if (dependencies.signal?.aborted) {
      return { outcome: "interrupted", at, reason: "operator interruption" };
    }
    if (error instanceof RoleCallError) {
      return { outcome: "call-failure", at, reason: error.message };
    }
    throw error;
  } finally {
    campaign.close();
  }
}

export async function run(
  input: z.input<typeof runRequest>,
  dependencies: RunDependencies = {},
): Promise<RunResult> {
  const request = runRequest.parse(input);
  const config = workflowConfiguration({
    task: request.task,
    settings: request.settings,
  });
  return withCampaignLock(request.campaignPath, () => {
    const campaign = existsSync(request.campaignPath)
      ? openCampaign(request.campaignPath)
      : createCampaign(request.campaignPath, applicationId, config);
    try {
      const declaration = campaign.records()[0];
      const frozen = workflowConfig.parse(
        declaration?.kind === "campaign" ? declaration.config : undefined,
      );
      if (!isDeepStrictEqual(frozen, config)) {
        throw new Error("task or settings disagree with the workflow journal");
      }
    } catch (error) {
      campaign.close();
      throw error;
    }
    return drive(campaign, config, dependencies);
  });
}
