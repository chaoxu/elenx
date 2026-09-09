# Use Elenx from another agent

An agent operates Elenx through command-line calls and JSON output. It can read progress and append Explorer guidance while a run is active. Elenx stores the advice and the Explorer inputs that use it in the campaign database.

The examples below run from the repository root with Bun. [Installation](installation.md) covers released packages and provider credentials. In an installed project, use `bun run elenx-solve` in place of `bun packages/solve/solve.ts`, and find the examples under `node_modules/elenx-solve/examples/`.

## Start and inspect

Create a task containing `problem` and `completionCriteria`, and select model profiles in a settings file. The included OpenAI settings use `OPENAI_API_KEY` or Pi's configured OpenAI credential. Custom providers can use an absolute model-registry path through `ELENX_MODELS_PATH`.

```sh
bun packages/solve/solve.ts run packages/solve/examples/task-even-sum.json campaign.db packages/solve/examples/settings-openai.json
```

`run` prints phase updates on standard error and a JSON execution report on standard output when it returns. Supervise long-running commands with your application's existing process manager. Another process can read the campaign during execution:

```sh
bun packages/solve/solve.ts inspect campaign.db
bun packages/solve/solve.ts inspect --include-requests campaign.db
```

The report contains the task, phase, notes and verdicts, role calls and submissions, and accounting. Use the journal-derived `result` when it is present. `accepted` and `turn-limit` are terminal. `paused`, `call-failure`, and `interrupted` leave unfinished work resumable. An inconclusive verification must be resolved before the workflow reaches another Explorer turn.

## Submit advice

Write the advice to a UTF-8 file and submit it with a stable id:

```sh
bun packages/solve/solve.ts guide --id strategy-1 campaign.db guidance.txt
```

Example file content:

```text
Test the smallest nontrivial cases before extending the construction.
If a construction fails, record the precise obstruction in a note.
```

Standard input is also supported:

```sh
printf '%s\n' 'Try a direct proof from the definitions.' | bun packages/solve/solve.ts guide --id strategy-2 campaign.db -
```

The command returns a receipt like this:

```json
{
  "call": 42,
  "atMs": 1788912000000,
  "schemaVersion": 1,
  "id": "strategy-1",
  "text": "Test the smallest nontrivial cases before extending the construction.\n"
}
```

The receipt acknowledges durable storage. Repeating the same id and exact text returns that receipt, including after the campaign finishes. Different text with the same id is an error. Use a fresh id for new advice. The command requires write access to an existing workflow campaign and makes no provider request.

In TypeScript, the installed solver also exports the same operation:

```ts
import { guideCampaign } from "elenx-solve";

const receipt = await guideCampaign(
  "campaign.db",
  "Try a direct proof from the definitions.",
  "strategy-2",
);
```

## When advice takes effect

The coordinator supplies `explorerGuidance` for the next turn. The runner combines that text with pending external messages in the Explorer's single `explorerGuidance` field. Both are fallible advice. The Explorer can reject a diagnosis, choose another approach, or finish a suggested step and continue toward the original task.

Before a turn starts, the runner freezes the available messages. They appear after the coordinator's text, in journal order. External advice applies to one turn only. The next turn receives a new coordinator recommendation and any newly submitted advice. Settings contain no persistent guidance.

An active request keeps the prompt it was sent. New advice waits for the next Explorer turn, and retries of the current turn keep its original guidance. A crash after the input boundary is recorded also preserves that boundary on resume. Earlier notes, verdicts, and requests remain unchanged.

```sh
bun packages/solve/solve.ts inspect --include-guidance campaign.db
```

The added `guidance` array contains each external receipt, `calls` listing the Explorer calls that included it, and `pending`. Several calls can be retries of the same turn. `pending: false` confirms delivery to at least one started Explorer call, including a call that later failed. Check the resulting notes to see how the model used the advice.

The original task and completion criteria remain the authority for acceptance. Guidance cannot establish a lemma, change a verifier's verdict, or increase the turn cap. `guide` records advice without starting or resuming execution. Advice recorded after completion, or too late for another Explorer turn, remains pending. The terminal result stays unchanged.

## Pause, resume, and compatibility

Send one `SIGINT` or `SIGTERM` to pause after the active role call settles. A second signal interrupts the active call. Resume with the same task, campaign, and settings:

```sh
bun packages/solve/solve.ts run task.json campaign.db settings.json
```

Guidance is already in the campaign. Leave the original settings file unchanged. The command resumes the first missing role call and preserves completed work. Durability supports continuation from recorded state. Rewinding a campaign or reopening a terminal result is outside this command's behavior.

Workflow schema 24 replaces the coordinator's `objective` and the Explorer's separate `objective`/`guidance` fields with `explorerGuidance`. It also removes settings-level guidance and uses advisory role prompts. Preserve older journals with the exact implementation that wrote them. The updated solver deliberately refuses to replay them against changed prompts. Start a fresh campaign to use the new role contract.

The `run` arguments, execution-contract schema 8, top-level inspection fields, and stopping rules stay unchanged. Consumers that read coordinator submissions should use `explorerGuidance`. `--include-guidance` is an explicit inspection option. Runs with no external advice add no guidance delivery records.

All guidance and delivery boundaries live in `campaign.db`. The `.runner.lock` and `.guidance.lock` files only coordinate processes and hold no campaign state. Copy a campaign after its handles close, or use SQLite's backup facilities for a live snapshot. See the kernel [durability contract](../../../SPEC.md) for recovery and copy rules.

## Export and review

```sh
bun packages/solve/solve.ts export campaign.db
```

Export contains the accepted note and every supporting proof it relies on. Give this text and the frozen task to an external reviewer, following the [review procedure](../README.md#external-final-review). An internal `accepted` result reports that Elenx's declared checks passed.
