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

A campaign is one SQLite database. The database uses SQLite's `journal_mode=DELETE` rollback journal, `synchronous=FULL`, a five-second busy timeout, a strict table, and append-only triggers. Each durable fact is one atomic row insertion. `createCampaign` creates a new artifact, `openCampaign` reopens an existing artifact for appends and performs any required rollback-journal recovery, and `openReader` opens an existing artifact without write access. WAL-format headers and `-wal` or `-shm` sidecars are outside the artifact contract and are rejected before SQLite opens the file. SQLite serializes individual row insertions; applications remain responsible for ensuring that only one coordinator attempts a logical phase at a time.

Creation uses an exclusive private file create and never overwrites an existing path. The schema and campaign identity commit together. A crash before that commit may leave an invalid file, which readers reject and an operator must remove before retry. The artifact is not tamper-resistant against an operator with raw filesystem or SQL access.

Copy a campaign only after its handles close. If a crash left a rollback journal, open and close the campaign with `openCampaign` before copying so SQLite completes recovery. A reader refuses an artifact that requires recovery rather than mutating it. Preserve an unexpected WAL artifact unchanged; checkpoint and convert only an operator-controlled copy with trusted SQLite before opening it as an Elenx campaign. Copying the file while a writer is active is not a supported live snapshot; that requires SQLite's backup facilities.

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

`call` validates and snapshots the optional candidate sequence, request, and each tool declaration, appends `call`, and then invokes `runner` with that recorded request. It appends one `call-result` if the runner settles. A crash may leave only the call row. Labels are application vocabulary; package projections recognize their own records through strict versioned request discriminators rather than a reserved namespace.

A tool is defined with `defineTool({ name, description, input, replay: "safe", run })`, where `input` is a Zod schema. The replay declaration asserts that every valid repetition after an interrupted phase is harmless. Pure and read-only actions qualify; a write qualifies only when an application-stable semantic key or reconciliation rule survives phase restart. Calls reject unclassified tools before writing a call row. Elenx records `z.toJSONSchema(input)`. An audited wrapper parses each invocation with the same schema, appends `tool-call` before `run` executes, and passes `run` the containing call sequence, tool-call sequence, optional provider source ID, and abort signal. It appends one `tool-result` after settlement. Invalid arguments do not run `run`. Schema getters and refinements are allowed and must be pure. Transforms are unsupported because the frozen JSON Schema cannot represent them. The call stops accepting new tool invocations when its runner settles and waits for every admitted tool invocation before writing its result. `close()` refuses while a local call remains active.

A `tool-call` without a `tool-result` has an unknown outcome. Elenx does not retry it or invent a result. The application can combine its own campaign namespace with the campaign-scoped tool-call sequence to reconcile the original external record; a retried phase receives a new sequence. Non-idempotent external effects are outside the v1 tool contract. Replay safety is current execution policy, not a persisted historical classification: stored tool declarations contain no replay field.

The runner receives only the tools listed in `CallOptions`. The kernel never adds tools. Applications must keep tools semantic and policy-checked; they must not wrap the whole `Campaign`, expose SQL or the database path, offer generic record append, or provide unrestricted candidate or filesystem access. Application-supplied runners and Pi registries are trusted not to add capabilities outside this set.

## Pi runner

`runPi(campaign, options)` executes one fresh Pi interaction through the campaign's ordinary `call` method. Its initial loop and any bounded recovery loops share that durable call and one aggregate turn cap. The strict outer request carries `protocol: "elenx/pi-run/v1"`; strict request checkpoints carry `protocol: "elenx/pi-request/v1"`, so projections recognize Pi state by protocol rather than application labels. The root request freezes the provider, model ID, API, base URL, system prompt, prompt, requested reasoning level, and a JSON model profile containing Pi's reasoning flag, thinking-level map, context window, output limit, sampling parameters, and compatibility settings. The application selects a real model from the registry returned by `builtinPi`, then supplies that registry, label, optional candidate ID, optional tools, and optional abort signal. A structured-submission role may set `stopAfterToolResult: true` to finish after a successful tool batch without a redundant provider continuation. Use that mode when the submission tool is the call's sole tool; gather other observations in earlier calls. Pi terminates a batch only when every tool result requests termination; applications remain responsible for stricter cardinality such as exactly one submission. A failed result stores the transient-error classification as `providerRetryable`: Pi's provider-error classifier augmented with the transient gateway codes `upstream_unavailable`, `upstream_error`, `proxy_unavailable`, and `ClientPayloadError` that codex-lb-style gateways report. It also stores `truncated` when the terminal response reached the per-response output limit with positive provider-reported output usage. Cancellation uses `state: "cancelled"`. Context overflow uses `state: "failed"`, `truncated: false`, `providerRetryable: false`, and the error `Pi exceeded its context window`. Elenx freezes the resulting classification and leaves restart policy to the application. `builtinPi({ credentials })` accepts Pi's re-exported in-memory credential store for OAuth or API-key use.

A durable call whose result is a length-truncated failure is a dead end: the application preserves it and starts a fresh root call from explicit state.

Elenx supplies Pi only the audited wrappers selected for that run and asks supported providers to constrain each tool call to its JSON Schema, with ordinary tool calling as the fallback. Zod still validates every admitted input. Pi executes its own tool loop, provider calls, retries, and transcript construction. Elenx stores Pi's native transcript, including Pi-native usage and stop reasons, without inventing provider identity or cross-provider accounting. A final Pi `stop`, or an explicitly requested terminal batch in which every tool result succeeds, is successful. Context overflow, token limits, deferred work, tool errors, protocol errors, and cancellation do not become successful through terminal-tool mode.

`runPi` creates one typed `elenx.pi.run` span and one standard Pi `pi.ai.request` child for every logical provider operation, including continuations after tool results. Legacy requests use `maxRecoveries` as one shared bound on additional loop entries after either a response-length stop or a retryable provider interruption. A request that sets `maxLengthContinuations` uses that separate bound for response-length stops while `maxRecoveries` bounds retryable provider interruptions. A length continuation carries the full transcript and a fixed continuation prompt; an error recovery retries from the last valid context and discards errored assistant content that provider adapters do not send again. Overflow-shaped length stops, non-retryable errors, and aborts always terminate. Each recovery is an ordinary logical provider operation with its own span and request checkpoint. Provider adapters may retry an operation without exposing each wire attempt. Each `runPi` call generates one random transport session ID shared by its initial loop and recoveries; adapters key provider-side prompt caching, session affinity, and transport-failure fallback on it. The optional `transport` option pins the adapter transport (for example `"sse"`) for every operation in the call. Both are transport configuration outside the durable contract. One aggregate counter caps the initial loop and every recovery at thirty-two assistant/provider turns total. The settled span tree is stored inside that call's returned JSON, so its label, optional candidate, and optional requested reasoning level supply the reason and configuration for each operation without adding a telemetry table or stored roll-up. Request leaves carry the Pi schema's provider, requested and served models, API, response, stop reason, usage, cache, Pi model-price cost estimate, HTTP-status, and error fields when available.

Pi's awaited `onPayload` hook exposes the adapter's final pre-send payload. Elenx stores its JSON serialization semantics in an internal `elenx/pi-request` call and completes that checkpoint before returning from the hook. `piRequestAttempts(records, parent?)` reconstructs every valid checkpoint call and reports it as completed or unsettled. A completed attempt proves which hook payload became dispatchable; it does not prove that the provider received it or produced a response, and an adapter may still add transport-only fields after the hook. The runtime rejects a successful logical provider operation unless exactly one checkpoint completed; an adapter may fail or be cancelled before constructing a payload. Built-in Pi adapters supply the ordering. A custom adapter is trusted to invoke the hook exactly once before dispatch and to keep credentials and tokens outside its payload. The checkpoint records the effective request base URL when the dispatching model carries one, so the durable log names the endpoint a payload was prepared for. Provider authentication, headers, other transport configuration, and SDK-internal retries are not persisted.

`derivePiSpend(records)` reads settled direct-child request leaves only and never adds the native transcript's duplicate usage. It returns JSON-safe operation identity, per-call and aggregate provider-reported usage, unaccounted Pi call IDs, and redacted completed request checkpoints that may represent unknown spend. The six core usage fields are atomic; a partial bundle is invalid, while no bundle yields `usage: null`. Pi's input, cache-read, and cache-write fields are disjoint buckets; reasoning tokens are a subset of output and are not added again. Telemetry is diagnostic and never affects candidate verification.

The parent call contains the optional candidate sequence, provider, model ID, API ID, base URL, model profile, prompt, optional system prompt, optional requested reasoning level, and selected tool declarations. The child checkpoints contain the provider, model ID, API ID, effective request base URL, and JSON-semantic pre-send hook payload. The durable contract identifies the requested runtime configuration; provider credentials, headers, backend revision, adapter implementation, unrecorded registry metadata, authenticated transport details, and the provider's interpretation of a model ID remain outside it.

## Candidates, verdicts, and verification

`submitCandidate(material, requiredVerifiers)` copies the exact bytes, freezes a sorted, unique, nonempty verifier set, appends the candidate row, and returns its sequence. A later submission always creates another candidate.

`recordVerdict(call, verdict, evidence)` accepts `PASS`, `FAIL`, or `INCONCLUSIVE` only when:

- the call names an existing earlier candidate;
- the call label is required by that candidate;
- the call starts after candidate submission;
- the call returned JSON whose `state` is `"succeeded"`; and
- SQLite admits the first verdict citing that call.

`returnedToolSubmission(records, call, tool)` requires exactly one matching tool call and exactly one returned tool result, then projects their record IDs, admitted input, and output. It does not require output to equal input. An application parses the input with its own submission schema and passes the derived verdict and evidence to `recordVerdict`; the coordinator supplies no second semantic value that could disagree with the durable submission.

A candidate is verified when each required verifier has at least one PASS and no required verifier has any FAIL. INCONCLUSIVE neither passes nor fails. A later PASS does not erase a FAIL for that candidate ID. Failures are submission-scoped: submitting even identical bytes again creates an independent candidate, and applications decide whether to permit that retry.

`deriveCandidateStatus(records, candidate)` derives `verified`, missing verifier names, failed verifier names, and the first PASS verdict sequence for each satisfied verifier from one explicit record snapshot. It stores no status row. Publishing, adopting, or otherwise promoting a verified candidate is an application action.

## Primary API

```ts
createCampaign(path, application, config): Campaign
openCampaign(path): Campaign
openReader(path): Reader
deriveCandidateStatus(records, candidate): CandidateStatus
returnedToolSubmission(records, call, tool): ReturnedToolSubmission
entryIdSchema // Zod schema for a positive integer EntryId
verdictSchema // Zod schema for PASS, FAIL, or INCONCLUSIVE

campaign.submitCandidate(material, requiredVerifiers): EntryId
campaign.call(options, runner): Promise<CallReceipt>
campaign.recordVerdict(call, verdict, evidence): EntryId
campaign.records(): readonly Entry[]
campaign.material(candidate): Uint8Array
campaign.close(): void

reader.records(): readonly Entry[]
reader.material(candidate): Uint8Array
reader.close(): void

defineTool(definition): Tool
runPi(campaign, options): Promise<PiResult> // from elenx/pi
piRequestAttempts(records, parent?): readonly PiRequestAttempt[] // from elenx/pi
derivePiSpend(records): PiSpend // from elenx/pi
piReasoning, piRequest, piTelemetry, piStoredResult // Zod schemas from elenx/pi
```

`piStoredResult` parses the JSON stored in a Pi call result, not the returned `PiResult` wrapper containing `call`. Every result includes `transcript` and `telemetry`; artifacts written by earlier schema versions are rejected at open by the campaign schema gate and require their matching released package. Unknown top-level fields are rejected.

All database methods are synchronous because Bun SQLite is synchronous. External execution through `call` and `runPi` is asynchronous.
