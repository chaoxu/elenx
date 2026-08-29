# Exposure-weighted progressive assurance

Status: deferred research direction, 2026-08-21. This note is not current runtime behavior, a kernel proposal, or an implementation plan. [`../design.md`](../design.md) defined the retired `exploration-v15` solver boundary, [`../hypotheses.md`](../hypotheses.md) its experiment order (both historical), and [`pi-package-mining.md`](pi-package-mining.md#assurance-observations) records candidate observation schemas that may support this work later.

## Claim

Verification is a scarce resource that can be allocated over a changing graph of artifacts, dependencies, uses, and verifiers. An artifact accumulates assurance pressure when uncertainty about it combines with increasing downstream exposure or consequence. A verifier accumulates the same pressure when more consequential decisions depend on its judgments. A future assurance controller could select the verification action with the greatest expected reduction in downstream error per dollar, run cheap checks first, and escalate only when the evidence remains weak or the exposure warrants stronger assurance.

This combines four established patterns: sequential testing acquires evidence until a decision boundary is reached; risk-limiting audits inspect a small sample and expand toward a full recount when evidence is insufficient; operational-profile testing concentrates effort on likely use; and incremental proof or build systems track dependencies and invalidate downstream conclusions when an input changes. Recent agent systems expose narrower pieces: [CalVerT](https://arxiv.org/abs/2606.21777) gives an agent calibrated confidence and grounding telemetry for retrieval decisions, while [AI Control](https://arxiv.org/abs/2312.06942) routes suspicious outputs to a limited trusted-audit budget. The proposed Elenx abstraction adds persistent reusable artifacts, versioned verifier profiles, transitive exposure, and one cost-aware assurance scheduler.

## Model

For an artifact revision \(x\), let \(q_x\) denote the probability that it is wrong given the observations available to the controller, \(u_x\) its expected downstream exposure, and \(h_x\) the consequence of relying on it when it is wrong. A first risk model is

\[
R_x = q_x u_x h_x.
\]

Exposure may include direct presentation to explorers, transitive proof dependencies, proposed resolutions that rely on the artifact, and search routes suppressed by negative evidence. Use changes the consequence of an error rather than the truth of the artifact. A frequently reused false obstruction can have high exposure because it silently prevents exploration even when no final proof cites it.

A verifier requires at least two conditional rates: \(P(\mathrm{PASS}\mid\mathrm{correct})\) and \(P(\mathrm{PASS}\mid\mathrm{incorrect})\). The first alone rewards a verifier that always passes. These rates depend on the problem family, error type, candidate generator, model and protocol, available tools, and disclosure policy. Multiple verdicts require joint error observations because model, prompt, source, formalization, and toolchain families can create correlated failures.

For verification action \(a\) with cost \(c_a\), an ideal controller would estimate its expected value of sample information:

\[
\operatorname{EVSI}(a,x) = R_x - \mathbb{E}[R_x \mid \text{result of } a].
\]

The controller would prefer actions with high expected risk reduction per dollar and stop when further reduction does not justify its cost or when a frozen assurance policy has been satisfied. Any numerical estimate remains an application-policy projection; Elenx `verified` continues to mean that the candidate's declared gates passed.

## Why implementation is premature

Elenx can preserve exact calls, candidate bytes, verdicts, evidence, model identities, provider-reported usage, and selected provenance. Those records measure realized activity. They do not yet support the predictive quantities needed by an adaptive controller:

- There is no calibrated estimate of verifier false acceptance or false rejection on candidates drawn from the actual explorer distribution.
- There is no estimate of joint failures between verifier profiles. Repeating one model or prompt cannot be treated as independent evidence.
- Provider usage can measure much of a completed call's realized spend, with unknown usage left unknown, but there is no validated prediction of an action's cost before dispatch or of the risk reduction purchased by that cost.
- Evidence selection and context records expose some direct uses, but Elenx has no general artifact dependency graph, transitive exposure model, or consequence model.
- External adjudications are too sparse to identify truth, calibration drift, or problem-family effects.
- An adaptive policy would choose which artifacts receive more checking. Training a reliability model on those selected observations without recording selection probabilities would bias its estimates.

Premature implementation would therefore replace a frozen transparent cadence with an uncalibrated score that appears quantitative while encoding guesses. The immediate empirical objective remains externally accepted resolutions per dollar under matched fixed policies.

## Telemetry needed before a controller

The useful next observations are application-level evaluation records, not new kernel truth semantics:

1. Bind every verifier observation to the exact candidate, verifier profile, method and dependence families, verdict, evidence, realized usage, and selection policy.
2. Record independent `CORRECT`, `INCORRECT`, or `UNRESOLVED` adjudications without deriving them from Elenx verdicts.
3. Include deliberately flawed candidates as well as correct resolutions so false acceptance can be measured. Preserve the generator and error family of each candidate.
4. Record which exact evidence revisions each explorer saw, nominated, retained, or used in a proposed resolution. Add explicit dependency edges only when the application can state them faithfully.
5. Preserve rejected, inconclusive, interrupted, and unselected cases. Unknown labels and missing usage remain unknown.
6. Version verifier profiles and separate evaluation data across model, prompt, toolchain, and policy changes.
7. If an adaptive selector is tested, first run it in shadow mode and record every available action, predicted priority, chosen action, and selection propensity without letting it change candidate status.

The existing [`assurance-observation/v1`](pi-package-mining.md#assurance-observations) and `truth-adjudication/v1` sketches cover much of the first two items. They should remain evaluation artifacts until repeated use demonstrates a stable shared contract.

## Evidence gates for revisiting the idea

Implementation becomes justified only after fixed-policy campaigns provide all of the following:

- enough independently adjudicated correct and incorrect candidates to estimate verifier behavior by at least the major problem and error families;
- observed joint failures that distinguish useful method diversity from repeated correlated judgments;
- reliable realized-cost attribution and a held-out test of any pre-dispatch cost predictor;
- evidence-use records showing that reuse and transitive dependence can be reconstructed without asking a model to invent the graph retrospectively;
- an offline or shadow replay in which an adaptive policy improves externally accepted resolutions per dollar, or reaches the same outcomes more cheaply, without increasing false acceptance beyond a declared limit; and
- stability under a held-out time period or verifier-profile revision rather than only the data used to design the scheduler.

Until these gates are met, fixed versioned assurance policies are the control condition. Ordinal labels such as `sample-starved`, `uncalibrated`, and `high exposure` may guide analysis, but they do not become probabilities or promotion authority.

## Detachment invariant

The assurance controller must remain removable without weakening or changing the meaning of the Elenx kernel. It is a projection and scheduler attached to durable observations, not a second status authority. Its probability estimates, exposure graph, verification-debt queue, action rankings, calibration models, and caches belong in rebuildable application or evaluation state. The kernel continues to understand only immutable artifacts, calls, admitted tool effects, verdicts, and derived satisfaction of declared verifier gates.

An attached controller may request ordinary Elenx calls and verdicts through the same public contracts as any other application policy. Those completed records remain valid historical facts after the controller is removed. A controller must never write a probability, risk score, or recommendation that changes `deriveCandidateStatus`, and no campaign may require the controller merely to open, inspect, replay, or derive its kernel status.

The architectural acceptance test is literal removal:

1. Disable or delete the controller and its derived store.
2. Open every existing campaign with the core reader.
3. Recover the same candidate bytes, calls, verdicts, and `deriveCandidateStatus` results.
4. Replay the kernel invariants without the controller package.
5. Continue new campaigns under a fixed application policy.

Losing the controller may lose optimization, prioritization, and calibrated reporting. It must not lose evidence, corrupt recovery, reinterpret an old verdict, or make the core database unreadable. If several independent policies later need one new mechanical invariant, that invariant can be considered separately for the kernel under the existing growth rule; the assurance theory itself remains outside.

## Possible harness boundary

If the evidence gates eventually pass, the feature belongs in a detachable application-level assurance controller over Elenx records. The kernel would continue to own immutable identity, calls, verdicts, and replay. Verifier adapters would continue to produce observations. External evaluators would supply truth adjudications. The controller would maintain derived exposure and reliability views, select the next check, and freeze either a flat verifier set or a versioned sequential assurance policy before that policy can determine candidate acceptance.

The full research question is:

> Can an exposure-weighted progressive assurance policy produce more externally accepted resolutions per dollar than a frozen verification cadence while respecting the same false-acceptance limit?
