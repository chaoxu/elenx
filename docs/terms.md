# Terms

This is the vocabulary of Elenx and its solver. Work in this repository uses these words for these concepts and no others. A new concept gets an entry here in the same change that introduces it. A synonym is collapsed into the existing term, never added beside it. Code identifiers compose these terms, as in `roleLabels`, `verifierNames`, and `journalVerdicts`.

## Kernel

| Term | Meaning |
| --- | --- |
| campaign | One SQLite database holding one journal, opened as a writer or a reader. Its first entry is the declaration. |
| declaration | The campaign's first entry: application id and config. The solver's config carries `kind` and `schemaVersion`. |
| journal | The append-only entry sequence in a campaign. Every entry has `seq` and `atMs`. |
| entry | One journal record: campaign, candidate, verdict, call, tool-call, call-result, tool-result. |
| call | One journaled invocation: label, optional role, optional candidate, exact request, declared tools. |
| settled | A call whose call-result is written. `inspect` reports `settledAtMs`, `elapsedMs`, and the call-result state. |
| state | The state of a call-result, `returned` or `threw`, or of a Pi call, `succeeded`, `failed`, or `cancelled`. Never the workflow phase. |
| label | The string naming a call. |
| role | The category of a call: explorer, coordinator, verifier. |
| request | The exact JSON input of a call. For a Pi call it holds the model, the system prompt, and the prompt. |
| tool, submission | A model-callable tool, and the structured value the model passed to it. The solver's submit tools are `submit_notes`, `submit_coordination`, and `submit_verdict`. |
| candidate | An entry holding material and the labels of its required verifiers. |
| material | The bytes attached to a candidate. |
| verdict | `PASS`, `FAIL`, or `INCONCLUSIVE` with evidence, recorded against a call bound to a candidate. The solver records only `PASS` and `FAIL`. |
| verified | The candidate status in which every required verifier recorded `PASS` and none recorded `FAIL`. |
| telemetry, spend | Provider request observation, and the summary derived from it: request counts, request errors, measured usage in tokens, and estimated cost. |

## Solver

| Term | Meaning |
| --- | --- |
| workflow | The solver's one protocol: the turn loop from a task to `accepted` or `turn-limit`. It is the declaration kind `workflow` and the contract's `protocol`. Standalone role commands write the declaration kind `calls` and are not a second workflow. |
| task | `problem` and `completionCriteria`. Fixed for a campaign. |
| completion criteria | The task's statement of what an accepted note must do. The requirements verifier alone checks a note against them; a note is accepted when all three verifiers pass, so a task that would accept a disproof says so here. |
| note | `id`, `summary`, `text`, `verdicts`. Immutable: a change is a new note. Numbered `n1`, `n2`, and so on in the order the explorer wrote them. |
| summary | The coordinator's navigation text for a note. Never verified. |
| text | The explorer's mathematics in a note. |
| explorer | The role that writes note texts for one objective. |
| coordinator | The role that files summaries, sets the next objective and support, and may verify one note. |
| objective | The explorer's goal for one turn. The first objective is the problem. |
| input | The typed value handed to a role: `ExplorerInput`, `CoordinatorInput`, `VerifierInput`. A role call's prompt is derived from it. |
| notes | Notes as handed to a role, or as written by one. The explorer receives every note without its text and returns its new texts; the coordinator and `inspect` receive every note in full. |
| support | Notes handed to a role in full: the explorer's reading list, or the premises of a note under verification. Ids in the coordinator's result, notes in the explorer's and verifier's inputs. |
| filing | The coordinator's pairing of a note id with a summary. |
| verify | The coordinator's choice to verify one note with its support. |
| verifier | The role, and each of `correctness`, `adversarial`, `requirements`, which run in that order and stop at the first `FAIL`. |
| obligation | The fixed instruction of one verifier. |
| verdict | `verifier`, `note`, `PASS` or `FAIL`, `report`, recorded on the note it names. A `PASS` names the note under verification; a `FAIL` names the note the report is about. |
| report | The text of a verdict. Qualified as execution report: a run's result with `schemaVersion`, `application`, and `protocol`, as `run` and `inspect` emit it. |
| turn | One explorer call, its coordinator call, and any verification. Capped by `maxExplorerTurns`. |
| phase | Where the fold stands: the role to call next, or the terminal kind `accepted` or `turn-limit`. |
| outcome | A run's ending: `accepted`, `turn-limit`, `paused`, `call-failure`, `interrupted`. |
| result | A run's outcome with its data. The terminal results carry the turns, notes, and for `accepted` the note and candidate; the resumable ones carry the phase they stopped at as `at` and an optional reason. `inspect.result` is the terminal one. |
| fold | `deriveWorkflow`: the derivation of notes and phase from the journal, matching each role call by its derived prompt bytes. |
| schema version | The declaration's version moves with every role prompt or journal shape change. The contract's version moves only with the contract or report shape. |
| contract | The output of `elenx-solve contract`: command, arguments, outcomes, and the execution report schema. |
| settings | One profile per role plus `maxExplorerTurns`. |
| profile | One role's provider, model, and reasoning level. |
| run, inspect, export | The commands that start or resume a campaign, derive its phase and result, and emit the accepted material. |

The Lab's own terms, such as experiment, arm, replicate, attempt, and generation, live in the `elenx-lab` repository.

## Words not to use

These were collapsed into the terms above and must not return as names for those concepts: auditor and audit for a verifier, finding for a note, index and context for lists of notes, nominate, proposal, and answer for verifying a note, `ACCEPT` and `REJECT` for verdicts, candidate kind, solution, refutation, and refuted, repair for a new note, unfiled for a note without a summary, standing and trust for what a note's verdicts show, unverified, record for a verdict, state for the phase, agent for a call, resolve for meeting the completion criteria, mint for numbering notes, turn for a single call. Ordinary English elsewhere, such as review findings in the development loop or the untrusted-data labels in prompts, is not a system term.
