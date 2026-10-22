import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import type { ToolContext } from "@opencode-ai/plugin";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function toolContext(directory: string): ToolContext {
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

describe("bounded_lite_background honesty (C07)", () => {
  it("tracks only the bounded coordinator, never host-native background jobs", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-background-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { mode: "degraded", enableHooks: false, enableBackground: false, enableBundledMcp: false, configDir },
      );
      const tool = hooks.tool?.bounded_lite_background;
      expect(tool).toBeDefined();

      // Description must scope tracking to this plugin's coordinator and must
      // not claim host-native background task coverage.
      expect(tool?.description).toContain("bounded coordinator");
      expect(tool?.description).toContain("host-native background jobs are not tracked");

      // Behavior must be the coordinator list only (empty when nothing registered).
      const output = await tool?.execute({}, toolContext(process.cwd()));
      const parsed = JSON.parse(String(output));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
