import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createCampaign, openReader } from "elenx";

import { createPiRoles } from "../pi-roles";
import { inspectCampaign } from "../role-cli";
import { applicationId } from "../roles";
import { workflowConfiguration } from "../workflow";
import {
  campaignPath,
  cleanupCampaigns,
  dependencies,
  roleSettings,
} from "./harness";

afterEach(cleanupCampaigns);

test("inspection uses one journal prefix when Explorer finishes during the read", async () => {
  const config = workflowConfiguration({
    task: { problem: "Prove P.", completionCriteria: "Prove P fully." },
    settings: roleSettings(),
  });
  const fixturePath = campaignPath();
  const fixture = createCampaign(fixturePath, applicationId, config);
  try {
    await createPiRoles(
      fixture,
      config.settings,
      dependencies([
        { submission: { notes: [{ text: "A partial result.", support: [] }] } },
      ]),
    ).explorer({
      task: config.task,
      explorerGuidance: "",
      notes: [],
      support: [],
    });
  } finally {
    fixture.close();
  }
  using source = new Database(fixturePath, { readonly: true });
  const appended = source
    .query<{ seq: number; at_ms: number; kind: string; body: string }, []>(
      "SELECT seq, at_ms, kind, body FROM entries WHERE seq > 1 ORDER BY seq",
    )
    .all();
  const path = campaignPath();
  createCampaign(path, applicationId, config).close();
  using writer = new Database(path);
  const reader = openReader(path);
  const prototype = Object.getPrototypeOf(reader) as typeof reader;
  reader.close();
  const original = prototype.records;
  let reads = 0;
  // A writer may append immediately after the reader's SELECT returns.
  // Copy a valid completed call to make that interleaving deterministic.
  prototype.records = function () {
    const records = original.call(this);
    reads += 1;
    if (reads === 1) {
      for (const row of appended) {
        writer.run(
          "INSERT INTO entries(seq, at_ms, kind, body) VALUES (?, ?, ?, ?)",
          [row.seq, row.at_ms, row.kind, row.body],
        );
      }
    }
    return records;
  };
  let report;
  try {
    report = await inspectCampaign(path, { includeGuidance: true });
  } finally {
    prototype.records = original;
  }
  expect(reads).toBe(1);
  expect(report).toMatchObject({
    phase: "explorer",
    notes: [],
    calls: [],
    guidance: [],
    spend: { logicalProviderRequests: 0 },
    accounting: { complete: true, measuredCostUsd: 0 },
  });
  expect(report).not.toHaveProperty("result");
  expect(await inspectCampaign(path)).toMatchObject({
    phase: "coordinator",
    notes: [{ id: "n1" }],
    calls: [{ role: "explorer" }],
    spend: { logicalProviderRequests: 1 },
  });
});
