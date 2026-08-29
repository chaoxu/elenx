# elenx-solve

`elenx-solve` runs a durable mathematical search over the Elenx append-only journal. The current protocol is `exploration-v17`.

Each turn a fresh explorer reasons over the standing-annotated note index and a curator-served working set, then reports self-contained findings; it has no submit path. The curator files every finding exactly once — minted, recorded as a refinement, or dropped as a duplicate. One verification subsystem holds every verifier: triage plans each new or revised note from a frozen mode menu (proof audit, reconstruction, refutation, external premises), fresh mode calls return verdicts, and standing derives from the verdicts — conditional inside, unconditional authority at the boundary. When the curator points at a goal note whose statement meets the completion criteria, mechanical checks (non-report goal, fully verified, acyclic ancestor closure) and the full boundary battery with criteria match decide the campaign. The verified tower is the result; the goal-note bytes are the kernel candidate. Assembly into a reader-facing document is external tooling over `export`.

The campaign journal remains the single source of truth. The note store is an in-memory projection rebuilt from the journal on every derivation and holds no independent authority.

## Run

```sh
bun install --frozen-lockfile
bun solve.ts run problem.md criteria.md run.db examples/exploration-sol-max.json
```

The settings file freezes the Pi role profiles and one isolated source-checker configuration:

- explorer
- curator (ingest and serve)
- triage
- mode verifier
- isolated source-checker model and reasoning

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

Export writes the verified goal note followed by its ancestor closure in dependency order. Campaigns from earlier protocols are unsupported.

## Authorities

- [`docs/protocol.md`](docs/protocol.md) defines runtime behavior.
- [`docs/data-flow.md`](docs/data-flow.md) defines role projections.
- [`docs/glossary.md`](docs/glossary.md) defines canonical terms.
- [`docs/roles.md`](docs/roles.md) explains trust boundaries.
- [`docs/guidance.md`](docs/guidance.md) defines explorer guidance.
- Elenx [`SPEC.md`](https://github.com/chaoxu/elenx/blob/main/SPEC.md) defines kernel guarantees.

## Development

```sh
bun run check
```

Protocol changes require correctness and simplification reviews against one frozen diff. Prompt, provider, or replay changes require one fresh live smoke. Live artifacts remain untracked under `runs/`.
