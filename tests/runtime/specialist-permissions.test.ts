import { buildSpecialistFrontmatter } from "../../.opencode/lib/runtime/specialist-registry.js";
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

describe("specialist permission integration", () => {
  it("keeps specialists as leaf workers with dual-expanded folder-scoped edits", () => {
    const frontmatter = buildSpecialistFrontmatter({
      name: "security-audit",
      description: "Audit security-sensitive changes.",
      editFolders: ["src/security"],
    });

    expect(frontmatter).toMatchObject({
      mode: "subagent",
      hidden: true,
      permission: {
        task: { "*": "deny" },
        question: "deny",
        edit: {
          "*": "deny",
          "src/security/**": "allow",
          "**/src/security/**": "allow",
        },
        bash: { "*": "deny" },
      },
    });
  });

  it("generates Command Lead delegation permission for configured specialists", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-specialist-permissions-"));

    try {
      await writeFile(
        path.join(configDir, "opencode.json"),
        `${JSON.stringify({ agent: { "command-lead": {} } })}\n`,
      );
      await writeFile(
        path.join(configDir, "oh-my-lite-openagent.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          roleModels: {},
          roleReasoningEffort: {},
          taskLeadProfiles: {},
          specialists: {
            "security-audit": {
              name: "security-audit",
              description: "Audit security-sensitive changes.",
              editFolders: ["src/security"],
            },
          },
        })}\n`,
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const listOutput = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "list" },
        tctx({ directory: process.cwd() }),
      );
      const runtimeProfile = JSON.parse(String(await hooks.tool?.bounded_lite_runtime_profile?.execute(
        {},
        tctx({ directory: process.cwd() }),
      )));

      expect(String(listOutput)).toContain("security-audit");
      expect(runtimeProfile.specialists).toEqual(["security-audit"]);
      await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          specialistAssignments: {
            "security-audit": { reasoningEffort: "high" },
          },
        },
        tctx({ directory: process.cwd() }),
      );

      const specialist = await readFile(path.join(configDir, "agents", "security-audit.md"), "utf8");
      const commandLead = await readFile(path.join(configDir, "agents", "command-lead.md"), "utf8");

      expect(specialist).toContain('task:\n    "*": deny');
      expect(specialist).toContain("question: deny");
      expect(specialist).toContain('edit:\n    "*": deny');
      expect(specialist).toContain('"src/security/**": allow');
      expect(specialist).toContain('"**/src/security/**": allow');
      expect(specialist).toContain('bash:\n    "*": deny');
      expect(commandLead).toContain("security-audit: allow");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
