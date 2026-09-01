# elenx-solve

`elenx-solve` runs a durable mathematical search over the Elenx append-only journal. The current protocol is `exploration-v17`.

Each turn a fresh explorer reasons over the standing-annotated note index and a curator-served working set, then reports self-contained findings. It has no submit path. Every distinct finding becomes an immutable note. Curator ingest writes its navigational summary, proposition-only statement proposal, and reconstruction guide, while the explorer's complete proof remains stored byte for byte. Exact duplicates are reused mechanically. Truth-establishing verdicts certify statement form, and proof audit also certifies fidelity to the text. Triage chooses a materially sufficient verification plan, fresh mode calls return verdicts with reasons, one append-only re-triage may supersede a stuck plan, and standing derives from mathematical evidence. Curator serve controls context within the token budget and declares a goal candidate. Mechanical closure checks and the boundary battery decide the campaign.

Boundary reconstruction follows a certified three-call cadence. A fresh certifier sees the candidate and every proposed reconstruction input. A candidate-blind reconstructor then receives the target, high-level guide, allowed sources, and only the goal's direct logical premise statements. It produces an independent proof rather than a verdict. A fresh comparator maps that proof back to the exact candidate and owns the reconstruction verdict. The transitive ancestor closure is checked for trust and circularity but never enters the blind reconstruction prompt. Mathematical boundary failures revoke premise trust, while criteria matching affects candidate acceptance only. The verified tower is the result, and the goal-note bytes are the kernel candidate. Assembly into a reader-facing document is external tooling over `export`.

The campaign journal remains the single source of truth. The note store is an in-memory projection rebuilt from the journal on every derivation and holds no independent authority. Dependency edges mean logical premise use, not provenance or drafting context; a standalone proof that re-establishes all needed mathematics has no parents.

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

`maxContextTokens` bounds every model request and serve rejects an oversized working set before it becomes a settled selection. Any other oversized phase ends with the replay-stable `context-limit` outcome before dispatch. `maxIndexTokens` bounds the assembled live index, and `maxExplorerTurns` bounds campaign exploration. Those ceilings end with `index-limit` or `turn-limit`. The explorer has no retrieval tool: recall is the index itself.

Every Pi call uses SSE, one required terminal tool, serial tool submission, eight output-length continuations, and one provider recovery. Provider-retryable phase failures restart from journal state with capped backoff.

Stable per-role prompt-cache keys are separate from random per-call transport sessions.

## Execution contract

External run managers read the versioned CLI contract without loading credentials or opening a campaign:

```sh
bun solve.ts contract
```

The contract identifies the application protocol, exact `run` argument order, report schema, and terminal conditions. Every CLI run report carries the same schema version, application ID, and protocol. A manager freezes this object with the run and refuses a checkout or worker image that reports a different contract.

## Model routing

The explorer, curator, triage, and verifier profiles accept any endpoint the
Pi model registry can reach, including the codex-lb `/v1` proxy. The isolated
source checker stays on native Codex OAuth: `web_search` is a server-side
ChatGPT tool that an API-key `/backend-api/codex` proxy does not provision,
so a source check routed through such a proxy performs zero searches and
fails its own no-search guard. Leave every `ELENX_SOURCE_CODEX_*` variable
unset unless the target is another OAuth-authenticated Codex install.

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

The solver imports the kernel through bun's materialized workspace copy. After any kernel change under `src/`, run `bun install` at the repo root — until then the solver silently runs the stale kernel.
