# Role runner evaluation, 2026-08-31

## Result

The role runner ran the explorer, coordinator, and opaque verifier as independent Elenx calls, then connected the same operations into a trial. The trial exposes no verifier internals.

The fresh infinite-primes smoke reached `ACCEPT` in its first explorer turn. The cyclic-couples experiment produced a complete proof candidate in one successful Sol/max explorer call, the coordinator nominated it immediately, and the verifier rejected it with three concrete mathematical defects. The workflow behaved correctly. The W[1]-hardness theorem remains unverified.

## Role boundary

```text
ExplorerInput    -> explorer    -> ExplorerResult
CoordinatorInput -> coordinator -> CoordinatorResult
VerifierInput    -> verifier    -> VerifierResult
```

The same roles run separately through `elenx-solve explorer`, `elenx-solve coordinator`, and `elenx-solve verifier`, or connect through `elenx-solve trial`. The public `Roles` interface contains only the three typed functions. The Pi adapter and journal dependencies remain private to the CLI. `allVerifiers` demonstrates that several verifier implementations can aggregate behind one `VerifierResult` without changing the trial. Each function returns its role result directly, while inspection exposes journal metadata. Full trial-state replay remains deliberately unimplemented.

The role suite covers standalone Elenx execution, trial composition, unchanged-candidate suppression, verifier rejection and repair, multiple-verifier aggregation, operational failure propagation, coordinator reference validation, input validation, and unified CLI inspection.

## Infinite-primes smoke

The smoke used `gpt-5.6-luna` at low reasoning for every role.

| Result            |      Value |
| ----------------- | ---------: |
| Explorer turns    |          1 |
| Coordinator calls |          1 |
| Verifier calls    |          1 |
| Provider requests |          3 |
| Total tokens      |      2,223 |
| Reasoning tokens  |        153 |
| Estimated cost    | $0.0010616 |
| Request errors    |          0 |

The explorer supplied Euclid's construction together with a least-divisor proof that every integer greater than one has a prime divisor. The coordinator nominated it with no support notes. The verifier accepted it without repair.

## Cyclic-couples run

The explorer, coordinator, and verifier used `gpt-5.6-sol` at max reasoning through codex-lb.

The first logical explorer call lasted 38 minutes 32.6 seconds. Its two provider streams ended with `stream_incomplete`, so it produced no mathematical response.

The identical explorer packet was retried as another journaled operation. It produced a 29 KB complete reduction after 63 minutes 17.1 seconds. The terminal finding was committed before Saturn ran out of disk space, although the outer call result could not be committed. Opening the database for writing recovered the journal, and the exact terminal finding remained available. An inactive 8.0 GiB Chrome testing profile under `~/.codex/tmp/coflat` was permanently removed to restore disk space.

The coordinator read the exact finding, wrote a 240-character navigation summary, nominated it immediately, and supplied no support notes because the answer was self-contained. Its call lasted 32.0 seconds, used 10,278 tokens, and cost $0.07159.

The opaque verifier read the exact proof and returned `REJECT` after 18 minutes 45.8 seconds. It used 40,451 tokens and cost $0.942336. Its response identified:

- a double-counted fixed reward in Lemma 3, making equations (14), (21), and (22) false for an allowed constant pair function
- a residual-cycle bound justified only by “direct tracing,” leaving the normalization upper bound unproved
- a negative-budget edge case for a one-vertex, two-colour source instance

This live call preceded unchanged-proposal suppression in the trial runner. The trial now computes an internal identity from the exact task, answer, and support bytes before repeating verification.

The successful explorer provider request used 74,138 tokens and cost $2.21144. The measured successful candidate path therefore used 124,867 tokens and cost $3.225366 across explorer, coordinator, and verifier. Three failed explorer provider requests have no usage measurement and are excluded from those totals.

## Disposition

The experiment validates the role boundary and rejects the submitted proof. A subsequent explorer can receive the exact verifier response and candidate as its only repair context. No triage, note standing, proof tower, synthesized defect note, or exposed verification subphase is required.

Current V17 has not been replaced. The role runner remains an experimental path until its workflow state can be reconstructed after interruption.
