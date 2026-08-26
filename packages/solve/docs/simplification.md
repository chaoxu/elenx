# V15 simplification record

V15 replaces v14 rather than adapting it.

## Kept

- append-only campaign journal
- exact calls, tool effects, provider checkpoints, and telemetry
- immutable candidate bytes
- fresh candidate-bound verdicts
- replay, pause, recovery, inspection, and exact export
- explorer and adversarial verifier separation
- isolated external source verification
- predispatch context ceilings

## Removed

- coordinator role
- claims, routes, and dependency graphs
- memory-policy variants
- admission audits and stamps
- modular resolution and `newArgument`
- delivery assembly and second candidate
- reconstruction and comparison gates
- template auditors
- note search and retrieval
- adaptive verification scheduler
- candidate envelopes and compatibility aliases

## Replacement

Explorers store untyped notes and select one bounded handoff. The whole handoff is reviewed before crossing into another explorer call. A standalone answer becomes the candidate bytes and receives offline premise verification, isolated source checking when required, and one exact proof audit.

Future features return only after matched evaluation shows that they improve externally accepted candidates per dollar.
