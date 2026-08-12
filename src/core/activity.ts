import type { LogRecord } from "./records";
import type { ReaderActivity } from "./types";

export function deriveActivity(records: readonly LogRecord[]): ReaderActivity {
  const processSeq = records.reduce(
    (latest, record) => (record.kind === "process" ? record.seq : latest),
    0,
  );

  const completedDispatches = new Set(
    records
      .filter((record) => record.kind === "completion")
      .map((record) => record.body.dispatch),
  );
  const completedCalls = new Set(
    records
      .filter((record) => record.kind === "call-result")
      .map((record) => record.body.call),
  );
  const completedTools = new Set(
    records
      .filter((record) => record.kind === "tool-result")
      .map((record) => record.body.invocation),
  );

  const activity: {
    inFlightDispatches: ReaderActivity["inFlightDispatches"][number][];
    abandonedDispatches: ReaderActivity["abandonedDispatches"][number][];
    inFlightCalls: ReaderActivity["inFlightCalls"][number][];
    abandonedCalls: ReaderActivity["abandonedCalls"][number][];
    inFlightTools: ReaderActivity["inFlightTools"][number][];
    abandonedTools: ReaderActivity["abandonedTools"][number][];
  } = {
    inFlightDispatches: [],
    abandonedDispatches: [],
    inFlightCalls: [],
    abandonedCalls: [],
    inFlightTools: [],
    abandonedTools: [],
  };

  for (const record of records) {
    if (
      record.kind === "dispatch" &&
      !completedDispatches.has(record.body.id)
    ) {
      const target =
        record.seq > processSeq
          ? activity.inFlightDispatches
          : activity.abandonedDispatches;
      target.push(record.body.id);
    } else if (record.kind === "call" && !completedCalls.has(record.body.id)) {
      const target =
        record.seq > processSeq
          ? activity.inFlightCalls
          : activity.abandonedCalls;
      target.push(record.body.id);
    } else if (
      record.kind === "tool-call" &&
      !completedTools.has(record.body.invocation)
    ) {
      const target =
        record.seq > processSeq
          ? activity.inFlightTools
          : activity.abandonedTools;
      target.push(record.body.invocation);
    }
  }

  return activity;
}
