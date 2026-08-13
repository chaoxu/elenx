# Elenx kernel v1 specification

This file is the normative contract for kernel v1.

## Purpose and boundary

Elenx provides four guarantees:

1. one append-only SQLite campaign artifact with content-addressed blobs;
2. an exact record of each call, its selected tool declarations, admitted tool inputs and results, and final call result;
3. verdicts bound to fresh successful calls carrying the hash of exact stored candidate bytes; and
4. explicit, witnessed, monotone promotion after every required verifier passes and none fails.

Elenx is not an agent framework. Applications own coordination, routes, context assembly, source search, computation, retries, budgets, filesystem policy, publication, and user interfaces.

## Runtime and dependencies

V1 targets Bun 1.3.14 or newer. It uses Bun SQLite for persistence, Zod 4.4.3 for input validation and JSON Schema generation, Pi 0.84.1 for the bundled model loop, and platform SHA-256 and UUID primitives. The implementation contains no custom SQL parser, JSON Schema validator, model loop, provider client, or native lock binding.

## Campaign artifact

A campaign is one SQLite database. The database uses WAL, `synchronous=FULL`, a five-second busy timeout, strict tables, and append-only triggers. Short `BEGIN IMMEDIATE` transactions serialize candidate, verdict, and promotion decisions across campaign handles. There is no process-lifetime writer lock.

Creation uses an exclusive private file create and never overwrites an existing path. The schema and campaign identity commit together. A crash before that commit may leave an invalid file, which readers reject and an operator must remove before retry. The artifact is not tamper-resistant against an operator with raw filesystem or SQL access.

Blobs are addressed as `sha256:<64 lowercase hexadecimal digits>`. Reads recompute the digest. An insert collision is accepted only when both length and bytes match.

## Records

Every record has a positive `seq`, an informational nonnegative `atMs`, and one closed kind. Only `seq` determines order.

| kind | durable fact |
|---|---|
| `campaign` | application id and JSON configuration |
| `candidate` | material hash and frozen nonempty verifier set |
| `call` | id, verifier/application label, exact JSON request, and selected tool declarations |
| `tool-call` | call id, kernel tool id, optional provider source id, tool name, and validated JSON input |
| `tool-result` | matching tool id and either returned JSON or thrown error text |
| `call-result` | matching call id and either returned JSON or thrown error text |
| `verdict` | candidate, required verifier, successful call id, verdict, and JSON evidence |
| `promotion` | candidate and exact PASS-verdict sequence numbers |

Rows and public values are validated with closed Zod schemas. SQLite uniqueness constraints permit one campaign, one candidate contract per hash, one result per call or tool id, one verdict per call, and one promotion per candidate.

## Calls and tools

```ts
interface CallOptions {
  readonly label: string;
  readonly request: Json;
  readonly tools?: readonly Tool[];
  readonly signal?: AbortSignal;
}

interface CallContext {
  readonly request: Json;
  readonly tools: readonly AuditedTool[];
  readonly signal: AbortSignal;
}

campaign.call(options, runner): Promise<{ id: CallId; output: Json }>
```

`call` validates and snapshots the request and each tool declaration, appends `call`, and then invokes `runner` with that recorded request. It appends exactly one `call-result` if the runner settles. A crash may leave only the start record.

A tool is defined with `defineTool({ name, description, input, run })`, where `input` is a Zod object schema. Elenx records `z.toJSONSchema(input)`. An audited wrapper parses each invocation with the same schema, appends `tool-call` before `run` executes, and appends one `tool-result` after settlement. Invalid arguments do not run `run`. Schema getters, refinements, and transforms are admission logic and must be pure. The call stops accepting new tool invocations when its runner settles and waits for every admitted tool invocation before writing `call-result`. `close()` refuses while a local call remains active.

The runner receives only the tools listed in `CallOptions`. The kernel never adds tools. Applications must keep tools semantic and policy-checked; they must not wrap the whole `Campaign`, expose SQL or the database path, offer generic record append, or provide unrestricted blob or filesystem access. Application-supplied runners and Pi registries are trusted not to add capabilities outside this set.

## Pi runner

`runPi(campaign, options)` creates one fresh Pi `runAgentLoop`. The application selects a real model from the registry returned by `builtinPi`, then supplies that registry, label, system prompt, prompt, optional candidate hash, optional tools, and optional abort signal. `builtinPi({ credentials })` accepts Pi's re-exported in-memory credential store for OAuth or API-key use.

Elenx supplies Pi only the audited wrappers selected for that run. Pi validates generated schemas and executes its own tool loop, provider calls, retries, and transcript construction. Elenx stores Pi's native transcript, including Pi-native usage and stop reasons, without inventing provider identity or cross-provider accounting. Only a final Pi `stop` is successful. Token limits, deferred work, protocol errors, and cancellation return `state: "failed"` or `state: "cancelled"` and cannot support a verdict.

The recorded Pi request contains the provider, model id, API id, prompt, optional system prompt, optional candidate hash, and selected tool declarations. Provider credentials, registry configuration, and the provider wire request remain Pi/application concerns and are not persisted by Elenx.

## Candidates, verdicts, and promotion

`submitCandidate(material, requiredVerifiers)` hashes exact bytes and freezes a sorted, unique, nonempty verifier set. Resubmitting the same bytes with the identical normalized set is idempotent. Any different set is a conflict.

`recordVerdict(candidate, verifier, call, verdict, evidence)` accepts `PASS`, `FAIL`, or `INCONCLUSIVE` only when:

- the candidate exists and names that verifier;
- the candidate has not been promoted;
- the call starts after candidate submission;
- the call label equals the verifier name;
- the recorded call request contains that exact candidate hash;
- the call returned JSON whose `state` is `"succeeded"`; and
- no verdict already cites that call.

A candidate is promotable when each required verifier has at least one PASS and no required verifier has any FAIL. INCONCLUSIVE neither passes nor fails. A later PASS does not erase a FAIL; applications submit revised candidate bytes for another attempt.

`promote(candidate)` atomically rechecks promotability and appends one promotion citing the first PASS for each required verifier. Repeated promotion is idempotent. No later verdict may target a promoted candidate, so promotion is monotone. `status(candidate)` returns the candidate hash, `promotable`, `promoted`, missing verifier names, failed verifier names, and selected PASS sequence numbers. Writers and readers use the same derivation.

## Public API

```ts
createCampaign(path, application, config): Campaign
openCampaign(path): Campaign
openReader(path): Reader

campaign.submitCandidate(material, requiredVerifiers): Hash
campaign.call(options, runner): Promise<CallReceipt>
campaign.recordVerdict(candidate, verifier, call, verdict, evidence): Entry
campaign.promote(candidate): Entry
campaign.records(): readonly Entry[]
campaign.blob(hash): Uint8Array
campaign.status(candidate): CandidateStatus
campaign.close(): void

reader.records(): readonly Entry[]
reader.blob(hash): Uint8Array
reader.status(candidate): CandidateStatus
reader.close(): void

defineTool(definition): Tool
runPi(campaign, options): Promise<PiResult> // from elenx/pi
```

All database methods are synchronous because Bun SQLite is synchronous. Only external execution through `call` and `runPi` is asynchronous.

## Completion criteria

V1 is complete when the full check passes on macOS and Linux, a fresh reader reconstructs a promoted candidate from the artifact alone, the scripted hostile-audit slice passes, one explicitly requested real-provider Pi smoke passes, package contents and consumer types are verified, and nonblank source remains at or below 1,500 lines.
