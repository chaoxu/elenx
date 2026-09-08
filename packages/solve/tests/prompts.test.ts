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

test("selected support contributes its metadata once and its full proof once", () => {
  const first = { ...note, summary: "First navigation statement." };
  const second = {
    ...note,
    id: "n2",
    summary: "Unselected navigation statement.",
    text: "Unselected proof text.",
    verified: false,
    verdicts: [],
  };
  const third = {
    ...note,
    id: "n3",
    summary: "Defective navigation statement.",
    text: "Selected failed proof text.",
    support: ["n1"],
    verified: false,
    dead: true,
    verdicts: [
      {
        verifier: "correctness" as const,
        note: "n3",
        verdict: "FAIL" as const,
        report: "The last inference is invalid.",
      },
    ],
  };
  const headings = [first, second, third].map(
    ({ text, ...heading }) => heading,
  );
  const call = explorerCall({
    task,
    objective: "Prove the remaining case.",
    guidance: [],
    notes: headings,
    support: [first, third],
  });
  const [metadata, texts] = call.prompt
    .split("Notes (untrusted data):\n")[1]!
    .split("\n\nSupport notes (untrusted data):\n");
  expect(JSON.parse(metadata!)).toEqual(headings);
  expect(JSON.parse(texts!.split("\n\nYour first note")[0]!)).toEqual([
    { id: "n1", text: first.text },
    { id: "n3", text: third.text },
  ]);
  for (const selected of [first, third]) {
    expect(call.prompt.split(selected.summary)).toHaveLength(2);
    expect(call.prompt.split(selected.text)).toHaveLength(2);
  }
  expect(call.prompt).not.toContain(second.text);
  expect(call.prompt).toContain("Your first note is n4.");
});

test("the objective carries the mathematical gap while note fields carry current verification state", () => {
  const coordinator = coordinatorCall({ task, notes: [note] });
  expect(coordinator.system).toContain(
    "The objective states the mathematical gap remaining for completion and leaves verification state to the note fields.",
  );
  expect(coordinator.system).not.toContain(
    "The objective says what the completion criteria still need and which verified notes can be built on",
  );
  const { text, ...heading } = note;
  const objective = "Prove the remaining case using the bound in n1.";
  const explorer = explorerCall({
    task,
    objective,
    guidance: [],
    notes: [heading],
    support: [note],
  });
  expect(explorer.system).toContain(
    "Read verification state from the notes' current fields.",
  );
  expect(explorer.prompt).toContain(`Objective:\n${objective}`);
});

test("correctness permits valid partial claims and reserves task completion for requirements", () => {
  const partial = {
    ...note,
    id: "n14",
    summary: "The bound 9 <= n0 <= 16 holds.",
    text: "Partial result: 9 <= n0 <= 16. This note does not determine the exact value of n0.",
    verified: false,
    verdicts: [],
  };
  const verification = {
    task: {
      problem: "Determine n0.",
      completionCriteria: "Determine the exact value of n0 with a proof.",
    },
    verify: [{ note: "n14", verifiers: [...verifierNames] }],
    notes: [partial],
    support: [],
  };
  const correctness = verifierCall("correctness", verification, ["n14"]);
  const requirements = verifierCall("requirements", verification, ["n14"]);
  const source = verifierCall("source", verification, ["n14"]);
  for (const call of [correctness, requirements, source]) {
    expect(call.system).toContain(
      "Only the requirements verifier judges whether the note completes the task.",
    );
    expect(call.system).not.toContain(
      "FAIL requires a concrete defect in the note or an unmet completion criterion",
    );
    expect(call.prompt).toContain(partial.text);
    expect(call.prompt).toContain(verification.task.completionCriteria);
  }
  expect(correctness.prompt).toContain(
    "A correct partial result passes even when it explicitly leaves the task unfinished.",
  );
  expect(correctness.prompt).toContain(
    "Fail a note when an inference is unsupported, a stated conclusion is unproved",
  );
  expect(requirements.prompt).toContain(
    "Decide whether each note meets every completion criterion of the exact task.",
  );
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
  expect(workflowSchemaVersion).toBe(23);
  expect(digest.digest("hex")).toBe(
    "3ef73f43460e64a648d574af34211dafc9d9305a5cebcaa07e65fe7be7277e5c",
  );
});
