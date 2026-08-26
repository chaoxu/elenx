# Elenx Solve glossary

Status: canonical `exploration-v15` vocabulary.

A separate name requires distinct bytes, authority, or lifecycle.

| Term                   | Meaning                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| **campaign**           | One append-only journal with a frozen task and policy.                                                       |
| **entry**              | One immutable journal record.                                                                                |
| **call**               | One durable application operation. A call may contain several provider requests.                             |
| **provider request**   | One model-provider operation inside a call.                                                                  |
| **tool submission**    | One model's structured terminal output.                                                                      |
| **note**               | Untyped untrusted text stored inside an explorer submission.                                                 |
| **handoff**            | Derived one-use context containing the next objective, selected note bytes, and intended uses.               |
| **candidate**          | Exact standalone answer bytes submitted to frozen verifier labels.                                           |
| **assessment**         | `PASS`, `FAIL`, or `INCONCLUSIVE` plus one report.                                                           |
| **verdict**            | Candidate-bound assessment result recorded by the kernel.                                                    |
| **source certificate** | Exact external statement, URL, locator, quote, and matching checks accepted by isolated source verification. |
| **verified**           | Candidate whose required verifier labels all have PASS verdicts.                                             |
| **solved**             | Campaign state containing one verified candidate.                                                            |
| **continuation**       | Transcript-preserving provider request after an output-length stop.                                          |
| **recovery**           | Repeated operational work after interruption or provider failure.                                            |
| **repair**             | New mathematical bytes created after semantic failure.                                                       |
| **profile**            | Frozen provider, model, reasoning, API, and base URL for one Pi model mode.                                  |
| **projection**         | Allowlisted immutable fields supplied to one call.                                                           |

Explorer and verifier are the two mathematical personas. Handoff review, premise audit, and proof audit are verifier modes rather than separate authorities. The source checker is a capability boundary because it alone receives web search.
