import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import type { ToolContext } from "@opencode-ai/plugin";

function tctx(ctx: { directory?: string; worktree?: string } = {}): ToolContext {
  const directory = ctx.directory ?? process.cwd();
  return {
    sessionID: "ses-test",
    messageID: "msg-test",
    agent: "task-lead",
    directory,
    worktree: ctx.worktree ?? directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: () => Promise.resolve(),
  };
}
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dagPayload = {
  plan: {
    subtasks: [{
      id: "implement",
      depends_on: [],
      attributes: ["code"],
      deliverable: "Implemented change",
      description: "Implement and test the change",
    }],
  },
};

describe("reasoning effort DAG integration", () => {
  it("reloads configured profile reasoning effort for DAG and readiness dispatch", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-reasoning-dag-"));

    try {
      await writeFile(
        path.join(configDir, "opencode.json"),
        `${JSON.stringify({ agent: {} })}\n`,
      );
      const liteConfigPath = path.join(configDir, "oh-my-lite-openagent.json");
      await writeFile(
        liteConfigPath,
        `${JSON.stringify({
          schemaVersion: 1,
          roleModels: {},
          roleReasoningEffort: {},
          taskLeadProfiles: {
            code: { reasoningEffort: "low" },
          },
        })}\n`,
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const context = tctx({ directory: process.cwd() });
      const firstRuntimeProfile = JSON.parse(String(await hooks.tool?.bounded_lite_runtime_profile?.execute(
        {},
        context,
      )));
      const firstDag = JSON.parse(String(await hooks.tool?.bounded_lite_plan_dag?.execute(
        { payload: dagPayload },
        context,
      )));
      const firstReadiness = JSON.parse(String(await hooks.tool?.bounded_lite_plan_readiness?.execute(
        {
          payload: {
            frontmatter: {
              plan_schema_version: "2.1",
              maturity_level: "M3",
              status: "reviewed",
            },
            goals: ["Implement the change"],
            scope_boundaries: ["Source files only"],
            acceptance_criteria: ["Tests pass"],
            phase_plan: ["Implement and verify"],
            plan: dagPayload.plan,
          },
        },
        context,
      )));

      expect(firstRuntimeProfile.taskLeadProfileReasoningEffort.code).toBe("low");
      expect(firstDag.nodes[0].dispatch.reasoningEffort).toBe("low");
      expect(firstReadiness.dag.nodes[0].dispatch.reasoningEffort).toBe("low");

      await writeFile(
        liteConfigPath,
        `${JSON.stringify({
          schemaVersion: 1,
          roleModels: {},
          roleReasoningEffort: {},
          taskLeadProfiles: {
            code: { reasoningEffort: "high" },
          },
        })}\n`,
      );

      const secondDag = JSON.parse(String(await hooks.tool?.bounded_lite_plan_dag?.execute(
        { payload: dagPayload },
        context,
      )));
      const secondReadiness = JSON.parse(String(await hooks.tool?.bounded_lite_plan_readiness?.execute(
        {
          payload: {
            frontmatter: {
              plan_schema_version: "2.1",
              maturity_level: "M3",
              status: "reviewed",
            },
            goals: ["Implement the change"],
            scope_boundaries: ["Source files only"],
            acceptance_criteria: ["Tests pass"],
            phase_plan: ["Implement and verify"],
            plan: dagPayload.plan,
          },
        },
        context,
      )));

      expect(secondDag.nodes[0].dispatch.reasoningEffort).toBe("high");
      expect(secondReadiness.dag.nodes[0].dispatch.reasoningEffort).toBe("high");
      expect(await readFile(liteConfigPath, "utf8")).toContain('"reasoningEffort":"high"');
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
