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
  expect(workflowSchemaVersion).toBe(3);
  expect(digest.digest("hex")).toBe(
    "37112c35d7768ecccb06c366c490e3406f1310a4d8c1441f5751df58edee2bd9",
  );
});
