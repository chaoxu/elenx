# Elenx

Elenx runs mathematical exploration with durable notes, verification, and guidance from people or other agents. The included solver saves its work in a SQLite campaign. You can inspect its progress, submit advice for upcoming Explorer turns, and resume an interrupted run from its recorded work.

The underlying kernel is also a library for agent applications. It stores exact candidate bytes, records calls, tool invocations, settled tool results, and unknown tool outcomes through an append-only campaign API, binds verdicts to fresh candidate-scoped calls, and derives verification status from the recorded evidence.

The bundled Pi runner executes application-selected models and Zod tools. Pi owns provider execution and credentials. Elenx records logical calls, pre-send request checkpoints, and settled telemetry. Durable continuation extends an output-limited response with its validated transcript, frozen model profile, and tool contract.

The kernel enforces identity, durability, crash semantics, and accounting contracts. It records application-selected capabilities but does not sandbox the runner. The model owns reasoning strategy. Applications own context assembly, tools, budgets, verification methods, and publication. Verification status records which declared checks passed. Mathematical acceptance still needs [external review](packages/solve/README.md#external-final-review).

## Try the solver

From a checkout, install dependencies with Bun 1.3.13 or newer. Configure `OPENAI_API_KEY` in your environment or the corresponding credential through Pi, then run the included task:

```sh
bun install --frozen-lockfile
bun packages/solve/solve.ts run packages/solve/examples/task-even-sum.json campaign.db packages/solve/examples/settings-openai.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts export campaign.db
```

The example uses OpenAI directly and requires no Fleet services. Model calls use your provider account. Settings select the model for each role and cap Explorer turns. Repeat the same `run` command after an interruption to continue. A completed campaign returns its recorded result.

While a campaign is running or paused, another process can submit guidance:

```sh
bun packages/solve/solve.ts guide --id try-direct-proof campaign.db packages/solve/examples/guidance.txt
bun packages/solve/solve.ts inspect --include-guidance campaign.db
```

Guidance is saved immediately and delivered to the next Explorer turn whose input has not been frozen. It applies to that turn only, including its retries. The task, completion criteria, and verification rules stay fixed. See [using Elenx from another agent](packages/solve/docs/agent-usage.md) for submission receipts, delivery, and recovery.

## Install

For the packaged solver, follow [installation and provider setup](packages/solve/docs/installation.md). Release `v0.9.4` includes kernel 0.9.4 and solver 0.35.0, with OpenAI API and Codex subscription examples.

The v1 kernel requires Bun 1.3.13 or newer. Applications define tool schemas with Zod:

```sh
bun add --minimum-release-age 86400 github:chaoxu/elenx#v0.9.4 zod@4.5.4
```

Elenx exposes Pi types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

The API and campaign schema are experimental. Campaigns are accepted only when their schema matches the running package. Preserve an old campaign with its matching tagged package and write reruns to new artifacts.

## Documentation

| Question | Authority |
| --- | --- |
| What does the kernel guarantee? | [`SPEC.md`](SPEC.md) |
| Which words name which concepts? | [`docs/terms.md`](docs/terms.md) |
| How do I run the solver? | [`packages/solve/README.md`](packages/solve/README.md) |
| How can another agent inspect and guide a run? | [`packages/solve/docs/agent-usage.md`](packages/solve/docs/agent-usage.md) |
| How do the solver roles and replay behave? | [`packages/solve/docs/role-runner.md`](packages/solve/docs/role-runner.md) |
| How do I build an application? | [`docs/application-author.md`](docs/application-author.md) |
| How do I install packages and configure a provider? | [`packages/solve/docs/installation.md`](packages/solve/docs/installation.md) |
| What changed in this release? | [`docs/releases/v0.9.4.md`](docs/releases/v0.9.4.md) |

The deterministic verifier example is [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts). [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) exercises the LLM-verdict path with a real Pi model.

## Solver

[`packages/solve`](packages/solve) supplies one durable task workflow. A task is one JSON object:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

The explorer writes notes. The coordinator files them, gives `explorerGuidance` for the next turn, selects supporting texts, and lists the notes to verify. The source, correctness, requirements, and reconstruction verifiers record verdicts on those notes. The workflow ends when all four pass one note. `inspect` derives the phase, notes, and terminal result from the journal. The [solver guide](packages/solve/README.md#run) documents the commands and their results.

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

Documentation covers installation, usage, integration, and current contracts. Keep measurements, run logs, internal reviews, and research drafts in ignored local artifacts under `runs/`.

## License

Elenx and the solver are available under the [MIT license](LICENSE).
