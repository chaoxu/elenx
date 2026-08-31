# Decomposed workflow experiment

The decomposed runner exposes the solver's agent boundaries as typed Elenx calls:

```text
ExplorerInput    -> explorer    -> ExplorerResponse
CoordinatorInput -> coordinator -> CoordinatorResponse
VerifierInput    -> verifier    -> VerifierResponse
```

Each role can run alone:

```sh
bun decomposed-cli.ts explorer explorer-input.json scratch.db settings.json
bun decomposed-cli.ts coordinator coordinator-input.json scratch.db settings.json
bun decomposed-cli.ts verifier verifier-input.json scratch.db settings.json
bun decomposed-cli.ts inspect scratch.db
```

The scratch loop composes the same operations:

```sh
bun decomposed-cli.ts loop-once scenario.json scratch.db settings.json
```

The settings file may use the compact component shape:

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

Existing V17 settings also work. Their curator profile supplies the coordinator, and their triage and source-checker profiles are ignored.

The coordinator files every explorer finding, then returns either an exploration request or a verification request. It can store and serve unverified mathematics but cannot accept it. The verifier receives a hash-bound nominated answer and cited support notes and returns one opaque `ACCEPT` or `REJECT` response. Internal verification methods never become workflow phases.

`runDecomposedLoop` accepts ordinary functions for all three roles. A caller can replace the verifier with one implementation or a composition. `requireAllVerifiers` runs independent verifier components and aggregates their responses behind the same verifier interface. The default CLI uses one verifier.

Every real role invocation is journaled in a scratch campaign under `elenx-solve/decomposed/<role>`. Scratch campaigns reject V17 databases. `loop-once` tests recomposition but does not recover its in-memory note state after a process restart. Use the individual role commands for interruptible experiments. Full loop replay is required before this experiment can replace V17.
