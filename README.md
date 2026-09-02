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
| How does the current solver workflow behave? | [`packages/solve/docs/role-runner.md`](packages/solve/docs/role-runner.md) |
| What design boundary guided the retired `exploration-v15` solver? | [`docs/design.md`](docs/design.md) (historical, repository-only) |
| How do I build an application? | [`docs/application-author.md`](docs/application-author.md) |
| Which `exploration-v15` policies were to be tested? | [`docs/hypotheses.md`](docs/hypotheses.md) (historical, repository-only) |

Dated research is kept outside the current guidance:

- `docs/research/pi-package-mining.md` is a pinned research record, not a roadmap.

This research record is repository-only; the package contains only maintained consumer documentation.

The deterministic verifier example is [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts). [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) exercises the LLM-verdict path with a real Pi model.

## Solver

[`packages/solve`](packages/solve) supplies one durable role workflow. Explorers report findings, the coordinator files them and chooses the next action, and the verifier accepts only after its requirements, correctness, and refutation auditors pass. `run`, `resume`, and `trial` replay the same journaled input-output calls.

[`packages/solve/docs/role-runner.md`](packages/solve/docs/role-runner.md) defines the current runtime behavior. [`docs/design.md`](docs/design.md) and [`docs/hypotheses.md`](docs/hypotheses.md) remain historical, repository-only design background.

## Development

```sh
bun install --frozen-lockfile
bun run check:all
```

The check runs formatting, strict TypeScript, consumer compilation, both test suites, package checks, and the solver CLI smoke.

Run the hermetic role boundary from the repository root:

```sh
bun run e2e:roles
```

Run a fleet-backed development trial with durable local artifacts:

```sh
bun run debug:trial -- TRIAL.json runs/debug-name SETTINGS.json debug/name--r01/attempt-1
```

[`packages/solve/docs/role-runner.md`](packages/solve/docs/role-runner.md) defines the debug artifacts. Elenx Lab owns the shared local and Nomad attempt executor.
