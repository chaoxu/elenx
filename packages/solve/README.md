# elenx-solve

`elenx-solve` runs one durable mathematical workflow from a JSON task:

```text
explorer(input)    -> findings
coordinator(input) -> filings + explore | verify
verifier(input)    -> ACCEPT | REJECT + report
```

The coordinator files every explorer finding as an immutable note, selects the next working set, and nominates an answer with only the support notes it uses. The verifier runs requirements, correctness, and adversarial auditors through the same private `VerifierInput -> AuditResult` interface. All auditors must pass for `ACCEPT`. The first failure returns `REJECT` and stops later audits.

Every public role call records its exact input and output in the Elenx journal. Notes and workflow state are derived from those records. Repeating `run` rebuilds the state and executes the first missing role call. Candidates, auditor calls, aggregate verdicts, telemetry, and spend remain append-only evidence.

## Task and settings

The task file has one schema:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

Settings select one model profile per public role and cap explorer turns:

```json
{
  "maxExplorerTurns": 10,
  "explorer": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  },
  "coordinator": {
    "provider": "codex-lb",
    "model": "gpt-5.6-luna",
    "reasoning": "low"
  },
  "verifier": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  }
}
```

The verifier profile backs every built-in auditor. Accepted proposals use three auditor requests. Rejected proposals use one to three because verification stops at the first failure.

## Run

```sh
bun install --frozen-lockfile
bun packages/solve/solve.ts contract
bun packages/solve/solve.ts run task.json campaign.db settings.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts inspect --include-inputs campaign.db
bun packages/solve/solve.ts export campaign.db
```

`run` creates a campaign or resumes the existing campaign after matching the exact task and settings against its declaration. A second process cannot drive the same database. `contract` reports execution-contract schema 1 with application `elenx-solve`, protocol `workflow`, and arguments `task`, `campaign`, and `settings`.

`inspect` is the read authority. It derives the task, current state, notes, public role calls, and spend from the append-only journal. Terminal campaigns also contain `result` with outcome `accepted`, `refuted`, or `turn-limit`. `paused`, `call-failure`, and `interrupted` are run outcomes that leave the campaign resumable. `export` emits the accepted solution or verified refutation bytes from a terminal candidate.

Each role can also run alone:

```sh
bun packages/solve/solve.ts explorer input.json roles.db settings.json
bun packages/solve/solve.ts coordinator input.json roles.db settings.json
bun packages/solve/solve.ts verifier input.json roles.db settings.json
```

Standalone role commands are boundary diagnostics. They use the same role schemas and journal machinery without creating another workflow contract.

## Development

```sh
bun run --cwd packages/solve check
bun run e2e:roles
```

[`docs/role-runner.md`](docs/role-runner.md) defines the role schemas, replay behavior, and inspection boundary. [`../../docs/workflow-rebuild-20260902.md`](../../docs/workflow-rebuild-20260902.md) records the contract reset and its verification plan.
