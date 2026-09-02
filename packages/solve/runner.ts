import { isDeepStrictEqual } from "node:util";

import { createCampaign, openCampaign, type Campaign } from "elenx";
import { builtinPi } from "elenx/pi";
import { z } from "zod";

import {
  createPiRoles,
  piRoleSettings,
  RoleCallError,
  type PiRoleDependencies,
  type PiRoleSettings,
} from "./pi-roles";
import { roleApplication, task } from "./roles";
import { withCampaignLock } from "./runtime";
import {
  deriveWorkflow,
  runWorkflow,
  workflowConfig,
  workflowConfiguration,
  type RunReport,
  type WorkflowConfig,
} from "./workflow";

export const settings = piRoleSettings;
export type Settings = PiRoleSettings;

const startRequest = z.strictObject({
  problem: z.string().min(1),
  completionCriteria: z.string().min(1),
  campaignPath: z.string().min(1),
  settings: piRoleSettings,
});
const resumeRequest = z.strictObject({
  campaignPath: z.string().min(1),
  settings: piRoleSettings,
});

export interface RunDependencies extends Omit<PiRoleDependencies, "models"> {
  readonly models?: PiRoleDependencies["models"];
  readonly pauseRequested?: () => boolean;
  readonly status?: (message: string) => void;
}

function configFor(
  problem: string,
  completionCriteria: string,
  settings: Settings,
): WorkflowConfig {
  return workflowConfiguration({
    task: task.parse({ problem, completionCriteria }),
    objective: "Produce a complete solution or a decisive refutation.",
    maxExplorerTurns: settings.maxExplorerTurns,
    settings,
  });
}

function reportFromPhase(
  phase: ReturnType<typeof deriveWorkflow>["phase"],
): RunReport {
  if (phase.kind === "accepted" || phase.kind === "refuted") {
    return {
      outcome: "solved",
      phase: "solved",
      candidate: phase.candidate,
      candidateKind: phase.kind === "accepted" ? "solution" : "refutation",
    };
  }
  if (phase.kind === "turn-limit") {
    return {
      outcome: "turn-limit",
      phase: "turn-limit",
      reason: `explorer turns ${phase.turns} reached maxExplorerTurns`,
    };
  }
  return { outcome: "paused", phase: phase.kind };
}

async function drive(
  campaign: Campaign,
  config: WorkflowConfig,
  dependencies: RunDependencies,
): Promise<RunReport> {
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
    return reportFromPhase(phase);
  } catch (error) {
    if (dependencies.signal?.aborted) {
      return {
        outcome: "interrupted",
        phase: deriveWorkflow(campaign).phase.kind,
        reason: "operator interruption",
      };
    }
    if (error instanceof RoleCallError) {
      return {
        outcome: "call-failure",
        phase: deriveWorkflow(campaign).phase.kind,
        reason: error.message,
      };
    }
    throw error;
  } finally {
    campaign.close();
  }
}

export async function start(
  input: z.input<typeof startRequest>,
  dependencies: RunDependencies = {},
): Promise<RunReport> {
  const request = startRequest.parse(input);
  const config = configFor(
    request.problem,
    request.completionCriteria,
    request.settings,
  );
  return withCampaignLock(request.campaignPath, () =>
    drive(
      createCampaign(request.campaignPath, roleApplication, config),
      config,
      dependencies,
    ),
  );
}

export async function resume(
  input: z.input<typeof resumeRequest>,
  dependencies: RunDependencies = {},
): Promise<RunReport> {
  const request = resumeRequest.parse(input);
  return withCampaignLock(request.campaignPath, async () => {
    const campaign = openCampaign(request.campaignPath);
    let config: WorkflowConfig;
    try {
      const declaration = campaign.records()[0];
      config = workflowConfig.parse(
        declaration?.kind === "campaign" ? declaration.config : undefined,
      );
      if (!isDeepStrictEqual(config.settings, request.settings)) {
        throw new Error("settings disagree with the workflow journal");
      }
    } catch (error) {
      campaign.close();
      throw error;
    }
    return drive(campaign, config, dependencies);
  });
}
