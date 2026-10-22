export const VISIBLE_MODES = ["execution", "planning", "deep-planning"] as const;

export const ROUTING_CATEGORIES = [
  "execution",
  "planning",
  "deep-planning",
  "explore",
  "librarian",
  "plan-review",
  "result-review",
] as const;

export const CANONICAL_STATES = [
  "draft",
  "needs-approval",
  "approved",
  "executing",
  "reviewed",
] as const;

export const REVIEW_DECISIONS = ["pass", "reject", "escalate"] as const;
export const REVIEW_SEVERITIES = ["minor", "major"] as const;
export const REVIEW_SURFACES = ["plan", "result"] as const;

export const MAX_CHILD_ORCHESTRATOR_DEPTH = 1;
/**
 * Host session (subagent-nesting) ceiling for the managed default
 * configuration. Distinct from MAX_CHILD_ORCHESTRATOR_DEPTH (which bounds
 * plugin-internal child orchestrators): this value is what both host dialects
 * receive so the deepest existing allowed role chain
 * command-lead -> deep-plan-builder -> plan-review -> explore (three child
 * sessions below the entrypoint session, deepest dispatch at depth 2) stays
 * usable: hosts reject a dispatch when the calling session's ancestry depth is
 * >= the configured limit (v1: top-level `subagent_depth` config key; v2:
 * `experimental.subagent_depth`; both default to 1). Never silently raised
 * over a stricter user setting — a stricter value is kept and reported.
 */
export const MAX_HOST_SESSION_DEPTH = 3;
export const MAX_REVIEW_REVISION_ITERATIONS = 2;
export const TASK_DAG_MIN_CONCURRENCY = 3;
export const TASK_DAG_MAX_CONCURRENCY = 5;
export const TASK_DAG_DEFAULT_CONCURRENCY = 4;

export type VisibleMode = (typeof VISIBLE_MODES)[number];
export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];
export type CanonicalState = (typeof CANONICAL_STATES)[number];
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
export type ReviewSurface = (typeof REVIEW_SURFACES)[number];

export type RoleName =
  | "command-lead"
  | "plan-builder"
  | "deep-plan-builder"
  | "task-lead"
  | "explore"
  | "librarian"
  | "plan-review"
  | "result-review";

export type RoleVisibility = "visible" | "internal-only";
export type OpencodeMode = "primary" | "subagent" | "all";
export type PlannerRoleName = "plan-builder" | "deep-plan-builder";
export type PlannerInvocation = "discussion" | "normalize" | "deep-plan";
export type ReviewRequirement = "optional" | "required";
export type ReviewRoleName = "plan-review" | "result-review";

export interface RoleContract {
  name: RoleName;
  visibleMode?: VisibleMode;
  visibility: RoleVisibility;
  opencodeMode: OpencodeMode;
  hidden: boolean;
  mayDelegateTo: readonly RoleName[];
}

export interface PlannerContract {
  name: PlannerRoleName;
  supportedInvocations: readonly PlannerInvocation[];
  internalOnlyInvocations: readonly PlannerInvocation[];
  requiresStableSkeleton: boolean;
  outputArtifactKind: "plan-skeleton" | "detailed-plan";
  plannerModelProfile: "strong" | "review-compensated";
  targetExecutorProfile: "strong" | "lower-strength-compatible";
  planReview: ReviewRequirement;
}

export const ROLE_CONTRACTS: readonly RoleContract[] = [
  {
    name: "command-lead",
    visibleMode: "execution",
    visibility: "visible",
    opencodeMode: "primary",
    hidden: false,
    mayDelegateTo: [
      "plan-builder",
      "deep-plan-builder",
      "task-lead",
      "explore",
      "librarian",
      "plan-review",
      "result-review",
    ],
  },
  {
    name: "plan-builder",
    visibleMode: "planning",
    visibility: "visible",
    opencodeMode: "all",
    hidden: false,
    mayDelegateTo: ["explore", "librarian", "plan-review"],
  },
  {
    name: "deep-plan-builder",
    visibleMode: "deep-planning",
    visibility: "visible",
    opencodeMode: "all",
    hidden: false,
    mayDelegateTo: ["explore", "librarian", "plan-review"],
  },
  {
    name: "task-lead",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: ["explore", "librarian"],
  },
  {
    name: "explore",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: [],
  },
  {
    name: "librarian",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: [],
  },
  {
    name: "plan-review",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: ["explore"],
  },
  {
    name: "result-review",
    visibility: "internal-only",
    opencodeMode: "subagent",
    hidden: true,
    mayDelegateTo: ["explore"],
  },
] as const;

export const PLANNER_CONTRACTS: Readonly<Record<PlannerRoleName, PlannerContract>> = {
  "plan-builder": {
    name: "plan-builder",
    supportedInvocations: ["discussion", "normalize"],
    internalOnlyInvocations: ["normalize"],
    requiresStableSkeleton: false,
    outputArtifactKind: "plan-skeleton",
    plannerModelProfile: "strong",
    targetExecutorProfile: "strong",
    planReview: "optional",
  },
  "deep-plan-builder": {
    name: "deep-plan-builder",
    supportedInvocations: ["discussion", "deep-plan"],
    internalOnlyInvocations: [],
    requiresStableSkeleton: false,
    outputArtifactKind: "detailed-plan",
    plannerModelProfile: "review-compensated",
    targetExecutorProfile: "lower-strength-compatible",
    planReview: "required",
  },
};

export const REVIEW_ROLE_BY_SURFACE: Readonly<Record<ReviewSurface, ReviewRoleName>> = {
  plan: "plan-review",
  result: "result-review",
};

export function getRoleContract(roleName: RoleName): RoleContract {
  const contract = ROLE_CONTRACTS.find((item) => item.name === roleName);

  if (!contract) {
    throw new Error(`Unknown role contract: ${roleName}`);
  }

  return contract;
}

/**
 * Permitted delegation edges per role, keyed by role name (single source:
 * ROLE_CONTRACTS.mayDelegateTo). Managed permission.task maps and plugin
 * delegation guidance must stay in parity with this map; tests lock them
 * together (tests/config/delegation-parity.test.ts) — no runtime enforcement
 * is added inside the plugin because permission enforcement is the host's
 * (host-native allowlists; the plugin never replaces the subagent tool).
 */
export const ROLE_DELEGATION_EDGES: Readonly<Record<RoleName, readonly RoleName[]>> =
  Object.fromEntries(ROLE_CONTRACTS.map((role) => [role.name, role.mayDelegateTo])) as Readonly<
    Record<RoleName, readonly RoleName[]>
  >;

export function getPlannerContract(roleName: PlannerRoleName): PlannerContract {
  return PLANNER_CONTRACTS[roleName];
}
