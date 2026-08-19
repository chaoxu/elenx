# Model-first harness hypotheses

Status: experimental research plan, 2026-08-19. This document owns hypotheses and measurement, not current runtime behavior. [`design.md`](design.md) defines the design boundary; `docs/protocol.md` in the companion [`elenx-solve`](https://gitea.lab/chaoxu/elenx-solve) repository defines current solver behavior.

The catalog guides experiments implemented outside the kernel. It adds no task corpus, benchmark problems, evaluation runner, or runtime policy to Elenx.

## Research question

For a strong reasoning model working on a task that may yield to repeated approaches, what is the least cross-episode structure that improves the rate of externally verified resolutions per unit cost?

The model owns epistemic decisions: which route to try, what evidence to seek, when an obstruction matters, and when an old route deserves another look. The harness owns faithful memory, execution boundaries, and measurement. Trust in the model's reasoning does not make its answer or its account of prior work true.

The supported API retains an append-only execution trace for audit. The information shown to the next reasoning episode is a separate, small projection of that trace. The baseline projection is empty. Every nonempty projection is an intervention that must outperform the baseline rather than a feature assumed to be useful.

## Experimental object

One episode receives the exact task, a fixed model and tool capability, and an optional strategic projection. It reasons until it submits a candidate or an incomplete outcome. The harness records the call exactly. A later episode may receive none or some of the accumulated state. The harness does not select the mathematical route unless that selection is the treatment being tested.

The following names describe experimental channels, not new Elenx kernel record types:

- **Done:** a factual account of attempts and outcomes, without judging what should happen next.
- **Stop:** obstructions or prior attempts that argue against repeating a direction.
- **Open:** established partial results and unresolved obligations, without prescribing a route.
- **Next:** routes or actions proposed for further work.
- **External evidence:** sources, examples, counterexamples, computations, critic reports, or verifier feedback.

A channel can be absent, copied from raw history, mechanically extracted, curated by the working model, or curated by a separate model. Its content can be presented as a fact, advice, or a constraint. These dimensions are separately manipulable, but interactions are expected and must be measured rather than assumed away.

## Strategic-memory hypotheses

The central negative-only conjecture is asymmetric: preserve what has been tried and what should probably not be repeated, but do not supply priorities for what comes next. This removes known waste while leaving constructive search to the model. It is not completely neutral, because selecting and mentioning a failed direction changes the model's attention. The experiment must therefore compare omission, neutral failure facts, and explicit stop advice rather than treating them as equivalent.

| ID | Intervention | Hypothesis | Main failure mode |
| --- | --- | --- | --- |
| S0 | No cross-episode strategic state | Independent long attempts are enough; added memory mainly anchors the model and consumes context | Repeated routes and rediscovery waste most of the budget |
| S1 | Done only | Knowing what happened lets the model infer what matters without a curator deciding what to suppress or pursue | Raw history dilutes attention and invites the same reasoning again |
| S2 | Neutral negative evidence | A compact statement such as “route X reached obstruction Y” reduces semantic repetition while leaving route choice with the model | Mentioning X makes it more salient, or Y is overgeneralized |
| S3 | Stop advice | An AI-curated “do not repeat X unless Z changes” list reduces more duplication than neutral history | Imperative negation primes X, suppresses a useful variant, or becomes stale authority |
| S4 | Typed and scoped stop advice | Separating proved impossibility, failed execution, inconclusive attempt, resource exhaustion, and superseded work prevents false abandonment | The extra distinctions cost context without changing decisions |
| S5 | Open obligations only | Partial results and precise gaps are enough for the model to continue useful work without being told how to close them | The model repeatedly attacks the same gap with no strategic change |
| S6 | Proposed next routes only | Explicit possibilities increase useful continuation and reduce the cost of rediscovering promising ideas | The list anchors the model to yesterday's guesses and reduces route diversity |
| S7 | Stop plus open state | Negative memory prevents loops while unresolved obligations preserve cumulative progress | The combined projection crowds out fresh global reasoning |
| S8 | Stop plus next state | Telling the model both where not to go and where it might go improves search allocation | The harness becomes a weaker second reasoner whose priorities constrain the stronger model |
| S9 | Done, stop, open, and next | A compact research state supports both exploration and proof composition | Rich state recreates a complicated workflow without earning its cost |

S2 and S3 must be tested separately. “Route X produced obstruction Y” and “do not try X” contain related information but exert different prompt effects. A prohibition may cause ironic or salience priming. A stop item should state its exact scope and a condition for reopening it. Even a proved obstruction normally rules out a precise mechanism, not every semantically nearby idea.

## Curation and authority hypotheses

| ID | Comparison | Hypothesis |
| --- | --- | --- |
| C1 | Model-curated state versus raw or mechanically extracted history | The model can compress semantic lessons better than a fixed extractor, despite the risk that it misstates its own failures |
| C2 | Working-model curator versus separate-model curator | Self-curation preserves nuance; separate curation notices rationalization and overclaimed progress |
| C3 | Neutral facts versus advisory recommendations versus enforced exclusions | Facts or advice retain model autonomy; hard exclusions help only when backed by a checked impossibility certificate |
| C4 | Permanent stop versus conditional revival | Reopen conditions recover routes whose premises changed without restoring ordinary duplicate work |
| C5 | Update after every episode versus only at milestones | Frequent updates prevent loops; milestone updates preserve context and avoid premature interpretation |
| C6 | Full history versus recent window versus hierarchical compression | Bounded summaries preserve decisive old facts while avoiding context dilution |
| C7 | State pushed into every prompt versus available through a model-invoked read tool | Pull-based memory lets the model decide when context is useful; pushed memory prevents it from overlooking a decisive obstruction |
| C8 | Self-curation during solving versus a separate post-episode curation call | Inline curation preserves context; a separate call reduces interference with solving and makes curation cost visible |

Curated state needs a fidelity and leakage check against the immutable trace. The fidelity check establishes that the summary accurately represents prior work. The leakage check establishes whether a memory-only treatment smuggled in a new lemma, route, or recommendation. Neither check decides which mathematical route should be preferred.

A curator that introduces a new lemma, route, or diagnosis is doing additional research rather than merely compressing memory. That contribution should either be forbidden in a memory-only arm or recorded and charged as a separate advisor intervention.

## Non-redundancy and token-budget hypotheses

The model should not be reminded of information it already has. A memory item earns space only when it can change the next decision and the next model cannot reliably recover it from the visible task, candidate, or current transcript. The event log may retain everything for audit; the model-facing projection should retain only marginally useful information.

| ID | Intervention | Hypothesis | Main failure mode |
| --- | --- | --- | --- |
| T1 | Full repeated context versus delta-only context | Sending only new observations and changed obligations preserves quality while reducing input tokens | The model loses a premise that was technically visible but not retained |
| T2 | Raw transcript versus deduplicated strategic projection | A projection containing only decision-changing facts is cheaper and equally effective | Compression deletes a small detail that carries a proof dependency |
| T3 | Push all selected memory versus model-invoked memory retrieval | Letting the model request old evidence saves context on runs that do not need it | The model fails to request a fact whose relevance it does not yet recognize |
| T4 | Flat summary versus hierarchical or on-demand summary | A short index plus expandable details preserves rare decisive facts without paying for them every round | Retrieval overhead and extra calls exceed the saved tokens |
| T5 | Fixed context budget versus expected-value selection | Selecting reminders by likely decision impact improves cost per true resolution | The selector encodes a hidden strategy or repeatedly chooses familiar facts |
| T6 | Summarize every episode versus summarize only on context pressure or milestone | Delayed compression avoids paying for summaries that are never reused | Long transcripts become expensive before the trigger fires |
| T7 | Fixed reasoning effort versus adaptive effort | Spend more tokens on a route showing evidence of progress or high value, and less on dead ends | Early signals are noisy and the policy abandons a route prematurely |
| T8 | Continue until a fixed limit versus stop on a model-requested terminal state | A strong model can stop when further reasoning has low expected value | The model declares completion before the proof is complete |
| T9 | Verify every draft versus verify selected milestones or final candidates | Selective verification preserves discovery tokens while retaining most assurance | Errors propagate too far before detection |
| T10 | Recompute versus reuse an exact settled observation | Reusing immutable results saves calls without changing reasoning | A reused result is applied outside its original scope |
| T11 | One expensive model versus a cheaper model for bookkeeping or compression | Cheap models can perform non-epistemic formatting and projection work without changing mathematical quality | The cheap model silently adds or removes mathematical content |
| T12 | Long prose prompts versus compact structured state | A small schema lowers repeated prompt overhead and makes omissions measurable | The schema forces the model into categories that do not fit the task |

Token saving is not an independent success criterion. A treatment that uses fewer tokens but loses correct resolutions is worse. Report both raw token reduction and cost per externally true resolution, including the tokens spent on curators, retrieval, summaries, handoffs, and verification.

## Episode and model-allocation hypotheses

| ID | Comparison | Hypothesis | Main tradeoff |
| --- | --- | --- | --- |
| E1 | One uninterrupted episode versus several fresh episodes at the same total budget | Long context preserves a coherent proof plan; fresh episodes escape local fixation | Coherence versus diversity |
| E2 | Resume the same model session versus start fresh with a compact projection | Hidden conversational continuity preserves nuance; explicit state reduces drift and makes the handoff auditable | Unrecorded context versus lossy compression |
| E3 | Same-model continuation versus a different-model handoff | A second model can recognize a local minimum and extend the first model's final ideas | Fresh perspective versus translation loss |
| E4 | Alternate models every round versus switch only after a diagnosed stall | Adaptive switching gains diversity without paying handoff cost on productive runs | The stall diagnosis may itself be unreliable |
| E5 | Independent attempts followed by synthesis versus one continuing researcher | Independent workers generate route diversity; a continuing researcher composes partial results better | Breadth and synthesis overhead versus depth |
| E6 | Self-critique versus a fresh critic or different-model critic | A separate critic adds signal only when its errors are sufficiently different from the producer's | Extra calls may reproduce the same blind spot |

A model handoff should vary the transferred state independently: final answer only, final ideas plus open obligations, compact curated state, or full visible transcript. Otherwise a model comparison is confounded with a context comparison.

## Serial-first resource hypotheses

The harness should treat concurrency as a separate resource policy rather than as the default form of exploration. With provider-priced calls, running two attempts simultaneously does not reduce the number of tokens or calls. It primarily reduces elapsed time and can increase total work through duplicated reasoning and synthesis. A parallel treatment can still reduce cost per true resolution if its diversity produces enough additional correct solutions; that is a quality effect, not a saving supplied by parallelism itself.

| ID | Comparison | Hypothesis | Main tradeoff |
| --- | --- | --- | --- |
| R1 | One serial reasoning loop versus parallel duplicate attempts at equal total call budget | Serial execution reaches the same quality at lower coordination and synthesis cost; parallelism mainly lowers wall time | Latency versus total spend |
| R2 | Serial sub-agent consultation versus parallel sub-agent fan-out | A sequentially requested second view preserves the main model's evolving context and avoids unused work | Context continuity versus response time |
| R3 | Parallel distinct routes versus serial distinct routes at equal total spend | Parallel diversity can improve hard-task resolution, but only if its quality gain exceeds fan-out and synthesis cost | Diversity versus duplicate effort |
| R4 | Unconditional fan-out versus conditional fan-out after a diagnosed stall | Conditional concurrency spends on breadth only when the serial policy has evidence that it is needed | Stall diagnosis may be wrong or late |
| R5 | Fixed concurrency versus model-requested concurrency | The model may know when an independent view is worth its cost better than a static scheduler | The model may request expensive, redundant workers |
| R6 | At most one active sub-agent versus parallel sub-agents | A single subordinate consultation preserves state ownership and avoids coordination cost; parallelism helps only when independent information is unusually valuable | Serial latency versus fan-out diversity |
| R7 | One-level delegation versus allowing a sub-agent to delegate | Nested delegation may solve genuinely decomposable tasks, but usually adds handoff and synthesis overhead | Capability versus loss of control |

Sub-agents remain compatible with a simple harness. Their role is to supply a deliberately different observation, criticism, or bounded computation; their execution need not be concurrent. Every sub-agent call is charged, recorded, and evaluated as an intervention.

## Exploration hypotheses

| ID | Intervention | Hypothesis | Main failure mode |
| --- | --- | --- | --- |
| X1 | Ask for many candidate approaches before choosing one | Explicit breadth increases route-family diversity and hard-task success | Listing approaches consumes the depth needed to execute one and may merely verbalize boilerplate |
| X2 | Generate new routes only after evidence or failure | Adaptive branching spends breadth only when needed | Early commitment anchors the run before alternatives are considered |
| X3 | Let the model choose between restart, continuation, revival, and new exploration | A strong model allocates its own effort better than fixed alternation | The model persists with familiar work and underexplores |
| X4 | Independent parallel route workers | Parallelism increases coverage of genuinely different approaches | Workers duplicate each other and synthesis costs erase the gain |
| X5 | Explicit novelty pressure | Asking for a route materially different from recorded failures reduces loops | Productive refinements are rejected as “too similar” |
| X6 | Give tools without mandatory stages | The model knows when examples, computation, retrieval, or criticism will help | The model overlooks useful tools or uses them performatively |
| X7 | Dedicated example or counterexample evidence | Concrete instances expose false generalizations and suggest invariants on the task families where they matter | Easy instances distract from the proof or create unsupported induction |
| X8 | Targeted theorem or source retrieval | Retrieval closes named dependency and citation gaps | Irrelevant literature consumes context and anchors the proof to a nearby but inapplicable theorem |

Internal branching cannot be observed directly. X1 tests whether forcing the model to externalize alternatives changes outcomes; it does not establish that the baseline model considered no alternatives internally.

## Feedback and verification hypotheses

| ID | Intervention | Hypothesis |
| --- | --- | --- |
| V1 | Verify only submitted candidates | Infrequent verification preserves discovery budget and avoids steering search with noisy objections |
| V2 | Feed verifier objections into the next episode | Concrete objections turn failed candidates into productive obligations rather than restarts |
| V3 | Check proof obligations separately | Dependency-scoped review catches local gaps more reliably than one global proof judgment |
| V4 | Blind reconstruction | A separately reconstructed proof reduces false acceptance even if it contributes little to discovery |
| V5 | Let the model decide when to request criticism | Model-triggered review spends verification budget where uncertainty is highest |

Verification modules may improve truth precision without improving discovery. They should be judged on false acceptance and false rejection as well as resolution rate. An internal PASS remains a workflow observation, not the external truth label.

## First experiments

The first pilot should test state content before model topology or specialized tools. Freeze a common checkpoint after one substantial episode, construct every projection from the same immutable history, and randomize the next episode. The negative-only ladder is:

| Arm | Projection |
| --- | --- |
| A | empty |
| B | done/history only |
| C | done plus neutral records of failed directions |
| D | done plus scoped advisory stop items |

Arm D is the user's central hypothesis: record what happened and what should probably not be repeated, without telling the model what to pursue. Compare it with a positive-state ladder starting from the best negative arm:

| Arm | Additional projection |
| --- | --- |
| E | open obligations and established partial results; the model chooses the next move |
| F | proposed next routes; the harness supplies destinations |
| G | both open state and proposed next routes |

This separates “the model knows what remains unfinished” from “the harness tells it where to go.” A second wording experiment compares the same obstruction rendered as a neutral fact, advisory stop, or hard exclusion. Hard exclusions should be used only as a deliberately separate treatment; they are not the default design.

The next pilots should test, in order:

1. model-curated versus mechanically extracted projections;
2. one long episode versus fresh same-model continuation;
3. same-model versus different-model handoff using identical transferred state;
4. serial versus parallel execution of otherwise identical route portfolios;
5. coordinator-only versus one serial sub-agent consultation;
6. direct solving versus explicit path generation;
7. model-directed access to examples, counterexamples, retrieval, and criticism;
8. verification and reconstruction modules as assurance interventions.

The shared-checkpoint experiment estimates the local value of showing a projection. A later sequential experiment should randomize projections at successive checkpoints to estimate the end-to-end effect of an adaptive memory policy. Checkpoint observations are not independent task resolutions and must not be counted as separate successes. The initial arms form a hypothesis backlog; model handoffs, explicit breadth, tools, and verification should be added only after the memory effect is measurable.

## Evaluation contract

The primary outcome is an externally adjudicated exact resolution. Use formal checking when it matches the target; otherwise use independently validated references and blinded judges that did not generate the candidate or strategic state. Open problems without verified answers can support exploratory progress studies but not confirmatory solve-rate comparisons.

Report:

- externally verified resolution rate and its curve against total spend;
- total provider cost, cost per true resolution, and wall time;
- number of calls, peak concurrency, synthesis overhead, and unused parallel work;
- repeated route and repeated error rates;
- useful continuation, route revival, and premature abandonment rates;
- novel route-family coverage;
- closed proof obligations and first useful evidence latency;
- projection length, curation cost, factual omissions, and summary distortions;
- projection leakage: new mathematical content or route recommendations introduced by a purported memory-only treatment;
- internal acceptance followed by external rejection, and the converse.

Run two budget views. The end-to-end policy comparison charges projection generation, prompt tokens, tool calls, and verification against one total budget. The information-only comparison holds generation compute fixed and reports projection overhead separately. The first is the deployment question; the second explains whether a module's information helps once its cost is removed.

Randomize at the problem-by-replicate level, interleave arms to reduce provider drift, freeze exact prompts and task bytes, keep tool access and stopping rules matched, and repeat each arm because model outputs are stochastic. Stratify tasks by one-shot difficulty, need for iterative repair, sensitivity to examples or counterexamples, dependence on retrieval, and availability of exact adjudication. Pilot runs validate instrumentation; held-out tasks support claims.

## Experimental platform

[`elenx-solve`](https://gitea.lab/chaoxu/elenx-solve) implements the initial discovery baseline. Its protocol document owns the exact runtime behavior; this section describes the switches needed to run the experiments.

The smallest experimental harness needs three pieces:

1. an immutable event log containing exact tasks, calls, tool effects, candidate bytes, verdicts, and usage;
2. a projection layer that maps accumulated state to optional model-readable channels; and
3. a serial coordinator that supplies the exact task and enabled projections, invokes at most one bounded sub-agent when needed, and records the next outcome.

The projection layer is the experimental switch. With every channel disabled, it returns nothing. Enabling `done`, `stop`, `open`, `next`, or an external-evidence channel changes only the context shown to the next call. Model choice, handoff policy, exploration prompt, tools, and verifier feedback are separate switches. The immutable trace never changes when a projection is disabled.

Each treatment should record its projection mode, curator, authority level, update cadence, exact projection bytes or hash, prompt hash, model profile, and charged budget. Pure projection functions make an old checkpoint replayable under a different treatment without rerunning the preceding episode.

This design does not require a route scheduler, fixed priorities, a universal failure ontology, a controller that decides the next proof action, or a parallel worker pool. The model may propose and curate strategic state, but the harness stores those proposals as revisable advice. Only mechanical execution, safety, accounting, and evidence-integrity rules remain hard constraints. Serial execution is the default; concurrency is a separately enabled treatment.

## Open design questions

- Should a checked impossibility certificate ever create a hard exclusion, or should every stop item remain overridable advice?
- Should the same reasoning call both solve and curate state, or should curation receive its own budget and fidelity audit?
- Is semantic similarity between a new route and a failed route best judged by the working model, a separate model, or not enforced at all?
- Does a model need established partial results in addition to open obligations, or will it recover them from the current candidate?
- When does a different-model handoff add a genuinely different reasoning distribution rather than a lossy paraphrase?
- Which task families reward cumulative state, and which reward independent restarts?
