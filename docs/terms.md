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
| request | The exact JSON input of a call. For a Pi call it holds the model, the system prompt, and the prompt. For a Codex call it holds the model, reasoning, search, developer instructions, prompt, and output schema. |
| tool, submission | A model-callable tool, and the structured value the model passed to it. The solver's submit tools are `submit_notes`, `submit_coordination`, `submit_verdict`, `submit_statement`, and `submit_proof`. The source verifier has no submit tool; its submission is its final JSON message. |
| candidate | An entry holding material and the labels of its required verifiers. The solver submits one per verification, for the notes it verifies and their support. |
| material | The bytes attached to a candidate. |
| verdict | `PASS`, `FAIL`, or `INCONCLUSIVE` with evidence, recorded against a call bound to a candidate, one per call. A solver verifier call's kernel verdict is `PASS` only when every note it judged passed, and its evidence lists the verdict of each note. |
| verified | For a candidate, the kernel status in which every required verifier recorded `PASS`; the solver reads it as evidence and decides nothing by it. For a note, one verification passed source and correctness and the note is not dead, so its result can be built on; the coordinator lists a note for verification only after every note in its support is verified or listed earlier with the correctness verifier, so an accepted note's closure is verified. |
| transcript | The provider messages of a settled call, on its call-result. A Codex call's transcript is its JSONL output. |
| telemetry, spend | Provider request observation of Pi calls, and the summary derived from it: request counts, request errors, measured usage in tokens, and estimated cost. A Codex call's usage is on its submission. |

## Solver

| Term | Meaning |
| --- | --- |
| workflow | The solver's one protocol: the turn loop from a task to `accepted` or `turn-limit`. It is the declaration kind `workflow` and the contract's `protocol`. Standalone role commands write the declaration kind `calls` and are not a second workflow. |
| task | `problem` and `completionCriteria`. Fixed for a campaign. |
| completion criteria | The task's statement of what an accepted note must do. The requirements verifier alone checks a note against them; a note is accepted when all four verifiers pass it on one candidate, so a task that would accept a counterexample says so here. |
| note | `id`, `summary`, `text`, `support`, `verdicts`, `verified`, `dead`. Immutable: a change is a new note. Numbered `n1`, `n2`, and so on in the order the explorer wrote them. One self-contained text: a result with its proof, a partial result with its gaps stated, or a failed approach with the reason; the explorer decides the split and says in the text when a note meets the completion criteria. |
| summary | The coordinator's navigation text for a note. Never verified. |
| text | The explorer's mathematics in a note. It names a note by id only when that note is its support. |
| dead | A note that correctness, source, or reconstruction failed, or whose support contains a dead note, so it can never be verified. Derived by the projection from the verdicts and the support edges; nothing is stored. Every role sees dead notes with their verdicts; the explorer cannot name one as support, and the coordinator cannot list one for verification. An `INCONCLUSIVE` or a requirements `FAIL` is not death. |
| explorer | The role that writes note texts for one objective. |
| coordinator | The role that files summaries, sets the next objective and support, and lists the notes to verify with their verifiers. |
| objective | The explorer's goal for one turn. The first objective is the problem. |
| input | The typed value handed to a role: `ExplorerInput`, `CoordinatorInput`, `VerifierInput`. A role call's prompt is derived from it. |
| notes | Notes as handed to a role, or as written by one. The explorer receives every note without its text and returns its new texts; the coordinator and `inspect` receive every note in full; the verifier receives the notes under verification in full. |
| support | The notes whose results a text uses without proving them, in any form: a fact cited, a case inherited, an object taken as defined, or a hypothesis assumed established; named by the explorer on each note, and every note a text names by id. Or the notes the coordinator has the explorer read in full. Ids on notes and in the coordinator's result, notes in full in the explorer's and verifier's inputs. A verifier receives support as established and not under review. |
| closure | A note's transitive support: its support, their support, and so on, in id order. `export` emits it before the accepted note. |
| filing | The coordinator's pairing of a note id with a summary. |
| verify | The coordinator's ordered list of notes to verify, each with the verifiers to run: a prefix of the verifier order. Two verifiers for a note others will build on, all four for a note whose text says it meets the completion criteria. The explorer is never asked to check, polish, or restate a verified note. |
| verification | One candidate and the verifier calls on it: the longest prefix of the coordinator's `verify` list whose note and support texts fit the window, always its first entry. What the prefix leaves is still unverified, and the coordinator lists it again next turn if it still matters. A verification interrupted by a pause or a failure resumes at the call it stopped in. |
| window | The settings cap on the characters of note and support texts one verification reads, texts shared by several notes counted once. |
| verifier | The role, and each of `source`, `correctness`, `requirements`, `reconstruction`, which run in that order on the notes that asked for them and passed the verifiers before; a note's verification stops at its first verdict that is not `PASS`, and a note whose support failed in the same verification is skipped. The correctness and requirements verifiers judge their notes in one Pi call each; the source verifier judges its notes in one call, a Codex call with web search or a Pi call without it as its profile says; the reconstruction verifier is three Pi calls per note. |
| sources | The source verifier's evidence: one entry per external result the text invokes, a result attributed to the literature or a named source and proved neither in the text nor in a support note. `result` is the result as the source states it, `source` is where it is stated, `url` is the page opened. |
| obligation | The fixed instruction of one verifier. The correctness obligation includes the search for counterexamples and missing cases. |
| verdict | `verifier`, `note`, `PASS`, `FAIL`, or `INCONCLUSIVE`, `report`, recorded on the note it names, always a note under verification. Only the reconstruction verifier returns `INCONCLUSIVE`: the proof left something unproved and no defect was found, or the statement misstated or gave away the note, which blocks acceptance without marking the note defective. A requirements `FAIL` leaves the note verified but not accepted. |
| statement | What a text establishes, with nothing of how: one or several propositions, each with hypotheses, quantifiers, parameters, side conditions, and conclusion. The reconstruction verifier states it for the note from the full text, then has a fresh call that never sees the text write a proof of it from the support notes. It lives in the journal as the submission of its call and on no note. |
| proof | The reconstruction verifier's evidence: a proof of the statement written by a fresh call from the statement and the support notes alone, never from the note's text. It may leave something unproved and say so. |
| report | The text of a verdict. Qualified as execution report: a run's result with `schemaVersion`, `application`, and `protocol`, as `run` and `inspect` emit it. |
| turn | One explorer call, its coordinator call, and any verification. Capped by `maxExplorerTurns`. |
| phase | Where the fold stands: the role to call next, or the terminal kind `accepted` or `turn-limit`. |
| outcome | A run's ending: `accepted`, `turn-limit`, `paused`, `call-failure`, `interrupted`. |
| result | A run's outcome with its data. The terminal results carry the turns, notes, and for `accepted` the note and candidate; the resumable ones carry the phase they stopped at as `at` and an optional reason. `inspect.result` is the terminal one. |
| fold | `deriveWorkflow`: the derivation of notes and phase from the journal, matching each role call by its derived prompt bytes. It builds the projection and asks it which notes exist at a journal sequence, which are accepted, and for a note's closure. |
| projection | `Projection`: the fold's in-memory Cozo database of notes, summaries, support, and verdicts, rebuilt from the journal on every derivation and never persisted. It alone derives verified, dead, and accepted. |
| schema version | The declaration's version moves with every role prompt or journal shape change. The contract's version moves only with the contract or report shape. |
| contract | The output of `elenx-solve contract`: command, arguments, outcomes, and the execution report schema. |
| settings | One profile for the explorer, one for the coordinator, one per verifier, `maxExplorerTurns`, and `window`. |
| profile | A provider, model, and reasoning level. The source verifier's profile is either the Codex CLI on its native credential, provider `codex`, whose `search` decides whether the call has web search, true by default, or a Pi profile, and then the source verifier is one Pi call without web search; without search the call can confirm no external result. |
| run, inspect, export | The commands that start or resume a campaign, derive its phase and result, and emit the accepted note with its transitive support. |

The Lab's own terms, such as experiment, arm, replicate, attempt, and generation, live in the `elenx-lab` repository.

## Words not to use

These were collapsed into the terms above and must not return as names for those concepts: auditor and audit for a verifier, adversarial for a verifier, whose search is part of the correctness obligation, finding for a note, index and context for lists of notes, nominate, proposal, and answer for verifying a note, batch and queue for a verification and for what it leaves unverified, `ACCEPT` and `REJECT` for verdicts, candidate kind, solution, refutation, and refuted, repair for a new note, unfiled for a note without a summary, standing and trust for what a note's verdicts show, unverified, record for a verdict, state for the phase, agent for a call, resolve for meeting the completion criteria, mint for numbering notes, turn for a single call. Ordinary English elsewhere, such as review findings in the development loop or the untrusted-data labels in prompts, is not a system term.
