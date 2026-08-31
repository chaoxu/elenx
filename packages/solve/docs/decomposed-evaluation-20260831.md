# Decomposed workflow evaluation, 2026-08-31

## Result

The scratch component layer ran the explorer, coordinator, and opaque verifier as independent Elenx calls and composed the same operations into a loop. The loop exposes no verifier internals.

The infinite-primes smoke reached `ACCEPT` after one verifier rejection and one explorer repair. The cyclic-couples experiment produced a complete proof candidate in one successful Sol/max explorer call, the coordinator nominated it immediately, and the verifier rejected it with three concrete mathematical defects. The workflow behaved correctly. The W[1]-hardness theorem remains unverified.

## Component boundary

```text
ExplorerInput    -> explorer    -> ExplorerResponse
CoordinatorInput -> coordinator -> CoordinatorResponse
VerifierInput    -> verifier    -> VerifierResponse
```

The same functions run separately through `decomposed-cli.ts` or compose through the one-shot `runDecomposedLoop`. `requireAllVerifiers` demonstrates that several verifier implementations can aggregate behind one `VerifierResponse` without changing the loop. Full loop-state replay remains deliberately unimplemented in this scratch layer.

The component suite has seven focused tests covering standalone Elenx execution, loop recomposition, unchanged-candidate suppression, verifier rejection and repair, multiple-verifier aggregation and operational failure, coordinator reference validation, and packet binding. The complete repository check passed with 92 kernel tests and 109 solver tests.

## Infinite-primes smoke

The smoke used `gpt-5.6-luna` at low reasoning for every role.

| Result            |      Value |
| ----------------- | ---------: |
| Explorer turns    |          2 |
| Coordinator calls |          2 |
| Verifier calls    |          2 |
| Provider requests |          6 |
| Total tokens      |      6,957 |
| Reasoning tokens  |        403 |
| Estimated cost    | $0.0029324 |
| Request errors    |          0 |

The first proof omitted an explicit argument that the assumed finite prime list was nonempty. The verifier returned that exact defect. The next explorer added that 2 is prime, the coordinator nominated the repaired proof, and the verifier accepted it.

## Cyclic-couples run

The explorer, coordinator, and verifier used `gpt-5.6-sol` at max reasoning through codex-lb.

The first logical explorer call lasted 38 minutes 32.6 seconds. Its two provider streams ended with `stream_incomplete`, so it produced no mathematical response.

The identical explorer packet was retried as another journaled operation. It produced a 29 KB complete reduction after 63 minutes 17.1 seconds. The terminal finding was committed before Saturn ran out of disk space, although the outer call result could not be committed. Opening the database for writing recovered the journal, and the exact terminal finding remained available. An inactive 8.0 GiB Chrome testing profile under `~/.codex/tmp/coflat` was permanently removed to restore disk space.

The coordinator read the exact finding, wrote a 240-character navigation summary, nominated it immediately, and supplied no support notes because the answer was self-contained. Its call lasted 32.0 seconds, used 10,278 tokens, and cost $0.07159.

The opaque verifier read the exact proof and returned `REJECT` after 18 minutes 45.8 seconds. It used 40,451 tokens and cost $0.942336. Its response identified:

- a double-counted fixed reward in Lemma 3, making equations (14), (21), and (22) false for an allowed constant pair function
- a residual-cycle bound justified only by “direct tracing,” leaving the normalization upper bound unproved
- a negative-budget edge case for a one-vertex, two-colour source instance

This live call preceded the final `bundleHash` packet check added during correctness review. Current verifier packets bind the exact task, answer, and support bytes before dispatch.

The successful explorer provider request used 74,138 tokens and cost $2.21144. The measured successful candidate path therefore used 124,867 tokens and cost $3.225366 across explorer, coordinator, and verifier. Three failed explorer provider requests have no usage measurement and are excluded from those totals.

## Disposition

The experiment validates the component boundary and rejects the submitted proof. A subsequent explorer can receive the exact verifier response and candidate as its only repair context. No triage, note standing, proof tower, synthesized defect note, or exposed verification subphase is required.

Current V17 has not been replaced. The component layer remains a scratch path until its measured behavior and API receive final review.
