# Elenx kernel v1 rationale

This file explains decisions in [`SPEC.md`](SPEC.md). It does not add requirements.

## Why the kernel is smaller than Coverify

Coverify combines two different products: generic execution and record integrity, and one particular proof-search workflow. Only the first needs to be stable before experiments begin. Proof-search mechanisms can change independently when they are ordinary handlers, tools, candidate material, and application events.

This separation is not a claim that routes, gates, blind reconstruction, computation, source search, or readable ledgers are unnecessary. A Coverify-replacement application may need all of them. None changes the meaning of a dispatch, call, verdict, or promotion, so none belongs in the kernel.

## Why one package and one store

V1 has one consumer and one database implementation. Separate published packages and swappable-store ports would create compatibility obligations before there is evidence of a second implementation. A source import boundary gives the same protection at lower cost.

SQLite keeps the log and blobs in one portable artifact. Application events prevent workflow concepts from forcing schema additions while keeping those events auditable beside kernel facts.

## Why append-only records

A later PASS must not erase an earlier FAIL, and a later premise failure must remain visible in the history. Append-only records make both rules derivations over facts rather than mutation protocols. Rebuttal names one exact FAIL instead of editing it away.

The database is not an adversarial ledger. The threat model is buggy application code and accidental concurrent writers, not an operator with raw SQL or filesystem control.

## Why candidate contracts are frozen

Content identity is only useful if identical material cannot be resubmitted under easier verification requirements. The first candidate record binds the material hash to its required verifiers and internal premises. An application wanting different requirements must create different material.

The kernel does not freeze a mathematical statement because many applications have no such object. A proof-search application can place its statement revision and policy inside candidate material or its immutable application configuration.

## Why rules are kernel code

Dispatch strategy is recoverable and experimental. Acceptance semantics are neither: two readers must not disagree about whether a result passed. The small promotion rule set therefore lives as pure exported functions used by both writer and reader.

Applications choose the required verifiers. The kernel enforces only the recorded choice. A bad verifier can still return a bad opinion; Elenx guarantees that the chosen protocol ran, not that the opinion is true.

## Why every model call belongs to a dispatch

Optional dispatch ids produced an accounting exception for coordinators. Treating a coordinator as an ordinary worker removes the exception and gives every call an owner, signal, input, and completion context.

Each call starts a fresh model loop. This prevents a later verifier from learning a candidate through hidden conversation history while its recorded prompt appears clean. Tool loops stay inside one call and are recorded in its transcript.

## Why tools are application-owned

Filesystem access, web search, proof assistants, and supervised computation differ in authority and lifecycle. The kernel cannot choose those policies. Its useful obligation is smaller: pass cancellation, validate and record each tool invocation before executing it, record its result, and leave semantic authority to application code.

Model tools use role-specific verbs rather than exposing `Kernel` or `HandlerContext`. A proof-search application can offer `request_verification` while keeping handler names, verifier contracts, and database layout out of the model's arguments. A blind verifier can receive no tools at all.

Adapter-specific execution options travel as validated, recorded adapter options. Provider-native tools are excluded in v1 so the declared tool list remains the complete model-visible capability manifest.

The kernel can independently record application tool traffic because it wraps tool execution. It cannot independently observe every provider message, so adapters are trusted to report that part of the transcript accurately. The bundled adapter is tested as part of v1; a third-party adapter joins that trusted boundary.

## Why there is no verdict reuse

Reuse is information-flow policy: safety depends on every input a verifier saw and whether its response influenced a repair. That policy differs by verifier and has produced subtle defects before. V1 pays for a fresh verification rather than standardizing an unsafe cache. Applications may experiment with reuse above the kernel, but reused output must enter as new recorded work and cannot forge a kernel verdict.

## Why the first example is deliberately small

The hostile-audit slice exercises storage, dispatch, model calls, verdict binding, rebuttal, promotion, accounting, and read-only reconstruction. It is large enough to expose a broken boundary and small enough not to become a hidden proof-search application.

Once that slice works, application development can proceed against a stable public API. Whether a richer workflow beats Coverify or a single strong model is then an application experiment rather than a prerequisite for trusting the kernel's bookkeeping.
