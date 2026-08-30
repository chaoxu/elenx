# V17 evaluation and lifecycle repair, 2026-08-29 to 2026-08-30

## Outcome

This evaluation found that the V17 mathematical architecture was viable, while its note lifecycle and call routing were not yet safe. Two local commits repaired the failures observed in the first evaluation pass:

- `391bd7e` — give criteria matching the exact stored proof, align serve with summary visibility, and stamp the replay-determining call surface
- `ef661bb` — make notes immutable, preserve dependency edges, support same-turn dependencies, separate local verification from campaign completion, require truth-establishing verification, and make boundary attempts progress monotonically

An external follow-up audit then found five scoped defects in standing, dependency validation, suppression, and replay protection. The final local repair addresses those defects without changing the exploration workflow. The call surface is now `immutable-notes-scoped-boundary-proof-dependencies`.

The first repaired snapshot passed 73 tests with 951 assertions, strict TypeScript, formatting, package installation, and the CLI contract check. The post-audit repair passes 80 tests with 1,063 assertions and the same non-test gates. Two earlier Luna process smokes solved the same deliberately two-turn induction problem through codex-lb. The second used 18 measured requests, 14,369 tokens, about $0.0058, zero request errors, and exact peak concurrency one. Both predated the final call surface; the post-audit smoke below supplies the final live gate.

The post-audit smoke at `runs/smoke-luna-two-turn-v17-post-audit-20260830-1/` solved the same controlled induction task under the final call surface. It used two explorer turns, three verified notes, 19 measured provider requests, 15,119 tokens, an estimated $0.00616, zero request errors, and exact peak concurrency one. The candidate passed proof audit, reconstruction, refutation, external-premises, and criteria matching.

The repaired-V17 W[1]-hardness run was paused during verification. The follow-up stamp change intentionally makes that database non-resumable under the current call surface. A future theorem attempt must start from a fresh database.

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

## Deferred workflow and cleanup findings

The audit also confirmed a missing re-triage path. An immutable note with a poor original verification plan cannot acquire a new plan, so recovery requires minting a replacement note. Adding re-triage would change the V17 workflow and remains deferred for discussion.

Lower-risk residue also remains outside this repair: the boundary criteria prompt describes the problem statement as if it were a candidate statement, fold state retains unused refutation bookkeeping and a defensive cycle gate, mechanical-gap unsuppression lacks a direct regression, and local premise audits still receive completion criteria through the shared task renderer. These items were recorded rather than folded into the scoped repair.

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

Post-audit result:

```text
80 tests passed
0 tests failed
1,063 assertions
```

Formatting, strict TypeScript, package installation, package contents, CLI help, and execution-contract checks also passed on the post-audit tree.

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

The post-audit run repeated that process under `immutable-notes-scoped-boundary-proof-dependencies`. Its journal ended at sequence 121 with candidate 86 solved. The Codex-LB requests used the stable tag `elenx-solve/smoke-v17-post-audit/attempt-1`. This is a workflow smoke, not evidence that the separate W[1]-hardness theorem has been proved.

## Git and publication state

The local repair series consists of the two earlier commits and the commit containing this record:

```text
391bd7e Align goal selection with stored proof verification
ef661bb Make V17 notes immutable and boundary-driven
this commit — Repair V17 standing, dependencies, suppression, and replay guard
```

No commit in this series has been pushed. Live run artifacts and the Elenx-specific codex-lb model/CA files remain ignored under `runs/`.

This record closes the local evaluation. Publication remains a separate operator decision.
