import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codexSourceSearch,
  parseSourceStdout,
  sourceAuditDeveloperInstructions,
  sourceAuditOutputSchema,
  sourceAuditRequest,
  sourceEventPrefix,
  type SourceAuditRequest,
} from "../verifiers/source-audit";

const fakeCodex = new URL("./fixtures/fake-codex.ts", import.meta.url).pathname;
const statement =
  "Every finite tree with at least two vertices has two leaves.";
const request: SourceAuditRequest = {
  candidate: 1,
  offlineCall: 2,
  model: "gpt-5.6-luna",
  reasoning: "max",
  developerInstructions: sourceAuditDeveloperInstructions,
  unresolvedStatements: [statement],
  outputSchema: sourceAuditOutputSchema([statement]),
  prompt: "Check the exact theorem.",
};

test("source requests bind their frozen schema to the unresolved statements", () => {
  expect(
    sourceAuditRequest.safeParse({ ...request, outputSchema: {} }).success,
  ).toBe(false);
});

async function fixtureEnvironment(mode?: string) {
  const directory = await mkdtemp(join(tmpdir(), "elenx-source-runner-test-"));
  const originalHome = join(directory, "original-home");
  const capture = join(directory, "capture.jsonl");
  await mkdir(originalHome);
  await writeFile(join(originalHome, "auth.json"), "{}");
  return {
    directory,
    capture,
    environment: {
      ...process.env,
      CODEX_HOME: originalHome,
      CODEX_REMOTE_PAYLOAD: "must-not-leak",
      CODEX_THREAD_ID: "must-not-leak",
      FAKE_CODEX_CAPTURE: capture,
      FAKE_CODEX_STATEMENT: statement,
      ...(mode === undefined ? {} : { FAKE_CODEX_MODE: mode }),
    },
  };
}

async function captures(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("Codex source search isolates context and preserves auditable output", async () => {
  const fixture = await fixtureEnvironment();
  try {
    const search = codexSourceSearch({
      command: fakeCodex,
      environment: fixture.environment,
    });
    const result = await search(request);
    expect(result).toMatchObject({
      state: "succeeded",
      codexVersion: "codex-cli fake-1.0",
    });
    if (result.state !== "succeeded") throw new Error(result.error);
    expect(result).not.toHaveProperty("events");
    expect(result).not.toHaveProperty("result");
    const parsed = parseSourceStdout(request, result.stdout);
    expect(parsed.result).toMatchObject({
      resolutions: [{ statement, standing: "UNESTABLISHED" }],
    });
    expect(parsed).toMatchObject({
      queries: ["authoritative source"],
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        cacheWriteInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 1,
      },
    });

    const invocations = await captures(fixture.capture);
    expect(invocations).toHaveLength(2);
    const execution = invocations[1]!;
    const args = execution.args as string[];
    const configs = args.flatMap((argument, index) =>
      argument === "-c" ? [args[index + 1]] : [],
    );
    const disabled = args.flatMap((argument, index) =>
      argument === "--disable" ? [args[index + 1]] : [],
    );
    expect(args).toContain("--search");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--strict-config");
    expect(disabled).toContain("apps");
    expect(disabled).toContain("shell_tool");
    expect(disabled).toContain("multi_agent");
    expect(disabled).toContain("plugins");
    expect(configs).toContain("skills.include_instructions=false");
    expect(configs).toContain("include_environment_context=false");
    expect(configs).toContain("include_permissions_instructions=false");
    expect(configs).toContain("include_apps_instructions=false");
    expect(configs).toContain("include_collaboration_mode_instructions=false");
    expect(configs).toContain("project_doc_max_bytes=0");
    expect(configs).toContain(
      `developer_instructions=${JSON.stringify(sourceAuditDeveloperInstructions)}`,
    );
    expect(execution).toMatchObject({
      input: request.prompt,
      homeEntries: ["auth.json"],
      remotePayloadPresent: false,
      threadIdPresent: false,
    });
    expect(execution.schema).toEqual(request.outputSchema);
    expect(existsSync(execution.codexHome as string)).toBe(false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("malformed Codex JSONL retains its valid prefix for inspection", async () => {
  const fixture = await fixtureEnvironment("malformed");
  try {
    const result = await codexSourceSearch({
      command: fakeCodex,
      environment: fixture.environment,
    })(request);
    expect(result).toMatchObject({
      state: "failed",
      codexVersion: "codex-cli fake-1.0",
      stdout: `${JSON.stringify({ type: "thread.started", thread_id: "fake" })}\n{\n`,
      exitCode: 17,
    });
    expect(sourceEventPrefix(result.stdout).events).toEqual([
      { type: "thread.started", thread_id: "fake" },
    ]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("aborting Codex source search cancels and cleans its temporary home", async () => {
  const fixture = await fixtureEnvironment("wait");
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await codexSourceSearch({
      command: fakeCodex,
      environment: fixture.environment,
    })(request, controller.signal);
    expect(result.state).toBe("cancelled");
    const execution = (await captures(fixture.capture)).at(-1)!;
    expect(existsSync(execution.codexHome as string)).toBe(false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
