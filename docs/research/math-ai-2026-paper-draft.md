# Reasoning Depth versus Orchestration in Mathematical AI Harnesses

**Submission target:** MATH-AI 2026 (NeurIPS workshop)  
**Status:** four-page paper draft; empirical results to be filled from matched runs

## Abstract

Mathematical AI systems are increasingly wrapped in harnesses that allocate work among model calls, critics, tools, and persistent state. These systems differ not only in capability but in where they spend inference budget. We study a complementary design: Elenx keeps mathematical search inside long, coherent reasoning episodes and uses a small durable kernel for candidates, calls, and independent verification. We compare reasoning depth with external orchestration under matched budgets on a research-style mathematics benchmark. The evaluation reports verified solutions as a function of total dollars, decomposes spend into reasoning and coordination, and includes ablations of continuation, memory, and verification. The result is a capability–cost frontier rather than a single accuracy score.

## 1. Question

When a strong reasoning model is given a fixed inference budget, should a mathematical harness spend that budget on longer coherent thought or on more external orchestration? Existing agent evaluations usually compare final accuracy while hiding coordination, retries, context reconstruction, and verification costs.

Our hypothesis is that long-horizon reasoning can be a competitive primitive for difficult mathematics, provided the harness preserves exact state and prevents unverified claims from becoming conclusions.

## 2. Systems

We compare (i) a direct long reasoning call, (ii) the author's earlier multi-agent harness, and (iii) Elenx. Elenx records an append-only campaign artifact, supports continuation after length stops, preserves model-native reasoning state, and separates exploration from independent verification. All systems use the same base model, problem statement, tools, verifier, and total dollar budgets.

## 3. Evaluation

Tasks are drawn from [benchmark]. Development tasks are used to tune prompts and budgets; held-out tasks are never used for routing decisions. A success requires a complete proof or disproof accepted by the predeclared independent verifier. We run paired trials at budgets [$B_1$, $B_2$, $B_3$] with [replicates] replicates per task.

For every paid request we record model, provider, reasoning effort, input and output usage, cache usage, retries, and billed cost. We report verified tasks solved, total dollars, reasoning tokens, orchestration tokens, number of calls, elapsed time, and cost per verified solution. The primary figure is the Pareto frontier of verified solutions versus dollars.

## 4. Results

The current Elenx evidence is a longitudinal four-candidate campaign on IMO 2011 Problem 2. Three candidates were rejected by the independent proof auditor, with localized counterarguments identifying the failed load-bearing lemma; the fourth received PASS after supplying a self-contained proof covering all cardinalities. The campaign contains 26 model calls, 13 tool calls, four candidates, and four verdicts. This is a systems smoke test, not yet a statistically powered benchmark comparison: the paper must label it as such until matched direct and orchestration baselines are run on held-out tasks.

**Table 1.** Fill with matched-budget results for the three systems.  
**Figure 1.** Capability–cost frontier.  
**Figure 2.** Budget decomposition: reasoning, coordination, verification, and retries.

The main claim will be stated only for the observed benchmark and budgets: [system] solves [x] more held-out tasks at [$B$], while [system] is [dominated/on the frontier] at [$B'$].

## 5. Ablations and discussion

Remove one Elenx mechanism at a time: length continuation, durable state, independent verification, and long single-episode reasoning. These ablations distinguish reasoning depth from merely spending more tokens. We discuss benchmark size, verifier error, model snapshot, and the limits of generalizing from research-style mathematics to other domains.

## Contributions

1. A matched-cost evaluation protocol for reasoning-heavy mathematical harnesses.
2. An empirical comparison of long coherent reasoning and external orchestration.
3. An auditable accounting method that exposes reasoning, coordination, and verification spend separately.
