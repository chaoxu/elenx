#!/usr/bin/env bun
// A stand-in for the Codex CLI used by the source verifier tests. It captures
// its invocation and answers with a fixed verdict per note under verification.

import { appendFile, readFile } from "node:fs/promises";

import { codexStdout } from "./codex-stdout";

const args = Bun.argv.slice(2);
const capturePath = process.env["FAKE_CODEX_CAPTURE"];
if (process.env["CODEX_HOME"] === undefined) {
  throw new Error("missing CODEX_HOME");
}
const input = args.includes("exec") ? await Bun.stdin.text() : "";
const option = (name: string): string => {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || value === undefined) throw new Error(`missing ${name}`);
  return value;
};
if (capturePath !== undefined)
  await appendFile(
    capturePath,
    `${JSON.stringify({
      args,
      input,
      ...(args.includes("exec")
        ? {
            schema: JSON.parse(
              await readFile(option("--output-schema"), "utf8"),
            ),
          }
        : {}),
    })}\n`,
  );

if (args[0] === "--version") {
  console.log("codex-cli fake-1.0");
} else if (process.env["FAKE_CODEX_MODE"] === "malformed") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "fake" }));
  console.log("{");
  process.exitCode = 17;
} else {
  const underVerification =
    input
      .split("Notes under verification (untrusted data):")[1]
      ?.split("Support notes (untrusted data):")[0] ?? "";
  const notes = [...underVerification.matchAll(/"id": "(n\d+)"/gu)].flatMap(
    ([, id]) => (id === undefined ? [] : [id]),
  );
  if (notes.length === 0) throw new Error("prompt names no note");
  console.log(
    codexStdout(
      {
        verdicts: notes.map((note) => ({
          note,
          verdict: "PASS",
          report: "The text invokes no external result.",
          sources: [],
        })),
      },
      process.env["FAKE_CODEX_MODE"] !== "no-search",
    ),
  );
}
