# Development workflow

## Simplicity invariant

Use the vocabulary in [`../../docs/terms.md`](../../docs/terms.md) for every schema field, prompt, document, and identifier. Do not introduce a new term or a synonym; when a change needs a new concept, add its entry there in the same change.

`elenx-solve` has one durable workflow. A task is one JSON object with `problem` and `completionCriteria`. `run TASK.json CAMPAIGN.db SETTINGS.json` starts or resumes that workflow, and `inspect CAMPAIGN.db` derives its phase and terminal result from the journal.

Keep execution-contract schema version 8 while the contract and report shapes remain unchanged, and bump the workflow declaration schema version whenever a role prompt or the journal shape changes. Standalone role commands exercise the same typed boundaries and are not a second workflow. Elenx Lab must derive a worker result from `inspect.result`, not trust solver stdout as a second authority.

Remove retired branches instead of preserving them behind compatibility schemas, aliases, adapters, or mode flags. Do not restore split problem and criteria arguments, separate `trial` or solver `resume` commands, legacy workflow protocols, or alternate result projections. Preserve old campaign databases as historical artifacts and open them only with their matching revision.

Spend reasoning generously and never reason again over what was already reasoned, so no result is verified or derived twice; efficiency work waits for measured spend from real runs.

Use one bounded completion loop for implementation work:

1. Collect known blockers and define the observable success condition before editing.
2. Make one focused edit batch.
3. Run `bun run check`.
4. Run one fresh live smoke only when runtime, prompt, provider, or replay semantics changed.
5. Stage the intended files and freeze the diff.
6. Run one correctness review and one simplification review concurrently against that diff. Give each reviewer the exact frozen patch and completed check summary. Reviewers inspect that evidence only. They do not search memory or rerun tests. Default to Luna at high reasoning.
7. Wait at most five minutes. Correctness, security, regression, and direct user-requirement findings block. Advisory cleanup does not.
8. Repair blocking findings, verify the affected checks, and review only the repair delta when its interaction is local. Repeat the full review only when the repair changes the contract.
9. Commit immediately after the blocking gates pass.

Do not add another review layer, repeat a smoke, or keep manually inspecting the same campaign unless new evidence identifies a distinct risk. Keep live run artifacts under `runs/` untracked. Do not push unless the user asks.
