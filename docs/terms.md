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
| state | The state of a call-result, `returned` or `threw`, or of a Pi or Codex call, `succeeded`, `failed`, or `cancelled`. Never the workflow phase. |
| label | The string naming a call. |
| role | The category of a call: explorer, coordinator, verifier. |
| request | The exact JSON input of a call. For a Pi call it holds the model, the system prompt, and the prompt. For a Codex call it holds the model, reasoning, developer instructions, prompt, and output schema. |
| tool, submission | A model-callable tool, and the structured value the model passed to it. The solver's submit tools are `submit_notes`, `submit_coordination`, `submit_verdict`, `submit_statement`, and `submit_proof`. The source verifier has no submit tool; its submission is its final JSON message. |
| candidate | An entry holding material and the labels of its required verifiers. |
| material | The bytes attached to a candidate. |
| verdict | `PASS`, `FAIL`, or `INCONCLUSIVE` with evidence, recorded against a call bound to a candidate. |
| verified | The candidate status in which every required verifier recorded `PASS` and none recorded `FAIL`. An `INCONCLUSIVE` leaves the verifier missing. |
| telemetry, spend | Provider request observation of Pi calls, and the summary derived from it: request counts, request errors, measured usage in tokens, and estimated cost. A Codex call's usage is on its submission. |

## Solver

| Term | Meaning |
| --- | --- |
| workflow | The solver's one protocol: the turn loop from a task to `accepted` or `turn-limit`. It is the declaration kind `workflow` and the contract's `protocol`. Standalone role commands write the declaration kind `calls` and are not a second workflow. |
| task | `problem` and `completionCriteria`. Fixed for a campaign. |
| completion criteria | The task's statement of what an accepted note must do. The requirements verifier alone checks a note against them; a note is accepted when all five verifiers pass, so a task that would accept a disproof says so here. |
| note | `id`, `summary`, `text`, `support`, `verdicts`. Immutable: a change is a new note. Numbered `n1`, `n2`, and so on in the order the explorer wrote them. |
| summary | The coordinator's navigation text for a note. Never verified. |
| text | The explorer's mathematics in a note. |
| explorer | The role that writes note texts for one objective. |
| coordinator | The role that files summaries, sets the next objective and support, and may verify one note. |
| objective | The explorer's goal for one turn. The first objective is the problem. |
| input | The typed value handed to a role: `ExplorerInput`, `CoordinatorInput`, `VerifierInput`. A role call's prompt is derived from it. |
| notes | Notes as handed to a role, or as written by one. The explorer receives every note without its text and returns its new texts; the coordinator and `inspect` receive every note in full. |
| support | The notes whose results a text uses without proving them, named by the explorer on each note, or the notes the coordinator has the explorer read in full. Ids on notes and in the coordinator's result, notes in full in the explorer's and verifier's inputs. |
| closure | A note's transitive support: its support, their support, and so on, in id order. `export` emits it before the accepted note. |
| filing | The coordinator's pairing of a note id with a summary. |
| verify | The coordinator's choice to verify one note against the support it declares. |
| verifier | The role, and each of `correctness`, `adversarial`, `source`, `reconstruction`, `requirements`, which run in that order and stop at the first verdict that is not `PASS`. The source verifier is a Codex call with web search; the reconstruction verifier is three Pi calls; the others are one Pi call each. |
| sources | The source verifier's evidence: one entry per external result the text invokes, a result attributed to the literature or a named source and proved neither in the text nor in a support note. `result` is the result as the source states it, `source` is where it is stated, `url` is the page opened. |
| obligation | The fixed instruction of one verifier. |
| verdict | `verifier`, `note`, `PASS`, `FAIL`, or `INCONCLUSIVE`, `report`, recorded on the note it names. A `PASS` names the note under verification; a `FAIL` names the note the report is about. Only the reconstruction verifier returns `INCONCLUSIVE`, and it names the note under verification: the proof left something unproved and no defect was found, or the statement misstated or gave away the note, which blocks acceptance without marking the note defective. |
| statement | What a text establishes, with nothing of how: hypotheses, quantifiers, parameters, side conditions, conclusion. The reconstruction verifier states it for the note and each support note, then has a fresh call that never sees the note's text write a proof of it from the support statements. |
| proof | The reconstruction verifier's evidence: a proof of the statement written by a fresh call from the statement and the support statements alone, never from the note's text. It may leave something unproved and say so. |
| report | The text of a verdict. Qualified as execution report: a run's result with `schemaVersion`, `application`, and `protocol`, as `run` and `inspect` emit it. |
| turn | One explorer call, its coordinator call, and any verification. Capped by `maxExplorerTurns`. |
| phase | Where the fold stands: the role to call next, or the terminal kind `accepted` or `turn-limit`. |
| outcome | A run's ending: `accepted`, `turn-limit`, `paused`, `call-failure`, `interrupted`. |
| result | A run's outcome with its data. The terminal results carry the turns, notes, and for `accepted` the note and candidate; the resumable ones carry the phase they stopped at as `at` and an optional reason. `inspect.result` is the terminal one. |
| fold | `deriveWorkflow`: the derivation of notes and phase from the journal, matching each role call by its derived prompt bytes. It builds the projection and asks it which notes exist at a journal sequence and for a note's closure. |
| projection | `Projection`: the fold's in-memory Cozo database of notes, summaries, support, and verdicts, rebuilt from the journal on every derivation and never persisted. |
| schema version | The declaration's version moves with every role prompt or journal shape change. The contract's version moves only with the contract or report shape. |
| contract | The output of `elenx-solve contract`: command, arguments, outcomes, and the execution report schema. |
| settings | One profile per role, one for the source verifier, and `maxExplorerTurns`. |
| profile | A provider, model, and reasoning level. The source verifier's provider is `codex`, the Codex CLI on its native credential. |
| run, inspect, export | The commands that start or resume a campaign, derive its phase and result, and emit the accepted note with its transitive support. |

The Lab's own terms, such as experiment, arm, replicate, attempt, and generation, live in the `elenx-lab` repository.

## Words not to use

These were collapsed into the terms above and must not return as names for those concepts: auditor and audit for a verifier, finding for a note, index and context for lists of notes, nominate, proposal, and answer for verifying a note, `ACCEPT` and `REJECT` for verdicts, candidate kind, solution, refutation, and refuted, repair for a new note, unfiled for a note without a summary, standing and trust for what a note's verdicts show, unverified, record for a verdict, state for the phase, agent for a call, resolve for meeting the completion criteria, mint for numbering notes, turn for a single call. Ordinary English elsewhere, such as review findings in the development loop or the untrusted-data labels in prompts, is not a system term.
