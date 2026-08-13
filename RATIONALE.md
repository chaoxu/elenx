# Elenx v1 rationale

The kernel retains only facts that an application must not be able to skip accidentally: the exact candidate bytes and hash, which verifiers were required, what each fresh call received, which tools Elenx supplied and audited, what returned, and which PASS records authorized promotion.

Pi remains bundled because v1 must run without every application rebuilding a model loop. The integration is a leaf: Pi owns credentials, providers, messages, retries, usage fields, and tool-loop behavior; Elenx supplies durable wrappers and stores the native result. This keeps the default useful without turning the kernel into another agent framework.

Zod is the single authority for public JSON and tool inputs. The same tool schema produces application types, runtime parsing, and the JSON Schema Pi sees. Bun SQLite supplies locking and transaction serialization. Platform crypto supplies hashes and ids. Elenx code implements only the campaign record model and promotion rule.

Candidates contain the application-level statement, proof or answer, sources, dependencies, and revision identity. Premise graphs, rebuttal workflows, routes, blind reconstruction, search, compute, and publication remain application data and policy. Changed material gets a new hash; a failed candidate is never rehabilitated by hidden mutation.

Promotion is explicit and monotone. Current verdicts alone are not publication authority, and a later record cannot silently reverse a published result. Applications may attach their own branch, issue, or file update to the immutable promotion record.

SQLite serializes short decisions, so v1 has no native process-lifetime lock or current-process activity model. A call start without a result honestly means interrupted work. Applications decide whether and how to retry it.
