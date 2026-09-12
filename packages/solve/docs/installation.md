# Install the solver

Elenx requires Bun 1.3.13 or newer. Release `v0.9.4` includes the `elenx` kernel at version 0.9.4 and `elenx-solve` at version 0.35.0. Install both packages in a project directory:

```sh
mkdir elenx-project
cd elenx-project
bun add --minimum-release-age 86400 https://github.com/chaoxu/elenx/releases/download/v0.9.4/elenx-0.9.4.tgz https://github.com/chaoxu/elenx/releases/download/v0.9.4/elenx-solve-0.35.0.tgz
bun pm trust cozo-node
bun run elenx-solve contract
```

The install command uses Bun's one-day release-age filter to avoid partially published upstream dependency versions. The trust command allows Cozo's install script to install the native database binding used by the solver. Both packages include the MIT license. The release assets also include `SHA256SUMS` for checking downloaded archives.

## Choose a provider

With an OpenAI API account, configure `OPENAI_API_KEY` in your environment or the OpenAI credential through Pi. Use the included profile:

```sh
bun run elenx-solve run node_modules/elenx-solve/examples/task-even-sum.json campaign.db node_modules/elenx-solve/examples/settings-openai.json
```

With an OpenAI Codex subscription, use Pi's `/login` command to authenticate the **OpenAI Codex** provider:

```sh
bunx --package @earendil-works/pi-coding-agent@0.85.1 pi
```

After logging in and exiting Pi, run the small setup example. This profile uses Luna with low reasoning for every role:

```sh
bun run elenx-solve run node_modules/elenx-solve/examples/task-even-sum.json campaign.db node_modules/elenx-solve/examples/settings-openai-codex.json
```

These profiles use public provider endpoints and Pi credentials. They require no Fleet services, private model registry, or lab certificate. The source verifier in both examples runs through Pi without web search. Use a new campaign path when changing profiles, since each campaign fixes its settings.

## Inspect and guide

```sh
bun run elenx-solve inspect campaign.db
bun run elenx-solve guide --id try-direct-proof campaign.db node_modules/elenx-solve/examples/guidance.txt
bun run elenx-solve inspect --include-guidance campaign.db
bun run elenx-solve export campaign.db
```

Submit guidance while a campaign is active or paused for delivery to a future Explorer turn. Advice on a completed campaign remains pending. Repeat the original `run` command after an interruption to resume, and use `export` after acceptance to obtain the argument for external review. [Agent usage](agent-usage.md) explains receipts, delivery, and recovery.

## Existing campaigns

The current source uses workflow schema 32 and execution-contract schema 9. It supports optional Explorer continuation, externally verified notes, and acceptance of a supplied complete proof after all four checks with zero Explorer turns. Released Solver 0.35.0 uses workflow schema 24 and execution-contract schema 8. The kernel schema and CLI run arguments remain unchanged. Campaigns from earlier workflow schemas need their matching implementation. Preserve a campaign together with its task, settings, and package revision.
