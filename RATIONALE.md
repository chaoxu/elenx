# Elenx v1 rationale

The kernel retains only facts that an application must not be able to skip accidentally: the exact candidate bytes and log row, which verifiers were required, what each fresh call received, which tools Elenx supplied and audited, what returned, and which verdict records determine verification.

Pi remains bundled because v1 must run without every application rebuilding a model loop. The integration is a leaf: Pi owns credentials, providers, messages, retries, usage fields, and tool-loop behavior; Elenx supplies durable wrappers and stores the native result. This keeps the default useful without turning the kernel into another agent framework.

Zod is the single authority for public JSON and tool inputs. The same tool schema produces application types, runtime parsing, and the JSON Schema Pi sees. SQLite supplies persistence, row sequences, and write serialization. Elenx code implements only the campaign record model and verification rule.

Candidates contain the application-level statement, proof or answer, sources, and dependencies. Premise graphs, rebuttal workflows, routes, blind reconstruction, search, compute, repeat prevention, and publication remain application data and policy. Every submission gets a new row, even when its bytes match an earlier submission; failure remains attached to that submission.

Verification is a view over immutable candidate and verdict records, not another stored event. Later verdicts update the view without rewriting history. Publishing, adopting, or retracting a result remains application policy and state.

The creating writer appends atomic rows, and unique indexes reject conflicting verdicts. A call start without a result honestly means interrupted work. V1 leaves that campaign immutable after the writer closes; an application may inspect it and start a new campaign instead of resuming hidden process state.
