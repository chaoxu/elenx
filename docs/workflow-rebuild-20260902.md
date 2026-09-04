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
bun packages/solve/solve.ts inspect [--include-requests] CAMPAIGN.db
bun packages/solve/solve.ts export CAMPAIGN.db
```

`run` creates or resumes the campaign. The declared task and settings must match exactly on every invocation. The execution contract is schema 8 with application `elenx-solve`, protocol `workflow`, and run arguments `task`, `campaign`, and `settings`.

The explorer, coordinator, and verifier commands remain available for isolated boundary tests. They use the same role schemas and journal machinery and are not a second workflow.

`inspect` folds the append-only journal into the current phase. Terminal campaigns expose `inspect.result` with outcome `accepted` or `turn-limit`. The `paused`, `call-failure`, and `interrupted` run outcomes remain resumable. `export` emits the accepted note preceded by its closure.

## Note verification

The same day's second change made every note verifiable and removed the vocabulary that had grown around the final answer. The explorer writes notes, the coordinator files each with a summary and sets the next objective, and it may verify any note with the support notes the text relies on. Every verification ran the requirements, correctness, and adversarial verifiers with no short circuit; the next change reordered them and restored the short circuit. Each verifier returns one verdict that names the note it judges, and the kernel records that verdict against the verifier's own call. Notes carry the verdicts recorded on them, every role sees notes in that one shape, and the workflow ends when all three verifiers pass one note.

Removed with this change: candidate kinds and the `refuted` outcome, the summary length cap, `ACCEPT` and `REJECT` as a second verdict vocabulary, the auditor name for a verifier, the finding name for a note without a summary, the index and context names for lists of notes, the previous verifier response and the synthesized repair objective, the repeated-proposal suppression, and the state name for the phase. The execution contract and report moved to schema 2 because the report shape changed.

## One call per role operation

Issue 41 observed that one role operation produced two journal calls, a typed wrapper and the Pi model call beneath it, so Inspect and Observe disagreed about how many operations ran. The fix removed the wrapper. Every role call is now one Pi call: its prompt is derived from the role input, its structured result is the terminal tool submission, and its transcript, telemetry, and spend are on the same call. The workflow fold matches journal calls by derived prompt bytes and refuses a journal written by other prompts. Verifier calls bind to the kernel candidate, which is the only hierarchy a reader needs, and a verification interrupted after some verdicts resumes on the same candidate. The same change restored the short circuit, with the verifiers ordered correctness, adversarial, requirements so a defective note costs one call and an intermediate note is still checked before the requirements verifier fails it. The explorer receives every note's summary and verdicts and reads in full only the support notes the coordinator selects. The workflow declaration and contract moved to schema 3 because the journal shape changed. Because the fold matches journal calls by prompt bytes, the declaration's schema version moves with every role prompt or journal shape change, while the contract's version moves only when the contract or report shape changes. Sharing one cached prefix across the three verifier calls changed the verifier prompts, so the declaration moved to schema 4 and the contract stayed at 3. A wire-level probe with a 2,200-token note confirmed identical instructions, tool, prompt cache key, and leading text across the three calls, but the codex-lb route reported no cached tokens, so the saving is unproven on that route. The vocabulary sweep that produced [`terms.md`](terms.md) reworded the requirements obligation to check a note against the completion criteria alone, which took the declaration to schema 5.

## Declared support

The explorer now names, on each note it writes, the notes whose results the text uses without proving them. Its notes are numbered after the notes it received, so a note may name an earlier note of the same turn, and a cycle cannot arise. The coordinator verifies a note against the support it declares, and the verifiers receive that support in full. The fold builds the projection, an in-memory Cozo database rebuilt on every derivation, and asks it which notes exist at any journal sequence and for a note's closure, which `export` now emits ahead of the accepted note in id order. The note gained a field, so the contract moved to schema 4; the prompts changed, so the declaration moved to schema 6.

## Source verifier

External results came back as a fourth verifier. The `source` verifier ran, at that change, between the adversarial and requirements verifiers as one Codex CLI call with web search, on Codex's native credential because that is the only path that provides search. It lists every external result the text invokes, opens each source, and confirms the result with the hypotheses the text uses; its verdict carries the confirmed `sources`, and a PASS that lists sources without a search is refused as an operational error. Settings gained a `source` profile whose provider is `codex`. The verdict's verifier names gained a value, so the contract moved to schema 5; the prompts changed, so the declaration moved to schema 7.

## Reconstruction verifier

Reconstruction came back as a verifier composed of three calls, with no field added to notes. The statement call reads the note and its support and returns what each establishes, with nothing of how. The proof call receives that statement and the support statements, never the note's text, and writes a proof; The verdict call compares the note's text with the proof and records `PASS`, `FAIL`, or `INCONCLUSIVE`, the kernel's third verdict, which the solver now uses: the independent text left something unproved and no defect was found, so acceptance is blocked without marking the note defective, and the coordinator may verify the note again after the explorer splits it. The verifier order is correctness, adversarial, source, reconstruction, requirements, so a note the earlier verifiers fail never pays for the three calls. The verdict gained a value and a verifier name, so the contract moved to schema 6; the prompts changed, so the declaration moved to schema 8.

## Verified support

Independent review of the three changes found that acceptance covered a note relative to its direct support only, so a false result two levels down could reach `accepted` unread by any verifier. A note is now `verified` when one verification passed every verifier but requirements, and the coordinator may verify a note only after every note in its support is verified, which the coordinator result's schema enforces. By induction an accepted note's closure is verified. The note gained the field, so the contract moved to schema 7; the prompts changed, so the declaration moved to schema 9. The same review removed the mechanical leak guard before the proof call, whose job the verdict obligation already does, and made a malformed Codex submission non-reusable on resume instead of a permanent failure.

The live smokes for these three changes all ran the primes task on Luna-low Pi profiles with the Codex CLI on gpt-5.6-sol at low reasoning: declared support accepted in one turn with five Pi requests; the source verifier accepted in one turn after a first attempt whose Codex call was rejected for a schema format and resumed on the same candidate; reconstruction accepted in one turn with eight Pi requests and one Codex call at about a third of a cent, after one run in which the reconstruction verifier failed the first note for an omitted routine fact and the second note passed. The artifacts are under `runs/support-primes-smoke-20260902-*`, `runs/source-primes-smoke-20260902-*`, and `runs/reconstruction-primes-smoke-20260902-*`.

## Verification proposal

The design recorded in [`verification-proposal-20260902.md`](verification-proposal-20260902.md) landed the same evening as one change. The adversarial verifier folded into the correctness obligation, which now includes the search for counterexamples and missing cases. Reconstruction became self-contained: the statement call reads the full note and returns what it establishes, the proof call receives that statement and the support notes in full and never the note's text, and the verdict call compares; the statement stays a journal submission and no note field was added. The coordinator's `verify` became an ordered list of notes, each with the verifiers to run as a prefix of correctness, source, requirements, reconstruction, and its schema admits a note only when it is not dead and every note in its support is verified or listed earlier with the source verifier. Settings name a profile per verifier and gained `window`; one verification takes the longest prefix of the list whose note and support texts fit it, always the first entry, submits one candidate for those notes and their support, and runs the verifiers in order on the notes that asked for them: correctness, source, and requirements judge their notes in one call each, reconstruction runs three calls per note, a note stops at its first verdict that is not `PASS`, and a note whose support failed in the same verification is skipped. Support is handed to every verifier as established and not under review, so a verdict names only a note under verification.

The kernel records one verdict per call, which its specification states as a uniqueness constraint, so a call that judged several notes records one kernel verdict on the candidate, `PASS` only when every note passed, whose evidence lists the verdict of each note; the projection reads that evidence, and the kernel's candidate status decides nothing. Verified, dead, and accepted are Datalog rules over the verdict rows and the support edges: a note is dead when correctness, source, or reconstruction failed it or a note in its support is dead, verified when one candidate passed correctness and source and it is not dead, and accepted when one candidate passed all four verifiers. Acceptance is the projection's query, and the fold ends the workflow on the first accepted note of the verification.

Chao amended the proposal's treatment of dead notes before it landed: a wrong direction is worth knowing, so the explorer sees every dead note with its summary and the verdicts that killed it, cannot name one as support, and may read its text in full when the coordinator hands it over so that a new note removes the defect; the coordinator cannot list a dead note for verification again. The note gained `dead`, the verdict lost the adversarial verifier, and the settings changed shape, so the contract moved to schema 8; the prompts and the journal shape changed, so the declaration moved to schema 10.

The live smoke ran the primes task on Luna-low profiles for every Pi call and the Codex CLI on gpt-5.6-sol at low reasoning. The explorer wrote one note whose text says it meets the completion criteria, the coordinator listed it with all four verifiers, and the verification accepted it in one turn: seven Pi requests, one Codex call, 6,829 tokens, no request errors, and estimated cost $0.0029228. The artifacts are under `runs/verification-primes-smoke-20260902-1`. A verification of several notes in one call has run only against the fake provider in the tests.

The source profile then gained `search`, a boolean defaulting to true whose `false` runs the Codex call without web search and under an obligation that can confirm no external result, so a note passes only when its text invokes none, for a task that must not reach the internet; the journaled Codex request gained the field, so the declaration moved to schema 11 and the contract stayed at 8.

Three end-to-end runs on TCSbench problems through the Lab debug command (`runs/e2e-20260902`, Sol max on every Pi profile, source offline) then changed two prompts. In two of the runs the correctness verifier spent seven and thirty-nine minutes on notes the source verifier killed in twenty seconds, so the verifier order is now source, correctness, requirements, reconstruction; the fold matches the source call that opens a verification by its exact Codex request. One run spent five turns re-polishing a verified counterexample, so the coordinator's prompt now says a verified note is settled and the next objective goes to what the completion criteria still need. The declaration moved to schema 12; the contract stayed at 8. The source profile may also be a Pi profile, and then the source verifier is one Pi call without web search, so a worker needs no Codex credential; the declaration moved to schema 13. In the hard e2e run a note died at the source verifier for using a case established by another note its support did not name, and the note that replaced it cost a turn, so the explorer's result schema now refuses a text that names a live earlier note its support does not name, and the explorer prompt says what support includes; the declaration moved to schema 14. The same run spent four turns on one gap that an unverified strategy note had named in its first turn, so the coordinator prompt now says a note that records only an approach or names a gap without closing it does not set the objective, and that when later notes leave a named gap open the objective asks for a different construction or a different reduction rather than the same assertion again, saying what to abandon and why; the declaration moved to schema 15. The objectives in that run also prescribed the proof plan from summaries, and the explorer followed it, so the objective is now bounded to what the completion criteria still need, which verified notes can be built on, and which approaches are dead or have left their gap open, and the method is the explorer's; the declaration moved to schema 16. Summaries had grown a narrating prefix, "proves the standalone lemma that", and a status the coordinator has no authority to assert, so a summary is now the note's exact statement plus only what the text itself says about its status, which halved their length on the rerun's notes; the declaration moved to schema 17. The three evaluations are in the run directory: one problem accepted with a proof the evaluator confirmed correct and complete, one whose benchmark statement is false as written and whose verified counterexample the criteria could not accept, and one hard problem that ended at the turn limit with seventeen verified lemmas.

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
3. Inspect `elenx-solve contract`. Confirm schema 8, application `elenx-solve`, protocol `workflow`, and the three run arguments.
4. Run `bun run check` in Elenx Lab. Confirm the single author manifest, schema-8 contract freeze, old-shape rejection, task-based debug, inspection-derived worker results, recovery, immutable attempt validation, Nomad HCL validation, and CLI help.
5. Build a worker image from clean committed Elenx and Lab revisions. Run one small Nomad experiment, wait for the allocation to settle, and inspect the campaign database. Confirm that the mathematical fields in `attempt.json.report` match `inspect.result` and that the report identity matches the frozen contract.

## Live smoke evidence

The first fresh Luna-low primes run reached `accepted` in two explorer turns. The first answer contained the standard Euclidean proof and a valid minimal-divisor argument, but the correctness auditor rejected it only because it did not explicitly say that the alleged finite list of primes was nonempty. An independent proof audit classified that omission as routine bookkeeping rather than a blocking gap.

The verifier prompt was narrowed without changing the workflow: a verifier still fails an unsupported load-bearing inference, but it does not fail solely for an immediate routine fact or harmless standard convention. A second fresh run of the same task reached `accepted` in one explorer turn with five provider requests, 5,078 tokens, no request errors, and estimated cost $0.0022386. The accepted proof constructs the product plus one, proves that it has a prime divisor by minimality, and proves that this divisor is absent from the alleged complete list.

The smoke artifacts are untracked run evidence under `runs/workflow-reset-primes-smoke-20260902-1` and `runs/workflow-reset-primes-smoke-20260902-2`. Each directory preserves the task, settings, campaign database, process logs, `inspect.json`, and journal-derived `result.json`.

The note-verification change was smoked twice on the same task with the same Luna-low settings, before and after the review repairs to the prompts. The first run reached `accepted` in one explorer turn with five provider requests, 4,109 tokens, and estimated cost $0.0019718. The second run, on the final prompts, reached `accepted` in two explorer turns with ten provider requests, 8,903 tokens, no request errors, and estimated cost $0.0039176: the adversarial verifier failed `n1`, the explorer read that verdict and wrote `n2`, and all three verifiers passed `n2`. In both runs a repeated `run` made no provider request and `export` returned the accepted note. The artifacts are under `runs/note-verification-primes-smoke-20260902-1` and `runs/note-verification-primes-smoke-20260902-2`. A campaign declared before the change no longer parses as a workflow, because the declaration now carries the schema version.

The one-call-per-operation change was smoked the same way, before and after the review repairs to the prompts. Both runs reached `accepted` in one explorer turn with five provider requests, one per role call, no request errors, and estimated cost under a quarter of a cent; the final run used 4,121 tokens. Inspect lists five calls with their results: explorer, coordinator, and the three verifier calls bound to one candidate. A repeated `run` made no provider request, and a `run` against a schema-2 campaign was refused. The artifacts are under `runs/one-call-primes-smoke-20260902-1` and `runs/one-call-primes-smoke-20260902-2`.

[`../packages/solve/README.md`](../packages/solve/README.md) is the solver command guide. [`../../elenx-lab/README.md`](../../elenx-lab/README.md) is the Lab operator guide.
