# GPT-5.6-Sol mechanism findings for Elenx

Status: accepted engineering evidence from an explicitly overfit benchmark experiment. “Accepted” means the assigned prompt won by at least one root-certified paired strict result under the user-selected rule. It is not a governed holdout verdict from `elenx-scientist`.

## The question

When a mathematical proof attempt fails, should the next attempt keep repairing the old route or build a different route?

The benchmark held the problem, rejected answer, critique, model, reasoning level, and evidence order fixed. It changed only the route policy.

A strict result is a complete checked proof or counterexample. The paired net counts problems solved only by one arm and subtracts problems solved only by the comparator. A complete-pair net uses candidates with retained answers in both arms. A censored assignment exhausted its infrastructure attempts. The hostile censoring lower bound treats every missing treatment answer as a failure and every missing comparator answer as a success.

## Accepted prompt-policy finding: request a new route after a central failure

**Claim.** When the earliest decisive gap is central, assigning a prompt that demands a materially different proof architecture produces more strict literal-target resolutions than assigning a prompt that demands preservation of the old architecture.

**Implementation.** The replacement arm received this policy text:

> Discard the previous answer's load-bearing proof architecture. Do not reuse its central lemma, principal reduction, main invariant, gadget family, probabilistic coupling, or counterexample strategy. Routine definitions and independently verified standard facts may be reused. Build a materially different route whose first non-routine obligation differs from the previous route, and test that obligation before expanding the proof.

The preservation arm was instructed to keep the old central reduction, invariant, construction, coupling, or decomposition. Both arms received the same failed answer and reference-blind critique. Every answer went through a blind verifier, two source-aware reviews, tiebreaks where needed, and hostile reconstruction of every strict or explicit-counterexample claim.

**Result.** Round one produced 21 strict resolutions for replacement and 3 for preservation, a paired net of `+18`. Replication on 24 triggered candidates produced 16 and 3, a paired net of `+13`. The complete-pair replication net was `+8`. Assigning every censored replacement answer the worst grade and every censored preservation answer the best grade still left `+5`.

The replication strict results were 2 proofs and 14 counterexamples for the replacement assignment. The preservation assignment produced 3 counterexamples, all of which violated its route-preservation instruction. The measured effect is therefore an intention-to-treat effect of the assigned prompts. It does not identify the causal effect of routes that were actually preserved versus routes that were actually replaced. It is mainly a target-audit and counterexample-discovery improvement, not a claim that replacement proves 14 more intended theorems.

**Engineering suggestion.** In Elenx, activate this policy after a failure report identifies a false or missing load-bearing lemma, invalid reduction, broken invariant, wrong quantifier, or a potentially false literal target. Ask the explorer to test the first non-routine obligation of the new route on a smallest meaningful instance before expanding the route.

## Accepted but fragile prompt-policy finding: let the explorer choose

**Claim.** Giving the explorer freedom to preserve, modify, combine, or replace the old route beats forcing preservation.

**Result.** Round one net was `+10` and replication net was `+8`. The replication complete-pair net was `+4`. A hostile censoring bound reduced the effect to a tie, so this policy is accepted under the frozen engineering rule but is less robust than explicit replacement.

**Engineering suggestion.** Use free choice when the failure classification is uncertain. Use explicit replacement when the evidence identifies a central route defect.

## Elenx injection point

The policy belongs in the frozen `explorerGuidance` array in the arm settings. The current `exploration-v17` explorer already receives guidance, a curator-selected working set, a next objective, and boundary-failure context. The kernel journal, curator ingest, triage, and verifier remain unchanged.

The guidance must include a context check:

> Apply preserve-versus-replace reasoning only when the exact failed route text and an exact failure report are present. If either is missing, request expansion of the relevant note and state a precise next objective. Do not infer hidden proof steps from a summary.

This prevents the explorer from being asked to replace a route that it has never seen. The curator is responsible for serving the failed note text and exact report. A future protocol revision may expose these fields as one normalized repair context, but the first test should use the existing guidance and expansion interfaces.

## Evidence against tested alternatives

- Generic obligation and boundary preflight produced no strict rescue and used more reasoning. Do not add a checklist to every first attempt.
- A stronger hostile verifier did not improve the verifier bank. Keep verification independent, but do not expect adversarial wording alone to solve the problem.
- An automatic target-health gate found known false targets but repeated false alarms on valid controls. Route target warnings to review rather than automatic rejection.
- The experiment cannot test claims about plaintext hidden reasoning. Provider-reported reasoning tokens and visible answer waste are separate measurements.

## Next hypotheses

### H13: exact failed-route context is necessary

**Prediction.** Replacement guidance works better when the explorer receives both the exact failed route and the exact critique than when it receives only one of them or neither.

**Experiment.** Hold the replacement policy fixed in a 2×2 context ablation: neither object, exact route only, exact critique only, and both objects. Pair all 54 eligible problems. Score proofs and counterexamples separately.

### H7: conditional escalation saves compute

**Prediction.** A policy that preserves local routes and escalates central failures to replacement can retain most strict resolutions at lower provider cost than always using replacement.

**Experiment.** Freeze a route-severity classifier before calls. Compare an oracle-gated conditional arm with always-replacement and free-choice arms. Treat this first run as an upper-bound test because the classifier uses prior failure labels.

### H14: counterexample-first replacement reduces wasted proof expansion

**Prediction.** Asking a replacement attempt to test literal-target edge cases before writing a long proof increases strict counterexample yield or reduces reasoning without reducing valid proofs.

**Experiment.** Hold context and replacement policy fixed. Compare replacement with and without the explicit counterexample-first instruction. Green requires at least one paired strict counterexample gain with no paired strict proof loss. If strict outcomes tie, at least 25% fewer provider-inclusive reasoning tokens is a separate efficiency success.

## Interpretation rule

Green means a frozen comparison passed its stated engineering rule. Red means the completed comparison failed that rule. Blue means useful audit or descriptive evidence. Gray means no direct test exists or the required observation is unavailable.

The accepted replacement finding applies to the in-sample benchmark and its triggered replication set. It should guide a small Elenx experiment, not become an unconditional global behavior before that experiment is run.

## Evidence

- Human-readable report: `https://artifacts.lab/html/gpt-5-6-sol-study.html`
- Benchmark source report: [`REPORT.md`](../../../mathagent_benchmark/reports/ad-hoc-sol-mechanism-tests-20260831/REPORT.md)
- Frozen replication analysis: [`replication-analysis.json`](../../../mathagent_benchmark/reports/ad-hoc-sol-mechanism-tests-20260831/replication-analysis.json)
- Elenx guidance authority: [`guidance.md`](../../packages/solve/docs/guidance.md)
- Elenx role boundaries: [`data-flow.md`](../../packages/solve/docs/data-flow.md) and [`protocol.md`](../../packages/solve/docs/protocol.md)
