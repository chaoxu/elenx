# V15 verification gates

Status: active v15 design after review. Adaptive assurance remains research outside the core protocol.

## Principle

V15 performs two operations: explore and verify. Verification occurs at two consequential boundaries:

1. before one explorer's selected context reaches the next explorer
2. before a standalone candidate is accepted

The first gate limits propagation of wrong exploration memory. The second gate checks the exact answer a reader receives. Stored notes that never cross either boundary require no verification.

## Exact handoff gate

An incomplete explorer turn returns:

```ts
interface Continue {
  action: "continue";
  notes: string[];
  nextObjective: string;
  selectedNotes: Array<{
    note: number;
    intendedUse: string;
  }>;
}
```

`note` is the one-based position in that turn's `notes` array. Notes remain untyped and untrusted. `intendedUse` states what the explorer wants the next explorer to take from the note.

The harness constructs one exact handoff containing `nextObjective`, selected note bytes, and intended uses. It rejects duplicate or foreign positions and stops before dispatch when this packet exceeds `maxHandoffTokens`. The separately supplied task, guidance, verifier instructions, and tool schema remain covered by `maxContextTokens`.

One fresh verifier reviews the complete handoff. It checks each intended use, contradictions among selected notes, and whether the objective is supported by the packet. It returns one candidate-unbound `PASS`, `FAIL`, or `INCONCLUSIVE` assessment.

The next explorer receives exactly:

- the task and frozen explorer guidance
- the exact handoff
- the handoff assessment

It receives no earlier transcript, unselected note, older handoff, or verifier history. A non-PASS assessment does not erase the handoff. It tells the next explorer to repair or investigate the exact defect instead of silently relying on the packet.

The review gives no permanent standing to any note. Reusing a note requires selecting its text again in a later handoff, which reviews the new packet and intended use.

## External premise gate

A submitted candidate is exact standalone reader-facing text. One fresh offline verifier inventories the smallest external premises that are neither given by the task nor proved in the candidate.

A refuted or misapplied premise fails the gate. Every unresolved premise goes to an isolated source checker with web search. The source checker receives only:

- exact premise statement and hypotheses
- concise premise-verifier description of its candidate application
- exact candidate excerpt applying it
- claimed citation metadata, if present

It receives no notes, handoff, complete candidate, prior verdict, filesystem, shell, browser control, memory, plugin, or delegation capability.

A sourced premise requires an authoritative URL, source locator, contiguous quote, hypothesis match, application check, citation-metadata check, and refutation attempt. `REFUTED`, `MISAPPLIED`, citation mismatch, and remaining `UNRESOLVED` premises block candidate acceptance.

## Exact candidate gate

After the premise gate passes, one fresh proof verifier receives only:

- exact task and completion criteria
- exact candidate bytes
- verified external source certificates

It checks correctness, completeness, self-containment, edge cases, citation use, and absence of hidden campaign references. The kernel binds its verdict to the immutable candidate.

The frozen campaign may require more candidate verifiers later. V15 core requires one exact proof audit and does not claim calibrated correctness probability or verifier independence.

## Repair

A failed candidate remains immutable. The next explorer receives the exact rejected candidate and the latest bounded defect. Any repair is another complete standalone candidate with a fresh premise gate and proof audit. No verdict transfers between candidates.

## Deferred adaptive assurance

Exposure-weighted review depth, verifier diversity, shadow scheduling, and value-of-information selection remain in [`../../docs/research/exposure-weighted-progressive-assurance.md`](../../docs/research/exposure-weighted-progressive-assurance.md). They require matched prospective evaluation and external adjudication before they can alter these fixed gates.
