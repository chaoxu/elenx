# elenx-solve

`elenx-solve` runs a durable mathematical search loop over the Elenx append-only journal. Explorers produce mathematical claims and operational route records. Coordinators choose future context. Fresh auditors check exact immutable artifacts. The application reports `solved` only after a standalone public answer passes its own candidate-bound audit.

The current protocol is `exploration-v14`.

## Completion contract

A v14 campaign completes this sequence:

1. An explorer proposes a resolution that cites live `claim-N` roots.
2. `premise-audit`, when configured, resolves imported premises.
3. The required `proof-audit` freshly checks every claim in the transitive support closure, every direct dependency edge, every cited-root application, and the final composition.
4. Optional template auditors run their frozen methods.
5. Optional reconstruction receives one declared evidence DAG. Derivation and comparison receive byte-identical copies of that DAG.
6. A delivery assembler expands the modular proof into one standalone answer.
7. Elenx stores that answer as a second immutable candidate. A fresh `delivery-audit` sees only the task, exact answer bytes, and established sourced premise statements.

The modular resolution and linked delivery candidate must both be verified. A failed delivery stops with `delivery-failure`. The solver does not spend more calls regenerating the proof automatically.

`verified` remains a procedural status for the configured gates. External mathematical adjudication is the stronger standard.

## Compatibility

The legacy standalone `elenx-solve` repository retains release `v0.31.0` as the immutable replay and inspection engine for `exploration-v12` databases and release `v0.32.0` for `exploration-v13`. Those tags are not part of this monorepo's history. Use a checkout of the matching legacy tag with `bun install --frozen-lockfile`. The v14 engine refuses both older protocols before model dispatch and points to their releases.

V14 freezes every model's provider, ID, API, base URL, and requested reasoning. Resume fails before dispatch when any frozen field differs.

## Quick start

```sh
bun install --frozen-lockfile
bun solve.ts run problem.md criteria.md run.db examples/exploration-sol-max.json
```

A smaller configuration can use Luna:

```json
{
  "protocol": "exploration-v14",
  "memory": "claims-and-routes",
  "maxContextTokens": 200000,
  "explorerGuidance": [],
  "coordinatorGuidance": [],
  "coordinator": {
    "provider": "openai-codex",
    "model": "gpt-5.6-luna",
    "reasoning": "high"
  },
  "explorer": {
    "provider": "openai-codex",
    "model": "gpt-5.6-luna",
    "reasoning": "high"
  },
  "admissionAuditors": [],
  "resolutionAuditors": [
    {
      "kind": "proof-audit",
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "reasoning": "high"
    }
  ]
}
```

`memory` accepts `none`, `claims`, or `claims-and-routes`. Claims contain exact citable propositions and claim dependencies. Routes contain one attempted mechanism, its outcome, referenced claims, and an optional retry condition. Routes never enter a proof dependency graph.

`maxContextTokens` defaults to `200000` and bounds every structured model request, including terminal audits, reconstruction, delivery assembly, and delivery audit. The estimate is checked before dispatch.

Each Pi call receives one context package and one terminal tool. Calls use the SSE transport, permit eight transcript-preserving output-length continuations, and permit one in-call provider-error recovery. Provider-retryable failed calls restart the same journal-derived phase with capped exponential backoff. Deterministic failures stop immediately. The first `Ctrl-C` pauses after the active turn settles, and the second aborts the active provider operation.

## Resume, inspection, and export

```sh
bun solve.ts resume run.db examples/exploration-sol-max.json
bun solve.ts inspect run.db
bun solve.ts inspect --include-inputs run.db
bun solve.ts export run.db > answer.md
```

Inspection separates claims, routes, modular resolutions, and delivery candidates. It reports call settlement, audit targets, lineage, concurrency, provider telemetry, measured spend, accounting gaps, and unresolved checkpoints. `--include-inputs` adds exact requests, declared tools, source-search artifacts, and raw provider details.

`export` succeeds only when exactly one verified delivery is linked to a verified modular resolution. It writes the immutable audited answer bytes with no added newline.

## Authorities

- [`docs/protocol.md`](docs/protocol.md) defines exact v14 behavior.
- [`docs/roles.md`](docs/roles.md) explains the role boundaries.
- [`docs/guidance.md`](docs/guidance.md) defines frozen exploration guidance.
- Elenx [`SPEC.md`](https://github.com/chaoxu/elenx/blob/main/SPEC.md) defines kernel guarantees.

## Development

```sh
bun run check
```

Protocol changes require one frozen-diff correctness review and one simplification review. A live smoke is required when runtime, prompt, provider, delivery, or replay semantics change. Live run artifacts stay untracked under `runs/`.
