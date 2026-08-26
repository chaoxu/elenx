# Elenx design

Status: design for the `exploration-v14` solver, 2026-08-25. [`../SPEC.md`](../SPEC.md) defines kernel guarantees. The [`elenx-solve` protocol](../packages/solve/docs/protocol.md) defines exact solver behavior.

## Principle

Models make research judgments. The harness maintains context and enforces mechanical gates.

Explorers decide which routes to pursue, what earlier work means, which findings matter, and whether they have a resolution. Coordinators decide which reported material to retain and when to launch another explorer. Verifiers judge exact artifacts. Code preserves identity, provenance, recovery, and accounting; it does not decide which mathematics is promising or true.

Elenx exists to compare model-driven policies on one durable substrate. Added machinery must produce more externally adjudicated resolutions at equal spend or the same results for less spend.

## Boundary

The system has two activities:

1. **Exploration** searches for a resolution and reports useful state.
2. **Verification** checks exact admission items, modular resolutions, and standalone deliveries.

The kernel owns the append-only journal, exact model-call and audited-tool records, immutable candidates, candidate-bound verdicts, recovery primitives, and telemetry. The solver projects reports into mathematical claims and route records, constructs model context, schedules roles, and applies the selected memory, verification, and delivery policies. Benchmarks and external mathematical adjudication live outside both repositories.

The kernel supplies gates rather than research policy. Its permanent telemetry surface records model identity, inputs and outputs, declared tools, usage, estimated cost, stop state, errors, and requests whose outcome is unknown.

## Loop

```text
reconstruct state from the journal
        |
        +-- verified delivery ---------------------> solved
        |
        v
fresh explorer on the first iteration
        |
        +-- report with claim and route nominations -> coordinator
        |                                                |
        |                                      admission audits
        |                                                |
        +<-----------------------------------------------+
        |
        +-- proposed resolution --> modular candidate
                                          |
                              fresh terminal closure audit
                                  |                 |
                               non-PASS          all PASS
                                  |                 |
                            coordinator    optional reconstruction
                                                    |
                                             assemble delivery
                                                    |
                                          candidate-only delivery audit
                                              |               |
                                           non-PASS         PASS
                                              |               |
                                      delivery failure      solved
```

Each explorer receives the final goal and the live claims and routes visible under the selected memory policy. It has no filesystem, database, shell, retrieval, or delegation tools. One structured result carries its raw report, claim and route nominations, completion claim, and directly cited mathematical claims.

The raw report always survives. Explorer nominations are suggestions. The coordinator may write any packet-grounded claim or route, revise or drop an existing item, ask an optional auditor to examine one exact admission batch, or launch the next explorer. A proposed resolution bypasses coordinator authorship: the solver freezes its report, cited claim roots, and their dependency closure as one modular candidate, then runs the configured verifier gates.

Coordinator and explorer calls start from fresh roots. Reusing a compatible provider cache may reduce cost, but a previous transcript is not hidden campaign state. A later policy may deliberately add transcript reuse or direct evidence lookup as a separate experiment.

## Claims, routes, and memory

A claim is one exact citable mathematical proposition with declared claim dependencies and an immutable origin. Lemmas, counterexamples, obstruction theorems, impossibility results, invariants, and reductions share this representation. A claim's mathematical role does not create a second storage type.

A route records operational search history: the attempted mechanism, outcome, relevant claim IDs, and any condition that would make a retry materially new. It references formal obstruction claims instead of copying their statements or proofs. Route IDs cannot enter claim dependencies or support a resolution.

Route guidance is strong but defeasible:

> Avoid repeating a recorded failed route unless you identify a concrete reason its obstruction is wrong, incomplete, inapplicable, or discharged by a new construction. State that reason when retrying it.

An unproved search obstruction remains route prose. Once proved as a theorem or counterexample, it becomes one claim that the route references. This keeps one mathematical identity for material that may later support another proof.

The memory policies retain and expose different working state:

| Policy | Retained state | Explorer view |
| --- | --- | --- |
| `none` | none | goal only |
| `claims` | claims | citable mathematical claims |
| `claims-and-routes` | claims and routes | claims plus operational route history |

All policies use the same loop. Under `none`, explorers submit empty nomination lists and the coordinator can only launch another explorer. Each explorer therefore receives the same goal-only prompt and terminal tool as an independent pass@k sample. The harness keeps repeated-context counts in telemetry rather than showing them to the explorer. Coordinator and verifier calls remain measured harness overhead, and the runtime has no hidden `k` limit.

Each added or revised claim declares the live claims supporting it. The graph is acyclic because dependencies point to earlier claims. An explorer cites directly used roots, and the harness freezes their complete dependency closure in dependency-first order.

Revision and drop permanently remove an exact claim or route from future explorer context without deleting journal history. Retiring a claim makes its live dependent claims and routes dangling. The harness withholds `explore` until the coordinator revises or drops every dangling item. A frozen global context ceiling applies the same mechanical gate when the next structured request is too large.

## Verification

Intermediate admission audit is optional. It is a fallible stamp on one exact claim or route revision. A repair creates a new revision, while old stamps remain on the bytes they examined. Route admission checks operational fidelity and grants no proof standing.

Final verification is required before a campaign reports `solved`. Every proposed resolution creates an immutable modular candidate whose required verifier labels come from the frozen configuration. The optional `premise-audit` inventories imported claims. The required `proof-audit` freshly checks every claim in the transitive support closure, every direct dependency edge, every cited-root application, and the composed resolution. Prior admission stamps provide provenance rather than terminal standing.

The optional `reconstruction` gate runs only after every configured direct audit passes. A candidate-blind fresh root receives the goal and one declared claim graph, but not the candidate argument, support artifacts, routes, history, or verdicts. A second fresh call receives the identical serialized graph and compares the derivation with the exact candidate. Terminal proof audit remains responsible for claim truth.

Passing modular verification launches a delivery assembler over the verified resolution and full mathematical support closure. It produces one standalone answer with internal claim references resolved. A fresh delivery audit receives only the task, exact answer, and sourced premise statements. It sees no claim graph, support artifact, route, stamp, history, or earlier verdict. The campaign reaches `solved` only when both the modular resolution and linked delivery candidate pass.

The harness enforces candidate binding, exact prompt projections, structured coverage, fresh roots, serial phase order, replay, and byte-identical export of the verified delivery. Models judge mathematical correctness and agreement. Each verifier lives behind one localized kind, so removing an optional verifier from configuration removes its calls and gate.

Failed and inconclusive candidates remain in the journal. A repaired resolution creates a new candidate, and no verdict or reconstruction transfers to it.

Verifier feedback reaches another explorer only when the coordinator records it as a claim or route allowed by memory policy. Candidate reports, verifier output, raw history, and hidden runtime state otherwise stay outside explorer context.

`verified` means the declared gates passed for that exact candidate. `solved` additionally requires an audited standalone delivery linked to the verified modular resolution. These are auditable workflow states rather than claims that an LLM verifier is infallible. External adjudication may impose a stronger standard.

## Recovery and stopping

State is derived from the append-only journal. Resume first reconciles any completed tool submission, claim, route, candidate, or verdict, then dispatches exactly the next unresolved phase. Replay accepts a phase call only after the preceding phase settled and rejects duplicate valid terminal calls. A crash after assembly preserves the delivery bytes. A crash after the delivery-audit submission records its verdict and reaches `solved` without another model call.

Exploration repeats until a modular candidate passes, the operator pauses, or an operational failure returns control. A non-passing delivery audit returns `delivery-failure` without silently spending more model calls. The runtime has no monetary cap, iteration cap, or model-controlled completion action. External benchmark drivers may cap attempts or spend when comparing policies.

## Growth rule

New machinery enters as a measured policy variation. Evidence compression, retrieval, direct database reads, transcript reuse, nested agents, formal tools, adaptive assignments, and richer stopping rules remain independent additions. The kernel grows only when multiple solver policies need the same mechanical invariant.
