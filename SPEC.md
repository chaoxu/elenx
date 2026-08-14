# Elenx kernel v1 specification

This file is the normative contract for kernel v1.

## Purpose and boundary

Elenx provides four guarantees:

1. one append-only SQLite campaign artifact containing exact candidate material;
2. an exact record of each call, its selected tool declarations, admitted tool inputs and results, and final call result, plus the JSON-semantic payload exposed before each Pi provider operation;
3. verdicts bound to fresh successful calls carrying the ID of the exact stored candidate; and
4. a derived, witnessed verification status requiring every declared verifier to pass and none to fail.

Elenx is not an agent framework. Applications own coordination, routes, context assembly, source search, computation, retries, budgets, filesystem policy, publication, and user interfaces.

## Runtime and dependencies

Runtime and dependency versions are pinned in `package.json` and `bun.lock`. Elenx uses Bun SQLite for persistence, Zod for input validation and JSON Schema generation, and Pi for the bundled model loop and telemetry contracts. Elenx exposes Pi's types directly instead of maintaining local copies. The implementation contains no custom SQL parser, JSON Schema validator, model loop, provider client, identifier generator, or native lock binding.

## Campaign artifact

A campaign is one SQLite database. The database uses SQLite's `journal_mode=DELETE` rollback journal, `synchronous=FULL`, a five-second busy timeout, a strict table, and append-only triggers. Each durable fact is one atomic row insertion. `createCampaign` creates a new artifact, `openCampaign` reopens an existing artifact for appends, and `openReader` opens it read-only. SQLite serializes individual row insertions; applications remain responsible for ensuring that only one coordinator attempts a logical phase at a time.

Creation uses an exclusive private file create and never overwrites an existing path. The schema and campaign identity commit together. A crash before that commit may leave an invalid file, which readers reject and an operator must remove before retry. The artifact is not tamper-resistant against an operator with raw filesystem or SQL access.

Copy a campaign only after its handles close. Copying the file while a writer is active is not a supported live snapshot; that requires SQLite's backup facilities.

The positive `entries.seq` of a candidate, call, or tool call is its campaign-scoped identifier. It is not portable between campaign databases. Every submission creates a distinct candidate row, including submissions with identical bytes.

## Records

Every record has a positive `seq`, an informational nonnegative `atMs`, and one closed kind. Only `seq` determines order.

| kind | durable fact |
|---|---|
| `campaign` | application id and JSON configuration |
| `candidate` | exact material bytes and frozen nonempty verifier set |
| `call` | label, optional candidate sequence, exact JSON request, and selected tool declarations |
| `tool-call` | call sequence, optional provider source id, tool name, and validated JSON input |
| `call-result` | parent call sequence and either returned JSON or thrown error text |
| `tool-result` | parent tool-call sequence and either returned JSON or thrown error text |
| `verdict` | successful verifier-call sequence, verdict, and JSON evidence |

Rows and public values are validated with closed Zod schemas. The row primary key supplies identity. SQLite uniqueness constraints permit one campaign, one result per parent, and one verdict per call.

## Calls and tools

```ts
interface CallOptions {
  readonly label: string;
  readonly candidate?: EntryId;
  readonly request: Json;
  readonly tools?: readonly Tool[];
  readonly signal?: AbortSignal;
}

interface CallContext {
  readonly call: EntryId;
  readonly request: Json;
  readonly tools: readonly AuditedTool[];
  readonly signal: AbortSignal;
}

campaign.call(options, runner): Promise<{ call: EntryId; output: Json }>
```

`call` validates and snapshots the optional candidate sequence, request, and each tool declaration, appends `call`, and then invokes `runner` with that recorded request. It appends one `call-result` if the runner settles. A crash may leave only the call row.

A tool is defined with `defineTool({ name, description, input, replay: "safe", run })`, where `input` is a Zod schema. The replay declaration asserts that every valid repetition after an interrupted phase is harmless. Pure and read-only actions qualify; a write qualifies only when an application-stable semantic key or reconciliation rule survives phase restart. Calls reject unclassified tools before writing a call row. Elenx records `z.toJSONSchema(input)`. An audited wrapper parses each invocation with the same schema, appends `tool-call` before `run` executes, and passes `run` the containing call sequence, tool-call sequence, optional provider source ID, and abort signal. It appends one `tool-result` after settlement. Invalid arguments do not run `run`. Schema getters, refinements, and transforms are admission logic and must be pure. The call stops accepting new tool invocations when its runner settles and waits for every admitted tool invocation before writing its result. `close()` refuses while a local call remains active.

A `tool-call` without a `tool-result` has an unknown outcome. Elenx does not retry it or invent a result. The application can combine its own campaign namespace with the campaign-scoped tool-call sequence to reconcile the original external record; a retried phase receives a new sequence. Non-idempotent external effects are outside the v1 tool contract. Replay safety is current execution policy, not a persisted historical classification: schema-4 tool declarations contain no replay field.

The runner receives only the tools listed in `CallOptions`. The kernel never adds tools. Applications must keep tools semantic and policy-checked; they must not wrap the whole `Campaign`, expose SQL or the database path, offer generic record append, or provide unrestricted candidate or filesystem access. Application-supplied runners and Pi registries are trusted not to add capabilities outside this set.

## Pi runner

`runPi(campaign, options)` creates one fresh Pi `runAgentLoop`. The application selects a real model from the registry returned by `builtinPi`, then supplies that registry, label, system prompt, prompt, optional Pi reasoning level, optional candidate ID, optional tools, and optional abort signal. A schema-constrained submission role may set `stopAfterToolResult: true` to finish after a successful tool batch without a redundant provider continuation. Pi terminates a batch only when every tool result requests termination; applications remain responsible for stricter cardinality such as exactly one submission. `builtinPi({ credentials })` accepts Pi's re-exported in-memory credential store for OAuth or API-key use.

Elenx supplies Pi only the audited wrappers selected for that run and asks supported providers to constrain each tool call to its JSON Schema, with ordinary tool calling as the fallback. Zod still validates every admitted input. Pi executes its own tool loop, provider calls, retries, and transcript construction. Elenx stores Pi's native transcript, including Pi-native usage and stop reasons, without inventing provider identity or cross-provider accounting. A final Pi `stop`, or an explicitly requested successful terminal tool result, is successful. Token limits, deferred work, tool errors, protocol errors, and cancellation do not become successful through terminal-tool mode.

`runPi` creates one typed `elenx.pi.run` span and one standard Pi `pi.ai.request` child for every logical provider operation, including continuations after tool results. Provider adapters may retry an operation without exposing each wire attempt. The settled span tree is stored inside that call's returned JSON, so its label, optional candidate, and optional requested reasoning level supply the reason and configuration for each operation without adding a telemetry table or stored roll-up. Request leaves carry the Pi schema's provider, requested and served models, API, response, stop reason, usage, cache, Pi model-price cost estimate, HTTP-status, and error fields when available.

Pi's awaited `onPayload` hook exposes the adapter's final pre-send payload. Elenx stores its JSON serialization semantics in an internal `elenx/pi-request` call and completes that checkpoint before returning from the hook. `piRequestAttempts(records, parent?)` reconstructs every valid checkpoint call and reports it as completed, threw, or unsettled. A completed attempt proves which hook payload became dispatchable; it does not prove that the provider received it or produced a response, and an adapter may still add transport-only fields after the hook. The runtime rejects a successful logical provider operation unless exactly one checkpoint completed; an adapter may fail or be cancelled before constructing a payload. Built-in Pi adapters supply the ordering. A custom adapter is trusted to invoke the hook exactly once before dispatch and to keep credentials and tokens outside its payload. Provider authentication, headers, transport configuration, and SDK-internal retries are not persisted.

Applications derive totals from settled request leaves only and never add the native transcript's duplicate usage. Pi's input, cache-read, and cache-write fields are disjoint buckets; reasoning tokens are a subset of output and are not added again. A request with no measured usage remains a measurement gap instead of becoming zero spend. Telemetry is diagnostic and never affects candidate verification. An interrupted call can lack a completed span tree just as it can lack a call result.

The parent call contains the optional candidate sequence, provider, model ID, API ID, prompt, optional system prompt, optional requested reasoning level, and selected tool declarations. The child checkpoints contain the provider, model ID, API ID, and JSON-semantic pre-send hook payload. Provider credentials, headers, registry configuration, and authenticated transport details remain Pi/application concerns and are not persisted by built-in adapters.

## Candidates, verdicts, and verification

`submitCandidate(material, requiredVerifiers)` copies the exact bytes, freezes a sorted, unique, nonempty verifier set, appends the candidate row, and returns its sequence. A later submission always creates another candidate.

`recordVerdict(call, verdict, evidence)` accepts `PASS`, `FAIL`, or `INCONCLUSIVE` only when:

- the call names an existing earlier candidate;
- the call label is required by that candidate;
- the call starts after candidate submission;
- the call returned JSON whose `state` is `"succeeded"`; and
- SQLite admits the first verdict citing that call.

A candidate is verified when each required verifier has at least one PASS and no required verifier has any FAIL. INCONCLUSIVE neither passes nor fails. A later PASS does not erase a FAIL for that candidate ID. Failures are submission-scoped: submitting even identical bytes again creates an independent candidate, and applications decide whether to permit that retry.

`status(candidate)` derives `verified`, missing verifier names, failed verifier names, and the first PASS verdict sequence for each satisfied verifier. It stores no status row. Later verdicts remain appendable, so the view always reflects the complete log. Writers and readers use the same derivation. Publishing, adopting, or otherwise promoting a verified candidate is an application action.

## Public API

```ts
createCampaign(path, application, config): Campaign
openCampaign(path): Campaign
openReader(path): Reader
deriveCandidateStatus(records, candidate): CandidateStatus

campaign.submitCandidate(material, requiredVerifiers): EntryId
campaign.call(options, runner): Promise<CallReceipt>
campaign.recordVerdict(call, verdict, evidence): EntryId
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
piRequestAttempts(records, parent?): readonly PiRequestAttempt[] // from elenx/pi
```

All database methods are synchronous because Bun SQLite is synchronous. Only external execution through `call` and `runPi` is asynchronous.

## Completion criteria

V1 is complete when the full check passes on macOS and Linux, a fresh reader reconstructs a verified candidate from the artifact alone, the scripted hostile-audit slice passes, one explicitly requested real-provider Pi smoke passes, package contents and consumer types are verified, and nonblank source remains at or below 1,500 lines.
