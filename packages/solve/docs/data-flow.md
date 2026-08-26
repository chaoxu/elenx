# Model data-flow contract

Status: `exploration-v15` authority for information passed into fresh calls.

The journal retains more information than any model role may see. Every prompt uses an allowlisted projection. Replay and inspection access do not imply prompt visibility.

## Explorer

Receives:

- exact task and explorer guidance
- no earlier context on the first turn
- one exact handoff and its assessment after an incomplete turn
- one exact rejected candidate and one harness-bounded defect after candidate failure
- one terminal submission tool

Excluded:

- raw prior transcripts
- unselected or older notes
- source-search reports, transcripts, and nonblocking fields
- complete premise inventories
- previous PASS verdicts
- filesystem, shell, web, browser control, memory, plugins, and delegation

## Handoff verifier

Receives:

- exact task
- one exact handoff containing next objective, selected note bytes, and intended uses
- one terminal assessment tool

Excluded:

- unselected notes
- prior transcripts and handoffs
- candidates and candidate verdicts
- web and execution capabilities

## Offline premise verifier

Receives:

- exact task
- exact standalone candidate
- one terminal premise-inventory tool

Excluded:

- every note and handoff
- previous candidate or verifier history
- web and execution capabilities

## Source checker

Receives:

- exact unresolved premise statements and hypotheses
- concise premise-verifier descriptions of their candidate applications
- exact candidate excerpts applying them
- asserted citation metadata
- web search and one structured output schema

Excluded:

- complete candidate text outside the supplied excerpts
- notes, handoffs, and verifier history
- workspace, filesystem, shell, browser control, memory, plugins, and delegation

## Proof verifier

Receives:

- exact task
- exact candidate
- verified external source certificates
- one terminal assessment tool

Excluded:

- notes and handoffs
- rejected candidates
- premise-verifier reports
- source-search reasoning and unrelated discoveries
- every previous verdict

## Tests

Projection tests use unique sentinels for selected and unselected notes, handoff reports, candidate text, premise reports, source packets, and proof reports. Every test asserts that required sentinels appear and forbidden sentinels do not.

Inspection exposes exact requests only under `--include-inputs`. No runtime role can request raw journal history.
