# Model data-flow contract

Status: `exploration-v17` authority for information passed into fresh calls.

The journal retains more information than any model role may see. Every prompt uses an allowlisted projection. Replay and inspection access do not imply prompt visibility.

## Explorer

Receives:

- exact task and explorer guidance
- the complete standing-annotated live index: every non-refuted note's ID, standing, and summary
- the served working set: full texts of the notes the curator expanded, plus the previous curation's live mints and refinements
- the transient objective, when the previous serve stated one
- after a failed boundary battery, the goal note's text and the failing verdicts
- no earlier context on the first turn
- one terminal submission tool

Excluded:

- raw prior transcripts
- note versions, refuted notes, and full texts outside the working set
- triage plans, rationales, and verdict reports outside failure context
- retrieval tools of any kind
- filesystem, shell, web, browser control, memory, plugins, and delegation

## Curator ingest

Receives:

- exact task
- the turn's findings: exact bytes, numbered, with their `basedOn` references
- the standing-annotated live index
- one terminal filing tool

Excluded:

- note full texts and versions
- triage plans and verdicts
- raw prior transcripts
- any invalidation or verification power
- web and execution capabilities

## Curator serve

Receives:

- exact task and completion criteria
- the standing-annotated live index
- the previous explorer's expansion requests and next objective, as hints
- one terminal serving tool

Excluded:

- note full texts
- verdict reports and triage rationales
- raw prior transcripts
- web and execution capabilities

## Triage

Receives:

- exact task and completion criteria
- each batch note's exact text and ID
- each batch note's `basedOn` IDs with their summaries
- one terminal planning tool

Excluded:

- notes outside the batch beyond the cited summaries
- verdict history and prior plans
- raw prior transcripts
- web and execution capabilities

## Mode verifier

Every mode receives the exact task and one terminal assessment tool, then exactly its mode's material:

- `proof-audit` — the note's exact text and statement, with its `basedOn` statements given as premises
- `reconstruction` — the note's statement and its premise statements only, never its derivation
- `refutation` — the note's exact statement and text
- `criteria-match` (boundary only) — the goal note's statement and the completion criteria
- `external-premises` — the note's exact text for premise inventory; unresolved premises go to the source checker

Excluded from every mode:

- other notes' texts beyond the given premise statements
- prior verdicts, plans, and rationales
- raw prior transcripts
- web and execution capabilities

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

Projection tests use unique sentinels for index entries, working-set texts, findings, plans, and verdict reports. Every test asserts that required sentinels appear and forbidden sentinels do not.

Inspection exposes exact requests only under `--include-inputs`. No runtime role can request raw journal history.
