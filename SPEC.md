# Elenx kernel v1 specification

This file is the sole normative contract for kernel v1. `PLAN.md` controls build order but cannot change this contract. `RATIONALE.md` is explanatory only.

## 1. Purpose

Elenx is a library for applications whose agent work must be recorded and whose acceptance protocol must not be skippable.

It provides:

- one durable, append-only campaign artifact;
- immutable blobs addressed by content hash;
- application-defined workers and verifiers;
- fresh model calls with exact request, transcript, result, and usage records;
- dispatch tracking and cooperative cancellation;
- content-bound verdicts, rebuttals, premises, promotions, and derived acceptance;
- opaque application events for every workflow concept outside the kernel.

Elenx guarantees protocol execution, not the truth of a model judgment:

> A candidate is accepted only when the required records exist and no recorded blocker stands.

The application decides what candidates mean, which verifiers are required, what workers do, and what an accepted result is called in its user interface.

## 2. Boundary

Kernel vocabulary is limited to campaigns, blobs, candidates, premises, workers, verifiers, verdicts, rebuttals, promotions, dispatches, model calls, and application events.

The kernel must not name or implement proof-search concepts such as routes, gates, reconstruction, blindness, literature search, computation, budgets, frontiers, or lessons. Applications may implement all of them through handlers, tools, candidate contracts, and application events.

V1 is one package with a one-way source boundary:

```text
src/core/       records, database, rules, dispatch, calls
src/adapters/   model adapters, initially pi
examples/       non-normative applications
```

`src/core/` never imports `src/adapters/` or `examples/`. Model adapters implement a core port. There is one store implementation in v1; no store port is exposed.

## 3. Campaign artifact

A campaign is one SQLite database containing records and blobs. Its identity is the artifact itself. Moving or copying it does not require an id file, side database, mirror, or adoption protocol.

A writer holds an exclusive OS lock on a separate `<database>.writer-lock` sidecar until `Kernel.close()` or process exit. The sidecar contains no campaign facts. The lock has no timeout, liveness probe, takeover, or reclaim API. There is no public unlock operation independent of closing the kernel. Read-only processes do not take the writer lock.

The database uses WAL mode. Its directory must be writable even for a live read-only view because SQLite may need `-wal` and `-shm` files.

The writer appends; it never updates or deletes. SQLite triggers reject `UPDATE` and `DELETE` on both tables. This protects access through Elenx and through connections configured like its writer. It is not tamper resistance against an operator with arbitrary SQL or filesystem access.

## 4. Blobs and hashes

Prompts, responses, transcripts, handler inputs and outputs, candidates, reasons, configuration, and any large application payload are blobs.

```ts
type Hash = `sha256:${string}`;
```

The hash is SHA-256 over exact bytes. `put(bytes)` uses `INSERT OR IGNORE`; storing the same bytes twice is a no-op. A hash provides content identity, not authentication.

JSON record bodies may refer to blobs by hash. A record referring to a missing blob makes the campaign defective.

## 5. Records

Records have a monotonically increasing integer `seq`, an informational millisecond timestamp, a closed kernel kind, indexed correlation fields, and a JSON body. Only `seq` determines order.

Kernel record kinds are:

| kind | purpose |
|---|---|
| `campaign` | application id, application configuration blob, kernel schema version |
| `process` | kernel version, registered handler names and kinds, registered adapter ids |
| `candidate` | material hash, nonempty required-verifier set, internal premise hashes |
| `dispatch` | dispatch id, handler name and kind, input hash, opaque JSON metadata |
| `call` | call id, dispatch id, label, exact serializable request blob |
| `tool-call` | call id, invocation id, tool name, application-facing argument blob |
| `tool-result` | invocation id, terminal state, exact result or error blob |
| `call-result` | call id, terminal state, adapter-reported transcript/output blobs, usage, optional provider-reported model |
| `completion` | dispatch id, terminal state and output/error blob; verifier verdict when applicable |
| `promotion` | candidate hash and the completion records satisfying its required verifiers |
| `rebuttal` | exact failing completion seq and reason blob |
| `event` | application topic, JSON data, and referenced blob hashes |

Applications never add record kinds. They append `event` records. Kernel rules ignore every `event` field.

An incomplete `dispatch`, `call`, or tool invocation has a start record and no corresponding terminal record. It is in flight in the current process and abandoned after a later `process` record. No clock or pid is used to derive this state.

## 6. Candidate contract

The application submits exact candidate material, a nonempty set of required verifier names, and zero or more internal premise candidate hashes.

The candidate id is the material hash. The first `candidate` record for that hash freezes its required verifier set and premises. A later submission of the same material with a different contract is refused. Applications that need a different contract must submit different material, normally an envelope containing the application-level statement, result, dependencies, and revision identity.

Required verifier names are unique and sorted before recording. Premise hashes are unique and sorted before recording. A candidate cannot name itself as a premise.

The kernel interprets premises only as dependencies on other candidates in the same campaign. Citations, assumptions, imported theorems, and external evidence remain part of application material unless the application explicitly represents them as internal candidates.

## 7. Handlers and dispatch

An application supplies an immutable registry when opening a writer:

```ts
type HandlerKind = "worker" | "verifier";

interface Handler {
  readonly name: string;
  readonly kind: HandlerKind;
  run(ctx: HandlerContext, input: Uint8Array, meta: Json): Promise<HandlerReply>;
}

type HandlerReply =
  | { output: Uint8Array }
  | {
      output: Uint8Array;
      candidate: Hash;
      verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
    };

interface HandlerContext {
  readonly dispatchId: string;
  readonly signal: AbortSignal;
  call(request: ModelRequest): Promise<ModelResult>;
  submitCandidate(material: Uint8Array, contract: CandidateContract): Promise<Hash>;
  dispatch(name: string, input: Uint8Array, meta?: Json): Promise<DispatchHandle>;
  promote(candidate: Hash): Promise<void>;
  appendEvent(topic: string, data: Json, blobs?: readonly Uint8Array[]): Promise<void>;
  records(selector?: RecordSelector): Promise<readonly Record[]>;
  blob(hash: Hash): Promise<Uint8Array>;
  verdicts(candidate: Hash): Promise<readonly VerdictView[]>;
  promotable(candidate: Hash): Promise<PromotionCheck>;
  accepted(candidate: Hash): Promise<AcceptanceCheck>;
}
```

A worker must return the first form. A verifier must return the second, and its candidate must already exist. A kind mismatch is a defect and produces no successful completion.

`HandlerContext` is the trusted application-code surface available during one dispatch. It omits campaign closing and rebuttal. Applications may wrap selected methods in model tools, but must never hand the context itself to a model.

`dispatch(name, input, meta)` stores the input, appends a `dispatch`, and returns:

```ts
interface DispatchHandle {
  readonly id: string;
  readonly settled: Promise<Completion>;
  cancel(reason?: string): Promise<Completion>;
}
```

Each dispatch receives its own `AbortSignal`. Cancellation is cooperative: it aborts model calls and tools through that signal, waits for the handler to settle, then writes exactly one terminal completion. A handler or tool that ignores cancellation remains in flight. Competing settle paths must never write two completions.

All model calls occur inside a dispatch. A model-driven coordinator is an ordinary worker handler, so every call always has a dispatch id.

## 8. Model adapter port

The kernel depends on this port:

```ts
interface ModelAdapter {
  readonly id: string;
  run(request: AdapterRequest): Promise<AdapterResult>;
}

interface AdapterRequest {
  readonly model: string;
  readonly system?: string;
  readonly prompt: string;
  readonly tools: readonly WrappedTool[];
  readonly adapterOptions?: Json;
  readonly signal: AbortSignal;
}

interface WrappedTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  execute(args: Json): Promise<Json>;
}

interface AdapterResult {
  readonly state: "succeeded" | "failed" | "cancelled";
  readonly output?: string;
  readonly transcript?: Json;
  readonly usage: readonly Usage[];
  readonly providerModel?: string;
  readonly error?: string;
}

type ModelResult = AdapterResult;
```

The kernel constructs `AdapterRequest`; application code cannot supply it directly. Adapters receive the dispatch signal and only kernel-wrapped tools. Provider failure and cancellation return an `AdapterResult` rather than throwing so partial transcript and usage can be retained. If an adapter itself throws, the kernel records a failed `call-result` with the available error and no invented transcript or usage.

`HandlerContext.call` accepts:

```ts
interface ModelRequest {
  readonly adapter: string;
  readonly model: string;
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly tools?: readonly Tool[];
  readonly adapterOptions?: Json;
}
```

`adapterOptions` is recorded and passed to the named adapter; each adapter validates its own closed option set and refuses unknown values. V1 adapters must refuse options that enable provider-native tools or other model-visible capabilities outside `tools`.

A call is one fresh adapter invocation with no prior messages or continuation handle. A tool loop may make several billed provider requests inside that invocation. Prefix caching is allowed; conversational continuation across calls is not expressible.

An application `Tool` has a name, description, JSON Schema Draft 2020-12 parameters, and `execute(args: Json, signal: AbortSignal): Promise<Json>`. The serializable call request records the name, description, and schema, never the executable function. Tool implementation and authority belong to the application.

The kernel wraps every tool before passing it to an adapter. For each attempted invocation it commits `tool-call`, validates the application-facing JSON arguments against the recorded schema with a maintained JSON Schema library, and only then invokes application code. It appends exactly one `tool-result` when execution settles normally, throws, or acknowledges cancellation; schema refusal settles without invoking application code. Cancellation signals the tool and waits. A tool that ignores the signal keeps the tool invocation, call, and dispatch in flight rather than allowing later effects after a terminal record. A crash may leave a `tool-call` abandoned, but cannot erase the request that preceded a durable tool effect.

The kernel appends `call` before invoking the adapter and exactly one `call-result` after it settles. The result is `succeeded`, `failed`, or `cancelled`. Partial output and usage received before failure or cancellation are retained. Model messages and provider-attempt details in `call-result` are adapter-reported; adapters are trusted for their accuracy. Tool calls and results are recorded independently by the kernel wrapper.

Usage fields are optional measurements, never defaulted to zero when absent:

```ts
interface Usage {
  readonly meter: string;
  readonly requests: number;
  readonly input?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly output?: number;
  readonly reasoning?: number;
}
```

Readers group by `meter` and never produce a cross-meter total. The adapter may record a provider-reported served model when the provider supplies one; absence means unknown. The requested model is never presented as attestation.

## 9. Agent-facing tools and authority

The kernel exposes no database tool to a model. Trusted application code receives the public `Kernel`, `Reader`, or `HandlerContext` APIs; a model receives only the `Tool[]` explicitly supplied for that one call.

An application tool is a narrow capability, not a database wrapper. Its implementation maps one role-specific action onto application policy and selected handler-context operations. Agents never receive raw SQL, a database handle or path, generic record append, unrestricted blob enumeration, or arbitrary host-filesystem access. An application may deliberately expose a separately sandboxed filesystem capability.

Typical application tools may include:

- `inspect_frontier`: return a bounded proof-search view derived by the application;
- `assign_route`: dispatch one application-selected worker under route policy;
- `request_verification`: dispatch the application-selected verifier set on a known candidate;
- `accept_verified_result`: request promotion without letting the model alter the frozen contract; and
- `record_route_outcome`: append one fixed application event shape.

These names are examples, not kernel exports. An application supplies only the subset required by the current role. A blind verifier may receive no tools. Read tools use explicit application-scoped selectors or allowlists, and write tools describe semantic actions; neither exposes handler names, verifier contracts, event topics, or underlying tables as model-chosen storage parameters.

Models do not write verdict records. A registered verifier handler parses and validates its model output, and the kernel records the resulting completion. The public `rebut` method is for trusted application code; the reference application exposes no corresponding model tool. Because Elenx is a library rather than a security boundary around its caller, an application remains responsible for which tools it supplies.

## 10. Verdict and promotion rules

Rules are pure functions over committed records. Store code does not implement them, and readers use the same exported functions as the writer.

A failing completion stands when:

- it is a verifier `FAIL` for the candidate; and
- no later `rebuttal` names that exact completion seq.

A later PASS never displaces a standing FAIL. A rebuttal clears only the named FAIL; it does not create a PASS.

A candidate is promotable when:

1. every verifier named by its frozen contract has at least one PASS completion on that exact candidate;
2. no FAIL from any verifier stands against that candidate;
3. every internal premise is currently accepted; and
4. the premise graph is acyclic.

`promote(candidate)` refuses unless the candidate is promotable, then appends one promotion naming the PASS completions that satisfied the contract. Repeated promotion of the same candidate is idempotent.

A promoted candidate is accepted while it and all transitive internal premises have no standing FAIL. A later FAIL can therefore make an existing promotion and its dependents unaccepted without mutating history. A rebuttal or a new accepted premise can restore derived acceptance.

`INCONCLUSIVE`, protocol failure, adapter failure, cancellation, and an abandoned dispatch neither satisfy a required verifier nor stand as a FAIL.

## 11. Public surface

The public API is asynchronous and consists of:

```ts
createCampaign(path, { application, config, handlers, adapters }): Promise<Kernel>
openCampaign(path, { handlers, adapters }): Promise<Kernel>
openReader(path): Promise<Reader>

kernel.submitCandidate(material, contract): Promise<Hash>
kernel.dispatch(name, input, meta?): Promise<DispatchHandle>
kernel.rebut(failingCompletionSeq, reason): Promise<void>
kernel.promote(candidate): Promise<void>
kernel.appendEvent(topic, data, blobs?): Promise<void>
kernel.verdicts(candidate): Promise<readonly VerdictView[]>
kernel.promotable(candidate): Promise<PromotionCheck>
kernel.accepted(candidate): Promise<AcceptanceCheck>
kernel.close(): Promise<void>

reader.records(selector?): Promise<readonly Record[]>
reader.blob(hash): Promise<Uint8Array>
reader.verdicts(candidate): Promise<readonly VerdictView[]>
reader.promotable(candidate): Promise<PromotionCheck>
reader.accepted(candidate): Promise<AcceptanceCheck>
reader.close(): Promise<void>
```

`Kernel.close()` refuses while any dispatch, call, or tool invocation is in flight. The caller must wait or request cancellation first. A successful close closes the database and releases the writer lock; it can never release the lock while handler or tool code may still append.

Selectors perform exact AND matching on the fixed indexed fields `kind`, `dispatch`, `name`, and `candidate`. There are no ranges, joins, text search, cursors, or application-event indexes in v1.

Every refusal is a typed `Refusal` with an actionable human-readable message. Defects use a distinct `Defect` type. Neither requires applications to parse prose for control flow; structured fields identify the refused operation and relevant record ids.

## 12. Bundled pi adapter

V1 ships one adapter for exactly pinned `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` 0.84.1. It uses the working `runAgentLoop` surface, not `AgentHarness`.

The adapter must:

- create a fresh loop for each call;
- pass the dispatch signal through provider retries and tool execution;
- sum usage over all billed requests in the tool loop rather than reading only the final message;
- preserve absent usage fields as absent;
- retain partial messages and usage on failure or cancellation;
- record provider-reported model identity only when the adapter received it from the provider;
- validate `adapterOptions` and reject unsupported provider capabilities;
- avoid spawning CLI providers or retaining vendor-side conversation state.

Additional adapters may be separate packages implementing `ModelAdapter`; they do not require kernel changes.

## 13. Reference slice

`examples/hostile-audit.ts` is a non-normative application used to prove the kernel works end to end. It registers:

- one worker that returns hand-supplied candidate material; and
- one verifier that makes a fresh hostile-audit call and parses PASS, FAIL, or INCONCLUSIVE.

The example submits a candidate requiring that verifier, dispatches it, promotes it after PASS, and prints status and spend derived from the database. It contains no autonomous driver, routes, blind reconstruction, source search, computation, or reusable proof-search policy.

Passing this slice proves persistence, call recording, verdict binding, and promotion mechanics. It does not prove mathematical correctness or that an orchestration strategy is effective.

## 14. Out of scope for kernel v1

- proof-search or other domain policy;
- a resident coordinator or autonomous loop;
- routes, gates, frontiers, ledgers, lessons, or claim-taxonomy policy;
- blind reconstruction or information-flow classification;
- literature search, filesystem tools, code execution, or compute supervision;
- budgets, concurrency policy, retries of mathematical work, or stopping policy;
- statement amendment, campaign adoption, identity reset, or cross-campaign reuse;
- verdict reuse or caching;
- a swappable store, remote database, daemon, server, or web interface;
- human-readable application exports beyond the reference example;
- compatibility with Coverify campaign directories or internal APIs.

These are application concerns or later evidence-driven extensions. Kernel v1 is sufficient when they can be implemented through handlers, tools, candidates, events, and readers without changing the records or promotion rules.

## 15. Acceptance criteria

Kernel v1 is complete when:

- the database and lock invariants pass crash and second-process tests;
- every promotion-rule guard has been mutation-checked;
- fresh calls, tool transcripts, usage aggregation, cancellation, and partial results pass adapter tests;
- an application event cannot affect any promotion result;
- a fresh read-only process can reconstruct all verdict, promotability, and acceptance answers and recover the exact bytes of every referenced blob;
- the hostile-audit reference slice succeeds with a scripted adapter and with one real provider;
- deleting `examples/` leaves the kernel build and tests intact;
- CI passes on macOS and Linux.
