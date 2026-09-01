# Role runner audit, 2026-08-31

Six independent read-only audits reviewed commit `a8dcca7`. Each lane had a separate scope and ignored the concurrent V17 worktree.

| Audit lane           | Confirmed findings                                                                                                                                                                                                                         | Disposition                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public API           | `elenx-solve/roles` exported runtime schemas, while the Pi adapter also exported internal audit transport. Standalone CLI commands parsed each input twice.                                                                                | Export a type-and-function-only role API, keep the Pi module outside the package export map, and make the Pi role boundary own input validation.                                                                             |
| Verifier correctness | Runtime aggregation was sound. Inspection could still project a legacy direct `ACCEPT`, expose a tool submission from a failed or unsettled call, or select the wrong tool call.                                                           | Remove legacy verdict promotion. Derive the role from an exact label and expose a result only from the exact returned terminal submission of a successfully settled Pi call.                                                 |
| Minimal workflow     | The explorer, coordinator, and verifier loop had no safely removable role. Small control-flow and narrowing cleanups remained.                                                                                                             | Flatten the verifier conjunction and move call narrowing into the journal filter. Retain note resolution, duplicate suppression, and the coordinator.                                                                        |
| Journal and liveness | Trial non-resume and concurrent-writer semantics are explicit workflow limits. Inspection did not separately list unsettled role calls.                                                                                                    | Add an `unsettledCalls` projection. Defer trial resume and writer ownership because both change orchestration semantics.                                                                                                     |
| Tests and schemas    | Tests derived their expected audit set from the implementation constant, covered only one failed audit, omitted the empty verifier set, and did not lock the private package boundary.                                                     | Use a literal keyed audit fixture, test every failure position and multiple failures, test malformed and operationally failed calls, test the empty verifier guard, and reject the private Pi subpath in the packed package. |
| Adversarial workflow | A successful first turn still needs the coordinator. Repair pays explorer and coordinator calls. An unchanged proposal consumes another turn. Trial-level transport failure aborts the trial, and multiple verifiers do not short-circuit. | Preserve the measured workflow. Treat coordinator bypass, stalled termination, trial retry or resume, and verifier cancellation as workflow proposals for later discussion.                                                  |

## Implemented simplifications

- Internal verifier audits are a strict object keyed by `correctness`, `requirements`, and `refutation`. Presence and uniqueness now follow from the object schema, so the array-length and set refinement are gone.
- Role inspection uses the same exact terminal-tool rule as runtime execution and requires a successful Pi settlement before exposing any mathematical result.
- Labels determine projected roles, and a label-role mismatch cannot expose a result.
- Unsettled role calls appear in a separate top-level list.
- `allVerifiers` derives its conjunction directly with `every`.
- The package's `./roles` entrypoint exports only public types, `runTrial`, and `allVerifiers`. Pi schemas and adapters remain private.
- Standalone commands rely on the Pi role boundary for runtime input validation instead of parsing twice.

## Deferred workflow decisions

The following findings are real but exceed a simplification patch:

- bypassing or removing the coordinator when one finding appears complete
- terminating immediately when the coordinator repeats an unchanged rejected proposal
- reconstructing trial state after interruption
- adding trial-level retry after exhausted role recovery
- cancelling sibling verifiers after an operational failure or mathematical rejection
- renaming serialized fields such as `maxExplorerTurns`

These changes affect which agents run, which evidence survives, or how a trial progresses. They require a separate workflow decision and new measured runs.

## Verification

- The complete repository check passed with 92 kernel tests and 113 solver tests.
- The packed-package check confirmed the public root and `./roles` entrypoints and rejected the private `./pi-roles` subpath.
- A fresh Luna/low verifier smoke used the keyed audit schema and returned the derived public `ACCEPT` after 9.6 seconds, 876 tokens, and $0.0005522 estimated cost.
- Ordinary inspection showed only the aggregate result. The append-only journal retained the three internal keyed audit reports.
- `roles.ts` and `pi-roles.ts` fell from 628 to 612 physical lines. Fail-closed inspection and the explicit public API wrapper added 34 lines, for a net runtime increase of 18 lines. The added lines close three verdict-forging paths and remove runtime schemas from the package surface.
