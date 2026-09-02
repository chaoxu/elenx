# elenx-solve

`elenx-solve` runs one durable mathematical workflow from a JSON task:

```text
explorer(task, objective, notes, support)  -> notes
coordinator(task, notes)                   -> filings, objective, support, verify?
verifier(task, note, support)              -> verdicts
```

The explorer writes notes. The coordinator files every new note with a summary, sets the next objective with the support notes the explorer must read in full, and may verify one note with the support notes its text relies on. Verification runs the correctness, adversarial, and requirements verifiers on the note in that order and stops at the first `FAIL`. Each verifier returns one verdict, `PASS` or `FAIL`, with a report and the id of the note it is about. A verdict is recorded on the note it names. The explorer and coordinator see every note's summary and verdicts; the verifier sees the note and its support. The workflow ends when all three verifiers pass one note.

Every role call is one model call recorded in the Elenx journal with its prompt, transcript, tool submission, and telemetry. Notes, verdicts, and the workflow phase are derived from those records. Repeating `run` rebuilds the phase and executes the first missing role call. Candidates, verdicts, telemetry, and spend remain append-only evidence.

## Task and settings

The task file has one schema:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

Settings select one model profile per role and cap explorer turns:

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

The verifier profile backs all three verifiers. A verification makes one to three verifier requests.

## Run

```sh
bun install --frozen-lockfile
bun packages/solve/solve.ts contract
bun packages/solve/solve.ts run task.json campaign.db settings.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts inspect --include-inputs campaign.db
bun packages/solve/solve.ts export campaign.db
```

`run` creates a campaign or resumes the existing campaign after matching the exact task and settings against its declaration. A second process cannot drive the same database. `contract` reports execution-contract schema 3 with application `elenx-solve`, protocol `workflow`, and arguments `task`, `campaign`, and `settings`.

`inspect` is the read authority. It derives the task, current phase, notes with their verdicts, public role calls, and spend from the append-only journal. Terminal campaigns also contain `result` with outcome `accepted` or `turn-limit`. `paused`, `call-failure`, and `interrupted` are run outcomes that leave the campaign resumable. `export` emits the accepted note followed by its support notes.

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

[`docs/role-runner.md`](docs/role-runner.md) defines the role schemas, replay behavior, and inspection boundary. [`../../docs/workflow-rebuild-20260902.md`](../../docs/workflow-rebuild-20260902.md) records the contract reset, note verification, and their verification plan.
