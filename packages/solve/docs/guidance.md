# Explorer guidance

Status: shipped in `exploration-v15`.

Guidance is a frozen list of advisory text given only to explorers. Default metadata states that guidance changes search strategy rather than verification or acceptance. User modules come from `explorerGuidance`.

Guidance cannot alter the task, schemas, context ceilings, verifier profiles, candidate labels, verdict derivation, source isolation, or tool access. Verifier instructions belong to their fixed modes instead of user guidance.

Inspection exposes exact resolved guidance. Resume recomputes it and stops before dispatch when it differs. Matched experiments keep guidance identical unless it is the declared axis.

Keep a module only when matched known-solution campaigns show more externally accepted candidates at equal spend or the same results at lower spend.
