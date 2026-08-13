# Elenx

Elenx is a small durable kernel for verified agent work. It stores exact candidate bytes, records every model call and admitted tool effect, binds verdicts to fresh calls carrying that candidate hash, and derives verified status from the complete verdict log.

The package includes a thin Pi runner. Pi owns model execution, credentials, and provider behavior; Elenx records the call and supplies only the Zod-defined tools selected for it. The Pi registry is application-supplied and trusted. Elenx never supplies a database handle, SQL, campaign path, generic append operation, or unrestricted blob reader to a model.

Elenx deliberately excludes orchestration. Routes, context gathering, blind reconstruction, source search, retries, budgets, campaign UI, and human-readable files belong to applications. A Coverify replacement can build those independently around this kernel.

Elenx v1 requires Bun 1.3.14 or newer. Applications define tool schemas with Zod, so install both packages:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.2.0 zod@4.4.3
```

Elenx exposes Pi's types directly. Keep TypeScript's `skipLibCheck` enabled while Pi 0.84.1's provider SDK declarations require it.

Version 0.2.0 uses campaign schema 2 and does not open experimental 0.1.x artifacts.

Contributors run `bun install --frozen-lockfile` and `bun run check`. The check includes formatting, strict TypeScript, a clean-consumer compile, a 1,500-nonblank-source-line ceiling, and the complete test suite.

- [`SPEC.md`](SPEC.md) is the normative v1 contract.
- [`docs/application-author.md`](docs/application-author.md) shows the public API and tool boundary.
- [`examples/v1/hostile-audit.ts`](examples/v1/hostile-audit.ts) is the smallest Coverify-shaped slice.
- [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) runs that slice through a real Pi model.
