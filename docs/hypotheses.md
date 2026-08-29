# Elenx policy hypotheses

Status: historical — the experiment plan for the retired `exploration-v15` protocol. [`design.md`](design.md) defines its boundary; the current protocol documentation lives in [`../packages/solve/docs/`](../packages/solve/docs/).

## Objective

Measure which exploration and verification policies produce the most externally adjudicated candidates for fixed spend. A smoke confirms that one policy runs and records its intended boundaries. It does not establish comparative capability.

## Baseline

V15 fixes:

- one fresh explorer at a time
- one reviewed exact handoff between explorers
- one standalone candidate artifact
- offline premise inventory
- isolated source verification for unresolved external premises
- one fresh exact proof audit
- append-only recovery and accounting

The baseline has no note search, transcript reuse, adaptive review depth, formal tools, nested agents, or parallel branches.

## Matched variations

Vary one axis at a time:

| Axis | Baseline | Later comparison |
| --- | --- | --- |
| handoff | selected notes plus next objective | no handoff, larger handoff, compressed handoff |
| handoff review | one complete packet review | no review, multiple reviews, different profile |
| exploration topology | serial fresh roots | independent parallel branches |
| candidate audit | one proof verifier | multiple models, formal checker, deterministic computation |
| premise policy | narrow web fallback | source disabled, source always enabled, human source audit |
| guidance | frozen user modules | matched alternative modules |

[`research/exposure-weighted-progressive-assurance.md`](research/exposure-weighted-progressive-assurance.md) describes adaptive verification as a deferred direction. It must not weaken the fixed handoff and candidate gates before prospective evaluation.

## Recovery tests

Interrupt and resume after each explorer submission, handoff assessment, candidate creation, offline premise inventory, source result, and candidate verdict. Settled work must not disappear or repeat. Resume after acceptance must make no model call.

## Measurement

Match task bytes, profile access, guidance, context ceilings, and verification policy. Report externally accepted candidates, rejected candidates, tokens, cost, model time, wall time, source calls, handoff review outcomes, repeated mathematical routes, and exact context shown to every role. Unknown usage and unresolved external adjudication remain unknown.

Known-solution problems support proof-guided failure analysis through [`research/known-solution-diagnostics.md`](research/known-solution-diagnostics.md).
