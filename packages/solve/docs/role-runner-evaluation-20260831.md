# Role runner evaluation, 2026-08-31

## Result

The role runner ran the explorer, coordinator, and opaque verifier as independent Elenx calls, then connected the same operations into a trial. The trial exposes no verifier internals.

The fresh infinite-primes smoke reached `ACCEPT` in its first explorer turn. The fresh cyclic-couples trial also reached `ACCEPT` in its first turn. Two independent Sol/max verifier calls accepted the exact proof, and a restricted Claude Fable/max hostile audit returned `PASS`. The system produced a complete proof of the stated W[1]-hardness theorem.

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

The trial used `gpt-5.6-sol` at max reasoning through codex-lb for every role. Its input contained the exact theorem and ordinary proof-completeness requirements. It contained no earlier candidate, verifier defect, or published construction. The explorer had no search or retrieval tool.

The explorer returned one 19,958-character proof after 33 minutes 17.8 seconds. The candidate has SHA-256 `c65e1b79ab3e1d92d085c2c28e48e3939f5adf557a1d6ac8a56d93d4b02a7e45`. It proves an exact transposition-distance formula for equal-size partial matchings, builds parity-controlled port tests, and reduces from MULTICOLORED CLIQUE with output parameter `q<=p+1`.

The coordinator took 9.8 seconds, filed the candidate as one self-contained note, and nominated it with no support notes. The first verifier took 9 minutes 53.1 seconds and returned `ACCEPT`. It explicitly checked the distance lemma, port-cycle bound, parity and consistency decoding, both threshold arguments, construction size, and parameter bound.

| Trial operation | Duration |  Tokens | Reasoning tokens | Estimated cost |
| --------------- | -------: | ------: | ---------------: | -------------: |
| Explorer        |  33:17.8 |  84,843 |           78,689 |      $2.534665 |
| Coordinator     |  00:09.8 |   6,996 |              294 |      $0.044405 |
| Verifier        |  09:53.1 |  34,184 |           27,670 |      $0.865520 |
| Trial total     |          | 126,023 |          106,653 |      $3.444590 |

A second fresh Sol/max role verifier then read the same frozen candidate and returned `ACCEPT` after 11 minutes 8.7 seconds. It used 37,303 tokens, including 30,748 reasoning tokens, and cost $0.95909. The complete Elenx record therefore contains four measured provider requests, 163,326 tokens, 137,401 reasoning tokens, $4.40368 estimated cost, and zero request errors.

A restricted Claude Fable/max audit received only the frozen verifier input. It independently reconstructed the physical swap correspondence and distance formula, traced the port state machine, checked the parity layout and decoder, recomputed every threshold inequality, and verified completeness, soundness, parameter mapping, and polynomial running time. It returned `PASS` with two non-blocking exposition notes:

- state explicitly that the source color classes are nonempty
- spell out the empty-set conventions used for `max P_i` and `min N_i`

The theorem already had an independently audited proof using a different threshold-rail construction. The new candidate instead uses port tests and leaves at most `p+1` people unpaired, so the successful run is not a replay of that proof architecture.

## Disposition

The role runner solved the exact theorem in one explorer turn. The coordinator recognized completion immediately, both Elenx verifier calls accepted the frozen proof, and the outside-family hostile audit passed. This is proof-grade evidence for the mathematical result rather than a workflow-only success.

Whole-trial restartability remains the role runner's experimental limitation. Every individual role call and verifier result is durable in the journal.
