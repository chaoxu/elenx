# elenx-solve

`elenx-solve` runs a durable mathematical search over the Elenx append-only journal. The current protocol is `exploration-v16`.

Each turn a fresh explorer reasons over the complete live note index and a bounded working set of full notes, then reports self-contained findings or submits one standalone answer. A thin curator files every reported finding into the durable note store — minted, recorded as a refinement, or dropped as a duplicate — and invalidates notes only while ingesting a verifier verdict. A submitted answer becomes the exact candidate bytes. An offline premise audit invokes isolated web verification only for unresolved external premises, then a fresh proof audit checks the standalone answer.

The campaign journal remains the single source of truth. The note store is a Cozo materialization rebuilt in memory from the journal on every derivation; deleting it loses nothing.

## Run

```sh
bun install --frozen-lockfile
bun solve.ts run problem.md criteria.md run.db examples/exploration-sol-max.json
```

The settings file freezes the Pi role profiles and one isolated source-checker configuration:

- explorer
- curator
- offline premise verifier
- isolated source-checker model and reasoning
- exact proof verifier

`maxContextTokens` bounds every model request. `maxIndexTokens` bounds the assembled live index: each exploration status line reports the estimate, and exceeding the ceiling ends the campaign with the terminal report `index-limit`. The explorer has no retrieval tool; recall is the index itself.

Every Pi call uses SSE, one required terminal tool, serial tool submission, eight output-length continuations, and one provider recovery. Provider-retryable phase failures restart from journal state with capped backoff.

Stable per-role prompt-cache keys are separate from random per-call transport sessions.

## Execution contract

External run managers read the versioned CLI contract without loading credentials or opening a campaign:

```sh
bun solve.ts contract
```

The contract identifies the application protocol, exact `run` argument order, report schema, and terminal conditions. Every CLI run report carries the same schema version, application ID, and protocol. A manager freezes this object with the run and refuses a checkout or worker image that reports a different contract.

## Resume, inspect, and export

```sh
bun solve.ts resume run.db examples/exploration-sol-max.json
bun solve.ts inspect run.db
bun solve.ts inspect --include-inputs run.db
bun solve.ts export run.db > answer.md
```

Export writes only accepted candidate bytes. V12, v13, v14, and v15 campaigns require `elenx-solve` v0.31.0, v0.32.0, v0.33.0, and v0.34.0 respectively.

## Authorities

- [`docs/protocol.md`](docs/protocol.md) defines runtime behavior.
- [`docs/data-flow.md`](docs/data-flow.md) defines role projections.
- [`docs/verification-gates.md`](docs/verification-gates.md) defines handoff and candidate gates.
- [`docs/glossary.md`](docs/glossary.md) defines canonical terms.
- [`docs/roles.md`](docs/roles.md) explains trust boundaries.
- [`docs/guidance.md`](docs/guidance.md) defines explorer guidance.
- Elenx [`SPEC.md`](https://github.com/chaoxu/elenx/blob/main/SPEC.md) defines kernel guarantees.

## Development

```sh
bun run check
```

Protocol changes require correctness and simplification reviews against one frozen diff. Prompt, provider, or replay changes require one fresh live smoke. Live artifacts remain untracked under `runs/`.
