# Elenx workflow rebuild

The 2026-09-02 rebuild gives Elenx Solve and Elenx Lab one task contract and one journal-derived result path.

## Removed contracts

The rebuild removed the `exploration-v15` and direct-update V17 solver implementations, split problem and criteria arguments, separate solver `trial` and `resume` modes, Lab experiment kinds, code-treatment overlays, compatibility unions for frozen manifests, and worker acceptance of solver stdout as a result authority.

The repository also removed the V15 design and hypothesis documents, the V17 lifecycle and release records, the V17 interactive explainer, and research notes tied to those retired mechanisms. The maintained package documentation now describes the live workflow. Campaign databases and run directories remain unchanged as historical evidence.

## Solver contract

A task is UTF-8 JSON with two nonblank strings:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

The command surface is:

```sh
bun packages/solve/solve.ts contract
bun packages/solve/solve.ts run TASK.json CAMPAIGN.db SETTINGS.json
bun packages/solve/solve.ts inspect [--include-inputs] CAMPAIGN.db
bun packages/solve/solve.ts export CAMPAIGN.db
```

`run` creates or resumes the campaign. The declared task and settings must match exactly on every invocation. The execution contract remains schema 1 with application `elenx-solve`, protocol `workflow`, and run arguments `task`, `campaign`, and `settings`.

The explorer, coordinator, and verifier commands remain available for isolated boundary tests. They use the same role schemas and journal machinery, not a second campaign protocol.

`inspect` folds the append-only journal into the current state. Terminal campaigns expose `inspect.result` with outcome `accepted`, `refuted`, or `turn-limit`. The `paused`, `call-failure`, and `interrupted` run outcomes remain resumable. `export` reads candidate material from the journal.

## Lab workflow

Lab accepts one experiment shape: tasks, settings arms, replicates, and one concurrency value. Freezing validates each task, requires clean Elenx checkouts, requires all arms to share one Elenx revision and execution contract, hashes each task and settings file, and writes frozen manifest schema 1.

```text
author experiment
  -> frozen tasks, settings, manifest, and Nomad template
  -> immutable Nomad generation intent
  -> worker claim for task x arm x replicate
  -> elenx-solve run TASK.json CAMPAIGN.db SETTINGS.json
  -> elenx-solve inspect CAMPAIGN.db
  -> validated inspect.result in immutable attempt.json
```

Nomad owns placement, concurrency, restart, and process lifetime. Lab owns freezing, generation reconciliation, leases, attempt identity, and provenance. Elenx owns the campaign journal and mathematical state.

Solver stdout remains a process log. After every worker invocation, Lab runs `inspect` against the campaign and validates `inspect.result` against the frozen execution contract. An absent terminal result leaves the run eligible for a later generation. `started.json` and `attempt.json` are immutable facts. `latest.json` is a repairable projection of those facts.

The local debug command uses the same task contract and inspection step:

```sh
bun run debug -- TASK.json RUN_DIRECTORY SETTINGS.json USAGE_TAG
```

## Verification plan

Run these gates after the implementation and documentation land together:

1. Run `bun run check:all` in Elenx. Confirm formatting, strict TypeScript, kernel tests, solver tests, package checks, consumer compilation, and CLI help.
2. Run `bun run e2e:roles`. Confirm a fresh run, zero-call repeated run, rejection repair, terminal inspection, export, campaign locking, and provider failure without a mathematical verdict.
3. Inspect `elenx-solve contract`. Confirm schema 1, application `elenx-solve`, protocol `workflow`, and the three run arguments.
4. Run `bun run check` in Elenx Lab. Confirm the single author manifest, schema-1 freeze, old-shape rejection, task-based debug, inspection-derived worker results, recovery, immutable attempt validation, Nomad HCL validation, and CLI help.
5. Build a worker image from clean committed Elenx and Lab revisions. Run one small Nomad experiment, wait for the allocation to settle, and inspect the campaign database. Confirm that the mathematical fields in `attempt.json.report` match `inspect.result` and that the report identity matches the frozen contract.

## Live smoke evidence

The first fresh Luna-low primes run reached `accepted` in two explorer turns. The first answer contained the standard Euclidean proof and a valid minimal-divisor argument, but the correctness auditor rejected it only because it did not explicitly say that the alleged finite list of primes was nonempty. An independent proof audit classified that omission as routine bookkeeping rather than a blocking gap.

The verifier prompt was narrowed without changing the workflow: an auditor still fails an unsupported load-bearing inference, but it does not fail solely for an immediate routine fact or harmless standard convention. A second fresh run of the same task reached `accepted` in one explorer turn with five provider requests, 5,078 tokens, no request errors, and estimated cost $0.0022386. The accepted proof constructs the product plus one, proves that it has a prime divisor by minimality, and proves that this divisor is absent from the alleged complete list.

The smoke artifacts are untracked run evidence under `runs/workflow-reset-primes-smoke-20260902-1` and `runs/workflow-reset-primes-smoke-20260902-2`. Each directory preserves the task, settings, campaign database, process logs, `inspect.json`, and journal-derived `result.json`.

[`../packages/solve/README.md`](../packages/solve/README.md) is the solver command guide. [`../../elenx-lab/README.md`](../../elenx-lab/README.md) is the Lab operator guide.
