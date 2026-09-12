import assert from "node:assert/strict";
import { appendFile, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

process.umask(0o077);

// One allocation runs the frozen comparison cases sequentially to reduce account-cap spillover.
if (!process.env.ELENX_PROBE_CASE) {
  const pairId = process.env.ELENX_PROBE_PAIR;
  assert.ok(
    ["p47", "containers", "closedwalk", "prefix"].includes(pairId ?? ""),
  );
  const batchRoot = `/runs/_diagnostics/reasoning-retention-20260912/${pairId}`;
  const bytes = await readFile(join(batchRoot, "batch.json"));
  assert.equal(
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    process.env.ELENX_PROBE_BATCH_SHA,
  );
  const batch = JSON.parse(bytes.toString());
  assert.ok(batch.cases.length === 2);
  let active: ReturnType<typeof Bun.spawn> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    active?.kill("SIGINT");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const entry of batch.cases) {
    if (stopped) break;
    active = Bun.spawn(
      [process.execPath, "--no-install", "--no-env-file", import.meta.path],
      {
        env: {
          ...process.env,
          ELENX_PROBE_CASE: entry.caseId,
          ELENX_PROBE_SOURCE_SHA: batch.sourceSha256,
          ELENX_PROBE_INPUT_SHA: entry.requestSha256,
        },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const code = await active.exited;
    console.log(
      JSON.stringify({
        event: "case-finished",
        caseId: entry.caseId,
        exitCode: code,
      }),
    );
    active = undefined;
  }
  process.exit(stopped ? 130 : 0);
}

// Disposable one-request prompt experiment; returned tool calls are recorded only.
const caseId = process.env.ELENX_PROBE_CASE;
assert.match(caseId ?? "", /^[a-z][a-z0-9-]{1,48}$/);
const root = `/runs/_diagnostics/reasoning-retention-20260912/${caseId}`;
const endpoint = "https://codex-lb.lab/backend-api/codex/responses";
const usageTag = `reasoning-retention-20260912/${caseId}/attempt-1`;
const hash = (s: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(s).digest("hex");
assert.equal(
  hash(await readFile(import.meta.path)),
  process.env.ELENX_PROBE_SOURCE_SHA,
);
const bytes = await readFile(join(root, "request.json"));
assert.equal(hash(bytes), process.env.ELENX_PROBE_INPUT_SHA);
const payload = JSON.parse(bytes.toString());
const manifest = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
);
assert.equal(manifest.caseId, caseId);
assert.equal(manifest.requestSha256, hash(bytes));
assert.equal(payload.model, "gpt-6-astra");
assert.equal(payload.reasoning.effort, "max");
assert.equal(payload.max_output_tokens, 128000);
assert.equal(payload.store, false);
assert.ok(["none", "auto", "required"].includes(payload.tool_choice));
assert.ok(
  payload.tools.every((t: any) =>
    ["submit_notes", "submit_coordination"].includes(t.name),
  ),
);
const key = process.env.CODEX_LB_API_KEY;
assert.ok(key && key.trim() === key && !/\s/.test(key), "missing credential");
const safe = (s: string) => s.replaceAll(key, "[REDACTED]");
const pi = await realpath(
  Bun.resolveSync("@earendil-works/pi-ai", "/app/elenx"),
);
const { _iterSSEMessages } = await import(
  Bun.resolveSync("openai/core/streaming", dirname(pi))
);
const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const start = Date.now();
let eventCount = 0,
  reasoningItems = 0,
  toolCalls = 0,
  visibleText = "";
const completedItems: any[] = [];
let terminal: any,
  httpStatus: number | undefined,
  error: string | undefined,
  lastEventAt: string | undefined;
const progress = () => ({
  caseId,
  checkedAt: new Date().toISOString(),
  elapsedSeconds: (Date.now() - start) / 1000,
  eventCount,
  reasoningItems,
  toolCalls,
  visibleCharacters: visibleText.length,
  httpStatus,
  lastEventAt,
});
const heartbeat = setInterval(
  () => console.log(JSON.stringify({ event: "progress", ...progress() })),
  30000,
);
await writeFile(
  join(root, "started.json"),
  JSON.stringify({
    startedAt: new Date(start).toISOString(),
    endpoint,
    usageTag,
    caseId,
    maxRequests: 1,
    sourceSha256: process.env.ELENX_PROBE_SOURCE_SHA,
    requestSha256: hash(bytes),
    retainedReasoningItems: payload.input.filter(
      (i: any) => i.type === "reasoning",
    ).length,
  }) + "\n",
  { flag: "wx" },
);
try {
  const response = await fetch(endpoint, {
    method: "POST",
    body: bytes,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: "Bearer " + key,
      "X-Codex-LB-Usage-Tag": usageTag,
      "X-Codex-LB-Required-Capability": "usage_tag_v1",
      session_id: manifest.sessionId,
    },
    signal: controller.signal,
  });
  httpStatus = response.status;
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status}: ${safe(await response.text()).slice(0, 1500)}`,
    );
  for await (const sse of _iterSSEMessages(response, controller)) {
    if (sse.data === "[DONE]") continue;
    const e = JSON.parse(sse.data);
    eventCount++;
    lastEventAt = new Date().toISOString();
    if (e.type === "response.output_text.delta") visibleText += e.delta;
    if (e.type === "response.output_item.done") {
      completedItems.push(e.item);
      if (e.item?.type === "reasoning") reasoningItems++;
      if (["function_call", "custom_tool_call"].includes(e.item?.type))
        toolCalls++;
      await appendFile(
        join(root, "completed-items.jsonl"),
        safe(JSON.stringify(e.item)) + "\n",
      );
    }
    if (
      [
        "response.completed",
        "response.incomplete",
        "response.failed",
        "error",
      ].includes(e.type)
    ) {
      terminal = e;
      await writeFile(
        join(root, "terminal.json"),
        safe(JSON.stringify(e)) + "\n",
        { flag: "wx" },
      );
    }
  }
} catch (caught) {
  error = safe(String(caught));
} finally {
  clearInterval(heartbeat);
  controller.abort();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
const response = terminal?.response;
const output = response?.output?.length ? response.output : completedItems;
const finalText = output
  .filter((i: any) => i.type === "message")
  .flatMap((i: any) => i.content ?? [])
  .filter((i: any) => i.type === "output_text")
  .map((i: any) => i.text)
  .join("\n");
const submissions = output
  .filter((i: any) => i.type === "function_call")
  .map((i: any) => ({
    name: i.name,
    callId: i.call_id,
    arguments: i.arguments,
  }));
await writeFile(join(root, "output.md"), safe(finalText || visibleText), {
  flag: "wx",
});
await writeFile(
  join(root, "submissions.json"),
  safe(JSON.stringify(submissions, null, 2)) + "\n",
  { flag: "wx" },
);
const usage = response?.usage;
const result = {
  ...progress(),
  terminalType: terminal?.type ?? null,
  responseId: response?.id ?? null,
  status: response?.status ?? null,
  incompleteDetails: response?.incomplete_details ?? null,
  tokens: usage
    ? {
        input: usage.input_tokens,
        cachedInput: usage.input_tokens_details?.cached_tokens ?? null,
        output: usage.output_tokens,
        reasoning: usage.output_tokens_details?.reasoning_tokens ?? null,
      }
    : null,
  reasoning: response?.reasoning ?? null,
  error: error ?? terminal?.error ?? response?.error ?? null,
  usageTag,
  completedResponse: terminal?.type === "response.completed",
};
await writeFile(
  join(root, "result.json"),
  safe(JSON.stringify(result, null, 2)) + "\n",
  { flag: "wx" },
);
console.log(safe(JSON.stringify(result)));
process.exitCode = result.completedResponse ? 0 : 1;
