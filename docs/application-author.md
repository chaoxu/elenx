# Building an Elenx application

Install Elenx from Gitea:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.7.13 zod@4.4.3
```

## Create and verify a candidate

```ts
import {
  createCampaign,
  defineTool,
  deriveCandidateStatus,
  returnedToolSubmission,
  verdictSchema,
} from "elenx";
import { builtinPi, runPi } from "elenx/pi";
import { z } from "zod";

const verdictSubmission = z.strictObject({
  verdict: verdictSchema,
  evidence: z.json(),
});
const submitVerdict = defineTool({
  name: "submit_verdict",
  description: "Submit the final verdict and its evidence",
  input: verdictSubmission,
  replay: "safe",
  async run() {
    return null;
  },
});

const models = builtinPi();
const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (model === undefined) throw new Error("model unavailable");

const campaign = createCampaign("campaign.db", "my-proof-app", {
  policy: "v1",
});
try {
  const verifier = "hostile-audit/v1";
  const material = new TextEncoder().encode(
    JSON.stringify({ statement, proof, sources, revision }),
  );
  const candidate = campaign.submitCandidate(material, [verifier]);
  const stored = new TextDecoder().decode(campaign.material(candidate));
  const audit = await runPi(campaign, {
    models,
    model,
    label: verifier,
    candidate,
    system:
      "Audit the candidate adversarially. Call submit_verdict exactly once with the reason in evidence, then stop.",
    prompt: stored,
    tools: [submitVerdict],
    stopAfterToolResult: true,
  });
  if (audit.state !== "succeeded") throw new Error(audit.error);
  const submitted = returnedToolSubmission(
    campaign.records(),
    audit.call,
    submitVerdict.name,
  );
  const report = verdictSubmission.parse(submitted.input);
  campaign.recordVerdict(audit.call, report.verdict, report.evidence);
  const status = deriveCandidateStatus(campaign.records(), candidate);
  if (!status.verified) throw new Error("not verified");
} finally {
  campaign.close();
}
```

`builtinPi()` uses Pi's normal environment and ambient provider authentication. An application that owns OAuth or API-key credentials can import `InMemoryCredentialStore` from `elenx/pi` and pass it as `builtinPi({ credentials })`; Elenx re-exports both implementations and their types directly from Pi. Built-in adapters keep credentials outside the persisted payload. A custom adapter is trusted to do the same.

`returnedToolSubmission` requires one named tool call and its returned result. The application parses the durable input with the same submission schema and passes its verdict and evidence to `recordVerdict`; it supplies no second semantic value that could disagree with the model's submission. Tool output may differ from input, so the projection records both without equating them.

Use that structured path for an LLM verifier. An application-owned deterministic verifier adapter instead runs through `campaign.call`, validates its typed receipt, and applies one fixed mapping from that receipt to the verdict passed to `recordVerdict`. Elenx preserves the mapping's input and output; it does not establish that the verifier is sound. Never translate free-form model text into a coordinator-selected verdict.

Use `stopAfterToolResult` when the verdict-submission tool is the call's only tool. Gather source inspections or other observations in earlier calls so finalization has one unambiguous submission.

The candidate envelope is application-owned. Include every fact that must be audited together: statement revision, answer or proof, cited sources, imported assumptions, and dependency versions. `deriveCandidateStatus(records, candidate).verified` is derived from the supplied log snapshot; Elenx stores no promotion event. Publishing or adopting a verified candidate belongs to the application.

## Give a model one narrow tool

When a verifier needs one read-only source tool, run source inspection as a preliminary call and pass its recorded result into the verdict prompt. Keep the final verdict as the same verdict-only structured call shown above.

```ts
import { defineTool, returnedToolSubmission } from "elenx";
import { z } from "zod";

const inspectedSource = z.strictObject({
  source: z.enum(allowedSourceNames),
  text: z.string(),
});
const inspectSource = defineTool({
  name: "inspect_source",
  description: "Read one source already attached to this candidate",
  input: z.strictObject({
    source: z.enum(allowedSourceNames),
  }),
  replay: "safe",
  async run({ source }, { signal }) {
    signal.throwIfAborted();
    return { source, text: await sourceStore.read(source) };
  },
});

const inspection = await runPi(campaign, {
  models,
  model,
  label: `${verifier}/source-inspection`,
  candidate,
  system:
    "Inspect one attached source. Call inspect_source exactly once, then stop.",
  prompt: stored,
  tools: [inspectSource],
  stopAfterToolResult: true,
});
if (inspection.state !== "succeeded") throw new Error(inspection.error);
const sourceInspection = inspectedSource.parse(
  returnedToolSubmission(
    campaign.records(),
    inspection.call,
    inspectSource.name,
  ).output,
);

const audit = await runPi(campaign, {
  models,
  model,
  label: verifier,
  candidate,
  system:
    "Audit the candidate and source-inspection result. Call submit_verdict exactly once, then stop.",
  prompt: JSON.stringify({ stored, sourceInspection }),
  tools: [submitVerdict],
  stopAfterToolResult: true,
});
```

Zod validates the model's input before `run` executes and generates the JSON Schema Pi receives. Pure refinements are supported; transforms are unsupported because JSON Schema cannot represent them. `replay: "safe"` is the application's assertion that every valid repetition is harmless; a write needs an application-stable semantic key or reconciliation rule. A recorded tool call without a result has an unknown outcome and is never retried by the kernel. Use the campaign namespace and tool-call sequence to reconcile the original external record. The exact recording and replay contract is in [`../SPEC.md`](../SPEC.md#calls-and-tools).

Tools should express one bounded application action. Suitable proof-search tools read a named attached source, inspect a bounded frontier view, launch one application-approved computation, or submit one structured observation. Do not expose SQL, the campaign path, a database client, arbitrary record append, unrestricted candidate access, the whole `Campaign`, or a general filesystem shell.

`piRequestAttempts(campaign.records(), call)` returns the JSON-semantic pre-send payload for each Pi provider operation and whether its checkpoint settled. The payload may contain full prompts and attached sources. A completed checkpoint with no outer call result still has an unknown provider outcome. Built-in adapters omit credentials and HTTP headers; custom adapters must do the same and invoke the hook exactly once before dispatch. See [`../SPEC.md`](../SPEC.md#pi-runner) for the checkpoint contract.

The campaign artifact stores candidate bytes, requests, prompts, transcripts, tool inputs and results, verdict evidence, and pre-send payloads as plaintext. Treat it as sensitive application data. Built-in Pi adapters exclude authentication credentials; a custom adapter must preserve that boundary.

## Account for provider work

`derivePiSpend(records)` returns settled provider operations, per-call and campaign totals, unaccounted Pi calls, and redacted completed request checkpoints that may represent unknown spend. Provider-reported token buckets and estimated cost remain separate; missing usage is `null`, not zero. It reads one record snapshot and writes nothing.

## Resume and read safely

Use `openCampaign(path)` only after the prior writer or coordinator has terminated or closed, then derive the next application action from `campaign.records()`. Close every handle in `finally`; copying an open database is unsupported. Calls and tool calls without matching results require external reconciliation and are not automatically replayable. Use `openReader(path)` for read-only inspection. Recovery, copying, rollback-journal, and rejected WAL-state rules are defined in [`../SPEC.md`](../SPEC.md#campaign-artifact).

A `runPi` result that is still length-truncated after its bounded in-call recoveries is a dead end. Preserve it and start a fresh `runPi` call from explicit application state; a fresh model, profile, prompt, or context policy likewise starts another root call.

`runPi` writes through the supplied `Campaign.call` interface. A decorator around that interface is trusted application code and may observe or alter execution; the kernel does not claim an intra-process security boundary against its caller.

## Keep orchestration outside the kernel

An application can maintain routes, task queues, source bundles, blind-review views, stopping policy, and human-readable reports in ordinary files or its own database. Use Elenx at the points where evidence becomes durable:

1. package exact output and sources into candidate bytes;
2. submit the candidate with versioned verifier names;
3. run each verifier through `runPi` or `campaign.call` with only its selected tools;
4. for an LLM verifier, finalize exactly one returned structured submission; for an application-owned deterministic adapter, validate its receipt and apply its fixed verdict mapping; and
5. publish or adopt the candidate in application code only when `deriveCandidateStatus(records, candidate).verified` is true.

[`../examples/v1/scripted-verifier.ts`](../examples/v1/scripted-verifier.ts) shows the deterministic adapter path. [`../examples/v1/pi-smoke.ts`](../examples/v1/pi-smoke.ts) independently exercises the LLM-verdict path with a real Pi model.
