import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test("run, resume, inspect, and export share the durable role workflow", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const problem = await writeText(
    directory,
    "problem.md",
    "Prove that there are infinitely many prime numbers.",
  );
  const criteria = await writeText(
    directory,
    "criteria.md",
    "Give a complete self-contained proof.",
  );
  const campaign = join(directory, "run.db");

  const first = await cli(
    directory,
    "run",
    problem,
    criteria,
    campaign,
    settings,
  );
  expect(first.code).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "solved",
    candidateKind: "solution",
  });
  const requestsAfterFirst = await recordedRequests(directory);
  expect(requestsAfterFirst).toHaveLength(8);

  const second = await cli(
    directory,
    "run",
    problem,
    criteria,
    campaign,
    settings,
  );
  expect(second.code).toBe(0);
  expect(JSON.parse(second.stdout).outcome).toBe("solved");
  expect(await recordedRequests(directory)).toHaveLength(8);

  const inspection = await cli(directory, "inspect", campaign);
  expect(inspection.code).toBe(0);
  const observed = JSON.parse(inspection.stdout);
  expect(observed).toMatchObject({
    phase: "accepted",
    outcome: "accepted",
    problem: "Prove that there are infinitely many prime numbers.",
    spend: { logicalProviderRequests: 8, requestErrors: 0 },
  });
  expect(
    observed.calls.map(({ role }: { readonly role: string }) => role),
  ).toEqual([
    "explorer",
    "coordinator",
    "verifier",
    "explorer",
    "coordinator",
    "verifier",
  ]);
  expect(JSON.stringify(observed)).not.toContain('"audits"');

  const exported = await cli(directory, "export", campaign);
  expect(exported.code).toBe(0);
  expect(exported.stdout).toContain("Since 2 is prime");
});

test("trial uses the same resumable workflow", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const trial = await writeJson(directory, "trial.json", {
    task: {
      problem: "Prove that there are infinitely many prime numbers.",
      completionCriteria: "Give a complete self-contained proof.",
    },
    objective: "Produce a complete proof.",
    maxExplorerTurns: 3,
  });
  const campaign = join(directory, "trial.db");
  const first = await cli(directory, "trial", trial, campaign, settings);
  expect(first.code).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    outcome: "accepted",
    turns: 2,
    candidateKind: "solution",
  });
  const count = (await recordedRequests(directory)).length;
  const resumed = await cli(directory, "trial", trial, campaign, settings);
  expect(resumed.code).toBe(0);
  expect(JSON.parse(resumed.stdout).outcome).toBe("accepted");
  expect(await recordedRequests(directory)).toHaveLength(count);
});

test("trial refuses a concurrent owner of the same campaign", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const trial = await writeJson(directory, "trial.json", {
    task: { problem: "Prove P.", completionCriteria: "Give a proof." },
    objective: "Prove P.",
    maxExplorerTurns: 1,
  });
  const campaign = join(directory, "locked.db");
  using lock = new Database(`${campaign}.runner.lock`, { create: true });
  lock.run("BEGIN EXCLUSIVE");
  const result = await cli(directory, "trial", trial, campaign, settings);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("campaign already has a running process");
});

test("a provider failure leaves no mathematical verifier result", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const input = await writeJson(directory, "verifier.json", {
    task: {
      problem: "Prove P.",
      completionCriteria: "Give a complete proof.",
    },
    candidateKind: "solution",
    answer: {
      id: "n1",
      summary: "failure",
      text: "TRIGGER_PROVIDER_ERROR",
    },
    support: [],
  });
  const campaign = join(directory, "failure.db");
  const result = await cli(directory, "verifier", input, campaign, settings);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("synthetic provider failure");
  const inspection = JSON.parse(
    (await cli(directory, "inspect", campaign)).stdout,
  );
  expect(inspection.calls).toHaveLength(1);
  expect(inspection.calls[0]).not.toHaveProperty("result");
  expect(inspection.spend.requestErrors).toBeGreaterThanOrEqual(1);
});

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "elenx-role-e2e-"));
  directories.push(directory);
  return directory;
}

async function writeSettings(directory: string): Promise<string> {
  await writeJson(directory, "models.json", {
    providers: {
      e2e: {
        name: "E2E Responses",
        baseUrl: "https://e2e.invalid/v1",
        api: "openai-responses",
        apiKey: "test-key",
        models: [
          {
            id: "e2e-model",
            name: "E2E Model",
            reasoning: true,
            input: ["text"],
            cost: {
              input: 0.2,
              output: 1.2,
              cacheRead: 0.02,
              cacheWrite: 0.25,
            },
            contextWindow: 20_000,
            maxTokens: 4_000,
            thinkingLevelMap: { low: "low" },
            compat: {
              supportsStrictMode: true,
              supportsOpenAIGrammarTools: true,
            },
          },
        ],
      },
    },
  });
  await writeJson(directory, "auth.json", {});
  return writeJson(directory, "settings.json", {
    maxExplorerTurns: 3,
    explorer: { provider: "e2e", model: "e2e-model", reasoning: "low" },
    coordinator: { provider: "e2e", model: "e2e-model", reasoning: "low" },
    verifier: { provider: "e2e", model: "e2e-model", reasoning: "low" },
  });
}

async function writeJson(
  directory: string,
  name: string,
  value: unknown,
): Promise<string> {
  return writeText(directory, name, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(
  directory: string,
  name: string,
  value: string,
): Promise<string> {
  const path = join(directory, name);
  await Bun.write(path, value);
  return path;
}

async function cli(
  directory: string,
  ...args: readonly string[]
): Promise<CliResult> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      join(import.meta.dir, "fixtures/role-e2e-fetch.ts"),
      "solve.ts",
      ...args,
    ],
    {
      cwd: join(import.meta.dir, ".."),
      env: {
        HOME: directory,
        TMPDIR: directory,
        ELENX_MODELS_PATH: join(directory, "models.json"),
        PI_CODING_AGENT_DIR: directory,
        ELENX_E2E_REQUEST_LOG: join(directory, "requests.jsonl"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

async function recordedRequests(
  directory: string,
): Promise<Record<string, unknown>[]> {
  const file = Bun.file(join(directory, "requests.jsonl"));
  if (!(await file.exists())) return [];
  return (await file.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
