# Elenx design

Status: current design. [`../SPEC.md`](../SPEC.md) is authoritative when a design explanation and the kernel contract differ.

## Goal

The surrounding research goal is to maximize correct, auditable resolutions per unit cost. Elenx contributes the evidence substrate. It preserves what was attempted, what external effects were admitted, which exact artifact was judged, and why a workflow derived a status. It does not decide how to solve the task.

The small boundary is intentional. A fixed strategy embedded in the kernel is difficult to revise, hard to ablate, and likely to duplicate decisions that a strong reasoning model can make from the live evidence.

## Responsibility boundary

| Responsibility | Owner |
| --- | --- |
| Choose routes, interpret partial progress, and decide what to try next | Model |
| Assemble context, select tools, set budgets, coordinate episodes, choose assurance, and publish results | Application |
| Preserve exact candidates, calls, admitted tool effects, request checkpoints, verdict bindings, and accounting | Elenx kernel |
| Decide whether the mathematical result is true | An application-selected formal oracle, independent adjudicator, or other external authority |

The kernel has no task corpus, benchmark problems, evaluation runner, route scheduler, research queue, or universal verifier. Unit tests check the semantic contract; experiments and mathematical tasks live in separate projects.

## Model-first policy

Elenx applications start with the smallest loop that lets the model reason about the whole task.

1. **Trust the model to reason.** Give a capable model enough context and latitude to develop and revise a substantive approach. Trust in its reasoning ability is not trust in the truth of its output.
2. **Keep strategy dynamic.** A route's value can change after a new lemma, example, or obstruction. Stored priorities are earlier judgments, not permanent commands.
3. **Keep thinking in the model.** Mechanical code should enforce execution and evidence invariants. It should not become a second, weaker reasoner through fixed route priorities or anticipated mathematical failure rules.

Every strategic mechanism above the kernel must earn its place as a separable intervention. The experiment backlog in [`hypotheses.md`](hypotheses.md) starts from an empty cross-episode projection and adds memory, model handoffs, tools, feedback, and assurance independently.

## Durable history and model-facing memory

The supported API retains a rich append-only forensic history. The next model call should not receive that entire history by default. Its model-facing projection is a separate application decision.

A projection item earns context only when it can change the next decision and the next call cannot reliably recover it from the visible task or current transcript. Repeating standard definitions, unchanged proof text, or facts already present in context consumes tokens without adding information. Prior obstructions, external observations, unresolved obligations, and handoff details may be worth preserving.

The initial projection channels are `done`, `stop`, `open`, and `next`. They are application vocabulary, not kernel record types. A stop item is advice unless an independently checked execution or safety invariant makes it a hard constraint. The value of every channel, including an empty projection, remains an experimental question.

## Serial coordination

Provider-priced parallelism primarily buys lower wall-clock latency. It does not reduce the calls or tokens already launched and can add duplicate reasoning and synthesis work. The default application topology is therefore one coordinator and at most one active sub-agent.

The coordinator owns the evolving campaign projection and decides whether a bounded consultation is worth its cost. A sub-agent returns a distinct, durably recorded observation, critique, source check, or calculation; it does not become a second scheduler or directly mutate campaign policy or the strategic projection. Parallel fan-out and nested delegation are optional treatments to test when their quality or latency benefit can justify their added work.

[`elenx-solve`](https://gitea.lab/chaoxu/elenx-solve) implements this baseline. Its protocol, not the kernel, defines episode transitions and model-facing projections.

## Truth boundary

Model output is a candidate. A model verifier is another fallible observation and may share the producer's errors. Elenx can establish that the declared verifier calls settled, referred to the exact candidate, and satisfied the frozen admission rule. It cannot establish that the verifier is sound or assign a correctness probability.

`verified` therefore means that the candidate satisfied its declared durable gates. Formal checking, blinded review, independent reconstruction, truth adjudication, or another assurance policy belongs to the application. Telemetry and cost never change candidate status.

## Change rule

New kernel code must protect a semantic invariant shared by multiple applications. Strategy, memory policy, prompt structure, retries, stopping rules, model selection, and assurance topology stay outside the kernel unless a concrete cross-application invariant cannot be enforced there. New harness machinery should expose a clear switch, predicted benefit, measurable cost, and removal rule.
