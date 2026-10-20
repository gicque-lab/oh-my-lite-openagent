import { describe, expect, it } from "vitest";
import {
  applyLiteRoleModelConfig,
  applyLiteRoleReasoningEffortConfig,
  createDefaultLiteConfig,
  listAgentModelPreferences,
  migrateLiteConfigFromOpenCodeConfig,
  readLiteConfig,
  withLiteConfigAppliedToOpenCodeConfig,
  type LiteOpenAgentConfig,
} from "../../.opencode/lib/runtime/lite-config.js";
import { parseJsonConfig } from "../../.opencode/lib/runtime/jsonc.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/compat-config");

function loadFixture(name: string): Record<string, unknown> {
  return parseJsonConfig(readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

function cloneFixture(name: string): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadFixture(name))) as Record<string, unknown>;
}

describe("one-time migration reads effective entries", () => {
  it("reads native agents over shadowed legacy entries on mixed configs", () => {
    // True same-name shadowing: native `agents` wins per name.
    const shadowed = migrateLiteConfigFromOpenCodeConfig({
      agent: { "command-lead": { model: "legacy/model" } },
      agents: { "command-lead": { model: "native/model" } },
    });
    expect(shadowed.roleModels["command-lead"]).toBe("native/model");

    // mixed.json: each name is read from its own dialect container.
    const liteConfig = migrateLiteConfigFromOpenCodeConfig(loadFixture("mixed.json"));
    expect(liteConfig.roleModels["command-lead"]).toBe("legacy/model");
  });

  it("skips disabled and hidden native agent overrides", () => {
    const liteConfig = migrateLiteConfigFromOpenCodeConfig(loadFixture("native-agent-overrides.jsonc"));

    // native-agent-overrides.jsonc disables command-lead and hides build;
    // neither may seed a stored preference.
    expect(liteConfig.roleModels["command-lead"]).toBeUndefined();
    expect(liteConfig.roleReasoningEffort["command-lead"]).toBeUndefined();
  });

  it("never lets migration defaults overwrite existing lite-config choices", () => {
    const existing: LiteOpenAgentConfig = createDefaultLiteConfig();
    existing.roleModels["command-lead"] = "explicit/applied-model";
    existing.roleReasoningEffort["explore"] = "high";

    const liteConfig = migrateLiteConfigFromOpenCodeConfig(loadFixture("mixed.json"), existing);

    expect(liteConfig.roleModels["command-lead"]).toBe("explicit/applied-model");
    expect(liteConfig.roleReasoningEffort["explore"]).toBe("high");
  });

  it("preserves an explicit #variant through migration", () => {
    const config: Record<string, unknown> = {
      agents: {
        explore: { model: "opencode-go/glm-5.3-flash#low" },
      },
    };

    const liteConfig = migrateLiteConfigFromOpenCodeConfig(config);

    expect(liteConfig.roleModels.explore).toBe("opencode-go/glm-5.3-flash#low");
  });
});

describe("projecting lite config into the effective container", () => {
  it("writes managed roles into the native agents map without adding legacy fields", () => {
    const effective = withLiteConfigAppliedToOpenCodeConfig(loadFixture("native.jsonc"), {
      ...createDefaultLiteConfig(),
      roleModels: { explore: "openai/gpt-5.4-mini" },
      roleReasoningEffort: { explore: "low" },
    });

    const agents = effective["agents"] as Record<string, Record<string, unknown>>;
    expect(agents["explore"]).toMatchObject({ model: "openai/gpt-5.4-mini", reasoningEffort: "low" });
    // No v1 tuple/plugin fields may appear inside native entries.
    expect("agent" in effective).toBe(false);
    expect(JSON.stringify(agents["explore"])).not.toContain('"plugin"');
    // Unrelated native entries survive untouched.
    expect(agents["custom-native"]).toMatchObject({ system: "Custom native agent." });
  });

  it("targets the effective native entry on mixed configs instead of shadowed legacy fields", () => {
    const effective = withLiteConfigAppliedToOpenCodeConfig(loadFixture("mixed.json"), {
      ...createDefaultLiteConfig(),
      roleModels: { "command-lead": "updated/model" },
    });

    const nativeAgents = effective["agents"] as Record<string, Record<string, unknown>>;
    expect(nativeAgents["command-lead"]).toMatchObject({ model: "updated/model" });
    // The shadowed legacy entry is user data and passes through untouched.
    expect(effective["agent"]).toMatchObject({
      "command-lead": { model: "legacy/model" },
    });
  });

  it("keeps unrelated top-level fields and provider keys intact", () => {
    const config = cloneFixture("native.jsonc");
    const before = JSON.stringify(config["providers"]);
    const beforeModel = config["model"];

    const effective = withLiteConfigAppliedToOpenCodeConfig(config, {
      ...createDefaultLiteConfig(),
      roleModels: { librarian: "openai/gpt-5.4-mini" },
    });

    expect(JSON.stringify(effective["providers"])).toEqual(before);
    expect(effective["model"]).toEqual(beforeModel);
  });
});

describe("apply stores requested preferences without losing explicit variants", () => {
  it("stores the full reference including the variant and validates the base separately", () => {
    const liteConfig = createDefaultLiteConfig();
    const result = applyLiteRoleModelConfig(
      liteConfig,
      { "command-lead": "opencode-go/glm-5.3-flash#high" },
      ["opencode-go/glm-5.3-flash"],
    );

    // Explicit variant variant passes pool validation via its base id...
    expect(result.skipped).toEqual([]);
    expect(liteConfig.roleModels["command-lead"]).toBe("opencode-go/glm-5.3-flash#high");

    // ...but a genuinely unknown base is still rejected, variant or not.
    const unknown = applyLiteRoleModelConfig(
      createDefaultLiteConfig(),
      { explore: "nosuch/no-model#low" },
      ["opencode-go/glm-5.3-flash"],
    );
    expect(unknown.skipped).toEqual([
      { role: "explore", reason: "model is not in the imported model pool" },
    ]);
  });

  it("validates the base model separately from a malformed variant", () => {
    const liteConfig = createDefaultLiteConfig();
    const result = applyLiteRoleModelConfig(
      liteConfig,
      { explore: "opencode-go/glm-5.3-flash#" },
      ["opencode-go/glm-5.3-flash"],
    );

    // A present-but-empty variant is rejected, never silently discarded.
    expect(result.skipped).toEqual([{ role: "explore", reason: "model must use provider/model format" }]);
    expect(liteConfig.roleModels.explore).toBeUndefined();
  });
});

describe("normalized preferences for the v2 request-hook consumer", () => {
  it("distinguishes stored, selected, and conflicting values", () => {
    const liteConfig: LiteOpenAgentConfig = {
      ...createDefaultLiteConfig(),
      roleModels: {
        "command-lead": "opencode-go/glm-5.3-flash#high",
        explore: "openai/gpt-5.4-mini",
      },
      roleReasoningEffort: {
        // Conflicts with command-lead's explicit variant.
        "command-lead": "low",
        explore: "low",
      },
      taskLeadProfiles: {
        code: { model: "openai/gpt-5.4", reasoningEffort: "medium" },
      },
    };

    const preferences = listAgentModelPreferences(liteConfig);

    const commandLead = preferences.find((p) => p.agentId === "command-lead");
    expect(commandLead).toMatchObject({
      kind: "role",
      storedModel: "opencode-go/glm-5.3-flash#high",
      baseModel: "opencode-go/glm-5.3-flash",
      selectedVariant: "high",
      storedReasoningEffort: "low",
      reasoningConflict: true,
    });

    const explore = preferences.find((p) => p.agentId === "explore");
    expect(explore).toMatchObject({
      kind: "role",
      storedModel: "openai/gpt-5.4-mini",
      storedReasoningEffort: "low",
      reasoningConflict: false,
    });
    expect(explore?.selectedVariant).toBeUndefined();

    const code = preferences.find((p) => p.agentId === "code");
    expect(code).toMatchObject({ kind: "task-lead-profile", reasoningConflict: false });

    // Roles without any stored preference are omitted.
    expect(preferences.find((p) => p.agentId === "librarian")).toBeUndefined();
  });

  it("round-trips through readLiteConfig without losing variants or conflicts", () => {
    const stored = {
      schemaVersion: 1,
      roleModels: { "plan-review": "google/gemini-3-flash#xhigh" },
      roleReasoningEffort: { "plan-review": "high" },
      taskLeadProfiles: {},
    };

    const preferences = listAgentModelPreferences(readLiteConfig(stored));

    expect(preferences.find((p) => p.agentId === "plan-review")).toMatchObject({
      storedModel: "google/gemini-3-flash#xhigh",
      selectedVariant: "xhigh",
      storedReasoningEffort: "high",
      reasoningConflict: true,
    });
  });
});

describe("reasoning effort application", () => {
  it("normalizes spellings and records the raw requested value when normalization is needed", () => {
    const liteConfig = createDefaultLiteConfig();
    const normalized = applyLiteRoleReasoningEffortConfig(liteConfig, { explore: "VERY_HIGH" });
    expect(normalized.changed).toEqual([{ role: "explore", next: "xhigh" }]);
    expect(liteConfig.roleReasoningEffort.explore).toBe("xhigh");

    const fallbackResult = applyLiteRoleReasoningEffortConfig(createDefaultLiteConfig(), {
      explore: "bad-value",
    });
    expect(fallbackResult.changed).toEqual([
      { role: "explore", next: "low", requested: "bad-value" },
    ]);
  });
});
