# Elenx

Elenx is a durable semantic kernel for agent work. It stores exact candidate bytes, records calls, tool invocations, settled tool results, and unknown tool outcomes through an append-only campaign API, binds verdicts to fresh candidate-scoped calls, and derives verification status from the recorded evidence.

The bundled Pi runner executes application-selected models and Zod tools. Pi owns provider execution and credentials; Elenx records logical calls, pre-send request checkpoints, and settled telemetry. Durable continuation extends an output-limited response with its validated transcript, frozen model profile, and tool contract.

The kernel enforces identity, durability, crash semantics, and accounting contracts. It records application-selected capabilities but does not sandbox the runner. The model owns reasoning strategy. Applications own context assembly, tools, budgets, verification methods, and publication. Elenx contains no task corpus, benchmark suite, evaluation runner, or mathematical search policy.

## Install

The v1 kernel requires Bun 1.3.13 or newer. Applications define tool schemas with Zod:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.7.12 zod@4.4.3
```

Elenx exposes Pi types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

The API and campaign schema are experimental. Campaigns are accepted only when their schema matches the running package; preserve an old campaign with its matching tagged package and write reruns to new artifacts.

## Documentation

| Question | Authority |
| --- | --- |
| What does the kernel guarantee? | [`SPEC.md`](SPEC.md) |
| What is the proposed next solver design and philosophy? | [`docs/design.md`](docs/design.md) |
| How do I build an application? | [`docs/application-author.md`](docs/application-author.md) |
| Which proposed solver policies should we test? | [`docs/hypotheses.md`](docs/hypotheses.md) |

Dated research is kept outside the current guidance:

- `docs/research/pi-package-mining.md` is a pinned research record, not a roadmap.

This research record is repository-only; the package contains only maintained consumer documentation.

The deterministic verifier example is [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts). [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) exercises the LLM-verdict path with a real Pi model.

## Companion solver

[`elenx-solve`](https://gitea.lab/chaoxu/elenx-solve) supplies the current model-first discovery loop: one bounded serial coordinator, an optional serial sub-agent, and switchable `done`, `stop`, `open`, and `next` projections. Submitted work remains an unverified Elenx candidate until assurance records admitted verdicts such that every required verifier has a `PASS` and none has a `FAIL`.

The proposed replacement in [`docs/design.md`](docs/design.md) is not implemented. It changes the solver to a user-controlled resumable campaign with serial reasoner, reviewer, and verifier turns, explicit context packages, and no model-selected terminal limit. [`elenx-solve/docs/protocol.md`](https://gitea.lab/chaoxu/elenx-solve/src/branch/main/docs/protocol.md) remains the authority for current solver behavior.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

The check runs formatting, strict TypeScript, a consumer compile, the full test suite, and a tarball-installed consumer smoke.
