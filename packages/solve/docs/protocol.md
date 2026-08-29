# `exploration-v17` protocol (draft)

## Contract

V17 verifies knowledge as it accumulates. Fresh explorers reason and report raw findings; one curator files every finding into a durable indexed store and composes each explorer's context from it; one verification subsystem audits notes as they enter and confers acceptance at the boundary. The explorer has no submit path: completion is the curator's judgment against the store, and the campaign ends when the goal note passes the boundary battery. The Elenx kernel remains the only journal. The findings store is a projection of journal events, never a second source of truth.

Starting a campaign freezes:

- exact problem and completion criteria
- context and index ceilings
- resolved explorer guidance
- explorer, curator, triage, and verifier profiles
- isolated source-checker model and reasoning

Every Pi profile freezes provider, model ID, requested reasoning, API, and base URL. Resume recomputes the frozen settings and stops before dispatch when they differ.

## Findings store

The store materializes events folded from the journal: curator filings mint notes and record refinements, triage submissions record verification plans, and verifier calls record per-mode verdicts. It is rebuilt in memory from the journal on every start and resume; deleting it loses nothing. Note IDs are `n1`, `n2`, … in fold order, and each event carries the journal sequence that produced it, so the fold is deterministic and replay reproduces the store exactly.

A note holds one finding: `summary` is the index entry, and `text` is the finding's exact reported bytes — the curator writes summaries but never rewrites findings. A refinement appends a new version; the current view serves the latest and the journal retains every version. Dependency edges come from the findings' own `basedOn` references, never from curator judgment. Datalog carries the graph work behind the mechanical gates: ancestor closure and cycle detection.

Standing is derived, never stored. A plan and its verdicts apply to the note version they were issued against; a revision stales them and the note returns to `conjecture` until re-triaged. Any valid `FAIL` refutes the note and removes it from the live index; an empty valid plan marks a process `report`; a valid plan whose every mode holds a valid `PASS` marks the note `verified` — conditionally on its `basedOn` statements, which is why the boundary demands a fully verified ancestor closure. Everything else is a `conjecture`.

## Explorer turn

Every explorer is one fresh bounded call with one terminal tool and no retrieval access. It receives the task, guidance, the complete standing-annotated live index, and the working set the curator served: full texts chosen at serve time, plus the transient objective when present. It reports findings — each self-contained free text with the note IDs it builds on — plus one optional next objective and optional note IDs to request expanded next turn. Results, failed attempts, and open questions are all findings.

There is no submit path and no repair mode. A boundary failure returns to the explorer as ordinary served context: a `FAIL` verdict removes the goal note from the index, and the failure finding stands in its place either way.

## Curation

The curator is one role with two call sites.

Ingest follows every turn. One fresh call receives the turn's findings and the live index, and its terminal tool files every finding exactly once: minted as a new note with a curator-written summary, recorded as a refinement of the single existing note it sharpens, or dropped as a duplicate. Nothing is silently lost — a submission that skips or double-files a finding is rejected by schema. The curator holds no verification power: standing comes from triage plans and verifier verdicts alone.

Serve follows verification. One fresh call receives the criteria, the standing-annotated index, and the previous turn's requests, then either composes the next explorer's working set — expansions and an optional objective — or points at the goal note whose statement meets the completion criteria. Declaring the goal excludes serving; the boundary battery decides what happens next. Serving defaults to judgment over the whole live index; guidance shapes how the explorer reasons, serving shapes what it sees.

## Verification

One subsystem, two call sites: conditional verification inside, unconditional authority at the boundary — same verifier, same modes, same verdict schema.

After every ingest, one fresh triage call plans each newly minted or revised note from the frozen menu, with a rationale per note:

- `proof-audit` — audit the note's own derivation as it stands, its `basedOn` statements given as premises
- `reconstruction` — re-derive the note's statement from its premises without seeing its derivation, and compare conclusions
- `refutation` — search for a counterexample to the statement; the audit for conjectures and dead-end reports
- `external-premises` — inventory the note's external premises and resolve them through the isolated source checker

An empty plan marks a process report. The loop executes each planned mode as its own fresh verifier call returning `PASS`, `FAIL`, or `INCONCLUSIVE` with a report. Triage and mode verdicts are journal events; the store derives standing from them.

The boundary battery runs when serve declares the goal. Triage has no discretion there: every mode runs, plus the boundary-only `criteria-match` — does the goal note's statement answer the exact completion criteria. Three mechanical checks precede the battery: the declared goal note is not a process report, its transitive `basedOn` closure is fully verified, and the dependency graph it closes over is acyclic. All verdicts `PASS` → `solved`, terminal. The verified tower is the result, and the goal note's bytes are the kernel candidate its acceptance verdicts bind to. Any failure is a verdict event that re-enters through ingest like every other finding.

## External assembly

Assembly is not part of the protocol. `export` emits the goal note and its closure in dependency order — exact verified bytes. A reader-facing document is a view: any assembler the user supplies — a tool, another session, a human — unfolds the tower post hoc, re-runnable in any style, with an optional fidelity check for consumers who need document-level assurance. The kernel boundary already says it: publishing a verified candidate belongs to the application.

## Context

`maxContextTokens` bounds every structured model request; every check stops before dispatch and never truncates content. `maxIndexTokens` bounds the assembled live index: the loop reports the estimate in each exploration status line and, when it exceeds the ceiling, ends the campaign with the terminal report `index-limit`. The assumption that the whole index fits is deliberate; index shedding, retrieval, and summarization are deferred until a real campaign trips the wire.

## Recovery

State is reconstructed from the append-only journal: settled tool submissions are refolded into the store, plans, verdicts, and standings before the first unresolved phase dispatches. Terminal outcomes are `solved`, `paused`, `interrupted`, `call-failure`, and `index-limit`. Model-call mechanics — SSE, one required terminal tool, serial submission, length continuations, in-call recovery, capped phase backoff, deterministic prompt-cache keys, and two-stage interrupts — are unchanged from v16.

Prompt bytes for the explorer, curator, triage, and verifier are frozen per protocol: any change to them breaks replay of existing v17 journals and requires a protocol bump.

## Deliberately absent

No submit path, no candidate document, no repair mode: the store carries every failure forward as knowledge, and acceptance binds to the goal note over its verified closure. No lazy verification: every claim is audited at ingest; deferring audits to first use is deferred work (issue #32), gated on journal evidence that unused notes dominate audit spend. No retrieval tool and no standing taxonomy beyond the four derived standings. Each addition returns only after matched evaluation shows it improves externally accepted resolutions per dollar, per `docs/simplification.md`.

V12–v16 databases require their matching solver releases. V17 does not replay their workflows.
