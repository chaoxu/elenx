# Known-solution problems as failure diagnostics

Status: recorded method, 2026-08-23. [`../hypotheses.md`](../hypotheses.md) defines the experiment order this method feeds.

## Why known-solution problems

Start with problems whose solutions are already known but which the harness fails to solve. Failure on such a problem is unambiguous evidence that the search for the proof is deficient, not that the problem is open or the verification standard is unreachable. This isolates exploration as the component under study, consistent with holding the verification policy fixed while exploration varies.

## Proof-guided transcript analysis

Because the true proof is available, failure analysis can be counterfactual rather than speculative: give an analyst model the actual proof plus the transcript of what the campaign attempted, and ask why the search never found it. Typical answers — the key lemma was never conjectured, the right route was tried and abandoned, a negative evidence item suppressed the correct branch, the decisive step needed a technique the explorer never reached for — are testable hypotheses about the exploration policy. This turns each failed known-solution run into a source of policy hypotheses instead of a single bit of pass/fail signal. Explanations of the form "the search never made this move" convert directly into candidate explorer-guidance modules; the solver's [guidance design note](../../packages/solve/docs/guidance.md) records that mechanism and its planned variations.

## Benchmark hill climbing

A collection of such problems (implemented in a separate benchmark project) supports hill climbing on the exploration policy: formulate a hypothesis, change one policy choice, rerun the benchmark, and measure how theorem-proving ability moves. The M1/M2/M3-versus-M0 comparison in [`../hypotheses.md`](../hypotheses.md) is the first hypothesis in this loop; hypotheses produced by proof-guided transcript analysis queue behind it. The growth rule in [`../design.md`](../design.md) already requires that machinery enter as a measured variation, and this method supplies both the measurement and the candidate variations.
