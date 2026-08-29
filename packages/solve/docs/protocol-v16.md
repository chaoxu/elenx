# `exploration-v16` protocol (draft)

## Contract

V16 separates reasoning from curation. Fresh explorers reason and report raw findings; a thin curator files every finding into a durable indexed store and composes each explorer's context from it; unchanged candidate gates verify one exact standalone answer. The Elenx kernel remains the only journal. The findings store is a projection of journal events, never a second source of truth.

Starting a campaign freezes:

- exact problem and completion criteria
- context and index ceilings
- resolved explorer guidance
- explorer, curator, premise-verifier, and proof-verifier profiles
- isolated source-checker model and reasoning

Every Pi profile freezes provider, model ID, requested reasoning, API, and base URL. Resume recomputes the frozen settings and stops before dispatch when they differ.

## Findings store

The store materializes note events folded from the journal: curator filings mint notes, record refinements, and record invalidations. It is rebuilt in memory from the journal on every start and resume; deleting it loses nothing. Note IDs are `n1`, `n2`, … in fold order, and each event carries the journal sequence that produced it, so the fold is deterministic and replay reproduces the store exactly.

A note holds one finding: `summary` is the index entry, and `text` is the finding's exact reported bytes — the curator writes summaries but never rewrites findings. A refinement appends a new version; the current view serves the latest and history retains every version. Positive results, failed attempts, and open questions are all findings; the store has no type or status field.

A note is invalidated when an invalidation event names it. Invalidation events enter only through curator ingestion of a verifier defect, and each quotes its verdict as cause. Invalidated notes leave the live index but remain durable with their history.

## Explorer turn

Every explorer is one fresh bounded call with one terminal tool and no retrieval access. It receives the task, guidance, the complete live index — every non-invalidated note's ID and summary — and a bounded working set of full texts: the notes minted or refined on the previous turn, plus any notes the previous turn asked to expand. After a rejection it also receives the exact rejected candidate and its latest verifier defect. The previous turn's transient objective, when present, is passed through verbatim.

An incomplete turn reports findings — each self-contained free text with the note IDs it builds on — plus one optional next objective and optional note IDs to expand next turn. The explorer never authors index entries and never selects what survives.

A complete turn returns one standalone answer with the note IDs it rests on. The answer bytes become the candidate material without an envelope or second delivery artifact.

The terminal tool schema is one flat object with an action discriminant, so strict tool-schema modes that forbid a root `oneOf` accept it unchanged.

## Curation

One fresh curator call follows every incomplete turn. It receives the turn's findings and the live index. Its single terminal tool files every finding exactly once: minted as a new note with a curator-written summary, recorded as a refinement of an existing note, or dropped as a duplicate of one. Nothing is silently lost — a submission that skips or double-files a finding is rejected by schema. Dependency edges come from the findings' own `basedOn` references, never from curator judgment.

After a candidate rejection, the curator ingests the defect the same way: the loop presents the defect as a finding to file, and the curator may additionally record invalidations, each quoting the verdict. This is the only invalidation path; explorers can at most report a finding that disputes a note.

The curator composes but does not judge. Serving defaults to the whole live index; a serve-side filter is the second behavior lever beside guidance — guidance shapes how the explorer reasons, filtering shapes what it sees. Named filter policies are deferred until matched evidence selects one; v16 ships show-all only.

## Candidate verification

Unchanged from v15. The offline premise audit inventories external premises with contiguous candidate quotes; `REFUTED` and `MISAPPLIED` fail the candidate; `UNRESOLVED` premises trigger the isolated ephemeral Codex web search, which must return `SOURCED` certificates. After premise PASS, one fresh proof verifier checks the exact candidate with its verified source certificates. The campaign reaches `solved` only when both candidate-bound labels PASS. Failed candidates remain immutable; the defect flows back through curation, and the next explorer sees the rejected answer, the latest defect, and the updated index. There is no repair-depth ceiling: lines are not tracked, and external drivers own budgets.

## Context

`maxContextTokens` bounds every structured model request; every check stops before dispatch and never truncates content. `maxIndexTokens` bounds the assembled live index: the loop reports the estimate in each exploration status line and, when it exceeds the ceiling, ends the campaign with the terminal report `index-limit`. The assumption that the whole index fits is deliberate; index shedding, retrieval, and summarization are deferred until a real campaign trips the wire.

## Recovery

State is reconstructed from the append-only journal: settled tool submissions are refolded into the store, candidates, and verdicts before the first unresolved phase dispatches. Terminal outcomes are `solved`, `paused`, `interrupted`, `call-failure`, and `index-limit`. Model-call mechanics — SSE, one required terminal tool, serial submission, length continuations, in-call recovery, capped phase backoff, deterministic prompt-cache keys, and two-stage interrupts — are unchanged from v15.

Prompt bytes for the explorer and curator are frozen per protocol: any change to them breaks replay of existing v16 journals and requires a protocol bump.

## Deliberately absent

No handoff, handoff verifier, or archivist: the store replaces the one-hop packet and the whole-archive recall, so cross-turn knowledge neither expires after one hop nor grows into any model context unboundedly. No note types, statuses, routes, claims, or dependency graph beyond `basedOn` edges. No retrieval tool, no serve-side policies, no note verification outside the candidate gates: notes are untrusted scaffolding, and the standalone candidate audit remains the soundness backstop. Each returns only after matched evaluation shows it improves externally accepted candidates per dollar, per `docs/simplification.md`.

V12–v15 databases require their matching solver releases. V16 does not replay their workflows.
