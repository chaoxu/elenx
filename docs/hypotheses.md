# Elenx policy hypotheses

Status: experimental plan, 2026-08-23. [`design.md`](design.md) defines the boundary. The [`elenx-solve` protocol](../packages/solve/docs/protocol.md) defines current runtime behavior.

## Objective

Measure which exploration and verification policies produce the most externally adjudicated resolutions for a fixed monetary cost. Elenx keeps accounting, provenance, recovery, and final candidate verification constant while one policy choice changes.

A smoke test establishes that a policy runs and records the intended state. It says nothing about comparative capability.

## Memory policies

| ID | Explorer context | Hypothesis | Main risk |
| --- | --- | --- | --- |
| M0 | final goal only | independent attempts are a strong pass@k baseline | attempts repeatedly choose the same attractive route |
| M1 | goal plus negative evidence | failed-route memory improves search diversity | an overbroad item suppresses a useful route |
| M2 | goal plus positive evidence | reusable progress enables cumulative solutions | a false partial claim propagates |
| M3 | goal plus both kinds | progress and route diversity complement each other | longer context and correlated errors erase the gain |

M0-M3 run the same coordinator, explorer, candidate, final-assurance, recovery, and stopping loop. The selected memory value controls which evidence tags explorers may nominate, coordinators may retain, and later explorers may see. M0 requires empty nominations and an empty coordinator batch, so it records no evidence revisions or reviews.

Proof search resembles searching a tree, which motivates the M0-M3 comparison: negative evidence prunes branches already found not to work, so if the solution is shallow, M1 behaves like breadth-first search and reaches it quickly; positive evidence accumulates proved intermediate results, letting later attempts build deeper, so M2 behaves like depth-first extension of promising branches; M3 combines both at the cost of the longest context. The benchmark comparison at equal spend decides whether any policy is more effective, and retention itself is costly because stored evidence consumes the context window.

Positive and negative are steering tags. Positive presentation offers material that may support a route. Negative presentation asks the explorer to avoid repeating a route unless it gives a concrete reason the recorded obstruction is wrong, incomplete, or inapplicable. Neither tag asserts truth, impossibility, verification, or importance.

Under M1-M3, the explorer suggests a small set of policy-permitted items and the coordinator decides what to add or revise. Suggestions are advisory: the coordinator may extract any packet-grounded result whether or not the explorer nominated it. Code enforces the retained tag, exact source and revision references, and visibility rule; models supply every semantic judgment.

An external benchmark can compute pass@k from the first `k` M0 explorer attempts because each receives the same frozen prompt and terminal tool. Repeated-context counts remain telemetry and do not enter the request. Policy comparisons must still count coordinator and final-assurance spend. The runtime continues to the first verified candidate unless paused or interrupted.

## Construction variants

The initial comparison varies evidence retention and visibility together. Later matched comparisons can vary one construction choice:

| Axis | Initial policy | Later comparison |
| --- | --- | --- |
| suggestions | explorer supplies evidence suggestions | explorer supplies none; coordinator still extracts packet-grounded evidence |
| admission | coordinator selects | automatic or reviewed admission |
| representation | coordinator-authored revision linked to an exact source | verbatim nomination, split, rewrite, or compression |
| selection | all live evidence under a fixed ceiling | model selection, compression, or retrieval |
| presentation | fixed tag-specific headings | ordering, provenance, or stamp disclosure |
| access | coordinator packages all context | explorer reads exact evidence on demand |
| guidance | no user guidance; shipped defaults only | user-supplied frozen modules, per-launch selection, or switching policies |
| topology | one fresh explorer at a time | transcript reuse or nested agents |

The harness records exact proposals, decisions, revisions, and context exposure so each comparison can be reconstructed.

## Verification variants

Evidence review is an independent axis:

| ID | Evidence policy | Question |
| --- | --- | --- |
| E0 | no review | is model-selected memory useful before checking? |
| E1 | adversarial review | which material errors does a hostile reading catch? |
| E2 | blind reconstruction | which gaps appear when another agent rebuilds the claim? |
| E3 | different model family | does model diversity reduce correlated errors? |
| E4 | formal or deterministic check | which evidence justifies translation and checking cost? |

Every review binds one exact evidence revision. A repair starts with no inherited stamps.

Final candidate assurance remains required for `solved`. The initial fixed policy uses adversarial proof audit, premise audit, and candidate-blind reconstruction with comparison. Separate experiments may vary the frozen verifier set, but every M0-M3 run uses the same set within a matched comparison. E2 above remains an optional intermediate-evidence review rather than the candidate-level reconstruction gate.

[`research/exposure-weighted-progressive-assurance.md`](research/exposure-weighted-progressive-assurance.md) records a deferred proposal for allocating verification dynamically according to uncertainty, downstream exposure, consequence, and cost. It remains outside the active experiment order until fixed-policy campaigns supply calibrated truth labels, joint verifier failures, cost observations, faithful dependency telemetry, and a successful offline or shadow comparison.

## Recovery tests

Interrupt and resume after:

- an explorer report;
- an evidence addition, revision, or drop;
- candidate creation;
- each direct-verifier verdict;
- candidate-blind reconstruction;
- reconstruction comparison; and
- the last required `PASS`.

Committed work must not disappear or repeat. Resume after the last `PASS` must make no model call. Failed-gate feedback must reach a later explorer only through evidence visible under the selected memory policy.

## Measurement

Match problem bytes, completion criteria, model access, sampling settings, per-call limits, and final-assurance policy. External benchmark drivers should cap total spend or attempts without changing runtime semantics. Report:

- externally accepted resolutions;
- proposed resolutions rejected by final verification or external adjudication;
- provider-reported tokens and estimated cost, leaving unknown usage unknown;
- repeated routes;
- evidence later found false, vague, or overbroad;
- leakage across the selected memory view;
- exact context shown to each role;
- cache usage; and
- elapsed time as a diagnostic.

Use randomized replicated runs once the benchmark exists.

[`research/known-solution-diagnostics.md`](research/known-solution-diagnostics.md) records the diagnostic method behind the benchmark: known-solution problems make exploration failure unambiguous, proof-guided transcript analysis converts each failure into testable policy hypotheses, and the benchmark supports hill climbing over those hypotheses.

## Experiment order

1. Run one M0 smoke problem through final verification.
2. Test every recovery boundary with deterministic model fixtures.
3. Establish an externally capped M0 pass@k baseline.
4. Compare M1, M2, and M3 at equal spend.
5. Add one construction, verification, access, or topology variation only when the prior comparison motivates it.
