# Role workflow

The campaign and standalone commands use the same role contracts:

```text
ExplorerInput    -> ExplorerResult
CoordinatorInput -> CoordinatorResult
VerifierInput    -> VerifierResult
```

## Explorer

`ExplorerInput` contains the exact task, a note index, selected full note texts, one objective, and the previous verifier response when repair is needed. `ExplorerResult` contains one or more self-contained findings.

The explorer performs mathematics. It neither writes notes nor decides completion.

## Coordinator

`CoordinatorInput` contains the task, stored notes, new findings, and the previous verifier response. The coordinator files every finding with a short summary, then returns one action:

- `explore` selects the next objective and context notes.
- `verify` nominates one answer, labels it as a solution or refutation, and supplies only the notes used as premises.

The coordinator may store unverified mathematics. Acceptance remains verifier-owned.

## Verifier

`VerifierInput` contains the task, candidate kind, nominated answer, and support notes. Every internal auditor implements:

```text
Auditor = VerifierInput -> PASS | FAIL + report
```

The built-in verifier runs `requirements`, `correctness`, and `refutation` in that order. It returns `ACCEPT` only after all three pass. A failure returns `REJECT` immediately. Malformed results and provider failures remain operational errors.

The public verifier call owns the kernel candidate and aggregate verdict. Auditor calls bind to the same candidate but remain private implementation records. Ordinary inspection shows one verifier response and includes all auditor usage in campaign spend.

## Replay

The journal stores every public role input and output. The workflow fold starts from the declared task and replays successful calls in order:

```text
explorer -> coordinator -> explore
                        -> verifier -> accepted
                                    -> repair -> explorer
```

Coordinator filings deterministically mint `n1`, `n2`, and later notes. A repeated rejected proposal is suppressed from another verifier call and becomes repair context. Resume invokes the first role whose exact output is missing. A completed campaign resumes without a model request.

## Inspection and export

`inspect` reports the task, current phase, notes, public calls, terminal candidate, verifier response, telemetry-derived spend, and optional exact public inputs. Child model calls remain outside the public call list.

`export` returns the accepted kernel candidate bytes. The material contains the nominated answer followed by its supplied support notes.
