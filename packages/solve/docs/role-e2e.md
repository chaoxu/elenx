# Role-runner end-to-end test

Run the role runner's production-path test from the repository root:

```sh
bun run e2e:roles
```

The command is hermetic. A Bun preload intercepts requests to the reserved `e2e.invalid` provider, so the test needs no network access, credentials, or listening sockets. Each case uses a temporary model registry, Pi state directory, and journal.

The suite covers a fresh `run`, a zero-call repeated `run`, inspection, export, rejection repair, auditor aggregation, campaign locking, and provider failure without a mathematical verdict.

Give delegated test agents only `bun run e2e:roles`, with the repository root as their working directory. They need no setup, arguments, environment variables, or credentials.
