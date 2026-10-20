import { createRuntimeProfile } from "../../.opencode/lib/runtime/safety.js";
import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import type { ToolContext } from "@opencode-ai/plugin";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function degradedToolContext(directory: string): ToolContext {
  return {
    sessionID: "ses-test",
    messageID: "msg-test",
    agent: "task-lead",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: () => Promise.resolve(),
  };
}

describe("degraded mode", () => {
  it("preserves the visible architecture when optional runtime enhancements are off", () => {
    const profile = createRuntimeProfile({
      pluginEnabled: false,
      hooksEnabled: false,
      backgroundEnabled: false,
      bundledMcpEnabled: false,
    });

    expect(profile.mode).toBe("degraded");
    expect(profile.visibleModes).toEqual(["execution", "planning", "deep-planning"]);
    expect(profile.roleNames).toHaveLength(8);
    expect(profile.canonicalStates).toEqual([
      "draft",
      "needs-approval",
      "approved",
      "executing",
      "reviewed",
    ]);
  });
});

describe("degraded-mode tool behavior stays safe", () => {
  it("keeps validation, input checks and tool behavior intact without optional enhancements", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-degraded-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { mode: "degraded", enableHooks: false, enableBackground: false, enableBundledMcp: false, configDir },
      );

      expect(Object.keys(hooks.tool ?? {})).toHaveLength(9);

      // Input checks stay on line in degraded mode.
      await expect(hooks.tool?.bounded_lite_route?.execute(
        { category: "bogus" as never },
        degradedToolContext(process.cwd()),
      )).rejects.toThrow(/valid bounded routing category/);

      // Business tool behavior remains intact (direct tool call).
      const output = await hooks.tool?.bounded_lite_route?.execute(
        { category: "execution" as never },
        degradedToolContext(process.cwd()),
      );
      expect(JSON.parse(String(output))).toMatchObject({ targetRole: "command-lead" });

      // No host permission spoofing: no permission hook is registered in degraded mode either.
      expect((hooks as unknown as Record<string, unknown>)["permission.ask"]).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
