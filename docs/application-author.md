# Building an Elenx application

Install Elenx from Gitea:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.7.5 zod@4.4.3
```

## Create and verify a candidate

```ts
import {
  createCampaign,
  deriveCandidateStatus,
  finalizeVerdict,
  submitVerdictTool,
} from "elenx";
import { builtinPi, runPi } from "elenx/pi";

const models = builtinPi();
const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (model === undefined) throw new Error("model unavailable");

const campaign = createCampaign("campaign.db", "my-proof-app", {
  policy: "v1",
});
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
  tools: [submitVerdictTool],
  stopAfterToolResult: true,
});
if (audit.state !== "succeeded") throw new Error(audit.error);
finalizeVerdict(campaign, audit.call);
const status = deriveCandidateStatus(campaign.records(), candidate);
if (!status.verified) throw new Error("not verified");
campaign.close();
```

`builtinPi()` uses Pi's normal environment and ambient provider authentication. An application that owns OAuth or API-key credentials can import `InMemoryCredentialStore` from `elenx/pi` and pass it as `builtinPi({ credentials })`; Elenx re-exports both implementations and their types directly from Pi. Elenx does not read, copy, or persist provider credentials.

`submitVerdictTool` returns its validated `{ verdict, evidence }` input unchanged. `finalizeVerdict` requires one such tool call, its matching returned tool result, and a successful candidate-bound verifier call before appending the verdict. The application supplies no second verdict value that could disagree with the model's durable submission.

Use `stopAfterToolResult` when `submitVerdictTool` is the call's only tool. Gather source inspections or other observations in earlier calls so finalization has one unambiguous submission.

The candidate envelope is application-owned. Include every fact that must be audited together: statement revision, answer or proof, cited sources, imported assumptions, and dependency versions. `deriveCandidateStatus(records, candidate).verified` is derived from the supplied log snapshot; Elenx stores no promotion event. Publishing or adopting a verified candidate belongs to the application.

## Give a model one narrow tool

```ts
import { defineTool } from "elenx";
import { z } from "zod";

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

const audit = await runPi(campaign, {
  models,
  model,
  label: verifier,
  candidate,
  prompt,
  tools: [inspectSource],
});
```

Zod validates the model's input before `run` executes and generates the JSON Schema Pi receives. Tool inputs are Zod schemas; their refinements and transforms must be pure admission logic. `replay: "safe"` means every valid repetition after an interrupted phase is harmless: the action is pure or read-only, or a write uses an application-stable semantic key or reconciliation rule that survives restart. Elenx records the declaration, validated input, provider tool-call id, result, and containing Pi transcript. A recorded tool call with no result has an unknown outcome and is never retried by the kernel. The execution context exposes a campaign-scoped `toolCall` sequence; combine it with an application-owned campaign namespace when reconciling the original external record. A new phase attempt gets a new sequence.

Tools should express one bounded application action. Suitable proof-search tools read a named attached source, inspect a bounded frontier view, launch one application-approved computation, or submit one structured observation. Do not expose SQL, the campaign path, a database client, arbitrary record append, unrestricted candidate access, the whole `Campaign`, or a general filesystem shell.

`piRequestAttempts(campaign.records(), call)` returns the JSON-semantic payload exposed by Pi's final pre-send hook for each provider operation in a Pi call, together with its completed or unsettled state. Built-in adapters keep credentials and HTTP headers outside it. An absent outer call result leaves the provider outcome unknown even when its request checkpoint completed. Custom adapters must invoke the hook exactly once before dispatch and must never put credentials or tokens in its payload.

`derivePiSpend(records)` returns settled provider operations, per-call and campaign totals, unaccounted Pi calls, and redacted completed request checkpoints that may represent unknown spend. Provider-reported token buckets and estimated cost remain separate; missing usage is `null`, not zero. Pass `{ call }` or `{ candidate }` to restrict the projection. It reads one record snapshot and writes nothing.

## Keep orchestration outside the kernel

An application can maintain routes, task queues, source bundles, blind-review views, stopping policy, and human-readable reports in ordinary files or its own database. Use Elenx at the points where evidence becomes durable:

1. package exact output and sources into candidate bytes;
2. submit the candidate with versioned verifier names;
3. run each verifier through `runPi` or `campaign.call` with only its selected tools;
4. finalize exactly one returned structured submission, recording its verdict; and
5. publish or adopt the candidate in application code only when `deriveCandidateStatus(records, candidate).verified` is true.

[`../examples/v1/hostile-audit.ts`](../examples/v1/hostile-audit.ts) shows the scripted path. [`../examples/v1/pi-smoke.ts`](../examples/v1/pi-smoke.ts) uses a real Pi model.
