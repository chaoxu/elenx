# Elenx system hypotheses

Status: proposed research plan, 2026-08-19. [`design.md`](design.md) defines the proposed solver V1 mechanism and vocabulary. The companion [`elenx-solve` protocol](https://gitea.lab/chaoxu/elenx-solve/src/branch/main/docs/protocol.md) defines current runtime behavior until it is replaced.

This document owns experimental comparisons, not kernel guarantees or current policy. Elenx contains no task corpus, benchmark suite, or evaluation runner.

## Research objective

For a strong reasoning model working on a problem that may require repeated attempts, which policy produces the greatest externally adjudicated capability for a given monetary cost?

Capability means correct resolution of the exact assigned problem. A proposed resolution, a candidate, and a candidate with verified status under its frozen verifier set are intermediate outcomes until the application-selected external authority accepts the result. Cost includes every coordinator, reasoner, continuation, reviewer, verifier, retrieval, and tool call used by the policy. Elapsed time is reported but is not currently optimized.

Experiments vary one policy over the same durable mechanism: serial role turns, exact reports, durable control decisions, explicit context packages, immutable candidates, and complete accounting where the provider reports it. Campaigns remain active until the user retires them.

## Reasoning ownership

| ID | Policy | Hypothesis | Main risk |
| --- | --- | --- | --- |
| O0 | Delegated reasoning | A fresh sub-agent with the whole problem and selected evidence uses more of its context for mathematics and escapes coordinator fixation | A strategically shallow coordinator sends the wrong evidence or assignment |
| O1 | Coordinator reasoning | The coordinator's accumulated object-level understanding improves route choice and integration | Context accumulation and anchoring eventually degrade exploration |
| O2 | Adaptive reasoning | A strong coordinator can recognize when continuity or a clean-context delegation is more valuable | The routing decision consumes cost and may be systematically wrong |

All three use one active agent at a time. A delegated assignment may be the complete problem. The comparison is about where mathematical reasoning happens, not whether sub-agents are allowed.

## Assignment scope

| ID | Policy | Hypothesis | Main risk |
| --- | --- | --- | --- |
| A0 | Campaign-level goal | A broad “continue resolving this problem” assignment lets the reasoner allocate its own effort and pursue unexpected routes | The reasoner may revisit familiar work without enough direction |
| A1 | Targeted direction | Supplying one promising route or precise obstruction reduces rediscovery | The coordinator's local judgment constrains the stronger reasoner |
| A2 | Small decomposition | Narrow lemmas make progress and verification easy to localize | Easy tasks cause early return, lose global structure, and add handoff cost |

Useful reasoning, not token consumption, is the objective. When a proposed resolution appears quickly, further work should attack, strengthen, reconstruct, or generalize it rather than create artificial tasks.

## Turn-to-turn context

| ID | Policy | Hypothesis | Main risk |
| --- | --- | --- | --- |
| C0 | Restart with no selected evidence | Independent attempts supply diversity and avoid stale context cheaply | Routes and deductions are repeatedly rediscovered |
| C1 | Continue exact compatible transcript | Conversational and opaque reasoning continuity preserves a productive proof plan | Context cost, fixation, and eventual context exhaustion |
| C2 | Restart with the prior report | Explicit handoff preserves most useful state without the full transcript | The report omits details that mattered only inside the prior reasoning |
| C3 | Restart with selected evidence | Curated state preserves decision-changing facts at lower input cost | Selection removes a subtle dependency or encodes a bad strategy |
| C4 | Adaptive continuation | Continue productive contexts and restart when pressure or fixation appears | Context-quality diagnosis is unreliable and itself costs money |

An output-limit continuation is part of the same logical turn and is not one of these policies. Cross-model work always restarts from explicit state. Record the exact supplied context and provider-reported input, cache-read, cache-write, output, and reasoning buckets; caching is not assumed.

## Evidence content

An evidence proposal enters later context only after an assessment. A policy may select no proposals, in which case it pays no intermediate review cost.

| ID | Selected evidence | Hypothesis | Main risk |
| --- | --- | --- | --- |
| M0 | None | Strong independent attempts outperform memory once curation and review are charged | Repeated semantic work dominates cost |
| M1 | Attempted work | Knowing what was tried lets the reasoner infer what matters without prescriptive strategy | History consumes attention and encourages superficial variation |
| M2 | Neutral negative evidence | Scoped statements such as “route X reached obstruction Y” reduce exact repetition while preserving autonomy | Mentioning X increases its salience or Y is overgeneralized |
| M3 | Negative advice | “Do not repeat X unless Y changes” prevents more waste than a neutral record | Imperative negation suppresses a useful variant or becomes stale authority |
| M4 | Established partial state | Assessed lemmas, examples, and open obligations allow cumulative proof construction | A fallible intermediate assessment propagates a false premise |
| M5 | Negative and partial state | Combining blocked routes with reusable progress best supports long campaigns | The context package becomes a second, weaker research program |

M2 and M3 are distinct interventions. A failed attempt and a prohibition have different prompt effects. Every negative item must preserve its exact scope and a condition under which reconsideration is sensible.

## Evidence selection and review

| ID | Comparison | Hypothesis |
| --- | --- | --- |
| E1 | Reasoner proposes evidence versus coordinator extracts it | The reasoner retains mathematical nuance; the coordinator better identifies campaign-level value |
| E2 | Same-model reviewer versus fresh same-model reviewer versus different-model reviewer | Freshness or model diversity reduces rationalization enough to justify its cost |
| E3 | One lightweight assessment versus repeated strong assessments | Additional review is worthwhile only as the proposal's downstream consequence grows |
| E4 | Fixed review strength versus coordinator-selected strength | A strong coordinator allocates review spend better than a static rule |
| E5 | Review immediately versus at a milestone | Immediate review prevents error propagation; delayed review avoids checking evidence never reused |
| E6 | Push all selected evidence versus select per context package | Per-turn selection saves context; pushing all evidence prevents omission of a decisive obstruction |

An assessment is a fallible observation. A model review cannot create a runtime-enforced mathematical exclusion. Experiments must retain the exact proposal, disclosure, reviewer profile, method, assessment, and monetary cost.

## Failed candidate verification

Starting from the same immutable candidate and verdict history, compare:

| ID | Next action | Hypothesis | Main risk |
| --- | --- | --- | --- |
| F0 | Same-context repair with objections | The original reasoner can repair its intended argument most efficiently | It rationalizes the same route or hidden mistake |
| F1 | Fresh-context repair with objections | A fresh reasoner sees the defect without inheriting the producer's fixation | Explicit objections anchor it to local repair when replacement is better |
| F2 | Independent replacement without the candidate | Blind exploration finds a genuinely different proposed resolution | It repeats work and ignores an inexpensive repair |
| F3 | Independent reconstruction of the claimed result | Reconstructability supplies stronger assurance and may expose missing premises | The call adds verification cost without advancing discovery |
| F4 | Withhold objections on the next attempt | Removing verifier anchoring improves global replanning | The same defect is recreated |

The verifier feedback never mutates the candidate. Any correction produces a new candidate and a new frozen verifier contract.

## Model allocation

| ID | Comparison | Hypothesis |
| --- | --- | --- |
| L1 | Same model for every role versus a different fresh-context model | A different model supplies sufficiently different errors and routes to justify handoff cost |
| L2 | Strong model for coordination versus a cheaper coordinator | Coordinator work can become inexpensive only after its semantic decisions are reliable enough not to reduce capability |
| L3 | Free-form report versus compact report schema | Free form preserves unexpected mathematical content; a compact schema reduces handoff cost and enables deterministic routing |
| L4 | LLM coordinator versus deterministic coordinator | A deterministic coordinator becomes viable after stable report and control contracts are observed |
| L5 | Combined coordinator-reasoner report and control versus a separate interpretation turn | Combining artifacts removes a recurring call tax; separation may improve routing and evidence selection enough to repay it |

Do not infer model independence from a fresh call. Record the model, provider, prompt policy, disclosure, and compatible-continuation state for each role.

## Serial execution and concurrency

| ID | Comparison | Hypothesis |
| --- | --- | --- |
| S1 | Serial attempts versus parallel attempts at equal total spend | Parallelism mainly reduces elapsed time and adds duplicate work, so serial execution is at least as capable per dollar |
| S2 | One active sub-agent versus fan-out | Clean-context serial delegation captures most of the benefit without synthesis cost |
| S3 | Flat delegation versus nested delegation | Nested delegation helps only when a task is genuinely decomposable and the capability gain exceeds extra handoffs |

Parallelism can still improve capability at equal spend by producing diverse routes. That would be a quality effect, not a cost saving supplied by concurrency. Proposed solver V1 keeps it disabled because elapsed time is not an objective.

## Pure-reasoning boundary and future capabilities

Proposed solver V1 supplies no external information or execution. Later experiments should add one capability at a time:

| ID | Extension | Problem class it may unlock | Cost or assurance risk |
| --- | --- | --- | --- |
| X1 | Controlled theorem retrieval | Problems whose decisive input is an obscure existing theorem or exact source match | Search and context cost; nearby but inapplicable results anchor the proof |
| X2 | Example and counterexample computation | Problems where small cases reveal an obstruction, invariant, or construction | Computation can replace proof with suggestive evidence |
| X3 | Coding reasoner | Problems requiring custom search, symbolic manipulation, or certificate generation | Code correctness and execution become additional verification obligations |
| X4 | Formal or deterministic checker | Problems whose claims can be encoded and checked mechanically | Formalization cost and mismatch between encoded and intended statements |
| X5 | Indexed evidence retrieval | Campaigns whose selected evidence no longer fits directly in context | The reasoner may fail to retrieve a fact whose relevance it cannot yet see |
| X6 | Recursive or specialist sub-agents | Problems with many separable technical obligations | Handoffs, duplicated work, and integration failures increase spend |

These extensions should be compared against proposed solver V1, not bundled into a replacement architecture.

## Rethlas comparison experiment

Rethlas shows that some omitted capabilities already work in an executable system, not that its full bundle is cost-optimal. A retrieval-critical problem may be easy for Rethlas and impossible in practice for proposed solver V1: once Rethlas's Matlas theorem-retrieval component supplies an obscure theorem, the remaining proof may be short, while proposed solver V1 cannot recover information absent from both its input and the model's internal knowledge. Citation-heavy problems may have the same asymmetry because Rethlas can inspect the referenced statement and proposed solver V1 cannot. Compare one-factor hybrids:

1. Proposed solver V1.
2. Proposed solver V1 plus controlled theorem retrieval.
3. Proposed solver V1 plus explicit Rethlas-style exploration skills.
4. Proposed solver V1 plus indexed working-memory channels.
5. Proposed solver V1 plus parallel recursive proving.
6. Full current Rethlas.

Stratify problems into retrieval-critical, self-contained and tightly coupled, misleading-near-match literature, many-independent-route, overstrong-conjecture, and citation-hypothesis-mismatch groups. The first decisive comparison is proposed solver V1 versus proposed solver V1 plus retrieval on retrieval-critical and misleading-literature problems.

## Measurement

The primary result is a capability–cost frontier. Report at least:

- externally adjudicated exact resolutions;
- proposed resolutions and candidates that fail later assurance;
- candidates with verified status under their frozen verifier sets but rejected externally;
- total monetary cost, including coordination, continuation, review, verification, and failed calls;
- provider-reported token buckets and unknown-spend events;
- repeated or semantically near-duplicate routes;
- false or overbroad selected evidence discovered later;
- context supplied to every turn; and
- elapsed time as a diagnostic only.

Compare policies at matched total spend and on identical problem bytes, completion criteria, model access, and external adjudication. Interleave randomized replicates to reduce provider drift. Pilot tasks validate instrumentation; held-out tasks support claims. Experiments and their problem corpus live outside Elenx and `elenx-solve`.

## First experiments

Run the smallest comparisons before adding tools or concurrency:

1. Compare delegated, coordinator-owned, and adaptive exploration with no selected evidence.
2. Compare exact continuation, fresh restart, and restart with the prior report.
3. From one frozen report, compare no evidence, attempted-work memory, neutral negative evidence, and negative advice.
4. Compare lightweight and repeated assessment for the same proposed negative item.
5. From one failed candidate, compare same-context repair, fresh-context repair, and independent replacement.

Freeze every context package and control decision so later policies can be replayed from the same settled boundary without rerunning earlier turns.

## Open questions

- Can a coordinator select relevant evidence without doing enough object-level mathematics to become the main reasoner?
- Which observable signals justify continuing a context rather than restarting it?
- Does explicit negative advice prevent repetition or prime the prohibited route?
- How often does evidence review save later reasoning cost rather than add another correlated opinion?
- When does a different model add a different reasoning distribution rather than a lossy paraphrase?
- Which problem families reward pure sustained reasoning, and which require retrieval, computation, or formal checking?
