import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Entry, EntryId, Json } from "elenx";
import { z } from "zod";

import { returnedOutput } from "./roles";

// The source verifier runs Codex with web search, isolated in a fresh
// CODEX_HOME that holds only the inherited OAuth credential, with every other
// Codex feature disabled. Its request and stdout are journaled like any call.

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});

/** The reasoning levels the Codex CLI accepts for model_reasoning_effort. */
export const codexReasoning = z.enum([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export const codexRequest = z.strictObject({
  protocol: z.literal("elenx/codex-exec/v1"),
  model: nonblank,
  reasoning: codexReasoning,
  developerInstructions: nonblank,
  prompt: nonblank,
  outputSchema: z.json(),
});
export type CodexRequest = z.output<typeof codexRequest>;

const execution = {
  codexVersion: z.string().min(1).optional(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable().optional(),
};
export const codexResult = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("succeeded"),
    codexVersion: z.string().min(1),
    stdout: z.string(),
    stderr: z.string(),
  }),
  z.strictObject({ state: z.literal("failed"), ...execution, error: nonblank }),
  z.strictObject({
    state: z.literal("cancelled"),
    ...execution,
    error: nonblank,
  }),
]);
export type CodexResult = z.output<typeof codexResult>;
export type CodexExec = (
  request: CodexRequest,
  signal?: AbortSignal,
) => Promise<CodexResult>;

export const codexUsage = z.strictObject({
  input: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative(),
});
export type CodexUsage = z.output<typeof codexUsage>;

function eventObject(value: Json): Record<string, Json> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Codex emitted a non-object JSONL event");
  }
  return value as Record<string, Json>;
}

/** The final agent message, the searches made, and the usage of one Codex run. */
export function codexTranscript(stdout: string): {
  readonly message: string;
  readonly queries: readonly string[];
  readonly searches: number;
  readonly usage: CodexUsage;
} {
  const queries: string[] = [];
  let searches = 0;
  let usage: CodexUsage | undefined;
  let stage: "start" | "thread" | "turn" | "complete" = "start";
  let message: string | undefined;
  let last: string | undefined;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const event = eventObject(z.json().parse(JSON.parse(line)));
    const type = z.string().parse(event["type"]);
    if (type === "thread.started") {
      if (stage !== "start") throw new Error("thread.started out of order");
      stage = "thread";
      continue;
    }
    if (type === "turn.started") {
      if (stage !== "thread") throw new Error("turn.started out of order");
      stage = "turn";
      continue;
    }
    if (type === "turn.completed") {
      if (stage !== "turn") throw new Error("turn.completed out of order");
      const raw = eventObject(event["usage"] ?? {});
      usage = codexUsage.parse({
        input: raw["input_tokens"],
        cacheRead: raw["cached_input_tokens"],
        cacheWrite: raw["cache_write_input_tokens"],
        output: raw["output_tokens"],
        reasoning: raw["reasoning_output_tokens"],
      });
      stage = "complete";
      continue;
    }
    if (!["item.started", "item.updated", "item.completed"].includes(type)) {
      throw new Error(`Codex emitted forbidden event type: ${type}`);
    }
    if (stage !== "turn") throw new Error(`${type} outside an active turn`);
    const item = eventObject(event["item"] ?? null);
    const itemType = z.string().parse(item["type"]);
    if (!["reasoning", "agent_message", "web_search"].includes(itemType)) {
      throw new Error(`Codex used forbidden item type: ${itemType}`);
    }
    if (type !== "item.completed") continue;
    if (itemType === "web_search") {
      searches += 1;
      const action = eventObject(item["action"] ?? {});
      const parsed = z.array(nonblank).safeParse(action["queries"]);
      if (parsed.success) queries.push(...parsed.data);
      else if (typeof item["query"] === "string" && item["query"] !== "") {
        queries.push(item["query"]);
      }
    }
    last = itemType;
    if (itemType === "agent_message") message = nonblank.parse(item["text"]);
  }
  if (stage !== "complete") throw new Error("Codex emitted no complete turn");
  if (usage === undefined) throw new Error("Codex emitted no completed usage");
  if (last !== "agent_message" || message === undefined) {
    throw new Error("Codex emitted no final completed agent message");
  }
  return { message, queries, searches, usage };
}

/** The parsed final message of a succeeded Codex call, with its searches and usage. Throws on a malformed transcript. */
export function codexSubmission(
  records: readonly Entry[],
  call: EntryId,
):
  | {
      readonly settled: EntryId;
      readonly input: Json;
      readonly searches: number;
      readonly usage: CodexUsage;
    }
  | undefined {
  const returned = returnedOutput(records, call);
  if (returned === undefined) return undefined;
  const output = codexResult.safeParse(returned.output);
  if (!output.success || output.data.state !== "succeeded") return undefined;
  const transcript = codexTranscript(output.data.stdout);
  return {
    settled: returned.settled,
    input: z.json().parse(JSON.parse(transcript.message)),
    searches: transcript.searches,
    usage: transcript.usage,
  };
}

interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly cancelled: boolean;
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CommandResult> {
  let cancelled = options.signal?.aborted === true;
  const abort = () => {
    cancelled = true;
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const child = Bun.spawn([command, ...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      stdin:
        options.input === undefined
          ? "ignore"
          : new TextEncoder().encode(options.input),
      stdout: "pipe",
      stderr: "pipe",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, cancelled };
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

const disabledFeatures = [
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "plugins",
  "remote_plugin",
  "plugin_sharing",
  "shell_tool",
  "skill_search",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "workspace_dependencies",
] as const;

export function codexExec(
  options: {
    readonly command?: string;
    readonly environment?: NodeJS.ProcessEnv;
  } = {},
): CodexExec {
  const command = options.command ?? "codex";
  const inherited = options.environment ?? process.env;
  let knownVersion: string | undefined;
  return async (request, signal) => {
    let directory: string | undefined;
    let codexVersion = knownVersion;
    let stdout = "";
    let stderr = "";
    let exitCode: number | null | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "elenx-source-"));
      const codexHome = join(directory, "codex-home");
      await mkdir(codexHome);
      const inheritedHome = resolve(
        inherited["CODEX_HOME"] ??
          join(inherited["HOME"] ?? homedir(), ".codex"),
      );
      const inheritedAuth = join(inheritedHome, "auth.json");
      if (existsSync(inheritedAuth)) {
        await symlink(
          await realpath(inheritedAuth),
          join(codexHome, "auth.json"),
        );
      } else {
        await writeFile(join(codexHome, "auth.json"), "{}\n", { mode: 0o600 });
      }
      // Only what the CLI needs to run and reach the network; in particular
      // no OPENAI_* or CODEX_* variable that would move it off its native
      // credential, and no other process's secrets.
      const env: NodeJS.ProcessEnv = { CODEX_HOME: codexHome };
      for (const name of Object.keys(inherited)) {
        if (
          ["PATH", "HOME", "TMPDIR", "TERM", "LANG", "LC_ALL"].includes(name) ||
          /^(?:HTTPS?|NO|ALL)_PROXY$/iu.test(name)
        ) {
          env[name] = inherited[name];
        }
      }
      const schemaPath = join(directory, "verdict.schema.json");
      await writeFile(schemaPath, JSON.stringify(request.outputSchema));
      if (codexVersion === undefined) {
        const version = await runCommand(command, ["--version"], {
          env,
          ...(signal === undefined ? {} : { signal }),
        });
        const reported = version.stdout.trim();
        if (version.cancelled) {
          return {
            state: "cancelled",
            ...(reported === "" ? {} : { codexVersion: reported }),
            stdout,
            stderr: version.stderr,
            error: "source verification cancelled",
          };
        }
        if (version.exitCode !== 0 || reported === "") {
          throw new Error(
            version.stderr || "could not determine Codex version",
          );
        }
        codexVersion = reported;
        knownVersion = reported;
      }
      const run = await runCommand(
        command,
        [
          "--search",
          "-m",
          request.model,
          ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
          "exec",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--strict-config",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--json",
          "--color",
          "never",
          "--output-schema",
          schemaPath,
          "-c",
          `model_reasoning_effort="${request.reasoning}"`,
          "-c",
          `developer_instructions=${JSON.stringify(request.developerInstructions)}`,
          "-c",
          "skills.include_instructions=false",
          "-c",
          "include_environment_context=false",
          "-c",
          "include_permissions_instructions=false",
          "-c",
          "include_apps_instructions=false",
          "-c",
          "include_collaboration_mode_instructions=false",
          "-c",
          "project_doc_max_bytes=0",
          "-c",
          "tools.update_plan.enabled=false",
          "-C",
          directory,
          "-",
        ],
        {
          cwd: directory,
          env,
          input: request.prompt,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      stdout = run.stdout;
      stderr = run.stderr;
      exitCode = run.exitCode;
      if (run.cancelled) {
        return {
          state: "cancelled",
          codexVersion,
          stdout,
          stderr,
          exitCode,
          error: "source verification cancelled",
        };
      }
      if (run.exitCode !== 0) {
        return {
          state: "failed",
          codexVersion,
          stdout,
          stderr,
          exitCode,
          error: `Codex exited with status ${run.exitCode}`,
        };
      }
      return { state: "succeeded", codexVersion, stdout, stderr };
    } catch (error) {
      return {
        state: signal?.aborted ? "cancelled" : "failed",
        ...(codexVersion === undefined ? {} : { codexVersion }),
        stdout,
        stderr,
        ...(exitCode === undefined ? {} : { exitCode }),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (directory !== undefined) {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch {
          // The journaled result remains authoritative if cleanup fails.
        }
      }
    }
  };
}
