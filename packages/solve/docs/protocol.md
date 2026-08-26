# `exploration-v14` protocol

## Contract

`exploration-v14` gives the harness five mechanical responsibilities: freeze exact artifacts, maintain future context, run configured audits, derive completion from recorded results, and export only audited delivery bytes. Models choose mathematical content and search strategy.

The Elenx kernel remains the only journal. The solver adds no mutable workflow database, cache authority, publication table, or hidden state.

## Frozen campaign

Starting a campaign freezes:

- the exact problem and completion criteria
- memory policy and global context ceiling
- resolved explorer and coordinator guidance
- coordinator and explorer profiles
- named admission-auditor profiles
- ordered resolution-auditor profiles and template methods

Each runtime profile freezes provider, model ID, requested reasoning, API, and base URL. Resume recomputes the profile and requires structural equality before model dispatch.

The implementation accepts only `exploration-v14`. V12 databases require release `v0.31.0`, and v13 databases require release `v0.32.0`. A malformed v14 declaration and an unknown protocol produce distinct read-only errors.

## Claims and routes

The working memory contains two disjoint entities.

```ts
interface EvidenceClaim {
  id: `claim-${number}`;
  statement: string;
  dependsOn: ClaimId[];
  originCall: EntryId;
  replaces?: ClaimId;
}

interface RouteRecord {
  id: `route-${number}`;
  attempt: string;
  outcome: string;
  evidenceClaims: ClaimId[];
  retryCondition?: string;
  originCall: EntryId;
  replaces?: RouteId;
}
```

A claim is one exact citable mathematical proposition. Its subject may be a lemma, counterexample, obstruction, impossibility result, invariant, or reduction. A conditional result states its hypotheses inside the proposition.

A route records operational search history. It references claims instead of copying their statements. Route IDs are rejected in claim dependencies and resolution citations. Routes never enter reconstruction, terminal proof audit, delivery assembly authority, or delivery audit.

`memory` has three values:

- `none` retains no claims or routes
- `claims` retains claims only
- `claims-and-routes` retains both entities

## Explorer and coordinator

An explorer submits one `ExplorerReport`:

```ts
interface ExplorerReport {
  rawReport: string;
  nominatedClaims: Array<{
    statement: string;
    basedOnClaims: ClaimId[];
  }>;
  nominatedRoutes: Array<{
    attempt: string;
    outcome: string;
    evidenceClaims: ClaimId[];
    retryCondition?: string;
  }>;
  claimsComplete: boolean;
  citedClaims: ClaimId[];
}
```

Nominations are advisory. The coordinator receives the latest decision packet and submits one atomic batch with distinct actions:

```text
add_claim / revise_claim / drop_claim / retain_claim
add_route / revise_route / drop_route / retain_route
```

New claim and route IDs are consecutive within their own namespaces. A replacement receives a new ID, new origin, and complete redeclaration of its references. Retiring a claim requires revising or dropping every surviving dependent claim and route in the same batch. The action schema rejects duplicate targets, foreign IDs, forward references, dangling references, and retention of a provisional item without passing admission stamps.

With no admission auditors, changed items become live as explicitly unaudited memory. With auditors configured, every auditor checks the complete changed batch. Claim auditors return premise inventories and the harness derives their verdicts. Route auditors return direct verdicts about the accuracy of the recorded attempt and outcome. A route PASS grants no proof standing. The batch becomes live only when every changed item passes every configured admission auditor.

An admission auditor places a newly discovered proof, refutation, or derivation in `mathematicalFinding`. A repaired claim may use that mathematical text as its immutable origin. Terminal and delivery support preserve `mathematicalFinding` and premise material while excluding the admission report, verdict, standing, auditor identity, and stamps.

## Resolution candidate

An explorer with `claimsComplete = true` creates one immutable modular candidate:

```ts
interface ResolutionCandidate {
  protocol: "elenx-solve/exploration-v14/resolution/v1";
  problem: string;
  completionCriteria: string;
  citedClaims: ClaimId[];
  newArgument: string;
  sourceReport: EntryId;
}
```

The kernel binds the candidate bytes to the frozen required-verifier labels. Failed and inconclusive candidates remain in the journal. Their safely projected feedback reaches a later explorer only through a new coordinator batch permitted by memory policy.

## Premise audit and source fallback

`premise-audit` is optional and must precede `proof-audit`. It inventories the smallest non-routine open premises in the resolution and support origins.

- `GIVEN` binds to an exact problem quote.
- `PROVED` binds a verbatim proof to an allowed immutable origin.
- `REFUTED` supplies a decisive refutation.
- `UNESTABLISHED` names the smallest open obligation.

The harness derives FAIL from refutation or misapplication, INCONCLUSIVE from an unestablished premise, and PASS otherwise. One isolated Codex web-search fallback may resolve offline `UNESTABLISHED` findings as `SOURCED`, `REFUTED`, or still `UNESTABLISHED`. Source calls use an isolated read-only directory and preserve raw JSONL and telemetry. Source prose and certificates remain audit records rather than exploration context.

## Fresh terminal proof audit

`proof-audit` is required. It receives:

- the resolution candidate
- every claim in the current transitive support closure
- every direct dependency edge
- each claim's immutable mathematical origin
- established premises

Admission verdicts, PASS stamps, route records, and admission-audit prose are excluded from the mathematical authority projection.

The auditor returns structured coverage:

```ts
interface FinalProofAudit {
  claimChecks: Array<{
    claim: ClaimId;
    dependencyChecks: Array<{
      dependency: ClaimId;
      verdict: Verdict;
      report: string;
    }>;
    derivation: Assessment;
  }>;
  rootApplications: Array<{
    claim: ClaimId;
    verdict: Verdict;
    report: string;
  }>;
  resolution: Assessment;
}
```

The schema requires exactly one check for every closure claim, every direct edge, and every cited root, with no duplicates or foreign IDs. The harness derives the aggregate verdict: any FAIL yields FAIL, otherwise any INCONCLUSIVE yields INCONCLUSIVE, otherwise the result is PASS. The structured audit remains durable verdict evidence.

An earlier admission PASS never substitutes for terminal coverage. Claims admitted without any admission auditor receive the same terminal checks.

## Reconstruction

Reconstruction is optional and follows all direct resolution audits. The harness constructs one strict `DeclaredEvidenceDAG`:

```ts
interface DeclaredEvidenceDAG {
  roots: ClaimId[];
  claims: Array<{
    id: ClaimId;
    statement: string;
    dependsOn: ClaimId[];
  }>;
  sourcedPremises: Array<{ statement: string }>;
}
```

The schema requires unique IDs, present roots and dependencies, acyclicity, and exactly the transitive root closure. Derivation and comparison receive the same serialized DAG bytes. Every listed claim, prerequisite, and sourced premise is an authorized assumption for this gate. The comparator checks hypotheses, applications, undeclared theorem-class dependencies, exact-goal completion, and agreement with the candidate. Terminal proof audit remains responsible for claim truth.

The derivation call never receives the candidate argument, routes, support artifacts, audit history, or verdicts. Its comparison verdict names the exact derivation call.

## Standalone delivery

Passing modular gates launches one delivery assembler using the explorer profile. Its input contains the exact task, verified resolution, complete mathematical support closure, and sourced premise statements. It returns one standalone answer.

The kernel stores that answer as a second immutable candidate:

```ts
interface DeliveryArtifact {
  protocol: "elenx-solve/exploration-v14/delivery/v1";
  resolution: EntryId;
  answer: string;
}
```

The delivery candidate requires only `delivery-audit`. That fresh audit reuses the proof-audit profile but receives a strict whitelist: the task, exact answer, and sourced premise statements. It receives no claim DAG, support artifact, route, stamp, campaign history, or earlier verdict.

The audit returns theorem checks plus self-containment, internal-reference hygiene, and exact-resolution checks. The harness derives its verdict with the same FAIL then INCONCLUSIVE then PASS precedence.

Application status is `solved` only when the linked modular resolution and delivery candidate are both verified. Delivery failure is terminal and returns `delivery-failure`. An operator may inspect the defect and start a fresh campaign or a later protocol. The v14 engine does not silently spend more calls after delivery rejection.

`export CAMPAIGN.db` requires exactly one verified delivery linked to a verified resolution. It emits `DeliveryArtifact.answer` bytes without decoration or an added newline.

## Recovery and replay

State is derived from the append-only journal. Replay identity consists of the label, candidate binding, provider, model ID, API, base URL, requested reasoning, system prompt, user prompt, recovery settings, terminal tool name, description, and JSON schema. The provider-reported `modelProfile` remains telemetry rather than replay authority.

Resume reconciles completed tool submissions, candidates, and verdicts before dispatch. A crash after delivery assembly does not repeat assembly. A crash after a delivery-audit submission records the pending verdict and reaches solved without another model call. A solved resume makes no model call.

Provider-retryable failures restart the same unresolved phase with capped exponential backoff. Unknown tool effects are never retried. Deterministic schema or terminal-submission failures fail immediately.

## Context and transport

Every Pi role starts from a fresh root and receives one terminal tool. Calls use SSE and force serial tool submission. A response that reaches its output limit continues with the complete validated transcript and a short instruction to continue without restarting or repeating completed work. Each call permits eight such length continuations and one separate provider-error recovery, subject to the Elenx runner's aggregate thirty-two-turn cap. `maxContextTokens` bounds the estimated system prompt, user prompt, terminal-tool description, and terminal schema for every structured phase. The check runs before dispatch.

The source fallback is the only retrieval capability. Pi roles receive no filesystem, database, shell, web, execution, or delegation tools.

## Inspection

Inspection separates claims, routes, modular resolutions, and delivery candidates. It exposes liveness, replacement lineage, admission stamps, structured terminal coverage, reconstruction calls, delivery linkage, call settlement, concurrency, provider usage, source telemetry, measured spend, accounting gaps, and unsettled checkpoints.

`--include-inputs` adds exact requests, declared tools, request checkpoints, raw source JSONL, stderr, and complete source results. A semantic projection failure leaves kernel records and telemetry inspectable.
