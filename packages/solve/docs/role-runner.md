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

A verdict names the verifier that produced it, the note it is about, `PASS`, `FAIL`, or `INCONCLUSIVE`, and a report. It always names a note under verification: support is established and not under review. Verdicts accumulate on the note they name, so a reader can weigh a note by the verdicts it carries. A note is verified when one verification passed source and correctness and it is not dead. A note is dead when correctness, source, or reconstruction failed it or a note in its support is dead. A note is accepted when one verification passed all four verifiers.

## Explorer

`ExplorerInput` contains the task, one objective, every note without its text, and the support notes in full. The first objective is the problem. `ExplorerResult` contains one or more new notes, each a text with its support. The new notes are numbered after the notes the explorer received, in the order it returns them, and a note may name an earlier note of the same turn. Support names no dead note, and a text names a note by id only when that note is its support; the result schema refuses a text that names a live earlier note its support does not name. The explorer performs mathematics, decides how a turn's work splits into notes, says in a text when the note meets the completion criteria, and writes no summaries.

## Coordinator

`CoordinatorInput` contains the task and every note, including the new notes that have no summary yet and the dead notes with their verdicts. `CoordinatorResult` files each new note with a summary, sets the next objective and the support notes the explorer reads in full, and lists in `verify` the notes to verify in priority order, each with the verifiers to run, a nonempty prefix of source, correctness, requirements, reconstruction. A note may be listed only when it is not dead and every note in its support is verified or listed earlier with the correctness verifier, so an accepted note's closure is verified by induction. The coordinator never asks the explorer to check, polish, or restate a verified note.

A summary is for navigation and is never verified. It states what the note establishes or attempts and whether the text proves it, leaves a gap, or says it meets the completion criteria. The coordinator has no correctness authority.

## Verifier

`VerifierInput` contains the task, the `verify` entries of one verification, those notes in full, and their support outside them in full, in id order. The fold takes the entries as the longest prefix of the coordinator's list whose note and support texts fit the `window` setting, always its first entry. The verifier role submits one kernel candidate for the notes and their support, then runs the verifiers in order, each on the notes that asked for it, passed every verifier before it, and are not dead in the verification: a note whose support failed in the same verification is skipped. Malformed results and provider failures remain operational errors.

The correctness and requirements verifiers judge their notes in one Pi call each, and the source verifier judges its notes in one call, Codex or Pi as its profile says; each call returns one verdict per note under verification and records one kernel verdict on the candidate, `PASS` only when every note passed, whose evidence lists the note verdicts. The Pi verdict calls share one system prompt, and calls that judge the same notes begin with the same task, notes, and support text, so a provider can serve that prefix from cache; only the verifier name and obligation at the end differ, and the reconstruction verdict call appends its statement and proof after them.

The source verifier is one Codex CLI call with web search rather than a Pi call, because web search is available only on Codex's native credential; when its profile's provider is not `codex` it is instead one Pi call under the shared verifier prompt with the offline obligation, matched by the fold like every other Pi call. Its profile's `search` is true by default and is journaled on the request; `false` runs the call without web search, tells it that it has no web search and no other tool, and gives it an obligation under which no external result can be confirmed, so it passes a note only when the text invokes none and fails a note that invokes one. Its request carries the same verifier text as developer instructions, the same prompt, and the output schema of its verdicts, each of which adds `sources`: one entry per external result the text invokes, with the result as the source states it, the source, and the URL opened. The call runs in a fresh Codex home holding only the inherited credential, with every other Codex feature disabled and a read-only sandbox; its request, transcript, searches, and usage are journaled on the call, and its usage is on its submission rather than in spend, which covers Pi calls. Verdicts that list sources without having searched are an operational error, not a verdict.

The reconstruction verifier is three Pi calls per note, bound to the same candidate. The statement call reads the note and its support in full and returns what the note's text establishes, one or several propositions, with nothing of how. The proof call receives the task, that statement, and the support notes in full, never the note's text, and returns a proof. The verdict call compares the note's text with the proof under the shared verifier prompt and records `PASS`, `FAIL`, or `INCONCLUSIVE`. `INCONCLUSIVE` means the proof left something unproved and no defect was found, or the statement misstated or gave away the note; it blocks acceptance without marking the note defective, and the coordinator may list the note again, usually after the explorer has split it. Reconstruction runs one note at a time, so a note whose support failed reconstruction earlier in the same verification is skipped.

A verification interrupted after some calls resumes on the same candidate and makes only the calls still missing; a settled call whose kernel verdict was not recorded is recorded on resume. The kernel's candidate status is evidence and decides nothing: acceptance is the projection's query over the verdict rows. A replacement `Roles.verifier` must bind its calls and verdicts the same way, because the projection reads only kernel verdicts recorded under the verifier labels.

## Replay and terminal results

Every role call is one model call: Pi for every role but the source verifier, which is one Codex call. Its prompt is a deterministic function of the role input, its structured result is its submission, a submit tool call or the source verifier's final JSON message, and its transcript sits on the same call, with telemetry and spend for Pi calls. The workflow fold starts from the declared task, derives each role input, and matches the explorer and coordinator calls by their prompt bytes and the source call that opens each verification by its exact Codex request or, for a Pi profile, by its prompt bytes; the remaining verifier calls are found by the candidate they bind to. A call whose bytes differ means the journal was written by other prompts, and the fold refuses it rather than running the role again.

The fold replays settled calls in order:

```text
explorer -> coordinator -> explorer
                        -> verifier -> accepted
                                    -> explorer
```

Explorer results number the notes `n1`, `n2`, and so on in order. Note verdicts and flags are derived from the kernel verdict entries settled before each role call. Repeating `run` invokes the first role whose settled call is missing. Repeating it on a completed campaign makes no model request.

`accepted` and `turn-limit` are terminal results. `paused`, `call-failure`, and `interrupted` leave the campaign resumable.

## Inspection and export

`inspect` reports the task, current phase, notes with verdicts and flags, every role call once with its state and submission, telemetry-derived spend, and with `--include-requests` the exact requests. A terminal campaign adds `result`, derived from the journal. Each verifier call carries its verifier name and its candidate.

`export` returns the accepted note preceded by its closure in id order, each under a heading with its id.
