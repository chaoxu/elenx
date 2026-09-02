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

`run` creates or resumes the campaign. The declared task and settings must match exactly on every invocation. The execution contract is schema 3 with application `elenx-solve`, protocol `workflow`, and run arguments `task`, `campaign`, and `settings`.

The explorer, coordinator, and verifier commands remain available for isolated boundary tests. They use the same role schemas and journal machinery, not a second campaign protocol.

`inspect` folds the append-only journal into the current phase. Terminal campaigns expose `inspect.result` with outcome `accepted` or `turn-limit`. The `paused`, `call-failure`, and `interrupted` run outcomes remain resumable. `export` reads candidate material from the journal.

## Note verification

The same day's second change made every note verifiable and removed the vocabulary that had grown around the final answer. The explorer writes notes, the coordinator files each with a summary and sets the next objective, and it may verify any note with the support notes the text relies on. Every verification ran the requirements, correctness, and adversarial verifiers with no short circuit; the next change reordered them and restored the short circuit. Each verifier returns one verdict that names the note it judges, and the kernel records that verdict against the verifier's own call. Notes carry the verdicts recorded on them, every role sees notes in that one shape, and the workflow ends when all three verifiers pass one note.

Removed with this change: candidate kinds and the `refuted` outcome, the summary length cap, `ACCEPT` and `REJECT` as a second verdict vocabulary, the auditor name for a verifier, the finding name for a note without a summary, the index and context names for lists of notes, the previous verifier response and the synthesized repair objective, the repeated-proposal suppression, and the state name for the phase. The execution contract and report moved to schema 2 because the report shape changed.

## One call per role operation

Issue 41 observed that one role operation produced two journal calls, a typed wrapper and the Pi model call beneath it, so Inspect and Observe disagreed about how many operations ran. The fix removed the wrapper. Every role call is now one Pi call: its prompt is derived from the role input, its structured result is the terminal tool submission, and its transcript, telemetry, and spend are on the same call. The workflow fold matches journal calls by derived prompt bytes and refuses a journal written by other prompts. Verifier calls bind to the kernel candidate, which is the only hierarchy a reader needs, and a verification interrupted after some verdicts resumes on the same candidate. The same change restored the short circuit, with the verifiers ordered correctness, adversarial, requirements so a defective note costs one call and an intermediate note is still checked before the requirements verifier fails it. The explorer receives every note's summary and verdicts and reads in full only the support notes the coordinator selects. The workflow declaration and contract moved to schema 3 because the journal shape changed.

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
2. Run `bun run e2e:roles`. Confirm a fresh run, zero-call repeated run, a failed verification followed by a new note, terminal inspection, export, campaign locking, and provider failure without a verdict.
3. Inspect `elenx-solve contract`. Confirm schema 3, application `elenx-solve`, protocol `workflow`, and the three run arguments.
4. Run `bun run check` in Elenx Lab. Confirm the single author manifest, schema-3 contract freeze, old-shape rejection, task-based debug, inspection-derived worker results, recovery, immutable attempt validation, Nomad HCL validation, and CLI help.
5. Build a worker image from clean committed Elenx and Lab revisions. Run one small Nomad experiment, wait for the allocation to settle, and inspect the campaign database. Confirm that the mathematical fields in `attempt.json.report` match `inspect.result` and that the report identity matches the frozen contract.

## Live smoke evidence

The first fresh Luna-low primes run reached `accepted` in two explorer turns. The first answer contained the standard Euclidean proof and a valid minimal-divisor argument, but the correctness auditor rejected it only because it did not explicitly say that the alleged finite list of primes was nonempty. An independent proof audit classified that omission as routine bookkeeping rather than a blocking gap.

The verifier prompt was narrowed without changing the workflow: a verifier still fails an unsupported load-bearing inference, but it does not fail solely for an immediate routine fact or harmless standard convention. A second fresh run of the same task reached `accepted` in one explorer turn with five provider requests, 5,078 tokens, no request errors, and estimated cost $0.0022386. The accepted proof constructs the product plus one, proves that it has a prime divisor by minimality, and proves that this divisor is absent from the alleged complete list.

The smoke artifacts are untracked run evidence under `runs/workflow-reset-primes-smoke-20260902-1` and `runs/workflow-reset-primes-smoke-20260902-2`. Each directory preserves the task, settings, campaign database, process logs, `inspect.json`, and journal-derived `result.json`.

The note-verification change was smoked twice on the same task with the same Luna-low settings, before and after the review repairs to the prompts. The first run reached `accepted` in one explorer turn with five provider requests, 4,109 tokens, and estimated cost $0.0019718. The second run, on the final prompts, reached `accepted` in two explorer turns with ten provider requests, 8,903 tokens, no request errors, and estimated cost $0.0039176: the adversarial verifier failed `n1`, the explorer read that verdict and wrote `n2`, and all three verifiers passed `n2`. In both runs a repeated `run` made no provider request and `export` returned the accepted note. The artifacts are under `runs/note-verification-primes-smoke-20260902-1` and `runs/note-verification-primes-smoke-20260902-2`. A campaign declared before the change no longer parses as a workflow, because the declaration now carries the schema version.

The one-call-per-operation change was smoked the same way, before and after the review repairs to the prompts. Both runs reached `accepted` in one explorer turn with five provider requests, one per role call, no request errors, and estimated cost under a quarter of a cent; the final run used 4,121 tokens. Inspect lists five calls with their results: explorer, coordinator, and the three verifier calls bound to one candidate. A repeated `run` made no provider request, and a `run` against a schema-2 campaign was refused. The artifacts are under `runs/one-call-primes-smoke-20260902-1` and `runs/one-call-primes-smoke-20260902-2`.

[`../packages/solve/README.md`](../packages/solve/README.md) is the solver command guide. [`../../elenx-lab/README.md`](../../elenx-lab/README.md) is the Lab operator guide.
