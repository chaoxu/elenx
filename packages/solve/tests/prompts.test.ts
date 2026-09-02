import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { coordinatorTurn, explorerTurn, verifierTurn } from "../pi-roles";
import { verifierNames } from "../roles";
import { workflowSchemaVersion } from "../workflow";

const task = { problem: "Prove P.", completionCriteria: "Prove P fully." };
const note = {
  id: "n1",
  summary: "P holds.",
  text: "Proof of P.",
  verdicts: [
    {
      verifier: "correctness" as const,
      note: "n1",
      verdict: "PASS" as const,
      report: "Sound.",
    },
  ],
};

test("prompt bytes are frozen with the workflow schema version", () => {
  const { text, ...heading } = note;
  const turns = [
    explorerTurn({
      task,
      objective: "Extend P.",
      notes: [heading],
      support: [note],
    }),
    coordinatorTurn({ task, notes: [note, { id: "n2", text, verdicts: [] }] }),
    ...verifierNames.map((name) =>
      verifierTurn(name, {
        task,
        note: { ...note, id: "n2" },
        support: [note],
      }),
    ),
  ];
  const digest = createHash("sha256");
  for (const turn of turns) {
    digest.update(`${turn.label}\n${turn.system}\n${turn.prompt}\n`);
  }
  // Changing any role prompt changes the bytes the workflow fold matches
  // against journals, so bump workflowSchemaVersion and update this digest
  // in the same change.
  expect(workflowSchemaVersion).toBe(4);
  expect(digest.digest("hex")).toBe(
    "fa03e7a3d840d17c42e244de83504c26a5a58d141a1e3151b80e4a7555d8eb57",
  );
});
