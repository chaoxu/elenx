# V17 simplification record

V17 replaces its predecessor rather than adapting it.

## Kept

- append-only campaign journal as the single source of truth
- exact calls, tool effects, provider checkpoints, and telemetry
- immutable candidate bytes and fresh candidate-bound verdicts
- replay, pause, recovery, inspection, and exact export
- explorer and adversarial verifier separation
- isolated external source verification
- predispatch context ceilings

## Removed

- the explorer submit path and the candidate document it produced
- handoffs and the handoff review gate
- the archivist and recall packets
- repair mode and repair depth
- curator invalidation power
- per-gate verifier roles and their separate tools
- the replay-release ladder for earlier protocols

## Replacement

Explorers report findings; one curator files them into a durable indexed store and serves each turn's context from it. One verification subsystem audits every note as it enters — triage plans from a frozen mode menu, mode verdicts derive standing — and confers acceptance at the boundary when the curator declares the goal note. The verified tower is the result; assembly into a document is external tooling over `export`.

Removed machinery returns only after matched evaluation shows that it improves externally accepted resolutions per dollar. Lazy verification is the first queued candidate, gated on journal evidence that never-used notes dominate audit spend.
