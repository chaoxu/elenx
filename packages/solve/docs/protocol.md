# `exploration-v17` protocol

## Contract

V17 verifies knowledge as it accumulates. Fresh explorers reason and report raw findings; one curator files every finding into a durable indexed store and composes each explorer's context from it; one verification subsystem audits notes as they enter and confers acceptance at the boundary. The explorer has no submit path: completion is the curator's judgment against the store, and the campaign ends when the goal note passes the boundary battery. The Elenx kernel remains the only journal. The findings store is a projection of journal events, never a second source of truth.

Starting a campaign freezes:

- exact problem and completion criteria
- current call-surface stamp
- context and index ceilings
- resolved explorer guidance
- explorer, curator, triage, and verifier profiles
- isolated source-checker model and reasoning

Every Pi profile freezes provider, model ID, requested reasoning, API, and base URL. Resume recomputes the frozen settings and stops before dispatch when they differ.

## Findings store

The store materializes events folded from the journal: curator filings summarize findings, triage submissions record verification plans, and verifier calls record per-mode verdicts. It is rebuilt in memory from the journal on every start and resume and holds no independent authority. Note IDs are `n1`, `n2`, … in fold order, and each event carries the journal sequence that produced it, so the fold is deterministic and replay reproduces the store exactly.

A note is one immutable triple: the curator's `summary`, the finding's exact `text`, and its resolved dependency IDs. A different summary, text, or dependency set mints another note. An exact repeated triple reuses its existing note mechanically. The curator cannot replace, merge, or drop findings. Dependency edges come from the explorer's `basedOn` note IDs and backward `basedOnFindings` references within the same turn. The fold rejects unknown or forward references. The mechanical gates walk the preserved edges for ancestor closure and cycle detection, including edges to refuted notes.

Standing is derived, never stored. Any valid `FAIL` refutes the note and removes it from the explorer's live index. An empty valid plan marks a process `report`. A note becomes `verified` when every planned mode passes and the plan includes a truth-establishing mode: proof audit, reconstruction, or external-premise verification. Refutation-only success leaves a `conjecture`. Verification is conditional on the note's dependency statements, which is why the boundary demands a fully verified ancestor closure. Everything else is a `conjecture`.

## Explorer turn

Every explorer is one fresh bounded call with one terminal tool and no retrieval access. It receives the task, guidance, the complete standing-annotated live index, and the working set: the previous curation's fresh notes, the full texts chosen at serve time, and the transient objective when present. It reports findings — each self-contained free text with prior note IDs and earlier same-turn finding positions it builds on — plus one optional next objective and optional note IDs to request expanded next turn. Results, failed attempts, repairs, and open questions are all findings.

There is no submit path and no repair mode. A boundary failure returns to the explorer as ordinary served context: a `FAIL` verdict removes the goal note from the index, and the failure finding stands in its place either way.

## Curation

The curator is one role with two call sites.

Ingest follows every turn. One fresh call receives the turn's findings and the live index, and its terminal tool writes one summary for every finding. The schema rejects skipped, repeated, replacement, and semantic-duplicate filings. The fold mints each new immutable note and reuses only an exact repeated triple. The curator holds no verification power: standing comes from triage plans and verifier verdicts alone.

Serve follows verification. One fresh call receives the criteria, the completed-turn count, the previous turn's requests, and every mathematical note that has not already undergone boundary verification. Local standing remains visible, including `refuted`, because local verification cannot veto a possible goal. Serve either composes the next working set or declares a note whose summary states the requested conclusion with the exact parameters and direction. It declares such a note immediately; the boundary battery checks proof content against the exact stored text. A completed boundary attempt removes that exact note from later serve calls, so an unchanged failed or inconclusive goal cannot loop. A mechanical ancestor gap also suppresses the unchanged goal until its premise standings change. Guidance shapes how the explorer reasons, serving shapes what it sees, and the boundary remains the completion authority.

## Verification

One subsystem, two call sites: conditional verification inside, unconditional authority at the boundary — same verifier, same modes, same verdict schema.

After every ingest, one fresh triage call plans each newly minted note from the frozen menu, with a rationale per note. These checks judge the note's own claim, not campaign completion:

- `proof-audit` — audit the note's own derivation as it stands, its `basedOn` statements given as premises
- `reconstruction` — independently prove the note's statement from its premises and first principles without seeing its derivation; an empty premise list still requires a proof attempt
- `refutation` — search for a counterexample to the statement; the audit for conjectures and dead-end reports
- `external-premises` — inventory the note's external premises and resolve them through the isolated source checker

An empty plan marks a process report. The loop executes each planned mode as its own fresh verifier call returning `PASS`, `FAIL`, or `INCONCLUSIVE` with a report. Triage and mode verdicts are journal events; the store derives standing from them.

The boundary battery runs when serve declares the goal. Triage has no discretion there: every mode runs against the exact problem statement, the exact goal text where the mode permits it, and the verified premise statements. The boundary-only `criteria-match` checks every completion criterion against the stored proof. Three mechanical checks precede the battery: the declared goal note is not a process report, its transitive dependency closure is fully verified, and the dependency graph it closes over is acyclic. All verdicts `PASS` → `solved`, terminal. The verified tower is the result, and the goal-note bytes are the kernel candidate its acceptance verdicts bind to. A failed battery enters as a new immutable defect finding; a revised proof must arrive as a new integrated note.

## External assembly

Assembly is not part of the protocol. `export` emits the goal note and its closure in dependency order — exact verified bytes. A reader-facing document is a view: any assembler the user supplies — a tool, another session, a human — unfolds the tower post hoc, re-runnable in any style, with an optional fidelity check for consumers who need document-level assurance. The kernel boundary already says it: publishing a verified candidate belongs to the application.

## Context

`maxContextTokens` bounds every structured model request; every check stops before dispatch and never truncates content. `maxIndexTokens` bounds the assembled live index: the loop reports the estimate in each exploration status line and, when it exceeds the ceiling, ends the campaign with the terminal report `index-limit`. The assumption that the whole index fits is deliberate; index shedding, retrieval, and summarization are deferred until a real campaign trips the wire.

## Recovery

State is reconstructed from the append-only journal: settled tool submissions are refolded into the store, plans, verdicts, and standings before the first unresolved phase dispatches. Terminal outcomes are `solved`, `paused`, `interrupted`, `call-failure`, and `index-limit`. Model-call mechanics — SSE, one required terminal tool, serial submission, length continuations, in-call recovery, capped phase backoff, deterministic prompt-cache keys, and two-stage interrupts — are unchanged from v16.

Prompt bytes for the explorer, curator, triage, and verifier are replay-determining. The campaign declaration records the current call-surface stamp, and parsing fail-stops before the fold when it disagrees or is absent. Update the stamp whenever replay-determining bytes change.

## Deliberately absent

No submit path, no candidate document, no repair mode: the store carries every failure forward as knowledge, and acceptance binds to the goal note over its verified closure. No lazy verification: every claim is audited at ingest; deferring audits to first use is deferred work (issue #32), gated on journal evidence that unused notes dominate audit spend. No retrieval tool and no standing taxonomy beyond the four derived standings. Each addition returns only after matched evaluation shows it improves externally accepted resolutions per dollar, per `docs/simplification.md`.

Campaigns created under another call surface require their matching solver revision.
