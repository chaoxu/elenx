import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  coordinatorCall,
  explorerCall,
  sourceCall,
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
  const calls = [
    explorerCall({
      task,
      objective: "Extend P.",
      notes: [heading],
      support: [note],
    }),
    coordinatorCall({
      task,
      notes: [note, { id: "n2", text, support: ["n1"], verdicts: [] }],
    }),
    ...verifierNames
      .filter((name) => name !== "source")
      .map((name) =>
        verifierCall(name, {
          task,
          note: { ...note, id: "n2", support: ["n1"] },
          support: [note],
        }),
      ),
  ];
  const source = sourceCall(
    { provider: "codex", model: "codex-model", reasoning: "low" },
    { task, note: { ...note, id: "n2", support: ["n1"] }, support: [note] },
  );
  const digest = createHash("sha256");
  for (const call of calls) {
    digest.update(`${call.label}\n${call.system}\n${call.prompt}\n`);
  }
  digest.update(
    `${source.label}\n${source.request.developerInstructions}\n${source.request.prompt}\n`,
  );
  // Changing any role prompt changes the bytes the workflow fold matches
  // against journals, so bump workflowSchemaVersion and update this digest
  // in the same change.
  expect(workflowSchemaVersion).toBe(7);
  expect(digest.digest("hex")).toBe(
    "6790117e6ad9c51e3366a7a14ed251675d99b775309a8946eda6d1251d87da4a",
  );
});
