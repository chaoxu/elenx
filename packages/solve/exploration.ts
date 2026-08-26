import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { estimateTokens } from "@earendil-works/pi-coding-agent";
import {
  createCampaign,
  defineTool,
  deriveCandidateStatus,
  openCampaign,
  returnedToolSubmission,
  type Campaign,
  type Entry,
  type EntryId,
  type Json,
  type Reader,
} from "elenx";
import {
  builtinPi,
  piRequest,
  piStoredResult,
  runPi,
  type PiRunOptions,
} from "elenx/pi";
import { z } from "zod";

import {
  actionSchema,
  actionTool,
  applicationId,
  assessment,
  auditTool,
  auditorMethod,
  candidateEnvelope,
  claimIdSchema,
  comparisonAssessmentFor,
  coordinatorLabel,
  declaredEvidenceDAG,
  admissionAuditLabel,
  deliveryArtifact,
  deliveryAudit,
  deliveryAssemblyLabel,
  deliveryAuditLabel,
  deliverySubmission,
  deliveryTool,
  explorerLabel,
  explorerReportFor,
  finalProofAuditFor,
  parseCampaign,
  protocolName,
  reconstructionLabel,
  renderTask,
  reportTool,
  reconstruction,
  reconstructionTool,
  resolutionAuditLabel,
  settingsSchema,
  type Action,
  type Assessment,
  type CandidateEnvelope,
  type ClaimId,
  type ClaimSupportBundle,
  type DeclaredEvidenceDAG,
  type DeliveryArtifact,
  type DeliveryAssemblyInput,
  type DeliveryAuditInput,
  type ExplorerReport,
  type GuidanceModule,
  type NamedRuntimeProfile,
  type ResolvedGuidance,
  type Reconstruction,
  type ResolutionAuditInput,
  type RouteId,
  type RuntimeProfile,
  type Settings,
  type Task,
  type VerifierRuntimeProfile,
} from "./exploration-protocol";
import {
  CallFailure,
  DEFAULT_CALL_FAILURE_RETRY,
  selectModel,
  withCoordinatorLock,
  type PreparedPiOptions,
  type SolveDependencies,
  type SolveModels,
} from "./runtime";
import {
  directVerifier,
  normalizeVerifierSubmission,
  type PremiseInventory,
  type VerifierToolSubmission,
  type VerifierSubmission,
} from "./verifiers";
import {
  admissionAuditDescription,
  admissionAuditSystem,
  admissionAuditSubmissionFor,
  normalizeAdmissionAuditSubmission,
  type AdmissionTarget,
  type ClaimPremiseInventory,
} from "./verifiers/admission-audit";
import {
  comparisonPrompt,
  comparisonSystem,
  reconstructionPrompt,
  reconstructionSystem,
} from "./verifiers/reconstruction";
import { templateAudit } from "./verifiers/template";
import {
  deliveryAssemblyPrompt,
  deliveryAssemblySystem,
  deliveryAuditPrompt,
  deliveryAuditSystem,
} from "./verifiers/delivery";
import {
  mergeSourceAudit,
  runCodexSourceSearch,
  sourceAuditRequestFor,
  sourceSearchResultFor,
  type SourceAuditSubmission,
  type SourceAuditRequest,
} from "./verifiers/source-audit";
import {
  offlinePremiseFinding,
  premiseDefectsForCoordinator,
  premiseOutcomesForCoordinator,
  premiseSubmissionFor,
  premiseVerdictFor,
  type PremiseSubmission,
} from "./verifiers/premise-audit";

export const settings = settingsSchema;
export type { Settings } from "./exploration-protocol";

export interface Report {
  readonly outcome:
    "solved" | "delivery-failure" | "paused" | "call-failure" | "interrupted";
  readonly phase: string;
  readonly resolution?: EntryId;
  readonly resolutionLabel?: string;
  readonly delivery?: EntryId;
  readonly call?: EntryId;
  readonly reason?: string;
}

const startRequest = z.strictObject({
  problem: z.string().min(1),
  completionCriteria: z.string().min(1),
  campaignPath: z.string().min(1),
  settings: settingsSchema,
});
const resumeRequest = z.strictObject({
  campaignPath: z.string().min(1),
  settings: settingsSchema,
});

export async function start(
  input: z.input<typeof startRequest>,
  dependencies: SolveDependencies = {},
): Promise<Report> {
  const request = startRequest.parse(input);
  const models = dependencies.models ?? builtinPi();
  const task = freezeTask(request, models);
  const initialTokens = estimatedExplorerContextTokens(task, emptyState());
  if (initialTokens > task.maxContextTokens) {
    throw new Error(
      `initial explorer context estimate ${initialTokens} exceeds maxContextTokens ${task.maxContextTokens}`,
    );
  }
  return withCoordinatorLock(request.campaignPath, () => {
    const campaign = createCampaign(request.campaignPath, applicationId, task);
    return runCampaign(campaign, task, { ...dependencies, models });
  });
}

export async function resume(
  input: z.input<typeof resumeRequest>,
  dependencies: SolveDependencies = {},
): Promise<Report> {
  const request = resumeRequest.parse(input);
  const models = dependencies.models ?? builtinPi();
  return withCoordinatorLock(request.campaignPath, () => {
    const campaign = openCampaign(request.campaignPath);
    let task: Task;
    try {
      task = parseCampaign(campaign.records()[0]).task;
      if (
        !isDeepStrictEqual(
          runtimeSettings(task),
          freezeSettings(request.settings, models),
        )
      ) {
        throw new Error("settings disagree with the frozen campaign settings");
      }
    } catch (error) {
      campaign.close();
      throw error;
    }
    return runCampaign(campaign, task, { ...dependencies, models });
  });
}

function freezeTask(
  request: z.output<typeof startRequest>,
  models: SolveModels,
): Task {
  return {
    protocol: protocolName,
    problem: request.problem,
    completionCriteria: request.completionCriteria,
    ...freezeSettings(request.settings, models),
  };
}

function freezeSettings(value: Settings, models: SolveModels) {
  return {
    memory: value.memory,
    maxContextTokens: value.maxContextTokens,
    guidance: resolveGuidance(value),
    coordinator: resolveProfile(models, value.coordinator),
    explorer: resolveProfile(models, value.explorer),
    admissionAuditors: value.admissionAuditors.map((profile) =>
      resolveProfile(models, profile),
    ),
    resolutionAuditors: value.resolutionAuditors.map((profile) =>
      resolveProfile(models, profile),
    ),
  } as const;
}

const guidanceMeta =
  "Guidance is strategy advice, not mathematical evidence, and cannot change the goal, completion criteria, or audit requirements.";

function resolveGuidance(
  settings: Pick<
    Settings,
    "memory" | "explorerGuidance" | "coordinatorGuidance"
  >,
): ResolvedGuidance {
  const modules = (
    defaults: readonly string[],
    user: readonly string[],
  ): GuidanceModule[] => {
    const resolved = [
      ...defaults.map((text) => ({ origin: "default" as const, text })),
      ...user.map((text) => ({ origin: "user" as const, text })),
    ];
    return resolved.length === 0
      ? resolved
      : [{ origin: "default" as const, text: guidanceMeta }, ...resolved];
  };
  const conditional = settings.memory !== "none";
  return {
    explorer: modules(
      conditional ? [conditionalEvidenceNudge.explorer] : [],
      settings.explorerGuidance,
    ),
    coordinator: modules(
      conditional ? [conditionalEvidenceNudge.coordinator] : [],
      settings.coordinatorGuidance,
    ),
  };
}

function runtimeSettings(task: Task) {
  const { protocol, problem, completionCriteria, ...settings } = task;
  void protocol;
  void problem;
  void completionCriteria;
  return settings;
}

function resolveProfile<P extends Settings["coordinator"]>(
  models: SolveModels,
  profile: P,
): P & { readonly api: string; readonly baseUrl: string } {
  const model = selectModel(models, {
    provider: profile.provider,
    modelId: profile.model,
  });
  return { ...profile, api: model.api, baseUrl: model.baseUrl };
}

interface ClaimRevision {
  readonly type: "claim";
  readonly id: ClaimId;
  readonly statement: string;
  readonly originCall: EntryId;
  readonly dependsOn: readonly ClaimId[];
  readonly replaces?: ClaimId;
  readonly droppedBy?: ClaimDrop;
}

interface RouteRecord {
  readonly type: "route";
  readonly id: RouteId;
  readonly attempt: string;
  readonly outcome: string;
  readonly evidenceClaims: readonly ClaimId[];
  readonly retryCondition?: string | undefined;
  readonly originCall: EntryId;
  readonly replaces?: RouteId;
  readonly droppedBy?: ClaimDrop;
}

type AdmissionItem = ClaimRevision | RouteRecord;

interface ClaimDrop {
  readonly action: EntryId;
  readonly source: EntryId;
}

interface ExplorerRecord {
  readonly call: EntryId;
  readonly value: ExplorerReport;
  readonly baseContextDigest: string;
  readonly priorIdenticalContexts: number;
}

interface AdmissionAuditRecord {
  readonly call: EntryId;
  readonly batch: EntryId;
  readonly target: ClaimId | RouteId;
  readonly targetKind: "claim" | "route";
  readonly auditor: string;
  readonly verdict: Assessment["verdict"];
  readonly report: string;
  readonly premises?: ClaimPremiseInventory;
  readonly mathematicalFinding?: string;
}

interface VerdictRecord {
  readonly verifier: string;
  readonly call: EntryId;
  readonly record: EntryId;
  readonly verdict: Assessment["verdict"];
  readonly report: string;
  readonly audit?: Json;
  readonly premises?: PremiseInventory;
  readonly onlineSource?: boolean;
  readonly offlinePremiseReport?: string;
}

interface CandidateRecord {
  readonly id: EntryId;
  readonly envelope: CandidateEnvelope;
}

interface ReconstructionRecord extends Reconstruction {
  readonly call: EntryId;
  readonly settled: EntryId;
}

interface CandidateFeedback extends CandidateRecord {
  readonly verdicts: readonly VerdictRecord[];
  readonly reconstruction: ReconstructionRecord | undefined;
}

interface DeliveryRecord {
  readonly id: EntryId;
  readonly envelope: DeliveryArtifact;
  readonly verdict?: VerdictRecord;
}

type CandidateGate =
  | {
      readonly gate: "verifier";
      readonly name: string;
      readonly state: Assessment["verdict"] | "pending" | "not-run";
      readonly call?: EntryId;
    }
  | {
      readonly gate: "reconstruction";
      readonly state: "complete" | "pending" | "not-run";
      readonly call?: EntryId;
    };

interface State {
  readonly claims: Map<ClaimId, ClaimRevision>;
  readonly routes: Map<RouteId, RouteRecord>;
  readonly lifecycle: Map<ClaimId | RouteId, "provisional" | "live">;
  source: EntryId | undefined;
  readonly explorations: ExplorerRecord[];
  readonly admissionAudits: AdmissionAuditRecord[];
  readonly candidates: CandidateFeedback[];
  readonly deliveries: DeliveryRecord[];
}

type Cursor =
  | {
      readonly kind: "coordinator";
      readonly label: string;
      readonly after: EntryId;
      readonly state: State;
    }
  | {
      readonly kind: "explorer";
      readonly label: string;
      readonly after: EntryId;
      readonly state: State;
    }
  | {
      readonly kind: "candidate";
      readonly after: EntryId;
      readonly report: ExplorerRecord;
      readonly state: State;
    };

type CandidateModelPhase = {
  readonly label: string;
  readonly after: EntryId;
  readonly candidate: CandidateRecord;
  readonly state: State;
} & (
  | {
      readonly kind: "verifier";
      readonly verifier: VerifierRuntimeProfile;
      readonly premises: PremiseInventory;
    }
  | {
      readonly kind: "source-audit";
      readonly request: SourceAuditRequest;
    }
  | {
      readonly kind: "reconstruction";
      readonly verifier: VerifierRuntimeProfile;
      readonly premises: PremiseInventory;
      readonly declaredEvidence: DeclaredEvidenceDAG;
    }
  | {
      readonly kind: "comparison";
      readonly verifier: VerifierRuntimeProfile;
      readonly reconstruction: ReconstructionRecord;
      readonly premises: PremiseInventory;
      readonly declaredEvidence: DeclaredEvidenceDAG;
    }
);

interface AdmissionAuditPhase {
  readonly kind: "admission-audit";
  readonly label: string;
  readonly after: EntryId;
  readonly items: readonly AdmissionItem[];
  readonly auditor: NamedRuntimeProfile;
  readonly state: State;
}

interface DeliveryAssemblyPhase {
  readonly kind: "delivery-assembly";
  readonly label: string;
  readonly after: EntryId;
  readonly candidate: CandidateRecord;
  readonly premises: PremiseInventory;
  readonly state: State;
}

interface DeliveryAuditPhase {
  readonly kind: "delivery-audit";
  readonly label: string;
  readonly candidate: DeliveryRecord;
  readonly premises: PremiseInventory;
  readonly state: State;
}

type ModelPhase =
  | Exclude<Cursor, { readonly kind: "candidate" }>
  | AdmissionAuditPhase
  | CandidateModelPhase
  | DeliveryAssemblyPhase
  | DeliveryAuditPhase;

interface StructuredCall<S extends z.ZodType = z.ZodType> {
  readonly profile: RuntimeProfile;
  readonly prepareKey: string;
  readonly system: string;
  readonly prompt: string;
  readonly tool: string;
  readonly description: string;
  readonly schema: S;
}

type Phase =
  | ModelPhase
  | {
      readonly kind: "create-candidate";
      readonly envelope: CandidateEnvelope;
      readonly state: State;
    }
  | {
      readonly kind: "record-verdict";
      readonly candidate: EntryId;
      readonly call: EntryId;
      readonly submission: VerifierSubmission;
      readonly state: State;
    }
  | {
      readonly kind: "create-delivery";
      readonly envelope: DeliveryArtifact;
      readonly state: State;
    }
  | {
      readonly kind: "delivery-failed";
      readonly resolution: EntryId;
      readonly delivery: EntryId;
      readonly verdict: VerdictRecord;
      readonly state: State;
    }
  | {
      readonly kind: "solved";
      readonly candidate: EntryId;
      readonly delivery: EntryId;
      readonly state: State;
    };

function emptyState(): State {
  return {
    claims: new Map(),
    routes: new Map(),
    lifecycle: new Map(),
    source: undefined,
    explorations: [],
    admissionAudits: [],
    candidates: [],
    deliveries: [],
  };
}

// Sleep in one-second slices so a pause request or abort cuts the retry
// backoff short instead of stalling the operator.
async function interruptibleDelay(
  totalMs: number,
  dependencies: SolveDependencies,
): Promise<void> {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    if (dependencies.pauseRequested?.() === true) return;
    if (dependencies.signal?.aborted === true) return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1_000, until - Date.now())),
    );
  }
}

function derivePhase(reader: Reader, task: Task): Phase {
  const records = reader.records();
  let cursor: Cursor = {
    kind: "explorer",
    label: explorerLabel(),
    after: records[0]?.seq ?? 0,
    state: emptyState(),
  };
  for (
    let transitions = 0;
    transitions <= records.length + 1;
    transitions += 1
  ) {
    const state: State = cursor.state;
    if (cursor.kind === "coordinator") {
      const turn = coordinatorStructuredCall(task, state);
      const action:
        | {
            readonly call: EntryId;
            readonly settled: EntryId;
            readonly value: Action;
          }
        | undefined = findSubmission(records, {
        label: cursor.label,
        after: cursor.after,
        turn,
      });
      if (action === undefined) return cursor;
      const items = applyAction(state, action.value, action.call);
      if (items.length === 0 || task.admissionAuditors.length === 0) {
        activateItems(state, items);
        cursor = explorerAfterBatch(state, action.call, action.settled);
        continue;
      }
      ensureAdmissionAuditFits(task, state, items);
      let after: EntryId = action.settled;
      let lastReviewCall: EntryId | undefined;
      let allPass = true;
      for (const auditor of task.admissionAuditors) {
        const label = admissionAuditLabel(
          action.call,
          auditor.name,
          items.map(({ id }) => id),
        );
        const pending: AdmissionAuditPhase = {
          kind: "admission-audit",
          label,
          after,
          items,
          auditor,
          state,
        };
        const review = findSubmission(records, {
          label,
          after,
          turn: admissionAuditStructuredCall(task, pending),
        });
        if (review === undefined) return pending;
        const normalized = normalizeAdmissionAuditSubmission(review.value);
        for (const item of normalized.assessments) {
          state.admissionAudits.push({
            call: review.call,
            batch: action.call,
            auditor: auditor.name,
            ...item,
          });
          if (item.verdict !== "PASS") allPass = false;
        }
        lastReviewCall = review.call;
        after = review.settled;
      }
      if (allPass) {
        activateItems(state, items);
        cursor = explorerAfterBatch(state, action.call, after);
        continue;
      }
      if (lastReviewCall === undefined) {
        throw new Error("admission audit batch is empty");
      }
      state.source = lastReviewCall;
      cursor = {
        kind: "coordinator",
        label: coordinatorLabel(lastReviewCall),
        after,
        state,
      };
      continue;
    }
    if (cursor.kind === "explorer") {
      const turn = explorerStructuredCall(task, state);
      const report:
        | {
            readonly call: EntryId;
            readonly settled: EntryId;
            readonly value: ExplorerReport;
          }
        | undefined = findSubmission(records, {
        label: cursor.label,
        after: cursor.after,
        turn,
      });
      if (report === undefined) return cursor;
      supportBundleFor(report.value.citedClaims, state, {
        requireLive: true,
      });
      const context = explorerContextHistory(
        state,
        baseExplorerRequest(task, state),
      );
      const record: ExplorerRecord = {
        call: report.call,
        value: report.value,
        ...context,
      };
      state.explorations.push(record);
      state.source = record.call;
      cursor = !record.value.claimsComplete
        ? {
            kind: "coordinator",
            label: coordinatorLabel(record.call),
            after: report.settled,
            state,
          }
        : { kind: "candidate", after: report.settled, report: record, state };
      continue;
    }
    const envelope = envelopeFor(task, cursor.report);
    const candidate = findCandidate(reader, task, envelope, cursor.after);
    if (candidate === undefined) {
      return { kind: "create-candidate", envelope, state };
    }
    const verdicts: VerdictRecord[] = [];
    let after = candidate.id;
    let reconstructed: ReconstructionRecord | undefined;
    for (const verifier of task.resolutionAuditors) {
      const premises =
        verdicts.find(({ verifier }) => verifier === "premise-audit")
          ?.premises ?? [];
      const outcome = resolveGate(
        records,
        task,
        candidate,
        verifier,
        after,
        premises,
        state,
      );
      reconstructed = outcome.reconstruction ?? reconstructed;
      if ("pending" in outcome) {
        state.candidates.push(
          candidateFeedback(candidate, verdicts, reconstructed),
        );
        return outcome.pending;
      }
      verdicts.push(outcome.verdict);
      after = outcome.verdict.record;
      if (outcome.verdict.verdict !== "PASS") break;
    }
    const failed = verdicts.some(({ verdict }) => verdict !== "PASS");
    const source = verdicts.at(-1);
    if (source === undefined) {
      throw new Error("candidate has no verifier result");
    }
    state.source = source.call;
    state.candidates.push(
      candidateFeedback(candidate, verdicts, reconstructed),
    );
    if (!failed) {
      if (!deriveCandidateStatus(records, candidate.id).verified) {
        throw new Error("resolution verifier contract is unsatisfied");
      }
      const premises =
        verdicts.find(({ verifier }) => verifier === "premise-audit")
          ?.premises ?? [];
      return resolveDeliveryPhase(
        reader,
        records,
        task,
        candidate,
        after,
        premises,
        state,
      );
    }
    cursor = {
      kind: "coordinator",
      label: coordinatorLabel(source.call),
      after: source.record,
      state,
    };
  }
  throw new Error("exploration campaign graph contains a cycle");
}

function resolveDeliveryPhase(
  reader: Reader,
  records: readonly Entry[],
  task: Task,
  resolution: CandidateRecord,
  after: EntryId,
  premises: PremiseInventory,
  state: State,
): Phase {
  const assembly: DeliveryAssemblyPhase = {
    kind: "delivery-assembly",
    label: deliveryAssemblyLabel(),
    after,
    candidate: resolution,
    premises,
    state,
  };
  const submission = findSubmission(records, {
    label: assembly.label,
    after,
    candidate: resolution.id,
    turn: deliveryAssemblyStructuredCall(task, assembly),
  });
  if (submission === undefined) return assembly;
  const envelope = deliveryArtifact.parse({
    protocol: `${applicationId}/${protocolName}/delivery/v1`,
    resolution: resolution.id,
    answer: submission.value.answer,
  });
  const delivery = findDeliveryCandidate(reader, envelope, submission.settled);
  if (delivery === undefined) {
    return {
      kind: "create-delivery",
      envelope,
      state,
    };
  }
  const pending: DeliveryAuditPhase = {
    kind: "delivery-audit",
    label: deliveryAuditLabel(),
    candidate: delivery,
    premises,
    state,
  };
  const outcome = requireVerdict(
    records,
    delivery.id,
    pending.label,
    "delivery-audit",
    pending,
    delivery.id,
    deliveryAuditStructuredCall(task, pending),
  );
  if ("kind" in outcome) return outcome;
  state.deliveries.push({ ...delivery, verdict: outcome });
  if (outcome.verdict !== "PASS") {
    return {
      kind: "delivery-failed",
      resolution: resolution.id,
      delivery: delivery.id,
      verdict: outcome,
      state,
    };
  }
  if (!deriveCandidateStatus(records, delivery.id).verified) {
    throw new Error("delivery verifier contract is unsatisfied");
  }
  return {
    kind: "solved",
    candidate: resolution.id,
    delivery: delivery.id,
    state,
  };
}

function applyAction(
  state: State,
  action: Action,
  call: EntryId,
): AdmissionItem[] {
  const source = coordinatorSource(state);
  const items: AdmissionItem[] = [];
  for (const change of action.changes) {
    if (change.action === "drop_claim" || change.action === "drop_route") {
      const item = requiredItem(
        state,
        change.action === "drop_claim" ? change.claim : change.route,
      );
      state.lifecycle.delete(item.id);
      const updated = {
        ...item,
        droppedBy: { action: call, source },
      };
      if (updated.type === "claim") state.claims.set(updated.id, updated);
      else state.routes.set(updated.id, updated);
      continue;
    }
    if (change.action === "retain_claim" || change.action === "retain_route") {
      const id = change.action === "retain_claim" ? change.claim : change.route;
      requiredItem(state, id);
      state.lifecycle.set(id, "live");
      continue;
    }
    if (change.action === "revise_claim" || change.action === "revise_route") {
      requiredItem(state, change.replaces);
      state.lifecycle.delete(change.replaces);
    }
    if (change.action === "add_claim" || change.action === "revise_claim") {
      const claim: ClaimRevision = {
        type: "claim",
        id: change.claim,
        statement: change.statement,
        originCall: source,
        dependsOn: change.dependsOn,
        ...(change.action === "revise_claim"
          ? { replaces: change.replaces }
          : {}),
      };
      state.claims.set(claim.id, claim);
      state.lifecycle.set(claim.id, "provisional");
      items.push(claim);
      continue;
    }
    const route: RouteRecord = {
      type: "route",
      id: change.route,
      attempt: change.attempt,
      outcome: change.outcome,
      evidenceClaims: change.evidenceClaims,
      ...(change.retryCondition === undefined
        ? {}
        : { retryCondition: change.retryCondition }),
      originCall: source,
      ...(change.action === "revise_route"
        ? { replaces: change.replaces }
        : {}),
    };
    state.routes.set(route.id, route);
    state.lifecycle.set(route.id, "provisional");
    items.push(route);
  }
  return items;
}

function requiredClaim(state: State, id: ClaimId): ClaimRevision {
  const claim = state.claims.get(id);
  if (claim === undefined) throw new Error(`claim is unavailable: ${id}`);
  return claim;
}

function requiredItem(state: State, id: ClaimId | RouteId): AdmissionItem {
  const item = claimIdSchema.safeParse(id).success
    ? state.claims.get(id as ClaimId)
    : state.routes.get(id as RouteId);
  if (item === undefined)
    throw new Error(`claim or route is unavailable: ${id}`);
  return item;
}

function activateItems(state: State, items: readonly AdmissionItem[]): void {
  for (const { id } of items) {
    state.lifecycle.set(id, "live");
  }
}

function explorerAfterBatch(
  state: State,
  batch: EntryId,
  after: EntryId,
): Extract<Cursor, { readonly kind: "explorer" }> {
  if ([...state.lifecycle.values()].includes("provisional")) {
    throw new Error(
      "unresolved provisional claim or route cannot reach exploration",
    );
  }
  return {
    kind: "explorer",
    label: explorerLabel(batch),
    after,
    state,
  };
}

function candidateFeedback(
  candidate: CandidateRecord,
  verdicts: readonly VerdictRecord[],
  reconstruction?: ReconstructionRecord,
): CandidateFeedback {
  return {
    ...candidate,
    verdicts,
    reconstruction,
  };
}

function candidateGates(
  task: Task,
  verdicts: readonly VerdictRecord[],
  reconstruction: ReconstructionRecord | undefined,
): readonly CandidateGate[] {
  const verdict = (record: VerdictRecord | undefined, blocked = false) =>
    record === undefined
      ? { state: blocked ? ("not-run" as const) : ("pending" as const) }
      : { state: record.verdict, call: record.call };
  const direct = task.resolutionAuditors.filter(
    ({ kind }) => kind !== "reconstruction",
  );
  const directFailed = verdicts
    .filter(({ verifier }) => verifier !== "reconstruction")
    .some(({ verdict }) => verdict !== "PASS");
  let blocked = false;
  const directGates: CandidateGate[] = direct.map((auditor) => {
    const name = auditorMethod(auditor);
    const record = verdicts.find(({ verifier }) => verifier === name);
    const gate = {
      gate: "verifier" as const,
      name,
      ...verdict(record, blocked),
    };
    if (record !== undefined && record.verdict !== "PASS") blocked = true;
    return gate;
  });
  if (!task.resolutionAuditors.some(({ kind }) => kind === "reconstruction")) {
    return directGates;
  }
  return [
    ...directGates,
    {
      gate: "reconstruction" as const,
      ...(reconstruction === undefined
        ? { state: directFailed ? ("not-run" as const) : ("pending" as const) }
        : { state: "complete" as const, call: reconstruction.call }),
    },
    {
      gate: "verifier" as const,
      name: "reconstruction" as const,
      ...verdict(
        verdicts.find(({ verifier }) => verifier === "reconstruction"),
        directFailed,
      ),
    },
  ];
}

function actionFor(state: State, task: Task) {
  const schema = actionSchema({
    memory: task.memory,
    nextClaim: nextClaimId(state),
    nextRoute: nextRouteId(state),
    claims: [...state.claims.values()]
      .filter(({ id }) => state.lifecycle.has(id))
      .map(({ id, dependsOn }) => ({
        id,
        dependsOn,
        provisional: state.lifecycle.get(id) === "provisional",
        retainable: state.admissionAudits
          .filter((audit) => audit.target === id)
          .every((audit) => audit.verdict === "PASS"),
      })),
    routes: [...state.routes.values()]
      .filter(({ id }) => state.lifecycle.has(id))
      .map(({ id, evidenceClaims }) => ({
        id,
        evidenceClaims,
        provisional: state.lifecycle.get(id) === "provisional",
        retainable: state.admissionAudits
          .filter((audit) => audit.target === id)
          .every((audit) => audit.verdict === "PASS"),
      })),
  });
  return schema.superRefine((action, context) => {
    const projected = cloneState(state);
    try {
      const items = applyAction(projected, action, coordinatorSource(state));
      if (task.admissionAuditors.length > 0 && items.length > 0) {
        ensureAdmissionAuditFits(task, projected, items);
        assumePassingReviews(projected, items, task.admissionAuditors);
      }
      activateItems(projected, items);
      if (!explorationAllowed(task, projected)) {
        throw new Error(
          "the complete batch must leave no dangling claims or routes and must fit the next explorer context",
        );
      }
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : String(error),
        path: ["changes"],
      });
    }
  });
}

function cloneState(state: State): State {
  return {
    claims: new Map(state.claims),
    routes: new Map(state.routes),
    lifecycle: new Map(state.lifecycle),
    source: state.source,
    explorations: [...state.explorations],
    admissionAudits: [...state.admissionAudits],
    candidates: [...state.candidates],
    deliveries: [...state.deliveries],
  };
}

function assumePassingReviews(
  state: State,
  items: readonly AdmissionItem[],
  reviewers: readonly NamedRuntimeProfile[],
): void {
  for (const item of items) {
    for (const { name: reviewer } of reviewers) {
      state.admissionAudits.push({
        call: 1,
        batch: 1,
        target: item.id,
        targetKind: item.type,
        auditor: reviewer,
        verdict: "PASS",
        report: "projected PASS",
      });
    }
  }
}

function nextClaimId(state: State): ClaimId {
  return `claim-${state.claims.size + 1}`;
}

function nextRouteId(state: State): RouteId {
  return `route-${state.routes.size + 1}`;
}

function explorationAllowed(task: Task, state: State): boolean {
  return (
    danglingItems(state).size === 0 &&
    estimatedExplorerContextTokens(task, state) <= task.maxContextTokens
  );
}

function estimatedExplorerContextTokens(task: Task, state: State): number {
  const request = baseExplorerRequest(task, state);
  return estimatedStructuredContextTokens(
    request.system,
    request.prompt,
    reportTool,
    request.description,
    request.schema,
  );
}

function estimatedStructuredContextTokens(
  system: string,
  prompt: string,
  name: string,
  description: string,
  schema: z.ZodType,
): number {
  return [
    system,
    prompt,
    JSON.stringify({ name, description, input: z.toJSONSchema(schema) }),
  ].reduce(
    (total, text) =>
      total + estimateTokens({ role: "user", content: text, timestamp: 0 }),
    0,
  );
}

function danglingItems(state: State): ReadonlySet<ClaimId | RouteId> {
  const dangling = new Set<ClaimId | RouteId>();
  for (const claim of state.claims.values()) {
    if (
      state.lifecycle.get(claim.id) === "live" &&
      claim.dependsOn.some(
        (dependency) =>
          state.lifecycle.get(dependency) !== "live" ||
          dangling.has(dependency),
      )
    ) {
      dangling.add(claim.id);
    }
  }
  for (const route of state.routes.values()) {
    if (
      state.lifecycle.get(route.id) === "live" &&
      route.evidenceClaims.some(
        (claim) => state.lifecycle.get(claim) !== "live" || dangling.has(claim),
      )
    ) {
      dangling.add(route.id);
    }
  }
  return dangling;
}

function coordinatorSource(state: State): EntryId {
  if (state.source === undefined) {
    throw new Error("coordinator has no completed source");
  }
  return state.source;
}

function visibleClaims(state: State): ReadonlySet<ClaimId> {
  return new Set(
    [...state.claims.values()]
      .filter(({ id }) => state.lifecycle.get(id) === "live")
      .map(({ id }) => id),
  );
}

function envelopeFor(task: Task, report: ExplorerRecord): CandidateEnvelope {
  if (!report.value.claimsComplete) {
    throw new Error("candidate source does not claim completion");
  }
  return candidateEnvelope.parse({
    protocol: `${applicationId}/${protocolName}/resolution/v1`,
    problem: task.problem,
    completionCriteria: task.completionCriteria,
    citedClaims: report.value.citedClaims,
    newArgument: report.value.rawReport,
    sourceReport: report.call,
  });
}

function supportBundleFor(
  ids: readonly ClaimId[],
  state: State,
  options: {
    readonly requireLive?: boolean;
    readonly mathematicalOnly?: boolean;
  } = {},
): ClaimSupportBundle {
  const { requireLive = false, mathematicalOnly = false } = options;
  const claims: ClaimRevision[] = [];
  const included = new Set<ClaimId>();
  const visiting = new Set<ClaimId>();
  const artifactCalls = new Set<EntryId>();
  const include = (id: ClaimId, requireAvailable = requireLive): void => {
    const claim = requiredClaim(state, id);
    if (requireAvailable && state.lifecycle.get(id) !== "live") {
      throw new Error(`resolution claim is unavailable: ${id}`);
    }
    if (included.has(id)) return;
    if (visiting.has(id)) throw new Error("claim dependency cycle");
    visiting.add(id);
    for (const dependency of claim.dependsOn) {
      include(dependency, requireAvailable);
    }
    visiting.delete(id);
    included.add(id);
    claims.push(claim);
    artifactCalls.add(claim.originCall);
  };
  for (const id of ids) include(id);
  return {
    claims: claims.map(
      ({ id, statement, dependsOn, originCall, replaces }) => ({
        id,
        statement,
        dependsOn,
        originCall,
        ...(replaces === undefined ? {} : { replaces }),
      }),
    ),
    artifacts: [...artifactCalls].map((call) => ({
      call,
      artifact: mathematicalOnly
        ? mathematicalSourceArtifact(state, call)
        : sourceArtifact(state, call),
    })),
  };
}

function resolutionAuditInput(
  candidate: CandidateRecord,
  state: State,
  premises: PremiseInventory = [],
): ResolutionAuditInput {
  const support = supportBundleFor(candidate.envelope.citedClaims, state, {
    requireLive: true,
    mathematicalOnly: true,
  });
  return {
    ...candidate,
    support,
    declaredEvidence: declaredEvidenceDAG.parse({
      roots: candidate.envelope.citedClaims,
      claims: support.claims.map(({ id, statement, dependsOn }) => ({
        id,
        statement,
        dependsOn,
      })),
      sourcedPremises: premises.flatMap((premise) =>
        premise.standing === "SOURCED"
          ? [{ statement: premise.statement }]
          : [],
      ),
    }),
  };
}

function findCandidate(
  reader: Reader,
  task: Task,
  envelope: CandidateEnvelope,
  after: EntryId,
): CandidateRecord | undefined {
  const bytes = encode(envelope);
  const required = requiredVerifierLabels(task);
  const matches = reader.records().flatMap((entry) => {
    if (
      entry.kind !== "candidate" ||
      entry.seq <= after ||
      !isDeepStrictEqual(reader.material(entry.seq), bytes)
    ) {
      return [];
    }
    if (!isDeepStrictEqual(entry.requiredVerifiers, required)) {
      throw new Error("candidate verifier contract changed");
    }
    return [{ id: entry.seq, envelope }];
  });
  if (matches.length > 1) throw new Error("duplicate exploration candidate");
  return matches[0];
}

function findDeliveryCandidate(
  reader: Reader,
  envelope: DeliveryArtifact,
  after: EntryId,
): DeliveryRecord | undefined {
  const bytes = encode(envelope);
  const required = [deliveryAuditLabel()];
  const matches = reader.records().flatMap((entry) => {
    if (
      entry.kind !== "candidate" ||
      entry.seq <= after ||
      !isDeepStrictEqual(reader.material(entry.seq), bytes)
    ) {
      return [];
    }
    if (!isDeepStrictEqual(entry.requiredVerifiers, required)) {
      throw new Error("delivery verifier contract changed");
    }
    return [{ id: entry.seq, envelope }];
  });
  if (matches.length > 1) throw new Error("duplicate delivery candidate");
  return matches[0];
}

function requiredVerifierLabels(task: Task): string[] {
  return task.resolutionAuditors
    .map((auditor) => resolutionAuditLabel(auditorMethod(auditor)))
    .sort();
}

type GateOutcome = {
  readonly reconstruction?: ReconstructionRecord;
} & ({ readonly verdict: VerdictRecord } | { readonly pending: Phase });

function resolveReconstructionGate(
  records: readonly Entry[],
  task: Task,
  candidate: CandidateRecord,
  verifier: Task["resolutionAuditors"][number],
  after: EntryId,
  premises: PremiseInventory,
  state: State,
): GateOutcome {
  const declaredEvidence = resolutionAuditInput(
    candidate,
    state,
    premises,
  ).declaredEvidence;
  let deriveAfter = after;
  let reconstruction: ReconstructionRecord | undefined;
  for (const attempt of [1, 2] as const) {
    const derivation: Extract<
      CandidateModelPhase,
      { readonly kind: "reconstruction" }
    > = {
      kind: "reconstruction",
      label: reconstructionLabel(attempt),
      after: deriveAfter,
      candidate,
      verifier,
      premises,
      declaredEvidence,
      state,
    };
    const submission = findSubmission(records, {
      label: derivation.label,
      after: deriveAfter,
      candidate: candidate.id,
      turn: reconstructionStructuredCall(task, derivation),
    });
    if (submission === undefined) {
      return reconstruction === undefined
        ? { pending: derivation }
        : { pending: derivation, reconstruction };
    }
    reconstruction = {
      call: submission.call,
      settled: submission.settled,
      ...submission.value,
    };
    const comparison: Extract<
      CandidateModelPhase,
      { readonly kind: "comparison" }
    > = {
      kind: "comparison",
      label: resolutionAuditLabel("reconstruction"),
      after: reconstruction.settled,
      candidate,
      verifier,
      reconstruction,
      premises,
      declaredEvidence,
      state,
    };
    const retryDerive =
      attempt === 1
        ? firstCallSeq(
            records,
            reconstructionLabel(2),
            candidate.id,
            reconstruction.settled,
          )
        : undefined;
    const verdict = requireVerdict(
      records,
      candidate.id,
      comparison.label,
      "reconstruction",
      comparison,
      reconstruction.settled,
      comparisonStructuredCall(task, comparison),
      retryDerive,
    );
    if ("kind" in verdict) return { pending: verdict, reconstruction };
    if (attempt === 2 || verdict.verdict !== "INCONCLUSIVE") {
      return { verdict, reconstruction };
    }
    deriveAfter = verdict.record;
  }
  throw new Error("reconstruction attempts exhausted without a verdict");
}

function resolveGate(
  records: readonly Entry[],
  task: Task,
  candidate: CandidateRecord,
  verifier: Task["resolutionAuditors"][number],
  after: EntryId,
  premises: PremiseInventory,
  state: State,
): GateOutcome {
  if (verifier.kind === "reconstruction") {
    return resolveReconstructionGate(
      records,
      task,
      candidate,
      verifier,
      after,
      premises,
      state,
    );
  }
  const method = auditorMethod(verifier);
  const label = resolutionAuditLabel(method);
  const pending = {
    kind: "verifier" as const,
    label,
    after,
    candidate,
    verifier,
    premises,
    state,
  };
  const verdict =
    verifier.kind === "premise-audit"
      ? requirePremiseVerdict(records, task, candidate, verifier, pending)
      : requireVerdict(
          records,
          candidate.id,
          label,
          method,
          pending,
          after,
          assessmentAuditStructuredCall(task, pending),
        );
  return "kind" in verdict ? { pending: verdict } : { verdict };
}

function requirePremiseVerdict(
  records: readonly Entry[],
  task: Task,
  candidate: CandidateRecord,
  verifier: VerifierRuntimeProfile,
  pending: Extract<ModelPhase, { readonly kind: "verifier" }>,
): VerdictRecord | Phase {
  const label = resolutionAuditLabel("premise-audit");
  const offline = findSubmission(records, {
    label,
    after: pending.after,
    candidate: candidate.id,
    turn: premiseAuditStructuredCall(task, pending),
  });
  if (offline === undefined) return pending;
  const finalize = (submission: {
    readonly call: EntryId;
    readonly value: PremiseSubmission & Pick<Assessment, "verdict">;
  }) => {
    const result = verdictFromSubmission(
      records,
      candidate.id,
      label,
      "premise-audit",
      pending.after,
      submission,
      pending.state,
    );
    return "kind" in result
      ? result
      : { ...result, offlinePremiseReport: offline.value.report };
  };
  const initial: PremiseSubmission & Pick<Assessment, "verdict"> = {
    ...offline.value,
    verdict: premiseVerdictFor(offline.value.premises),
  };
  if (initial.verdict !== "INCONCLUSIVE") {
    return finalize({ call: offline.call, value: initial });
  }

  const request = sourceAuditRequestFor(
    resolutionAuditInput(candidate, pending.state),
    offline,
    verifier,
  );
  const source = findSourceSearch(
    records,
    candidate.id,
    label,
    offline.settled,
    request,
  );
  if (source === undefined) {
    return {
      kind: "source-audit",
      label,
      after: offline.settled,
      candidate,
      request,
      state: pending.state,
    };
  }
  const merged = mergeSourceAudit(offline.value, source.result);
  const submission = {
    ...merged,
    verdict: premiseVerdictFor(merged.premises),
  };
  return finalize({ call: source.call, value: submission });
}

function findSourceSearch(
  records: readonly Entry[],
  candidate: EntryId,
  label: string,
  after: EntryId,
  request: SourceAuditRequest,
):
  | {
      readonly call: EntryId;
      readonly result: SourceAuditSubmission;
    }
  | undefined {
  const results = new Map(
    records
      .filter((entry) => entry.kind === "call-result")
      .map((entry) => [entry.parent, entry]),
  );
  const matches = records.flatMap((entry) => {
    if (
      entry.kind !== "call" ||
      entry.seq <= after ||
      entry.label !== label ||
      entry.candidate !== candidate ||
      entry.tools.length !== 0 ||
      !isDeepStrictEqual(entry.request, request)
    ) {
      return [];
    }
    const result = results.get(entry.seq);
    if (result?.kind !== "call-result" || result.state !== "returned")
      return [];
    const parsed = sourceSearchResultFor(request).safeParse(result.output);
    return parsed.success && parsed.data.state === "succeeded"
      ? [{ call: entry.seq, result: parsed.data.parsed.result }]
      : [];
  });
  if (matches.length > 1) throw new Error("duplicate successful source audits");
  return matches[0];
}

function verdictFromSubmission(
  records: readonly Entry[],
  candidate: EntryId,
  label: string,
  verifier: string,
  after: EntryId,
  submitted: { readonly call: EntryId; readonly value: VerifierSubmission },
  state: State,
): VerdictRecord | Phase {
  const recorded = recordedVerdict(
    records,
    candidate,
    label,
    verifier,
    after,
    submitted,
  );
  return (
    recorded ?? {
      kind: "record-verdict" as const,
      candidate,
      call: submitted.call,
      submission: submitted.value,
      state,
    }
  );
}

function requireVerdict<S extends z.ZodType<VerifierToolSubmission>>(
  records: readonly Entry[],
  candidate: EntryId,
  label: string,
  verifier: string,
  pending: ModelPhase,
  after: EntryId,
  turn: StructuredCall<S>,
  before?: EntryId,
): VerdictRecord | Phase {
  const raw = findSubmission(records, {
    label,
    after,
    candidate,
    turn,
  });
  const submitted =
    raw === undefined
      ? undefined
      : { ...raw, value: normalizeVerifierSubmission(verifier, raw.value) };
  const recorded = recordedVerdict(
    records,
    candidate,
    label,
    verifier,
    after,
    submitted,
    before,
  );
  if (recorded !== undefined) return recorded;
  if (submitted === undefined) return pending;
  return {
    kind: "record-verdict",
    candidate,
    call: submitted.call,
    submission: submitted.value,
    state: pending.state,
  };
}

function recordedVerdict(
  records: readonly Entry[],
  candidate: EntryId,
  label: string,
  verifier: string,
  after: EntryId,
  submitted:
    { readonly call: EntryId; readonly value: VerifierSubmission } | undefined,
  before?: EntryId,
): VerdictRecord | undefined {
  const calls = new Map(
    records
      .filter((entry) => entry.kind === "call")
      .map((entry) => [entry.seq, entry]),
  );
  const matches = records.flatMap((entry) => {
    if (entry.kind !== "verdict") return [];
    const call = calls.get(entry.call);
    return call?.kind === "call" &&
      call.seq > after &&
      (before === undefined || call.seq < before) &&
      call.candidate === candidate &&
      call.label === label
      ? [{ entry, call }]
      : [];
  });
  if (matches.length > 1) throw new Error("duplicate verifier verdict");
  const match = matches[0];
  if (match === undefined) return undefined;
  if (
    submitted?.call !== match.call.seq ||
    submitted.value.verdict !== match.entry.verdict ||
    !isDeepStrictEqual(verdictEvidence(submitted.value), match.entry.evidence)
  ) {
    throw new Error("recorded verdict differs from its verifier submission");
  }
  return {
    verifier,
    call: match.call.seq,
    record: match.entry.seq,
    verdict: submitted.value.verdict,
    report: submitted.value.report,
    ...(verdictEvidence(submitted.value) === submitted.value.report
      ? {}
      : { audit: verdictEvidence(submitted.value) }),
    ...("premises" in submitted.value
      ? {
          premises: submitted.value.premises,
          onlineSource: match.call.tools.length === 0,
        }
      : {}),
  };
}

function verdictEvidence(submission: VerifierSubmission): Json {
  return "audit" in submission ? submission.audit : submission.report;
}

function firstCallSeq(
  records: readonly Entry[],
  label: string,
  candidate: EntryId,
  after: EntryId,
): EntryId | undefined {
  for (const entry of records) {
    if (
      entry.kind === "call" &&
      entry.seq > after &&
      entry.label === label &&
      entry.candidate === candidate
    ) {
      return entry.seq;
    }
  }
  return undefined;
}

function findSubmission<S extends z.ZodType>(
  records: readonly Entry[],
  options: {
    readonly label: string;
    readonly after: EntryId;
    readonly candidate?: EntryId;
    readonly turn: StructuredCall<S>;
  },
):
  | {
      readonly call: EntryId;
      readonly settled: EntryId;
      readonly value: z.output<S>;
    }
  | undefined {
  const matches: {
    readonly call: EntryId;
    readonly settled: EntryId;
    readonly value: z.output<S>;
  }[] = [];
  for (const entry of records) {
    if (
      entry.kind !== "call" ||
      entry.seq <= options.after ||
      entry.label !== options.label ||
      entry.candidate !== options.candidate ||
      !matchesStructuredCall(entry, options.turn)
    ) {
      continue;
    }
    const submission = settledSubmissionForCall(
      records,
      entry.seq,
      options.turn.tool,
      options.turn.schema,
    );
    if (submission !== undefined) {
      matches.push({ call: entry.seq, ...submission });
    }
  }
  if (matches.length > 1) {
    throw new Error(`duplicate terminal submissions for ${options.label}`);
  }
  return matches[0];
}

function matchesStructuredCall(
  entry: Extract<Entry, { readonly kind: "call" }>,
  turn: StructuredCall,
): boolean {
  const parsed = piRequest.safeParse(entry.request);
  if (!parsed.success || parsed.data.modelProfile === undefined) return false;
  const { modelProfile: _modelProfile, ...request } = parsed.data;
  return (
    isDeepStrictEqual(request, {
      protocol: "elenx/pi-run/v1",
      model: {
        provider: turn.profile.provider,
        id: turn.profile.model,
        api: turn.profile.api,
        baseUrl: turn.profile.baseUrl,
      },
      system: turn.system,
      prompt: turn.prompt,
      reasoning: turn.profile.reasoning,
      stopAfterToolResult: true,
      maxRecoveries: 1,
      maxLengthContinuations: 8,
    }) &&
    isDeepStrictEqual(entry.tools, [
      {
        name: turn.tool,
        description: turn.description,
        inputSchema: z.toJSONSchema(turn.schema),
      },
    ])
  );
}

function submissionForCall<S extends z.ZodType>(
  records: readonly Entry[],
  call: EntryId,
  tool: string,
  schema: S,
): z.output<S> | undefined {
  return settledSubmissionForCall(records, call, tool, schema)?.value;
}

function settledSubmissionForCall<S extends z.ZodType>(
  records: readonly Entry[],
  call: EntryId,
  tool: string,
  schema: S,
): { readonly settled: EntryId; readonly value: z.output<S> } | undefined {
  const result = records.find(
    (entry) => entry.kind === "call-result" && entry.parent === call,
  );
  if (result?.kind !== "call-result" || result.state !== "returned")
    return undefined;
  const outcome = piStoredResult.safeParse(result.output);
  if (!outcome.success || outcome.data.state !== "succeeded") return undefined;
  try {
    const parsed = schema.safeParse(
      returnedToolSubmission(records, call, tool).input,
    );
    return parsed.success
      ? { settled: result.seq, value: parsed.data }
      : undefined;
  } catch {
    return undefined;
  }
}

export function snapshot(reader: Reader, task: Task) {
  const phase = derivePhase(reader, task);
  const state = phase.state;
  return {
    phase: publicPhase(phase.kind),
    ...(phase.kind === "solved"
      ? {
          solution: {
            resolution: phase.candidate,
            delivery: phase.delivery,
          },
        }
      : {}),
    claims: [...state.claims.values()].map((claim) => ({
      ...claim,
      live: state.lifecycle.get(claim.id) === "live",
      provisional: state.lifecycle.get(claim.id) === "provisional",
    })),
    routes: [...state.routes.values()].map((route) => ({
      ...route,
      live: state.lifecycle.get(route.id) === "live",
      provisional: state.lifecycle.get(route.id) === "provisional",
    })),
    explorations: state.explorations,
    admissionAudits: state.admissionAudits,
    deliveries: state.deliveries,
    resolutions: state.candidates.map(({ id, verdicts, reconstruction }) => ({
      id,
      verdicts,
      reconstruction,
      gates: candidateGates(task, verdicts, reconstruction),
    })),
  };
}

async function runCampaign(
  campaign: Campaign,
  task: Task,
  dependencies: SolveDependencies,
): Promise<Report> {
  const models = dependencies.models ?? builtinPi();
  const prepared = new Map<string, PreparedPiOptions>();
  const prepare = (key: string, profile: RuntimeProfile) => {
    const existing = prepared.get(key);
    if (existing !== undefined) return existing;
    const model = selectModel(models, {
      provider: profile.provider,
      modelId: profile.model,
    });
    if (model.api !== profile.api || model.baseUrl !== profile.baseUrl) {
      throw new Error(
        `${profile.provider}/${profile.model} runtime identity changed`,
      );
    }
    const value = {
      models,
      model,
      reasoning: profile.reasoning,
      ...(dependencies.signal === undefined
        ? {}
        : { signal: dependencies.signal }),
    };
    prepared.set(key, value);
    return value;
  };
  let consecutiveCallFailures = 0;
  try {
    for (;;) {
      const phase = derivePhase(campaign, task);
      if (phase.kind === "solved") {
        return solvedReport(
          campaign.records(),
          phase.candidate,
          phase.delivery,
        );
      }
      if (phase.kind === "delivery-failed") {
        return {
          outcome: "delivery-failure",
          phase: "delivery-audit",
          resolution: phase.resolution,
          delivery: phase.delivery,
          reason: phase.verdict.report,
        };
      }
      if (phase.kind === "create-candidate") {
        campaign.submitCandidate(
          encode(phase.envelope),
          requiredVerifierLabels(task),
        );
        continue;
      }
      if (phase.kind === "create-delivery") {
        campaign.submitCandidate(encode(phase.envelope), [
          deliveryAuditLabel(),
        ]);
        continue;
      }
      if (phase.kind === "record-verdict") {
        campaign.recordVerdict(
          phase.call,
          phase.submission.verdict,
          verdictEvidence(phase.submission),
        );
        continue;
      }
      if (dependencies.pauseRequested?.() === true) {
        return { outcome: "paused", phase: publicPhase(phase.kind) };
      }
      dependencies.status?.(phaseStatus(campaign.records(), phase));
      try {
        await executeModelPhase(
          campaign,
          task,
          phase,
          dependencies,
          (profile, key) => prepare(key, profile),
        );
        consecutiveCallFailures = 0;
      } catch (error) {
        if (
          !(error instanceof CallFailure) ||
          error.state !== "failed" ||
          !error.providerRetryable
        ) {
          throw error;
        }
        const retry =
          dependencies.callFailureRetry ?? DEFAULT_CALL_FAILURE_RETRY;
        consecutiveCallFailures += 1;
        if (consecutiveCallFailures >= retry.attempts) throw error;
        // The first retry restarts immediately: a died stream was its own
        // spacing. Delays grow only across consecutive failures so the
        // attempt budget outlives a real outage instead of burning in
        // seconds against a hard-down endpoint.
        const delayMs =
          consecutiveCallFailures === 1
            ? 0
            : Math.min(
                retry.baseDelayMs * 2 ** (consecutiveCallFailures - 2),
                retry.maxDelayMs,
              );
        dependencies.status?.(
          `call ${error.call} failed (${error.message}); retrying in ` +
            `${delayMs / 1000}s ` +
            `(failure ${consecutiveCallFailures}/${retry.attempts})`,
        );
        await interruptibleDelay(delayMs, dependencies);
      }
    }
  } catch (error) {
    const phase = derivePhase(campaign, task);
    if (phase.kind === "solved") {
      return solvedReport(campaign.records(), phase.candidate, phase.delivery);
    }
    if (phase.kind === "delivery-failed") {
      return {
        outcome: "delivery-failure",
        phase: "delivery-audit",
        resolution: phase.resolution,
        delivery: phase.delivery,
        reason: phase.verdict.report,
      };
    }
    if (error instanceof CallFailure) {
      return {
        outcome: error.state === "cancelled" ? "interrupted" : "call-failure",
        phase: publicPhase(phase.kind),
        call: error.call,
        reason: error.message,
      };
    }
    if (dependencies.signal?.aborted) {
      return {
        outcome: "interrupted",
        phase: publicPhase(phase.kind),
        reason: "operator interruption",
      };
    }
    throw error;
  } finally {
    campaign.close();
  }
}

function structuredCall<S extends z.ZodType>(
  profile: RuntimeProfile,
  prepareKey: string,
  system: string,
  prompt: string,
  tool: string,
  description: string,
  schema: S,
): StructuredCall<S> {
  return {
    profile,
    prepareKey,
    system,
    prompt,
    tool,
    description,
    schema,
  };
}

function coordinatorStructuredCall(task: Task, state: State) {
  return structuredCall(
    task.coordinator,
    "coordinator",
    coordinatorSystem(task),
    coordinatorPrompt(task, state),
    actionTool,
    "Submit all claim and route changes from this decision packet",
    actionFor(state, task),
  );
}

function explorerStructuredCall(task: Task, state: State) {
  const request = baseExplorerRequest(task, state);
  return structuredCall(
    task.explorer,
    "explorer",
    request.system,
    request.prompt,
    reportTool,
    request.description,
    request.schema,
  );
}

function admissionAuditStructuredCall(task: Task, phase: AdmissionAuditPhase) {
  const request = admissionAuditRequest(task, phase.state, phase.items);
  return structuredCall(
    phase.auditor,
    `admission-auditor:${phase.auditor.name}`,
    request.system,
    request.prompt,
    auditTool,
    request.description,
    request.schema,
  );
}

function directAuditStructuredCall<S extends z.ZodType>(
  phase: Extract<CandidateModelPhase, { readonly kind: "verifier" }>,
  schema: S,
  description: string,
): StructuredCall<S> {
  if (phase.verifier.kind === "reconstruction") {
    throw new Error("reconstruction cannot run as a direct verifier");
  }
  const input = resolutionAuditInput(
    phase.candidate,
    phase.state,
    phase.premises,
  );
  if (phase.verifier.kind === "template") {
    return structuredCall(
      phase.verifier,
      `verifier:${phase.verifier.name}`,
      templateAudit.system(phase.verifier.method, auditTool),
      templateAudit.prompt(phase.verifier.projection, input, phase.premises),
      auditTool,
      description,
      schema,
    );
  }
  const verifier = directVerifier(phase.verifier.kind);
  return structuredCall(
    phase.verifier,
    `verifier:${phase.verifier.kind}`,
    verifier.system(auditTool),
    verifier.prompt(input, phase.premises),
    auditTool,
    description,
    schema,
  );
}

function premiseAuditStructuredCall(
  task: Task,
  phase: Extract<CandidateModelPhase, { readonly kind: "verifier" }>,
) {
  const candidate = resolutionAuditInput(phase.candidate, phase.state);
  return directAuditStructuredCall(
    phase,
    premiseSubmissionFor(task.problem, [
      {
        call: candidate.envelope.sourceReport,
        artifact: candidate.envelope.newArgument,
      },
      ...candidate.support.artifacts,
    ]),
    "Submit the premise inventory; the harness derives its verdict",
  );
}

function assessmentAuditStructuredCall(
  _task: Task,
  phase: Extract<CandidateModelPhase, { readonly kind: "verifier" }>,
) {
  return directAuditStructuredCall(
    phase,
    phase.verifier.kind === "proof-audit"
      ? finalProofAuditFor(
          resolutionAuditInput(phase.candidate, phase.state, phase.premises)
            .declaredEvidence,
        )
      : assessment,
    phase.verifier.kind === "proof-audit"
      ? "Submit complete terminal claim, edge, root, and resolution coverage"
      : "Submit the exact resolution-bound verdict",
  );
}

function reconstructionStructuredCall(
  task: Task,
  phase: Extract<CandidateModelPhase, { readonly kind: "reconstruction" }>,
) {
  return structuredCall(
    phase.verifier,
    "verifier:reconstruction",
    reconstructionSystem(reconstructionTool),
    reconstructionPrompt(task, {
      ...resolutionAuditInput(phase.candidate, phase.state, phase.premises),
      declaredEvidence: phase.declaredEvidence,
    }),
    reconstructionTool,
    "Submit the independent reconstruction",
    reconstruction,
  );
}

function comparisonStructuredCall(
  task: Task,
  phase: Extract<CandidateModelPhase, { readonly kind: "comparison" }>,
) {
  return structuredCall(
    phase.verifier,
    "verifier:reconstruction",
    comparisonSystem(auditTool),
    comparisonPrompt(
      task,
      {
        ...resolutionAuditInput(phase.candidate, phase.state, phase.premises),
        declaredEvidence: phase.declaredEvidence,
      },
      phase.reconstruction,
    ),
    auditTool,
    "Submit the reconstruction comparison verdict",
    comparisonAssessmentFor(phase.reconstruction.call),
  );
}

function deliveryAssemblyStructuredCall(
  task: Task,
  phase: DeliveryAssemblyPhase,
) {
  const resolution = resolutionAuditInput(
    phase.candidate,
    phase.state,
    phase.premises,
  );
  const input: DeliveryAssemblyInput = {
    task,
    resolution: {
      id: phase.candidate.id,
      candidate: phase.candidate.envelope,
    },
    support: resolution.support,
    sourcedPremises: resolution.declaredEvidence.sourcedPremises,
  };
  return structuredCall(
    task.explorer,
    "delivery-assembler",
    deliveryAssemblySystem(deliveryTool),
    deliveryAssemblyPrompt(input),
    deliveryTool,
    "Submit the standalone public answer",
    deliverySubmission,
  );
}

function deliveryAuditStructuredCall(task: Task, phase: DeliveryAuditPhase) {
  const input: DeliveryAuditInput = {
    task,
    answer: phase.candidate.envelope.answer,
    sourcedPremises: phase.premises.flatMap((premise) =>
      premise.standing === "SOURCED" ? [{ statement: premise.statement }] : [],
    ),
  };
  const auditor = task.resolutionAuditors.find(
    ({ kind }) => kind === "proof-audit",
  );
  if (auditor === undefined) throw new Error("proof-audit profile is missing");
  return structuredCall(
    auditor,
    "verifier:delivery-audit",
    deliveryAuditSystem(auditTool),
    deliveryAuditPrompt(input),
    auditTool,
    "Submit candidate-only delivery coverage",
    deliveryAudit,
  );
}

function structuredCallForPhase(
  task: Task,
  phase: Exclude<ModelPhase, { readonly kind: "source-audit" }>,
): StructuredCall {
  if (phase.kind === "coordinator") {
    return coordinatorStructuredCall(task, phase.state);
  }
  if (phase.kind === "explorer") {
    return explorerStructuredCall(task, phase.state);
  }
  if (phase.kind === "admission-audit") {
    return admissionAuditStructuredCall(task, phase);
  }
  if (phase.kind === "delivery-assembly") {
    return deliveryAssemblyStructuredCall(task, phase);
  }
  if (phase.kind === "delivery-audit") {
    return deliveryAuditStructuredCall(task, phase);
  }
  if (phase.kind === "verifier") {
    return phase.verifier.kind === "premise-audit"
      ? premiseAuditStructuredCall(task, phase)
      : assessmentAuditStructuredCall(task, phase);
  }
  return phase.kind === "reconstruction"
    ? reconstructionStructuredCall(task, phase)
    : comparisonStructuredCall(task, phase);
}

async function executeModelPhase(
  campaign: Campaign,
  task: Task,
  phase: ModelPhase,
  dependencies: SolveDependencies,
  prepare: (profile: RuntimeProfile, key: string) => PreparedPiOptions,
): Promise<void> {
  if (phase.kind === "source-audit") {
    const receipt = await campaign.call(
      {
        label: phase.label,
        candidate: phase.candidate.id,
        request: phase.request,
        ...(dependencies.signal === undefined
          ? {}
          : { signal: dependencies.signal }),
      },
      async ({ signal }) => {
        try {
          return await (dependencies.sourceSearch ?? runCodexSourceSearch)(
            phase.request,
            signal,
          );
        } catch (error) {
          return {
            state: signal.aborted
              ? ("cancelled" as const)
              : ("failed" as const),
            stdout: "",
            stderr: "",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    const parsed = sourceSearchResultFor(phase.request).safeParse(
      receipt.output,
    );
    if (!parsed.success) {
      throw new CallFailure(receipt.call, "failed", parsed.error.message);
    }
    const result = parsed.data;
    if (result.state !== "succeeded") {
      // A failed source search is a transport or process flake of the
      // ephemeral Codex fallback, so it joins the retryable family; the
      // parse failure above stays deterministic.
      throw new CallFailure(
        receipt.call,
        result.state,
        result.error,
        result.state === "failed",
      );
    }
    return;
  }
  const turn = structuredCallForPhase(task, phase);
  const estimatedTokens = estimatedStructuredContextTokens(
    turn.system,
    turn.prompt,
    turn.tool,
    turn.description,
    turn.schema,
  );
  if (estimatedTokens > task.maxContextTokens) {
    throw new Error(
      `${phase.kind} context estimate ${estimatedTokens} exceeds maxContextTokens ${task.maxContextTokens}`,
    );
  }
  await structuredTurn(
    campaign,
    dependencies,
    {
      ...prepare(turn.profile, turn.prepareKey),
      label: phase.label,
      ...("candidate" in phase ? { candidate: phase.candidate.id } : {}),
      system: turn.system,
      prompt: turn.prompt,
    },
    turn.tool,
    turn.description,
    turn.schema,
  );
}

async function structuredTurn<S extends z.ZodType>(
  campaign: Campaign,
  dependencies: SolveDependencies,
  options: Omit<PiRunOptions, "tools" | "stopAfterToolResult">,
  name: string,
  description: string,
  schema: S,
): Promise<void> {
  const tool = defineTool({
    name,
    description,
    input: schema,
    replay: "safe",
    async run() {
      return null;
    },
  });
  const result = await (dependencies.run ?? runPi)(campaign, {
    // Pin SSE for every campaign call: long explorer streams on the Codex
    // WebSocket transport can close mid-stream. An injected run dependency
    // may override this per call.
    transport: "sse",
    ...options,
    tools: [tool],
    stopAfterToolResult: true,
    maxRecoveries: 1,
    maxLengthContinuations: 8,
  });
  if (result.state !== "succeeded") {
    throw new CallFailure(
      result.call,
      result.state,
      result.error,
      result.state === "failed" && result.providerRetryable,
    );
  }
  const call = result.call;
  if (submissionForCall(campaign.records(), call, name, schema) === undefined) {
    throw new CallFailure(
      call,
      "failed",
      "model call did not make exactly one valid terminal submission",
    );
  }
}

const conditionalEvidenceNudge = {
  coordinator:
    "Represent a conditional mathematical result as an exact implication whose statement includes every hypothesis.",
  explorer:
    "State every conditional result as an exact implication with its hypotheses.",
} as const;

function coordinatorSystem(task: Task): string {
  const auditors = task.admissionAuditors.map(({ name }) => name).join(", ");
  return [
    "You are a fresh campaign coordinator. Select the compact memory that will help a later explorer; do not perform new mathematical exploration.",
    `Call ${actionTool} exactly once with all changes grounded in the current decision packet, or an empty changes array.`,
    ...(task.memory === "none"
      ? ["This policy stores no claims or routes."]
      : [
          "Retain each citable mathematical proposition as one exact claim with its hypotheses. Lemmas, counterexamples, obstructions, invariants, and reductions are all claims.",
          "Retain operational search history as a route with an exact attempt and outcome. A route references claims and never copies a formal claim statement.",
          "The current packet is the only new support. Keep only claims and routes likely to change later work.",
          "Assign consecutive claim-* and route-* IDs. Redeclare every dependency on replacement.",
          "Revise or drop every live dependent claim and route in the same batch when retiring a claim. Leave no dangling reference and fit the next context ceiling.",
        ]),
    task.memory === "none"
      ? "Admission auditing is disabled."
      : task.admissionAuditors.length === 0
        ? "New claims and routes become live without admission audit stamps."
        : `Admission auditors ${auditors} check every changed claim and route as one atomic batch. After a blocked batch, retain unchanged PASS items and revise or drop the rest.`,
    "The harness launches the next explorer and audits any proposed resolution.",
  ].join(" ");
}

function explorerSystem(task: Task): string {
  const nomination =
    task.memory === "none"
      ? "This policy retains no memory. Submit empty nominatedClaims and nominatedRoutes arrays."
      : task.memory === "claims"
        ? "Nominate exact mathematical claims only; submit no routes."
        : "Nominate exact mathematical claims and useful operational routes separately.";
  return [
    "You are a fresh explorer working on the exact goal from internal reasoning and the visible campaign memory.",
    "Begin at the unresolved boundary. Cite useful claims by ID instead of rederiving them. Use routes to avoid repeated mechanisms unless their recorded outcome is wrong, incomplete, or inapplicable.",
    "Return concrete new mathematics: a derivation, construction, counterexample, or a scoped attempt with its exact obstruction. If incomplete, state the strongest result and precise remaining boundary.",
    "Before claiming completion, try to refute it; check definitions, hypotheses, quantifiers, edge cases, and every load-bearing step. If a gap remains, report it and set claimsComplete to false.",
    "State every external result exactly and explain its application. Include a short proof when available; otherwise name the precise theorem needed. Do not invent citation details.",
    nomination,
    "A claim nomination is one exact reusable proposition with its hypotheses. A route nomination records one scoped attempt and outcome. Keep proofs and all other new work in rawReport.",
    "List every directly used claim in citedClaims and explain its use. Route IDs are never legal citations. When claimsComplete is true, rawReport must resolve the goal from those claims.",
    `Call ${reportTool} exactly once with a nonempty raw report, policy-permitted nominations, claimsComplete, and citedClaims.`,
  ].join(" ");
}

function coordinatorPrompt(task: Task, state: State): string {
  return `${renderTask(task)}\n\n${retentionInstruction(task.memory)}${renderGuidance(task.guidance.coordinator)}\n\nCurrent coordinator context:\n${JSON.stringify(coordinatorContext(task, state), null, 2)}`;
}

function retentionInstruction(memory: Task["memory"]): string {
  if (memory === "none") {
    return "Memory policy none retains no claims or routes. Submit an empty changes array.";
  }
  if (memory === "claims") {
    return "Memory policy claims retains and exposes mathematical claims only.";
  }
  return "Memory policy claims-and-routes retains and exposes mathematical claims plus operational route history.";
}

function baseExplorerPrompt(task: Task, state: State): string {
  return `${renderTask(task)}${renderGuidance(task.guidance.explorer)}${renderVisibleEvidence(task, state)}`;
}

function renderGuidance(modules: readonly GuidanceModule[]): string {
  return modules.length === 0
    ? ""
    : `\n\nGuidance:\n${JSON.stringify(
        modules.map(({ text }) => text),
        null,
        2,
      )}`;
}

function baseExplorerRequest(task: Task, state: State) {
  return {
    system: explorerSystem(task),
    prompt: baseExplorerPrompt(task, state),
    description: "Submit the complete exploration report",
    schema: explorerReportFor(task.memory, visibleClaims(state)),
  };
}

function explorerContextHistory(
  state: State,
  request: {
    readonly system: string;
    readonly prompt: string;
    readonly description: string;
    readonly schema: z.ZodType;
  },
) {
  const baseContextDigest = createHash("sha256")
    .update(
      JSON.stringify({
        system: request.system,
        prompt: request.prompt,
        tool: {
          name: reportTool,
          description: request.description,
          inputSchema: z.toJSONSchema(request.schema),
        },
      }),
    )
    .digest("hex");
  return {
    baseContextDigest,
    priorIdenticalContexts: state.explorations.filter(
      (exploration) => exploration.baseContextDigest === baseContextDigest,
    ).length,
  };
}

function renderVisibleEvidence(task: Task, state: State): string {
  if (task.memory === "none") return "";
  const claims = [...state.claims.values()].filter(
    ({ id }) => state.lifecycle.get(id) === "live",
  );
  const routes =
    task.memory === "claims-and-routes"
      ? [...state.routes.values()].filter(
          ({ id }) => state.lifecycle.get(id) === "live",
        )
      : [];
  if (claims.length === 0 && routes.length === 0) return "";
  const blocks: string[] = [];
  if (claims.length > 0) {
    blocks.push(
      "Mathematical claims are reusable but fallible. Cite claim IDs; terminal audits recheck the complete support closure:\n" +
        claims.map((claim) => renderClaim(claim, state)).join("\n"),
    );
  }
  if (routes.length > 0) {
    blocks.push(
      "Route records are operational history, not proof. Avoid only the recorded attempt unless its outcome is wrong, incomplete, or inapplicable:\n" +
        routes.map((route) => renderRoute(route, state)).join("\n"),
    );
  }
  return `\n\n${blocks.join("\n\n")}`;
}

function renderClaim(claim: ClaimRevision, state: State): string {
  const audits = state.admissionAudits.filter(
    ({ target }) => target === claim.id,
  );
  const stamps =
    audits.length === 0
      ? "none"
      : audits
          .map(({ auditor, verdict }) => `${auditor} ${verdict}`)
          .join(" | ");
  const dependencies =
    claim.dependsOn.length === 0 ? "none" : claim.dependsOn.join(", ");
  return `- [${claim.id}; depends on: ${dependencies}; admission stamps: ${stamps}] ${claim.statement}`;
}

function renderRoute(route: RouteRecord, state: State): string {
  const audits = state.admissionAudits.filter(
    ({ target }) => target === route.id,
  );
  const stamps =
    audits.length === 0
      ? "none"
      : audits
          .map(({ auditor, verdict }) => `${auditor} ${verdict}`)
          .join(" | ");
  return `- [${route.id}; claims: ${route.evidenceClaims.join(", ") || "none"}; admission stamps: ${stamps}] Attempt: ${route.attempt} Outcome: ${route.outcome}${route.retryCondition === undefined ? "" : ` Retry when: ${route.retryCondition}`}`;
}

function admissionAuditRequest(
  task: Task,
  state: State,
  items: readonly AdmissionItem[],
) {
  const support = supportBundleFor(
    items.flatMap((item) =>
      item.type === "claim" ? [item.id] : item.evidenceClaims,
    ),
    state,
  );
  const targets: AdmissionTarget[] = items.map((item) =>
    item.type === "claim"
      ? {
          kind: "claim",
          id: item.id,
          statement: item.statement,
          supportCalls: supportBundleFor([item.id], state).artifacts.map(
            ({ call }) => call,
          ),
        }
      : {
          kind: "route",
          id: item.id,
          attempt: item.attempt,
          outcome: item.outcome,
          evidenceClaims: item.evidenceClaims,
          originCall: item.originCall,
          ...(item.retryCondition === undefined
            ? {}
            : { retryCondition: item.retryCondition }),
        },
  );
  const supportArtifactCalls = new Set(
    support.artifacts.map(({ call }) => call),
  );
  const sourcePackets = [
    ...new Set(
      items.flatMap((item) => (item.type === "route" ? [item.originCall] : [])),
    ),
  ].map((call) => ({
    call,
    packet: supportArtifactCalls.has(call)
      ? "identical to the support artifact with this call id"
      : sourceArtifact(state, call),
  }));
  const prompt = `${renderTask(task)}\n\nExact changed claims and routes with recursively collected claim support:\n${JSON.stringify(
    { targets, support, sourcePackets },
    null,
    2,
  )}`;
  return {
    system: admissionAuditSystem(auditTool),
    prompt,
    description: admissionAuditDescription(targets),
    schema: admissionAuditSubmissionFor(task.problem, targets, support),
  };
}

function ensureAdmissionAuditFits(
  task: Task,
  state: State,
  items: readonly AdmissionItem[],
): void {
  if (
    estimatedAdmissionContextTokens(task, state, items) > task.maxContextTokens
  ) {
    throw new Error("admission batch exceeds the configured context ceiling");
  }
}

function estimatedAdmissionContextTokens(
  task: Task,
  state: State,
  items: readonly AdmissionItem[],
): number {
  const request = admissionAuditRequest(task, state, items);
  return estimatedStructuredContextTokens(
    request.system,
    request.prompt,
    auditTool,
    request.description,
    request.schema,
  );
}

function sourceArtifact(state: State, call: EntryId): unknown {
  const exploration = state.explorations.find((item) => item.call === call);
  if (exploration !== undefined) return exploration;
  const review = state.admissionAudits.find((item) => item.call === call);
  if (review !== undefined) return reviewPacket(state, review.batch);
  for (const candidate of state.candidates) {
    if (candidate.verdicts.at(-1)?.call === call) {
      return failedResolutionPacket(state, candidate);
    }
  }
  throw new Error(`claim or route source is unavailable: ${call}`);
}

function mathematicalSourceArtifact(state: State, call: EntryId): unknown {
  const exploration = state.explorations.find((item) => item.call === call);
  if (exploration !== undefined) {
    return { call, rawReport: exploration.value.rawReport };
  }
  const admissionFindings = state.admissionAudits
    .filter((item) => item.call === call)
    .map(({ target, targetKind, mathematicalFinding, premises }) => ({
      target,
      targetKind,
      ...(mathematicalFinding === undefined ? {} : { mathematicalFinding }),
      ...(premises === undefined
        ? {}
        : {
            premiseMaterial: premises.map(
              ({ standing: _standing, ...material }) => {
                void _standing;
                return material;
              },
            ),
          }),
    }));
  if (admissionFindings.length > 0) {
    return {
      call,
      admissionFindings,
    };
  }
  for (const candidate of state.candidates) {
    if (candidate.verdicts.some((verdict) => verdict.call === call)) {
      // envelope.newArgument is the source explorer report verbatim, so a
      // separate sourceArgument copy would duplicate the same bytes.
      return {
        call,
        resolution: candidate.envelope,
        ...(candidate.reconstruction === undefined
          ? {}
          : {
              reconstruction: {
                call: candidate.reconstruction.call,
                report: candidate.reconstruction.report,
              },
            }),
      };
    }
  }
  throw new Error(`mathematical source is unavailable: ${call}`);
}

function coordinatorContext(task: Task, state: State) {
  const source = coordinatorSource(state);
  const explorerContextTokens = estimatedExplorerContextTokens(task, state);
  return {
    nextClaim: nextClaimId(state),
    nextRoute: nextRouteId(state),
    liveClaims: [...state.claims.values()]
      .filter(({ id }) => state.lifecycle.get(id) === "live")
      .map((claim) => ({
        ...claim,
        admissionStamps: auditStampsFor(state, claim.id),
      })),
    liveRoutes: [...state.routes.values()]
      .filter(({ id }) => state.lifecycle.get(id) === "live")
      .map((route) => ({
        ...route,
        admissionStamps: auditStampsFor(state, route.id),
      })),
    provisionalItems: [
      ...[...state.claims.values()].filter(
        ({ id }) => state.lifecycle.get(id) === "provisional",
      ),
      ...[...state.routes.values()].filter(
        ({ id }) => state.lifecycle.get(id) === "provisional",
      ),
    ],
    danglingItems: [...danglingItems(state)],
    explorerContext: {
      estimatedTokens: explorerContextTokens,
      maxTokens: task.maxContextTokens,
      withinLimit: explorerContextTokens <= task.maxContextTokens,
    },
    decision: coordinatorDecision(state, source),
  };
}

function auditStampsFor(state: State, item: ClaimId | RouteId) {
  return state.admissionAudits
    .filter(({ target }) => target === item)
    .map(({ call, auditor, verdict }) => ({ call, auditor, verdict }));
}

function coordinatorDecision(state: State, source: EntryId): unknown {
  const exploration = state.explorations.find(({ call }) => call === source);
  if (exploration !== undefined) return { source, exploration };

  const review = state.admissionAudits.find(({ call }) => call === source);
  if (review !== undefined) {
    return {
      source,
      reviewBatch: {
        batch: review.batch,
        audits: state.admissionAudits.filter(
          ({ batch }) => batch === review.batch,
        ),
      },
    };
  }

  for (const candidate of state.candidates) {
    if (candidate.verdicts.at(-1)?.call === source) {
      return failedResolutionPacket(state, candidate);
    }
  }
  throw new Error(`coordinator source is unavailable: ${source}`);
}

function failedResolutionPacket(
  state: State,
  candidate: CandidateFeedback,
): unknown {
  const source = candidate.verdicts.at(-1)?.call;
  if (source === undefined) throw new Error("failed resolution has no verdict");
  const exploration = state.explorations.find(
    ({ call }) => call === candidate.envelope.sourceReport,
  );
  if (exploration === undefined) {
    throw new Error("failed resolution exploration is unavailable");
  }
  return {
    source,
    candidate: { id: candidate.id, envelope: candidate.envelope },
    exploration: {
      nominatedClaims: exploration.value.nominatedClaims,
      nominatedRoutes: exploration.value.nominatedRoutes,
    },
    verdicts: candidate.verdicts.map(verdictForCoordinator),
    reconstruction: candidate.reconstruction,
  };
}

function reviewPacket(state: State, batch: EntryId): unknown {
  const audits = state.admissionAudits.filter((audit) => audit.batch === batch);
  const items = [...new Set(audits.map(({ target }) => target))].map((id) =>
    claimIdSchema.safeParse(id).success
      ? state.claims.get(id as ClaimId)
      : state.routes.get(id as RouteId),
  );
  return { batch, items, audits };
}

function verdictForCoordinator(verdict: VerdictRecord): unknown {
  if (verdict.verifier !== "premise-audit") return verdict;
  return {
    verifier: verdict.verifier,
    call: verdict.call,
    record: verdict.record,
    verdict: verdict.verdict,
    ...(verdict.verdict === "PASS"
      ? {}
      : { report: verdict.offlinePremiseReport ?? verdict.report }),
    premises:
      verdict.onlineSource === true
        ? premiseOutcomesForCoordinator(verdict.premises ?? [])
        : premiseDefectsForCoordinator(
            z.array(offlinePremiseFinding).parse(verdict.premises ?? []),
          ),
  };
}

function phaseStatus(records: readonly Entry[], phase: ModelPhase): string {
  if (phase.kind === "admission-audit") {
    return `admission audit ${phase.auditor.name} for ${phase.items.map(({ id }) => id).join(", ")}`;
  }
  if (phase.kind === "coordinator" || phase.kind === "explorer") {
    return phase.kind;
  }
  if (phase.kind === "delivery-assembly") {
    return `delivery assembly for ${resolutionPresentationLabel(records, phase.candidate.id)}`;
  }
  if (phase.kind === "delivery-audit") {
    return `delivery audit for journal ${phase.candidate.id}`;
  }
  const candidate = resolutionPresentationLabel(records, phase.candidate.id);
  if (phase.kind === "verifier") {
    return `resolution audit ${phase.verifier.kind} for ${candidate}`;
  }
  if (phase.kind === "source-audit") {
    return `source audit for ${candidate}`;
  }
  if (phase.kind === "reconstruction") {
    return `reconstruction for ${candidate}`;
  }
  if (phase.kind === "comparison") {
    return `reconstruction comparison for ${candidate}`;
  }
  throw new Error("unknown model phase");
}

function publicPhase(kind: Phase["kind"]): string {
  if (
    kind === "verifier" ||
    kind === "reconstruction" ||
    kind === "comparison"
  ) {
    return "resolution-audit";
  }
  if (kind === "delivery-assembly" || kind === "delivery-audit") return kind;
  if (kind === "create-candidate") return "record-resolution";
  if (kind === "create-delivery") return "record-delivery";
  if (kind === "delivery-failed") return "delivery-audit";
  if (kind === "record-verdict") return "record-resolution-audit";
  return kind;
}

export function resolutionPresentationLabel(
  records: readonly Entry[],
  candidate: EntryId,
): string {
  const ordinal = records
    .filter((entry) => entry.kind === "candidate")
    .findIndex(({ seq }) => seq === candidate);
  if (ordinal < 0) throw new Error(`candidate not found: ${candidate}`);
  return `resolution #${ordinal + 1} (journal ${candidate})`;
}

function solvedReport(
  records: readonly Entry[],
  candidate: EntryId,
  delivery: EntryId,
): Report {
  return {
    outcome: "solved",
    phase: "solved",
    resolution: candidate,
    delivery,
    resolutionLabel: resolutionPresentationLabel(records, candidate),
  };
}

function encode(value: Json): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}
