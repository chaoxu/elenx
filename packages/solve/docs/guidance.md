# Guidance

Status: shipped in `exploration-v14`, 2026-08-25. [`protocol.md`](protocol.md) defines runtime behavior.

Guidance is a frozen list of advisory prompt modules for an exploration role. A module has one origin:

- `default` modules ship with the solver implementation
- `user` modules come from `explorerGuidance` or `coordinatorGuidance`

Campaign start resolves both origins into explicit per-role lists and freezes their text and origin tags. Inspection exposes the exact lists. Resume recomputes them and fails before dispatch when they differ.

## Scope

Guidance may reach the explorer and coordinator. It never reaches admission auditors, premise audit, source fallback, terminal proof audit, template auditors, reconstruction, delivery assembly, or delivery audit.

Explorer guidance changes which mathematical moves the search attempts. Coordinator guidance changes which reported claims and routes enter future context. Both effects remain visible in the frozen campaign configuration.

Auditor guidance would change what a PASS means and confound the named method. Auditor instructions therefore belong to the frozen method itself rather than this mechanism.

## Mechanical limits

Guidance cannot alter:

- problem or completion criteria
- claim and route schemas
- required verifier labels
- verdict derivation
- liveness and dependency rules
- context ceiling
- delivery requirement
- tool access

Guidance text is not a claim, route, premise, or citable dependency. It never enters a support bundle.

## Context and comparisons

Guidance consumes the same `maxContextTokens` allowance as the rest of its structured request. A longer module directly reduces room for claims, routes, and the current decision packet.

Matched experiments require identical frozen guidance unless guidance is the declared axis. A default-text edit changes request bytes and comparability. Starting a fresh database is the safe boundary.

## Default modules

V13 adds one conditional-result reminder when memory is enabled. It asks explorers and coordinators to encode a conditional mathematical result as an exact implication containing every hypothesis. The protocol has no `ASSUMED` admission standing.

Every nonempty guidance list also receives one fixed reminder that strategy advice cannot change the goal or audit requirements.

## Evaluation

A guidance module is a policy hypothesis. Keep it only when matched known-solution campaigns show more externally accepted resolutions at equal spend or the same results at lower spend. Useful sources include expert proof-search practice and proof-guided analysis of failed known-solution transcripts.

Selected per-call modules, switching policies, and generated guidance remain separate future experiments. V13 freezes one resolved list per exploration role.
