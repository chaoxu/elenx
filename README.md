# Elenx

Elenx is a small durable kernel for verified agent work. It stores exact candidate bytes on append-only log rows, records every model call and admitted tool effect, binds verdicts to fresh calls carrying the candidate row sequence, and derives verified status from the complete log.

The package includes a thin Pi runner. Pi owns model execution, credentials, and provider behavior; Elenx records the call and supplies only the Zod-defined tools selected for it. Before each provider operation, Elenx checkpoints the JSON-semantic payload exposed by Pi's final pre-send hook. Each operation is also recorded as a standard `pi.ai.request` telemetry span under its Elenx call, while the parent `elenx.pi.run` span retains the requested reasoning level. Accounting sums request-leaf model, outcome, token, cache, and Pi model-price fields only: the native transcript contains the same usage, and reasoning tokens are already part of output tokens. The Pi registry is application-supplied and trusted. Custom adapters must invoke the hook exactly once before dispatch and must keep credentials and tokens in authentication fields or headers rather than the semantic payload. Elenx never supplies a database handle, SQL, campaign path, generic append operation, or unrestricted candidate reader to a model.

Elenx deliberately excludes orchestration. Routes, context gathering, blind reconstruction, source search, retries, budgets, campaign UI, and human-readable files belong to applications. A Coverify replacement can build those independently around this kernel.

Elenx v1 requires Bun 1.3.14 or newer. Applications define tool schemas with Zod, so install both packages:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#main zod@4.4.3
```

Elenx exposes Pi's types directly. Keep TypeScript's `skipLibCheck` enabled while Pi 0.84.1's provider SDK declarations require it.

Elenx is an experimental harness. Its API and campaign schema may change directly; there are no migrations or compatibility aliases. Campaign files are accepted only when their schema matches the running package. Delete and rerun stale campaigns.

Contributors run `bun install --frozen-lockfile` and `bun run check`. The check includes formatting, strict TypeScript, a clean-consumer compile, the configured source-size ceiling, and the complete test suite.

- [`SPEC.md`](SPEC.md) is the normative v1 contract.
- [`docs/application-author.md`](docs/application-author.md) shows the public API and tool boundary.
- [`examples/v1/hostile-audit.ts`](examples/v1/hostile-audit.ts) is the smallest Coverify-shaped slice.
- [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) runs that slice through a real Pi model.
