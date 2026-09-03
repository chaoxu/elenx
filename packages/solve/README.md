# elenx-solve

`elenx-solve` runs one durable workflow from a JSON task:

```text
explorer(task, objective, notes, support)     -> notes with support
coordinator(task, notes)                      -> filings, objective, support, verify
verifier(task, verify, notes, support)        -> verdicts
```

The explorer writes notes, each one self-contained text that names as support the notes whose results it uses without proving them; it says in the text when a note meets the completion criteria. The coordinator files every new note with a summary, sets the next objective with the support notes the explorer must read in full, and lists the notes to verify in priority order, each with the verifiers to run: a prefix of correctness, source, requirements, reconstruction. A note that later work will build on gets the first two and ends verified; a note whose text says it meets the completion criteria gets all four. One verification takes the longest prefix of that list whose note and support texts fit the `window` setting, always its first entry, and runs the verifiers in order on the notes that asked for them; a note stops at its first verdict that is not `PASS`, and a note whose support failed in the same verification is skipped. What the prefix leaves is still unverified, and the coordinator lists it again next turn if it still matters.

The correctness verifier checks every inference and searches for counterexamples and missing cases. The source verifier is a Codex call with web search that confirms every external result a text invokes against its source. The requirements verifier alone decides whether a note meets the completion criteria. The reconstruction verifier states what the note establishes, has a fresh call write a proof of that statement from the support notes without seeing the note's text, and compares the two; it may return `INCONCLUSIVE`, which blocks acceptance without marking the note defective. Support notes are handed to every verifier in full as established results not under review, so a verdict always names a note under verification.

A note is verified when one verification passed correctness and source and it is not dead; the coordinator lists a note only after every note in its support is verified or listed earlier with the source verifier, so an accepted note's closure is verified. A note is dead when correctness, source, or reconstruction failed it or a note in its support is dead: every role still sees it with its verdicts, the explorer cannot name it as support, and the coordinator cannot list it again. The workflow ends when all four verifiers pass one note on one verification.

Every role call is one model call recorded in the Elenx journal with its request, transcript, and submission, and for Pi calls its telemetry. A verifier call judges one or several notes and records one kernel verdict whose evidence lists the verdict of each note. Notes, verdicts, verified, dead, accepted, and the workflow phase are derived from those records. Repeating `run` rebuilds the phase and executes the first missing role call. Candidates, verdicts, telemetry, and spend remain append-only evidence.

## Task and settings

The task file has one schema. The completion criteria are the only statement of what an accepted note must do, so a task that would accept a disproof says so there:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

Settings select one model profile for the explorer, one for the coordinator, one per verifier, the cap on explorer turns, and the window:

```json
{
  "maxExplorerTurns": 10,
  "window": 100000,
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
  "correctness": {
    "provider": "codex-lb",
    "model": "gpt-5.6-luna",
    "reasoning": "high"
  },
  "source": {
    "provider": "codex",
    "model": "gpt-5.6-sol",
    "reasoning": "high"
  },
  "requirements": {
    "provider": "codex-lb",
    "model": "gpt-5.6-luna",
    "reasoning": "high"
  },
  "reconstruction": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  }
}
```

The correctness, requirements, and reconstruction verifiers run through Pi on their own profiles, so a defective note costs one cheap call and only sound notes reach the expensive ones. The source verifier runs the Codex CLI on its native credential, the only path that provides web search, so its provider is `codex`. `ELENX_CODEX_COMMAND` names the binary, default `codex`. `window` is a character count over the note and support texts one verification reads, default 100000. A verification of one note makes one to six calls: the reconstruction verifier is three. Spend covers the Pi calls; the source verifier's usage is on its submission.

## Run

```sh
bun install --frozen-lockfile
bun packages/solve/solve.ts contract
bun packages/solve/solve.ts run task.json campaign.db settings.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts inspect --include-requests campaign.db
bun packages/solve/solve.ts export campaign.db
```

`run` creates a campaign or resumes the existing campaign after matching the exact task and settings against its declaration. A second process cannot drive the same database. `contract` reports execution-contract schema 8 with application `elenx-solve`, protocol `workflow`, and arguments `task`, `campaign`, and `settings`.

`inspect` is the read authority. It derives the task, current phase, notes with their verdicts and flags, role calls with their submissions, and spend from the append-only journal. Terminal campaigns also contain `result` with outcome `accepted` or `turn-limit`. `paused`, `call-failure`, and `interrupted` are run outcomes that leave the campaign resumable. `export` emits the accepted note preceded by its closure, in id order.

Each role can also run alone:

```sh
bun packages/solve/solve.ts explorer input.json roles.db settings.json
bun packages/solve/solve.ts coordinator input.json roles.db settings.json
bun packages/solve/solve.ts verifier input.json roles.db settings.json
```

Standalone role commands are boundary diagnostics. They use the same role schemas and journal machinery and are not a second workflow.

## Development

```sh
bun run --cwd packages/solve check
bun run e2e:roles
```

[`docs/role-runner.md`](docs/role-runner.md) defines the role schemas, replay behavior, and inspection boundary. [`../../docs/workflow-rebuild-20260902.md`](../../docs/workflow-rebuild-20260902.md) records the contract reset, note verification, and their verification plan.
