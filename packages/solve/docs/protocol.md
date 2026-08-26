# `exploration-v15` protocol

## Contract

V15 explores through reviewed one-use handoffs and verifies one exact standalone candidate. The Elenx kernel remains the only journal. The solver adds no mutable database or hidden runtime state.

Starting a campaign freezes:

- exact problem and completion criteria
- context and handoff ceilings
- resolved explorer guidance
- explorer, handoff-verifier, premise-verifier, and proof-verifier profiles
- isolated source-checker model and reasoning

Every Pi profile freezes provider, model ID, requested reasoning, API, and base URL. The isolated Codex source checker freezes model and reasoning, while each call records its exact Codex version and source activity. Resume recomputes the frozen settings and stops before dispatch when they differ.

## Explorer turn

Every explorer is one fresh bounded call with one terminal tool. It receives the task and exactly one context:

- nothing on the initial turn
- the immediately preceding reviewed handoff
- one rejected candidate with its latest verifier defect

An incomplete turn returns notes, one next objective, and selected note positions with intended uses. Notes are untyped and untrusted. Unselected notes remain durable for inspection but never enter another model context.

A complete turn returns one standalone answer. The answer bytes become the candidate material without an envelope or second delivery artifact.

## Handoff review

The harness constructs one exact handoff from the next objective and selected note bytes. Note positions must be unique and belong to the same explorer submission. `maxHandoffTokens` applies before verifier dispatch.

One fresh verifier receives only the task and exact handoff. It returns `PASS`, `FAIL`, or `INCONCLUSIVE` with one report. The next explorer receives the handoff and assessment together. The assessment grants no permanent standing to a note.

## Candidate verification

Every candidate requires two frozen kernel verifier labels in order.

### Premise audit

The offline premise verifier receives only the task and exact candidate. It inventories the smallest external premises neither given by the task nor proved in the answer. It must bind every application to a contiguous candidate quote.

`REFUTED` and `MISAPPLIED` fail the candidate. `UNRESOLVED` premises trigger isolated source verification.

The source checker receives only exact premise statements, hypotheses, applications, candidate excerpts, and asserted citation metadata. It runs ephemeral Codex web search in a temporary read-only directory with workspace, shell, browser control, plugins, memory, and delegation disabled. Raw JSONL, queries, usage, stdout, and stderr remain inspectable.

Each unresolved premise must become `SOURCED`. An authoritative URL, locator, contiguous quote, statement and hypothesis match, application check, citation-metadata check, and refutation attempt are required. Every other result blocks acceptance.

The source call uses the premise verifier label so its merged result can supply the candidate-bound premise verdict.

### Proof audit

After premise PASS, one fresh proof verifier receives only the task, exact candidate, and verified source certificates. It checks correctness, completeness, self-containment, edge cases, citation use, and hidden campaign references.

The campaign reaches `solved` only when both required labels have candidate-bound PASS verdicts. `verified` remains a procedural gate result rather than a calibrated probability of mathematical truth.

## Repair

Failed candidates remain immutable. The next explorer receives the exact rejected candidate and one bounded defect. Premise failures expose only the statement plus its refutation, application defect, unresolved source gap, or citation-mismatch detail. Premise inventories, source-search reports and transcripts, nonblocking source fields, previous PASS prose, and exploration history remain excluded. A repair is another complete candidate and repeats both gates.

## Recovery

State is reconstructed from the append-only journal. Resume reconciles settled tool submissions, candidates, source calls, and verdicts before dispatching the first unresolved phase.

Each model call uses SSE, one required terminal tool, serial tool submission, eight output-length continuations, and one separate in-call provider recovery. Provider-retryable phase failures restart from journal state with capped exponential backoff. Deterministic failures stop immediately.

Each Pi request freezes a deterministic prompt-cache key derived from the task, role, and profile. Pi keeps a separate random transport session per logical call, so cross-turn cache routing does not share recovery or transport state.

The first interrupt pauses after the active turn settles. The second aborts the provider operation.

## Context

`maxContextTokens` bounds every structured model request. `maxHandoffTokens` separately bounds the exact cross-explorer packet. Both checks stop before dispatch and never truncate content.

## Inspection and export

Inspection exposes explorer submissions, all stored notes, reviewed handoffs, candidate bytes, candidate status, model calls, source activity, concurrency, and measured provider spend. Exact requests and raw source output require `--include-inputs`.

Export requires one solved candidate and writes its immutable bytes without decoration or an added newline.

V12, v13, and v14 databases require their matching solver releases. V15 does not replay their workflow.
