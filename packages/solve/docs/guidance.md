# Explorer guidance

Status: shipped in `exploration-v17`.

Guidance is a frozen list of advisory text given only to explorers. Default metadata states that guidance changes search strategy rather than verification or acceptance. User modules come from `explorerGuidance`.

Guidance cannot alter the task, schemas, context ceilings, role profiles, triage plans, verdicts, standings, source isolation, or tool access. Verifier and curator instructions belong to their fixed call sites instead of user guidance. Guidance shapes how the explorer reasons; curator serving shapes what it sees — the two levers are separate by construction.

Inspection exposes exact resolved guidance. Resume recomputes it and stops before dispatch when it differs. Matched experiments keep guidance identical unless it is the declared axis.

Keep a module only when matched known-solution campaigns show more externally accepted resolutions at equal spend or the same results at lower spend.
