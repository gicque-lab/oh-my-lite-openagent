import { describe, expect, it } from "vitest";
import {
  type SpecialistAgentConfig,
  buildSpecialistFrontmatter,
  generateSpecialistEditPermissions,
  isReservedRoleName,
  normalizeSpecialistConfig,
  validateSpecialistConfig,
  validateSpecialistName,
} from "../../.opencode/lib/runtime/specialist-registry.js";

describe("Specialist Registry - Name Validation", () => {
  it("accepts valid alphanumeric, hyphenated, and underscored lowercase identifiers", () => {
    expect(validateSpecialistName("security-audit")).toEqual({ valid: true });
    expect(validateSpecialistName("doc_reviewer")).toEqual({ valid: true });
    expect(validateSpecialistName("agent1")).toEqual({ valid: true });
    expect(validateSpecialistName("a-b_c-123")).toEqual({ valid: true });
  });

  it("rejects invalid characters, uppercase, and non-identifier patterns", () => {
    expect(validateSpecialistName("").valid).toBe(false);
    expect(validateSpecialistName("SecurityAudit").valid).toBe(false);
    expect(validateSpecialistName("doc reviewer").valid).toBe(false);
    expect(validateSpecialistName("doc/reviewer").valid).toBe(false);
    expect(validateSpecialistName("doc.reviewer").valid).toBe(false);
    expect(validateSpecialistName("-leading-hyphen").valid).toBe(false);
    expect(validateSpecialistName("_leading-underscore").valid).toBe(false);
  });

  it("identifies and rejects collisions with 8 core role names", () => {
    const coreRoles = [
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
      "task-lead",
      "explore",
      "librarian",
      "plan-review",
      "result-review",
    ];

    for (const role of coreRoles) {
      expect(isReservedRoleName(role)).toBe(true);
      const res = validateSpecialistName(role);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("reserved core role");
    }
  });

  it("identifies and rejects collisions with built-in overrides (build, plan)", () => {
    for (const role of ["build", "plan"]) {
      expect(isReservedRoleName(role)).toBe(true);
      const res = validateSpecialistName(role);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("reserved");
    }
  });
});

describe("Specialist Registry - Config Validation & Normalization", () => {
  it("validates a complete and correct specialist config", () => {
    const raw = {
      name: "security-auditor",
      description: "Performs static vulnerability audits on source code.",
      model: "anthropic/claude-sonnet-4-6",
      reasoningEffort: "high",
      editFolders: ["docs", "reports/**"],
      prompt: "Perform strict OWASP code analysis.",
      allowBash: false,
    };

    const res = validateSpecialistConfig(raw);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.config).toEqual({
      name: "security-auditor",
      description: "Performs static vulnerability audits on source code.",
      model: "anthropic/claude-sonnet-4-6",
      reasoningEffort: "high",
      editFolders: ["docs", "reports/**"],
      prompt: "Perform strict OWASP code analysis.",
      allowBash: false,
    });
  });

  it("normalizes reasoningEffort aliases and handles optional fields", () => {
    const normalized = normalizeSpecialistConfig({
      name: "doc-sync",
      description: "Synchronizes markdown documentation.",
      reasoningEffort: "extra-high",
      editFolders: ["docs/"],
    });

    expect(normalized).toBeDefined();
    expect(normalized?.reasoningEffort).toBe("xhigh");
    expect(normalized?.allowBash).toBe(false);
    expect(normalized?.editFolders).toEqual(["docs/"]);
  });

  it("rejects invalid configurations with missing or invalid fields", () => {
    expect(validateSpecialistConfig(null).valid).toBe(false);
    expect(validateSpecialistConfig({}).valid).toBe(false);
    expect(validateSpecialistConfig({ name: "valid-name" }).valid).toBe(false); // missing description
    expect(
      validateSpecialistConfig({
        name: "valid-name",
        description: 123,
      }).valid,
    ).toBe(false);
    expect(
      validateSpecialistConfig({
        name: "command-lead",
        description: "Test description",
      }).valid,
    ).toBe(false);
  });
});

describe("Specialist Registry - Permission Normalization", () => {
  it("returns deny-all when editFolders is omitted or empty", () => {
    expect(generateSpecialistEditPermissions()).toEqual({ "*": "deny" });
    expect(generateSpecialistEditPermissions([])).toEqual({ "*": "deny" });
  });

  it("returns allow-all when wildcard is specified", () => {
    expect(generateSpecialistEditPermissions(["*"])).toEqual({ "*": "allow" });
    expect(generateSpecialistEditPermissions(["**"])).toEqual({ "*": "allow" });
  });

  it("dual-expands specified directory folders with deny-first ordering", () => {
    const permissions = generateSpecialistEditPermissions(["docs"]);
    const keys = Object.keys(permissions);

    expect(keys[0]).toBe("*");
    expect(permissions["*"]).toBe("deny");
    expect(permissions["docs/**"]).toBe("allow");
    expect(permissions["**/docs/**"]).toBe("allow");
  });

  it("cleans paths, strips wildcards/slashes, and dual-expands multiple folders", () => {
    const permissions = generateSpecialistEditPermissions([
      "/docs/",
      "src/security/**",
      "reports/*",
    ]);

    expect(Object.keys(permissions)[0]).toBe("*");
    expect(permissions).toEqual({
      "*": "deny",
      "docs/**": "allow",
      "**/docs/**": "allow",
      "src/security/**": "allow",
      "**/src/security/**": "allow",
      "reports/**": "allow",
      "**/reports/**": "allow",
    });
  });

  it("deduplicates equivalent paths in editFolders", () => {
    const permissions = generateSpecialistEditPermissions([
      "docs",
      "docs/",
      "docs/**",
      "/docs/**",
    ]);

    expect(permissions).toEqual({
      "*": "deny",
      "docs/**": "allow",
      "**/docs/**": "allow",
    });
  });
});

describe("Specialist Registry - Frontmatter Generation", () => {
  it("generates valid OpenCode subagent frontmatter with leaf worker invariants", () => {
    const config: SpecialistAgentConfig = {
      name: "sec-review",
      description: "Automated security checklist review.",
      model: "anthropic/claude-sonnet-4-6",
      reasoningEffort: "high",
      editFolders: ["docs", "security-reports"],
      allowBash: false,
    };

    const frontmatter = buildSpecialistFrontmatter(config);

    expect(frontmatter.mode).toBe("subagent");
    expect(frontmatter.hidden).toBe(true);
    expect(frontmatter.description).toBe("Automated security checklist review.");
    expect(frontmatter.model).toBe("anthropic/claude-sonnet-4-6");
    expect(frontmatter.reasoningEffort).toBe("high");

    const permission = frontmatter.permission as Record<string, unknown>;
    expect(permission.task).toEqual({ "*": "deny" });
    expect(permission.question).toBe("deny");
    expect(permission.bash).toEqual({ "*": "deny" });
    expect(permission.edit).toEqual({
      "*": "deny",
      "docs/**": "allow",
      "**/docs/**": "allow",
      "security-reports/**": "allow",
      "**/security-reports/**": "allow",
    });
  });

  it("allows bash explicitly when allowBash is true", () => {
    const config: SpecialistAgentConfig = {
      name: "bash-tester",
      description: "Performs integration command tests.",
      allowBash: true,
    };

    const frontmatter = buildSpecialistFrontmatter(config);
    const permission = frontmatter.permission as Record<string, unknown>;

    expect(permission.bash).toEqual({ "*": "allow" });
    expect(permission.task).toEqual({ "*": "deny" });
    expect(permission.question).toBe("deny");
  });
});
