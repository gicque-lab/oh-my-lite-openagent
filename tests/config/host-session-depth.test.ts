import path from "node:path";
import { pathToFileURL } from "node:url";

import { MAX_HOST_SESSION_DEPTH, MAX_CHILD_ORCHESTRATOR_DEPTH } from "../../.opencode/lib/contracts.js";

const installer = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/install.mjs")).href
) as {
  resolveHostSessionDepth: (
    config: Record<string, unknown>,
    isNativeTarget: boolean,
  ) => {
    configured: number | null;
    effectiveDepth: number;
    writeKey: "top" | "experimental";
    needsWrite: boolean;
    blocker: { key: string; configured: number; required: number; detail: string } | null;
  };
};

const depth = installer.resolveHostSessionDepth as (
  config: unknown,
  isNativeTarget: boolean,
) => {
  configured: number | null;
  effectiveDepth: number;
  writeKey: "top" | "experimental";
  needsWrite: boolean;
  blocker: { key: string; configured: number; required: number; detail: string } | null;
};

describe("managed host session depth (C07)", () => {
  it("writes the bounded default when no depth key exists on the user config", () => {
    // Fresh legacy config: v1 hosts honor only the dialect-appropriate key.
    const legacy = depth({}, false);
    expect(legacy).toMatchObject({ configured: null, effectiveDepth: 3, writeKey: "top", needsWrite: true, blocker: null });

    // Fresh native config: v2 honors experimental.subagent_depth (the
    // top-level key would only produce an "unsupported legacy setting"
    // diagnostic in the v2 normalizer).
    const native = depth({}, true);
    expect(native).toMatchObject({ configured: null, effectiveDepth: 3, writeKey: "experimental", needsWrite: true, blocker: null });
  });

  it("keeps a more permissive user setting and writes nothing", () => {
    expect(depth({ experimental: { subagent_depth: 5 } }, true)).toMatchObject({
      configured: 5,
      effectiveDepth: 5,
      writeKey: "experimental",
      needsWrite: false,
      blocker: null,
    });
    expect(depth({ subagent_depth: 4 }, false)).toMatchObject({
      configured: 4,
      writeKey: "top",
      needsWrite: false,
      blocker: null,
    });
  });

  it("keeps a stricter user setting and reports a precise blocker, never a silent raise", () => {
    const info = depth({ experimental: { subagent_depth: 1 } }, true);
    expect(info.effectiveDepth).toBe(1);
    expect(info.needsWrite).toBe(false);
    expect(info.blocker).not.toBeNull();
    expect(info.blocker?.key).toBe("experimental.subagent_depth");
    expect(info.blocker?.configured).toBe(1);
    expect(info.blocker?.required).toBe(MAX_HOST_SESSION_DEPTH);
    expect(info.blocker?.detail).toContain("command-lead -> deep-plan-builder -> plan-review -> explore");
    expect(info.blocker?.detail).toContain("kept unchanged");

    const legacy = depth({ subagent_depth: 2 }, false);
    expect(legacy.blocker?.key).toBe("subagent_depth");
    expect(legacy.blocker?.required).toBe(3);
  });

  it("reads the strictest of both keys regardless of dialect", () => {
    expect(depth({ subagent_depth: 5, experimental: { subagent_depth: 2 } }, false)).toMatchObject({
      configured: 2,
      needsWrite: false,
    });
    expect(depth({ subagent_depth: 9 }, true)).toMatchObject({ configured: 9, needsWrite: false, blocker: null });
  });

  it("keeps the depth distinct from the plugin child-orchestrator cap", () => {
    expect(MAX_HOST_SESSION_DEPTH).toBe(3);
    expect(MAX_CHILD_ORCHESTRATOR_DEPTH).toBe(1);
  });
});
