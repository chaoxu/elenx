# Elenx design

Status: design for the `exploration-v4` solver, 2026-08-21. [`../SPEC.md`](../SPEC.md) defines kernel guarantees. The companion [`elenx-solve` protocol](https://gitea.lab/chaoxu/elenx-solve/src/branch/main/docs/protocol.md) defines exact solver behavior.

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
                                ordinary hostile audit
                                    |           |
                                 non-PASS    all PASS
                                    |           |
                                    |    certify reconstruction input
                                    |           |
                                    |      blind reconstruction
                                    |           |
                                    |         comparison
                                    |       |            |
                                    +--- non-PASS       PASS
                                    |                    |
                              coordinator              solved
                                    |
                  add/revise/review, then choose explore
```

Each explorer receives the final goal and the evidence visible under the selected memory policy. It has no filesystem, database, shell, retrieval, or delegation tools. One structured result carries its raw report, nominated evidence, and at most one proposed resolution.

The raw report always survives. The coordinator may write a source-grounded evidence revision, revise an existing item, ask an optional reviewer to examine one exact revision, or launch the next explorer. A proposed resolution bypasses coordinator authorship: the solver freezes its proof, cited dependencies, and reconstruction bundle as one candidate, then runs the frozen final-assurance cadence.

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

All four use the same loop. M0 explorers submit an empty nomination list, and the M0 coordinator can only launch another explorer. M0 therefore creates no evidence revisions or reviews, and each explorer call has the same goal-only context semantics as an independent pass@k sample. Coordinator and verifier calls remain measured harness overhead, and the runtime has no hidden `k` limit.

## Verification

Intermediate evidence review is optional. A review is a fallible stamp on one exact evidence revision. Adversarial review, blind reconstruction, a different model family, formalization, and human review can coexist as distinct stamps. A repair creates a new revision; old stamps remain on the bytes they examined.

Final verification is required before a campaign reports `solved`. Every proposed resolution creates an immutable candidate with frozen ordinary-verifier, bundle-certification, and comparison labels. Ordinary verifiers inspect the original proof without its reconstruction bundle. After they pass, a fresh certifier checks every reconstruction input for proof leakage, a blind fresh root reconstructs from only the goal and certified high-level bundle, and a fresh comparator maps that derivation to the candidate's conclusions and declared dependencies.

The harness enforces candidate binding, prompt projections, fresh roots, serial order, and replay. Models judge leakage, correctness, and agreement. One frozen reconstruction profile runs the three fresh roots, so blindness means transcript and context isolation rather than model-family independence.

Failed and inconclusive candidates remain in the journal. A repaired resolution creates a new candidate, and no verdict or reconstruction transfers to it.

Verifier feedback reaches another explorer only when the coordinator records it as evidence and the memory policy exposes its tag. This prevents candidate reports, verifier output, raw history, or hidden runtime state from leaking around M0-M3.

`verified` means the declared gates passed for that exact candidate. It is an auditable workflow status, not a claim that an LLM verifier is infallible. External adjudication may impose a stronger standard.

## Recovery and stopping

State is derived from the append-only journal. Resume first reconciles any completed tool submission, evidence revision, candidate, or verdict, then dispatches exactly the next unresolved phase. A crash after the final required `PASS` resumes directly as solved without another model call.

M0-M3 repeat until a candidate is verified, the operator pauses, or an operational failure returns control. The runtime has no monetary cap, iteration cap, permanent retirement state, or model-controlled completion action. External benchmark drivers may cap attempts or spend when comparing policies.

## Growth rule

New machinery enters as a measured policy variation. Evidence compression, retrieval, direct database reads, transcript reuse, nested agents, formal tools, adaptive assignments, and richer stopping rules remain independent additions. The kernel grows only when multiple solver policies need the same mechanical invariant.
