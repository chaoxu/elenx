# Elenx

Elenx is a durable semantic kernel for agent work. It stores exact candidate bytes, records calls, tool invocations, settled tool results, and unknown tool outcomes through an append-only campaign API, binds verdicts to fresh candidate-scoped calls, and derives verification status from the recorded evidence.

The bundled Pi runner executes application-selected models and Zod tools. Pi owns provider execution and credentials; Elenx records logical calls, pre-send request checkpoints, and settled telemetry. Durable continuation extends an output-limited response with its validated transcript, frozen model profile, and tool contract.

The kernel enforces identity, durability, crash semantics, and accounting contracts. It records application-selected capabilities but does not sandbox the runner. The model owns reasoning strategy. Applications own context assembly, tools, budgets, verification methods, and publication. Elenx contains no task corpus, benchmark suite, evaluation runner, or mathematical search policy.

## Install

The v1 kernel requires Bun 1.3.13 or newer. Applications define tool schemas with Zod:

```sh
bun add github:chaoxu/elenx zod@4.4.3
```

Elenx exposes Pi types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

The API and campaign schema are experimental. Campaigns are accepted only when their schema matches the running package; preserve an old campaign with its matching tagged package and write reruns to new artifacts.

## Documentation

| Question | Authority |
| --- | --- |
| What does the kernel guarantee? | [`SPEC.md`](SPEC.md) |
| What design boundary guides solver policies? | [`docs/design.md`](docs/design.md) |
| How do I build an application? | [`docs/application-author.md`](docs/application-author.md) |
| Which solver policies should we test? | [`docs/hypotheses.md`](docs/hypotheses.md) |

Dated research is kept outside the current guidance:

- `docs/research/pi-package-mining.md` is a pinned research record, not a roadmap.

This research record is repository-only; the package contains only maintained consumer documentation.

The deterministic verifier example is [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts). [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) exercises the LLM-verdict path with a real Pi model.

## Solver

[`packages/solve`](packages/solve) supplies the `exploration-v16` protocol. Fresh explorers reason over a durable note index curated from every reported finding rather than campaign history. A submitted standalone answer becomes the candidate bytes. Offline premise verification uses isolated web search only for unresolved external claims, then a fresh proof audit checks the exact answer.

[`docs/design.md`](docs/design.md) defines the governing design direction. [`packages/solve/docs/protocol.md`](packages/solve/docs/protocol.md) remains the authority for exact runtime behavior.

## Development

```sh
bun install --frozen-lockfile
bun run check:all
```

The check runs formatting, strict TypeScript, consumer compilation, both test suites, package checks, and the solver CLI smoke.
