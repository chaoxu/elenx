import { afterEach, expect, test } from "bun:test";
import { openReader } from "elenx";

import { coordinatorCall } from "../pi-roles";
import { run } from "../runner";
import { deriveWorkflow } from "../workflow";
import {
  campaignPath,
  cleanupCampaigns,
  dependencies,
  roleSettings,
} from "./harness";

afterEach(cleanupCampaigns);
const task = { problem: "Prove P.", completionCriteria: "Prove P fully." };

test("free retains the released coordinator request and repertoire changes only instructions", () => {
  const input = { task, notes: [] };
  const free = coordinatorCall(input, "free");
  expect(free).toEqual(coordinatorCall(input));
  const repertoire = coordinatorCall(input, "repertoire");
  expect({ ...repertoire, system: free.system }).toEqual(free);
  expect(repertoire.system).toContain("Reconsider the bridge:");
  expect(repertoire.system).toContain(
    "The explorer may reject your assessment",
  );
});

test.each(["free", "repertoire"] as const)(
  "%s is frozen, replayable, and delivered through ordinary Explorer guidance",
  async (coordinatorStrategy) => {
    const settings = {
      ...roleSettings(),
      maxExplorerTurns: 2,
      coordinatorStrategy,
    };
    const campaign = campaignPath();
    const replies = [1, 2].flatMap((index) => [
      {
        submission: {
          notes: [{ text: `Partial result ${index}.`, support: [] }],
        },
      },
      {
        submission: {
          filings: [{ note: `n${index}`, summary: `Partial result ${index}.` }],
          explorerGuidance: "Continue: settle the remaining case.",
          support: [],
          verify: [],
        },
      },
    ]);
    const drive = dependencies(replies);
    const request = { task, settings, campaignPath: campaign };
    expect((await run(request, drive)).outcome).toBe("turn-limit");
    const coordinators = drive.calls.filter(
      (call) => call.role === "coordinator",
    );
    expect(coordinators).toHaveLength(2);
    for (const call of coordinators) {
      expect(call.system?.includes("Reconsider the bridge:")).toBe(
        coordinatorStrategy === "repertoire",
      );
    }
    const explorers = drive.calls.filter((call) => call.role === "explorer");
    expect(explorers[0]!.prompt).not.toContain(
      "Continue: settle the remaining case.",
    );
    expect(explorers[1]!.prompt).toContain(
      "Continue: settle the remaining case.",
    );
    expect(explorers[0]!.system).toBe(explorers[1]!.system);
    const reader = openReader(campaign);
    const records = [...reader.records()];
    reader.close();
    expect((await deriveWorkflow(records)).phase.kind).toBe("turn-limit");
    const replay = dependencies([]);
    expect((await run(request, replay)).outcome).toBe("turn-limit");
    expect(replay.calls).toHaveLength(0);
    const other = coordinatorStrategy === "free" ? "repertoire" : "free";
    await expect(
      run(
        { ...request, settings: { ...settings, coordinatorStrategy: other } },
        replay,
      ),
    ).rejects.toThrow("task or settings disagree");
    const declaration = records[0]!;
    if (declaration.kind !== "campaign") throw new Error("missing declaration");
    const changed = [
      {
        ...declaration,
        config: {
          ...(declaration.config as Record<string, unknown>),
          settings: { ...settings, coordinatorStrategy: other },
        },
      },
      ...records.slice(1),
    ];
    await expect(deriveWorkflow(changed)).rejects.toThrow(
      "does not match the derived coordinator request",
    );
  },
);
