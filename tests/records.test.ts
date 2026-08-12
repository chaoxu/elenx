import { describe, expect, test } from "bun:test";

import { Defect } from "../src/core/errors";
import { hashBytes } from "../src/core/hash";
import {
  assertRecordDraft,
  makeLogRecord,
  parseLogRecord,
  projectRecordCorrelations,
  recordBlobReferences,
  type CandidateBody,
  type DispatchBody,
  type RecordDraft,
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

  test("keeps bodies closed and terminal variants state-dependent", () => {
    const invalidDrafts: readonly unknown[] = [
      {
        kind: "candidate",
        body: {
          material: hash,
          requiredVerifiers: ["audit/v1"],
          premises: [],
          extra: true,
        },
      },
      {
        kind: "dispatch",
        body: {
          id: "dispatch:one",
          handler: "worker/v1",
          handlerKind: "worker",
          input: hash,
          meta: null,
          target: hash,
        },
      },
      {
        kind: "tool-result",
        body: {
          call: "call:one",
          dispatch: "dispatch:one",
          invocation: "tool:one",
          tool: "inspect",
          state: "succeeded",
          result: hash,
          error: hash,
        },
      },
      {
        kind: "call-result",
        body: {
          call: "call:one",
          dispatch: "dispatch:one",
          label: "draft",
          state: "failed",
          usage: [],
        },
      },
      {
        kind: "completion",
        body: {
          dispatch: "dispatch:one",
          handler: "worker/v1",
          handlerKind: "worker",
          state: "succeeded",
          output: hash,
          candidate: hash,
          verdict: "PASS",
        },
      },
    ];

    for (const draft of invalidDrafts) {
      expect(() => assertRecordDraft(draft)).toThrow(TypeError);
    }
  });

  test("preserves the exact blob reference projection", () => {
    const draft: RecordDraft = {
      kind: "call-result",
      body: {
        call: "call:one",
        dispatch: "dispatch:one",
        label: "draft",
        state: "failed",
        output: hash,
        transcript: hash,
        usage: [],
        error: hash,
      },
    };

    expect(recordBlobReferences(draft)).toEqual([hash, hash, hash]);
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
