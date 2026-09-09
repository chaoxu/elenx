# Role-runner end-to-end test

Run the role runner's production-path test from the repository root:

```sh
bun run e2e:roles
```

The command is hermetic. A Bun preload intercepts requests to the reserved `e2e.invalid` provider, so the test needs no network access, credentials, or listening sockets. Each case uses a temporary model registry, Pi state directory, and journal.

The suite covers a fresh `run`, a zero-call repeated `run`, inspection, export, a failed verification followed by a new note, verdict recording, campaign locking, and provider failure without a verdict.
