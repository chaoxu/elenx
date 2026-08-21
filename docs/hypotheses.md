# Elenx policy hypotheses

Status: experimental plan, 2026-08-20. [`design.md`](design.md) defines the boundary. The companion [`elenx-solve` protocol](https://gitea.lab/chaoxu/elenx-solve/src/branch/main/docs/protocol.md) defines current runtime behavior.

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

M0-M3 run the same coordinator, explorer, candidate, final-assurance, recovery, and stopping loop. The selected memory value controls which evidence tags explorers may nominate, coordinators may retain, and later explorers may see. M0 requires empty nominations and exposes only the coordinator's `explore` action, so it records no evidence revisions or reviews.

Positive and negative are steering tags. Positive presentation offers material that may support a route. Negative presentation asks the explorer to avoid repeating a route unless it gives a concrete reason the recorded obstruction is wrong, incomplete, or inapplicable. Neither tag asserts truth, impossibility, verification, or importance.

Under M1-M3, the explorer nominates a small set of policy-permitted items and the coordinator decides what to add or revise. Code enforces the retained tag, exact source and revision references, and visibility rule; models supply every semantic judgment.

An external benchmark can compute pass@k from the first `k` M0 explorer attempts because each receives the same goal-only context. Policy comparisons must still count coordinator and final-assurance spend. The runtime continues to the first verified candidate unless paused or interrupted.

## Construction variants

The initial comparison varies evidence retention and visibility together. Later matched comparisons can vary one construction choice:

| Axis | Initial policy | Later comparison |
| --- | --- | --- |
| nomination | explorer nominates items | coordinator extracts without nominations |
| admission | coordinator selects | automatic or reviewed admission |
| representation | coordinator-authored revision linked to an exact source | verbatim nomination, split, rewrite, or compression |
| selection | all visible evidence fits | model selection, context cap, or retrieval |
| presentation | fixed tag-specific headings | ordering, provenance, or stamp disclosure |
| access | coordinator packages all context | explorer reads exact evidence on demand |
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

Final candidate assurance remains required for `solved`: ordinary hostile verification, reconstruction-input certification, blind reconstruction, and comparison. Separate experiments may vary that frozen cadence, but every M0-M3 run uses the same final policy within a matched comparison. E2 above remains an optional intermediate-evidence review rather than the mandatory candidate reconstruction.

## Recovery tests

Interrupt and resume after:

- an explorer report;
- an evidence addition or revision;
- candidate creation;
- each ordinary-verifier verdict;
- reconstruction-bundle certification;
- blind reconstruction;
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

## Experiment order

1. Run one M0 smoke problem through final verification.
2. Test every recovery boundary with deterministic model fixtures.
3. Establish an externally capped M0 pass@k baseline.
4. Compare M1, M2, and M3 at equal spend.
5. Add one construction, verification, access, or topology variation only when the prior comparison motivates it.
