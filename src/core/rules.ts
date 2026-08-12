import type {
  CandidateRecord,
  CompletionRecord,
  LogRecord,
  PromotionRecord,
  RebuttalRecord,
} from "./records";
import type {
  AcceptanceBlocker,
  AcceptanceCheck,
  Hash,
  PromotionBlocker,
  PromotionCheck,
  VerdictView,
} from "./types";

interface Facts {
  readonly candidates: ReadonlyMap<Hash, CandidateRecord>;
  readonly promotions: ReadonlyMap<Hash, PromotionRecord>;
  readonly verdicts: ReadonlyMap<Hash, readonly VerdictView[]>;
}

function bySeq(left: LogRecord, right: LogRecord): number {
  return left.seq - right.seq;
}

function matchingRebuttals(
  rebuttals: readonly RebuttalRecord[],
  completion: CompletionRecord & {
    readonly body: {
      readonly handlerKind: "verifier";
      readonly state: "succeeded";
      readonly candidate: Hash;
      readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
    };
  },
): readonly number[] {
  return rebuttals
    .filter(
      (rebuttal) =>
        rebuttal.seq > completion.seq &&
        rebuttal.body.failingCompletionSeq === completion.seq &&
        rebuttal.body.verifier === completion.body.handler &&
        rebuttal.body.candidate === completion.body.candidate,
    )
    .map((rebuttal) => rebuttal.seq)
    .sort((left, right) => left - right);
}

function isVerdictCompletion(record: LogRecord): record is CompletionRecord & {
  readonly body: {
    readonly handlerKind: "verifier";
    readonly state: "succeeded";
    readonly output: Hash;
    readonly candidate: Hash;
    readonly verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  };
} {
  return (
    record.kind === "completion" &&
    record.body.handlerKind === "verifier" &&
    record.body.state === "succeeded"
  );
}

function collectFacts(records: readonly LogRecord[]): Facts {
  const ordered = [...records].sort(bySeq);
  const candidates = new Map<Hash, CandidateRecord>();
  const promotions = new Map<Hash, PromotionRecord>();
  const rebuttals = ordered.filter(
    (record): record is RebuttalRecord => record.kind === "rebuttal",
  );
  const verdicts = new Map<Hash, VerdictView[]>();

  for (const record of ordered) {
    if (record.kind === "candidate" && !candidates.has(record.body.material)) {
      candidates.set(record.body.material, record);
      continue;
    }
    if (record.kind === "promotion" && !promotions.has(record.body.candidate)) {
      promotions.set(record.body.candidate, record);
      continue;
    }
    if (!isVerdictCompletion(record)) continue;

    const rebuttalSeqs =
      record.body.verdict === "FAIL"
        ? matchingRebuttals(rebuttals, record)
        : [];
    const view: VerdictView = {
      completionSeq: record.seq,
      dispatch: record.body.dispatch,
      verifier: record.body.handler,
      candidate: record.body.candidate,
      verdict: record.body.verdict,
      output: record.body.output,
      rebuttalSeqs,
      standing: record.body.verdict === "FAIL" && rebuttalSeqs.length === 0,
    };
    const current = verdicts.get(view.candidate);
    if (current === undefined) verdicts.set(view.candidate, [view]);
    else current.push(view);
  }

  return { candidates, promotions, verdicts };
}

function viewsFor(facts: Facts, candidate: Hash): readonly VerdictView[] {
  return facts.verdicts.get(candidate) ?? [];
}

/** Every successful verifier verdict for exact candidate bytes, in seq order. */
export function verdictViews(
  records: readonly LogRecord[],
  candidate: Hash,
): readonly VerdictView[] {
  return viewsFor(collectFacts(records), candidate);
}

/** FAILs not cleared by a later rebuttal naming that exact completion. */
export function standingFails(
  records: readonly LogRecord[],
  candidate: Hash,
): readonly VerdictView[] {
  return verdictViews(records, candidate).filter((view) => view.standing);
}

function firstPremiseCycle(
  facts: Facts,
  root: Hash,
): readonly Hash[] | undefined {
  const finished = new Set<Hash>();
  const activeIndex = new Map<Hash, number>();
  const path: Hash[] = [];

  const visit = (candidate: Hash): readonly Hash[] | undefined => {
    const existing = activeIndex.get(candidate);
    if (existing !== undefined) {
      return [...path.slice(existing), candidate];
    }
    if (finished.has(candidate)) return undefined;

    const record = facts.candidates.get(candidate);
    if (record === undefined) {
      finished.add(candidate);
      return undefined;
    }

    activeIndex.set(candidate, path.length);
    path.push(candidate);
    for (const premise of record.body.premises) {
      const cycle = visit(premise);
      if (cycle !== undefined) return cycle;
    }
    path.pop();
    activeIndex.delete(candidate);
    finished.add(candidate);
    return undefined;
  };

  return visit(root);
}

function acceptedAcyclic(
  facts: Facts,
  candidate: Hash,
  memo: Map<Hash, AcceptanceCheck>,
): AcceptanceCheck {
  const known = memo.get(candidate);
  if (known !== undefined) return known;

  const contract = facts.candidates.get(candidate);
  if (contract === undefined) {
    const result: AcceptanceCheck = {
      ok: false,
      candidate,
      blockers: [{ kind: "candidate-missing", candidate }],
    };
    memo.set(candidate, result);
    return result;
  }

  const promotion = facts.promotions.get(candidate);
  const blockers: AcceptanceBlocker[] = [];
  if (promotion === undefined) blockers.push({ kind: "not-promoted" });

  for (const fail of viewsFor(facts, candidate)) {
    if (fail.standing) {
      blockers.push({
        kind: "standing-fail",
        completionSeq: fail.completionSeq,
      });
    }
  }

  for (const premise of contract.body.premises) {
    if (!acceptedAcyclic(facts, premise, memo).ok) {
      blockers.push({ kind: "premise-not-accepted", premise });
    }
  }

  const result: AcceptanceCheck =
    promotion !== undefined && blockers.length === 0
      ? {
          ok: true,
          candidate,
          promotionSeq: promotion.seq,
        }
      : { ok: false, candidate, blockers };
  memo.set(candidate, result);
  return result;
}

function acceptanceFromFacts(facts: Facts, candidate: Hash): AcceptanceCheck {
  if (!facts.candidates.has(candidate)) {
    return {
      ok: false,
      candidate,
      blockers: [{ kind: "candidate-missing", candidate }],
    };
  }

  const cycle = firstPremiseCycle(facts, candidate);
  if (cycle !== undefined) {
    const blockers: AcceptanceBlocker[] = [];
    if (!facts.promotions.has(candidate))
      blockers.push({ kind: "not-promoted" });
    for (const fail of viewsFor(facts, candidate)) {
      if (fail.standing) {
        blockers.push({
          kind: "standing-fail",
          completionSeq: fail.completionSeq,
        });
      }
    }
    blockers.push({ kind: "premise-cycle", cycle });
    return { ok: false, candidate, blockers };
  }

  return acceptedAcyclic(facts, candidate, new Map());
}

/** Derived acceptance of an existing promotion and its internal premises. */
export function acceptanceCheck(
  records: readonly LogRecord[],
  candidate: Hash,
): AcceptanceCheck {
  return acceptanceFromFacts(collectFacts(records), candidate);
}

/** The exact PASS records a promotion would cite, or every current blocker. */
export function promotionCheck(
  records: readonly LogRecord[],
  candidate: Hash,
): PromotionCheck {
  const facts = collectFacts(records);
  const contract = facts.candidates.get(candidate);
  if (contract === undefined) {
    return {
      ok: false,
      candidate,
      blockers: [{ kind: "candidate-missing", candidate }],
    };
  }

  const views = viewsFor(facts, candidate);
  const blockers: PromotionBlocker[] = [];
  const passes: { verifier: string; completionSeq: number }[] = [];

  for (const verifier of contract.body.requiredVerifiers) {
    const pass = views.find(
      (view) => view.verifier === verifier && view.verdict === "PASS",
    );
    if (pass === undefined) blockers.push({ kind: "missing-pass", verifier });
    else passes.push({ verifier, completionSeq: pass.completionSeq });
  }

  for (const fail of views) {
    if (fail.standing) {
      blockers.push({
        kind: "standing-fail",
        verifier: fail.verifier,
        completionSeq: fail.completionSeq,
      });
    }
  }

  const cycle = firstPremiseCycle(facts, candidate);
  if (cycle !== undefined) {
    blockers.push({ kind: "premise-cycle", cycle });
  } else {
    const memo = new Map<Hash, AcceptanceCheck>();
    for (const premise of contract.body.premises) {
      if (!acceptedAcyclic(facts, premise, memo).ok) {
        blockers.push({ kind: "premise-not-accepted", premise });
      }
    }
  }

  return blockers.length === 0
    ? { ok: true, candidate, passes }
    : { ok: false, candidate, blockers };
}
