# Elenx system review — 2026-08-19

## Goal and truth boundary

Elenx exists to help turn sustained model reasoning into correct, auditable mathematical resolutions. It should make it harder to change the problem, hide a proof obligation, reuse an unrelated judgment, or mistake an interrupted call for evidence. It cannot make an LLM verdict true: all model verifiers may be wrong and may fail in correlated ways. A candidate marked `verified` has satisfied the frozen workflow's durable admission rules, not acquired a known probability of mathematical correctness.

The campaign database stores candidate material, prompts, requests, transcripts, tool inputs and results, verdict evidence, telemetry, and pre-send payloads in plaintext. Built-in adapters keep credentials outside those payloads, but the application and custom adapters are trusted not to insert secrets. Append-only application semantics are not tamper resistance: an application or operator that edits SQLite is outside the supported trust boundary.

## Integrated stack

| Component | Audited pinned code revision | Authority | Contribution to the goal |
|---|---|---|---|
| `elenx` | `41a504b436141e50b55ba9967944b87273a31acb` | Exact candidate bytes, append-only calls and admitted tool effects, candidate-bound verdict admission, derived status, Pi request checkpoints, and settled telemetry | Preserves what was attempted and judged so a result can be audited and resumed without inventing history |
| `elenx-solve` | `1129111c0a48e39ea27256f7dcf30583da8d361c` | Workflow 15, frozen task and runtime declarations, episode and repair control, verifier prompts, blind reconstruction, and application-specific evidence validation | Applies distinct checks to the exact mathematical artifact and keeps reconstruction information-separated from candidate proof text |
| `elenx-observe` | `aeec7b15d58dd4fcb6a6f079864176fba48958ed` | Read-only projection of the pinned solver and kernel records | Lets a human inspect claims, calls, spend, status, and unresolved history without creating a second mutation or truth authority |

The pin chain is exact: the solver pins kernel `41a504b…`; the observer pins solver `1129111…` and resolves kernel `41a504b…`. These revisions are committed and pushed. They are not tagged, released, or deployed.

## What stayed and why

| Mechanism | What it establishes | Why it helps |
|---|---|---|
| Frozen problem, completion criteria, sources, candidate bytes, backend, and resolved model profiles | The task, artifact, and declared runtime descriptor cannot drift silently during resume | A later PASS can be traced to the exact question, answer, evidence packet, and execution choice it judged |
| Strict `elenx/pi-run/v1` and `elenx/pi-request/v1` discriminators | Ordinary calls cannot be mistaken structurally for Pi calls or request checkpoints | Spend and recovery projections remain tied to the intended protocol without private writer machinery |
| Candidate-bound verdicts from fresh successful calls | A verdict names the exact candidate and a settled verifier execution | Old or unrelated judgments cannot silently verify new candidate bytes |
| Generic returned-tool submission validation | Structured submissions require exactly one matching tool call and returned result | Application protocols can reuse one small settlement rule without kernel knowledge of solver-specific verdict shapes |
| Reconstruction-input certification | The candidate-authored claims, dependencies, definitions, guidance, and selected sources are checked for completeness and proof leakage before blind use | Blind reconstruction receives enough information to attempt the task without being handed the candidate proof |
| Hostile candidate audit | The exact candidate is checked against the target, edge cases, quantifiers, algorithms, and finite obligations | Reconstruction packaging cannot fill a mathematical hole in the submitted answer |
| Candidate-blind reconstruction | The theorem-class claims and named dependencies must be recovered from the certified input rather than copied from candidate proof text | A second derivation path can expose missing hypotheses, unjustified dependencies, and non-reconstructible claims |
| Candidate-blind reconstruction audit | The reconstructed argument is checked using only the certified input and reconstruction | Defects in the separately generated derivation cannot be hidden by the original candidate or its audit transcript |
| Durable reconstruction-evidence validation | Certification ownership and PASS, exact inputs, successful and unique reconstruction, causal order, and the final settled structured submission are checked before verdict admission | The reconstruction-audit verdict has inspectable provenance; this validates record linkage, not mathematics |
| Exact-content rejection guards | Proof content that failed hostile audit cannot be resubmitted under changed packaging | A hostile-audit rejection cannot be laundered through a new reconstruction specification |
| One proof-content-pinned specification repair | One certification-only packaging defect may be repaired without changing proof content | It may save a full proof-regeneration call while remaining a bounded authoring optimization, never correctness evidence |
| Strict database admission and byte copying | Unsupported WAL state, auxiliary files, schema drift, and hostile typed-array behavior are rejected without mutating the artifact | Durable evidence is not silently recovered or rewritten under assumptions the current package does not support |
| Explicit unknown-effect recovery boundaries | An unsettled call, checkpointed request without outer result, or tool call without result stops for reconciliation | Ambiguous provider spend or external effects are not treated as harmless retries |
| One recovery budget and one 32-turn ceiling | `maxRecoveries` covers both length and retryable-provider recovery, while all re-entries share the same operation cap | Operational resilience remains bounded and cannot multiply work through nested continuation counters |
| Exit-75-only supervisor restart | Only a settled provider-retryable failure restarts automatically; signals and forced cleanup stop | Hard interruption cannot silently repeat an execution whose outcome or spend may be unknown |
| Read-only observer projection | The browser model omits runtime `api` and `baseUrl` and cannot write campaign state; it may still expose responses, tool data, errors, and verdict evidence | Inspection cannot change the evidence being inspected, while route access remains part of the confidentiality boundary |

Fresh verifier calls using the same model and profile are information-separated in places, but they are not statistically independent. A frozen runtime descriptor improves provenance and configuration consistency, not output reproducibility or verifier reliability.

## Older-world machinery removed

The route, frontier, gate, explorer, synthesis, standing-result, and mutable-ledger system had already been retired. This cleanup removed newer residue that still encoded assumptions from that world:

- the private exact-writer and reserved `elenx/` label mechanism, which obstructed legitimate application decorators without defending against a trusted same-process application;
- fixed verdict-extraction helpers, replaced by one generic returned-tool submission rule;
- the source-line ratchet, which rewarded compression rather than correctness;
- the citation and reconstruction-comparison stages, whose responsibilities are now expressed through certification, named-dependency obligations, reconstruction, and reconstruction audit;
- `premises`, per-stage assurance profiles, multiple specification-repair rounds, and accumulated rejection digests;
- mutable provider-endpoint selection and ambient-key backend switching, replaced by an explicit frozen backend and resolved research and assurance profiles;
- supervisor restarts after unexpected signals; and
- the generic evidence-binding roadmap item, because the live application now validates its one concrete evidence shape directly.

Historical `evals/` records retain their original workflow names, model choices, and outcomes as provenance. They do not define current behavior.

## Issues that remain

These are risks to measure or boundaries to preserve, not a backlog of speculative framework features:

1. **False acceptance remains possible.** Correlated LLM verifiers can agree on a wrong proof, and current tests do not calibrate a correctness probability.
2. **Information separation may add less value than its cost.** Blind reconstruction and its audit are plausible defenses, but their unique defect yield has not been measured on an externally truth-labelled cohort.
3. **Certification may be too weak or too strict.** A packet can leak proof content through guidance, omit necessary scope, or become so constrained that a correct result is no longer reconstructible.
4. **Specification repair is an unvalidated optimization.** It preserves exact proof content by construction, but its success rate and savings versus regenerating the proof are unknown.
5. **Simpler repair context may increase cycling.** Removing accumulated rejection digests bounds prompt growth, but semantically repeated failed approaches may recur under byte-different wording.
6. **Provider reliability and recovery budgets are uncalibrated.** Sixteen recoveries and the aggregate 32-turn ceiling are safety choices, not measured optima; backend-specific failure rates may differ.
7. **Crash ambiguity cannot always be eliminated.** Some durable prefixes prove that dispatch or an external effect may have happened without proving its outcome. Correct behavior there is an explicit unresolved stop.
8. **External artifacts are outside the current evidence shape.** No live verifier requires generic artifact digests and rehashing. That capability should return only with a concrete second evidence shape or an artifact-bearing verifier.

## Hypotheses worth testing

Each evaluation needs frozen candidates, prompts, revisions, profiles, cost rules, and an external truth label assigned without seeing workflow verdicts. Missing usage is unknown, never zero. A model PASS is an observation to compare with the truth label, not the label itself.

| Hypothesis | Primary measurement | Decision rule |
|---|---|---|
| Workflow 15 rejects real mathematical defects while retaining correct controls | False accepts and false rejects on problem-family-separated correct, mathematical-defect, dependency-defect, target-mismatch, leaky-specification, and underspecified packets | Any externally confirmed false accept blocks a correctness claim; report performance by defect class rather than one aggregate score |
| The blind-reconstruction tail adds unique assurance | Externally confirmed defects first exposed by reconstruction and by reconstruction audit after certification and hostile audit passed | Ablate each stage on the same preregistered cohort; keep or redesign each stage according to its marginal defect yield and cost |
| Certification enforces useful information separation | Leakage escape rate, complete-packet rejection rate, and successful reconstruction rate for certified non-leaky packets | Revise the contract if leakage passes or correct complete packets become systematically unreconstructible |
| One specification repair beats full proof regeneration for packaging-only failures | Paired verification outcome, exact proof-content equality, provider-reported usage priced under the frozen cost rules, and latency from the same rejected prefix | Retain it only if it does not add false accepts, loses no verified successes, preserves proof bytes, and materially lowers cost |
| One strong assurance profile is worth its cost | Externally adjudicated decision differences and complete provider-reported usage priced under the frozen cost rules against a cheaper hostile-audit profile | Change production only if the cheaper profile adds no misses in a preregistered confirmation cohort and achieves the stated saving |
| Removing rejection-history digests does not worsen cycling | Rate of semantically repeated failed routes, prompt growth, and cost per verified or terminal run before and after the change | Restore only a small fixed history tail if cycling rises materially; do not restore unbounded accumulation |
| Recovery preserves semantic state | Candidate, call, tool, verdict, spend-classification, and status projection after deterministic faults at every documented boundary | Require exact equivalence at safe boundaries, no replay of settled phases, and explicit stop at every unknown-effect boundary |
| Backend and recovery settings affect operational completion without changing admissible semantics | Settled retryable-failure rate, repeated unknown-spend rate, completion rate, turns, and cost by backend and recovery budget | Choose the backend and lowest recovery budget that preserve completion at the lowest cost; any semantic-status divergence is a bug, not a tuning result |

Small correlated cohorts cannot justify high-confidence reliability claims. With zero observed failures, roughly 300 effectively independent cases are needed before even a one-sided 95 percent upper failure bound approaches one percent.

## Tracker disposition

Elenx issue #2 is superseded, not implemented. Workflow 15's application-specific `elenx-solve/reconstruction-evidence/v1` validator resolves the only current evidence-link integrity need. The proposed generic nonempty-claims graph, arbitrary tool-reference schema, external-artifact digests, resolver, and rehashing suite were not built. A new issue is warranted only when a concrete second evidence shape or external verifier needs them.

No open tracker issue remains solely to preserve a hypothetical platform layer. The unresolved risks above belong first in preregistered evaluations; a failed experiment or concrete second consumer can create a narrowly scoped implementation issue.

## Recovery interpretation

| Durable prefix | What is known | Safe next action |
|---|---|---|
| No call row | No Elenx call began | Application policy may start a new call |
| Call without result | Runner outcome and possible external spend are unknown | Reconcile externally or leave unresolved; do not assume retry is harmless |
| Completed Pi request checkpoint without outer result | A dispatchable payload existed; provider receipt, outcome, and spend remain unknown | Report possible spend and resume only under explicit application policy |
| Tool call without tool result | The external effect is unknown | Reconcile using an application-stable semantic key; the kernel does not replay it |
| Successful call result without verdict | Verifier execution settled but admission was interrupted | Validate the stored submission or deterministic receipt, then append the missing verdict without rerunning the verifier |
| Closed supported campaign | SQLite recovery is complete | Open read-only or copy the single database file with the matching package revision |
| WAL-format header or `-wal`/`-shm` entry | The artifact is outside the supported DELETE-journal contract | Preserve it unchanged; checkpoint and convert only an operator-controlled copy with trusted SQLite |

## Verification and publication state

| Scope | Local result on `saturn` | Gitea Linux CI |
|---|---|---|
| Elenx `41a504b…` | Formatting, strict source and consumer typechecks, 61 tests, and tarball-installed consumer smoke passed; `bun audit` found no vulnerabilities | Run 3230 passed |
| elenx-solve `1129111…` | Formatting, strict typecheck, 76 tests, package dry-run, three CLI smokes, frozen exact kernel install, and dependency-graph check passed; `bun audit` found no vulnerabilities | Run 3231 passed |
| elenx-observe `aeec7b1…` | Formatting, strict typecheck, 21 tests, package dry-run, CLI smoke, and a single exact solver/kernel dependency graph passed; `bun audit` found no vulnerabilities | Run 3232 passed |

A fresh disposable checkout of all three exact remote revisions completed frozen installs, dependency audits, and the full 61-, 76-, and 21-test checks. Its observer dependency graph contained exactly solver `1129111…` and kernel `41a504b…`; the temporary checkout was then removed. Commits, pushes, CI, tags, releases, and deployments are distinct states: the three revisions above are committed, pushed, and green in CI; no tag, package release, or deployment was made.

The documentation-only commit containing this review moves `elenx` `main` beyond audited and downstream-pinned code revision `41a504b…`. The solver and observer remain pinned to `41a504b…` because the later kernel change does not alter package code or metadata.

The retired workflow-10 observer was a separate legacy deployment, not a deployment of the revisions above. Fleet Infra revision `58989dad7eb00f84113e0949e3eedae8351aea6e` removes its LaunchDaemon source, Caddy route, service-registry entry, Prometheus target, and Nix wrapper. On 2026-08-19 the running campaign-40 daemon was booted out on `saturn`, port 8796 closed, and its installed plist was retained as `/Library/LaunchDaemons/com.chaoxu.elenx-observe.plist.retired-20260819`. Its 527 KiB log was moved to Trash. The route and installed app tree were removed from `jupiter`; the lab index and Prometheus expose no Elenx observer entry, and the unbound HTTP route returns 404.

Historical campaign databases 39 and 40 remain in place with SHA-256 `c11ae1ae2f98f2cf52a072ff2e067d6794b4405bb96a54b296902ba8440f5784` and `5ffff374847bea0b94d7b6edb185770f0a7a66673d4daea24b03e67ba1d61b21` respectively. They are Git-ignored evidence, so Fleet Infra revision `fef5c5eec8abcbff948ca0cfb45ee859c0edfe4f` adds `elenx-solve/evals/runs/` to the daily `saturn-unique` backup. Restic snapshot `c97751de` on `jupiter` contains both database paths, streaming both files from the snapshot reproduces both hashes, and the encrypted repository copy on `polaris` passed a complete manifest comparison with SHA-256 `ad991ae10f1c9b145fcfde7bdb66fbf351fa7c85458f2db1a403ddc2e3e69ebd`.

The fleet retirement's focused registry, route-agreement, formatting, and no-build flake checks passed. Fleet CI runs 3233 and 3235 exposed a pre-existing incomplete `msglog` backup record; revision `d8c4f634ab6fb9cec9bfc482bb591c656da85bb2` repaired that record and a masked command-substitution status. Run 3236 then exposed a second pre-existing defect: the isolated Caddy validation fixture imported the host-owned `msglog-auth.caddy` file. Revision `87e4f2aa1d4635243efdb7ad594516510eb7967c` removed that fixture import without changing production authentication, and CI run 3237 passed. The live Caddy reconciler still reports unrelated `cli-proxy.caddy` drift, which this cleanup did not modify.
