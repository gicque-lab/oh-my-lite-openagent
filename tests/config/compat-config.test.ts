import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  appendNativePermissionRules,
  detectConfigDialect,
  findManagedConfigConflicts,
  isManagedPluginEntry,
  MANAGED_PLUGIN_SPECS,
  managedPluginOptions,
  mergedAgentEntries,
  mergedProviderEntries,
  nativeMcpServers,
  parseModelReference,
  readNativePermissions,
  readPluginEntries,
  removeManagedPluginEntries,
  upsertManagedPluginEntry,
} from "../../.opencode/lib/compat/config.js";
import { parseJsonConfig } from "../../.opencode/lib/runtime/jsonc.js";

const installer = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/install.mjs")).href
) as {
  detectConfigDialect: typeof detectConfigDialect;
  managedPluginOptions: typeof managedPluginOptions;
  mergedAgentEntries: typeof mergedAgentEntries;
  mergedProviderEntries: typeof mergedProviderEntries;
  findManagedConfigConflicts: typeof findManagedConfigConflicts;
  removeManagedPluginEntries: typeof removeManagedPluginEntries;
  upsertManagedPluginEntry: typeof upsertManagedPluginEntry;
};

const FIXTURES_DIR = path.join(process.cwd(), "tests/fixtures/compat-config");

function loadFixture(name: string): Record<string, unknown> {
  return parseJsonConfig(readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

function cloneFixture(name: string): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadFixture(name))) as Record<string, unknown>;
}

const MANAGED_ROLE_NAMES = [
  "command-lead",
  "plan-builder",
  "deep-plan-builder",
  "task-lead",
  "explore",
  "librarian",
  "plan-review",
  "result-review",
  "build",
  "plan",
];

describe("config dialect detection", () => {
  it("classifies legacy, native, and mixed configurations by documented fields", () => {
    expect(detectConfigDialect(loadFixture("legacy.json"))).toEqual({
      dialect: "legacy",
      legacyKeys: ["plugin", "agent", "command", "permission", "provider"],
      nativeKeys: [],
    });
    expect(detectConfigDialect(loadFixture("native.jsonc"))).toEqual({
      dialect: "native",
      legacyKeys: [],
      nativeKeys: ["plugins", "agents", "commands", "permissions", "providers"],
    });
    expect(detectConfigDialect(loadFixture("mixed.json"))).toEqual({
      dialect: "mixed",
      legacyKeys: ["plugin", "agent", "command", "permission", "provider"],
      nativeKeys: ["plugins", "agents", "commands", "permissions", "providers"],
    });
  });

  it("never classifies by product version or $schema URL", () => {
    expect(detectConfigDialect({
      "$schema": "https://opencode.ai/config.json",
      "version": 2,
    })).toEqual({ dialect: "legacy", legacyKeys: [], nativeKeys: [] });
  });
});

describe("plugin entry boundary", () => {
  it("matches only exact managed specs, never paths merely containing the plugin file", () => {
    const entries = readPluginEntries(loadFixture("legacy.json"));

    expect(entries.map((entry) => entry.packageSpec)).toEqual([
      "./custom-a.ts",
      "../other/bounded-lite-copy.ts",
      "./.opencode/plugins/bounded-lite.ts",
    ]);
    const managed = entries.filter(isManagedPluginEntry);
    expect(managed).toHaveLength(1);
    expect(managed[0]).toMatchObject({
      container: "legacy",
      index: 2,
      options: { mode: "full", configDir: "/tmp/cfg-legacy" },
      removal: false,
    });

    expect(MANAGED_PLUGIN_SPECS).toContain("./.opencode/plugins/bounded-lite.ts");
    expect(readPluginEntries(loadFixture("native.jsonc")).map((entry) => entry.packageSpec)).toEqual([
      "./native-third-party.ts",
      "./.opencode/plugins/bounded-lite.ts",
      "/removed/third-party.ts",
    ]);
  });

  it("reads effective managed options with native precedence on mixed files", () => {
    expect(managedPluginOptions(loadFixture("legacy.json"))).toEqual({
      mode: "full",
      configDir: "/tmp/cfg-legacy",
    });
    expect(managedPluginOptions(loadFixture("native.jsonc"))).toEqual({
      mode: "full",
      configDir: "/tmp/cfg-native",
    });
    expect(managedPluginOptions(loadFixture("mixed.json"))).toEqual({
      mode: "full",
      configDir: "/tmp/cfg-native",
    });
  });

  it("removes exact managed entries while keeping user entries, removal entries, and lookalike paths", () => {
    const config = loadFixture("legacy.json");
    removeManagedPluginEntries(config);
    expect(config["plugin"]).toEqual([
      "./custom-a.ts",
      ["../other/bounded-lite-copy.ts", { evil: true }],
    ]);

    const removalUser = { plugins: ["./user.ts", `-${MANAGED_PLUGIN_SPECS[0]}`] };
    removeManagedPluginEntries(removalUser);
    expect(removalUser["plugins"]).toEqual(["./user.ts", `-${MANAGED_PLUGIN_SPECS[0]}`]);
  });

  it("upserts into the effective container without cross-format writes", () => {
    const options = { mode: "full", configDir: "/tmp/cfg-x" };

    // Fresh config defaults to the legacy tuple form.
    const fresh: Record<string, unknown> = {};
    upsertManagedPluginEntry(fresh, MANAGED_PLUGIN_SPECS[0]!, options);
    expect(fresh["plugin"]).toEqual([["./.opencode/plugins/bounded-lite.ts", options]]);
    expect("plugins" in fresh).toBe(false);

    // Legacy file: managed tuple replaced in place, position preserved.
    const legacy = loadFixture("legacy.json");
    upsertManagedPluginEntry(legacy, MANAGED_PLUGIN_SPECS[0]!, options);
    expect(legacy["plugin"]).toEqual([
      "./custom-a.ts",
      ["../other/bounded-lite-copy.ts", { evil: true }],
      ["./.opencode/plugins/bounded-lite.ts", options],
    ]);
    expect("plugins" in legacy).toBe(false);

    // Native file: object entry upserted in place.
    const native = loadFixture("native.jsonc");
    upsertManagedPluginEntry(native, MANAGED_PLUGIN_SPECS[0]!, options);
    expect(native["plugins"]).toEqual([
      "./native-third-party.ts",
      { package: "./.opencode/plugins/bounded-lite.ts", options },
      "-/removed/third-party.ts",
    ]);
    expect("plugin" in native).toBe(false);

    // Mixed file: the managed value lives only in the effective native
    // container; the shadowed legacy managed entry is removed.
    const mixed = loadFixture("mixed.json");
    upsertManagedPluginEntry(mixed, MANAGED_PLUGIN_SPECS[0]!, options);
    expect(mixed["plugin"]).toEqual([]);
    expect(mixed["plugins"]).toEqual([{ package: "./.opencode/plugins/bounded-lite.ts", options }]);
  });
});

describe("effective entry reads", () => {
  it("lets native agents shadow same-name legacy entries while keeping legacy-only names", () => {
    const merged = mergedAgentEntries(loadFixture("mixed.json"));
    expect(merged["custom-cmd"]).toEqual({ model: "openai/gpt-5.4-mini" });
    expect(merged["command-lead"]).toEqual({ model: "legacy/model", prompt: "legacy prompt" });
    expect(merged["custom-native"]).toEqual({ system: "native custom agent" });
  });

  it("merges provider entries with native precedence per provider name", () => {
    const merged = mergedProviderEntries(loadFixture("mixed.json"));
    expect(Object.keys(merged)).toEqual(["openai"]);
    expect(merged["openai"]).toMatchObject({ settings: { apiKey: "{env:TEST_NATIVE_KEY}" } });
  });

  it("reads the native mcp.servers container", () => {
    expect(nativeMcpServers(loadFixture("mixed.json"))).toMatchObject({ external: { command: ["external", "mcp"] } });
    expect(nativeMcpServers(loadFixture("legacy.json"))).toBeUndefined();
  });
});

describe("model references", () => {
  it("parses provider/model, explicit variants, and gateway forms without discarding either part", () => {
    expect(parseModelReference("anthropic/claude-sonnet-4-6#high")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      variant: "high",
      baseId: "anthropic/claude-sonnet-4-6",
      reference: "anthropic/claude-sonnet-4-6#high",
    });
    expect(parseModelReference("vercel/anthropic/claude-opus")).toEqual({
      provider: "vercel",
      model: "anthropic/claude-opus",
      baseId: "vercel/anthropic/claude-opus",
      reference: "vercel/anthropic/claude-opus",
    });
    expect(parseModelReference(" opencode-go/glm-5 ")).toMatchObject({
      provider: "opencode-go",
      model: "glm-5",
    });
  });

  it("rejects malformed references instead of silently discarding a variant", () => {
    expect(parseModelReference("no-slash")).toBeUndefined();
    expect(parseModelReference("/missing-provider")).toBeUndefined();
    expect(parseModelReference("openai/")).toBeUndefined();
    expect(parseModelReference("openai/gpt#")).toBeUndefined();
    expect(parseModelReference(42)).toBeUndefined();
    expect(parseModelReference("")).toBeUndefined();
  });
});

describe("native permission rules", () => {
  it("keeps the documented array order and flags unclassifiable entries", () => {
    const read = readNativePermissions(loadFixture("native.jsonc"));
    expect(read.malformed).toEqual([]);
    expect(read.rules.map((rule) => rule.action)).toEqual(["edit", "shell"]);
  });

  it("appends rules without reordering user entries and never spreads arrays", () => {
    const config: Record<string, unknown> = {
      permissions: [
        { action: "edit", resource: "*", effect: "allow" },
        { action: "shell", resource: "sudo", effect: "ask" },
      ],
    };
    appendNativePermissionRules(config, [{ action: "shell", resource: "my rule", effect: "allow" }]);

    expect(config["permissions"]).toEqual([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "sudo", effect: "ask" },
      { action: "shell", resource: "my rule", effect: "allow" },
    ]);
  });
});

describe("managed conflict detection", () => {
  it("reports native managed agent entries with exact locations and guidance", () => {
    const conflicts = findManagedConfigConflicts(loadFixture("native-agent-overrides.jsonc"), [
      "command-lead",
      "build",
      "explore",
    ]);

    expect(conflicts.map((conflict) => conflict.location)).toEqual([
      'agents."command-lead"',
      'agents."build"',
    ]);
    expect(conflicts.every((conflict) => conflict.kind === "native-managed-agent-entry")).toBe(true);
    expect(conflicts[0]!.guidance).toContain("agents\" map");
  });

  it("reports managed plugin removal entries as conflicts", () => {
    const conflicts = findManagedConfigConflicts(
      { plugins: [`-${MANAGED_PLUGIN_SPECS[0]}`, "./user.ts"] },
      [],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      location: `plugins[${JSON.stringify(`-${MANAGED_PLUGIN_SPECS[0]}`)}]`,
      kind: "managed-plugin-removal",
    });
  });

  it("reports native permission containers that cannot be classified", () => {
    expect(findManagedConfigConflicts({ permissions: { edit: "deny" } }, []).map((c) => c.kind)).toEqual([
      "native-permissions-shape",
    ]);
    expect(
      findManagedConfigConflicts({ permissions: ["deny", { notAnAction: true }] }, []).map((c) => c.location),
    ).toEqual(["permissions[0]", "permissions[1]"]);
  });
});

// ---------------------------------------------------------------------------
// Installer parity: scripts/install.mjs mirrors these helpers under plain
// Node; both sides must agree on every fixture and every mirrored helper.
// ---------------------------------------------------------------------------

const PARITY_FIXTURES = [
  "legacy.json",
  "native.jsonc",
  "mixed.json",
  "conflict-managed.json",
  "native-agent-overrides.jsonc",
];

describe("installer/runtime dialect helper parity", () => {
  it("classifies dialects identically on every fixture", () => {
    for (const name of PARITY_FIXTURES) {
      const config = loadFixture(name);
      expect(installer.detectConfigDialect(config), name).toEqual(detectConfigDialect(config));
    }
  });

  it("reads managed plugin options identically on every fixture", () => {
    for (const name of PARITY_FIXTURES) {
      const config = loadFixture(name);
      expect(installer.managedPluginOptions(config), name).toEqual(managedPluginOptions(config));
    }
  });

  it("merges agent and provider entries identically on every fixture", () => {
    for (const name of PARITY_FIXTURES) {
      const config = loadFixture(name);
      expect(installer.mergedAgentEntries(config), name).toEqual(mergedAgentEntries(config));
      expect(installer.mergedProviderEntries(config), name).toEqual(mergedProviderEntries(config));
    }
  });

  it("detects managed conflicts identically on every fixture", () => {
    for (const name of PARITY_FIXTURES) {
      const config = loadFixture(name);
      expect(
        installer.findManagedConfigConflicts(config, MANAGED_ROLE_NAMES),
        name,
      ).toEqual(findManagedConfigConflicts(config, MANAGED_ROLE_NAMES));
    }
  });

  it("removes and upserts managed plugin entries identically on every fixture", () => {
    const options = { mode: "full", configDir: "/tmp/parity" };
    for (const name of PARITY_FIXTURES) {
      const runtimeConfig = cloneFixture(name);
      const installerConfig = cloneFixture(name);

      removeManagedPluginEntries(runtimeConfig);
      upsertManagedPluginEntry(runtimeConfig, MANAGED_PLUGIN_SPECS[0]!, options);
      installer.removeManagedPluginEntries(installerConfig);
      installer.upsertManagedPluginEntry(installerConfig, MANAGED_PLUGIN_SPECS[0]!, options);

      expect(
        JSON.stringify({ plugin: installerConfig["plugin"], plugins: installerConfig["plugins"] }),
        name,
      ).toEqual(JSON.stringify({ plugin: runtimeConfig["plugin"], plugins: runtimeConfig["plugins"] }));
    }
  });
});
