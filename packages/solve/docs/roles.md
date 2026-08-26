# Role boundaries

Status: rationale for `exploration-v15`. [`protocol.md`](protocol.md) is normative and [`data-flow.md`](data-flow.md) defines exact projections.

V15 has two mathematical personas and one isolated capability boundary.

## Explorer

The explorer constructs mathematics. It stores notes, selects an exact handoff, states the next objective, or submits one standalone candidate. Its output has no truth authority.

Every explorer starts from a fresh root. It receives no web, filesystem, shell, browser control, memory, plugin, or delegation tools.

## Verifier

The verifier adversarially checks fixed bytes. Three modes use separate frozen profiles and projections:

- handoff review checks the exact packet crossing between explorers
- premise audit identifies unsupported external premises in one candidate
- proof audit checks the exact reader-facing candidate after premise resolution

Mode names describe inputs and check methods. They do not create separate mathematical artifact types.

## Source checker

The source checker is a capability boundary rather than another mathematical persona. It alone receives web search. It sees only exact unresolved premise packets and returns source certificates or blocking defects.

## Preserved boundaries

Exploration and verification remain separate because construction and adversarial checking have opposite success directions. Offline premise inventory and source search remain separate so internet access cannot influence proof generation or broaden unnoticed into candidate review. Handoff and candidate checks remain separate because they protect different consequential boundaries.

These roles cover every runtime authority in v15.
