import { describe, expect, test } from "bun:test";

import { hashBytes } from "../src/core/hash";
import {
  makeLogRecord,
  type LogRecord,
  type PromotionBody,
  type RecordDraft,
} from "../src/core/records";
import {
  acceptanceCheck,
  promotionCheck,
  standingFails,
  verdictViews,
} from "../src/core/rules";
import type { Hash, Verdict } from "../src/core/types";

const encoder = new TextEncoder();
const hash = (text: string): Hash => hashBytes(encoder.encode(text));

const output = hash("verifier output");
const reason = hash("operator rebuttal");
const input = hash("dispatch input");

function record(seq: number, draft: RecordDraft): LogRecord {
  return makeLogRecord(seq, seq * 10, draft);
}

function candidate(
  seq: number,
  material: Hash,
  requiredVerifiers: readonly string[],
  premises: readonly Hash[] = [],
): LogRecord {
  return record(seq, {
    kind: "candidate",
    body: { material, requiredVerifiers, premises },
  });
}

function verdict(
  seq: number,
  material: Hash,
  verifier: string,
  result: Verdict,
): LogRecord {
  return record(seq, {
    kind: "completion",
    body: {
      dispatch: `dispatch:${seq}`,
      handler: verifier,
      handlerKind: "verifier",
      state: "succeeded",
      output,
      candidate: material,
      verdict: result,
    },
  });
}

function rebuttal(
  seq: number,
  failingCompletionSeq: number,
  verifier: string,
  material: Hash,
): LogRecord {
  return record(seq, {
    kind: "rebuttal",
    body: {
      failingCompletionSeq,
      reason,
      verifier,
      candidate: material,
    },
  });
}

function promotion(
  seq: number,
  material: Hash,
  passes: PromotionBody["passes"],
): LogRecord {
  return record(seq, {
    kind: "promotion",
    body: { candidate: material, passes },
  });
}

describe("verdict derivation", () => {
  test("a later PASS does not erase a FAIL, and only an exact later rebuttal clears it", () => {
    const material = hash("candidate");
    const other = hash("other candidate");
    const base = [
      candidate(1, material, ["audit"]),
      rebuttal(2, 3, "audit", material),
      verdict(3, material, "audit", "FAIL"),
      verdict(4, material, "audit", "PASS"),
      rebuttal(5, 3, "other-audit", material),
      rebuttal(6, 3, "audit", other),
    ];

    expect(
      standingFails(base, material).map((view) => view.completionSeq),
    ).toEqual([3]);
    expect(verdictViews(base, material).map((view) => view.standing)).toEqual([
      true,
      false,
    ]);

    const cleared = [...base, rebuttal(7, 3, "audit", material)];
    expect(standingFails(cleared, material)).toEqual([]);
    expect(verdictViews(cleared, material)[0]?.rebuttalSeqs).toEqual([7]);
  });

  test("ignores failures, cancellations, worker completions, and events", () => {
    const material = hash("candidate");
    const records = [
      candidate(1, material, ["audit"]),
      record(2, {
        kind: "completion",
        body: {
          dispatch: "dispatch:failed",
          handler: "audit",
          handlerKind: "verifier",
          state: "failed",
          error: hash("failure"),
          candidate: material,
        },
      }),
      record(3, {
        kind: "completion",
        body: {
          dispatch: "dispatch:worker",
          handler: "worker",
          handlerKind: "worker",
          state: "succeeded",
          output,
        },
      }),
      record(4, {
        kind: "event",
        body: {
          topic: "fake-verdict",
          data: { candidate: material, verdict: "FAIL" },
          blobs: [],
        },
      }),
    ];

    expect(verdictViews(records, material)).toEqual([]);
  });
});

describe("promotion", () => {
  test("selects the lowest-seq PASS for each required verifier deterministically", () => {
    const material = hash("candidate");
    const records = [
      verdict(9, material, "audit-b", "PASS"),
      verdict(7, material, "audit-a", "PASS"),
      candidate(1, material, ["audit-a", "audit-b"]),
      verdict(8, material, "audit-a", "PASS"),
    ];

    expect(promotionCheck(records, material)).toEqual({
      ok: true,
      candidate: material,
      passes: [
        { verifier: "audit-a", completionSeq: 7 },
        { verifier: "audit-b", completionSeq: 9 },
      ],
    });
  });

  test("an optional verifier's standing FAIL blocks promotion", () => {
    const material = hash("candidate");
    const result = promotionCheck(
      [
        candidate(1, material, ["required"]),
        verdict(2, material, "required", "PASS"),
        verdict(3, material, "optional", "FAIL"),
        verdict(4, material, "optional", "PASS"),
      ],
      material,
    );

    expect(result.ok).toBeFalse();
    if (result.ok) throw new Error("expected promotion to be blocked");
    expect(result.blockers).toContainEqual({
      kind: "standing-fail",
      verifier: "optional",
      completionSeq: 3,
    });
  });

  test("reports missing candidates, missing passes, and premise cycles", () => {
    const a = hash("candidate a");
    const b = hash("candidate b");
    const missing = hash("missing");

    expect(promotionCheck([], missing)).toEqual({
      ok: false,
      candidate: missing,
      blockers: [{ kind: "candidate-missing", candidate: missing }],
    });

    const records = [
      candidate(1, a, ["audit"], [b]),
      candidate(2, b, ["audit"], [a]),
    ];
    const result = promotionCheck(records, a);
    expect(result.ok).toBeFalse();
    if (result.ok) throw new Error("expected promotion to be blocked");
    expect(result.blockers).toContainEqual({
      kind: "missing-pass",
      verifier: "audit",
    });
    expect(
      result.blockers.some((blocker) => blocker.kind === "premise-cycle"),
    ).toBe(true);
  });
});

describe("acceptance", () => {
  test("a later premise FAIL invalidates the premise and every dependent", () => {
    const premise = hash("premise");
    const result = hash("result");
    const settled = [
      candidate(1, premise, ["audit"]),
      verdict(2, premise, "audit", "PASS"),
      promotion(3, premise, [{ verifier: "audit", completionSeq: 2 }]),
      candidate(4, result, ["audit"], [premise]),
      verdict(5, result, "audit", "PASS"),
      promotion(6, result, [{ verifier: "audit", completionSeq: 5 }]),
    ];

    expect(acceptanceCheck(settled, premise).ok).toBeTrue();
    expect(acceptanceCheck(settled, result).ok).toBeTrue();

    const failed = [...settled, verdict(7, premise, "critic", "FAIL")];
    const premiseState = acceptanceCheck(failed, premise);
    const resultState = acceptanceCheck(failed, result);
    expect(premiseState.ok).toBeFalse();
    expect(resultState.ok).toBeFalse();
    if (resultState.ok) throw new Error("expected dependent to be unaccepted");
    expect(resultState.blockers).toContainEqual({
      kind: "premise-not-accepted",
      premise,
    });

    const restored = [...failed, rebuttal(8, 7, "critic", premise)];
    expect(acceptanceCheck(restored, premise).ok).toBeTrue();
    expect(acceptanceCheck(restored, result).ok).toBeTrue();
  });

  test("events cannot promote, rebut, or invalidate a candidate", () => {
    const material = hash("candidate");
    const records = [
      candidate(1, material, ["audit"]),
      verdict(2, material, "audit", "PASS"),
      promotion(3, material, [{ verifier: "audit", completionSeq: 2 }]),
    ];
    const before = acceptanceCheck(records, material);
    const after = acceptanceCheck(
      [
        ...records,
        record(4, {
          kind: "event",
          body: {
            topic: "kernel-looking-payload",
            data: {
              kind: "completion",
              candidate: material,
              verdict: "FAIL",
              failingCompletionSeq: 2,
            },
            blobs: [input],
          },
        }),
      ],
      material,
    );

    expect(before).toEqual(after);
  });

  test("reports a cycle without recursing forever", () => {
    const a = hash("candidate a");
    const b = hash("candidate b");
    const state = acceptanceCheck(
      [candidate(1, a, ["audit"], [b]), candidate(2, b, ["audit"], [a])],
      a,
    );

    expect(state.ok).toBeFalse();
    if (state.ok) throw new Error("expected acceptance to be blocked");
    expect(
      state.blockers.some((blocker) => blocker.kind === "premise-cycle"),
    ).toBe(true);
  });
});
