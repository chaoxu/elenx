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

Verifier input contains only the task, nominated answer, and support notes. The trial uses an internal hash to suppress an unchanged rejected proposal. Callers never supply that hash.

The Pi-backed verifier must complete this fixed internal audit set:

| Audit          | Obligation                                                     |
| -------------- | -------------------------------------------------------------- |
| `correctness`  | Check every load-bearing mathematical claim.                   |
| `requirements` | Check the exact target and every completion criterion.         |
| `refutation`   | Search for counterexamples, missing cases, and invalid bounds. |

Each internal audit returns `PASS` or `FAIL`. The terminal schema requires every audit exactly once. Elenx derives the public result in code:

```text
every required audit PASS -> ACCEPT
any required audit FAIL   -> REJECT
missing or repeated audit -> invalid verifier submission
operational failure       -> propagated error
```

The model cannot submit `ACCEPT` or `REJECT`. Standard role output and inspection expose only the derived `VerifierResult`; internal `PASS` and `FAIL` records remain verifier implementation data.

`trial` connects the same role calls into an experimental search:

```sh
elenx-solve trial trial-input.json roles.db settings.json
```

The trial files every explorer finding as an immutable note. The coordinator then requests another exploration or nominates an answer for verification. A rejection becomes the next explorer's repair objective. An acceptance or the explorer-turn limit ends the trial.

Trial notes and its cursor live in memory. Every role call is durable. An interrupted trial must restart with a new database because the trial cursor is not reconstructed. Standalone role commands remain suitable for externally orchestrated workflows.

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

The library exports the `Roles` interface, its input and result schemas, `runTrial`, and `allVerifiers` from `elenx-solve/roles`. A `Roles` value contains `explorer(input)`, `coordinator(input)`, and `verifier(input)`, each returning its typed result directly. Call IDs, timing, and token use remain available through `elenx-solve inspect`. `runTrial` accepts any `Roles` value, so callers can replace one function without changing the trial. `allVerifiers(verifierA, verifierB)` returns `ACCEPT` only when every supplied verifier returns `ACCEPT`. A rejection from any verifier yields `REJECT`, while operational errors propagate without becoming mathematical verdicts.

`elenx-solve inspect` detects role journals and V17 campaign journals. Role calls use `elenx-solve/role/<role>` journal labels.
