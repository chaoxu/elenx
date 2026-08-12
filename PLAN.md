# Elenx kernel v1 implementation plan

Build [`SPEC.md`](SPEC.md). It is the only authority. If implementation work exposes a missing contract decision, amend the spec first; do not create a ruling in this file.

## Working rules

1. Keep one package and one SQLite implementation.
2. Keep `src/core/` independent of model adapters and examples.
3. Add no concept merely because a future proof-search application might use it. The extension test is whether handlers, tools, candidates, events, and readers already suffice.
4. Every test protecting a guard must be observed failing under a deliberate mutation before its stage is committed.
5. A property that cannot be falsified by a test is recorded as a review item, never as verified behavior.
6. Make one focused commit per stage. Do not begin a later stage with a failing earlier-stage gate.

## Stage 0: repository and toolchain

Create the Bun/TypeScript package, exact dependency lock, formatter, typecheck, test command, and macOS/Linux CI.

Use exact versions for runtime dependencies. V1 pins both pi packages to `0.84.1`; upgrades are separate reviewed changes with adapter tests rerun.

**Verify:** a clean checkout installs reproducibly; formatting, type checking, and an empty test suite run through one `bun run check`; CI executes the same command on both supported platforms.

## Stage 1: records, blobs, and database

Implement hashes, JSON validation, the two-table schema, append-only triggers, exact selectors, blob storage, read-only access, and the sidecar writer lock.

Keep SQL in one module. Do not introduce store interfaces, synchronous mirrors, caches, migrations beyond a schema version check, or application-specific indexes.

**Verify:**

- `UPDATE` and `DELETE` fail on records and blobs;
- storing identical bytes twice is a no-op;
- replacing bytes behind a used hash fails through the configured writer connection;
- a reader opened before an append observes the append;
- a second writer is refused;
- `SIGKILL` releases the writer lock;
- records retain append order and blobs round-trip exact bytes;
- application events survive round-trip without acquiring semantic behavior.

**Review:** only `Kernel.close()` releases a live writer lock; there is no independent unlock, reclaim, steal, timeout, liveness, or takeover operation.

## Stage 2: candidate and promotion rules

Implement candidate-contract normalization and the pure functions for verdict views, standing FAILs, promotability, promotion idempotence, acceptance, premise cycles, and transitive premise failure.

Exercise the functions on hand-written record arrays before connecting them to the database.

**Verify:**

- an empty required-verifier set is refused;
- resubmitting identical material with a changed contract is refused;
- every required verifier must PASS the exact candidate;
- an optional verifier's standing FAIL also blocks;
- a later PASS does not erase a FAIL;
- a rebuttal clears only the named FAIL and supplies no PASS;
- INCONCLUSIVE and infrastructure failure do not block and do not satisfy;
- a failed or cyclic premise blocks promotion;
- a later premise FAIL makes existing dependents unaccepted;
- application events cannot change any answer;
- repeated promotion is a no-op.

## Stage 3: dispatch and cancellation

Implement the immutable handler registry, process roster record, exact `HandlerContext`, dispatch handles, one terminal completion, in-flight and abandoned derivation, and cooperative cancellation.

Use scripted handlers only. No provider dependency belongs in this stage.

**Verify:**

- worker and verifier reply shapes are enforced;
- handler context omits close and rebuttal, and model code never receives the context itself;
- dispatch ids are unique;
- a missing completion reads as in flight in the current process and abandoned after the next process record;
- cancel propagates one signal and waits for handler settlement;
- racing success, failure, and cancellation paths append exactly one completion;
- a handler ignoring cancellation remains honestly in flight.
- close refuses while any dispatch, call, or tool invocation remains in flight and releases the lock only after clean settlement.

## Stage 4: model calls and pi adapter

Define `ModelAdapter`, `ModelRequest`, tools, incremental tool records, transcripts, usage, and `HandlerContext.call`. Implement the bundled pi 0.84.1 adapter on `runAgentLoop`.

The `call` start record is written before provider work. One `call-result` records the terminal state. All provider interaction tests first use a scripted adapter; real-provider tests are opt-in.

**Verify:**

- two calls share no messages or continuation handle;
- every call belongs to a dispatch;
- the exact system text, prompt, adapter options, and tool declarations are blob-recoverable;
- every schema-admitted tool invocation is recorded before execution and every settled result is recorded independently of the final adapter transcript;
- a crash after a durable tool effect leaves its preceding `tool-call` on record;
- cancellation waits for tool settlement, and an uncooperative tool remains honestly in flight;
- racing tool return, error, and cancellation paths append exactly one `tool-result`;
- executable tool functions never enter the request blob;
- a model receives only the tools supplied for that call and no database handle, raw SQL, generic append operation, or unrestricted blob reader;
- the kernel validates tool arguments against the recorded schema before invoking application code;
- adapter options cannot enable unlisted provider-native tools;
- verifier output becomes a verdict only after its registered handler validates it;
- a two-request tool loop records both requests' usage, not only the final message's usage;
- absent usage remains absent rather than zero;
- cancellation retains reported partial output and the known usage floor;
- no code copies the requested model into the provider-reported field;
- unsupported adapter options are refused before a provider request;
- the bundled adapter spawns no CLI child and leaves no provider work alive after the process exits.

## Stage 5: kernel assembly and reader parity

Assemble campaign creation/opening, candidate submission, dispatch, rebuttal, promotion, application events, and the read-only API.

The writer and reader must call the same exported pure rule functions. Do not duplicate SQL-side or reporting-side promotion logic.

**Verify:** a fresh read-only process holding no application code agrees with the writer on every verdict, promotability, acceptance, in-flight, and abandoned result, and can recover every blob referenced by the log.

## Stage 6: hostile-audit reference slice

Build `examples/hostile-audit.ts` with one worker and one verifier. Keep all prompts and verdict parsing inside the example.

First run it against a scripted adapter:

1. create a campaign;
2. store and submit candidate material requiring `hostile-audit`;
3. dispatch the verifier;
4. observe PASS and promote;
5. reopen read-only and reproduce the result;
6. run FAIL, rebuttal, INCONCLUSIVE, cancellation, and crash fixtures.

Then run one two-line candidate against one real provider. Report that as an integration smoke, not as evidence of mathematical reliability.

**Verify:** deleting `examples/` does not change a core build or test; the example uses only the public API; all spend is attributable to a call and meter; every prompt and result is recoverable from the campaign database.

## Stage 7: maintenance pass

Before declaring kernel v1 complete:

- compare every public symbol and record field against `SPEC.md`;
- remove unused extension hooks and speculative configuration;
- confirm `src/core/` imports neither adapters nor examples;
- run the complete suite on macOS and Linux;
- inspect package contents as published;
- write a short application-author guide using the hostile-audit example.

## Implementation facts already measured

These facts came from the abandoned design work and remain relevant. Reproduce them as regression tests where practical; do not carry the old architecture with them.

- Locking the database file itself conflicts with enabling WAL. Lock a separate sidecar.
- `INSERT OR REPLACE` can substitute blob bytes behind an existing hash. Use `INSERT OR IGNORE`; enable `PRAGMA recursive_triggers = ON` on the writer; test raw SQL through that configured connection.
- `bun:sqlite` requires explicit read-only or read-write open flags when `create: false`.
- A read-only SQLite descriptor still needs a writable directory when WAL side files must be created.
- Pi 0.84.1 `AgentHarness` is an unimplemented stub. Use `runAgentLoop`.
- A tool loop's final assistant message contains only the last provider request's usage. Sum all billed request messages.
- Pi usually echoes the requested model and does not attest the served model. Record provider identity only when independently present in the response.
- An aborted pi run may synthesize an empty-usage failure message. Sum usage received before abort and retain unknown fields as absent.

## Deferred application work

Do not add any of the following while building kernel v1: autonomous coordination, route registries, idea gates, blind reconstruction, disclosure guards, source search, computation, filesystem policy, human-readable proof ledgers, steering, stop/resume commands, mathematical budgets, or a Coverify compatibility layer.

After kernel v1 passes its reference slice, build those in a separate proof-search application. A required kernel change at that point is evidence that the v1 boundary was incomplete and must be reviewed as such; it is not permission to pre-build the application now.
