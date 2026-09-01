# Development workflow

Use one bounded completion loop for implementation work:

1. Collect known blockers and define the observable success condition before editing.
2. Make one focused edit batch.
3. Run `bun run check`.
4. Run one fresh live smoke only when runtime, prompt, provider, or replay semantics changed.
5. Stage the intended files and freeze the diff.
6. Run one correctness review and one simplification review concurrently against that diff. Give each reviewer the exact frozen patch and completed check summary. Reviewers inspect that evidence only; they do not search memory or rerun tests. Default to Luna at high reasoning.
7. Wait at most five minutes. Correctness, security, regression, and direct user-requirement findings block; advisory cleanup does not.
8. Repair blocking findings, verify the affected checks, and review only the repair delta when its interaction is local. Repeat the full review only when the repair changes the contract.
9. Commit immediately after the blocking gates pass.

Do not add another review layer, repeat a smoke, or keep manually inspecting the same campaign unless new evidence identifies a distinct risk. Keep live run artifacts under `runs/` untracked. Do not push unless the user asks.
