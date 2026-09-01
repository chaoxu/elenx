# V17 role workflow robustness, 2026-09-01

## Outcome

Elenx V17 now exposes a small role workflow whose mathematical output is bound to the kernel and can be launched as a frozen Elenx Lab collection. The explorer proposes findings, the coordinator either requests another turn or nominates a candidate, and the verifier returns `ACCEPT` or `REJECT`. Verifier audits remain internal. A terminal role report names the exact kernel-verified candidate.

The code and local execution gates passed. The current Sol/max verifier accepted the frozen cyclic-couples proof under the keyed-audit contract. The first production role-trial pilot froze correctly but did not start a container because Jupiter's Nomad-to-OpenBao JWT login returned `403` for the `elenx-pool` role. That infrastructure enrollment requires the controlled OpenBao root-token ceremony. No pilot run reached Elenx, so the failed Nomad generation supplies operational evidence only.

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

The pilot collection is `known-answer-role-pilot-v1`: the benchmark's even-sum and infinite-primes tasks, three Luna/low replicates each, one baseline arm, and concurrency three.

The Jupiter image is `sha256:61f4c914f1ec8c30b2d2eee470eebc8f97cf31acb066f2866503f05e7375594d`. Its manifest binds worker contract 4, Elenx `06ea4b4`, Lab `c7313e5`, and model-registry hash `cc50b8fe3174859921aff415b83db88bd7c15dcb1ea5e97b7e7621e4cb98a195`.

The frozen manifest SHA-256 is `735a8ba2bad364a615999531b289adc85f6c8ec3637c5297f68357f71a560b62`. Generation 1 used job `elenx-pool-known-answer-role-pilot-v1-d5372da409c96667-g1`. All nine allocation attempts failed before task start because OpenBao denied the JWT login. No campaign database or mathematical result was created.

Two deployment costs surfaced before that failure. Jupiter's cold Nix store spent most of the image-build wall time downloading the locked toolchain. The clean host Elenx checkout also lacked workspace dependencies, so the first freeze could not import `elenx/pi`. Running the installed coordinator's pinned Bun 1.3.14 with `bun install --frozen-lockfile` repaired that preflight while leaving the Git checkout clean.

## Remaining production action

The frozen pilot can resume without changing its inputs, image, or template after an authorized operator installs and reads back the exact `elenx-pool` OpenBao JWT role and policy under the controlled root-token ceremony. The role must bind audience `openbao.nomad.fleet`, namespace `default`, job ID `elenx-pool-*`, and task `worker`, with only the `nomad-elenx-run` policy. Resume must first confirm that generation 1 has no active allocation.

After the six runs finish, the operator should rebuild catalog schema V2 through a compatible Observer, adjudicate each terminal candidate by exact bytes, and report procedural outcome, external verdict, usage, and provenance separately.

During diagnosis of the JWT failure, a secret-bearing OpenBao configuration was mistakenly rendered into the tool transcript. This document does not reproduce the value. An authorized operator should rotate the exposed credential through the controlled OpenBao ceremony.
