# Elenx

Elenx is a small durable kernel for verified agent work. It stores exact candidate bytes on append-only log rows, records every model call and admitted tool effect, binds verdicts to fresh calls carrying the candidate row sequence, and derives verified status from the complete log.

The package includes a thin Pi runner. Pi owns model execution, credentials, and provider behavior; Elenx records each logical call, pre-send payload checkpoints for provider operations that reach dispatch preparation, and settled Pi telemetry when the call completes, under the contract in [`SPEC.md`](SPEC.md). The application supplies the Pi registry and tools. Elenx never supplies a database handle, SQL, campaign path, generic append operation, or unrestricted candidate reader to a model.

Elenx deliberately excludes orchestration. Routes, context gathering, blind reconstruction, source search, retries, budgets, campaign UI, and human-readable files belong to applications. A Coverify replacement can build those independently around this kernel.

The v1 kernel contract requires Bun 1.3.14 or newer. Applications define tool schemas with Zod, so install both packages:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.7.4 zod@4.4.3
```

Elenx exposes Pi's types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

Elenx is an experimental harness. Its API and campaign schema may change directly; there are no migrations or compatibility aliases. Campaign files are accepted only when their schema matches the running package. Delete and rerun stale campaigns.

Contributors run `bun install --frozen-lockfile` and `bun run check`. The check includes formatting, strict TypeScript, a clean-consumer compile, the configured source-size ceiling, the complete test suite, and a package dry run.

- [`SPEC.md`](SPEC.md) is the normative v1 contract.
- [`docs/application-author.md`](docs/application-author.md) shows the public API and tool boundary.
- [`examples/v1/hostile-audit.ts`](examples/v1/hostile-audit.ts) is the smallest Coverify-shaped slice.
- [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) runs that slice through a real Pi model.
