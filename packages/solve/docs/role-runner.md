# Workflow

One task contains the exact `problem` and `completionCriteria`. The campaign and standalone commands use the same role contracts:

```text
ExplorerInput    -> ExplorerResult
CoordinatorInput -> CoordinatorResult
VerifierInput    -> VerifierResult
```

## Notes and verdicts

A note is `id`, `summary`, `text`, `support`, `verdicts`, `verified`, and `dead`. The explorer writes the text and names the support, the notes whose results the text uses without proving them; the coordinator writes the summary; the verifiers write the verdicts; the projection derives the two flags. Notes are immutable: a change is a new note. Every role receives notes in this one shape.

The fold builds the projection on every derivation: an in-memory Cozo database of notes, summaries, and verdicts, each carrying the journal sequence that produced it, and support edges. Which notes exist at a journal sequence, which are verified, dead, or accepted, and a note's closure, are queries against the projection. Nothing is persisted there; the journal is the only source of truth.

A verdict names the verifier that produced it, the note it is about, `PASS`, `FAIL`, or `INCONCLUSIVE`, and a report. It always names a note under verification: support is established and not under review. Verdicts accumulate on the note they name, so a reader can weigh a note by the verdicts it carries. A note is verified when one verification passed source and correctness, every note in its support is verified, and it is not dead. A note is dead when correctness, source, or reconstruction failed it or a note in its support is dead. A note is accepted when one verification passed all four verifiers and the note is verified over verified support.

## Explorer

`ExplorerInput` contains the task, one `explorerGuidance` string, every note without its text, and the support notes in full. Guidance is empty on the first turn unless external advice was submitted. The original task remains the goal. Advice is fallible, and the Explorer may reject it or move beyond a suggested step. `ExplorerResult` contains new notes, each a text with its support. Notes are numbered after those the Explorer received, in returned order, and a note may name an earlier note of the same turn. Support names no dead note, and a text names a note by id only when that note is its support. The Explorer chooses the mathematics, splits its work into notes, says when a note meets the completion criteria, and writes no summaries.

## Durable Explorer guidance

The coordinator's `explorerGuidance` and pending external advice share the Explorer's field of the same name. Its settled submission already records its recommendation. No duplicate coordinator record is needed. The field holds a recommendation and its reasons, while `support` selects full-text evidence.

`guide` appends an ordinary kernel call labeled `elenx-solve/guidance`, with request `{schemaVersion: 1, id, text}`. Its request entry is the durable receipt, including when the submitting process dies before writing the local call-result. The command uses a short independent guidance lock to make an id unique without blocking an active runner. The call executes locally and makes no provider request.

Before a new Explorer turn with pending advice, the runner records a local `elenx-solve/explorer-guidance` call with `{schemaVersion: 1, after, through}`. `after` identifies the journal boundary before that turn, and `through` is the last entry in the snapshot used to freeze its input. The fold includes external guidance after the previous delivery cutoff and at most `through`, joined after the coordinator's text. New messages arriving after that snapshot wait for a later turn. A boundary remains authoritative after a crash and through retries. A previously started turn retains its original input. Consumed advice is omitted from subsequent turns.

The command records advice without checking or changing the workflow phase. Advice on a terminal campaign remains pending. This avoids coordinating command submission with workflow completion. No delivery record is added when there is no pending advice. Workflow schema 24 records the renamed role field, removed persistent setting, and advisory prompts. The external execution contract stays at schema 8. [Agent usage](agent-usage.md) describes submission and recovery.

## Coordinator

`CoordinatorInput` contains the task and every note, including new notes without summaries and dead notes with verdicts. `CoordinatorResult` files each new note with a summary, gives `explorerGuidance` for the next turn, selects `support` notes to read in full, and lists `verify` entries in priority order. Each verification asks for a nonempty prefix of source, correctness, requirements, reconstruction. A listed note must be live and its support must be verified or listed earlier with correctness, so an accepted note's closure is verified by induction.

Guidance recommends useful mathematical work from the recorded evidence and explains the coordinator's uncertainty. The Explorer can reject that advice, choose another method, or move beyond a suggested intermediate step. The original task remains its objective. The coordinator never asks it to check, polish, or restate a verified note and has no authority to change verdicts or completion criteria.

A summary is for navigation and is never verified. It is the note's exact statement as a mathematician would state the result, not a description of the note, plus only what the text itself says about its status: a gap it leaves, a failed approach, or a claim to meet the completion criteria; it repeats nothing the note's fields say and never judges the text. The coordinator has no correctness authority.

## Verifier

`VerifierInput` contains the task, the `verify` entries of one verification, those notes in full, and their complete transitive support outside them in full, in id order. Every inherited dependency must be present, while unrelated notes are excluded. The fold takes the entries as the longest prefix of the coordinator's list whose note and closure texts fit the `window` setting, counting shared texts once and always taking its first entry with the full closure. Each verifier call selects the closure of just the notes it judges. The verifier role submits one kernel candidate for the notes and their support, then runs the verifiers in order, each on the notes that asked for it, passed every verifier before it, and are not dead in the verification: a note whose support failed in the same verification is skipped. Malformed results and provider failures remain operational errors.

The correctness and requirements verifiers judge their notes in one Pi call each, and the source verifier judges its notes in one call, Codex or Pi as its profile says; each call returns one verdict per note under verification and records one kernel verdict on the candidate, `PASS` only when every note passed, whose evidence lists the note verdicts. The Pi verdict calls share one system prompt, and calls that judge the same notes begin with the same task, notes, and support text, so a provider can serve that prefix from cache; only the verifier name and obligation at the end differ, and the reconstruction verdict call appends its statement and proof after them.

The source verifier uses the Codex CLI when its profile's provider is `codex`, with web search controlled by `search`, true by default. Other providers use one Pi call under the shared verifier prompt without web search. Both paths assess an invoked result and its hypotheses from available sources, mathematical knowledge, and supplied texts. Search-disabled calls use knowledge and supplied texts directly. When an online lookup fails or cannot settle a result, the verifier uses that same assessment. A known result can pass without a citation lookup or a proof from first principles. A source `FAIL` requires a concrete false statement, source mismatch, or incorrect application. `INCONCLUSIVE` requires a specific uncertainty about the result or its applicability, and lack of web access alone does not supply one. The report states the basis of the assessment. Its request carries the same verifier text as developer instructions, the same prompt, and the output schema of its verdicts. A Codex verdict adds `sources` entries only for results confirmed in sources it actually opened, with the result, source, and URL opened. Knowledge-based assessments have no source entries. The Codex call runs in a fresh home holding only the inherited credential, with every other Codex feature disabled and a read-only sandbox. Its request, transcript, searches, and usage are journaled on the call, and its usage is on its submission rather than in spend, which covers Pi calls. Verdicts that list sources without having searched remain an operational error.

The initial reconstruction is three Pi calls per note, bound to the same candidate. The statement call reads the note and its support in full and returns what the note's text establishes, one or several propositions, with nothing of how. The proof call receives the task, that statement, and the support notes in full, never the note's text, and returns a proof. The judgment call compares the note's text with the proof. If the extracted statement misstates the note or reveals its method, the judgment returns a corrected `statement` and an empty `verdicts` list, with no mathematical verdict. The next proof call reads that correction and the same support, followed by a new judgment. One such retry is automatic after a fresh judgment. Further corrections remain journaled and leave a resumable call failure. A valid statement needs no new extraction. Normal judgments return `statement: null` and one `PASS`, `FAIL`, or `INCONCLUSIVE` verdict. Reconstruction `INCONCLUSIVE` means the independent proof left something unproved and no concrete defect in the note was found. Reconstruction runs one note at a time, so a note whose support failed reconstruction earlier in the same verification is skipped.

A verification interrupted after some calls resumes on the same candidate and makes only the calls still missing; a settled call whose kernel verdict was not recorded is recorded on resume. Every verifier may leave a check `INCONCLUSIVE`. The workflow then returns `paused` at the verifier, with the unresolved report visible in `inspect`, and an explicit `run` retries the unresolved checks without replaying successful checks or creating new notes. A reconstruction retry reuses its statement and repeats its proof and judgment. Retry requests name the preceding reconstruction call so that reopening selects the correct saved proof and correction. An answer that passed all four checks over verified support ends the campaign even when an unrelated note remains unresolved. The kernel's candidate status is evidence and decides nothing: acceptance is the projection's query over the verdict rows. A replacement `Roles.verifier` must bind its calls and verdicts the same way, because the projection reads only kernel verdicts recorded under the verifier labels.

## Replay and terminal results

Every role call is one model call: Pi for every role except a source verifier whose profile selects Codex. A source verifier with a Pi profile uses the same Pi call boundary as the other verifiers. Its prompt is a deterministic function of the role input, its structured result is its submission, a submit tool call or the source verifier's final JSON message, and its transcript sits on the same call, with telemetry and spend for Pi calls. The workflow fold starts from the declared task, derives each role input, and matches the explorer and coordinator calls by their prompt bytes and the source call that opens each verification by its exact Codex request or, for a Pi profile, by its prompt bytes; the remaining verifier calls are found by the candidate they bind to. A call whose bytes differ means the journal was written by other prompts, and the fold refuses it rather than running the role again.

The fold replays settled calls in order:

```text
explorer -> coordinator -> explorer
                        -> verifier -> accepted
                                    -> explorer
```

Explorer results number the notes `n1`, `n2`, and so on in order. Note verdicts and flags are derived from the kernel verdict entries settled before each role call. Repeating `run` invokes the first role whose settled call is missing. Repeating it on a completed campaign makes no model request.

`accepted` and `turn-limit` are terminal results. `paused`, `call-failure`, and `interrupted` leave the campaign resumable.

## Inspection and export

`inspect` reports the task, current phase, notes with verdicts and flags, every role call once with its state and submission, telemetry-derived spend, and with `--include-requests` the exact requests. A terminal campaign adds `result`, derived from the journal. An unresolved verification adds a `paused` result with its verifier/note reports only when all reachable unfinished checks are inconclusive and no newer verifier call lacks a verdict. Fresh work, in-flight calls, failed retries, and correction-only judgments cannot inherit an older pause. Each verifier call carries its verifier name and its candidate.

`export` returns the accepted note preceded by its closure in id order, each under a heading with its id.

## Internal derivation

Each inspection captures the journal once. Workflow phase, notes, calls, guidance delivery, pause reports, and accounting are derived from that same entry array, so a concurrent append cannot mix different journal prefixes in one report.

Cozo derives support closure through the single query in `support.ts`. Verifier-input validation, verification-window calculation, individual verifier prompts, and accepted export all use it. TypeScript checks duplicate IDs, missing notes, and the requirement that support precede its note, then sorts the result in numeric ID order. The Cozo Node binding is asynchronous, so verifier-input validation and verifier prompt construction await that query internally. Role fields and prompt bytes are unchanged.

The status projection rebuilds its temporary Cozo relations from journal evidence. Closure queries use the supplied note graph in a short-lived in-memory Cozo database, which also allows standalone role commands to use the same calculation. SQLite remains the durable source of truth. Guidance stays in ordinary journal calls and does not enter the note graph.
