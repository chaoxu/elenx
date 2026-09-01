import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCampaign,
  deriveCandidateStatus,
  openReader,
  type Entry,
} from "elenx";

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const cliTimeoutMs = 15_000;
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test("standalone role commands cross the real CLI, model runtime, Pi, and journal", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const campaign = join(directory, "roles.db");
  const task = primeTask();
  const explorerInput = await writeJson(directory, "explorer.json", {
    task,
    index: [],
    context: [],
    objective: "Produce a complete proof.",
  });
  const coordinatorInput = await writeJson(directory, "coordinator.json", {
    task,
    notes: [],
    findings: [{ text: completeProof }],
  });
  const verifierInput = await writeJson(directory, "verifier.json", {
    task,
    candidateKind: "solution",
    answer: { id: "n1", summary: "complete proof", text: completeProof },
    support: [],
  });

  const explorer = await cli(
    directory,
    "explorer",
    explorerInput,
    campaign,
    settings,
  );
  expect(explorer.code).toBe(0);
  expect(JSON.parse(explorer.stdout).findings).toHaveLength(1);

  const coordinator = await cli(
    directory,
    "coordinator",
    coordinatorInput,
    campaign,
    settings,
  );
  expect(coordinator.code).toBe(0);
  expect(JSON.parse(coordinator.stdout).action.kind).toBe("verify");

  const verifier = await cli(
    directory,
    "verifier",
    verifierInput,
    campaign,
    settings,
  );
  expect(verifier.code).toBe(0);
  expect(JSON.parse(verifier.stdout)).toEqual({
    verdict: "ACCEPT",
    report: "Every required audit completed without a blocking defect.",
  });

  const inspection = await cli(directory, "inspect", campaign);
  expect(inspection.code).toBe(0);
  const observed = JSON.parse(inspection.stdout);
  expect(observed.calls.map(({ role }: { role: string }) => role)).toEqual([
    "explorer",
    "coordinator",
    "verifier",
  ]);
  expect(observed.spend).toMatchObject({
    logicalProviderRequests: 3,
    requestErrors: 0,
    unmeasuredRequests: 0,
  });
  expect(JSON.stringify(observed)).not.toContain('"audits"');
  expect(JSON.stringify(observed)).not.toContain('"PASS"');
  const requests = await recordedRequests(directory);
  expect(requests.map(requestedTool)).toEqual([
    "submit_findings",
    "submit_coordination",
    "submit_verification",
  ]);
  expect(
    requests.every(
      (request) =>
        request["tool_choice"] === "required" &&
        request["parallel_tool_calls"] === false,
    ),
  ).toBe(true);
});

test("trial repairs one rejected proof and accepts the next exact proposal", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const trialInput = await writeJson(directory, "trial.json", {
    task: primeTask(),
    objective: "Produce a complete proof.",
    maxExplorerTurns: 3,
  });
  const campaign = join(directory, "trial.db");

  const result = await cli(directory, "trial", trialInput, campaign, settings);
  expect(result.code).toBe(0);
  const report = JSON.parse(result.stdout) as {
    readonly candidate: number;
    readonly answer: { readonly text: string };
  };
  expect(report).toMatchObject({
    schemaVersion: 1,
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "accepted",
    phase: "accepted",
    turns: 2,
    candidateKind: "solution",
    verifier: { verdict: "ACCEPT" },
  });
  expect(Number.isSafeInteger(report.candidate)).toBe(true);

  const candidates = candidateEntries(campaign);
  expect(candidates).toHaveLength(2);
  expect(report.candidate).toBe(candidates[1]!.seq);
  expect(candidateStatus(campaign, candidates[0]!.seq)).toMatchObject({
    verified: false,
    failed: ["elenx-solve/role/verifier"],
  });
  expect(candidateStatus(campaign, report.candidate).verified).toBe(true);
  expect(candidateText(campaign, report.candidate)).toBe(report.answer.text);

  const inspection = JSON.parse(
    (await cli(directory, "inspect", campaign)).stdout,
  );
  expect(inspection.calls.map(({ role }: { role: string }) => role)).toEqual([
    "explorer",
    "coordinator",
    "verifier",
    "explorer",
    "coordinator",
    "verifier",
  ]);
  expect(
    inspection.calls
      .filter(({ role }: { role: string }) => role === "verifier")
      .map(({ result }: { result: { verdict: string } }) => result.verdict),
  ).toEqual(["REJECT", "ACCEPT"]);
  expect(inspection.spend).toMatchObject({
    logicalProviderRequests: 6,
    requestErrors: 0,
    unmeasuredRequests: 0,
  });
});

test("trial terminates when the verifier accepts an exact refutation", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const trialInput = await writeJson(directory, "trial.json", {
    task: {
      problem:
        "Prove that every tournament on three vertices has a directed cycle.",
      completionCriteria:
        "Give a complete proof of the stated universal claim.",
    },
    objective:
      "Produce a complete proof or establish that the target is false.",
    maxExplorerTurns: 2,
  });
  const campaign = join(directory, "refuted.db");

  const result = await cli(directory, "trial", trialInput, campaign, settings);
  expect(result.code).toBe(0);
  const report = JSON.parse(result.stdout) as {
    readonly candidate: number;
    readonly refutation: { readonly text: string };
  };
  expect(report).toMatchObject({
    schemaVersion: 1,
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "refuted",
    phase: "refuted",
    turns: 1,
    candidateKind: "refutation",
    refutation: { summary: "transitive tournament counterexample" },
    verifier: { verdict: "ACCEPT" },
  });
  expect(Number.isSafeInteger(report.candidate)).toBe(true);
  expect(candidateStatus(campaign, report.candidate).verified).toBe(true);
  expect(candidateText(campaign, report.candidate)).toBe(
    report.refutation.text,
  );

  const inspection = JSON.parse(
    (await cli(directory, "inspect", campaign)).stdout,
  );
  expect(inspection.calls.map(({ role }: { role: string }) => role)).toEqual([
    "explorer",
    "coordinator",
    "verifier",
  ]);
});

test("trial turn limit is terminal without an accepted candidate", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const trialInput = await writeJson(directory, "trial.json", {
    task: primeTask(),
    objective: "Produce a complete proof.",
    maxExplorerTurns: 1,
  });
  const campaign = join(directory, "turn-limit.db");

  const result = await cli(directory, "trial", trialInput, campaign, settings);
  expect(result.code).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    schemaVersion: 1,
    application: "elenx-solve-roles",
    protocol: "role-calls.v2",
    outcome: "turn-limit",
    phase: "turn-limit",
    turns: 1,
    lastVerifierResult: { verdict: "REJECT" },
  });
  expect(report).not.toHaveProperty("candidate");
  expect(report).not.toHaveProperty("candidateKind");
  const candidates = candidateEntries(campaign);
  expect(candidates).toHaveLength(1);
  expect(candidateStatus(campaign, candidates[0]!.seq)).toMatchObject({
    verified: false,
    failed: ["elenx-solve/role/verifier"],
  });
});

test("provider failure exits nonzero and inspection exposes no mathematical result", async () => {
  const directory = await testDirectory();
  const settings = await writeSettings(directory);
  const input = await writeJson(directory, "verifier.json", {
    task: primeTask(),
    candidateKind: "solution",
    answer: {
      id: "n1",
      summary: "synthetic failure",
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
  expect(inspection.calls[0]).toMatchObject({
    role: "verifier",
    piState: "failed",
  });
  expect(inspection.calls[0]).not.toHaveProperty("result");
  expect(inspection.spend.requestErrors).toBeGreaterThanOrEqual(1);
  const candidates = candidateEntries(campaign);
  expect(candidates).toHaveLength(1);
  expect(candidateStatus(campaign, candidates[0]!.seq)).toMatchObject({
    verified: false,
    missing: ["elenx-solve/role/verifier"],
    failed: [],
  });
});

test("database type and existing-trial errors happen before credential setup", async () => {
  const directory = await testDirectory();
  const foreign = join(directory, "v17.db");
  createCampaign(foreign, "elenx-solve", {
    protocol: "exploration-v17",
  }).close();

  const wrongType = await cli(
    directory,
    "explorer",
    join(directory, "missing-input.json"),
    foreign,
    join(directory, "missing-settings.json"),
  );
  expect(wrongType.code).toBe(1);
  expect(wrongType.stderr).toContain("not an Elenx role journal");
  expect(wrongType.stderr).not.toContain("credential");
  expect(wrongType.stderr).not.toContain("ENOENT");

  const existing = join(directory, "existing.db");
  createCampaign(existing, "elenx-solve-roles", {
    protocol: "role-calls.v1",
  }).close();
  const trial = await cli(
    directory,
    "trial",
    join(directory, "missing-trial.json"),
    existing,
    join(directory, "missing-settings.json"),
  );
  expect(trial.code).toBe(1);
  expect(trial.stderr).toContain("trial requires a new campaign database");
});

test("input errors happen before model or credential setup", async () => {
  const directory = await testDirectory();
  const settings = await writeJson(directory, "missing-provider.json", {
    explorer: { provider: "missing", model: "missing", reasoning: "low" },
    coordinator: { provider: "missing", model: "missing", reasoning: "low" },
    verifier: { provider: "missing", model: "missing", reasoning: "low" },
  });
  const campaign = join(directory, "never-created.db");

  const result = await cli(
    directory,
    "explorer",
    join(directory, "missing-input.json"),
    campaign,
    settings,
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("ENOENT");
  expect(result.stderr).not.toContain("credential");
  expect(await Bun.file(campaign).exists()).toBe(false);
});

function requestedTool(body: Record<string, unknown>): string {
  const tools = body["tools"];
  if (!Array.isArray(tools)) throw new Error("request omitted tools");
  const tool = tools[0];
  if (tool === null || typeof tool !== "object" || !("name" in tool)) {
    throw new Error("request omitted tool name");
  }
  return String(tool.name);
}

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
  const path = join(directory, name);
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill(9);
  }, cliTimeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timeout);
  if (timedOut) {
    throw new Error(
      `CLI exceeded ${cliTimeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
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

function candidateEntries(
  campaign: string,
): Extract<Entry, { readonly kind: "candidate" }>[] {
  const reader = openReader(campaign);
  try {
    return reader
      .records()
      .filter(
        (entry): entry is Extract<Entry, { readonly kind: "candidate" }> =>
          entry.kind === "candidate",
      );
  } finally {
    reader.close();
  }
}

function candidateStatus(campaign: string, candidate: number) {
  const reader = openReader(campaign);
  try {
    return deriveCandidateStatus(reader.records(), candidate);
  } finally {
    reader.close();
  }
}

function candidateText(campaign: string, candidate: number): string {
  const reader = openReader(campaign);
  try {
    return new TextDecoder().decode(reader.material(candidate));
  } finally {
    reader.close();
  }
}

function primeTask() {
  return {
    problem: "Prove that there are infinitely many prime numbers.",
    completionCriteria: "Give a complete self-contained proof.",
  };
}

const completeProof =
  "Since 2 is prime, the finite list is nonempty. Assume all primes are p_1,...,p_n. Their product plus one has a prime divisor outside the list, a contradiction.";
