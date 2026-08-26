# Elenx design

Status: design for the `exploration-v15` solver. [`../SPEC.md`](../SPEC.md) defines kernel guarantees and [`../packages/solve/docs/protocol.md`](../packages/solve/docs/protocol.md) defines exact runtime behavior.

## Principle

The system performs two activities: exploration constructs mathematics and verification checks exact consequential artifacts. Models make mathematical judgments. The harness freezes information boundaries, preserves identity and recovery, and derives status from recorded results.

New machinery must improve externally adjudicated resolutions at equal spend or preserve results for less spend.

## Objects

V15 keeps two application objects:

- a note is untyped untrusted text inside an explorer submission
- a candidate is the exact standalone answer a reader would receive

The next objective and selected notes are submission fields. The exact handoff is a derived one-use projection. It has no separate lifecycle or truth standing.

The kernel owns append-only entries, exact calls and tool effects, immutable candidates, candidate-bound verdicts, recovery, and telemetry. The solver owns prompts, projections, scheduling, premise verification, and proof-audit policy.

## Loop

```text
fresh explorer
      |
      +-- incomplete --> exact selected handoff --> fresh review
      |                                          |
      +<-----------------------------------------+
      |
      +-- standalone answer --> immutable candidate
                                      |
                              offline premise audit
                                      |
                       isolated web check when unresolved
                                      |
                               exact proof audit
                               |               |
                            non-PASS          PASS
                               |               |
                         fresh explorer       solved
```

Every explorer starts from a fresh root and receives only the task plus the immediately preceding reviewed handoff or one rejected candidate with its latest defect, plus, under a configured archivist, a harness-preassembled packet of recalled archive notes. It has no retrieval or execution tools.

Every candidate repeats premise and proof gates. No note review or prior candidate verdict transfers into acceptance.

## Information boundaries

The handoff reviewer sees only the task and exact selected packet. The offline premise verifier sees only the task and exact candidate. The source checker sees only unresolved premise packets and owns the sole web capability. The proof verifier sees only the task, exact candidate, and verified source certificates.

Raw history remains inspectable but never becomes implicit model context.

## Recovery

State derives from the journal. Resume reconciles settled explorer submissions, archivist recalls, handoff reviews, candidates, source calls, and verdicts before dispatch. Provider failures may restart an unresolved phase. Mathematical repair always creates new bytes.

## Growth rule

V15 deliberately omits adaptive verification depth, parallel exploration, transcript reuse, reconstruction, and formal tools. Each remains an independent measured experiment. Note recall ships as a default-off archivist role that preassembles archived notes for the explorer; explorer-driven search stays omitted so reasoning calls never gain retrieval tools. Stopping stays minimal: the only frozen stopping rule is the default-off repair-depth ceiling, and richer stopping policy remains deferred. The kernel grows only when several applications need the same mechanical invariant.
