import { describe, expect, test } from "bun:test";

import { deriveActivity } from "../src/core/activity";
import { hashBytes } from "../src/core/hash";
import {
  makeLogRecord,
  type LogRecord,
  type RecordDraft,
} from "../src/core/records";
import type { CallId, DispatchId, InvocationId } from "../src/core/types";

const bytes = new TextEncoder();
const blob = hashBytes(bytes.encode("activity fixture"));

function record(seq: number, draft: RecordDraft): LogRecord {
  return makeLogRecord(seq, seq * 10, draft);
}

function processRecord(seq: number): LogRecord {
  return record(seq, {
    kind: "process",
    body: { kernelVersion: "test", handlers: [], adapters: [] },
  });
}

function dispatch(seq: number, id: DispatchId): LogRecord {
  return record(seq, {
    kind: "dispatch",
    body: {
      id,
      handler: "worker/v1",
      handlerKind: "worker",
      input: blob,
      meta: {},
    },
  });
}

function call(seq: number, id: CallId, dispatchId: DispatchId): LogRecord {
  return record(seq, {
    kind: "call",
    body: {
      id,
      dispatch: dispatchId,
      label: "reason",
      request: blob,
    },
  });
}

function toolCall(
  seq: number,
  invocation: InvocationId,
  callId: CallId,
  dispatchId: DispatchId,
): LogRecord {
  return record(seq, {
    kind: "tool-call",
    body: {
      call: callId,
      dispatch: dispatchId,
      invocation,
      tool: "inspect",
      arguments: blob,
    },
  });
}

describe("activity derivation", () => {
  test("treats unfinished work as in flight when no process record exists", () => {
    const records = [
      dispatch(1, "dispatch:no-process"),
      call(2, "call:no-process", "dispatch:no-process"),
      toolCall(3, "tool:no-process", "call:no-process", "dispatch:no-process"),
    ];

    expect(deriveActivity(records)).toEqual({
      inFlightDispatches: ["dispatch:no-process"],
      abandonedDispatches: [],
      inFlightCalls: ["call:no-process"],
      abandonedCalls: [],
      inFlightTools: ["tool:no-process"],
      abandonedTools: [],
    });
  });

  test("uses the latest process record as the current-process boundary", () => {
    const records = [
      processRecord(1),
      dispatch(2, "dispatch:old"),
      call(3, "call:old", "dispatch:old"),
      toolCall(4, "tool:old", "call:old", "dispatch:old"),
      processRecord(5),
      dispatch(6, "dispatch:new"),
      call(7, "call:new", "dispatch:new"),
      toolCall(8, "tool:new", "call:new", "dispatch:new"),
    ];

    expect(deriveActivity(records)).toEqual({
      inFlightDispatches: ["dispatch:new"],
      abandonedDispatches: ["dispatch:old"],
      inFlightCalls: ["call:new"],
      abandonedCalls: ["call:old"],
      inFlightTools: ["tool:new"],
      abandonedTools: ["tool:old"],
    });
  });

  test("excludes every start that has its matching terminal record", () => {
    const records = [
      dispatch(1, "dispatch:completed"),
      call(2, "call:completed", "dispatch:completed"),
      toolCall(3, "tool:completed", "call:completed", "dispatch:completed"),
      processRecord(4),
      record(5, {
        kind: "tool-result",
        body: {
          call: "call:completed",
          dispatch: "dispatch:completed",
          invocation: "tool:completed",
          tool: "inspect",
          state: "succeeded",
          result: blob,
        },
      }),
      record(6, {
        kind: "call-result",
        body: {
          call: "call:completed",
          dispatch: "dispatch:completed",
          label: "reason",
          state: "succeeded",
          output: blob,
          usage: [],
        },
      }),
      record(7, {
        kind: "completion",
        body: {
          dispatch: "dispatch:completed",
          handler: "worker/v1",
          handlerKind: "worker",
          state: "succeeded",
          output: blob,
        },
      }),
    ];

    expect(deriveActivity(records)).toEqual({
      inFlightDispatches: [],
      abandonedDispatches: [],
      inFlightCalls: [],
      abandonedCalls: [],
      inFlightTools: [],
      abandonedTools: [],
    });
  });
});
