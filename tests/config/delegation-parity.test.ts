import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  MAX_CHILD_ORCHESTRATOR_DEPTH,
  MAX_HOST_SESSION_DEPTH,
  ROLE_CONTRACTS,
  ROLE_DELEGATION_EDGES,
  type RoleName,
} from "../../.opencode/lib/contracts.js";

const installer = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/install.mjs")).href
) as {
  nativeManagedPermissionRules: (permissionMap: Record<string, unknown>) =>
    Array<{ action: string; resource: string; effect: string }>;
};

const managedConfigModule = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/managed-config.mjs")).href
) as {
  MANAGED_CONFIG: {
    agent: Record<string, { permission?: Record<string, string | Record<string, string>> }>;
  };
  MANAGED_HOST_SESSION_DEPTH: number;
};
const config = managedConfigModule.MANAGED_CONFIG;

function taskRules(agentName: string): Record<string, string> {
  const task = config.agent[agentName]?.permission?.task;
  return typeof task === "object" && task !== null ? task : {};
}

const MANAGED_FIXED_ROLES = [
  "command-lead",
  "plan-builder",
  "deep-plan-builder",
  "task-lead",
  "explore",
  "librarian",
  "plan-review",
  "result-review",
] as const satisfies readonly RoleName[];

function expectedTaskMap(role: RoleName): Record<string, string> {
  // Deny catch-all first (last-match-wins propagates both dialects), then the
  // contract edges in contract order.
  return {
    "*": "deny",
    ...Object.fromEntries(ROLE_DELEGATION_EDGES[role].map((target) => [target, "allow"])),
  };
}

describe("delegation-edge parity between role contracts and managed permission maps", () => {
  it("serializes every fixed role's permission.task map exactly from ROLE_DELEGATION_EDGES", () => {
    for (const role of MANAGED_FIXED_ROLES) {
      expect(taskRules(role), role).toEqual(expectedTaskMap(role));
      expect(Object.keys(taskRules(role))[0], `${role} deny-first`).toBe("*");
    }
  });

  it("keeps the disabled hidden build/plan overrides deny-all outside the contract edges", () => {
    for (const override of ["build", "plan"]) {
      expect(taskRules(override), override).toEqual({ "*": "deny" });
      expect(config.agent[override]?.permission?.["*"], `${override} fully denied`).toBe("deny");
    }
  });

  it("keeps the contract edge set small, acyclic, and free of self-delegation", () => {
    const roles = ROLE_CONTRACTS.map((role) => role.name);
    for (const [role, targets] of Object.entries(ROLE_DELEGATION_EDGES)) {
      expect(roles, `unknown edge source ${role}`).toContain(role);
      for (const target of targets) {
        expect(roles, `unknown edge target ${target}`).toContain(target);
        expect(target, `${role} has no self-delegation`).not.toBe(role);
      }
    }

    // Acyclic check: no role may reach itself through a chain of >= 1 edges.
    const reaches = (from: RoleName, via: RoleName, seen: Set<RoleName>): boolean =>
      (ROLE_DELEGATION_EDGES[via] ?? []).some(
        (t) => t === from || (!has(seen, t) && reaches(from, t, new Set([...seen, t]))),
      );
    const has = (set: Set<RoleName>, value: RoleName) => set.has(value);
    for (const role of roles) {
      expect(reaches(role, role, new Set()), `${role} edge graph is acyclic`).toBe(false);
    }
  });

  it("preserves plan constraints: reviewers keep explore only and retrieval roles delegate nothing", () => {
    expect(ROLE_DELEGATION_EDGES["plan-review"]).toEqual(["explore"]);
    expect(ROLE_DELEGATION_EDGES["result-review"]).toEqual(["explore"]);
    expect(ROLE_DELEGATION_EDGES.explore).toEqual([]);
    expect(ROLE_DELEGATION_EDGES.librarian).toEqual([]);
    expect(ROLE_DELEGATION_EDGES["task-lead"]).toEqual(["explore", "librarian"]);
    // command-lead spans the full skeleton (all seven other roles).
    expect([...ROLE_DELEGATION_EDGES["command-lead"]].sort()).toEqual(MANAGED_FIXED_ROLES.filter((r) => r !== "command-lead").sort());
  });

  it("projects task edges to native v2 subagent rules preserving deny-first order", () => {
    const rules = installer.nativeManagedPermissionRules({ task: taskRules("task-lead") });
    expect(rules[0]).toEqual({ action: "subagent", resource: "*", effect: "deny" });
    expect(rules).toEqual([
      { action: "subagent", resource: "*", effect: "deny" },
      { action: "subagent", resource: "explore", effect: "allow" },
      { action: "subagent", resource: "librarian", effect: "allow" },
    ]);
  });

  it("locks the bounded host session depth constant across contracts and managed config", () => {
    expect(MAX_HOST_SESSION_DEPTH).toBe(3);
    expect(managedConfigModule.MANAGED_HOST_SESSION_DEPTH).toBe(3);
    // Session depth and child-orchestrator depth stay distinct concepts.
    expect(MAX_HOST_SESSION_DEPTH).toBeGreaterThan(MAX_CHILD_ORCHESTRATOR_DEPTH);
  });
});
