# elenx-solve

`elenx-solve` runs one durable workflow from a JSON task:

```text
explorer(task, objective, notes, support)     -> notes with support
coordinator(task, notes)                      -> filings, objective, support, verify
verifier(task, verify, notes, support)        -> verdicts
```

The explorer writes notes, each one self-contained text that names as support the notes whose results it uses without proving them; it says in the text when a note meets the completion criteria. The coordinator files every new note with a summary, its statement plus what the text says about its own status, sets the next objective with the support notes the explorer must read in full, and lists the notes to verify in priority order, each with the verifiers to run: a prefix of source, correctness, requirements, reconstruction. A note that later work will build on gets the first two and ends verified; a note whose text says it meets the completion criteria gets all four. One verification takes the longest prefix of that list whose note and support texts fit the `window` setting, always its first entry, and runs the verifiers in order on the notes that asked for them; a note stops at its first verdict that is not `PASS`, and a note whose support failed in the same verification is skipped. What the prefix leaves is still unverified, and the coordinator lists it again next turn if it still matters.

The source verifier is one call, Codex with web search or Pi without it as its profile says, that confirms every external result a text invokes against its source, or without search confirms that the text invokes none. An unavailable source leaves a note unresolved, while a concrete mismatch fails it. The correctness verifier checks every inference and searches for counterexamples and missing cases. The requirements verifier alone decides whether a note meets the completion criteria. The reconstruction verifier states what the note establishes, has a fresh call write a proof of that statement from the support notes without seeing the note's text, and compares the two. Every verifier may return `INCONCLUSIVE`, which pauses verification without marking the note defective. Support notes are handed to every verifier in full as established results not under review, so a verdict always names a note under verification.

A note is verified when one verification passed source and correctness over verified support and it is not dead; the coordinator lists a note only after every note in its support is verified or listed earlier with the correctness verifier, so an accepted note's closure is verified. The coordinator never has the explorer check, polish, or restate a verified note. A note is dead when correctness, source, or reconstruction failed it or a note in its support is dead: every role still sees it with its verdicts, the explorer cannot name it as support, and the coordinator cannot list it again. The workflow ends when all four verifiers pass one note on one verification.

Every role call is one model call recorded in the Elenx journal with its request, transcript, and submission, and for Pi calls its telemetry. A verifier call that returns note verdicts records one kernel verdict whose evidence lists those verdicts. Reconstruction statement and proof calls, and judgments that only correct a statement, record their submissions without a mathematical verdict. Notes, verdicts, verified, dead, accepted, and the workflow phase are derived from those records. Repeating `run` rebuilds the phase and executes the first missing role call. Candidates, verdicts, telemetry, and spend remain append-only evidence.

Correctness judges the claims a note makes. A sound partial result passes correctness even when the task remains unfinished. Requirements alone judges task completion. Every verifier receives the complete support closure of the notes it judges, including the earlier notes that supporting proofs rely on. Shared texts appear once and count once against the verification window. Established supporting results are available to resolve inherited definitions and cases, without being reverified. Explorer inputs list note metadata once and append only the selected supporting texts. The coordinator's objective describes the mathematical gap, while current verification state comes from the note fields.

## Task and settings

The task file has one schema. The completion criteria are the only statement of what an accepted note must do, so a task that would accept a counterexample says so there:

```json
{
  "problem": "Prove that the sum of two even integers is even.",
  "completionCriteria": "Give a standalone proof for arbitrary even integers."
}
```

Settings select one model profile for the explorer, one for the coordinator, one per verifier, the cap on explorer turns, the window, and the explorer's guidance:

```json
{
  "maxExplorerTurns": 10,
  "window": 100000,
  "explorerGuidance": ["State the result of each note in its first sentence."],
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
    "reasoning": "high",
    "search": true
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

The correctness, requirements, and reconstruction verifiers run through Pi on their own profiles, so a note that leans on an outside result costs one source call, a defective one adds one correctness call, and only sound notes reach the expensive calls. The source verifier runs the Codex CLI on its native credential, the only path that provides web search, when its provider is `codex`. Its `search` is true by default. Setting it to `false` keeps the call offline and assesses invoked results and their hypotheses from mathematical knowledge and supplied texts. Failed or inconclusive online lookup uses the same assessment. Known results can pass, concrete false statements or incorrect applications fail, and a specific uncertainty leaves the check `INCONCLUSIVE`. Only results confirmed in sources actually opened receive source entries. `ELENX_CODEX_COMMAND` names the binary, default `codex`. A source profile with any other provider runs the source verifier as one Pi call without web search, so a worker needs no Codex credential; that is the profile for a task that must not reach the internet. `window` is a character count over the note and support texts one verification reads, default 100000. `explorerGuidance` is complete sentences added to the explorer's fixed instructions on every turn: how to explore, never what the task is; empty by default. A verification of one note normally makes one to six calls: the reconstruction verifier is three. Correcting a reconstruction statement adds a proof call and judgment, and preserves all successful checks. Spend covers the Pi calls; the source verifier's usage is on its submission.

## Run

```sh
bun install --frozen-lockfile
bun packages/solve/solve.ts contract
bun packages/solve/solve.ts run task.json campaign.db settings.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts inspect --include-requests campaign.db
bun packages/solve/solve.ts export campaign.db
```

`run` creates a campaign or resumes the existing campaign after matching the exact task and settings against its declaration. Before a fresh campaign or unfinished resume makes a model call, it resolves every configured Pi role and its requested reasoning level, checks available provider credentials, and checks the native source CLI and its file-based login when that profile is selected. These checks make no paid model request and do not establish backend reachability or account entitlement. A completed campaign returns before provider initialization, so it needs no model registry or credentials. A second process cannot drive the same database. `contract` reports execution-contract schema 8 with application `elenx-solve`, protocol `workflow`, and arguments `task`, `campaign`, and `settings`.

`inspect` is the read authority. It derives the task, current phase, notes with their verdicts and flags, role calls with their submissions, and spend from the append-only journal. Its `accounting` field reports `measuredCostUsd` and `complete`, with `unmeasuredRequests`, `unaccountedCalls`, their saved `potentialRequests`, and `unpricedCalls`. A saved request checkpoint establishes that a request was prepared, not that inference completed. Missing usage or prices remain unknown, and the measured subtotal is null when no cost was measured. Native Codex source calls have token usage but no journaled price and therefore keep cost accounting incomplete. Terminal campaigns contain `result` with outcome `accepted` or `turn-limit`. A settled unresolved verification also has a journal-derived `result` with outcome `paused`, `at: "verifier"`, and a reason naming each inconclusive check. A newer in-progress or failed retry is not reported as the old pause. `paused`, `call-failure`, and `interrupted` are run outcomes that leave the campaign resumable. An `INCONCLUSIVE` verdict pauses the same verification, with the reason in `inspect`. Repeating `run` retries the unresolved checks and preserves the candidate, notes, and successful checks. Unavailable citations remain inconclusive. A malformed reconstruction statement is corrected within verification instead of sending the proof back to the explorer. `export` emits the accepted note preceded by its closure, in id order.

Each role can also run alone:

```sh
bun packages/solve/solve.ts explorer input.json roles.db settings.json
bun packages/solve/solve.ts coordinator input.json roles.db settings.json
bun packages/solve/solve.ts verifier input.json roles.db settings.json
```

Standalone role commands are boundary diagnostics. They use the same role schemas and journal machinery and are not a second workflow. An explorer input states its `guidance`: the fold fills it from the settings' `explorerGuidance`, and the standalone explorer reads it from the input alone.

## External final review

After `accepted`, give an external reviewer the frozen task and the complete argument from `export`, including every supporting proof. Omit Elenx's verdicts and verification flags from that review packet. The reviewer checks the supplied argument, hypotheses, citations, and completion criteria, including supporting lemmas, rather than rediscovering the solution. Record the external verdict and its evidence in the evaluation's artifacts, separately from Elenx's internal acceptance. External review adds no verifier or support-challenge mechanism to the campaign.

For an abandonment-guidance experiment, keep the shared role prompts, models, task inputs, evidence access, budgets, and external review procedure fixed. Change only `explorerGuidance`. The coordinator has no shared instruction to abandon unfinished approaches.

## Development

```sh
bun run --cwd packages/solve check
bun run e2e:roles
```

[`docs/role-runner.md`](docs/role-runner.md) defines the role schemas, replay behavior, and inspection boundary. [`../../docs/workflow-rebuild-20260902.md`](../../docs/workflow-rebuild-20260902.md) records the contract reset, note verification, and their verification plan.
