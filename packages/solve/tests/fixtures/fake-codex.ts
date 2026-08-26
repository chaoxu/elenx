#!/usr/bin/env bun

import { appendFile, readFile, readdir, realpath } from "node:fs/promises";

const args = Bun.argv.slice(2);
const capturePath = process.env["FAKE_CODEX_CAPTURE"];
if (capturePath === undefined) throw new Error("missing capture path");

const codexHome = process.env["CODEX_HOME"];
if (codexHome === undefined) throw new Error("missing CODEX_HOME");
const input = args.includes("exec") ? await Bun.stdin.text() : "";
const option = (name: string): string => {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || value === undefined) throw new Error(`missing ${name}`);
  return value;
};
const capture = {
  args,
  input,
  cwd: process.cwd(),
  codexHome,
  homeEntries: await readdir(codexHome),
  authTarget: await realpath(`${codexHome}/auth.json`),
  remotePayloadPresent: process.env["CODEX_REMOTE_PAYLOAD"] !== undefined,
  threadIdPresent: process.env["CODEX_THREAD_ID"] !== undefined,
  ...(args.includes("exec")
    ? {
        schema: JSON.parse(await readFile(option("--output-schema"), "utf8")),
      }
    : {}),
};
await appendFile(capturePath, `${JSON.stringify(capture)}\n`);

if (args[0] === "--version") {
  console.log("codex-cli fake-1.0");
} else if (process.env["FAKE_CODEX_MODE"] === "malformed") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "fake" }));
  console.log("{");
  process.exitCode = 17;
} else if (process.env["FAKE_CODEX_MODE"] === "wait") {
  await Bun.sleep(10_000);
} else {
  const statement = process.env["FAKE_CODEX_STATEMENT"];
  if (statement === undefined) throw new Error("missing statement");
  const resolution = {
    statement,
    standing: "UNESTABLISHED",
    citation: null,
    url: null,
    locator: null,
    exactQuote: null,
    sourceMatch: null,
    candidateSourceMatch: null,
    candidateSourceCheck: null,
    refutationAttempt: "Checked the smallest cases.",
    refutation: null,
    gap: "No exact source or refutation was found.",
    application: "APPLIES",
    applicationCheck: "The stated hypotheses match conditionally.",
  };
  const result = { report: "Search completed.", resolutions: [resolution] };
  for (const event of [
    { type: "thread.started", thread_id: "fake" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { type: "web_search", query: "authoritative source" },
    },
    {
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(result) },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 2,
        cache_write_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 1,
      },
    },
  ]) {
    console.log(JSON.stringify(event));
  }
}
