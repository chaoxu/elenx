# Elenx design

Status: design for the `exploration-v12` solver, 2026-08-25. [`../SPEC.md`](../SPEC.md) defines kernel guarantees. The companion [`elenx-solve` protocol](https://gitea.lab/chaoxu/elenx-solve/src/branch/main/docs/protocol.md) defines exact solver behavior.

## Principle

Models make research judgments. The harness maintains context and enforces mechanical gates.

Explorers decide which routes to pursue, what earlier work means, which findings matter, and whether they have a resolution. Coordinators decide which reported material to retain and when to launch another explorer. Verifiers judge exact artifacts. Code preserves identity, provenance, recovery, and accounting; it does not decide which mathematics is promising or true.

Elenx exists to compare model-driven policies on one durable substrate. Added machinery must produce more externally adjudicated resolutions at equal spend or the same results for less spend.

## Boundary

The system has two activities:

1. **Exploration** searches for a resolution and reports useful state.
2. **Verification** checks an exact evidence revision or proposed resolution.

The kernel owns the append-only journal, exact model-call and audited-tool records, immutable candidates, candidate-bound verdicts, recovery primitives, and telemetry. The solver projects reports and evidence revisions from audited tool submissions, constructs model context, schedules roles, and applies the selected memory and verification policies. Benchmarks and external mathematical adjudication live outside both repositories.

The kernel supplies gates rather than research policy. Its permanent telemetry surface records model identity, inputs and outputs, declared tools, usage, estimated cost, stop state, errors, and requests whose outcome is unknown.

## Loop

```text
reconstruct state from the journal
        |
        +-- verified candidate --------------------> solved
        |
        v
fresh explorer on the first iteration
        |
        +-- raw report and nominated evidence ------> coordinator
        |
        +-- proposed resolution --> immutable candidate
                                          |
                                configured direct audits
                                    |           |
                                 non-PASS    all PASS
                                    |           |
                                    |    reconstruction configured?
                                    |         |              |
                                    |        no             yes
                                    |         |              |
                                    |       solved    blind reconstruction
                                    |                        |
                                    |                     comparison
                                    |                  |              |
                                    +------------- non-PASS         PASS
                                    |                               |
                              coordinator                         solved
                                    |
               add/revise/drop/review, then choose explore
```

Each explorer receives the final goal and the live evidence visible under the selected memory policy. It has no filesystem, database, shell, retrieval, or delegation tools. One structured result carries its raw report, nominated evidence, completion claim, and directly used positive evidence roots.

The raw report always survives. Explorer nominations are suggestions; the coordinator may write any packet-grounded evidence revision, revise or drop an existing item, ask an optional reviewer to examine one exact revision, or launch the next explorer. A proposed resolution bypasses coordinator authorship: the solver freezes its report, cited positive roots, and their dependency closure as one candidate, then runs the configured verifier gates.

Coordinator and explorer calls start from fresh roots. Reusing a compatible provider cache may reduce cost, but a previous transcript is not hidden campaign state. A later policy may deliberately add transcript reuse or direct evidence lookup as a separate experiment.

## Evidence and memory

Evidence is one revisioned artifact type. Its `positive` or `negative` kind is a steering and filtering tag, not a truth status or formal ontology.

- **Positive** evidence makes a route, fact, construction, or partial result available for later use.
- **Negative** evidence steers later explorers away from repeating an attempted route.

Negative evidence is strong but defeasible:

> Avoid repeating negatively tagged routes unless you identify a concrete reason the recorded obstruction is wrong, incomplete, or inapplicable. If you revisit one, state that reason.

The tag does not change verification, revision, provenance, or truth semantics. The frozen memory policy uses it to gate nomination, retention, and explorer context. Mixed material may be split into two items when the coordinator judges that useful. Vague attempts may remain only in the raw report.

The first four memory policies retain and expose different evidence:

| Policy | Retained evidence | Explorer view |
| --- | --- | --- |
| **M0** | none | no evidence |
| **M1** | negative evidence | negative evidence |
| **M2** | positive evidence | positive evidence |
| **M3** | positive and negative evidence | positive and negative evidence |

All four use the same loop. M0 explorers submit an empty nomination list, and the M0 coordinator can only launch another explorer. M0 therefore creates no evidence revisions or reviews, and each explorer receives the same goal-only prompt and terminal tool as an independent pass@k sample. The harness keeps repeated-context counts in telemetry rather than showing them to the explorer. Coordinator and verifier calls remain measured harness overhead, and the runtime has no hidden `k` limit.

Each added or revised card declares the live positive revisions supporting it. The resulting graph is acyclic because dependencies point to earlier revisions. An explorer cites directly used positive roots; the harness freezes the complete dependency closure in dependency-first order.

Revision and drop permanently remove an exact revision from future explorer context and citation without deleting its journal history. Retiring a dependency makes its live dependents dangling. The harness withholds `explore` until the coordinator revises or drops every dangling card. A frozen explorer-context ceiling applies the same mechanical gate when the next request is too large.

## Verification

Intermediate evidence review is optional. A review is a fallible stamp on one exact evidence revision. Adversarial review, blind reconstruction, a different model family, formalization, and human review can coexist as distinct stamps. A repair creates a new revision; old stamps remain on the bytes they examined.

Final verification is required before a campaign reports `solved`. Every proposed resolution creates an immutable candidate whose required verifier labels come from the frozen configuration. `proof-audit` attacks the composed proof. The optional `premise-audit` inventories and independently checks every load-bearing imported claim before proof audit.

The optional `reconstruction` gate requires `proof-audit` and runs only after every configured direct audit passes. A candidate-blind fresh root receives the goal plus the IDs and texts in the cited positive dependency closure, but not the candidate's new argument, reviews, history, or verdicts. A second fresh call compares that derivation with the exact candidate. Direct audits retain responsibility for the independent standing of the supplied modules.

The harness enforces candidate binding, prompt projections, fresh roots, serial phase order, and replay. Models judge correctness and agreement. Each verifier lives behind one localized kind, so removing it from configuration removes its calls and gate.

Failed and inconclusive candidates remain in the journal. A repaired resolution creates a new candidate, and no verdict or reconstruction transfers to it.

Verifier feedback reaches another explorer only when the coordinator records it as evidence and the memory policy exposes its tag. This prevents candidate reports, verifier output, raw history, or hidden runtime state from leaking around M0-M3.

`verified` means the declared gates passed for that exact candidate. It is an auditable workflow status, not a claim that an LLM verifier is infallible. External adjudication may impose a stronger standard.

## Recovery and stopping

State is derived from the append-only journal. Resume first reconciles any completed tool submission, evidence revision, candidate, or verdict, then dispatches exactly the next unresolved phase. Replay accepts a phase call only after the preceding phase settled and rejects duplicate valid terminal calls. A crash after the final required `PASS` resumes directly as solved without another model call.

M0-M3 repeat until a candidate is verified, the operator pauses, or an operational failure returns control. The runtime has no monetary cap, iteration cap, or model-controlled completion action. External benchmark drivers may cap attempts or spend when comparing policies.

## Growth rule

New machinery enters as a measured policy variation. Evidence compression, retrieval, direct database reads, transcript reuse, nested agents, formal tools, adaptive assignments, and richer stopping rules remain independent additions. The kernel grows only when multiple solver policies need the same mechanical invariant.
