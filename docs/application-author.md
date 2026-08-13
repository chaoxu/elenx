# Building an Elenx application

Install Elenx from Gitea:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.1.0 zod@4.4.3
```

## Create and promote a candidate

```ts
import { createCampaign } from "elenx";
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

const audit = await runPi(campaign, {
  models,
  model,
  label: verifier,
  candidate,
  system: "Audit the candidate adversarially.",
  prompt: `Return PASS, FAIL, or INCONCLUSIVE, then explain.\n\n${new TextDecoder().decode(material)}`,
});
if (audit.state !== "succeeded") throw new Error(audit.error);

const verdict = parseAndValidateVerdict(audit.text);
campaign.recordVerdict(candidate, verifier, audit.call, verdict, {
  response: audit.text,
});
if (campaign.status(candidate).promotable) campaign.promote(candidate);
campaign.close();
```

`builtinPi()` uses Pi's normal environment and ambient provider authentication. An application that owns OAuth or API-key credentials can import `InMemoryCredentialStore` from `elenx/pi` and pass it as `builtinPi({ credentials })`; the class is Pi's maintained store re-exported through Elenx's strict type boundary. Elenx does not read, copy, or persist provider credentials.

The candidate envelope is application-owned. Include every fact that must change its identity: statement revision, answer or proof, cited sources, imported assumptions, and dependency versions.

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
  async run({ source }, signal) {
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

Zod validates the model's input before `run` executes and generates the JSON Schema Pi receives. Tool inputs are Zod object schemas; their refinements and transforms must be pure admission logic. Elenx records the declaration, validated input, provider tool-call id, result, and containing Pi transcript.

Tools should express one bounded application action. Suitable proof-search tools read a named attached source, inspect a bounded frontier view, launch one application-approved computation, or submit one structured observation. Do not expose SQL, the campaign path, a database client, arbitrary record append, unrestricted blob enumeration, the whole `Campaign`, or a general filesystem shell.

## Keep orchestration outside the kernel

An application can maintain routes, task queues, source bundles, blind-review views, stopping policy, and human-readable reports in ordinary files or its own database. Use Elenx at the points where evidence becomes durable:

1. package exact output and sources into candidate bytes;
2. submit the candidate with versioned verifier names;
3. run each verifier through `runPi` or `campaign.call` with only its selected tools;
4. parse and validate the verifier response in application code;
5. record the verdict against that call; and
6. promote only when `status(candidate).promotable` is true.

[`../examples/v1/hostile-audit.ts`](../examples/v1/hostile-audit.ts) shows the scripted path. [`../examples/v1/pi-smoke.ts`](../examples/v1/pi-smoke.ts) uses a real Pi model.
