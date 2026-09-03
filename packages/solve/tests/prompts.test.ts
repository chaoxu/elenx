import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

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
  const calls: { label: string; system: string; prompt: string }[] = [
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
      .filter((name) => name !== "source" && name !== "reconstruction")
      .map((name) =>
        verifierCall(name, {
          task,
          note: { ...note, id: "n2", support: ["n1"] },
          support: [note],
        }),
      ),
  ];
  const verification = {
    task,
    note: { ...note, id: "n2", support: ["n1"] },
    support: [note],
  };
  const stated = {
    statement: "P holds.",
    support: [{ note: "n1", statement: "P holds." }],
  };
  calls.push(
    statementCall(verification),
    proofCall(verification, stated),
    reconstructionCall(verification, stated, "Independent proof of P."),
  );
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
  expect(workflowSchemaVersion).toBe(8);
  expect(digest.digest("hex")).toBe(
    "52561c1162784e38d03244b0f2ad0e6594a56945048269af5fba3df4d7d72bc6",
  );
});
