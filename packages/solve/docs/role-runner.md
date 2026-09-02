# Role runner

`elenx-solve` exposes the explorer, coordinator, and verifier as typed Elenx calls:

```text
ExplorerInput    -> explorer    -> ExplorerResult
CoordinatorInput -> coordinator -> CoordinatorResult
VerifierInput    -> verifier    -> VerifierResult
```

The explorer and coordinator commands each run one journaled model session. The verifier command records one public verifier call and runs its auditors as private model calls:

```sh
elenx-solve explorer explorer-input.json roles.db settings.json
elenx-solve coordinator coordinator-input.json roles.db settings.json
elenx-solve verifier verifier-input.json roles.db settings.json
elenx-solve inspect roles.db
```

Verifier input contains only the task, the nominated answer and support notes, and an untrusted `candidateKind` of `solution` or `refutation`. The trial uses an internal hash to suppress an unchanged rejected proposal. Callers never supply that hash.

Every auditor has the same private interface:

```text
VerifierInput -> auditor -> AuditResult { verdict: PASS | FAIL, report }
```

The Pi-backed verifier supplies three implementations:

| Audit          | Obligation                                                     |
| -------------- | -------------------------------------------------------------- |
| `requirements` | Check the exact target and every completion criterion.         |
| `correctness`  | Check every load-bearing mathematical claim.                   |
| `refutation`   | Search for counterexamples, missing cases, and invalid bounds. |

The verifier calls `requirements`, then `correctness`, then `refutation`. Each implementation receives the complete verifier input and returns through the same strict schema. A `FAIL` stops the sequence before later auditors consume tokens. Elenx derives the public result in code:

```text
all three audits PASS       -> ACCEPT the declared candidate kind
first audit FAIL            -> REJECT and skip later auditors
malformed auditor result    -> propagated error
auditor operational failure -> propagated error
```

Accepted proposals use three auditor model requests. Rejected proposals use one to three requests because the verifier stops at the first failure.

An auditor cannot submit `ACCEPT` or `REJECT`. Before each public verifier call, Elenx declares a kernel candidate whose material starts with the nominated answer and appends each support note in order. The deterministic outer call and every child auditor call are bound to that candidate. The outer call records the exact `VerifierInput` and derived `VerifierResult`. Aggregate `ACCEPT` records a kernel `PASS`, while aggregate `REJECT` records `FAIL`. Standard role inspection exposes the outer result and keeps child audit records internal.

`trial` connects the same role calls into an experimental search:

```sh
elenx-solve trial trial-input.json roles.db settings.json
```

The trial files every explorer finding as an immutable note. The coordinator then requests another exploration or nominates a candidate for verification. A `solution` candidate claims to satisfy the requested task. A `refutation` candidate claims to prove that the exact requested mathematical target is false or impossible. The coordinator's label has no authority: the verifier checks both the mathematics and the declared candidate kind. An accepted solution ends as `accepted`, and an accepted refutation ends as `refuted`. A rejection becomes the next explorer's repair objective. The explorer-turn limit ends an unresolved trial.

CLI trials use role protocol `role-calls.v2` and emit a versioned execution report. `accepted` and `refuted` reports name the exact verified kernel candidate and its candidate kind. A `turn-limit` report names no candidate. `elenx-solve contract` publishes this report schema and the exact trial argument order for run managers.

`refuted` requires a verified certificate against the exact target. A defect in one attempted proof, a missing exposition requirement, an ambiguity, or a claim that the problem is open remains a rejection or unresolved search.

Trial notes and its cursor live in memory. Every role call is durable. An interrupted trial must restart with a new database because the trial cursor is not reconstructed. Standalone role commands remain suitable for externally orchestrated workflows.

## Live debug trial

Elenx Lab's local development backend supplies the fleet codex-lb model registry, CA certificate, OpenBao credential, and required usage tag around the ordinary trial command:

```sh
bun run debug:trial -- TRIAL.json runs/debug-name SETTINGS.json debug/name--r01/attempt-1
```

The run directory must be new. Lab copies the exact trial and settings files and records the usage tag and Git revision state in `debug-run.json`. A successful run writes `campaign.db`, `result.json`, and `inspect.json`. A failed solver process preserves `campaign.db` when one was created and writes stdout and stderr logs. Local debugging and Nomad workers use the same Lab attempt executor; the command remains development tooling rather than a new solver mode.

Throwaway debugging remains local. A run that becomes evidence can later enter Elenx Lab as a development run through its planned registration or adoption path. Matched evaluation and holdout runs enter Lab before launch so their inputs and provenance are frozen.

The settings file selects one model profile per role:

```json
{
  "explorer": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  },
  "coordinator": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  },
  "verifier": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  }
}
```

The library exports the `Roles` interface, its input and result types, `runTrial`, and `allVerifiers` from `elenx-solve/roles`. Runtime schemas and the Pi adapter remain private. A `Roles` value contains `explorer(input)`, `coordinator(input)`, and `verifier(input)`, each returning its typed result directly. Call IDs, timing, and token use remain available through `elenx-solve inspect`. `runTrial` accepts any `Roles` value, so callers can replace one function without changing the trial. `allVerifiers(verifierA, verifierB)` returns `ACCEPT` only when every supplied verifier returns `ACCEPT`. A rejection from any verifier yields `REJECT`, while operational errors propagate without becoming mathematical verdicts.

`elenx-solve inspect` detects role journals and V17 campaign journals. Public role calls use `elenx-solve/role/<role>` labels. Verifier auditors use `elenx-solve/role/verifier/auditor/<name>` labels and stay outside the public call list. Inspection exposes an explorer or coordinator result only after its terminal tool and model call succeed. It exposes a verifier result only after the deterministic outer call returns. Unsettled public calls are listed separately.
