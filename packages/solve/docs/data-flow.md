# Model data-flow contract

Status: `exploration-v17` authority for information passed into fresh calls.

The journal retains more information than any model role may see. Every prompt uses an allowlisted projection. Replay and inspection access do not imply prompt visibility. The campaign declaration records the call-surface stamp so incompatible prompts fail before folding journal state.

## Explorer

Receives:

- exact task and explorer guidance
- the complete standing-annotated live index: every non-refuted note's ID, standing, and summary
- `basedOn` authority for the non-report entries of that index only
- the served working set: full texts explicitly selected by the curator within the frozen context budget
- the transient objective, when the previous serve stated one
- after a failed boundary battery, the goal note's text and the failing verdicts
- no earlier context on the first turn
- one terminal submission tool

Excluded:

- raw prior transcripts
- refuted notes outside an explicitly served repair context, and full texts outside the working set
- working-set-only and failure-context-only note IDs as proof premises
- triage plans and local verdict reports outside explicit failure or re-triage context
- retrieval tools of any kind
- filesystem, shell, web, browser control, memory, plugins, and delegation

`basedOn` and `basedOnFindings` encode logical premises only. Reading, copying, repairing, or independently re-establishing mathematics from an expanded note does not create an edge. A standalone finding with every load-bearing argument in its exact text uses empty dependency arrays.

## Curator ingest

Receives:

- exact task
- the turn's findings: exact bytes, numbered, with prior-note `basedOn` references and backward `basedOnFindings` references
- the standing-annotated live index
- one terminal filing tool

Writes into each immutable note:

- one short navigational summary
- one proposition-only statement proposal
- one reconstruction guide containing high-level key ideas and only the external results invoked by the finding
- the explorer's exact finding text and resolved direct dependencies, which the fold preserves rather than asking the curator to rewrite

Excluded:

- existing note full texts
- triage plans and verdicts
- raw prior transcripts
- any invalidation or verification power
- replacement, merge, semantic-deduplication, or drop authority
- proof rewriting and dependency selection
- web and execution capabilities

## Curator serve

Receives:

- exact task and completion criteria
- every note's navigational summary and proposition-only statement proposal
- dependency IDs, local standing, current plan, exact verdict reasons, and verified-closure status
- note token sizes, recent-note markers, failed-candidate tombstones, and recent serve history
- the completed explorer-turn count
- the previous explorer's expansion requests and next objective, as hints
- one terminal serving tool

Serve uses precise statements and verification metadata to identify a note that purports to establish the requested conclusion. It may also select a size-checked working set or request one re-triage of a stuck conjecture. Definitions, derivations, citations, and other proof-content criteria belong to the boundary battery over the exact stored note text.

Excluded:

- note full texts; they are resolved only after an expansion passes deterministic admission
- triage rationales
- raw prior transcripts
- web and execution capabilities

## Triage

Receives:

- exact task and completion criteria
- each batch note's exact statement, text, and ID
- each batch note's `basedOn` IDs with their certified statements
- on re-triage, the prior mode verdicts and exact reasons
- one terminal planning tool

Excluded:

- notes outside the batch beyond the cited summaries
- unrelated verdict history and prior plans
- raw prior transcripts
- web and execution capabilities

## Mode verifier

Local modes receive the problem as context and one terminal assessment tool. They do not receive the campaign completion criteria and judge only the note's own claim. Boundary modes receive the exact task and completion criteria. Each mode then receives exactly its material:

- `proof-audit` — locally, the note's exact text and statement, with its `basedOn` statements given as premises; structured output certifies proposition-only form and statement-to-text fidelity before `PASS`; at the boundary, it certifies that the stored goal proposition matches the exact campaign target
- `reconstruction` (local) — the note's proposition and admissible direct premise propositions only, never its derivation; exact target restatements are removed mechanically, every premise already asserting the target and all improperly embedded proof material are ignored, and structured output certifies proposition-only form before `PASS`
- `refutation` — the note's exact statement and text, with its `basedOn` statements given as premises
- `criteria-match` (boundary only) — the exact campaign problem, goal text, and completion criteria, with its `basedOn` statements given as premises
- `external-premises` — the note's exact text for premise inventory, with its `basedOn` statements given as established premises; unresolved premises go to the source checker

Excluded from every mode:

- other notes' texts beyond the given premise statements
- prior verdicts, plans, and rationales
- raw prior transcripts
- web and execution capabilities

## Boundary reconstruction

The boundary expands `reconstruction` into three fresh calls.

The bundle certifier receives:

- the exact campaign target and candidate proof
- every byte proposed for blind reconstruction: high-level key ideas, allowed external results, and direct `basedOn` statements
- the transitive ancestor statements as audit-only circularity context
- one terminal bundle-certification tool

The blind reconstructor receives:

- the exact campaign target
- certified high-level key ideas and allowed external results
- only the goal note's certified direct `basedOn` statements
- one terminal reconstruction tool that returns a proof and used direct-premise IDs, never a verdict

The comparator receives:

- the exact target and candidate proof
- the same certified reconstruction bundle
- the exact reconstruction artifact and its bound call ID
- one terminal comparison tool whose assessment becomes the candidate's `reconstruction` verdict

The blind reconstructor receives no candidate text, transitive ancestor statement, ancestor proof, completion criteria, prior verdict, or campaign history. The fold checks the decoded guide, allowed sources, and direct premise statements for the whitespace-normalized whole candidate before dispatch. Strict transitive ancestors remain available to the certifier as audit-only statements without widening the reconstruction interface. External-premise verification precedes this subpipeline.

## Source checker

Receives:

- exact unresolved premise statements and hypotheses
- concise inventory descriptions of their applications
- the exact note excerpt applying them
- asserted citation metadata
- web search and one structured output schema

Excluded:

- the store, the index, and every note outside the supplied excerpts
- verdict history
- workspace, filesystem, shell, browser control, memory, plugins, and delegation

## Tests

Behavior tests drive scripted campaigns through the real loop and assert prompt bytes, immutable note identity, statement-to-text fidelity, same-turn dependency resolution, direct-only reconstruction bundles, transitive audit visibility, bundle short-circuiting, whole-candidate leak refusal, reconstruction-call binding, re-triage, truth-establishing standing, index-scoped premise eligibility, local-to-boundary authority, failed-goal expansion, context admission, and terminal turn limits. Blind reconstruction withholds proof text while proof audit, bundle certification, comparison, and criteria matching receive their declared views. Exact verdict reasons reach serve and re-triage as untrusted control data; triage rationales remain fold-only.

Inspection exposes exact requests only under `--include-inputs`. No runtime role can request raw journal history.
