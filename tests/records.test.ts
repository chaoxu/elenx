import { describe, expect, test } from "bun:test";

import { Defect } from "../src/core/errors";
import { hashBytes } from "../src/core/hash";
import {
  makeLogRecord,
  parseLogRecord,
  projectRecordCorrelations,
  type CandidateBody,
  type DispatchBody,
} from "../src/core/records";
import { assertJson } from "../src/core/types";

const hash = hashBytes(new TextEncoder().encode("material"));

describe("record boundaries", () => {
  test("derives correlations from the validated body", () => {
    const body: DispatchBody = {
      id: "dispatch:one",
      handler: "hostile-audit/v1",
      handlerKind: "verifier",
      input: hash,
      meta: {},
      target: hash,
    };

    expect(projectRecordCorrelations({ kind: "dispatch", body })).toEqual({
      dispatch: "dispatch:one",
      name: "hostile-audit/v1",
      candidate: hash,
    });
  });

  test("rejects candidate contracts that are not normalized", () => {
    const body: CandidateBody = {
      material: hash,
      requiredVerifiers: ["z", "a"],
      premises: [],
    };

    expect(() => makeLogRecord(1, 0, { kind: "candidate", body })).toThrow(
      TypeError,
    );
  });

  test("rejects a stored row whose indexed columns disagree", () => {
    expect(() =>
      parseLogRecord({
        seq: 1,
        atMs: 0,
        kind: "candidate",
        candidate: hashBytes(new TextEncoder().encode("other")),
        body: {
          material: hash,
          requiredVerifiers: ["audit/v1"],
          premises: [],
        },
      }),
    ).toThrow(Defect);
  });

  test("returns a snapshot rather than caller-owned record bodies", () => {
    const body: CandidateBody = {
      material: hash,
      requiredVerifiers: ["audit/v1"],
      premises: [],
    };
    const record = makeLogRecord(1, 0, { kind: "candidate", body });

    (body.requiredVerifiers as string[])[0] = "changed/v1";

    expect(record.kind).toBe("candidate");
    if (record.kind !== "candidate") throw new Error("unexpected record kind");
    expect(record.body.requiredVerifiers).toEqual(["audit/v1"]);
  });

  test("rejects cyclic, sparse, accessor, and non-finite JSON", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const sparse = new Array(1);
    const accessor = Object.defineProperty({}, "x", {
      enumerable: true,
      get: () => 1,
    });

    for (const value of [cyclic, sparse, accessor, Number.NaN]) {
      expect(() => assertJson(value)).toThrow(TypeError);
    }
  });
});
