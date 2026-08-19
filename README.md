# Elenx

Elenx is a small durable kernel for verified agent work. It stores exact candidate bytes on append-only log rows, records every model call and admitted tool effect, binds verdicts to fresh calls carrying the candidate row sequence, and derives verified status from the complete log.

The package includes a thin Pi runner. Pi owns model execution, credentials, and provider behavior; Elenx records each logical call, pre-send payload checkpoints for provider operations that reach dispatch preparation, and settled Pi telemetry when the call completes, under the contract in [`SPEC.md`](SPEC.md). The application supplies the Pi registry and tools. Elenx never supplies a database handle, SQL, campaign path, generic append operation, or unrestricted candidate reader to a model.

Elenx deliberately excludes orchestration. Routes, context gathering, blind reconstruction, source search, retries, budgets, campaign UI, and human-readable files belong to applications. A Coverify replacement can build those independently around this kernel.

## Model-first design

Elenx applications should start with the smallest loop that lets the model reason about the whole task. Deterministic code protects identity, durability, capability boundaries, and accounting. It should not prescribe mathematical strategy or replace the model's judgment with route priorities and failure conditions chosen before the run.

1. **Trust the model to reason.** Capable models can synthesize the whole problem and revise their approach in ways a fixed workflow cannot anticipate. Give each call enough context and latitude to pursue its reasoning to a substantive conclusion. Trusting the model to reason does not make its answer true; candidate-bound verification remains a separate responsibility.
2. **Keep decisions dynamic.** A route that initially looks weak may become decisive after a new lemma or counterexample. When an application records findings, failed routes, or possible next steps, let the model reassess them during each call. A stored priority records an earlier judgment; it is not a command.
3. **Push thinking into the model.** Do not split mathematical reasoning into mechanical stages unless the split has demonstrated value. Any strategic state shown across calls should be a small projection rather than a second hard-coded reasoner. Whether the model needs that projection at all is an experimental question.

Start from the minimal loop and treat every added state, capability, or evidence channel as a testable hypothesis. Add interventions as separable modules with frozen inputs, measure externally adjudicated resolutions and cost against the simpler loop, and remove modules that do not help. [`docs/model-first-harness-hypotheses.md`](docs/model-first-harness-hypotheses.md) defines the initial hypothesis space and experimental design.

### Non-redundant memory

Do not show the model facts it already has in the current context. Repeating the problem statement, standard definitions, its own unchanged proof text, or a conclusion it can recover directly spends context without adding guidance. Preserve only information that can change the next decision and is not reliably available to the next call: a prior obstruction, an external observation, an unresolved obligation, or a lost handoff detail. Whether a fact is genuinely remembered is itself testable; fresh-session handoffs and context compression should not assume that model familiarity is perfect.

### Serial-first resource policy

When provider work is priced per call or token, parallelism is a latency optimization, not a cost-saving mechanism. It spends on several attempts at once and may add synthesis work; its default benefit is a shorter wall-clock interval. Applications should therefore run the main reasoning loop serially and use sub-agents for a distinct perspective or bounded task, not to fan out identical searches. Enable concurrency only as an explicit quality or latency intervention, and report its extra work separately from any improvement in true-resolution rate.

### Coordinator and sub-agents

The default topology has one coordinator and at most one active sub-agent. The coordinator owns the campaign state, decides when a consultation is worth its cost, supplies a bounded task and context, and incorporates the returned observation. A sub-agent does not write authoritative state or become a competing scheduler. It is a temporary capability for a distinct view, critique, source check, or bounded computation. A sub-agent may receive its own sub-agent only as a later, explicitly tested extension when the task demonstrates that one level of delegation is insufficient.

The companion [`elenx-solve`](https://gitea.lab/chaoxu/elenx-solve) `model-first-v1` workflow implements this baseline: a bounded serial coordinator, an optional single serial sub-agent, and independently switchable `done`, `stop`, `open`, and `next` projections. It stores submitted work as an unverified Elenx candidate and leaves mathematical assurance as a separate treatment rather than hard-coding Workflow 15's reconstruction pipeline into discovery.

The v1 kernel contract requires Bun 1.3.13 or newer. Applications define tool schemas with Zod, so install both packages:

```sh
bun add git+https://gitea.lab/chaoxu/elenx.git#v0.7.11 zod@4.4.3
```

Elenx exposes Pi's types directly. Keep TypeScript's `skipLibCheck` enabled while Pi's provider SDK declarations require it.

Elenx is an experimental harness. Its API and campaign schema may change directly; there are no migrations or compatibility aliases. Campaign files are accepted only when their schema matches the running package. Preserve an old campaign with its matching tagged package, and write any rerun to a new artifact.

Contributors run `bun install --frozen-lockfile` and `bun run check`. The check includes formatting, strict TypeScript, a consumer compile against the checkout, the complete test suite, and an independent typecheck and runtime smoke installed from the produced tarball.

- [`SPEC.md`](SPEC.md) is the normative v1 contract.
- [`docs/application-author.md`](docs/application-author.md) shows the public API and tool boundary.
- [The Pi package mining study](https://gitea.lab/chaoxu/elenx/src/branch/main/docs/pi-package-mining-study.md) records which Pi ecosystem mechanisms fit outside that boundary.
- [`examples/v1/scripted-verifier.ts`](examples/v1/scripted-verifier.ts) is a deterministic adapter and persistence slice.
- [`examples/v1/pi-smoke.ts`](examples/v1/pi-smoke.ts) independently exercises the LLM-verdict path with a real Pi model.
