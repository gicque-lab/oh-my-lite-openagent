import { describe, expect, it } from "vitest";
import {
  createDefaultLiteConfig,
  mergeLiteConfig,
  readLiteConfig,
} from "../../.opencode/lib/runtime/lite-config.js";

describe("Lite config specialist integration", () => {
  it("reads and normalizes configured specialists", () => {
    const config = readLiteConfig({
      schemaVersion: 1,
      specialists: {
        "security-audit": {
          name: "security-audit",
          description: "Audit source code for security issues.",
          model: "anthropic/claude-sonnet-4-6",
          reasoningEffort: "extra-high",
          editFolders: ["src/security/**"],
          allowBash: false,
        },
      },
    });

    expect(config.specialists).toEqual({
      "security-audit": {
        name: "security-audit",
        description: "Audit source code for security issues.",
        model: "anthropic/claude-sonnet-4-6",
        reasoningEffort: "xhigh",
        editFolders: ["src/security/**"],
        allowBash: false,
      },
    });
  });

  it("ignores invalid specialist entries without weakening the rest of the config", () => {
    const config = readLiteConfig({
      roleModels: {
        "command-lead": "openai/gpt-5.4",
      },
      specialists: {
        valid: {
          name: "valid",
          description: "A valid specialist.",
        },
        "command-lead": {
          name: "command-lead",
          description: "Reserved role collision.",
        },
        invalid: {
          name: "invalid",
          description: "",
        },
      },
    });

    expect(config.roleModels["command-lead"]).toBe("openai/gpt-5.4");
    expect(Object.keys(config.specialists ?? {})).toEqual(["valid"]);
  });

  it("merges specialist patches additively and preserves existing entries", () => {
    const current = mergeLiteConfig(createDefaultLiteConfig(), {
      specialists: {
        "doc-sync": {
          name: "doc-sync",
          description: "Synchronize documentation.",
          editFolders: ["docs"],
        },
      },
    });
    const merged = mergeLiteConfig(current, {
      specialists: {
        "security-audit": {
          name: "security-audit",
          description: "Audit security-sensitive code.",
          editFolders: ["src/security"],
        },
      },
    });

    expect(Object.keys(merged.specialists ?? {})).toEqual(["doc-sync", "security-audit"]);
    expect(merged.specialists?.["doc-sync"]?.editFolders).toEqual(["docs"]);
    expect(merged.specialists?.["security-audit"]?.editFolders).toEqual(["src/security"]);
  });
});
