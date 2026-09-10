import { afterEach, expect, test } from "bun:test";
import { createCampaign } from "elenx";
import { z } from "zod";

import {
  createPiRoles,
  explorerCall,
  sameRequest,
  solveSettings,
} from "../pi-roles";
import { inspectCampaign } from "../role-cli";
import { init, run } from "../runner";
import { applicationId } from "../roles";
import {
  deriveWorkflow,
  runWorkflow,
  workflowConfiguration,
} from "../workflow";
import {
  campaignPath,
  cleanupCampaigns,
  dependencies,
  roleSettings,
} from "./harness";

afterEach(cleanupCampaigns);
const task = { problem: "Prove P.", completionCriteria: "Prove P fully." };
const input = {
  task,
  explorerGuidance: "Investigate the remaining case.",
  notes: [],
  support: [],
};
const note = { text: "An alleged complete proof.", support: [] };

test("Explorer continuation defaults off and only its enabled schema requires a solution claim", () => {
  const ordinary = explorerCall(input),
    off = explorerCall(input, false),
    on = explorerCall(input, true);
  expect(off.system).toBe(ordinary.system);
  expect(off.prompt).toBe(ordinary.prompt);
  expect(z.toJSONSchema(off.schema)).toEqual(z.toJSONSchema(ordinary.schema));
  expect(off.continuation).toBeUndefined();
  expect(on.continuation).toBe(true);
  expect(ordinary.schema.safeParse({ notes: [note] }).success).toBe(true);
  expect(
    ordinary.schema.safeParse({ notes: [note], solution: false }).success,
  ).toBe(false);
  expect(on.schema.safeParse({ notes: [note] }).success).toBe(false);
  expect(on.schema.safeParse({ notes: [note], solution: "true" }).success).toBe(
    false,
  );
  for (const solution of [false, true])
    expect(on.schema.parse({ notes: [note], solution })).toHaveProperty(
      "solution",
      solution,
    );
  expect(on.system).toContain("does not bypass mathematical verification");
  expect(
    solveSettings.parse(roleSettings()).explorerContinuation,
  ).toBeUndefined();
  expect(
    solveSettings.parse({ ...roleSettings(), explorerContinuation: false })
      .explorerContinuation,
  ).toBe(false);
});

test("only enabled Explorer calls receive the gate; a solution claim still goes through ordinary verification", async () => {
  const path = campaignPath(),
    settings = {
      ...roleSettings(),
      maxExplorerTurns: 1,
      explorerContinuation: true,
    };
  const config = workflowConfiguration({ task, settings }),
    campaign = createCampaign(path, applicationId, config);
  const drive = dependencies([
    { submission: { notes: [note], solution: true } },
    {
      submission: {
        filings: [{ note: "n1", summary: "A claimed proof." }],
        explorerGuidance: "Check it.",
        support: [],
        verify: [{ note: "n1", verifiers: ["source", "correctness"] }],
      },
    },
    {
      codex: {
        verdicts: [
          {
            note: "n1",
            verdict: "PASS",
            report: "No external result.",
            sources: [],
          },
        ],
      },
    },
    {
      submission: {
        verdicts: [
          { note: "n1", verdict: "FAIL", report: "The claim is false." },
        ],
      },
    },
  ]);
  try {
    const result = await runWorkflow(
      campaign,
      createPiRoles(campaign, config.settings, drive),
    );
    expect(result.kind).toBe("turn-limit");
    expect(drive.calls[0]?.submissionGate).toEqual({
      tool: "submit_notes",
      completeArgument: "solution",
      reserveTokens: 20_000,
    });
    expect(
      drive.calls.slice(1).every((call) => call.submissionGate === undefined),
    ).toBe(true);
    expect(drive.calls.map((call) => call.role)).toEqual([
      "explorer",
      "coordinator",
      "verifier",
    ]);
    const inspection: any = await inspectCampaign(path);
    expect(inspection.calls[0].submission.solution).toBe(true);
    expect(inspection.result.outcome).toBe("turn-limit");
    const explored = campaign
      .records()
      .find((entry) => entry.kind === "call" && entry.role === "explorer")!;
    if (explored.kind !== "call") throw new Error("fixture");
    expect(
      sameRequest(
        explored.request,
        explorerCall({ ...input, explorerGuidance: "" }, true),
      ),
    ).toBe(true);
    const altered: any = structuredClone(explored.request);
    delete altered.submissionGate;
    expect(
      sameRequest(
        altered,
        explorerCall({ ...input, explorerGuidance: "" }, true),
      ),
    ).toBe(false);
    altered.submissionGate = {
      ...drive.calls[0]!.submissionGate,
      reserveTokens: 1024,
    };
    expect(
      sameRequest(
        altered,
        explorerCall({ ...input, explorerGuidance: "" }, true),
      ),
    ).toBe(false);
    expect((await deriveWorkflow(campaign.records())).phase.kind).toBe(
      "turn-limit",
    );
  } finally {
    campaign.close();
  }
});

test("explicitly disabled Explorer omits the kernel gate", async () => {
  const campaign = createCampaign(campaignPath(), applicationId, {
    kind: "calls",
  });
  const drive = dependencies([{ submission: { notes: [note] } }]);
  try {
    await createPiRoles(
      campaign,
      { ...roleSettings(), explorerContinuation: false },
      drive,
    ).explorer(input);
    expect(drive.calls[0]?.submissionGate).toBeUndefined();
  } finally {
    campaign.close();
  }
});

test("continuation remains part of the exact frozen settings on resume", async () => {
  const path = campaignPath(),
    settings = { ...roleSettings(), explorerContinuation: true };
  await init({ task, campaignPath: path, settings });
  const before = await Bun.file(path).arrayBuffer();
  await expect(
    run(
      {
        task,
        campaignPath: path,
        settings: { ...settings, explorerContinuation: false },
      },
      {
        models: async () => {
          throw new Error("must reject the change before provider setup");
        },
      },
    ),
  ).rejects.toThrow("task or settings disagree");
  expect(await Bun.file(path).arrayBuffer()).toEqual(before);
  expect(await init({ task, campaignPath: path, settings })).toMatchObject({
    created: false,
  });
});
