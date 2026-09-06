# Dependency and compatibility check

The cleanup on 2026-09-06 checked stable npm releases and upstream release notes. `package.json`, `packages/solve/package.json`, and `bun.lock` own the package pins. Fleet's locked Nix runtime remains the Bun executable authority.

| Dependency | Pin | Decision |
| --- | --- | --- |
| Pi AI, agent core, coding agent | 0.85.1 | Current stable release. Adds Astra to the built-in OpenAI and Codex catalogs and corrects long prompt-cache options for GPT-5.6+ Responses models. |
| Zod | 4.5.4 | Current stable release. Provider schemas retain their meaning; nullable reconstruction statements now use a union of JSON Schema types instead of `anyOf`. |
| TypeScript | 7.0.2 | Current stable native compiler. The project uses its CLI for typechecking. |
| Prettier | 3.9.6 | Already current. |
| Cozo Node binding | 0.7.6 | Already the current published version. Its narrow local type boundary avoids spreading the binding's `any` return type through the solver. |
| Bun types | 1.3.14 | Retained for the deployed Bun 1.3.x runtime instead of admitting APIs from the newer 1.4.x types. |

Pi 0.85.1 fixes the SDK import problem from 0.85.0, so Elenx no longer declares `pi-server` as a workaround. Its simple-stream tool choice still supports only `auto` and `none`, so `withSerialToolCalls` remains necessary for required, serial terminal submissions. Interrupted-reasoning recovery also remains an Elenx responsibility. The public `maxRecoveries` behavior for callers that omit `maxLengthContinuations` is retained and covered by tests.

Workflow schema 20 records the changed tool-schema encoding. Role prompts, argument reconstruction, external execution contract 8, and the placement of abandonment policy in optional explorer guidance retain their existing behavior. Historical campaigns need their matching implementation.

Current dependencies and passing checks establish implementation currency. Claims about mathematical state-of-the-art performance require matched budgets, held-out problems, and external adjudication, following the [external review procedure](../packages/solve/README.md#external-final-review).

Sources: [Pi AI changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/CHANGELOG.md), [Pi coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/CHANGELOG.md), and the npm registry metadata for [Pi](https://registry.npmjs.org/@earendil-works/pi-ai/0.85.1), [Zod](https://registry.npmjs.org/zod/4.5.4), and [TypeScript](https://registry.npmjs.org/typescript/7.0.2), retrieved on 2026-09-06. Local retrieval records are under `runs/cleanup-20260906/`.
