# Elenx

Elenx is a durable semantic kernel for agent work. It stores exact candidate bytes, records calls, tool invocations, settled tool results, and unknown tool outcomes through an append-only campaign API, binds verdicts to fresh candidate-scoped calls, and derives verification status from the recorded evidence.

The bundled Pi runner executes application-selected models and Zod tools. Pi owns provider execution and credentials. Elenx records logical calls, pre-send request checkpoints, and settled telemetry. Durable continuation extends an output-limited response with its validated transcript, frozen model profile, and tool contract.

The kernel enforces identity, durability, crash semantics, and accounting contracts. It records application-selected capabilities but does not sandbox the runner. The model owns reasoning strategy. Applications own context assembly, tools, budgets, verification methods, and publication. Elenx contains no task corpus, benchmark suite, evaluation runner, or mathematical search policy.

## Install

The v1 kernel requires Bun 1.3.13 or newer. Applications define tool schemas with Zod:

```sh
bun add github:chaoxu/elenx zod@4.4.3
```

Elenx exposes Pi types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

The API and campaign schema are experimental. Campaigns are accepted only when their schema matches the running package. Preserve an old campaign with its matching tagged package and write reruns to new artifacts.

## Documentation

| Question | Authority |
| --- | --- |
| What does the kernel guarantee? | [`SPEC.md`](SPEC.md) |
| Which words name which concepts? | [`docs/terms.md`](docs/terms.md) |
| How do I run the solver? | [`packages/solve/README.md`](packages/solve/README.md) |
| How do the solver roles and replay behave? | [`packages/solve/docs/role-runner.md`](packages/solve/docs/role-runner.md) |
| How do I build an application? | [`docs/application-author.md`](docs/application-author.md) |
| Why was the workflow contract reset, and how are notes verified? | [`docs/workflow-rebuild-20260902.md`](docs/workflow-rebuild-20260902.md) |
| What is the verification design and why? | [`docs/verification-proposal-20260902.md`](docs/verification-proposal-20260902.md) |

The deterministic verifier example is [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts). [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) exercises the LLM-verdict path with a real Pi model.

## Solver

[`packages/solve`](packages/solve) supplies one durable task workflow. A task is one JSON object:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

Run and inspect it from the repository root:

```sh
bun packages/solve/solve.ts run task.json campaign.db settings.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts export campaign.db
```

The same `run` command creates a new campaign or resumes an existing one after matching its task and settings. The explorer writes notes, the coordinator files them, sets the next objective, and lists the notes to verify with the verifiers each needs, and the correctness, source, requirements, and reconstruction verifiers record verdicts on the notes they judge. The workflow ends when all four pass one note. `inspect` derives the phase, notes, and terminal result from the journal.

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

Run one fleet-backed development task with durable local artifacts:

```sh
bun run debug -- TASK.json runs/debug-name SETTINGS.json debug/name--r01/attempt-1
```

Elenx Lab owns the shared local and Nomad attempt executor. Its worker runs the same task command and derives the durable result through `elenx-solve inspect`.
