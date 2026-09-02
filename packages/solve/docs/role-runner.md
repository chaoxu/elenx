# Task workflow

One task contains the exact `problem` and `completionCriteria`. The campaign and standalone commands use the same role contracts:

```text
ExplorerInput    -> ExplorerResult
CoordinatorInput -> CoordinatorResult
VerifierInput    -> VerifierResult
```

## Notes and verdicts

A note is `id`, `summary`, `text`, and `verdicts`. The explorer writes the text, the coordinator writes the summary, and the verifiers write the verdicts. Notes are immutable: a change is a new note. Every role receives notes in this one shape.

A verdict names the verifier that produced it, the note it is about, `PASS` or `FAIL`, and a report. A `PASS` names the note under verification. A `FAIL` names the note the report is about, which may be a support note. Verdicts accumulate on the note they name, so a reader can weigh a note by the verdicts it carries.

## Explorer

`ExplorerInput` contains the task, one objective, and every note. The first objective is the problem. `ExplorerResult` contains one or more new note texts. The explorer performs mathematics. It neither writes summaries nor decides whether the task is resolved.

## Coordinator

`CoordinatorInput` contains the task and every note, including the new notes that have no summary yet. `CoordinatorResult` files each of those notes with a summary, sets the next objective, and optionally verifies one note with the support notes whose results its text uses without proving them.

A summary is for navigation and is never verified. It states what the note establishes or attempts, whether the text proves it or leaves a gap, and the notes it depends on. The coordinator has no correctness authority and never declares that the task is resolved.

## Verifier

`VerifierInput` contains the task, the note, and its support notes. The verifier role runs the `requirements`, `correctness`, and `adversarial` verifiers in that order, every time, and returns their three verdicts. Each verifier judges the text on its own terms: whatever the text asserts, it must establish, with the support notes as premises whose own verdicts are visible. The requirements verifier alone decides whether the note resolves the task. Malformed results and provider failures remain operational errors.

The public verifier call owns the kernel candidate. Each verifier call binds to that candidate and records its own verdict, so the kernel's candidate status is the acceptance rule: all three verifiers passed. A replacement `Roles.verifier` must do the same, because acceptance reads only kernel verdicts recorded under the verifier labels.

## Replay and terminal results

The journal stores every public role input and output. The workflow fold starts from the declared task and replays settled calls in order:

```text
explorer -> coordinator -> explorer
                        -> verifier -> accepted
                                    -> explorer
```

Explorer results deterministically mint `n1`, `n2`, and later notes. Note verdicts are derived from the kernel verdict entries settled before each role call, so a verification that fails before it settles keeps the verdicts it did record, and they appear on the note once the repeated verification settles. Repeating `run` invokes the first role whose exact output is missing. Repeating it on a completed campaign makes no model request.

`accepted` and `turn-limit` are terminal results. `paused`, `call-failure`, and `interrupted` leave the campaign resumable.

## Inspection and export

`inspect` reports the task, current phase, notes with verdicts, public calls, telemetry-derived spend, and optional exact public inputs. A terminal campaign adds `result`, derived from the journal. Verifier calls appear once each with their three verdicts; the model calls beneath them remain outside the public call list.

`export` returns the accepted candidate bytes: the accepted note followed by its support notes.
