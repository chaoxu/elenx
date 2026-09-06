import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { EntryId } from "elenx";

import {
  coordinatorCall,
  explorerCall,
  reconstructionCall,
  sourceCall,
  statementCall,
  proofCall,
  verifierCall,
} from "../pi-roles";
import { verifierNames } from "../roles";
import { workflowSchemaVersion } from "../workflow";

const task = { problem: "Prove P.", completionCriteria: "Prove P fully." };

const note = {
  id: "n1",
  summary: "P holds.",
  text: "Proof of P.",
  support: [],
  verified: true,
  dead: false,
  verdicts: [
    {
      verifier: "correctness" as const,
      note: "n1",
      verdict: "PASS" as const,
      report: "Sound.",
    },
  ],
};

test("the explorer's guidance follows its fixed instructions", () => {
  const input = { task, objective: "Extend P.", notes: [], support: [] };
  expect(
    explorerCall({ ...input, guidance: ["Say G.", "Then H."] }).system,
  ).toContain(
    "as support. Say G. Then H. Do not use web search or external tools.",
  );
  expect(explorerCall({ ...input, guidance: [] }).system).toContain(
    "as support. Do not use web search or external tools.",
  );
});

test("abandonment guidance is confined to the explorer treatment", () => {
  const input = { task, objective: "Extend P.", notes: [], support: [] };
  const guidance =
    "Abandon approaches whose remaining gaps are hard to repair.";
  const baseline = explorerCall({ ...input, guidance: [] });
  const treatment = explorerCall({ ...input, guidance: [guidance] });
  expect(treatment.system.replace(`${guidance} `, "")).toBe(baseline.system);
  expect(treatment.prompt).toBe(baseline.prompt);
  const coordinator = coordinatorCall({ task, notes: [note] });
  expect(coordinator.system).not.toContain("is abandoned");
  expect(coordinator.system).not.toContain("asks for a different one");
  expect(coordinator.system).not.toContain(guidance);
});

test("prompt bytes are frozen with the workflow schema version", () => {
  const { text, ...heading } = note;
  const second = {
    ...note,
    id: "n2",
    support: ["n1"],
    verified: false,
    verdicts: [],
  };
  const verification = {
    task,
    verify: [{ note: "n2", verifiers: [...verifierNames] }],
    notes: [second],
    support: [note],
  };
  const calls: { label: string; system: string; prompt: string }[] = [
    explorerCall({
      task,
      guidance: ["Test the degenerate instances first."],
      objective: "Extend P.",
      notes: [heading],
      support: [note],
    }),
    coordinatorCall({ task, notes: [note, second] }),
    verifierCall("source", verification, ["n2"]),
    verifierCall("correctness", verification, ["n2"]),
    verifierCall("requirements", verification, ["n2"]),
  ];
  const stated = { statement: "P holds." };
  calls.push(
    statementCall(verification, second),
    proofCall(verification, second, stated),
    reconstructionCall(verification, second, stated, "Independent proof of P."),
    proofCall(verification, second, stated, 42 as EntryId),
    reconstructionCall(
      verification,
      second,
      stated,
      "Independent proof of P.",
      42 as EntryId,
    ),
  );
  const source = sourceCall(
    { provider: "codex", model: "codex-model", reasoning: "low", search: true },
    verification,
    ["n2"],
  );
  const digest = createHash("sha256");
  for (const call of calls) {
    digest.update(`${call.label}\n${call.system}\n${call.prompt}\n`);
  }
  const offline = sourceCall(
    {
      provider: "codex",
      model: "codex-model",
      reasoning: "low",
      search: false,
    },
    verification,
    ["n2"],
  );
  for (const call of [source, offline]) {
    digest.update(
      `${call.label}\n${call.request.developerInstructions}\n${call.request.prompt}\n`,
    );
  }
  // Changing any role prompt changes the bytes the workflow fold matches
  // against journals, so bump workflowSchemaVersion and update this digest
  // in the same change.
  expect(workflowSchemaVersion).toBe(19);
  expect(digest.digest("hex")).toBe(
    "3744462682b371b287f4ee3fd362164d716ed99ae81780f1ff0e1872c4ae2451",
  );
});
