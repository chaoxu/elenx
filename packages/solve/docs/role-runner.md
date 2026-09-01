# Role runner

`elenx-solve` exposes the explorer, coordinator, and verifier as typed Elenx calls:

```text
ExplorerInput    -> explorer    -> ExplorerResult
CoordinatorInput -> coordinator -> CoordinatorResult
VerifierInput    -> verifier    -> VerifierResult
```

Each role command runs one journaled model session:

```sh
elenx-solve explorer explorer-input.json roles.db settings.json
elenx-solve coordinator coordinator-input.json roles.db settings.json
elenx-solve verifier verifier-input.json roles.db settings.json
elenx-solve inspect roles.db
```

Verifier input contains only the task, the nominated answer and support notes, and an untrusted `candidateKind` of `solution` or `refutation`. The trial uses an internal hash to suppress an unchanged rejected proposal. Callers never supply that hash.

The Pi-backed verifier must complete this fixed internal audit set:

| Audit          | Obligation                                                     |
| -------------- | -------------------------------------------------------------- |
| `correctness`  | Check every load-bearing mathematical claim.                   |
| `requirements` | Check the exact target and every completion criterion.         |
| `refutation`   | Search for counterexamples, missing cases, and invalid bounds. |

Each internal audit returns `PASS` or `FAIL`. The terminal schema requires every audit exactly once. Elenx derives the public result in code:

```text
every required audit PASS -> ACCEPT the declared candidate kind
any required audit FAIL   -> REJECT
missing or repeated audit -> invalid verifier submission
operational failure       -> propagated error
```

The model cannot submit `ACCEPT` or `REJECT`. Standard role output and inspection expose only the derived `VerifierResult`. Before each verifier call, Elenx declares a kernel candidate whose material starts with the nominated answer and appends each support note in order. The verifier call is bound to that candidate. Aggregate `ACCEPT` records a kernel `PASS`, while aggregate `REJECT` records `FAIL`. Internal audit records remain verifier implementation data.

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

`elenx-solve inspect` detects role journals and V17 campaign journals. Role calls use `elenx-solve/role/<role>` journal labels. Inspection exposes a role result only after the exact terminal tool, its tool result, and the enclosing model call have all succeeded. Unsettled role calls are listed separately. Historical `role-calls.v1` journals remain readable, while new calls require `role-calls.v2`.
