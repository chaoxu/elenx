# Role-runner end-to-end test

Run the role runner's production-boundary test from `packages/solve`:

```sh
bun run e2e:roles
```

The command is hermetic. A Bun preload intercepts requests to the reserved `e2e.invalid` provider, so the test needs no network access, credentials, or listening sockets. Each case uses a temporary model registry, Pi state directory, and journal.

The suite covers:

- standalone explorer, coordinator, and verifier calls through the unified CLI, model runtime, Pi adapter, journal, and inspection
- a rejected proposal followed by explorer repair and verifier acceptance
- a provider failure that exits nonzero and never becomes a mathematical result
- wrong-database and existing-trial failures before settings or credential setup

Give delegated test agents only `bun run e2e:roles`, with `packages/solve` as their working directory. They need no setup, arguments, environment variables, or credentials.
