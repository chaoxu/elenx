import { deriveCandidateStatus, openReader, type Entry } from "elenx";
import {
  derivePiSpend,
  piRequest,
  piRequestAttempts,
  piStoredResult,
} from "elenx/pi";

import { callActivity, parseCampaign } from "./exploration-protocol";
import { snapshot, type CampaignSnapshot } from "./fold";
import {
  sourceCheckRequest,
  sourceEventPrefix,
  sourceCheckResultFor,
} from "./verifiers/source-check";

interface InspectionOptions {
  readonly includeInputs?: boolean;
}

export function inspectCampaign(path: string, options: InspectionOptions = {}) {
  const reader = openReader(path);
  try {
    const records = reader.records();
    const observedAtMs = Date.now();
    const { declaration, task } = parseCampaign(records[0]);
    const semantic = semanticSnapshot(reader, task);
    const results = new Map(
      records
        .filter((entry) => entry.kind === "call-result")
        .map((entry) => [entry.parent, entry]),
    );
    const attempts = piRequestAttempts(records);
    const checkpointCalls = new Set(attempts.map(({ call }) => call));
    const calls = records.filter(
      (entry): entry is Extract<Entry, { kind: "call" }> =>
        entry.kind === "call" && !checkpointCalls.has(entry.seq),
    );
    const spend = derivePiSpend(records);
    const spendByCall = new Map(
      spend.calls.map(({ call, operations, ...summary }) => [
        call,
        { ...summary, operations },
      ]),
    );
    const callRows = calls.map((call) => {
      const result = results.get(call.seq);
      const parsedPi = piRequest.safeParse(call.request);
      const request = parsedPi.success ? parsedPi.data : undefined;
      const parsedSource = sourceCheckRequest.safeParse(call.request);
      const sourceRequest = parsedSource.success
        ? parsedSource.data
        : undefined;
      const parsedPiResult =
        result?.state === "returned"
          ? piStoredResult.safeParse(result.output)
          : undefined;
      const parsedSourceResult =
        sourceRequest !== undefined && result?.state === "returned"
          ? sourceCheckResultFor(sourceRequest).safeParse(result.output)
          : undefined;
      const sourceResult = parsedSourceResult?.success
        ? parsedSourceResult.data
        : undefined;
      const activity = callActivity(call.label);
      const triggerCall = activity.triggerCall ?? sourceRequest?.offlineCall;
      return {
        seq: call.seq,
        label: call.label,
        role: sourceRequest === undefined ? activity.role : "source-check",
        ...(triggerCall === undefined ? {} : { triggerCall }),
        startedAtMs: call.atMs,
        ...(result === undefined ? {} : { settledAtMs: result.atMs }),
        elapsedMs: Math.max(0, (result?.atMs ?? observedAtMs) - call.atMs),
        settlement: result?.state ?? "unsettled",
        ...(call.candidate === undefined ? {} : { candidate: call.candidate }),
        ...(request === undefined
          ? {}
          : {
              model: {
                provider: request.model.provider,
                id: request.model.id,
                api: request.model.api,
              },
              ...(request.reasoning === undefined
                ? {}
                : { reasoning: request.reasoning }),
              ...(request.cacheKey === undefined
                ? {}
                : { cacheKey: request.cacheKey }),
            }),
        ...(parsedPiResult?.success
          ? {
              piState: parsedPiResult.data.state,
              ...(parsedPiResult.data.text === ""
                ? {}
                : { responseText: parsedPiResult.data.text }),
              ...(parsedPiResult.data.state === "succeeded"
                ? {}
                : { error: parsedPiResult.data.error }),
            }
          : {}),
        ...(sourceRequest === undefined
          ? {}
          : {
              sourceCheck: {
                model: sourceRequest.model,
                reasoning: sourceRequest.reasoning,
                premises: sourceRequest.premises.map(
                  ({ statement }) => statement,
                ),
                state:
                  sourceResult?.state ??
                  (result === undefined
                    ? "unsettled"
                    : result.state === "returned"
                      ? "malformed"
                      : "failed"),
                ...(sourceResult?.state === "succeeded"
                  ? {
                      codexVersion: sourceResult.codexVersion,
                      queries: sourceResult.parsed.queries,
                      usage: sourceResult.parsed.usage,
                    }
                  : sourceResult === undefined
                    ? {}
                    : { error: sourceResult.error }),
                ...(options.includeInputs === true && sourceResult !== undefined
                  ? {
                      events:
                        sourceResult.state === "succeeded"
                          ? sourceResult.parsed.events
                          : sourceEventPrefix(sourceResult.stdout).events,
                      stdout: sourceResult.stdout,
                      stderr: sourceResult.stderr,
                      ...(sourceResult.state === "succeeded"
                        ? { result: sourceResult.parsed.result }
                        : {}),
                    }
                  : options.includeInputs === true &&
                      parsedSourceResult !== undefined &&
                      !parsedSourceResult.success &&
                      result?.state === "returned"
                    ? { rawResult: result.output }
                    : {}),
              },
            }),
        ...(result?.state === "threw" ? { error: result.error } : {}),
        ...(options.includeInputs === true
          ? { request: call.request, declaredTools: call.tools }
          : {}),
        requestCheckpoints: attempts
          .filter(({ parent }) => parent === call.seq)
          .map((attempt) => ({
            checkpoint: attempt.call,
            state: attempt.state,
          })),
        tools: records
          .filter(
            (entry): entry is Extract<Entry, { kind: "tool-call" }> =>
              entry.kind === "tool-call" && entry.call === call.seq,
          )
          .map((entry) => ({ seq: entry.seq, tool: entry.tool })),
        spend: spendByCall.get(call.seq),
      };
    });
    const explorations = semantic.turns.map(
      ({ call, settled, submission }) => ({
        call,
        settled,
        findings: submission.findings.length,
        ...(submission.nextObjective === undefined
          ? {}
          : { nextObjective: submission.nextObjective }),
        ...(submission.expand.length === 0
          ? {}
          : { expand: submission.expand }),
      }),
    );
    const curations = semantic.curations.map(
      ({ call, settled, submission, minted, refined }) => ({
        call,
        settled,
        minted,
        refined,
        duplicates: submission.filings.filter(
          ({ duplicateOf }) => duplicateOf !== undefined,
        ).length,
      }),
    );
    const triages = semantic.triages.map(({ call, settled, submission }) => ({
      call,
      settled,
      plans: submission.plans.map(({ note, modes }) => ({ note, modes })),
    }));
    const verdicts = semantic.noteVerdicts.map(
      ({ note, mode, verdict, settled, report }) => ({
        note,
        mode,
        verdict,
        at: settled,
        ...(options.includeInputs === true ? { report } : {}),
      }),
    );
    const serves = semantic.serves.map(({ call, settled, submission }) => ({
      call,
      settled,
      ...(submission.goalNote === undefined
        ? {
            expand: submission.expand,
            ...(submission.objective === undefined
              ? {}
              : { objective: submission.objective }),
          }
        : { goalNote: submission.goalNote }),
    }));
    const notes = semantic.notes.map(
      ({ id, summary, standing, versions, at, parents, text }) => ({
        id,
        summary,
        standing,
        versions,
        at,
        ...(parents.length === 0 ? {} : { parents }),
        ...(options.includeInputs === true ? { text } : {}),
      }),
    );
    const candidates = semantic.candidates.map((row) => {
      const turnRows = callRows.filter((call) => call.candidate === row.id);
      const measured = turnRows.flatMap((call) =>
        call.spend !== undefined && "measuredUsage" in call.spend
          ? [call.spend.measuredUsage]
          : [],
      );
      return {
        id: row.id,
        originCall: row.originCall,
        goalNote: row.goalNote,
        verdicts: row.verdicts.map(({ mode, verdict, record }) => ({
          mode,
          verdict,
          record,
        })),
        verified: deriveCandidateStatus(records, row.id).verified,
        calls: turnRows.map(({ seq }) => seq),
        elapsedMs: turnRows.reduce((total, call) => total + call.elapsedMs, 0),
        ...(measured.length === 0
          ? {}
          : {
              totalTokens: measured.reduce(
                (total, usage) => total + usage.totalTokens,
                0,
              ),
              estimatedCostUsd: measured.reduce(
                (total, usage) => total + usage.estimatedCostUsd,
                0,
              ),
            }),
      };
    });
    const last = records.at(-1);
    return {
      protocol: task.protocol,
      problem: task.problem,
      completionCriteria: task.completionCriteria,
      maxContextTokens: task.maxContextTokens,
      maxIndexTokens: task.maxIndexTokens,
      guidance: task.guidance,
      profiles: {
        explorer: publicProfile(task.explorer),
        curator: publicProfile(task.curator),
        triage: publicProfile(task.triage),
        verifier: publicProfile(task.verifier),
        sourceChecker: task.sourceChecker,
      },
      createdAtMs: declaration.atMs,
      lastSeq: last?.seq ?? declaration.seq,
      lastAtMs: last?.atMs ?? declaration.atMs,
      observedAtMs,
      phase: semantic.phase,
      ...(semantic.projectionError === undefined
        ? {}
        : { projectionError: semantic.projectionError }),
      indexTokens: semantic.indexTokens,
      explorations,
      curations,
      triages,
      verdicts,
      serves,
      notes,
      ...(semantic.mechanicalGaps.length === 0
        ? {}
        : { mechanicalGaps: semantic.mechanicalGaps }),
      ...(semantic.solution === undefined
        ? {}
        : { solution: semantic.solution }),
      candidates,
      calls: callRows,
      spend: spend.summary,
      concurrency: concurrency(callRows),
    };
  } finally {
    reader.close();
  }
}

// Export emits the verified goal note followed by its ancestor closure in
// dependency order (a note's dependencies precede it), exactly as
// docs/protocol.md promises. Assembly into a reader-facing document is
// external tooling over this output.
export function exportAnswer(path: string): Uint8Array {
  const reader = openReader(path);
  try {
    const records = reader.records();
    const task = parseCampaign(records[0]).task;
    const semantic = snapshot(reader, task);
    if (semantic.phase !== "solved" || semantic.solution === undefined) {
      throw new Error("campaign has no verified v17 goal");
    }
    const accepted = semantic.candidates.find(
      (candidate) => candidate.id === semantic.solution,
    );
    if (accepted === undefined) {
      throw new Error("solved campaign lost its accepted candidate");
    }
    const notes = new Map(semantic.notes.map((note) => [note.id, note]));
    const goal = notes.get(accepted.goalNote);
    if (goal === undefined) {
      throw new Error("solved campaign lost its goal note");
    }
    const closure = closureInDependencyOrder(accepted.goalNote, notes);
    const sections = [
      `[${goal.id}] ${goal.summary}`,
      "",
      goal.text,
      ...closure.flatMap((id) => {
        const note = notes.get(id);
        if (note === undefined) throw new Error(`closure lost note ${id}`);
        return ["", `--- [${note.id}] ${note.summary}`, "", note.text];
      }),
      "",
    ];
    return new TextEncoder().encode(sections.join("\n"));
  } finally {
    reader.close();
  }
}

// The goal's ancestor closure in mint-ordinal order. That order is already
// topological: dependency edges are wired at mint against earlier notes
// only, so every parent's ordinal is strictly below its child's.
function closureInDependencyOrder(
  goal: string,
  notes: ReadonlyMap<string, { readonly parents: readonly string[] }>,
): string[] {
  const members = new Set<string>();
  const gather = (id: string) => {
    for (const parent of notes.get(id)?.parents ?? []) {
      if (members.has(parent)) continue;
      members.add(parent);
      gather(parent);
    }
  };
  gather(goal);
  return [...members].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

type SemanticView = Omit<CampaignSnapshot, "phase"> & {
  readonly phase: CampaignSnapshot["phase"] | "projection-error";
  readonly projectionError?: string;
};

function semanticSnapshot(
  reader: Parameters<typeof snapshot>[0],
  task: Parameters<typeof snapshot>[1],
): SemanticView {
  try {
    return snapshot(reader, task);
  } catch (error) {
    return {
      phase: "projection-error",
      projectionError: error instanceof Error ? error.message : String(error),
      indexTokens: 0,
      turns: [],
      curations: [],
      triages: [],
      noteVerdicts: [],
      serves: [],
      candidates: [],
      mechanicalGaps: [],
      notes: [],
    };
  }
}

function publicProfile(profile: {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
}) {
  return {
    provider: profile.provider,
    model: profile.model,
    reasoning: profile.reasoning,
  };
}

function concurrency(
  calls: readonly {
    readonly startedAtMs: number;
    readonly settledAtMs?: number;
  }[],
) {
  const events = calls.flatMap((call) => [
    { at: call.startedAtMs, delta: 1 },
    ...(call.settledAtMs === undefined
      ? []
      : [{ at: call.settledAtMs, delta: -1 }]),
  ]);
  events.sort((left, right) => left.at - right.at || left.delta - right.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  return {
    active,
    peak,
    peakIsExact: calls.every(({ settledAtMs }) => settledAtMs !== undefined),
  };
}

export type CampaignInspection = ReturnType<typeof inspectCampaign>;
