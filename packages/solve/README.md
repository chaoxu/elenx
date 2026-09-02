# elenx-solve

`elenx-solve` runs a durable mathematical search through three typed roles:

```text
explorer(input)    -> findings
coordinator(input) -> filings + explore | verify
verifier(input)    -> ACCEPT | REJECT + report
```

The coordinator files every explorer finding as an immutable note, selects the next working set, and nominates an answer with only the support notes it uses. The verifier runs requirements, correctness, and refutation auditors through the same private `VerifierInput -> AuditResult` interface. All auditors must pass for `ACCEPT`. The first failure returns `REJECT` and stops later audits.

Every public role call records its exact input and output in the Elenx journal. Notes and the workflow cursor are derived from those records. `resume` rebuilds the state and runs the first missing role call. Candidates, auditor calls, aggregate verdicts, telemetry, and spend remain append-only evidence.

## Run

```sh
bun install --frozen-lockfile
bun packages/solve/solve.ts run problem.md criteria.md campaign.db settings.json
bun packages/solve/solve.ts resume campaign.db settings.json
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts export campaign.db
```

`run` starts a missing campaign or resumes an existing one after checking the problem, criteria, and settings. `trial` accepts the same task as one JSON file and uses the same resumable workflow.

Each role can also run alone:

```sh
bun packages/solve/solve.ts explorer input.json roles.db settings.json
bun packages/solve/solve.ts coordinator input.json roles.db settings.json
bun packages/solve/solve.ts verifier input.json roles.db settings.json
```

Settings select one model profile per public role and cap explorer turns:

```json
{
  "maxExplorerTurns": 10,
  "explorer": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  },
  "coordinator": {
    "provider": "codex-lb",
    "model": "gpt-5.6-luna",
    "reasoning": "low"
  },
  "verifier": {
    "provider": "codex-lb",
    "model": "gpt-5.6-sol",
    "reasoning": "max"
  }
}
```

The verifier profile currently backs every built-in auditor. Accepted proposals use three auditor requests. Rejected proposals use one to three because verification stops at the first failure. Auditor prompts share their proof prefix and cache identity.

## Development

```sh
bun run --cwd packages/solve check
```

See [`docs/role-runner.md`](docs/role-runner.md) for schemas, replay behavior, and inspection boundaries.
