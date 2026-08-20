# Elenx `reasoning-v1` design

Status: current philosophy and vocabulary for the implemented `reasoning-v1` solver, 2026-08-20. The companion [`elenx-solve` protocol](https://gitea.lab/chaoxu/elenx-solve/src/branch/main/docs/protocol.md) is authoritative for exact runtime behavior. [`../SPEC.md`](../SPEC.md) is authoritative for the Elenx kernel.

## Philosophy

### Maximize capability while minimizing monetary cost

The design has two objectives. **Capability** is the range of problems for which the system can produce a correct, auditable resolution. **Cost** is the money consumed by every model call and other metered operation used to reach that resolution. The design seeks greater capability at an affordable cost and lower cost when capability is unchanged.

Tokens, calls, and elapsed time are not interchangeable objectives. Tokens and calls help explain spend, but models and providers price them differently. Elapsed time is not currently an objective. The system may take longer when doing so avoids paying for work that does not improve the result.

### Spend computation on model reasoning

The reasoning model is the strongest component. The harness should give it the problem, relevant evidence, and enough room to reason instead of replacing its judgment with hardcoded route priorities, anticipated failure rules, or fixed proof stages. Trust in the model's ability to reason is not trust in the truth of its output; verification remains separate.

A reasoning assignment should be broad enough to support sustained work. Decomposing the problem into easy assignments can make an agent return before exploring the real problem. When a route closes quickly, the next useful work is to test it, strengthen it, seek a counterexample, or continue toward the campaign goal—not to manufacture activity merely to consume tokens.

### Use sub-agents for clean context, not speed

A sub-agent is valuable because it can receive a fresh, deliberately selected context and form an independent view. The working hypothesis is that parallel sub-agents mainly buy lower wall-clock latency by purchasing several computations at once. Because elapsed time is not currently an objective, `reasoning-v1` runs serially and permits at most one active sub-agent. This is a concurrency rule, not a limit on the number of serial sub-agent turns in a campaign.

### Treat context as computation and evidence as memory

A context window is a local compute budget, not campaign memory. Hidden reasoning can help one model invocation, and some providers can preserve opaque continuation artifacts for compatible replay, but the harness cannot inspect that reasoning or reliably transfer it to another agent. Only explicit, interpretable output can become durable semantic evidence.

The durable trace retains admitted calls and their results for audit. A reasoner should see only information that can change its next decision and that it cannot cheaply recover from the problem or its current context. Repeating facts the model already knows wastes money and reduces the space available for new reasoning.

### Keep strategy dynamic and evidence scoped

The best next action can change after a new proof, obstruction, example, or verifier objection. The system should preserve evidence and provenance without turning an earlier model judgment into permanent strategy. A failed attempt is not a proof that its entire route is impossible. Negative evidence must say exactly what failed and under which assumptions.

### Separate exploration from verification

Exploration tries to discover a resolution; verification tries to break or establish a specific claim. Combining them in one role encourages the explorer to certify its own work. Elenx therefore treats a reasoner's output as proposed material and sends reusable evidence and proposed resolutions through a distinct checking step before relying on them.

A failed verification is new evidence, not a verdict on the campaign. It may support repair in the next fresh turn, an independent replacement attempt, or abandonment of only the failed candidate. The system records the objection and keeps this routing choice replaceable so the alternatives can be measured.

### Continue until the user retires the campaign

The campaign is not retired because a model believes further work is unpromising, because a configured number of turns has elapsed, or because a candidate reached verified status. Only the user retires the campaign. Cost awareness governs how each unit of work is performed; it does not create an autonomous stopping policy.

## Vocabulary

These terms are canonical throughout `reasoning-v1`.

| Term | Meaning |
| --- | --- |
| **Campaign** | The durable effort on one problem. It remains resumable until the user retires it. |
| **Campaign retirement** | A durable, user-only application action that ends future campaign work without deleting the journal. It is unrelated to closing a kernel database handle. |
| **Coordinator** | The root agent that interprets reports, maintains selected evidence, and durably chooses the next role and context. It may also act as the reasoner. |
| **Reasoner** | The role responsible for substantive exploration of the problem. The coordinator or a sub-agent may fill it. |
| **Sub-agent** | The serial fresh-context reasoner used by sub-agent-owned or adaptive reasoning. It does not delegate. |
| **Reviewer** | A checking role that examines one exact evidence proposal and returns an assessment. |
| **Turn** | One application-scheduled invocation of one agent role. It may contain several logical provider operations. |
| **Logical provider operation** | One Pi-visible model operation. It carries usage and telemetry when available but may hide adapter-internal wire retries. |
| **Request checkpoint** | The durable JSON-semantic pre-send payload for one logical provider operation. It does not prove that the provider received the request. |
| **Report** | The explicit free-form response text returned by a reasoner at the end of a turn. |
| **Control decision** | The coordinator's small durable choice of `reason`, `review`, or `verify`, together with that action's assignment, evidence references, proposals, or proposed resolution. |
| **Evidence proposal** | A scoped claim or lesson from a report or checking feedback, proposed for later reuse. |
| **Assessment** | A reviewer's recorded judgment and reasons about one exact evidence proposal. It is another fallible observation, not an Elenx kernel verdict. |
| **Selected evidence** | An assessed, scoped item chosen for possible inclusion in a later context package. Selection does not make it true. |
| **Proposed resolution** | Exact material claimed by exploration to resolve the campaign problem, before assurance freezes a candidate. |
| **Assurance** | The application policy that freezes a proposed resolution as a candidate and runs its declared verifier set. |
| **Candidate** | A versioned envelope containing the exact problem, completion criteria, proposed resolution, source control decision, and selected-evidence references, submitted with a frozen finite verifier set. |
| **Verifier** | A candidate-bound checking role named in the candidate's frozen verifier set. |
| **Verdict** | A verifier's candidate-bound `PASS`, `FAIL`, or `INCONCLUSIVE` judgment and evidence. |
| **External authority** | The application-selected human, formal oracle, or other authority allowed to accept a candidate as mathematically resolved; this authority sits outside the `reasoning-v1` protocol. |
| **Resolution** | A candidate accepted by the external authority outside `reasoning-v1`. A resolution does not retire the campaign; retirement remains the user's choice. |
| **Context package** | The exact problem, completion criteria, selected evidence, and immediate assignment or feedback supplied to one turn. |

Use **turn**, not *episode*. Use **sub-agent**, not *worker* or *consultant*. Use **proposed resolution**, not *solution*, before candidate creation. Use **verifier** and **verdict** only for candidate-bound assurance; intermediate evidence receives a **review** and an **assessment**. The legacy `done`, `stop`, `open`, and `next` channels belong to `model-first-v1`, not `reasoning-v1`.

## `reasoning-v1` capability boundary

`reasoning-v1` is a pure-reasoning application profile. Its agents may use only the model's internal knowledge and information present in their context package. They receive no web search, literature retrieval, general filesystem access, code execution, numerical solver, computer algebra system, or proof assistant. Reports are response text; the closed tool set submits control decisions, assessments, or verdicts and reveals no new task information. A provider endpoint with native undeclared retrieval or execution is outside `reasoning-v1`.

The Elenx kernel remains a general substrate and does not enforce this profile. The campaign config records the selected model profiles, and each call records its declared tools. Elenx trusts the application runner and model registry not to add undeclared capabilities.

A campaign has one coordinator and at most one active sub-agent. Calls are serial. Sub-agents do not delegate in `reasoning-v1`. There is no worker pool, parallel fan-out, route scheduler, task corpus, benchmark suite, or evaluation runner in Elenx.

`reasoning-v1` assumes that selected evidence remains small enough to supply directly in a context package. Retrieval and hierarchical memory begin only after real campaigns exceed that assumption.

## The campaign loop

```text
reasoner report
      |
      v
coordinator decision
  |       |       |
  v       v       v
reason  review   verify
  |       |       |
  v       v       v
report assessments candidate + verdicts
  |       |       |
  +-------+-------+
          |
          v
 coordinator decision
```

Every phase settles durably before the selected next phase begins. A sub-agent reasoner returns a report, after which the coordinator records a control decision; campaign ownership selects the initial sub-agent turn, and later coordinator decisions select subsequent ones. When the coordinator itself is the reasoner, one turn returns both artifacts, with the free-form report in response text and the small control envelope through its tool call. Both settle before the next effect begins. This preserves deterministic restart without imposing a second coordinator call on every policy.

The coordinator supplies a substantial assignment rather than a sequence of tiny proof tasks. It may select no evidence proposal from a report. Any proposal chosen for reuse is reviewed before becoming selected evidence. A proposed resolution goes to assurance, which freezes the complete candidate envelope and finite versioned verifier set before any verifier runs.

Reasoner turns belong to exploration. Reviewer turns perform evidence review; verifier turns perform candidate verification. A reviewer may discover a repair or new route, but that contribution returns as explicit feedback; it does not silently become the next exploration turn. Assessments and verdicts return to a coordinator control decision before another role starts.

Every campaign freezes at least one verifier. Reviewers are optional; when none are configured, the coordinator has no `review` action. If a role call completes but its terminal tool submission is missing or malformed, the system permits a fresh correction attempt in the same semantic phase. Only output-limited segments use transcript continuation.

A candidate and its verifier contract are immutable. A corrected proposed resolution or changed selected evidence creates a new candidate. The problem, completion criteria, and verifier profiles are frozen for the campaign, so changing them requires a new campaign. `PASS` results never transfer between candidate identities, and a later `PASS` does not erase a `FAIL` on an earlier candidate. A candidate is **verified** only when every required verifier has at least one `PASS` and no required verifier has any `FAIL`; `INCONCLUSIVE` satisfies neither condition. Verified status does not by itself establish mathematical truth. Adoption as a resolution requires the application-selected external authority, such as human mathematical review or a sound formal oracle.

No configured limit declares the campaign resolved or retired. Provider or model limits, failure, context exhaustion, or operator cancellation may interrupt a turn while leaving the campaign resumable. An unknown checkpointed request ends its continuation chain; resume may start the unresolved phase from a fresh root.

## Turn and context semantics

A usable cumulative result completes a turn. If a response ends because it reached an output limit and has a valid explicit prefix, `reasoning-v1` repeatedly calls `continuePi()` within the same logical turn until it obtains a usable result or encounters a different technical failure. The protocol imposes no continuation count. Each segment is another inference rather than byte-for-byte resumption. Context exhaustion returns control to the user and leaves the unresolved phase resumable from a fresh root.

The durable continuation chain gives every segment one logical turn identity and a parent reference. Compatible opaque artifacts are stored for compatible continuation and provenance, never as semantic evidence. `reasoning-v1` schedules the chain as one turn and withholds incomplete segments from the coordinator, so a truncated technical segment never becomes the campaign's mathematical report. Profile drift or a child operation with an unknown outcome makes that chain ineligible; a later attempt starts the unresolved phase from a fresh root while preserving the chain for provenance and accounting. A graceful-pause request waits for the active continuation chain; forced cancellation interrupts it.

After a completed turn, `reasoning-v1` implements **restart**: the next role invocation starts from a fresh Pi root with explicit context rebuilt from durable campaign state. Exact-transcript continuation, alternative restart payloads, and adaptive retention across completed turns remain experimental policies:

- **Continue:** retain the exact compatible transcript and add the new instruction. This preserves continuity but consumes context and may preserve fixation.
- **Alternative restart:** start a fresh conversation with a different explicit context package, such as one that includes the prior report or omits selected evidence.
- **Adaptive:** continue while continuity is useful, then restart from explicit state when context pressure or fixation outweighs it.

Cross-model work always restarts from explicit state. A future exact-transcript policy would require the frozen provider, model ID, API, base URL, system prompt, reasoning setting, model profile, and ordered tool declarations. The model profile includes the context window, output limit, thinking-level map, sampling parameters, and compatibility settings. [Official OpenAI documentation](https://developers.openai.com/api/docs/guides/reasoning#how-reasoning-works) states that reasoning tokens are not visible through the API, occupy context, and may be carried through compatible reasoning items. These provider semantics can optimize continuation but cannot define campaign memory.

## Evidence review

Every report is preserved as an observation. It does not automatically become selected evidence. The coordinator proposes the smallest exact items that could change later reasoning, keeps their provenance, and chooses their requested reviewers. The `local`, `directional`, and `foundational` consequence labels guide that choice; the runtime does not derive reviewer counts or acceptance rules from them.

- “This exact attempt stalled at gap X” needs only a faithful, scoped assessment.
- “Do not repeat route X unless condition Y changes” needs stronger review because it directs future search.
- “Every route of type X is impossible” needs evidence matching that quantifier and multiple strong reviews before it should influence the reasoner so heavily.
- A proposed resolution follows the separate frozen candidate-verification contract.

This is consequence-sensitive review, not a distinct class of “lazy verifier.” Reviewers are fallible and may share the reasoner's blind spots. Each proposal records its statement, scope, consequence, and requested reviewers. The journal binds an assessment call to the source decision and proposal index and preserves its reviewer profile and call provenance; the response records `supported`, `rejected`, or `inconclusive`, reasons, and an optional suggested revision. An item becomes eligible for selection after every requested assessment settles, regardless of those judgments. Elenx stores these facts through ordinary versioned call data because the kernel has no generic evidence-verdict record.

Selected negative evidence remains scoped, revisable model-facing advice. Only a mechanically checked certificate or the application's external truth authority may create a hard exclusion enforced by the runtime. `reasoning-v1` has neither, so it does not enforce mathematical exclusions.

## Coordinator and deterministic control

The lifecycle shell is mechanical: settle one role turn, settle its control decision, start the selected next role, and derive projections from recorded facts. `reasoning-v1` is designed around a semantically capable coordinator because interpreting a mathematical report, extracting scoped evidence, judging its consequence, and constructing the next context package require semantic judgment; the runtime accepts any configured model profile.

The coordinator may become deterministic if reasoners later return enough explicit structure for those transformations to be mechanical. `reasoning-v1` does not force a large mathematical output schema merely to pursue that possibility. A schema that changes what the reasoner explores or omits is a reasoning policy and must earn its cost.

## Durability, restart, and user control

The kernel stores its existing call, tool, candidate, and verdict records. Versioned application projections interpret ordinary calls and results as reports, control decisions, evidence proposals, assessments, and selected evidence. Pi checkpoints preserve the JSON-semantic pre-send payload described by the kernel specification, not credentials, SDK retries, transport-only fields, or exact HTTP bytes. Usage may remain unknown after interruption.

Restart begins from the last fully reconciled phase. An interruption during a logical provider operation may lose hidden reasoning and leave its outcome unknown. The request checkpoint and unknown-spend evidence remain visible, and the runtime never treats the absence of a report as proof that no work or spend occurred. Resume derives the unresolved semantic phase; an unusable continuation chain is abandoned and that phase starts from a fresh root.

The first `SIGINT` or `SIGTERM` requests a graceful pause after the active turn settles, leaving the campaign resumable. The second signal aborts the active provider operation, and a further signal exits with status 130. Campaign retirement is a durable user-only application action that prevents later model calls. None of these is a model-selected mathematical outcome.

## Cost policy

Every coordinator, reasoner, continuation, reviewer, and verifier call contributes to total monetary cost. Inspection aggregates provider-reported token buckets and Pi's `estimatedCostUsd` when available, while identifying unmeasured requests and potential unknown spend. It does not know exact billing, expose adapter-internal retries, or enforce a monetary budget.

`reasoning-v1` is intended to reduce avoidable cost by running one model computation at a time, giving reasoners substantial goals, retaining only decision-changing selected evidence, reusing settled observations, matching review effort to consequence, and postponing additional capabilities until their gain justifies their spend. Continued transcripts can increase input cost, and provider caching must be measured rather than assumed.

Cost reduction is not progress when it lowers capability. Compare capability at a given spend or spend required for the same capability. The user, not the runtime, decides the total commitment by choosing when to pause or retire the campaign.

## System boundary

| Layer | Responsibility |
| --- | --- |
| **Elenx kernel** | Exact candidate bytes, frozen verifier labels, append-only calls, tool invocations and results, unknown tool outcomes, candidate-bound verdict admission, crash semantics, record identities, and accounting projections. |
| **Pi integration** | Model execution, native transcripts, provider-payload checkpoints, telemetry, and compatible continuation primitives. |
| **`elenx-solve`** | One-problem campaigns, roles, serial topology, pure-reasoning capability profile, turns, control decisions, fresh context-package construction, selected-evidence policy, and user lifecycle. |
| **Assurance policy** | Proposed-resolution packaging, frozen verifier topology, and candidate-bound verification. |
| **Application outside `reasoning-v1`** | External adjudication and adoption of a candidate as a resolution. |

No new Elenx kernel record is required for reports, control decisions, or working evidence. `elenx-solve` represents them through versioned ordinary call requests, results, and derived projections. Candidate and verdict records remain reserved for exact proposed resolutions and candidate-bound judgments. A new kernel primitive requires an invariant shared by multiple applications.

## Comparison with Rethlas

[Rethlas](https://arxiv.org/abs/2604.03789) combines a generation–verification repair loop with theorem retrieval, explicit example and counterexample policies, recursive proof sub-agents, queryable working artifacts, and citation-aware checking. The paper's Lean formalization system is the separate Archon component, not Rethlas. `reasoning-v1` deliberately omits these capabilities. The comparison exposes real limits rather than a universal ranking.

A problem that Rethlas solves easily can be hard for `reasoning-v1`. The clearest case has a short argument once an obscure theorem is known. Rethlas's Matlas theorem-retrieval component can place that theorem into its context; `reasoning-v1` cannot obtain information absent from both its input and the model's internal knowledge, no matter how many reasoning turns it buys. Citation-heavy problems create a second gap: Rethlas can retrieve a cited statement and inspect its hypotheses, while `reasoning-v1` cannot check the source. Retrieval and citation-aware checking remain fallible, but they change the available information rather than merely changing the reasoning policy.

| Problem characteristic | Predicted advantage | Reason |
| --- | --- | --- |
| The missing bridge is an obscure theorem absent from the prompt | Rethlas | Retrieval can introduce information unavailable to `reasoning-v1`. |
| Correctness depends on the exact hypotheses or terminology of cited literature | Rethlas | Its verifier can retrieve the cited statement and compare its local definitions and assumptions. |
| The conjecture needs assumption pruning or an externally found example or counterexample | Rethlas | Retrieval and explicit exploration policies can reshape the target before proving it. |
| Useful state no longer fits directly in one context package | Rethlas | Its indexed working artifacts already support selective access. |
| Many independent routes exist and elapsed time matters | Rethlas | Parallel recursive proving buys breadth and lower latency, though not automatically lower cost. |
| The problem is self-contained, tightly coupled, and rewards one sustained line of reasoning | `reasoning-v1`, untested | Broad serial reasoning avoids forced decomposition and synthesis. |
| Most speculative branches would duplicate the same inference | `reasoning-v1`, untested | Serial work can observe one result before purchasing another branch. |

No matched experiment yet establishes a dollar or capability advantage for either system. Rethlas makes controlled theorem retrieval the highest-priority capability extension to test. Its named example, counterexample, and decomposition skills are prompt policies that a broad reasoner may already perform; parallel recursion and richer memory should also be tested as separate interventions rather than imported as one bundle. Rethlas's retrieved-citation substitution failure in its reported algebraic-groups case also motivates a misleading-near-match test rather than an assumption that retrieval always helps.

## Deferred extensions

The following may increase capability but remain outside `reasoning-v1`:

- a retrieval reasoner that reads controlled external knowledge;
- a coding reasoner that writes and executes programs;
- numerical, symbolic, search, formal-proof, and certificate-checking tools;
- indexed or hierarchical evidence stores when selected evidence no longer fits directly in context;
- nested delegation or parallel sub-agents when measured capability gain justifies added spend;
- automatic specialist routing and capabilities beyond pure reasoning;
- deterministic evidence extraction and coordination after the free-form contract is understood; and
- latency-aware execution when elapsed time becomes an objective.

Each extension must identify the capability it adds, its full monetary cost, the evidence needed to trust its output, and the simpler mechanism it replaces or complements.

[`hypotheses.md`](hypotheses.md) owns the experimental comparisons. It must not turn an experimental policy into a kernel guarantee or put an evaluation corpus inside Elenx.
