# Role boundaries

Status: rationale for `exploration-v17`. [`protocol.md`](protocol.md) is normative and [`data-flow.md`](data-flow.md) defines exact projections.

V17 has two mathematical personas, one verification subsystem, and one isolated capability boundary. Assembly sits outside every boundary here: rendering the verified tower into a document belongs to the application, not the protocol.

## Explorer

The explorer constructs mathematics. It reports findings — results, failed attempts, and open questions — and nothing else: it cannot submit an answer, mint a note, or touch standing. Its output has no truth authority.

Every explorer starts from a fresh root. It receives no web, filesystem, shell, browser control, memory, plugin, or delegation tools, and no retrieval capability: what it knows is the index and the working set the curator served.

## Curator

The curator is one role with two call sites. Ingest files every reported finding exactly once; serve composes what the next explorer sees, or points at the goal note. The curator writes summaries but never rewrites finding bytes, and it holds no verification power: it cannot plan audits, issue verdicts, or invalidate a note. What it controls is observation — the working set and the goal declaration — never standing and never acceptance.

## Verification subsystem

The verification invariant in [`protocol.md`](protocol.md) governs both call sites.

Triage plans; mode verifiers judge. Verifiers alone touch standing: every standing transition derives from their journaled plans and verdicts, and nothing else in the system can refute, verify, or resurrect a note. At the boundary the battery — every mode plus `criteria-match` — is the sole acceptance authority. Guidance cannot reach any of it: it is advisory text for explorers only.

## Source checker

The source checker is a capability boundary rather than another mathematical persona. It alone receives web search. It sees only exact unresolved premise packets and returns source certificates or blocking defects, folded into the `external-premises` mode verdict.

## Role-tool matrix

Tool access is strict: the harness constructs every call's tool list, each call declares exactly one terminal tool, and no role can reach another role's tool.

| Call site                                      | Only tool                           |
| ---------------------------------------------- | ----------------------------------- |
| explorer                                       | `submit_turn`                       |
| curator ingest                                 | `submit_curation`                   |
| curator serve                                  | `submit_serving`                    |
| triage                                         | `submit_triage`                     |
| mode verifier                                  | `submit_verdict`                    |
| premise inventory (inside `external-premises`) | `submit_premises`                   |
| source checker                                 | isolated Codex CLI, no journal tool |

## Preserved boundaries

Exploration and verification remain separate because construction and adversarial checking have opposite success directions. Curation and verification remain separate so the role that writes summaries can never grade them. Premise inventory and source search remain separate so internet access cannot influence proof judgment or broaden unnoticed. Reasoning and observation remain separate so the explorer stays one bounded reasoning call while the curator alone decides what it sees.

These roles cover every runtime authority in v17.
