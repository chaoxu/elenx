# elenx-solve

`elenx-solve` runs a durable mathematical search over the Elenx append-only journal. The current protocol is `exploration-v15`.

Each explorer receives one reviewed bounded handoff rather than campaign history. A submitted answer becomes the exact candidate bytes. An offline premise audit invokes isolated web verification only for unresolved external premises, then a fresh proof audit checks the standalone answer.

## Run

```sh
bun install --frozen-lockfile
bun solve.ts run problem.md criteria.md run.db examples/exploration-sol-max.json
```

The settings file freezes four Pi profiles and one isolated source-checker configuration:

- explorer
- handoff verifier
- offline premise verifier
- isolated source-checker model and reasoning
- exact proof verifier

`maxContextTokens` bounds every model request. `maxHandoffTokens` bounds the packet crossing between explorers. `maxRepairDepth`, `null` by default, bounds consecutive repairs of one failed candidate line; reaching it reports `repair-limit`.

Every Pi call uses SSE, one required terminal tool, serial tool submission, eight output-length continuations, and one provider recovery. Provider-retryable phase failures restart from journal state with capped backoff.

Stable per-role prompt-cache keys are separate from random per-call transport sessions.

## Resume, inspect, and export

```sh
bun solve.ts resume run.db examples/exploration-sol-max.json
bun solve.ts inspect run.db
bun solve.ts inspect --include-inputs run.db
bun solve.ts export run.db > answer.md
```

Export writes only accepted candidate bytes. V12, v13, and v14 campaigns require `elenx-solve` v0.31.0, v0.32.0, and v0.33.0 respectively.

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
