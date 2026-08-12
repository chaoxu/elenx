# Elenx

Elenx is a small kernel for auditable agent workflows. It records immutable campaign state, runs application-defined workers and verifiers, makes fresh model calls, accounts for their usage, and enforces content-bound promotion rules.

The kernel does not implement proof search. Routes, idea gates, blind reconstruction, literature search, computation, steering, and user-facing campaign files belong to applications built on it.

Models never receive database access. Each call receives only the narrow application tools required for its role; those tools validate semantic operations before invoking the kernel.

- [`SPEC.md`](SPEC.md) is the sole normative contract.
- [`PLAN.md`](PLAN.md) is the implementation and verification order.
- [`RATIONALE.md`](RATIONALE.md) explains the retained design choices.

The first implementation includes a hostile-audit example only as an end-to-end kernel test. A Coverify-replacement proof-search application is a later, independent package.
