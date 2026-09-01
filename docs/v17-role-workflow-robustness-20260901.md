# V17 role workflow robustness, 2026-09-01

## Outcome

Elenx V17 now exposes a small role workflow whose mathematical output is bound to the kernel and can be launched as a frozen Elenx Lab collection. The explorer proposes findings, the coordinator either requests another turn or nominates a candidate, and the verifier returns `ACCEPT` or `REJECT`. Verifier audits remain internal. A terminal role report names the exact kernel-verified candidate. Every mathematical pilot result also receives a separate semantic review over the exact candidate bytes.

Elenx Lab remains the run layer. It freezes inputs, submits and reconciles Nomad jobs, records attempt facts, and projects catalog state. It does not interpret mathematical prose. Independent semantic verification runs as a separate verifier operation over the terminal candidate.

The code and local execution gates passed. The current Sol/max verifier accepted the frozen cyclic-couples proof under the keyed-audit contract. The first production role-trial generation froze correctly but did not start a container because Jupiter's Nomad-to-OpenBao JWT login returned `403` for the `elenx-pool` role. That failure is retained as operational evidence. It is not the final pilot result.

## Why the earlier workflow was slow

V17 initially asked a proof-blind reconstruction call to rediscover an entire reduction without receiving the verified lemmas that the theorem used. A long explorer call could solve the problem, yet a later verifier repeated the expensive mathematical search. Curator and verification responsibilities were also entangled with standing transitions, repair loops, and boundary gates. The result was more tokens, more states, and more ways for a true but incomplete proof to become unusable.

The repaired workflow keeps the coordinator small. It files findings, selects the notes needed by the proposed theorem, and decides whether to explore or verify. The verifier receives the nominated answer plus only its selected support notes. Its internal audits can change without changing the explorer or coordinator interface.

## Implemented contracts

Elenx commit `06ea4b4543abac8f7c752d1bdfb7c43f077a7e2e` publishes execution-contract V4 and role protocol `role-calls.v2`.

- Every verifier proposal creates a kernel candidate before the model call.
- Candidate material begins with the nominated answer and appends selected support notes in order.
- The verifier call is bound to that candidate.
- Aggregate `ACCEPT` records kernel `PASS`. Aggregate `REJECT` records `FAIL`.
- `accepted` and `refuted` reports name the exact verified candidate and candidate kind.
- `turn-limit` reports name no candidate.
- Historical V1 role journals remain inspectable. New writes require V2.

Elenx Lab commit `c7313e573b38c42484150113ca23b787c6d09406` adds frozen role-trial collections without adding another worker, queue, executor, or catalog.

- Author manifests use `kind: "role-trial"` and an ordered list of complete `trial.json` files.
- Frozen schema V5 preserves each trial hash and derives problem and criteria files from its task fields.
- Every arm shares one clean Elenx revision and one V4 execution contract.
- Worker contract 4 changes only the solver argv from `run` to `trial`.
- Every exited role-trial attempt is final because the in-memory trial cursor cannot resume. Campaign recovery remains unchanged.
- Accepted solutions and verified refutations are procedural passes. Turn limits are procedural failures. Process failures are unavailable.
- Catalog schema V2 records execution kind and trial hash. Observer candidate IDs, bytes, digests, and status remain the source for candidate-bound adjudication.

## Development evidence

The development robustness bundle is `runs/robustness-dev-20260901-1/`.

- Ten concurrent hermetic suites passed all 60 scenarios.
- Twenty-one live Luna/low trials produced 15 accepted results and 6 verified refutations.
- Three staged-primes trials took a real two-turn path through explorer, coordinator, explorer, coordinator, and verifier.
- Independent mathematical review passed all 21 live outcomes.
- The bundle used 69 measured requests, 73,830 tokens, and `$0.03537`, with zero request errors.

The live repair/support case under the same bundle followed `verifier → explorer → coordinator → verifier`. It produced `REJECT → ACCEPT` and retained exactly support note `n1`. Four measured Luna/low requests used 3,881 tokens and `$0.0016702`, with zero errors.

The durable-candidate canary is `runs/role-v4-durable-candidate-canary-20260901-1/`. It accepted in one turn, named kernel candidate 14, used three requests and 2,612 tokens, and recorded zero errors.

The final Lab check passed formatting, TypeScript, 89 tests with 262 assertions, Nomad HCL validation, allocation-filter validation, and both CLI help probes. Elenx's full check passed 92 kernel tests and 124 solver tests plus package and consumer checks.

## Hard mathematical release gate

The current Sol/max verifier run is `runs/role-hard-keyed-v4-20260901-1/`. The candidate text SHA-256 matched

`c65e1b79ab3e1d92d085c2c28e48e3939f5adf557a1d6ac8a56d93d4b02a7e45`.

The verifier received the exact cyclic-couples task and completion criteria, `candidateKind: solution`, and empty support. It returned aggregate `ACCEPT`. The private `correctness`, `requirements`, and `refutation` audits all returned `PASS`. Candidate 2 is kernel-verified, and its bytes equal the frozen answer. Public inspection exposes neither the audit object nor the internal `PASS` values.

The call used 28,169 tokens, including 20,927 reasoning tokens, and `$0.68057`. Its stable usage tag is `release-gate/cyclic-couples-keyed-v4/attempt-1`. It recorded zero request errors and zero unmeasured requests.

The read-only codex-lb projection on Jupiter contained exactly one successful row for that tag, with the same model, token split, and cost.

The first post-run checker expected the audit collection to be an array, while the keyed schema stores an object. That checker failed after the model call had settled. The durable journal showed all three audits passing, so the corrected finalizer produced the release evidence without another model request.

## Frozen production pilot

The final pilot collection is `known-answer-role-pilot-v9`. It contains the even-sum and infinite-primes tasks, three Luna/low replicates for each task, one baseline arm, and concurrency three.

The deployment failures before v9 were concrete and separate. The initial v1 generation failed before task start when Nomad could not authenticate to OpenBao. The next image builds exposed a cold Nix store, a missing workspace install, a worker command that did not use the allocation directory, and an init path that rejected Nomad's null defaults. The fixes moved credential delivery to the coordinator's `fleet-secret` lookup followed by `CODEX_LB_API_KEY` in Nomad job state, installed the workspace with the frozen lockfile, used the shared attempt executor, and made the worker command Nomad-compatible. Legacy OpenBao templates remain readable for reconciliation and cannot start a new generation.

The v9 image is `sha256:35d7f2a340667cf86949effb0bec8e7176dce0c6c23f3c296658d36226421fa6`. Its worker manifest binds worker contract 4, Elenx `06ea4b4`, Lab `66b32c0`, and model-registry hash `cc50b8fe3174859921aff415b83db88bd7c15dcb1ea5e97b7e7621e4cb98a195`. Generation 1 used job `elenx-pool-known-answer-role-pilot-v9-d9c86dab71131b60-g1`.

All six allocations exited successfully with code 0. The three even-sum trials and the three infinite-primes trials each completed in one explorer turn. Every run produced a campaign database, named candidate 14, and had empty solver stderr. The original Luna/low pilot calls used three provider requests per trial with no request errors. Their campaign token and cost totals matched the read-only codex-lb projection on Jupiter.

The first external checker was a lexical smoke artifact. It searched proof prose with regular expressions and rejected valid prime proofs when their wording differed. Those records remain in the ignored diagnostic bundle and are excluded from the pilot catalog. A mathematical claim is never adjudicated by phrase matching.

The external semantic review evidence is in `../elenx-lab/runs/role-pilot-semantic-20260901-1/`. For each run, the reviewer fetched the sole verified candidate from Observer, passed its complete UTF-8 text together with the frozen task and criteria to a fresh `elenx-solve verifier` campaign, and checked that the new kernel candidate bytes matched Observer byte for byte. The independent profile was `gpt-5.6-sol` at `max`. All six semantic reviews returned `ACCEPT`, and all six immutable Lab records use `method: "independent-review"` with candidate 14's exact digest.

The six semantic calls used six measured provider requests, 8,147 total tokens, and an estimated `$0.132135`, with zero request errors. Each semantic journal contains one candidate-bound verifier call and one derived verdict. The original pilot journals and the semantic journals are separate artifacts.

The final catalog on Jupiter is `/srv/elenx-lab/runs/catalog.sqlite`. Its six v9 rows have `result_class = pass`, `report_outcome = accepted`, `external_verdict = pass`, `adjudication_method = independent-review`, and no projection error. The catalog stores the semantic review separately from the procedural Elenx result.

The semantic review calls are accounted for under the tags `independent-semantic/known-answer-role-pilot-v9/<run>/sol-max-1`. Their fresh journals and immutable records are the evidence for independent mathematical checking. The regex checker is retained only to document the false-negative incident.

During diagnosis of the JWT failure, a secret-bearing OpenBao configuration was mistakenly rendered into the tool transcript. This report does not reproduce the value. Credential rotation remains an operator security action separate from the successful v9 pilot.
