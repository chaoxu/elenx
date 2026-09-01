# V17 evaluation and lifecycle repair, 2026-08-29 to 2026-08-30

## Outcome

This evaluation found that the V17 mathematical architecture was viable, while its note lifecycle and call routing were not yet safe. Two local commits repaired the failures observed in the first evaluation pass:

- `391bd7e` — give criteria matching the exact stored proof, align serve with summary visibility, and stamp the replay-determining call surface
- `ef661bb` — make notes immutable, preserve dependency edges, support same-turn dependencies, separate local verification from campaign completion, require truth-establishing verification, and make boundary attempts progress monotonically

An external follow-up audit then found five scoped defects in standing, dependency validation, suppression, and replay protection. The first local repair addressed those defects under `immutable-notes-scoped-boundary-proof-dependencies`.

Issues 34–40 and the final live-smoke audit produced the current call surface, `certified-statements-durable-control-budgeted-noncircular-proof-tower-repair`. It retains curator ingest, separate serve, five boundary judgments, and verified ancestor closure while adding proposition-only statement proposals, structured statement certificates, append-only re-triage, durable failure reasons, size-checked expansion, noncircular reconstruction, conservative candidate-trust downgrades, logical-premise-only dependencies, proof-tower recovery for no-premise reconstruction failures, and a turn ceiling.

The first repaired snapshot passed 73 tests with 951 assertions. The final tree passes 92 kernel tests and 94 solver tests with 1,284 solver assertions, strict TypeScript, formatting, package installation, package-content checks, CLI execution, and the execution contract. Earlier Luna process smokes remain historical evidence for multi-turn accumulation. The final prime smoke below supplies the live gate for the current call surface.

The final smoke at `runs/smoke-infinite-primes-v17-logical-dependencies-20260830-1/` solved in one explorer turn. Curator ingest stored the proposition-only statement `There are infinitely many prime numbers.` while the exact note text retained the full Euclidean proof. Local and boundary proof audit returned `PROPOSITION_ONLY` and `MATCH`. Boundary reconstruction received the exact task with an empty premise list and no proof text. All five boundary modes passed. The run used 10 measured provider requests, 10,703 tokens, an estimated $0.0054636, zero request errors, and exact peak concurrency one.

Every call-surface change invalidated only strict solver replay for earlier databases; their append-only journals remain inspectable evidence. Each subsequent smoke and theorem attempt therefore started from a fresh database. The final W[1]-hardness attempt and its audited result are recorded below.

## Exact target

The hard target remained:

> Let n distinct people occupy n seats arranged in a cycle, and let 2k of them form k couples. A swap exchanges the occupants of any two seats. The algorithmic problem is to find a shortest sequence of swaps after which the two members of every couple occupy adjacent seats. Show this problem is W[1]-hard with respect to n-2k.

The completion criteria require a complete parameterized reduction, an exact source-hardness citation, both correctness directions, FPT construction time, an output-parameter bound in terms of the source parameter, a precise budgeted decision version, and the transfer to shortest-sequence optimization.

## Campaign inventory

All campaign artifacts live under ignored `runs/` directories and are absent from Git commits.

| Campaign | Purpose | Result |
| --- | --- | --- |
| `runs/smoke-infinite-primes-v17-20260829-1/` | Luna-low initial smoke | Paused after 12 explorer turns. Ten notes were refuted. No candidate. |
| `runs/smoke-infinite-primes-v17-20260829-2/` | Mixed Sol/Luna prime smoke before repair | The first correct proof passed four boundary modes and failed criteria matching because that call saw only the curator summary. |
| `runs/smoke-infinite-primes-v18-20260829-1/` | Temporary exact-text criteria experiment | Solved after three turns. Serve still delayed because it saw only summaries. |
| `runs/smoke-infinite-primes-v19-20260829-1/` | Temporary serve-prompt experiment | Solved in one turn. The behavior was folded back into direct-update V17. |
| `runs/smoke-infinite-primes-v17-unguided-20260829-1/` | Unguided direct-provider prime smoke | Solved in one turn before the final call-surface stamp. |
| `runs/smoke-infinite-primes-v17-surface-20260829-1/` | Stamped direct-provider prime smoke | Solved in one turn. |
| `runs/cyclic-couple-w1-v17-20260829-1/` | Sol/max theorem attempt through direct `openai-codex` | Transport blocked. Two approximately 15-minute streams failed inside one logical call. |
| `runs/cyclic-couple-w1-v17-high-20260829-1/` | Sol/high explorer fallback through direct `openai-codex` | Four turns produced verified lemmas and gadget obstructions, but no candidate. |
| `runs/couples-swap-w1-final-20260828/` | Preserved V15 codex-lb comparison | Solved after three standalone candidates. The first two failed proof audit and were repaired. |
| `runs/smoke-infinite-primes-v17-codex-lb-20260829-1/` | Restored codex-lb smoke | Solved after the lab CA was supplied to Bun. |
| `runs/cyclic-couple-w1-v17-codex-lb-20260829-1/` | Pre-lifecycle-repair V17 theorem run through codex-lb | Generated a full proof that passed proof audit, refutation, and source verification, then lost it from the live projection through destructive refinement. |
| `runs/smoke-luna-two-turn-v17-20260830-1/` | First immutable-note Luna process smoke | Solved in exactly two explorer turns. |
| `runs/smoke-luna-two-turn-v17-20260830-2/` | Final stamped Luna process smoke | Solved in exactly two explorer turns with zero errors. |
| `runs/smoke-luna-two-turn-v17-post-audit-20260830-1/` | Post-audit final-surface Luna smoke | Solved in exactly two explorer turns with 19 requests, 15,119 tokens, and zero errors. |
| `runs/cyclic-couple-w1-v17-fixed-20260830-1/` | Fresh repaired-V17 theorem run through codex-lb | Paused during verification under the preceding call surface. Do not resume after the stamp change. |
| `runs/smoke-infinite-primes-v17-control-plane-20260830-1/` | First Issues 34–40 smoke | Solved, but inspection found that curator `statement` contained the full proof and reconstruction received a goal-equivalent ancestor. Rejected as a valid smoke. |
| `runs/smoke-infinite-primes-v17-noncircular-20260830-1/` | Noncircular reconstruction smoke | Solved with empty boundary premises, but curator still copied the full proof into `statement`. Rejected as a statement-channel failure. |
| `runs/smoke-infinite-primes-v17-claim-extraction-20260830-1/` | Structured statement-certificate smoke | Reached `turn-limit` after 10 explorer turns because proof audit mistakenly classified the deliberately proof-bearing note text instead of the separate statement field. |
| `runs/smoke-infinite-primes-v17-statement-scope-20260830-1/` | Field-scoped statement smoke | Solved in one turn, then a frozen-diff review found that boundary task verdicts could mutate standing for a different stored proposition. Preserved but superseded. |
| `runs/cyclic-couple-w1-v17-statement-scope-20260830-1/` | Sol/max theorem attempt under the superseded standing rule | Interrupted during the initial explorer call when the scope mismatch was found. Never resumed. |
| `runs/smoke-infinite-primes-v17-candidate-trust-20260830-1/` | Candidate-trust prime smoke | Solved in one turn with proposition-only statement certificates, proof-blind empty-premise reconstruction, 9,012 tokens, and zero errors. |
| `runs/cyclic-couple-w1-v17-candidate-trust-20260830-1/` | Candidate-trust Sol/max theorem run | Produced two locally accepted standalone proofs, but both attached expanded repair notes as provenance dependencies and were mechanically blocked. Interrupted before spending on a doomed n14 audit. |
| `runs/smoke-infinite-primes-v17-logical-dependencies-20260830-1/` | Final current-surface prime smoke | Solved in one turn with a dependency-free proof, 10,703 tokens, and zero errors. |
| `runs/cyclic-couple-w1-v17-logical-dependencies-20260830-1/` | Final current-surface Sol/max theorem run | Result recorded in the final theorem section below. |

## Provider and transport findings

The successful V15 run used:

- provider `codex-lb`
- API `openai-responses`
- base URL `https://codex-lb.lab/v1`
- model `gpt-5.6-sol`
- reasoning `max`

Its successful logical calls lasted about 60, 28, 12, 14, 80, 10, 5, and 16 minutes. Long calls were therefore part of the working V15 regime.

The first V17 theorem attempt used direct `openai-codex` at `https://chatgpt.com/backend-api`. Its initial logical explorer call made two provider requests and failed after about 30 minutes with a socket-closure error. Each underlying stream ended near 15 minutes. The campaign-level retry was stopped rather than spending through the default twelve consecutive attempts.

Switching settings to `codex-lb` initially failed credential preflight. Saturn could read the canonical OpenBao record `codex-lb/api-key`, but Pi had no Elenx-selected custom model configuration. An ignored model file now resolves its API key at request time with:

```text
/usr/local/bin/fleet-secret get codex-lb/api-key --field=key
```

No key is stored in the repository or command arguments.

Bun then failed TLS with `unable to get local issuer certificate`. Curl worked because macOS trusted the private lab CA, while Bun did not inherit that trust. The ignored public CA copy has the verified identity:

```text
subject=CN=Caddy Local Authority - 2026 ECC Root
SHA256=CC:65:CD:E2:3E:62:EE:CA:EE:2F:FA:C1:87:FA:89:F3:5F:80:44:A0:35:AF:79:2C:4E:FD:91:E0:0F:6B:45:B2
```

Runs now set `NODE_EXTRA_CA_CERTS` to that public certificate. The restored codex-lb path completed max-reasoning calls longer than 15 minutes and reproduced the long-call behavior seen in V15.

## Context length and request-layer attribution

The observed `context_length_exceeded` errors did not come from an Elenx smoke, theorem campaign, or audit agent. Codex-lb recorded nine such errors from 2026-08-29 18:48 UTC through 2026-08-30 11:55 UTC. Every row was untagged `gpt-5.6-luna` at low reasoning with `useragent_group=happy-codex`, and every request was rejected before usage accounting. No local Elenx journal contains that error, and no tagged `elenx-solve/*` request has it.

Logical calls and provider requests must be counted separately. One Elenx logical call can contain an in-call recovery request and one or more length-continuation requests.

V15 was not transport-clean. Its initial logical explorer call failed after 103.3 seconds following one short upstream-unavailable request and one `stream_incomplete` request. The campaign retry used identical call bytes, reached the 128,000-token output limit in one provider request, and completed through a continuation request.

The repaired hard V17 run also recovered inside its initial logical explorer call. One provider stream failed after about 22.7 minutes. The recovery reached the 128,000-token output limit after about 57.8 minutes, and a continuation with 128,713 input tokens submitted successfully after another 31.5 seconds. Later explorer calls also succeeded. This explains how the outer campaign can report a successful logical call while inspection still records a provider-request error.

The 128,713-token continuation exposes a remaining headroom risk. It fits the model's 272,000-token context beside a 128,000 output allowance, while another full-length continuation would exceed that context. Pi currently learns this only after provider rejection instead of reducing the continuation allowance from the remaining context.

The repaired theorem run was untagged in codex-lb and had to be correlated by timestamps, user agent, and exact token triples. Future theorem attempts need one stable `elenx-solve/.../attempt-N` usage tag. The paused database ended at journal sequence 269 after `n14` passed proof audit and refutation while reconstruction remained inconclusive. It had no active process and no candidate, and it did not stop because of a context or transport failure. The current call-surface stamp now prevents resuming that database.

## Failure chronology inside pre-repair V17

### Criteria matching saw the wrong artifact

The first correct Sol proof of infinitely many primes was stored in full. Proof audit, reconstruction, refutation, and external-premise verification passed. Criteria matching received only the curator's short summary, concluded that definitions and the prime-divisor lemma were missing, and returned `FAIL` even though those items appeared in the stored proof.

Commit `391bd7e` changed criteria matching to receive both the problem statement and exact stored proof. Reconstruction remains proof-blind.

### Serve confused conclusion recognition with proof auditing

The serve curator saw only summaries. Its old prompt required that a summary satisfy every completion criterion, including details unavailable in a one-line index entry. It repeatedly asked explorers to rewrite an already complete prime proof.

Commit `391bd7e` made serve identify the requested conclusion, parameters, and direction from the summary. The boundary battery checks definitions, derivations, citations, and other proof-content requirements against exact bytes.

### Direct V17 updates silently rewound old journals

Prompt bytes determine replay, but rapid V17 updates retained the same public protocol name. Before the guard, an old V17 database could fail to match a settled call and project an earlier phase instead of failing visibly.

The campaign declaration now records a call-surface stamp. Parsing rejects an absent or disagreeing stamp before folding journal state. Generic append-only observation remains possible outside the strict solver projection.

### Local verification applied global completion criteria to every note

The first theorem turns produced valid lemmas, obstructions, and partial gadgets. Local proof verifiers often returned `FAIL` because a lemma did not itself provide a complete W[1]-hardness reduction. The local prompt included the full completion criteria and did not clearly separate note truth from campaign completion.

The repaired prompt gives local verifiers the problem as context and excludes the completion criteria. It states that a note may be a lemma, counterexample, repair, or partial result. Only boundary verification judges campaign completion.

### Refutation-only success created trusted premises

V17 previously marked a note verified whenever every planned mode returned `PASS`. A refutation-only plan could therefore create a trusted premise even though `PASS` meant only that one search found no counterexample.

Standing now requires proof audit or reconstruction. External-premise verification discharges source obligations without establishing the derivation by itself. Refutation-only and external-premises-only success leave the note a conjecture.

### Reconstruction treated an empty premise list as failure

Blind reconstruction saw a one-line statement and premise summaries. It frequently returned `INCONCLUSIVE` with “no premises define the construction,” rather than independently proving the claim. At the boundary it also received the curator summary instead of the exact problem statement.

Reconstruction now receives the exact problem at the boundary and is explicitly required to attempt a proof from definitions and first principles when no premises are given. Triage is told to select local reconstruction only when the summary and premises form a self-contained claim.

### Curator refinement destroyed a complete proof

The clearest failure occurred in `runs/cyclic-couple-w1-v17-codex-lb-20260829-1/campaign.db`:

1. Explorer event 183 produced a 19,347-byte complete reduction.
2. Curation 189 stored it as a refinement of `n4`.
3. Proof audit and refutation passed. External-premise verification later passed.
4. Serve requested another audit instead of declaring the goal.
5. Explorer 233 returned five local repair findings, all based on `n4`.
6. Curation 241 replaced `n4` with the first 870-byte preprocessing patch.
7. The other repair notes then depended on the overwritten patch rather than the full proof they had read.
8. The proof disappeared from the live store, though its raw journal bytes remained.

The curator could make this mistake because it saw only summaries while holding semantic refinement and duplicate authority. Fold-time refinement destructively replaced text and summary, did not update parents, and left child dependencies pinned only to mutable note IDs.

Commit `ef661bb` removed model-selected refinement and semantic deduplication. A note is now an immutable triple of curator statement, exact finding bytes, and resolved dependencies. Exact repeated triples are reused mechanically. A changed statement, text, or dependency set mints a new note.

### Same-turn proof chains lacked addresses

Explorers could report definition, lemma, and theorem in one turn, but `basedOn` accepted only note IDs that existed before the turn. Sibling findings therefore could not form a durable proof chain.

Findings now support backward one-based `basedOnFindings` references. Curation resolves them in finding order to immutable note IDs. Forward and unresolved references fail closed.

### Refuted dependencies were silently erased

The old fold dropped a dependency edge whenever the cited note was refuted. A child could then pass the boundary after its stated false premise vanished from its closure.

Every known dependency edge is now preserved regardless of standing. A refuted or unverified ancestor blocks mechanical closure.

### Local standing could veto the boundary

A mistaken local `FAIL` removed a possible goal from the live index before serve could invoke fresh boundary verification. This contradicted V17's stated division: local verification organizes knowledge, while the boundary owns completion.

Serve now receives every non-report mathematical note that has not already undergone the same boundary attempt, including locally refuted notes. A goal-looking note goes directly to the boundary. Scripted regression coverage shows that a local false `FAIL` cannot veto a later all-PASS boundary battery.

### Failed goals could loop unchanged

An unchanged note could be redeclared after a boundary `INCONCLUSIVE` or a mechanical ancestor gap, creating repeated candidate calls without new evidence.

Completed boundary attempts suppress the same immutable goal text from later serve calls. Mechanical gaps suppress the unchanged goal until the relevant ancestor standings change. Repaired or integrated mathematics mints a new note and remains eligible.

## Follow-up external audit and scoped repairs

The follow-up audit identified five defects that could be repaired inside the existing V17 workflow.

### Criteria mismatch contaminated mathematical standing

The boundary verdict loop applied every verdict to the goal note's local standing. A `criteria-match` failure therefore refuted a proof that had already passed the mathematical boundary modes merely because it omitted a completion requirement such as an explicit parameter bound.

Criteria matching now controls candidate acceptance and redeclaration suppression without changing mathematical standing. A regression confirms that a locally verified note remains verified after a boundary criteria mismatch while its candidate remains rejected.

### Unknown explorer dependencies could brick replay

The explorer's `basedOn` schema previously accepted any syntactically valid note ID. A model could cite a predicted future ID, journal a settled submission, and reach the fold-time unknown-ID exception on every later start, resume, or inspection.

`explorerSubmissionFor` now narrows `basedOn` to the non-report mathematical note IDs visible in that explorer call. Process reports remain visible as history but cannot become proof premises. Invalid dependencies fail inside the model-visible tool schema before a terminal submission can settle. Same-turn dependencies still use backward `basedOnFindings` positions.

### Source inventory alone could establish truth

An `external-premises`-only triage plan could receive a vacuous `PASS` when the offline auditor found no outside premises. That pass verified the note even though no verifier had checked its derivation.

Only proof audit or reconstruction can now establish a note's mathematical standing. External-premise and refutation checks remain required when triage selects them, but neither can establish truth alone. An external-premise `FAIL` leaves the note a conjecture instead of refuting its mathematical claim.

### Failed-proof suppression depended on note identity

Boundary suppression previously keyed on both note ID and exact answer bytes. Refiling identical proof bytes under a drifted curator summary minted a new note and made the same failed proof boundary-eligible again.

Suppression now keys on exact proof bytes across all note IDs. A new proof remains eligible when its bytes change.

### The call-surface stamp lacked a mechanical guard

The stamp relied on developers remembering to update it after a prompt, schema, label, or transport change. A forgotten bump could silently replay an old journal from the wrong phase.

`tests/call-surface-fixture.ts` now renders fixed synthetic calls for explorer, curation, triage, serve, every verifier mode and scope, offline premise audit, and isolated source checking. The corpus uses the same exact Pi request-and-tool identity that replay matches. Its SHA-256 cases also cover normalized schema output, representative schema-refinement acceptance, labels, actual stamp-derived cache keys, transport parameters, and the token-estimate boundary.

The immutable golden lives at `tests/fixtures/call-surfaces/<callSurface>.json`. The updater creates that file with exclusive-create semantics and refuses to overwrite a golden under the same stamp, so a prompt or schema change requires a call-surface bump. The corpus also calls the production renderers for mechanical gaps, boundary failures, defect reports, premise repairs, and source repairs, then pins their exact outputs rather than relying on substring assertions.

## Deferred cleanup findings

The approved Issues 34–40 repair added one append-only re-triage per stuck conjecture. The current plan and later verdicts supersede the earlier plan in the fold without mutating journal events. Mechanical-gap un-suppression now has a direct regression.

Lower-risk cleanup remains outside this repair: a defensive cycle gate is unreachable under the current topological mint rules, and local premise audits still receive task context through shared rendering. These items do not alter the live acceptance path and were left for later cleanup.

## Agent mock audits

Two independent agents audited the failed theorem journal and the proposed repair.

Fermat traced the destructive lifecycle at exact journal events and identified mutable note IDs, unchanged parents across refinement, same-curation semantic drift, curator decisions made without target text, semantic duplicate loss, refuted-edge deletion, local/global verifier contamination, and the inability to repair hidden refuted notes.

Banach supplied adversarial mocks and found additional soundness and liveness requirements:

- refutation-only `PASS` cannot establish truth
- curator summary participates in immutable identity
- same-turn proof chains need explicit addresses
- local standing cannot veto a goal
- unchanged boundary and mechanical failures need progress guards

Each item now has a deterministic regression test.

## Issues 34–40 and the control-plane repair

A later tracker review kept curator ingest, the separate serve call, five separate boundary judgments, and verified ancestor closure. Reviewers rejected goal nomination by explorers, merged proof/criteria/source verdicts, and provenance-only dependencies. They accepted a narrower triage prompt that chooses the smallest materially sufficient plan while retaining independent reconstruction for nontrivial reusable lemmas.

Issues 34–40 exposed three shared defects rather than seven unrelated features:

- Notes lacked a certified statement channel. Curator ingest now writes a short navigational summary and a proposition-only statement proposal. Provider-visible schema descriptions reinforce that boundary. Truth-establishing verifier submissions certify `PROPOSITION_ONLY` versus `CONTAINS_SUPPORT`; proof audit also certifies `MATCH` versus `MISMATCH`. The schema rejects a `PASS` with contaminated or mismatched statement fields.
- Serve lacked durable control state. Its compact view now carries dependencies, plans, exact verdict reasons, closure status, failed-candidate tombstones, note sizes, recent-note markers, and recent serve history. Reports and failed proofs remain expandable repair context. Serve may request one append-only re-triage of a stuck conjecture. A criteria-only boundary mismatch leaves premise trust unchanged. Any non-criteria boundary doubt conservatively returns a locally verified goal note to `conjecture`, so descendants cannot treat a rejected candidate as a verified ancestor without claiming that a possibly different curator proposition is false.
- Admission could fail after an irreversible decision. Serve now validates the actual rendered explorer context before an expansion becomes a settled submission. A frozen `maxExplorerTurns` ends unproductive search with the replay-stable terminal outcome `turn-limit`.

Every candidate non-`PASS` follows one control path: reject the candidate, preserve its exact reason, suppress unchanged bytes, and require changed proof or evidence. `FAIL` and `INCONCLUSIVE` remain distinct evidence labels, but there is no automatic same-byte retry branch. This deliberately rejects the retry mechanism proposed in issue 38 while retaining its durable-repair-context requirement.

## Final live-smoke corrections

The first post-control-plane prime database reached `solved`, but inspection rejected the result. Curator ingest had copied the entire Euclidean derivation into `statement`, and the goal note depended on an earlier note asserting the same conclusion. Boundary reconstruction could therefore receive the target as a given premise. The fold now removes byte-exact target statements from local and boundary reconstruction, while the verifier ignores semantic restatements, paraphrases, conjunctions, bundled target claims, and conclusions leaked through proof material. The problem and completion criteria are explicit obligations rather than premises.

Prompt wording alone did not keep Luna from copying a proof into `statement`. The curation schema now describes the field as a theorem, lemma, claim, or process status with hypotheses and conclusion but no support. Existing proof-audit and reconstruction calls gained structured statement certificates instead of adding another phase. Proof-audit `PASS` requires `statementForm=PROPOSITION_ONLY` and `statementFidelity=MATCH`; reconstruction `PASS` requires `statementForm=PROPOSITION_ONLY`.

The next live run reached `turn-limit` for the opposite reason. Curator statements were clean, but proof audit classified the exact note text and rejected it for containing the proof that the note text is supposed to contain. The statement-certificate schema and prompt now scope `statementForm` only to the separately labeled statement field. Exact note text is explicitly expected to contain derivation, evidence, reasoning, and justification.

A frozen-diff reviewer then found a trust-subject mismatch. Boundary modes audit the exact campaign target, while a curator's stored proposition can differ if serve declares the wrong note. Applying a task-level `FAIL` as though it refuted the stored proposition was unsound; ignoring it left a boundary-rejected proof eligible as an ancestor. The fold now keeps boundary verdicts candidate-scoped. A criteria-only mismatch affects acceptance and suppression only. Any other boundary non-`PASS` downgrades a locally verified goal note to `conjecture`, which blocks verified-ancestor closure without asserting that its separate stored proposition is false.

The final theorem run exposed one more prompt-level liveness defect. Explorers repeatedly produced standalone replacement proofs but attached every expanded repair note as `basedOn` provenance. The fold correctly interpreted those edges as logical premises and blocked the goal because they led back to a rejected ancestor. The explorer prompt and provider-visible tool schema now define `basedOn` and `basedOnFindings` as logical premises only. Reading, copying, repairing, or independently re-establishing mathematics from an expanded note creates no edge. A standalone proof containing every load-bearing argument uses empty dependency arrays.

The next current-surface theorem run then produced two dependency-free proofs that passed local and boundary proof audit, but proof-blind reconstruction returned the same non-mathematical objection: with no premise statements, it would have to rediscover an entire research reduction from first principles. Rewriting the standalone proof cannot change that input. The existing workflow can address it only through a verified proof tower. Serve and explorer now translate that exact failure into a staged repair: mint independently checkable load-bearing lemmas, verify them, then write a goal note whose logical dependencies are those verified statements and derive the campaign conclusion from them.

The current regressions cover exact target removal locally and at the boundary, the semantic target-exclusion instructions, statement-form and fidelity consistency, proof-bearing note text, task-versus-note scope, criteria-only neutrality, boundary-doubt trust revocation, and a descendant mechanically blocked from using a boundary-rejected ancestor.

Three residual limits remain explicit. Semantic target inclusion beyond byte equality is model-judged: a premise such as `P and Q` remains in the prompt for target `P`, with an instruction to ignore it. Absolute exclusion would require removing useful ancestor premises or adding a formal proposition language, both workflow changes outside this repair. Boundary mathematics intentionally targets the exact campaign problem rather than the curator proposal; a malformed locally rejected proposal can still reach the boundary when its exact proof bytes solve the task, so the accepted proof may coexist with malformed metadata. A non-criteria boundary doubt permanently removes premise trust for that immutable note. Recovery requires changed proof bytes in a new note rather than re-running the same candidate.

## Deterministic validation

The final solver suite contains direct regressions for:

- immutable curator behavior
- exact triple deduplication
- statement-sensitive identity
- same-turn definition → lemma → goal dependencies
- refutation-only standing
- local `FAIL` followed by successful boundary verification
- unchanged failed-goal suppression
- unchanged mechanical-gap suppression
- hidden-note and report-note premise rejection with resumable invalid submissions
- byte-exact replay at multiple cuts
- candidate proof visibility and proof-blind reconstruction
- criteria mismatch without standing contamination
- explorer dependencies narrowed to visible note IDs
- external-premises-only standing
- byte-exact failed-proof suppression across note IDs
- an immutable golden call-surface corpus keyed by the stamp
- source-check isolation
- retry, cancellation, index-limit, and process-lock behavior

Result before the follow-up audit:

```text
73 tests passed
0 tests failed
951 assertions
```

First post-audit result:

```text
80 tests passed
0 tests failed
1,063 assertions
```

Formatting, strict TypeScript, package installation, package contents, CLI help, and execution-contract checks also passed on the post-audit tree.

Issues 34–40 result before live campaigns:

```text
87 tests passed
0 tests failed
1,159 assertions
```

Final result after the live statement, reconstruction, and candidate-trust audits:

```text
92 kernel tests passed
94 solver tests passed
0 tests failed
1,284 solver assertions
```

## Live weak-model validation

The controlled task was:

> Prove that for every integer n >= 1, the sum of the first n odd positive integers is n^2.

Luna-low was instructed to produce only a base case and induction-step lemma on an empty index, linking the second finding to the first with `basedOnFindings`. On the next turn it had to produce one integrated proof using the verified notes.

Both fresh runs reached `solved`. The final stamped run `runs/smoke-luna-two-turn-v17-20260830-2/` recorded:

- explorer turn 1: `n1` base case and `n2` induction step
- dependency: `n2 → n1`
- explorer turn 2: integrated proof `n3`
- dependencies: `n3 → n1,n2`
- all three notes verified
- immediate goal declaration for `n3`
- boundary proof audit, reconstruction, refutation, external premises, and criteria match all `PASS`
- 18 measured requests
- 14,369 total tokens
- about $0.0058 estimated cost
- zero request errors
- exact peak concurrency one

This run established that the preceding V17 call surface could accumulate partial knowledge, preserve its proof graph, integrate the result, and terminate through the boundary with a weak model. The follow-up fixes changed replay-determining schemas, so the result required confirmation under the final stamp.

The post-audit run repeated that process under `immutable-notes-scoped-boundary-proof-dependencies`. Its journal ended at sequence 121 with candidate 86 solved. The Codex-LB requests used the stable tag `elenx-solve/smoke-v17-post-audit/attempt-1`. That run predates the final statement and candidate-trust corrections and remains historical multi-turn evidence.

The final current-surface prime run used tag `elenx-solve/primes-v17-logical-dependencies/attempt-1`. Its journal ended at sequence 69 with candidate 32 solved. The single note stored statement `There are infinitely many prime numbers.` and retained the full self-contained Euclidean derivation in exact text. Local proof audit and boundary proof audit recorded `PROPOSITION_ONLY` and `MATCH`. Reconstruction saw the exact task, `[]` premises, and no proof text. The run recorded 10 measured requests, 10,703 tokens, estimated cost `$0.0054636`, zero errors, and exact peak concurrency one. This is a workflow smoke and an independently reconstructed elementary proof, not evidence for the separate W[1]-hardness theorem.

## Git and publication state

The repair series and this record travel together on `main`. Immutable call-surface fixtures bind the current prompts, schemas, labels, transport settings, and fold-authored repair text to the code under test. Live run artifacts and the Elenx-specific codex-lb model and CA files remain ignored under `runs/`.
