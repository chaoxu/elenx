# Elenx kernel v1 specification

This file is the normative contract for kernel v1.

## Purpose and boundary

Elenx provides four guarantees:

1. one append-only SQLite campaign artifact containing exact candidate material;
2. an exact record of each call, its selected tool declarations, admitted tool inputs and results, and final call result;
3. verdicts bound to fresh successful calls carrying the ID of the exact stored candidate; and
4. a derived, witnessed verification status requiring every declared verifier to pass and none to fail.

Elenx is not an agent framework. Applications own coordination, routes, context assembly, source search, computation, retries, budgets, filesystem policy, publication, and user interfaces.

## Runtime and dependencies

V1 targets Bun 1.3.14 or newer and campaign schema 3. It uses Bun SQLite for persistence, Zod 4.4.3 for input validation and JSON Schema generation, Pi 0.84.1 for the bundled model loop, and platform UUIDs for opaque identifiers. Elenx exposes Pi's types directly instead of maintaining local copies. The implementation contains no custom SQL parser, JSON Schema validator, model loop, provider client, or native lock binding.

## Campaign artifact

A campaign is one SQLite database. The database uses WAL, `synchronous=FULL`, a five-second busy timeout, a strict table, and append-only triggers. Each candidate and its material share one atomic row insertion. Short `BEGIN IMMEDIATE` transactions serialize verdict decisions across campaign handles. There is no process-lifetime writer lock.

Creation uses an exclusive private file create and never overwrites an existing path. The schema and campaign identity commit together. A crash before that commit may leave an invalid file, which readers reject and an operator must remove before retry. The artifact is not tamper-resistant against an operator with raw filesystem or SQL access.

Each candidate has a campaign-scoped `candidate:<UUID>` identifier. The identifier is a reference, not a fingerprint or deduplication key. Every submission creates a distinct candidate, including submissions with identical bytes.

## Records

Every record has a positive `seq`, an informational nonnegative `atMs`, and one closed kind. Only `seq` determines order.

| kind | durable fact |
|---|---|
| `campaign` | application id and JSON configuration |
| `candidate` | opaque id, exact material bytes, and frozen nonempty verifier set |
| `call` | id, verifier/application label, exact JSON request, and selected tool declarations |
| `tool-call` | call id, kernel tool id, optional provider source id, tool name, and validated JSON input |
| `tool-result` | matching tool id and either returned JSON or thrown error text |
| `call-result` | matching call id and either returned JSON or thrown error text |
| `verdict` | candidate, required verifier, successful call id, verdict, and JSON evidence |

Rows and public values are validated with closed Zod schemas. SQLite uniqueness constraints permit one campaign, one candidate record per ID, one result per call or tool ID, and one verdict per call.

## Calls and tools

```ts
interface CallOptions {
  readonly label: string;
  readonly request: Json;
  readonly tools?: readonly Tool[];
  readonly signal?: AbortSignal;
}

interface CallContext {
  readonly request: Json;
  readonly tools: readonly AuditedTool[];
  readonly signal: AbortSignal;
}

campaign.call(options, runner): Promise<{ id: CallId; output: Json }>
```

`call` validates and snapshots the request and each tool declaration, appends `call`, and then invokes `runner` with that recorded request. It appends exactly one `call-result` if the runner settles. A crash may leave only the start record.

A tool is defined with `defineTool({ name, description, input, run })`, where `input` is a Zod object schema. Elenx records `z.toJSONSchema(input)`. An audited wrapper parses each invocation with the same schema, appends `tool-call` before `run` executes, and appends one `tool-result` after settlement. Invalid arguments do not run `run`. Schema getters, refinements, and transforms are admission logic and must be pure. The call stops accepting new tool invocations when its runner settles and waits for every admitted tool invocation before writing `call-result`. `close()` refuses while a local call remains active.

The runner receives only the tools listed in `CallOptions`. The kernel never adds tools. Applications must keep tools semantic and policy-checked; they must not wrap the whole `Campaign`, expose SQL or the database path, offer generic record append, or provide unrestricted candidate or filesystem access. Application-supplied runners and Pi registries are trusted not to add capabilities outside this set.

## Pi runner

`runPi(campaign, options)` creates one fresh Pi `runAgentLoop`. The application selects a real model from the registry returned by `builtinPi`, then supplies that registry, label, system prompt, prompt, optional candidate ID, optional tools, and optional abort signal. `builtinPi({ credentials })` accepts Pi's re-exported in-memory credential store for OAuth or API-key use.

Elenx supplies Pi only the audited wrappers selected for that run. Pi validates generated schemas and executes its own tool loop, provider calls, retries, and transcript construction. Elenx stores Pi's native transcript, including Pi-native usage and stop reasons, without inventing provider identity or cross-provider accounting. Only a final Pi `stop` is successful. Token limits, deferred work, protocol errors, and cancellation return `state: "failed"` or `state: "cancelled"` and cannot support a verdict.

The recorded Pi request contains the provider, model ID, API ID, prompt, optional system prompt, optional candidate ID, and selected tool declarations. Provider credentials, registry configuration, and the provider wire request remain Pi/application concerns and are not persisted by Elenx.

## Candidates, verdicts, and verification

`submitCandidate(material, requiredVerifiers)` copies the exact bytes, assigns a new opaque ID, and freezes a sorted, unique, nonempty verifier set. A later submission always creates another candidate.

`recordVerdict(candidate, verifier, call, verdict, evidence)` accepts `PASS`, `FAIL`, or `INCONCLUSIVE` only when:

- the candidate exists and names that verifier;
- the call starts after candidate submission;
- the call label equals the verifier name;
- the recorded call request contains that exact candidate ID;
- the call returned JSON whose `state` is `"succeeded"`; and
- no verdict already cites that call.

A candidate is verified when each required verifier has at least one PASS and no required verifier has any FAIL. INCONCLUSIVE neither passes nor fails. A later PASS does not erase a FAIL for that candidate ID. Failures are submission-scoped: submitting even identical bytes again creates an independent candidate, and applications decide whether to permit that retry.

`status(candidate)` derives the candidate ID, `verified`, missing verifier names, failed verifier names, and the first PASS sequence number for each satisfied verifier. It stores no status row. Later verdicts remain appendable, so the view always reflects the complete log. Writers and readers use the same derivation. Publishing, adopting, or otherwise promoting a verified candidate is an application action.

## Public API

```ts
createCampaign(path, application, config): Campaign
openCampaign(path): Campaign
openReader(path): Reader

campaign.submitCandidate(material, requiredVerifiers): CandidateId
campaign.call(options, runner): Promise<CallReceipt>
campaign.recordVerdict(candidate, verifier, call, verdict, evidence): Entry
campaign.records(): readonly Entry[]
campaign.material(candidate): Uint8Array
campaign.status(candidate): CandidateStatus
campaign.close(): void

reader.records(): readonly Entry[]
reader.material(candidate): Uint8Array
reader.status(candidate): CandidateStatus
reader.close(): void

defineTool(definition): Tool
runPi(campaign, options): Promise<PiResult> // from elenx/pi
```

All database methods are synchronous because Bun SQLite is synchronous. Only external execution through `call` and `runPi` is asynchronous.

## Completion criteria

V1 is complete when the full check passes on macOS and Linux, a fresh reader reconstructs a verified candidate from the artifact alone, the scripted hostile-audit slice passes, one explicitly requested real-provider Pi smoke passes, package contents and consumer types are verified, and nonblank source remains at or below 1,500 lines.
