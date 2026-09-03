# Workflow

One task contains the exact `problem` and `completionCriteria`. The campaign and standalone commands use the same role contracts:

```text
ExplorerInput    -> ExplorerResult
CoordinatorInput -> CoordinatorResult
VerifierInput    -> VerifierResult
```

## Notes and verdicts

A note is `id`, `summary`, `text`, `support`, and `verdicts`. The explorer writes the text and names the support, the notes whose results the text uses without proving them; the coordinator writes the summary; the verifiers write the verdicts. Notes are immutable: a change is a new note. Every role receives notes in this one shape.

The fold builds the projection on every derivation: an in-memory Cozo database of notes, summaries, and verdicts, each carrying the journal sequence that produced it, and support edges. Which notes exist at a journal sequence, and a note's closure, are queries against the projection. Nothing is persisted there; the journal is the only source of truth.

A verdict names the verifier that produced it, the note it is about, `PASS`, `FAIL`, or `INCONCLUSIVE`, and a report. A `PASS` names the note under verification. A `FAIL` names the note the report is about, which may be a support note. Verdicts accumulate on the note they name, so a reader can weigh a note by the verdicts it carries.

## Explorer

`ExplorerInput` contains the task, one objective, every note without its text, and the support notes in full. The first objective is the problem. `ExplorerResult` contains one or more new notes, each a text with its support. The new notes are numbered after the notes the explorer received, in the order it returns them, and a note may name an earlier note of the same turn. The explorer performs mathematics and writes no summaries.

## Coordinator

`CoordinatorInput` contains the task and every note, including the new notes that have no summary yet. `CoordinatorResult` files each of those notes with a summary, sets the next objective and the support notes the explorer reads in full, and optionally verifies one note against the support it declares.

A summary is for navigation and is never verified. It states what the note establishes or attempts and whether the text proves it or leaves a gap. The coordinator has no correctness authority.

## Verifier

`VerifierInput` contains the task, the note, and the support notes it declares, in full. The verifier role submits one kernel candidate for the note and its support, then runs the `correctness`, `adversarial`, `source`, `reconstruction`, and `requirements` verifiers in that order, stopping at the first verdict that is not `PASS`, and returns the verdicts recorded on that candidate. The correctness and adversarial verifiers judge the text on its own terms: whatever the text asserts, it must establish, with the support notes as premises whose own verdicts are visible. The requirements verifier alone decides whether the note meets the completion criteria. Malformed results and provider failures remain operational errors.

The Pi verdict calls share one system prompt and begin with the same task, note, and support text, so a provider can serve that prefix from cache; only the verifier name and obligation at the end differ, and the reconstruction verdict call appends its statement and proof after them.

The source verifier is one Codex CLI call with web search rather than a Pi call, because web search is available only on Codex's native credential. Its request carries the same verifier text as developer instructions, the same prompt, and the output schema of its verdict, which adds `sources`: one entry per external result the text invokes, with the result as the source states it, the source, and the URL opened. The call runs in a fresh Codex home holding only the inherited credential, with every other Codex feature disabled and a read-only sandbox; its request, transcript, searches, and usage are journaled on the call, and its usage is on its submission rather than in spend, which covers Pi calls. A PASS that lists sources without having searched is an operational error, not a verdict.

The reconstruction verifier is three Pi calls bound to the same candidate. The statement call reads the note and its support in full and returns what each text establishes, with nothing of how. The proof call receives the task, that statement, and the support statements, never the note's text, and returns a proof; when the statement contains the note's text, no proof is written and the verdict call is told so, which its obligation answers with `INCONCLUSIVE`. The verdict call compares the note's text with the proof under the shared verifier prompt and records `PASS`, `FAIL`, or `INCONCLUSIVE`. `INCONCLUSIVE` means the proof left something unproved and no defect was found, or the statement misstated or gave away the note; it blocks acceptance without marking the note defective, and the coordinator may verify the note again, usually after the explorer has split it. Each verifier call binds to the candidate and records its own verdict, so the kernel's candidate status is the acceptance rule: all five verifiers passed. A verification interrupted after some verdicts resumes on the same candidate and runs only the verifiers still missing. A replacement `Roles.verifier` must bind its calls and verdicts the same way, because acceptance reads only kernel verdicts recorded under the verifier labels.

## Replay and terminal results

Every role call is one Pi model call. Its prompt is a deterministic function of the role input, its structured result is the submit tool's submission, and its transcript, telemetry, and spend sit on the same call. The workflow fold starts from the declared task, derives each role input, and matches the journal call whose prompt bytes equal the derived prompt. A call whose bytes differ means the journal was written by other prompts, and the fold refuses it rather than running the role again.

The fold replays settled calls in order:

```text
explorer -> coordinator -> explorer
                        -> verifier -> accepted
                                    -> explorer
```

Explorer results number the notes `n1`, `n2`, and so on in order. Note verdicts are derived from the kernel verdict entries settled before each role call. Repeating `run` invokes the first role whose settled call is missing. Repeating it on a completed campaign makes no model request.

`accepted` and `turn-limit` are terminal results. `paused`, `call-failure`, and `interrupted` leave the campaign resumable.

## Inspection and export

`inspect` reports the task, current phase, notes with verdicts, every role call once with its state and submission, telemetry-derived spend, and with `--include-requests` the exact Pi requests. A terminal campaign adds `result`, derived from the journal. Each verifier call carries its verifier name and its candidate.

`export` returns the accepted note preceded by its closure in id order, each under a heading with its id.
