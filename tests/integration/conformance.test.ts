import {
  MAX_CHILD_ORCHESTRATOR_DEPTH,
  MAX_HOST_SESSION_DEPTH,
  PLANNER_CONTRACTS,
  ROLE_CONTRACTS,
  ROUTING_CATEGORIES,
} from "../../.opencode/lib/contracts.js";
import {
  createRuntimeProfile,
  validateArchitectureContracts,
  validateOrchestratorDepth,
} from "../../.opencode/lib/runtime/safety.js";
import { DELEGATION_GUIDANCE } from "../../.opencode/lib/runtime/bounded-lite-core.js";

describe("architecture conformance", () => {
  it("keeps the declared architecture invariants passing", () => {
    const findings = validateArchitectureContracts();
    expect(findings.every((finding) => finding.passed)).toBe(true);
  });

  it("keeps child orchestrator depth bounded at one", () => {
    expect(MAX_CHILD_ORCHESTRATOR_DEPTH).toBe(1);
    expect(validateOrchestratorDepth(1)).toBe(true);
    expect(validateOrchestratorDepth(2)).toBe(false);
  });

  it("keeps host session depth as a distinct bounded constant (C07)", () => {
    // Widening either constant must fail; the host session ceiling exists to
    // admit the deepest allowed chain and is never a second orchestrator layer.
    expect(MAX_HOST_SESSION_DEPTH).toBe(3);
    expect(MAX_CHILD_ORCHESTRATOR_DEPTH).toBe(1);
    expect(MAX_HOST_SESSION_DEPTH).not.toBe(MAX_CHILD_ORCHESTRATOR_DEPTH);
  });

  it("restricts delegation to the contract edges with no retrieval-role delegation", () => {
    for (const role of ROLE_CONTRACTS) {
      for (const target of role.mayDelegateTo) {
        expect(target === role.name, `${role.name} cannot self-delegate`).toBe(false);
      }
    }
    expect(ROLE_CONTRACTS.find((role) => role.name === "explore")?.mayDelegateTo).toEqual([]);
    expect(ROLE_CONTRACTS.find((role) => role.name === "librarian")?.mayDelegateTo).toEqual([]);
  });

  it("keeps hidden-role delegation guidance scoped to the fixed role allowlist", () => {
    const hidden = ["task-lead", "explore", "librarian", "plan-review", "result-review"];
    for (const id of hidden) {
      expect(DELEGATION_GUIDANCE, `guidance supplies hidden ${id}`).toContain(id);
    }
    // Hidden disabled overrides are never offered as dispatch targets.
    expect(DELEGATION_GUIDANCE).toContain("build/plan overrides stay disabled");
    // Guidance is edge-based, never a blanket permit.
    expect(DELEGATION_GUIDANCE).toContain("delegates nothing");
  });

  it("keeps routing categories small, stable, and mapped back to one runtime profile", () => {
    const profile = createRuntimeProfile({
      pluginEnabled: true,
      hooksEnabled: true,
      backgroundEnabled: true,
      bundledMcpEnabled: false,
    });

    expect(ROUTING_CATEGORIES).toEqual([
      "execution",
      "planning",
      "deep-planning",
      "explore",
      "librarian",
      "plan-review",
      "result-review",
    ]);
    expect(profile.mode).toBe("full");
    expect(profile.visibleModes).toHaveLength(3);
  });

  it("keeps planner invocation semantics explicit without adding extra planner layers", () => {
    expect(PLANNER_CONTRACTS["plan-builder"]).toEqual({
      name: "plan-builder",
      supportedInvocations: ["discussion", "normalize"],
      internalOnlyInvocations: ["normalize"],
      requiresStableSkeleton: false,
      outputArtifactKind: "plan-skeleton",
      plannerModelProfile: "strong",
      targetExecutorProfile: "strong",
      planReview: "optional",
    });
    expect(PLANNER_CONTRACTS["deep-plan-builder"]).toEqual({
      name: "deep-plan-builder",
      supportedInvocations: ["discussion", "deep-plan"],
      internalOnlyInvocations: [],
      requiresStableSkeleton: false,
      outputArtifactKind: "detailed-plan",
      plannerModelProfile: "review-compensated",
      targetExecutorProfile: "lower-strength-compatible",
      planReview: "required",
    });
    expect(ROUTING_CATEGORIES).not.toContain("normalize");
    expect(ROUTING_CATEGORIES).not.toContain("discussion");
  });
});
