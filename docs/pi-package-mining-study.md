# Mining Pi packages for Elenx

This study examines six Pi packages as possible sources of mechanisms for Elenx. It is pinned to the published packages and source revisions below on 2026-08-15; package behavior outside those revisions is not covered.

| package | published revision | license and runtime |
|---|---|---|
| [`pi-subagents@0.50.0`](https://www.npmjs.com/package/pi-subagents/v/0.50.0) | [`c091da1`](https://github.com/nicobailon/pi-subagents/tree/c091da1d9b660c1940ef5dc78cfeeace1aecd435) | MIT; Earendil Pi peers, `pi-ai >=0.80.0` |
| [`pi-landstrip@0.18.30`](https://www.npmjs.com/package/pi-landstrip/v/0.18.30) | [`ff1db83`](https://github.com/landstrip/landstrip/tree/ff1db8318141d6d1c5f3006f33453132b36a82ae) | Apache-2.0 extension; Node 22.19 or newer; bundled Landstrip has separate terms |
| [`pi-extensible-workflows@5.4.0`](https://www.npmjs.com/package/pi-extensible-workflows/v/5.4.0) | [`e0c562a`](https://github.com/vekexasia/pi-extensible-workflows/tree/e0c562a3ce7de0247d5da3cfd3d038b7e3adf01d) | MIT; Node 22.19 or newer |
| [`@minhduydev/pi-subagents@0.13.0`](https://www.npmjs.com/package/@minhduydev/pi-subagents/v/0.13.0) | [`6df6153`](https://github.com/MinhDuyDEV/pi-subagents/tree/6df61535ec2f9d580c2a687014cfb585eb7e44bf) | MIT; Node 22.19 or newer; Pi `>=0.84.0 <0.85.0` |
| [`pi-autocontext-lean-verify@0.1.19`](https://www.npmjs.com/package/pi-autocontext-lean-verify/v/0.1.19) | [`53911a3`](https://github.com/greyhaven-ai/pi-autocontext-lean-verify/tree/53911a3a40a7c8671b2fd844243caf69064e8ab5) | Apache-2.0; Node 20 or newer; embeds Pi `^0.74.0` |
| [`pi-smart-router@0.16.0`](https://www.npmjs.com/package/pi-smart-router/v/0.16.0) | [`ce03be7`](https://github.com/beettlle/pi-smart-router/tree/ce03be7d7fabec8574659b4a5bc2658b88364566) | MIT; Node 22 or newer; Earendil Pi plus native `better-sqlite3` |

## Elenx boundary used in the study

Elenx at [`a27a2d9`](https://gitea.lab/chaoxu/elenx/commit/a27a2d9) is a durable semantic kernel, not an agent framework. It stores exact candidate bytes, records calls and admitted tool effects before execution, preserves interrupted effects as unknown, binds verdicts to fresh successful candidate-scoped calls, and derives verification from the append-only log. The bundled Pi runner records one provider-final telemetry leaf per logical provider operation. Applications own orchestration, verifier construction, context policy, budgets, filesystem policy, and promotion.

Five constraints decide whether a package mechanism fits:

1. The Elenx campaign remains the only authority for candidate identity, calls, verdicts, and verified status.
2. A package completion, review approval, workflow gate, local attestation, or model vote is evidence; none is automatically an Elenx verdict.
3. Resumption may reuse orchestration work, but it must not reuse a verifier result across candidate identities or conceal an uncertain external effect.
4. Models receive only narrow application tools. A package must not smuggle a generic shell, filesystem, MCP universe, database handle, or dynamic tool set through one declared tool.
5. Provider usage remains measured at the Pi operation that produced it. Session totals and package dashboards are projections, not replacement accounting.

“Integrate” below means a dependency of a surrounding Pi application. “Port” means reimplementing a small mechanism under Elenx's contracts. It never means importing another package's ledger or acceptance state into the kernel.

## Decision

None of the six packages should become an Elenx kernel dependency.

| package | decision | what survives the study |
|---|---|---|
| `pi-subagents` | Use only as an optional Pi-host display or advisory scout layer | Versioned launch digests, monotone capability ceilings, exact attempt identities, bounded protocol parsing, process-terminal proof, and fail-closed leases |
| `pi-landstrip` | Candidate application dependency for narrow process-backed tools, subject to a separate hostile sandbox spike | Separation of semantic permission from OS resource enforcement, deny-by-default network policy, fail-closed startup, and explicit sandbox-policy identity |
| `pi-extensible-workflows` | Do not depend on it; mine orchestration patterns | Deterministic named fanout identities, exact workflow snapshots, capability narrowing, budget retention, recovery-state vocabulary, and persist-before-notify discipline |
| `@minhduydev/pi-subagents` | Do not depend on it or port its stores | Reviewer-owned structured verdicts, claim-to-record evidence bindings, separation of receipt integrity from semantic judgment, and blind disclosure patterns |
| `pi-autocontext-lean-verify` | Do not install it; build a smaller formal-oracle adapter | Frozen template plus one proposed hole, generator/oracle separation, bounded process cleanup, negative controls, and a typed oracle receipt |
| `pi-smart-router` | Do not install or reuse its calibration code | `SAMPLE_STARVED` and abstention states, raw-versus-calibrated score separation, label-strength classes, offline artifacts, and group-aware evaluation requirements |

The useful material fits in application-owned request and evidence schemas. No campaign-table or status-policy change is needed first.

### Verifier run specification

Each verifier call request should freeze enough information to reconstruct what was intended:

```text
verifier-run/v1 {
  candidate
  verifier profile and implementation digest
  verifier kind: formal | executable | llm | human
  requested model/provider and method/dependence families
  prompt/protocol digest and context disclosure mode
  exact tool allowlist and capability-ceiling sources
  sandbox/toolchain/environment policy digests
  external orchestration and attempt identities, if any
}
```

The candidate's required-verifier label should identify a versioned profile. The full profile belongs in the recorded request. A package launch digest is useful provenance only after the application has checked that its projection covers these fields.

### Evidence binding

Verdict evidence should bind claims to existing Elenx records rather than copying mutable path receipts:

```text
evidence-binding/v1 {
  claims: [{
    claim
    observations: [{ toolCall }]
    reviewerCall
  }]
  subject: { candidate, verifierCall }
  external artifact digests, when unavoidable
}
```

Application validation should require each referenced tool call to precede the verdict, belong to the verifier call or an explicitly named earlier call, and have a returned result. External artifacts must be rehashed at the final decision boundary. A file hash checked only when a review begins does not protect a later publication step.

### Structured verdict ownership

The coordinator currently passes `verdict` and `evidence` to `recordVerdict`. A small application helper should instead derive both from exactly one schema-admitted terminal submission stored under the verifier call. This prevents the coordinator from turning a verifier's `FAIL` into `PASS`. It can remain an application convention until more than one application needs the same rule.

### Assurance observations

Any learned assurance layer needs raw observations and later truth adjudications, not votes relabeled as confidence:

```text
assurance-observation/v1 {
  candidate and candidate digest
  claim/problem family
  verifier identity, kind, implementation, model, protocol, and toolchain
  call and evidence identities
  PASS | FAIL | INCONCLUSIVE
  dependence groups: model, provider, prompt, source, formalization, toolchain
  selection policy and propensity, when known
}

truth-adjudication/v1 {
  candidate digest
  CORRECT | INCORRECT | UNRESOLVED
  adjudicator identity, authority class, evidence digest, and time
}
```

Only independently resolved `CORRECT` and `INCORRECT` cases may train or test a reliability model. A verifier cannot calibrate itself. A learned estimate should initially choose the next verification action; it must not alter `deriveCandidateStatus`.

## `pi-subagents`: mine launch controls, not delegated truth

The public execution path resolves a child or scripted workflow through [`public-execution.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/extension/public-execution.ts#L25-L90). Its best reusable mechanisms sit before and around execution:

- [`preflight.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/api/preflight.ts#L208-L235) resolves a launch without spawning, and [`launch-contract.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/shared/launch-contract.ts#L76-L123) hashes a versioned projection.
- [`capability-ceiling.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/runs/shared/capability-ceiling.ts#L106-L169) monotonically intersects tool, agent, and extension ceilings. Omitted and explicitly empty capabilities remain distinct.
- [`prompt-template-bridge.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/slash/prompt-template-bridge.ts#L69-L140) gives attempts exact identities and fails closed when identity space is exhausted.
- Structured output requires an observed terminal tool start and revalidation of the captured value in [`execution.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/runs/foreground/execution.ts#L1363-L1385).
- [`session-lease.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/runs/shared/session-lease.ts#L168-L208) reclaims a lease only when the owner is demonstrably stale, and [`process-terminal.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/runs/background/process-terminal.ts#L227-L293) distinguishes observed process termination from an inferred logical status.
- Named workflow keys fingerprint launch parameters, reject conflicting reuse, admit a parallel batch before starting any child, and reject unawaited launches in [`scripted-workflow.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/workflows/scripted-workflow.ts#L855-L911).

These are application patterns, not reasons to delegate required verifier calls through the package. A wrapped child result would omit Elenx's provider-operation checkpoints, standard `pi.ai.request` leaves, exact selected-tool audit, and requested-versus-served model accounting. The package instead totals usage from child `message_end` records.

Its policy surfaces are also weaker than their names suggest. Native permissions default unknown tools to allow and always permit Bash and internal tools in [`permissions.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/runs/shared/permissions.ts#L17-L49). Acceptance commands use a real shell and inherit the ambient environment in [`acceptance.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/runs/shared/acceptance.ts#L1143-L1158). Observability JSONL stops at 50 MiB and suppresses write failures in [`jsonl-writer.ts`](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/src/shared/jsonl-writer.ts#L38-L78); its replay files are explicitly temporary rather than a permanent ledger.

The one low-risk direct integration is the display-only [`external-runs` API](https://github.com/nicobailon/pi-subagents/blob/c091da1d9b660c1940ef5dc78cfeeace1aecd435/docs/extension-api.md#L59-L93). An Elenx application can project its own jobs into FleetView while retaining execution, persistence, cancellation, and results. Scouts and optional reviewers may also run through the package if their output stays advisory.

Release checks passed typechecking, all 805 integration tests, and 2,003 unit tests except one timing-sensitive malformed-LSP test that passed alone. The published revision is already followed by several runtime fixes on `main`, reinforcing the decision not to make `0.50.0` authoritative infrastructure.

## `pi-extensible-workflows`: mine deterministic topology, reject its effect replay

The workflow engine has careful structural identity. Acorn adds call-site offsets in [`validation.ts`](https://github.com/vekexasia/pi-extensible-workflows/blob/e0c562a3ce7de0247d5da3cfd3d038b7e3adf01d/packages/core/src/validation.ts#L448-L466); execution combines scope, offsets, and occurrence counts in [`execution.ts`](https://github.com/vekexasia/pi-extensible-workflows/blob/e0c562a3ce7de0247d5da3cfd3d038b7e3adf01d/packages/core/src/execution.ts#L246-L350). Named `parallel` and `pipeline` branches remain stable, while ambiguous concurrent calls fail closed. Elenx applications should copy that discipline for verifier fanout identities.

Its persistence rule cannot cross into Elenx. The journal stores completed `{ path, value }` operations but no durable started or unknown-effect state in [`decoders.ts`](https://github.com/vekexasia/pi-extensible-workflows/blob/e0c562a3ce7de0247d5da3cfd3d038b7e3adf01d/packages/core/src/decoders.ts#L11-L15). Shell, agent, and registered-function operations perform the effect and only then record the value. A crash in that gap repeats the effect. The package's own [`trust-boundaries.test.ts`](https://github.com/vekexasia/pi-extensible-workflows/blob/e0c562a3ce7de0247d5da3cfd3d038b7e3adf01d/packages/core/test/trust-boundaries.test.ts#L81-L111) demonstrates a shell mutation followed by rejected oversized output; recovery can repeat the mutation because no completion was stored.

Completed registered-function values also replay across retry lineage. The launch snapshot records script, arguments, settings, budgets, models, tools, roles, and schemas, but not the registered function's implementation digest. A cached `PASS`-shaped result can therefore survive a verifier implementation change, and it has no native candidate-byte or verifier-policy binding.

The useful pieces are:

- named fanout trees with deterministic branch identities;
- exact workflow and effective model/tool/role/prompt snapshots, extended in Elenx with implementation hashes;
- explicit `failed`, `interrupted`, `budget_exhausted`, and `awaiting_input` states;
- retained budgets across retries and approval before budget relaxation;
- capability ceilings that may narrow but never widen child authority;
- fresh verifier sessions, cancellation trees, fair scheduling, and post-persistence best-effort events.

Do not copy the mutable JSON journal, automatic retry of incomplete effects, raw shell surface, cached status reads, or its numeric usage fallback. [`agent-execution.ts`](https://github.com/vekexasia/pi-extensible-workflows/blob/e0c562a3ce7de0247d5da3cfd3d038b7e3adf01d/packages/core/src/agent-execution.ts#L877-L895) may use last-known usage, initially zero, when measurements are incomplete.

If a future application adopts this workflow engine, it should receive an already submitted candidate and call narrow Elenx adapters keyed by `(orchestration, candidate, verifier, attempt)`. An adapter encountering an Elenx call without a result returns `unknown`; it never silently repeats the call. The workflow returns attempt references and `orchestration: completed`. The outer Bun process then rereads the campaign and derives status. Proposal submission itself must remain outside the workflow unless it gains semantic idempotency and explicit unknown-effect reconciliation.

Direct adoption is unattractive today: the engine requires Node 22.19, uses Node process primitives, and exposes a host shell with inherited environment. The study checkout passed installation, core tests, and lint; `npm audit` reported one high-severity production dependency advisory in the pinned release.

## Landstrip: integrate the native sidecar beneath one semantic tool

Landstrip is the only package in this study that may justify an application dependency. The useful package is the native `@landstrip/landstrip` sidecar, whose [`lib/index.d.ts`](https://github.com/landstrip/landstrip/blob/ff1db8318141d6d1c5f3006f33453132b36a82ae/lib/index.d.ts) API exposes only `binaryPath()` and `packageName()`. The higher-level `pi-landstrip` extension adds interactive permissions, configuration merging, agent definitions, ambient Pi resources, environment inheritance, and command retry behavior that do not fit Elenx.

The native sandbox supplies containment, not replay safety, immutable inputs, resource quotas, evidence semantics, or verifier correctness. Several details require an Elenx-specific wrapper:

- Executable policy stored in a Unix xattr or Windows alternate data stream merges last in [`config.rs`](https://github.com/landstrip/landstrip/blob/ff1db8318141d6d1c5f3006f33453132b36a82ae/src/engine/config.rs) and can broaden the requested policy. A model-writable verifier executable is therefore a policy-injection path.
- Reads are unrestricted when `denyRead` is empty. A real allowlist starts with `denyRead: ["/"]` and explicit canonical `allowRead` roots.
- The [Linux backend](https://github.com/landstrip/landstrip/tree/ff1db8318141d6d1c5f3006f33453132b36a82ae/src/engine/platform/linux) combines Landlock with a seccomp notification broker. Partial Landlock ABI coverage produces a warning rather than a fatal error, so applications needing complete coverage must enforce a minimum kernel/ABI separately.
- The [macOS backend](https://github.com/landstrip/landstrip/blob/ff1db8318141d6d1c5f3006f33453132b36a82ae/src/engine/platform/macos.rs) applies a static Seatbelt profile. The Pi extension may rerun a whole command after some denials, which is unsafe after partial effects.
- The [Windows backend](https://github.com/landstrip/landstrip/tree/ff1db8318141d6d1c5f3006f33453132b36a82ae/src/engine/platform/windows) uses standard AppContainer by default, which can see resources granted to `ALL APPLICATION PACKAGES`; LPAC is stronger. Restricted-user mode modifies host accounts, ACLs, WFP rules, leases, and recovery journals.
- The Pi extension passes the host environment to primary commands and workers through [`index.ts`](https://github.com/landstrip/landstrip/blob/ff1db8318141d6d1c5f3006f33453132b36a82ae/packages/pi-landstrip/index.ts) and [`subagents.ts`](https://github.com/landstrip/landstrip/blob/ff1db8318141d6d1c5f3006f33453132b36a82ae/packages/pi-landstrip/subagents.ts). Filesystem isolation does not protect credentials already present in the child's environment or output.
- The sandbox does not impose CPU, memory, PID, or output limits. The caller must enforce deadlines, output caps, and process-tree cleanup.

The source audit also reproduced a fail-closed macOS availability defect in the published binary: a nested deny/re-allow policy could enumerate a huge portion of `/` and stack-overflow while installing the Seatbelt profile. A strict `denyRead: ["/"]` policy with a few canonical allow roots worked. Broad root access followed by carve-outs should not be used.

The smallest safe wrapper directly spawns the path returned by `binaryPath()`:

```text
landstrip run -p FIXED_POLICY -- PINNED_VERIFIER FIXED_ARGS...
```

The model must not control the command, arguments, working directory, policy, paths, environment, or domains. The application binds exact candidate bytes, creates scratch keyed by the Elenx tool-call sequence, mounts only immutable inputs and disposable output, disables network and sockets, constructs a minimal environment, and keeps the verifier executable outside every write root. Before execution it should run policy validation/resolution, reject unexpected effective permissions or executable metadata, and record digests of the sidecar, verifier, policy, toolchain, and input.

Sandbox denial, setup failure, timeout, signal, malformed output, or ambiguous termination maps to an error or `INCONCLUSIVE`, never `FAIL` and never an automatic retry. `replay: "safe"` is justified only when all effects are confined to disposable call-keyed scratch; Landstrip itself cannot make an arbitrary tool replay-safe.

Use an exact version pin and spawn the unmodified sidecar rather than copying its native code. The native package is `Apache-2.0 AND LGPL-2.1-or-later`, so distribution must preserve notices and meet the applicable LGPL source/relinking obligations. The published Pi wrapper passed 175 Bun tests, and the sidecar imported and completed a macOS `doctor` smoke under Bun 1.3.14; Bun remains empirical rather than declared support.

## `@minhduydev/pi-subagents`: mine record bindings, reject its stores

This package recognizes an important distinction: execution, receipt integrity, semantic verification, and independent review are separate states. [`run-store.ts`](https://github.com/MinhDuyDEV/pi-subagents/blob/6df61535ec2f9d580c2a687014cfb585eb7e44bf/src/orchestration/run-store.ts#L18-L55) models them separately. Elenx already has the stronger durable substrate, so the useful work is in derived projections and bindings rather than another state machine.

Four mechanisms transfer:

1. [`parseReviewerOwnedVerdict`](https://github.com/MinhDuyDEV/pi-subagents/blob/6df61535ec2f9d580c2a687014cfb585eb7e44bf/src/orchestration/review.ts#L35-L70) derives a verdict from canonical reviewer output instead of trusting a coordinator-supplied value. Elenx should implement this first as the structured-verdict application helper described above.
2. [`SemanticAttestationV1`](https://github.com/MinhDuyDEV/pi-subagents/blob/6df61535ec2f9d580c2a687014cfb585eb7e44bf/src/orchestration/run-store.ts#L94-L104) binds claims, evidence, reviewer identity, reviewer output, and subject. Elenx should replace path receipts with campaign record sequences.
3. A derived verifier view should distinguish `not-run`, `interrupted`, `call-failed`, `inconclusive`, `passed`, and `failed`; process success and semantic verification must remain visibly different.
4. [`renderContextPackForPrompt`](https://github.com/MinhDuyDEV/pi-subagents/blob/6df61535ec2f9d580c2a687014cfb585eb7e44bf/src/orchestration/context.ts#L182-L272) supports blind-first disclosure and keeps acceptance claims away from producers. Elenx applications should realize blind phases as separate recorded calls rather than mutable Context Packs.

Its evidence implementation cannot be reused. The audit reproduced a post-review mutation gap: [`taskSubjectDigest`](https://github.com/MinhDuyDEV/pi-subagents/blob/6df61535ec2f9d580c2a687014cfb585eb7e44bf/src/orchestration/review.ts#L130-L170) omits current evidence artifact bytes. Review hashes a receipt once, but [`ship`](https://github.com/MinhDuyDEV/pi-subagents/blob/6df61535ec2f9d580c2a687014cfb585eb7e44bf/src/orchestration/tool.ts#L884-L950) never rehashes it. After a valid receipt was verified and approved, mutating the artifact still allowed `shipped: true`.

Other reasons to reject the stores and receipt code include:

- transcript scraping can synthesize a zero exit code when fields are absent, and a same-user child can edit the source JSONL;
- evidence-only proof is vacuously semantically valid when no claims exist;
- an invalid journal event can poison later reads, while rotation discards idempotency keys;
- corruption of mutable run state can lose review and ship status even though `events.jsonl` is described as correctness state;
- a distinct reviewer task may use the same model, prompt, evidence source, and blind spot, so provenance separation is not statistical independence.

The pinned release passed typechecking, 86 base tests, 284 orchestration tests, build, and its package-install test. Pi `0.84.2` satisfies its declared peer range, but the package promises Node rather than Bun. Those compatibility facts do not outweigh the duplicated authority and demonstrated evidence-finalization gap.

## Lean verification: mine the oracle envelope, replace the package

The package's central idea is sound. [`verify_lean_proof.py`](https://github.com/greyhaven-ai/pi-autocontext-lean-verify/blob/53911a3a40a7c8671b2fd844243caf69064e8ab5/harness/verify_lean_proof.py#L73-L149) inserts one proposed proof body into a fixed template containing a single `{{PROOF}}` hole, then invokes Lean. [`prove_with_autocontext.py`](https://github.com/greyhaven-ai/pi-autocontext-lean-verify/blob/53911a3a40a7c8671b2fd844243caf69064e8ab5/harness/prove_with_autocontext.py#L104-L192) keeps stochastic generation separate from the deterministic final check. Heuristic extraction can choose a bad candidate, but it cannot create a false PASS if the final oracle and its inputs are trustworthy.

The package also has useful process and evaluation patterns:

- attempt artifacts preserve the proposed body, assembled source, output, result, elapsed time, and timeout state;
- [`process_utils.py`](https://github.com/greyhaven-ai/pi-autocontext-lean-verify/blob/53911a3a40a7c8671b2fd844243caf69064e8ab5/harness/process_utils.py#L161-L222) starts a process group, escalates TERM to KILL, bounds pipe cleanup, and retains partial output;
- challenge fixtures omit gold proofs, and seeded, unseeded, and direct generators face the same templates and oracle;
- negative controls test that rejected generated hints do not bypass the oracle.

The published package is not a trustworthy oracle adapter. Generator code, verifier scripts, templates, results, and Lean run under one unsandboxed user. Receipts omit hashes of the candidate, template, assembled source, policy, compiler, and import graph. TypeScript preflight and Python execution use different environment-variable search orders for Lean. Success is process exit zero plus an English warning search rather than a typed kernel and allowed-axiom report. Model-controlled `harnessRoot`, `seedPlaybook`, and `runRoot` select executable code and output locations.

Its error classification is also unsuitable: Lean rejection, forbidden-token policy, missing compiler, unknown fixture, and timeout all become `ok: false`. Only a normal checker rejection or soundly detected policy violation is candidate evidence. Infrastructure failures are `INCONCLUSIVE`.

Durability lives mostly in mutable temporary JSON. The package embeds Pi `^0.74.0`, adding a stale duplicate runtime beside Elenx's `0.84.2`; the pinned dependency audit reported seven high-severity packages. Its `uvx` command pins the top-level `autocontext` version but permits the Python dependency closure to drift, while CI installs a live “stable” Lean rather than an immutable toolchain.

Elenx should build a smaller application adapter around a closed bundle:

```text
formal-bundle/v1 {
  language and oracle profile
  exact theorem-template bytes with one typed hole
  exact proposed hole bytes
  allowed imports and axioms
  oracle-policy digest
  immutable toolchain/image and import-graph digests
}

oracle-receipt/v1 {
  bundle, template, assembled-source, policy, and import-graph digests
  checker image, compiler, and kernel identities
  ACCEPT | REJECT | INDETERMINATE
  exit code or signal, timeout, duration, and parsed diagnostics
  exact or durably stored stdout/stderr
  allowed-axiom report
}
```

The checker runs in the strict Landstrip wrapper or an equivalent network-disabled, read-only, resource-limited image. It accepts no model-chosen path, command, flag, timeout, environment override, import, or toolchain. The final formal check should be a fresh `campaign.call` rather than an LLM tool call. `ACCEPT` with matching digests and policy maps to `PASS`; a normal parser, elaborator, kernel, or policy rejection maps to `FAIL`; timeout, abort, crash, spawn failure, malformed receipt, missing compiler, digest mismatch, or sandbox failure maps to `INCONCLUSIVE`.

Lean certifies only the formal statement. Correspondence between that statement and the listed natural-language theorem remains a separate required verifier. Each repair produces a new candidate; the application never mutates and rechecks an existing candidate row.

The source checkout passed all 31 unit tests. Lean was unavailable in the study environment, so the release's expected-proof compilation job was not repeated.

## `pi-smart-router`: mine abstention discipline, reject the calibration code

The package documents several concepts that an assurance layer needs: explicit sample starvation, separate raw and calibrated scores, weak labels excluded from evaluation, offline fitting, and bounded online lookup. The published implementation violates enough of those contracts that neither its code nor its numerical thresholds should be reused.

The base scorer is an unregularized ten-feature logistic model that activates at 30 samples and otherwise returns `0.5` in [`p-success-classifier.ts`](https://github.com/beettlle/pi-smart-router/blob/ce03be7d7fabec8574659b4a5bc2658b88364566/src/domain/routing/p-success-classifier.ts#L20-L153). Its checked-in weights are explicitly [`synthetic_fixture`](https://github.com/beettlle/pi-smart-router/blob/ce03be7d7fabec8574659b4a5bc2658b88364566/config/p-success-weights.json#L29-L35); no trained calibration bundle ships.

Three source-level failures are decisive:

1. Missing labels become successes. `deriveSuccessLabel` can return `null`, but both training paths convert it to true in [`p-success-classifier.ts`](https://github.com/beettlle/pi-smart-router/blob/ce03be7d7fabec8574659b4a5bc2658b88364566/src/domain/routing/p-success-classifier.ts#L403-L515) and [lines 597–619](https://github.com/beettlle/pi-smart-router/blob/ce03be7d7fabec8574659b4a5bc2658b88364566/src/domain/routing/p-success-classifier.ts#L597-L619). Thirty rows containing only unique request IDs activated training and produced a success prediction of approximately `0.9983`. Elenx must preserve unknown labels.
2. The reported holdout ECE is not end-to-end holdout performance. Logistic weights are trained on all eligible samples before the isotonic layer performs its 80/20 split. The held-out rows have already influenced the base scorer. At the minimum floor, roughly six examples feed a ten-bin ECE report.
3. Runtime artifact admission is weaker than offline validation. It accepts duplicate or reordered feature names, an artifact-controlled minimum sample count of zero, and nonmonotone isotonic knots because the online parser never invokes the semantic validator in [`isotonic-calibrator.ts`](https://github.com/beettlle/pi-smart-router/blob/ce03be7d7fabec8574659b4a5bc2658b88364566/src/domain/routing/isotonic-calibrator.ts#L49-L160). A reproduced invalid mapping changed raw `0.5` to calibrated `0.1`.

The semantics would not transfer even without those defects. Router “success” means routing satisfaction or lack of operational failure, not mathematical correctness. Frontier success is hard-coded to one in [`expected-cost.ts`](https://github.com/beettlle/pi-smart-router/blob/ce03be7d7fabec8574659b4a5bc2658b88364566/src/domain/routing/expected-cost.ts#L31-L35). The split is neither grouped nor stratified, ECE is not a bound on false acceptance in the acceptance region, and the artifacts lack a typed training-data digest, label-policy version, code revision, split declaration, and target population. Missing calibration falls back to the raw score; assurance must fail closed to `UNCALIBRATED` or `INCONCLUSIVE`.

An Elenx assurance experiment needs three group-aware partitions:

```text
training set       -> fit the base reliability model
calibration set    -> fit the calibration mapping
untouched test set -> evaluate the final calibrated system
```

Groups must cover candidate/problem families and shared model, provider, prompt, source, formalization, and toolchain dependencies. A later chronological test window is preferable. Promotion needs resolved examples from both truth classes, effective sample counts after dependence clustering, Brier score and log loss alongside ECE, false-acceptance bounds in the proposed decision region, subgroup and drift results, and an abstention/coverage curve. There is no universal sample floor of 30. With zero observed errors in `n` effectively independent cases, the rough 95% upper error bound is `3/n`; demonstrating error below one percent already needs about 300 such cases.

A calibration artifact must freeze the target population, code revision, ordered feature-schema digest, label policy, input-event digest, inclusion rules, group keys, time windows, model parameters, effective counts, metrics, decision-region bounds, drift baseline, and lifecycle state. Invalid or absent artifacts abstain. Correlated verifier probabilities are never multiplied as if independent.

Seven focused test files and 76 tests passed. They did not cover missing-label exclusion, end-to-end split isolation, exact feature order, artifact-owned zero floors, or runtime isotonic monotonicity. The npm tarball also excludes the advertised training scripts and tests, so the installed package cannot execute its documented retraining commands.

## Extraction plan

### 1. Add application contracts before dependencies

Create application-owned Zod schemas and helpers for `verifier-run/v1`, `evidence-binding/v1`, structured terminal verdict ownership, and the derived per-verifier lifecycle view. Store them in existing call requests and verdict evidence. This yields most of the useful assurance structure without touching the Elenx schema or status rule.

The first hostile tests should prove:

- a coordinator cannot record a verdict different from the stored terminal submission;
- evidence references reject missing, unsettled, later, unrelated, or duplicate tool calls;
- a changed external artifact fails final revalidation;
- `INCONCLUSIVE` and infrastructure failure never become PASS through absence or defaulting;
- resubmitting identical bytes creates a distinct cache and attempt namespace.

### 2. Build one frozen formal-oracle adapter

Implement a small checker adapter around a single pinned formal environment before importing a general workflow engine. Use the native Landstrip sidecar only beneath this semantic adapter. The spike must include policy-resolution checks, an empty environment allowlist with only explicit additions, no network, immutable candidate input, disposable tool-call-keyed scratch, output and process limits, executable metadata checks, and digest-complete receipts.

The hostile matrix should include theorem/template mutation, zero or multiple holes, `sorry`/new axioms/import changes, stale receipts, digest mismatch, missing checker, timeout, crash, disk full, escaped descendants, filesystem and network probes, secret-environment probes, and repeated replay of an identical bundle. Every infrastructure case must end as `INCONCLUSIVE` or an unsettled call.

### 3. Keep orchestration thin until it becomes a measured problem

Use ordinary application code for proposal, candidate submission, named verifier fanout, reconciliation, and status derivation. Copy deterministic branch naming and exact launch snapshots from the workflow packages. Do not add a second journal merely to obtain a DAG.

If Pi-host visibility becomes useful, project Elenx work through `pi-subagents`' display-only `external-runs` API. If advisory scouts are useful, permit them as non-required calls. Required verifier calls should continue through `runPi` or direct `campaign.call` adapters so Elenx retains exact tools, transcripts, model identities, request checkpoints, and provider-operation usage.

Adopt a workflow package only after the application needs durable branching that is costly to maintain locally. Before doing so, require an unknown-effect protocol, implementation digests in cache identities, candidate-bound verifier cache keys, a shell-disabled mode, and authoritative reconciliation outside the workflow journal.

### 4. Collect assurance data in shadow mode

Export `assurance-observation/v1` rows from completed campaign facts and add truth adjudications only when an independent authority later resolves the candidate. Record dependence groups from the start; they cannot be reconstructed reliably after the fact.

The first model should remain shadow-only. It may recommend another checker, an independent formalization review, or human escalation. It may not satisfy a required verifier, erase a FAIL, publish a candidate, or report a probability without a valid calibration artifact and explicit support state.

## What not to mine

Across all six packages, the following mechanisms conflict with Elenx:

- mutable JSON/JSONL state as verification authority;
- result caches without candidate, verifier implementation, and policy identity;
- “completed,” shell exit zero, schema validity, review approval, or majority vote as correctness;
- automatic retry after an effect may already have happened;
- ambient shell, filesystem, extension, skill, MCP, credential, or environment access;
- dynamic tool sets that can widen after a call is recorded;
- session-level token totals as a substitute for settled provider-operation usage;
- missing labels, usage, results, or calibration artifacts defaulted to zero or success;
- counts of nominally distinct reviewers as independent evidence;
- calibration trained or evaluated on unresolved, circular, leaked, or correlated labels.

## Audit method and limits

The study used the npm-published `gitHead` for each package, not an unpinned default branch. Package manifests, public APIs, implementation paths, tests, locks, and release metadata were inspected in temporary checkouts. Focused test suites and adversarial reproductions were run without modifying or installing dependencies into Elenx.

The Landstrip runtime was executed on macOS; Linux and Windows conclusions come from pinned source and tests rather than live platform execution. Lean was not installed in the study environment, so the Lean package's Python unit suite ran but its real compiler fixture was not repeated. No provider-backed model evaluation or real Pi-session end-to-end suite was run. Dependency-audit counts describe the pinned study date and can change when advisory databases or upstream releases change.

The reproduced defects are reasons not to reuse the pinned implementations. They are not claims about later releases. Any future adoption requires repeating the audit at the exact proposed version and preserving that version, source revision, policy, and test evidence in the application record.

## Final allocation

The six packages contribute one coherent outer architecture:

```text
thin application coordinator
  -> versioned launch specification and capability ceiling
  -> exact Elenx candidate
  -> fresh Elenx verifier calls
       -> optional fixed Landstrip-contained oracle
       -> structured, reviewer-owned verdict submission
       -> claim bindings to stored tool observations
  -> deterministic Elenx status
  -> optional shadow assurance estimate and next-check scheduler
  -> optional Pi-host display projection
```

Elenx remains small. The package study supports richer application contracts, one carefully contained formal-oracle path, and later calibration data collection. It does not support importing a general agent runtime, workflow ledger, evidence store, or confidence engine into the kernel.
