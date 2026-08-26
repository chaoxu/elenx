import { entryIdSchema, verdictSchema, type Entry, type EntryId } from "elenx";
import { piReasoning } from "elenx/pi";
import { z, type RefinementCtx } from "zod";

import { verifierKinds, type VerifierKind } from "./verifiers/kinds";

export const applicationId = "elenx-solve";
export const protocolName = "exploration-v14";

const roleName = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/u, "role name must be lowercase kebab-case");
const modelProfile = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoning: piReasoning,
});
const runtimeProfile = modelProfile.extend({
  api: z.string().min(1),
  baseUrl: z.string().min(1),
});
const namedModelProfile = modelProfile.extend({ name: roleName });
const namedRuntimeProfile = runtimeProfile.extend({ name: roleName });
export const templateAuditorName = z
  .string()
  .regex(
    /^custom-[a-z][a-z0-9-]*$/u,
    "template auditor names use a custom- prefix and lowercase kebab-case",
  );
export const templateProjections = ["support", "argument"] as const;
const templateFields = {
  kind: z.literal("template"),
  name: templateAuditorName,
  projection: z.enum(templateProjections),
  method: z.string().refine((value) => value.trim().length > 0, {
    message: "template method must contain non-whitespace text",
  }),
};
const verifierModelProfile = z.discriminatedUnion("kind", [
  modelProfile.extend({ kind: z.enum(verifierKinds) }),
  modelProfile.extend(templateFields),
]);
const verifierRuntimeProfile = z.discriminatedUnion("kind", [
  runtimeProfile.extend({ kind: z.enum(verifierKinds) }),
  runtimeProfile.extend(templateFields),
]);
const contextTokenLimit = z.number().int().positive();
const maxContextTokens = contextTokenLimit.default(200_000);
const guidanceText = z.string().refine((value) => value.trim().length > 0, {
  message: "guidance must contain non-whitespace text",
});
const userGuidance = z.array(guidanceText);
const guidanceModule = z.strictObject({
  origin: z.enum(["default", "user"]),
  text: guidanceText,
});
const resolvedGuidance = z.strictObject({
  explorer: z.array(guidanceModule),
  coordinator: z.array(guidanceModule),
});
export type GuidanceModule = z.output<typeof guidanceModule>;
export type ResolvedGuidance = z.output<typeof resolvedGuidance>;

export const memoryPolicy = z.enum(["none", "claims", "claims-and-routes"]);
export type MemoryPolicy = z.output<typeof memoryPolicy>;

function validateProfiles(
  profiles: {
    readonly admissionAuditors: readonly { readonly name: string }[];
    readonly resolutionAuditors: readonly ({
      readonly provider: string;
    } & (
      | { readonly kind: VerifierKind }
      | { readonly kind: "template"; readonly name: string }
    ))[];
  },
  context: RefinementCtx,
): void {
  if (
    new Set(profiles.admissionAuditors.map(({ name }) => name)).size !==
    profiles.admissionAuditors.length
  ) {
    context.addIssue({
      code: "custom",
      message: "duplicate admission auditor name",
    });
  }
  const methods = profiles.resolutionAuditors.map(auditorMethod);
  if (new Set(methods).size !== methods.length) {
    context.addIssue({
      code: "custom",
      message: "duplicate resolution auditor method",
    });
  }
  const premiseAudit = profiles.resolutionAuditors.find(
    ({ kind }) => kind === "premise-audit",
  );
  if (premiseAudit !== undefined && premiseAudit.provider !== "openai-codex") {
    context.addIssue({
      code: "custom",
      message: "premise-audit requires the openai-codex provider",
      path: [
        "resolutionAuditors",
        profiles.resolutionAuditors.indexOf(premiseAudit),
        "provider",
      ],
    });
  }
  const proofIndex = profiles.resolutionAuditors.findIndex(
    ({ kind }) => kind === "proof-audit",
  );
  const premiseIndex = profiles.resolutionAuditors.findIndex(
    ({ kind }) => kind === "premise-audit",
  );
  if (proofIndex < 0) {
    context.addIssue({
      code: "custom",
      message: "resolution audits require proof-audit",
      path: ["resolutionAuditors"],
    });
  }
  if (proofIndex >= 0 && premiseIndex > proofIndex) {
    context.addIssue({
      code: "custom",
      message: "premise-audit must precede proof-audit",
      path: ["resolutionAuditors"],
    });
  }
  const firstTemplate = profiles.resolutionAuditors.findIndex(
    ({ kind }) => kind === "template",
  );
  if (firstTemplate >= 0 && firstTemplate < proofIndex) {
    context.addIssue({
      code: "custom",
      message: "template auditors must follow proof-audit",
      path: ["resolutionAuditors", firstTemplate],
    });
  }
  const reconstructionIndex = profiles.resolutionAuditors.findIndex(
    ({ kind }) => kind === "reconstruction",
  );
  if (
    reconstructionIndex >= 0 &&
    reconstructionIndex !== profiles.resolutionAuditors.length - 1
  ) {
    context.addIssue({
      code: "custom",
      message: "reconstruction must be the final resolution auditor",
      path: ["resolutionAuditors", reconstructionIndex],
    });
  }
}

export const settingsSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    memory: memoryPolicy,
    maxContextTokens,
    explorerGuidance: userGuidance.default([]),
    coordinatorGuidance: userGuidance.default([]),
    coordinator: modelProfile,
    explorer: modelProfile,
    admissionAuditors: z.array(namedModelProfile).default([]),
    resolutionAuditors: z.array(verifierModelProfile).min(1),
  })
  .superRefine(validateProfiles);
export type Settings = z.output<typeof settingsSchema>;

export const taskSchema = z
  .strictObject({
    protocol: z.literal(protocolName),
    problem: z.string().min(1),
    completionCriteria: z.string().min(1),
    memory: memoryPolicy,
    maxContextTokens: contextTokenLimit,
    guidance: resolvedGuidance,
    coordinator: runtimeProfile,
    explorer: runtimeProfile,
    admissionAuditors: z.array(namedRuntimeProfile),
    resolutionAuditors: z.array(verifierRuntimeProfile).min(1),
  })
  .superRefine(validateProfiles);
export type Task = z.output<typeof taskSchema>;
export type RuntimeProfile = z.output<typeof runtimeProfile>;
export type NamedRuntimeProfile = z.output<typeof namedRuntimeProfile>;
export type VerifierRuntimeProfile = z.output<typeof verifierRuntimeProfile>;

type CampaignDeclaration = Extract<Entry, { kind: "campaign" }>;

export function parseCampaign(declaration: Entry | undefined): {
  readonly declaration: CampaignDeclaration;
  readonly task: Task;
} {
  if (
    declaration?.kind !== "campaign" ||
    declaration.application !== applicationId
  ) {
    throw new Error(`not an ${applicationId} campaign`);
  }
  const parsed = taskSchema.safeParse(declaration.config);
  if (!parsed.success) {
    const declaredProtocol =
      declaration.config !== null &&
      typeof declaration.config === "object" &&
      !Array.isArray(declaration.config) &&
      "protocol" in declaration.config
        ? declaration.config.protocol
        : undefined;
    if (declaredProtocol === "exploration-v12") {
      throw new Error(
        "exploration-v12 requires elenx-solve v0.31.0 for replay or inspection",
      );
    }
    if (declaredProtocol === "exploration-v13") {
      throw new Error(
        "exploration-v13 requires elenx-solve v0.32.0 for replay or inspection",
      );
    }
    if (declaredProtocol === protocolName) {
      throw new Error(
        `invalid ${applicationId} ${protocolName} campaign config: ${parsed.error.message}`,
      );
    }
    throw new Error(
      `unsupported ${applicationId} protocol: ${String(declaredProtocol)}`,
    );
  }
  return { declaration, task: parsed.data };
}

export const claimIdSchema = z
  .string()
  .regex(/^claim-[1-9][0-9]*$/u, "claim IDs use claim-<positive integer>")
  .refine((id) => Number.isSafeInteger(Number(id.slice("claim-".length))), {
    message: "claim ID ordinal must be a safe integer",
  });
export type ClaimId = z.output<typeof claimIdSchema>;
export const routeIdSchema = z
  .string()
  .regex(/^route-[1-9][0-9]*$/u, "route IDs use route-<positive integer>")
  .refine((id) => Number.isSafeInteger(Number(id.slice("route-".length))), {
    message: "route ID ordinal must be a safe integer",
  });
export type RouteId = z.output<typeof routeIdSchema>;

function uniqueClaimIds(message: string) {
  return z.array(claimIdSchema).superRefine((claims, context) => {
    if (new Set(claims).size !== claims.length) {
      context.addIssue({ code: "custom", message });
    }
  });
}

const nominatedClaim = z.strictObject({
  statement: z.string().min(1),
  basedOnClaims: uniqueClaimIds("claim dependencies must be unique"),
});
const nominatedRoute = z.strictObject({
  attempt: z.string().min(1),
  outcome: z.string().min(1),
  evidenceClaims: uniqueClaimIds("route claim references must be unique"),
  retryCondition: z.string().min(1).optional(),
});
export interface ExplorerReport {
  readonly rawReport: string;
  readonly nominatedClaims: readonly {
    readonly statement: string;
    readonly basedOnClaims: readonly ClaimId[];
  }[];
  readonly nominatedRoutes: readonly {
    readonly attempt: string;
    readonly outcome: string;
    readonly evidenceClaims: readonly ClaimId[];
    readonly retryCondition?: string | undefined;
  }[];
  readonly claimsComplete: boolean;
  readonly citedClaims: readonly ClaimId[];
}

export function explorerReportFor(
  policy: MemoryPolicy,
  visibleClaims: ReadonlySet<ClaimId>,
) {
  const visibleClaim = claimIdSchema.refine((id) => visibleClaims.has(id), {
    message: "claim must be live and visible to this explorer",
  });
  const visibleClaimIds = (message: string) =>
    z.array(visibleClaim).superRefine((claims, context) => {
      if (new Set(claims).size !== claims.length) {
        context.addIssue({ code: "custom", message });
      }
    });
  const visibleClaimNomination = nominatedClaim.extend({
    basedOnClaims: visibleClaimIds("claim dependencies must be unique"),
  });
  const visibleRouteNomination = nominatedRoute.extend({
    evidenceClaims: visibleClaimIds("route claim references must be unique"),
  });
  return z.strictObject({
    rawReport: z.string().min(1),
    nominatedClaims:
      policy === "none"
        ? z.array(visibleClaimNomination).max(0)
        : z.array(visibleClaimNomination),
    nominatedRoutes:
      policy === "claims-and-routes"
        ? z.array(visibleRouteNomination)
        : z.array(visibleRouteNomination).max(0),
    claimsComplete: z.boolean(),
    citedClaims: visibleClaimIds("cited claims must be unique"),
  });
}

export const assessment = z.strictObject({
  verdict: verdictSchema,
  report: z.string().min(1),
});
export type Assessment = z.output<typeof assessment>;

export function comparisonAssessmentFor(reconstructionCall: EntryId) {
  return assessment.extend({
    reconstructionCall: z.literal(entryIdSchema.parse(reconstructionCall)),
  });
}

export const resolutionCandidate = z.strictObject({
  protocol: z.literal(`${applicationId}/${protocolName}/resolution/v1`),
  problem: z.string().min(1),
  completionCriteria: z.string().min(1),
  citedClaims: uniqueClaimIds("cited claims must be unique"),
  newArgument: z.string().min(1),
  sourceReport: entryIdSchema,
});
export type ResolutionCandidate = z.output<typeof resolutionCandidate>;

// The engine uses the kernel's generic candidate name internally. The public
// v14 protocol name is ResolutionCandidate.
export const candidateEnvelope = resolutionCandidate;
export type CandidateEnvelope = ResolutionCandidate;

export interface EvidenceClaim {
  readonly id: ClaimId;
  readonly statement: string;
  readonly dependsOn: readonly ClaimId[];
  readonly originCall: EntryId;
  readonly replaces?: ClaimId;
}

export interface RouteRecord {
  readonly id: RouteId;
  readonly attempt: string;
  readonly outcome: string;
  readonly evidenceClaims: readonly ClaimId[];
  readonly retryCondition?: string | undefined;
  readonly originCall: EntryId;
  readonly replaces?: RouteId;
}

export interface ClaimSupportBundle {
  readonly claims: readonly EvidenceClaim[];
  readonly artifacts: readonly {
    readonly call: EntryId;
    readonly artifact: unknown;
  }[];
}

export interface ResolutionAuditInput {
  readonly id: EntryId;
  readonly envelope: CandidateEnvelope;
  readonly support: ClaimSupportBundle;
  readonly declaredEvidence: DeclaredEvidenceDAG;
}

const declaredClaim = z.strictObject({
  id: claimIdSchema,
  statement: z.string().min(1),
  dependsOn: uniqueClaimIds("claim dependencies must be unique"),
});

export const declaredEvidenceDAG = z
  .strictObject({
    roots: uniqueClaimIds("declared roots must be unique"),
    claims: z.array(declaredClaim),
    sourcedPremises: z.array(z.strictObject({ statement: z.string().min(1) })),
  })
  .superRefine(({ roots, claims, sourcedPremises }, context) => {
    const issue = (message: string, path: PropertyKey[]) =>
      context.addIssue({ code: "custom", message, path });
    const byId = new Map(claims.map((claim) => [claim.id, claim]));
    if (byId.size !== claims.length) {
      issue("declared claims must have unique IDs", ["claims"]);
    }
    for (const [index, root] of roots.entries()) {
      if (!byId.has(root)) {
        issue("declared root is absent from claims", ["roots", index]);
      }
    }
    for (const [claimIndex, claim] of claims.entries()) {
      for (const [dependencyIndex, dependency] of claim.dependsOn.entries()) {
        if (!byId.has(dependency)) {
          issue("declared dependency is absent from claims", [
            "claims",
            claimIndex,
            "dependsOn",
            dependencyIndex,
          ]);
        }
      }
    }

    const reachable = new Set<ClaimId>();
    const visiting = new Set<ClaimId>();
    let reportedCycle = false;
    const visit = (id: ClaimId): void => {
      if (reachable.has(id)) return;
      if (visiting.has(id)) {
        if (!reportedCycle) {
          issue("declared claim dependencies must be acyclic", ["claims"]);
          reportedCycle = true;
        }
        return;
      }
      const claim = byId.get(id);
      if (claim === undefined) return;
      visiting.add(id);
      for (const dependency of claim.dependsOn) visit(dependency);
      visiting.delete(id);
      reachable.add(id);
    };
    for (const root of roots) visit(root);
    if (reachable.size !== byId.size) {
      issue("declared claims must be exactly the transitive root closure", [
        "claims",
      ]);
    }
    if (
      new Set(sourcedPremises.map(({ statement }) => statement)).size !==
      sourcedPremises.length
    ) {
      issue("sourced premise statements must be unique", ["sourcedPremises"]);
    }
  });
export type DeclaredEvidenceDAG = z.output<typeof declaredEvidenceDAG>;

const dependencyCheck = z.strictObject({
  dependency: claimIdSchema,
  verdict: verdictSchema,
  report: z.string().min(1),
});
const finalClaimCheck = z.strictObject({
  claim: claimIdSchema,
  dependencyChecks: z.array(dependencyCheck),
  derivation: assessment,
});
const rootApplicationCheck = z.strictObject({
  claim: claimIdSchema,
  verdict: verdictSchema,
  report: z.string().min(1),
});

export const finalProofAudit = z.strictObject({
  claimChecks: z.array(finalClaimCheck),
  rootApplications: z.array(rootApplicationCheck),
  resolution: assessment,
});
export type FinalProofAudit = z.output<typeof finalProofAudit>;

export function finalProofAuditFor(declaredValue: DeclaredEvidenceDAG) {
  const declared = declaredEvidenceDAG.parse(declaredValue);
  const claims = new Map(declared.claims.map((claim) => [claim.id, claim]));
  const roots = new Set(declared.roots);
  return finalProofAudit.superRefine(
    ({ claimChecks, rootApplications }, context) => {
      const issue = (message: string, path: PropertyKey[]) =>
        context.addIssue({ code: "custom", message, path });
      const submittedClaims = new Set(claimChecks.map(({ claim }) => claim));
      if (
        submittedClaims.size !== claimChecks.length ||
        submittedClaims.size !== claims.size ||
        [...submittedClaims].some((claim) => !claims.has(claim))
      ) {
        issue("audit must check every declared claim exactly once", [
          "claimChecks",
        ]);
      }
      for (const [claimIndex, check] of claimChecks.entries()) {
        const claim = claims.get(check.claim);
        if (claim === undefined) continue;
        const expected = new Set(claim.dependsOn);
        const submitted = new Set(
          check.dependencyChecks.map(({ dependency }) => dependency),
        );
        if (
          submitted.size !== check.dependencyChecks.length ||
          submitted.size !== expected.size ||
          [...submitted].some((dependency) => !expected.has(dependency))
        ) {
          issue("audit must check every direct dependency edge exactly once", [
            "claimChecks",
            claimIndex,
            "dependencyChecks",
          ]);
        }
      }
      const submittedRoots = new Set(
        rootApplications.map(({ claim }) => claim),
      );
      if (
        submittedRoots.size !== rootApplications.length ||
        submittedRoots.size !== roots.size ||
        [...submittedRoots].some((root) => !roots.has(root))
      ) {
        issue("audit must check every cited root application exactly once", [
          "rootApplications",
        ]);
      }
    },
  );
}

export function finalProofVerdict(
  audit: FinalProofAudit,
): Assessment["verdict"] {
  const verdicts = [
    audit.resolution.verdict,
    ...audit.rootApplications.map(({ verdict }) => verdict),
    ...audit.claimChecks.flatMap(({ derivation, dependencyChecks }) => [
      derivation.verdict,
      ...dependencyChecks.map(({ verdict }) => verdict),
    ]),
  ];
  if (verdicts.includes("FAIL")) return "FAIL";
  return verdicts.includes("INCONCLUSIVE") ? "INCONCLUSIVE" : "PASS";
}

export const deliveryArtifact = z.strictObject({
  protocol: z.literal(`${applicationId}/${protocolName}/delivery/v1`),
  resolution: entryIdSchema,
  answer: z.string().min(1),
});
export type DeliveryArtifact = z.output<typeof deliveryArtifact>;

export const deliverySubmission = z.strictObject({ answer: z.string().min(1) });

export interface DeliveryAssemblyInput {
  readonly task: Pick<Task, "problem" | "completionCriteria">;
  readonly resolution: {
    readonly id: EntryId;
    readonly candidate: ResolutionCandidate;
  };
  readonly support: ClaimSupportBundle;
  readonly sourcedPremises: readonly { readonly statement: string }[];
}

export interface DeliveryAuditInput {
  readonly task: Pick<Task, "problem" | "completionCriteria">;
  readonly answer: string;
  readonly sourcedPremises: readonly { readonly statement: string }[];
}

const deliveryCheck = z.strictObject({
  verdict: verdictSchema,
  report: z.string().min(1),
});
export const deliveryAudit = z.strictObject({
  theoremChecks: z.array(
    deliveryCheck.extend({ conclusion: z.string().min(1) }),
  ),
  selfContainment: deliveryCheck,
  internalReferenceHygiene: deliveryCheck,
  resolution: deliveryCheck,
});
export type DeliveryAudit = z.output<typeof deliveryAudit>;

export function deliveryAuditVerdict(
  audit: DeliveryAudit,
): Assessment["verdict"] {
  const verdicts = [
    ...audit.theoremChecks.map(({ verdict }) => verdict),
    audit.selfContainment.verdict,
    audit.internalReferenceHygiene.verdict,
    audit.resolution.verdict,
  ];
  if (verdicts.includes("FAIL")) return "FAIL";
  return verdicts.includes("INCONCLUSIVE") ? "INCONCLUSIVE" : "PASS";
}

export const reconstruction = z.strictObject({
  report: z.string().min(1),
});
export type Reconstruction = z.output<typeof reconstruction>;

export const actionTool = "submit_action";
export const reportTool = "submit_report";
export const auditTool = "submit_audit";
export const reconstructionTool = "submit_reconstruction";
export const deliveryTool = "submit_delivery";

export function actionSchema(options: {
  readonly memory: MemoryPolicy;
  readonly nextClaim: ClaimId;
  readonly nextRoute: RouteId;
  readonly claims: readonly {
    readonly id: ClaimId;
    readonly dependsOn: readonly ClaimId[];
    readonly provisional: boolean;
    readonly retainable: boolean;
  }[];
  readonly routes: readonly {
    readonly id: RouteId;
    readonly evidenceClaims: readonly ClaimId[];
    readonly provisional: boolean;
    readonly retainable: boolean;
  }[];
}) {
  const firstClaim = claimIdSchema.parse(options.nextClaim);
  const firstRoute = routeIdSchema.parse(options.nextRoute);
  if (
    new Set(options.claims.map(({ id }) => id)).size !== options.claims.length
  ) {
    throw new Error("current claims must have unique IDs");
  }
  if (
    new Set(options.routes.map(({ id }) => id)).size !== options.routes.length
  ) {
    throw new Error("current routes must have unique IDs");
  }
  const claimBody = {
    statement: z.string().min(1),
    dependsOn: uniqueClaimIds("claim dependencies must be unique"),
  };
  const routeBody = {
    attempt: z.string().min(1),
    outcome: z.string().min(1),
    evidenceClaims: uniqueClaimIds("route claim references must be unique"),
    retryCondition: z.string().min(1).optional(),
  };
  const addClaim = z.strictObject({
    action: z.literal("add_claim"),
    claim: claimIdSchema,
    ...claimBody,
  });
  const reviseClaim = z.strictObject({
    action: z.literal("revise_claim"),
    claim: claimIdSchema,
    replaces: claimIdSchema,
    ...claimBody,
  });
  const dropClaim = z.strictObject({
    action: z.literal("drop_claim"),
    claim: claimIdSchema,
  });
  const retainClaim = z.strictObject({
    action: z.literal("retain_claim"),
    claim: claimIdSchema,
  });
  const addRoute = z.strictObject({
    action: z.literal("add_route"),
    route: routeIdSchema,
    ...routeBody,
  });
  const reviseRoute = z.strictObject({
    action: z.literal("revise_route"),
    route: routeIdSchema,
    replaces: routeIdSchema,
    ...routeBody,
  });
  const dropRoute = z.strictObject({
    action: z.literal("drop_route"),
    route: routeIdSchema,
  });
  const retainRoute = z.strictObject({
    action: z.literal("retain_route"),
    route: routeIdSchema,
  });
  const claimChanges = [addClaim, reviseClaim, dropClaim, retainClaim] as const;
  const allChanges = [
    ...claimChanges,
    addRoute,
    reviseRoute,
    dropRoute,
    retainRoute,
  ] as const;
  const changes =
    options.memory === "none"
      ? z.array(z.never()).max(0)
      : z.array(
          z.discriminatedUnion(
            "action",
            options.memory === "claims" ? claimChanges : allChanges,
          ),
        );
  return z
    .strictObject({ action: z.literal("continue"), changes })
    .superRefine(({ changes }, context) => {
      const issue = (message: string, path: PropertyKey[]) =>
        context.addIssue({ code: "custom", message, path });
      const claims = new Map(options.claims.map((item) => [item.id, item]));
      const routes = new Map(options.routes.map((item) => [item.id, item]));
      const provisionalClaims = new Set(
        options.claims
          .filter(({ provisional }) => provisional)
          .map(({ id }) => id),
      );
      const provisionalRoutes = new Set(
        options.routes
          .filter(({ provisional }) => provisional)
          .map(({ id }) => id),
      );
      const targeted = new Set<string>();
      const retiredClaims = new Set<ClaimId>();
      const retiredRoutes = new Set<RouteId>();
      const newClaims = new Map<ClaimId, readonly ClaimId[]>();
      const newRoutes = new Map<RouteId, readonly ClaimId[]>();
      let nextClaim = serial(firstClaim, "claim");
      let nextRoute = serial(firstRoute, "route");

      for (const [index, change] of changes.entries()) {
        if (change.action === "add_claim" || change.action === "revise_claim") {
          if (change.claim !== `claim-${nextClaim}`) {
            issue(
              `new claims must use consecutive IDs starting at ${firstClaim}`,
              ["changes", index, "claim"],
            );
          }
          nextClaim += 1;
          for (const dependency of change.dependsOn) {
            if (!claims.has(dependency) && !newClaims.has(dependency)) {
              issue(
                "dependency must be an existing claim or an earlier claim in this batch",
                ["changes", index, "dependsOn"],
              );
            }
          }
          if (claims.has(change.claim) || newClaims.has(change.claim)) {
            issue("new claim ID is already in use", [
              "changes",
              index,
              "claim",
            ]);
          }
          newClaims.set(change.claim, change.dependsOn);
        }
        if (change.action === "add_route" || change.action === "revise_route") {
          if (change.route !== `route-${nextRoute}`) {
            issue(
              `new routes must use consecutive IDs starting at ${firstRoute}`,
              ["changes", index, "route"],
            );
          }
          nextRoute += 1;
          for (const claim of change.evidenceClaims) {
            if (!claims.has(claim) && !newClaims.has(claim)) {
              issue("route must reference an existing or earlier claim", [
                "changes",
                index,
                "evidenceClaims",
              ]);
            }
          }
          if (routes.has(change.route) || newRoutes.has(change.route)) {
            issue("new route ID is already in use", [
              "changes",
              index,
              "route",
            ]);
          }
          newRoutes.set(change.route, change.evidenceClaims);
        }
        const target = targetOf(change);
        if (target === undefined) continue;
        if (targeted.has(target)) {
          issue("claim or route may be changed only once per batch", [
            "changes",
            index,
          ]);
        }
        targeted.add(target);
        if (
          change.action === "revise_claim" ||
          change.action === "drop_claim" ||
          change.action === "retain_claim"
        ) {
          const current = claims.get(target as ClaimId);
          if (current === undefined) {
            issue("target claim is unavailable", ["changes", index]);
          } else if (change.action === "retain_claim") {
            if (!current.provisional || !current.retainable) {
              issue(
                "only an audited passing provisional claim may be retained",
                ["changes", index],
              );
            }
          } else {
            retiredClaims.add(target as ClaimId);
          }
        } else {
          const current = routes.get(target as RouteId);
          if (current === undefined) {
            issue("target route is unavailable", ["changes", index]);
          } else if (change.action === "retain_route") {
            if (!current.provisional || !current.retainable) {
              issue(
                "only an audited passing provisional route may be retained",
                ["changes", index],
              );
            }
          } else {
            retiredRoutes.add(target as RouteId);
          }
        }
      }

      for (const item of [...provisionalClaims, ...provisionalRoutes]) {
        if (!targeted.has(item)) {
          issue(
            "every audited provisional claim or route must be retained, revised, or dropped",
            ["changes"],
          );
          break;
        }
      }

      const availableClaims = new Set<ClaimId>([
        ...[...claims.keys()].filter((id) => !retiredClaims.has(id)),
        ...newClaims.keys(),
      ]);
      const unavailableReference = (
        references: readonly ClaimId[],
      ): ClaimId | undefined =>
        references.find((reference) => !availableClaims.has(reference));
      for (const [id, claim] of claims) {
        if (retiredClaims.has(id)) continue;
        const unavailable = unavailableReference(claim.dependsOn);
        if (unavailable !== undefined) {
          issue(
            `live claim ${id} still depends on retired claim ${unavailable}; revise or drop it in this batch`,
            ["changes"],
          );
        }
      }
      for (const [id, dependencies] of newClaims) {
        const unavailable = unavailableReference(dependencies);
        if (unavailable !== undefined) {
          issue(`new claim ${id} references retired claim ${unavailable}`, [
            "changes",
          ]);
        }
      }
      for (const [id, route] of routes) {
        if (retiredRoutes.has(id)) continue;
        const unavailable = unavailableReference(route.evidenceClaims);
        if (unavailable !== undefined) {
          issue(
            `live route ${id} still references retired claim ${unavailable}; revise or drop it in this batch`,
            ["changes"],
          );
        }
      }
      for (const [id, references] of newRoutes) {
        const unavailable = unavailableReference(references);
        if (unavailable !== undefined) {
          issue(`new route ${id} references retired claim ${unavailable}`, [
            "changes",
          ]);
        }
      }
    });
}
export type Change =
  | {
      readonly action: "add_claim";
      readonly claim: ClaimId;
      readonly statement: string;
      readonly dependsOn: readonly ClaimId[];
    }
  | {
      readonly action: "revise_claim";
      readonly claim: ClaimId;
      readonly replaces: ClaimId;
      readonly statement: string;
      readonly dependsOn: readonly ClaimId[];
    }
  | {
      readonly action: "drop_claim";
      readonly claim: ClaimId;
    }
  | {
      readonly action: "retain_claim";
      readonly claim: ClaimId;
    }
  | {
      readonly action: "add_route";
      readonly route: RouteId;
      readonly attempt: string;
      readonly outcome: string;
      readonly evidenceClaims: readonly ClaimId[];
      readonly retryCondition?: string | undefined;
    }
  | {
      readonly action: "revise_route";
      readonly route: RouteId;
      readonly replaces: RouteId;
      readonly attempt: string;
      readonly outcome: string;
      readonly evidenceClaims: readonly ClaimId[];
      readonly retryCondition?: string | undefined;
    }
  | {
      readonly action: "drop_route";
      readonly route: RouteId;
    }
  | {
      readonly action: "retain_route";
      readonly route: RouteId;
    };
export interface Action {
  readonly action: "continue";
  readonly changes: readonly Change[];
}

function serial(id: string, kind: "claim" | "route"): number {
  return Number(id.slice(kind.length + 1));
}

function targetOf(change: Change): ClaimId | RouteId | undefined {
  if (change.action === "revise_claim") return change.replaces;
  if (change.action === "drop_claim" || change.action === "retain_claim")
    return change.claim;
  if (change.action === "revise_route") return change.replaces;
  if (change.action === "drop_route" || change.action === "retain_route")
    return change.route;
  return undefined;
}

const prefix = `${applicationId}/${protocolName}`;

export function callRole(label: string): string {
  const start = `${prefix}/`;
  return label.startsWith(start)
    ? label.slice(start.length).split("/", 1)[0]!
    : label;
}

export function callActivity(label: string): {
  readonly role: string;
  readonly triggerCall?: EntryId;
  readonly audit?: {
    readonly target: "admission" | "resolution" | "delivery";
    readonly method: string;
    readonly stage?: "assemble" | "derive" | "assess";
    readonly items?: readonly (ClaimId | RouteId)[];
  };
} {
  const start = `${prefix}/`;
  if (!label.startsWith(start)) return { role: label };
  const parts = label.slice(start.length).split("/");
  const fallback = { role: callRole(label) };
  if (parts[0] === "coordinator") {
    const trigger = entryIdSchema.safeParse(Number(parts[1]));
    if (parts.length !== 2 || !trigger.success) return fallback;
    return {
      role: "coordinator",
      triggerCall: trigger.data,
    };
  }
  if (parts[0] === "explorer") {
    if (parts.length !== 2) return fallback;
    if (parts[1] === "initial") return { role: "explorer" };
    const trigger = entryIdSchema.safeParse(Number(parts[1]));
    if (!trigger.success) return fallback;
    return {
      role: "explorer",
      triggerCall: trigger.data,
    };
  }
  if (parts[0] === "audit" && parts[1] === "admission") {
    const trigger = entryIdSchema.safeParse(Number(parts[2]));
    const method = roleName.safeParse(parts[3]);
    const items = z
      .array(z.union([claimIdSchema, routeIdSchema]))
      .nonempty()
      .safeParse(parts[4]?.split(","));
    if (
      parts.length !== 5 ||
      !trigger.success ||
      !method.success ||
      !items.success ||
      new Set(items.data).size !== items.data.length
    ) {
      return fallback;
    }
    return {
      role: "admission-audit",
      triggerCall: trigger.data,
      audit: {
        target: "admission",
        method: method.data,
        items: items.data,
      },
    };
  }
  if (parts[0] === "audit" && parts[1] === "resolution") {
    const method = resolutionMethod.safeParse(parts[2]);
    const derives =
      parts[3] === "derive" &&
      (parts.length === 4 || (parts.length === 5 && parts[4] === "retry"));
    if (
      !method.success ||
      (parts.length !== 3 && !derives) ||
      (derives && method.data !== "reconstruction")
    ) {
      return fallback;
    }
    return {
      role: "resolution-audit",
      audit: {
        target: "resolution",
        method: method.data,
        stage: derives ? "derive" : "assess",
      },
    };
  }
  if (parts[0] === "delivery" && parts[1] === "assemble") {
    return parts.length === 2 ? { role: "delivery-assembler" } : fallback;
  }
  if (parts[0] === "audit" && parts[1] === "delivery") {
    return parts.length === 2
      ? {
          role: "delivery-audit",
          audit: { target: "delivery", method: "delivery-audit" },
        }
      : fallback;
  }
  return fallback;
}

export function coordinatorLabel(source: number): string {
  return `${prefix}/coordinator/${entryIdSchema.parse(source)}`;
}

export function explorerLabel(action?: number): string {
  return `${prefix}/explorer/${action === undefined ? "initial" : entryIdSchema.parse(action)}`;
}

export function admissionAuditLabel(
  action: number,
  auditor: string,
  items: readonly (ClaimId | RouteId)[],
): string {
  const parsedItems = z
    .array(z.union([claimIdSchema, routeIdSchema]))
    .nonempty()
    .parse(items);
  if (new Set(parsedItems).size !== parsedItems.length) {
    throw new Error("admission audit items must be unique");
  }
  return `${prefix}/audit/admission/${entryIdSchema.parse(action)}/${roleName.parse(auditor)}/${parsedItems.join(",")}`;
}

export function auditorMethod(
  auditor:
    | { readonly kind: VerifierKind }
    | { readonly kind: "template"; readonly name: string },
): string {
  return auditor.kind === "template" ? auditor.name : auditor.kind;
}

const resolutionMethod = z.union([z.enum(verifierKinds), templateAuditorName]);

export function resolutionAuditLabel(auditor: string): string {
  return `${prefix}/audit/resolution/${resolutionMethod.parse(auditor)}`;
}

export function reconstructionLabel(attempt: 1 | 2 = 1): string {
  const base = `${resolutionAuditLabel("reconstruction")}/derive`;
  return attempt === 1 ? base : `${base}/retry`;
}

export function deliveryAssemblyLabel(): string {
  return `${prefix}/delivery/assemble`;
}

export function deliveryAuditLabel(): string {
  return `${prefix}/audit/delivery`;
}

export function renderTask(
  task: Pick<Task, "problem" | "completionCriteria">,
): string {
  return `Problem:\n${task.problem}\n\nCompletion criteria:\n${task.completionCriteria}`;
}
