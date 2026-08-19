# Elenx

Elenx is a small durable kernel for verified agent work. It stores exact candidate bytes on append-only log rows, records every model call and admitted tool effect, binds verdicts to fresh calls carrying the candidate row sequence, and derives verified status from the complete log.

The package includes a thin Pi runner. Pi owns model execution, credentials, and provider behavior; Elenx records each logical call, pre-send payload checkpoints for provider operations that reach dispatch preparation, and settled Pi telemetry when the call completes, under the contract in [`SPEC.md`](SPEC.md). The application supplies the Pi registry and tools. Elenx never supplies a database handle, SQL, campaign path, generic append operation, or unrestricted candidate reader to a model.

Elenx deliberately excludes orchestration. Routes, context gathering, blind reconstruction, source search, retries, budgets, campaign UI, and human-readable files belong to applications. A Coverify replacement can build those independently around this kernel.

The v1 kernel contract requires Bun 1.3.13 or newer. Applications define tool schemas with Zod, so install both packages:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.7.11 zod@4.4.3
```

Elenx exposes Pi's types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

Elenx is an experimental harness. Its API and campaign schema may change directly; there are no migrations or compatibility aliases. Campaign files are accepted only when their schema matches the running package. Preserve an old campaign with its matching tagged package, and write any rerun to a new artifact.

Contributors run `bun install --frozen-lockfile` and `bun run check`. The check includes formatting, strict TypeScript, a consumer compile against the checkout, the complete test suite, and an independent typecheck and runtime smoke installed from the produced tarball.

- [`SPEC.md`](SPEC.md) is the normative v1 contract.
- [`docs/application-author.md`](docs/application-author.md) shows the public API and tool boundary.
- [The Pi package mining study](https://gitea.lab/chaoxu/elenx/src/branch/main/docs/pi-package-mining-study.md) records which Pi ecosystem mechanisms fit outside that boundary.
- [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts) is a deterministic adapter and persistence slice.
- [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) independently exercises the LLM-verdict path with a real Pi model.
