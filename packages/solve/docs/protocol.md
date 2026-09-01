# `exploration-v17` protocol

## Contract

V17 verifies knowledge as it accumulates. Fresh explorers reason and report raw findings; one curator files every finding into a durable indexed store and composes each explorer's context from it; one verification subsystem audits notes as they enter and confers acceptance at the boundary. The explorer has no submit path: completion is the curator's judgment against the store, and the campaign ends when the goal note passes the boundary battery. The Elenx kernel remains the only journal. The findings store is a projection of journal events, never a second source of truth.

Starting a campaign freezes:

- exact problem and completion criteria
- current call-surface stamp
- context, index, and explorer-turn ceilings
- resolved explorer guidance
- explorer, curator, triage, and verifier profiles
- isolated source-checker model and reasoning

Every Pi profile freezes provider, model ID, requested reasoning, API, and base URL. Resume recomputes the frozen settings and stops before dispatch when they differ.

## Findings store

The store materializes events folded from the journal: curator filings summarize findings, triage submissions record verification plans, and verifier calls record per-mode verdicts. It is rebuilt in memory from the journal on every start and resume and holds no independent authority. Note IDs are `n1`, `n2`, … in fold order, and each event carries the journal sequence that produced it, so the fold is deterministic and replay reproduces the store exactly.

A note's immutable identity contains the curator's short navigational `summary`, its proposition-only `statement` proposal, its reconstruction guide, the finding's exact `text`, and its resolved dependency IDs. The reconstruction guide contains high-level key ideas and external results that the finding actually invokes. It is separate from the proof text. The statement preserves the asserted hypotheses, quantifiers, parameters, side conditions, and conclusion. Proof steps, evidence, citations, and justification remain exclusively in the exact text. A truth-establishing verifier classifies the statement as `PROPOSITION_ONLY` or `CONTAINS_SUPPORT`; proof audit also classifies statement-to-text fidelity as `MATCH` or `MISMATCH`. Its structured schema rejects `PASS` without the required clean classifications. A change to any identity field mints another note. An exact repeat reuses its existing note mechanically. The curator cannot replace, merge, or drop findings. Prior-note `basedOn` references are restricted to non-report IDs in the explorer's current index, and `basedOnFindings` references point backward within the same turn. Full texts supplied only through the working set or boundary-failure context remain repair context rather than proof premises. The mechanical gates walk every preserved edge for ancestor closure and cycle detection.

Standing is derived, never stored. A `FAIL` from proof audit, reconstruction, or refutation refutes the note and removes it from the explorer's live index. An external-premises `FAIL` leaves a `conjecture`: it rejects the sourced derivation without claiming the mathematical statement is false. An empty valid plan marks a process `report`. A note becomes `verified` when every planned mode passes and the plan includes proof audit or reconstruction. External-premise verification may be a required supporting mode, but it does not establish truth on its own. Refutation-only or external-premises-only success leaves a `conjecture`. Verification is conditional on the note's dependency statements, which is why the boundary demands a fully verified ancestor closure. Everything else is a `conjecture`.

## Explorer turn

Every explorer is one fresh bounded call with one terminal tool and no retrieval access. It receives the task, guidance, the complete standing-annotated live index, the full texts chosen at serve time, and the transient objective when present. It reports findings — each self-contained free text with non-report `basedOn` IDs from the current index and earlier same-turn `basedOnFindings` positions — plus one optional next objective and optional note IDs to request expanded next turn. A dependency edge means the finding logically assumes the cited proposition instead of proving it in its own text. Provenance, inspiration, copied mathematics, expanded repair context, and material incorporated into a standalone proof are not dependencies. Boundary reconstruction failures identify whether the reconstruction guide leaked proof, the independent reconstruction left an obligation open, or the comparator found a mismatch. The next explorer repairs that recorded defect directly. Results, failed attempts, repairs, and open questions are all findings.

There is no submit path and no repair mode. A boundary failure returns to the explorer as ordinary served context and remains expandable afterward. Suppression follows the failed stage's exact inputs. Proof audit, source, refutation, and criteria failures remain suppressed when only the statement, summary, or reconstruction guide changes. Reconstruction certification or comparison may retry unchanged proof bytes only after its guide, direct premises, or strict transitive audit closure changes. The exact verdict and reason remain distinct journal evidence. Boundary proof-audit, reconstruction comparison, refutation, and external-premise failures revoke mathematical premise trust. Bundle-certification and criteria failures remain candidate-scoped because they can concern metadata rather than mathematical truth. Every failed battery also yields an immutable defect finding.

## Curation

The curator is one role with two call sites.

Ingest follows every turn. One fresh call receives the turn's findings and the live index. Its terminal tool writes one short summary, one proposition-only statement proposal, and one reconstruction guide for every finding. The full finding remains stored byte for byte. The guide contains high-level ideas and only the external results invoked by the finding. It contains no proof steps and no copied ancestor statements. A pure process finding receives a concise process-status statement and an empty guide when no mathematical reconstruction applies. Provider-visible field descriptions repeat these boundaries. The schema rejects skipped and repeated filings. The fold mints each new immutable note and reuses only an exact repeat. The curator holds no verification power: truth-establishing verdicts certify statement form, bundle certification checks the reconstruction interface, and standing comes from verification evidence.

Serve follows verification. One fresh call receives every note's summary, statement, standing, dependencies, current plan and verdict reasons, text size, closure status, failed-candidate tombstones, recent-note marker, recent serve history, and the previous explorer's hints. It never receives note text. Serve can compose a size-checked working set, request one append-only re-triage of a stuck conjecture, or declare a goal-eligible note whose statement states the requested conclusion with the exact parameters and direction. Bundle, reconstruction, and comparison failures remain distinct repair reports. Reports and failed proofs remain expandable as repair context but cannot become goal notes or proof premises through visibility alone. A completed non-`PASS` boundary attempt suppresses the same boundary input. A mechanical ancestor gap suppresses the unchanged goal until its premise standings change. Guidance shapes how the explorer reasons, serving shapes what it sees, and the boundary remains the completion authority.

## Verification

One subsystem, two call sites: conditional verification inside, unconditional authority at the boundary — same verifier, same modes, same verdict schema.

After every ingest, one fresh triage call chooses the smallest materially sufficient plan for each newly minted note, with a rationale per note. It receives the exact statement, text, and parent statements. Serve may request one later re-triage for a conjecture whose recorded reasons support a revised plan; the new plan and verdicts append to the journal and supersede the old plan without mutation. These checks judge the note's own claim, not campaign completion:

- `proof-audit` — classify statement form and fidelity, then audit the derivation with its `basedOn` statements given as premises; `PASS` requires `PROPOSITION_ONLY` and `MATCH`
- `reconstruction` — classify statement form and independently prove the note's statement from admissible premises and first principles without seeing its derivation; exact target restatements are removed mechanically, any premise already asserting the target is ignored even when paraphrased or bundled with extra claims, leaked proof material is absent, and `PASS` requires `PROPOSITION_ONLY`
- `refutation` — search for a counterexample to the statement; the audit for conjectures and dead-end reports
- `external-premises` — inventory the note's external premises and resolve them through the isolated source checker

An empty plan marks a process report. The loop executes each planned mode as its own fresh verifier call returning `PASS`, `FAIL`, or `INCONCLUSIVE` with a report. Triage and mode verdicts are journal events; the store derives standing from them.

The boundary battery runs when serve declares the goal. Triage has no discretion there. Proof audit sees the complete stored proof and certifies that the stored goal proposition matches the exact campaign target before `PASS`. Boundary reconstruction then runs as a certified subpipeline:

1. A fresh bundle certifier sees the exact proof, the complete proposed reconstruction input, and the verified transitive statement closure. It checks proof leakage, circular target claims, source relevance, and whether every direct premise is a logical premise actually used by the candidate. The transitive closure is audit-only.
2. A fresh blind reconstructor sees the exact campaign target, the curator's high-level guide, allowed external results, and only the goal note's direct `basedOn` statements. It receives neither the candidate proof nor transitive ancestor statements. It produces an end-to-end proof and reports which supplied direct premises it used. It gives no verdict.
3. A fresh comparator sees the reconstruction, the exact candidate proof, and the same certified bundle. It checks exact target coverage and undeclared theorem-class dependencies. Its assessment is the boundary `reconstruction` verdict.

Bundle certification, blind proof production, and comparison form one kernel-level `reconstruction` mode. Certification failure records that mode's rejection immediately. Certification success authorizes the blind call but does not create another required verdict; the comparator owns the successful `reconstruction` verdict. Its schema is bound to the exact reconstruction call. A whitespace-normalized check over the decoded guide, allowed sources, and direct premise statements refuses reconstruction even when the certifier mistakenly passes an exact copied proof. Different valid arguments may pass. The direct-premise interface preserves modular proof boundaries, while strict transitive ancestors remain audit-only circularity input. The external-premises mode runs before reconstruction, so source-backed inputs have already passed source verification.

Boundary verdicts are candidate-scoped because the campaign target may differ from the curator's stored proposition. A criteria-only mismatch rejects and suppresses the candidate without changing premise trust. Any non-criteria boundary doubt conservatively returns a locally verified goal note to `conjecture`, preventing it from serving as a verified ancestor without claiming its stored proposition is false. Three mechanical checks precede the battery: the declared goal note is not a process report, its transitive dependency closure is fully verified, and the dependency graph it closes over is acyclic. Every required verdict must pass before the campaign reaches `solved`. The verified tower is the result, and the goal-note bytes are the kernel candidate its acceptance verdicts bind to. A failed battery enters as a new immutable defect finding.

## External assembly

Assembly is not part of the protocol. `export` emits the goal note and its closure in dependency order — exact verified bytes. A reader-facing document is a view: any assembler the user supplies — a tool, another session, a human — unfolds the tower post hoc, re-runnable in any style, with an optional fidelity check for consumers who need document-level assurance. The kernel boundary already says it: publishing a verified candidate belongs to the application.

## Context

`maxContextTokens` bounds every structured model request; every check stops before dispatch and never truncates content. Serve's dynamic tool validation rejects a selected working set whose actual rendered explorer request would exceed the ceiling before the selection becomes a settled submission. An oversized phase outside that admission path returns terminal `context-limit`; resume re-derives it without dispatch. `maxIndexTokens` bounds the assembled live index and `maxExplorerTurns` bounds explorer turns. Their terminal reports are `index-limit` and `turn-limit`.

## Recovery

State is reconstructed from the append-only journal: settled tool submissions are refolded into the store, plan revisions, verdict reasons, standings, serve history, and candidate tombstones before the first unresolved phase dispatches. Terminal outcomes are `solved`, `context-limit`, `index-limit`, and `turn-limit`; `paused`, `interrupted`, and `call-failure` remain resumable session outcomes. Model-call mechanics — SSE, one required terminal tool, serial submission, length continuations, in-call recovery, capped phase backoff, deterministic prompt-cache keys, and two-stage interrupts — are unchanged from v16.

Prompt bytes for the explorer, curator, triage, and verifier are replay-determining. The campaign declaration records the current call-surface stamp, and parsing fail-stops before the fold when it disagrees or is absent. A golden file named by the stamp pins the exact structured Pi request and tool identities, source-check request, schema parsing fixtures, labels, transport parameters, cache keys, token estimates, and fold-authored defect and repair outputs. `bun run call-surface:update` creates a golden only for a new stamp and refuses to replace an existing file.

## Deliberately absent

No submit path, no candidate document, no repair mode: the store carries every failure forward as knowledge, and acceptance binds to the goal note over its verified closure. No lazy verification: every claim is audited at ingest; deferring audits to first use is deferred work (issue #32), gated on journal evidence that unused notes dominate audit spend. No retrieval tool and no standing taxonomy beyond the four derived standings. Each addition returns only after matched evaluation shows it improves externally accepted resolutions per dollar, per `docs/simplification.md`.

Campaigns created under another call surface require their matching solver revision.
