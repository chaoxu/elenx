# Elenx Solve glossary

Status: canonical `exploration-v17` vocabulary.

A separate name requires distinct bytes, authority, or lifecycle.

| Term                   | Meaning                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| **campaign**           | One append-only journal with a frozen task and policy.                                                       |
| **entry**              | One immutable journal record.                                                                                |
| **call**               | One durable application operation. A call may contain several provider requests.                             |
| **provider request**   | One model-provider operation inside a call.                                                                  |
| **tool submission**    | One model's structured terminal output.                                                                      |
| **finding**            | One self-contained free-text report from an explorer, with the note IDs it builds on.                        |
| **note**               | One immutable `(summary, exact text, dependency IDs)` finding.                                               |
| **index**              | Every non-refuted note's ID, standing, and summary, shown whole to every explorer.                           |
| **working set**        | The full note texts served to one explorer turn.                                                             |
| **triage plan**        | The frozen-menu mode list one triage call assigns to one note, with a rationale.                             |
| **mode**               | One verification method: `proof-audit`, `reconstruction`, `refutation`, or `external-premises`.              |
| **assessment**         | `PASS`, `FAIL`, or `INCONCLUSIVE` plus one report.                                                           |
| **standing**           | Derived note status: `verified`, `conjecture`, `report`, or `refuted`. Never stored.                         |
| **verified**           | A note with proof audit or reconstruction and `PASS` for every planned mode, conditional on its `basedOn`.   |
| **goal note**          | The live note whose statement the curator declares to meet the completion criteria.                          |
| **boundary battery**   | Every mode plus `criteria-match`, run against the goal note with unconditional authority.                    |
| **verified tower**     | The goal note and its fully verified, acyclic ancestor closure — the campaign's result.                      |
| **candidate**          | The goal note's exact bytes, bound by the kernel to the battery's acceptance verdicts.                       |
| **verdict**            | Candidate-bound assessment result recorded by the kernel.                                                    |
| **source certificate** | Exact external statement, URL, locator, quote, and matching checks accepted by isolated source verification. |
| **solved**             | Terminal campaign state: the goal note passed the boundary battery over a verified tower.                    |
| **fold / refold**      | The deterministic reconstruction of store and phase state from journal events on start and resume.           |
| **index-limit**        | Terminal report when the assembled live index exceeds `maxIndexTokens`.                                      |
| **continuation**       | Transcript-preserving provider request after an output-length stop.                                          |
| **recovery**           | Repeated operational work after interruption or provider failure.                                            |
| **profile**            | Frozen provider, model, reasoning, API, and base URL for one role.                                           |
| **projection**         | Allowlisted immutable fields supplied to one call.                                                           |

Explorer and verifier are the two mathematical personas; the curator controls observation, never standing. Triage and the mode calls are one verification subsystem with two call sites. The source checker is a capability boundary because it alone receives web search.
