import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const PLAN_FIXTURES_DIR = fileURLToPath(new URL("../fixtures/plans/", import.meta.url));

async function loadStructuredPlanFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(PLAN_FIXTURES_DIR, "structured-plan.json"), "utf8"));
}

describe("plugin safety", () => {
  it("loads without touching the client during initialization", async () => {
    const client = new Proxy(
      {},
      {
        get() {
          throw new Error("client should not be touched during init");
        },
      },
    );

    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
        client,
      }),
    );

    expect(hooks).toBeTruthy();
  });

  it("registers only provider-safe namespaced custom tools", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    const toolNames = Object.keys(hooks.tool ?? {});
    expect(toolNames).not.toHaveLength(0);
    expect(toolNames).toContain("bounded_lite_plan_dag");
    expect(toolNames).toContain("bounded_lite_plan_readiness");
    expect(toolNames).toContain("bounded_lite_plan_artifact");
    expect(toolNames).toContain("bounded_lite_study_ingest");
    expect(toolNames).toContain("bounded_lite_study_package");
    expect(toolNames.every((toolName) => toolName.startsWith("bounded_lite_"))).toBe(true);
    expect(toolNames.every((toolName) => /^[a-zA-Z0-9_-]+$/.test(toolName))).toBe(true);
  });

  it("exposes explicit args shapes matching the nine-tool argument matrix", async () => {
    const hooks = await createBoundedLitePlugin({
      directory: process.cwd(),
    });

    const expectedToolKeys: Record<string, string[]> = {
      bounded_lite_route: ["category"],
      bounded_lite_plan_dag: ["dispatch", "payload"],
      bounded_lite_plan_readiness: ["dispatch", "payload"],
      bounded_lite_plan_artifact: [
        "action",
        "artifactKind",
        "content",
        "generatedBy",
        "generated_by",
        "markdown",
        "maturityLevel",
        "maturity_level",
        "overwrite",
        "path",
        "planId",
        "plan_id",
        "recommended_plan_path",
        "status",
        "title",
      ],
      bounded_lite_background: [],
      bounded_lite_runtime_profile: [],
      bounded_lite_study_ingest: ["allowExternalDirectory", "directory"],
      bounded_lite_study_package: ["allowExternalDirectory", "directory", "stage"],
      bounded_lite_model_config: [
        "action",
        "allowCodexBackend",
        "allowUnavailableModels",
        "assignments",
        "familyPreference",
        "policy",
        "profileAssignments",
        "profileReasoningEffortAssignments",
        "providerPreference",
        "reasoningAssignments",
        "reasoningEffortAssignments",
        "source",
        "specialistAssignments",
        "taskLeadProfileAssignments",
        "taskLeadProfileReasoningEffortAssignments",
      ],
    };

    const registeredTools = hooks.tool ?? {};
    const registeredNames = Object.keys(registeredTools).sort();
    const expectedNames = Object.keys(expectedToolKeys).sort();

    expect(registeredNames).toEqual(expectedNames);

    for (const [toolName, expectedKeys] of Object.entries(expectedToolKeys)) {
      const definition = registeredTools[toolName];
      expect(definition).toBeDefined();
      expect(definition?.args).toBeDefined();
      expect(typeof definition?.args).toBe("object");

      const actualKeys = Object.keys(definition?.args ?? {}).sort();
      expect(actualKeys).toEqual([...expectedKeys].sort());
    }
  });

  it("validates representative input payloads against tool argument schemas", async () => {
    const hooks = await createBoundedLitePlugin({
      directory: process.cwd(),
    });

    const tools = hooks.tool ?? {};

    // 1. bounded_lite_route: requires string category
    const routeSchema = tool.schema.object(tools.bounded_lite_route?.args as Record<string, any>);
    expect(routeSchema.safeParse({ category: "execution" }).success).toBe(true);
    expect(routeSchema.safeParse({}).success).toBe(false);
    expect(routeSchema.safeParse({ category: 123 }).success).toBe(false);

    // 2. bounded_lite_plan_dag: object-only payload (required), optional dispatch.
    //    Raw strings, arrays, null and missing payload are rejected at the wire.
    const planDagSchema = tool.schema.object(tools.bounded_lite_plan_dag?.args as Record<string, any>);
    expect(planDagSchema.safeParse({ payload: { plan: { subtasks: [] } } }).success).toBe(true);
    expect(planDagSchema.safeParse({ payload: { plan: { subtasks: [] } }, dispatch: { concurrency: 4 } }).success).toBe(true);
    expect(planDagSchema.safeParse({ payload: "raw-string-plan" }).success).toBe(false);
    expect(planDagSchema.safeParse({ payload: ["not", "an", "object"] }).success).toBe(false);
    expect(planDagSchema.safeParse({ payload: null }).success).toBe(false);
    expect(planDagSchema.safeParse({}).success).toBe(false);

    // 3. bounded_lite_plan_readiness: same object-only payload contract.
    const planReadinessSchema = tool.schema.object(tools.bounded_lite_plan_readiness?.args as Record<string, any>);
    expect(planReadinessSchema.safeParse({ payload: { frontmatter: { maturity_level: "M2" }, plan: { subtasks: [] } } }).success).toBe(true);
    expect(planReadinessSchema.safeParse({ payload: "markdown", dispatch: {} }).success).toBe(false);
    expect(planReadinessSchema.safeParse({ payload: JSON.stringify({ plan: { subtasks: [] } }) }).success).toBe(false);

    // 4. bounded_lite_plan_artifact: required title, optional markdown/content and aliases.
    //    The v1 raw-shape helper cannot express title-plus-one-of(markdown, content)
    //    at the root, so title-only stays schema-valid here; the cross-field rule is
    //    documented on the arg descriptions and enforced before any write by
    //    assertPlanArtifactWriteArgs (see handler execution tests below).
    const planArtifactSchema = tool.schema.object(tools.bounded_lite_plan_artifact?.args as Record<string, any>);
    expect(planArtifactSchema.safeParse({ title: "Test Plan" }).success).toBe(true);
    expect(
      planArtifactSchema.safeParse({
        title: "Test Plan",
        markdown: "# Content",
        action: "write",
        overwrite: true,
        plan_id: "plan-1",
      }).success,
    ).toBe(true);
    expect(
      planArtifactSchema.safeParse({
        title: "Test Plan",
        content: "# Content Alias",
        status: "reviewed",
      }).success,
    ).toBe(true);
    expect(planArtifactSchema.safeParse({ markdown: "# Missing Title" }).success).toBe(false);
    expect(planArtifactSchema.safeParse({ title: "Test Plan", action: "delete", markdown: "# x" }).success).toBe(false);
    expect(planArtifactSchema.safeParse({ title: "Test Plan", markdown: "# x", artifactKind: "memo" }).success).toBe(false);
    expect(planArtifactSchema.safeParse({ title: "Test Plan", markdown: "# x", status: "published" }).success).toBe(false);

    // 5. bounded_lite_background: empty args
    const backgroundSchema = tool.schema.object(tools.bounded_lite_background?.args as Record<string, any>);
    expect(backgroundSchema.safeParse({}).success).toBe(true);

    // 6. bounded_lite_runtime_profile: empty args
    const runtimeProfileSchema = tool.schema.object(tools.bounded_lite_runtime_profile?.args as Record<string, any>);
    expect(runtimeProfileSchema.safeParse({}).success).toBe(true);

    // 7. bounded_lite_study_ingest: optional directory and boolean allowExternalDirectory
    const studyIngestSchema = tool.schema.object(tools.bounded_lite_study_ingest?.args as Record<string, any>);
    expect(studyIngestSchema.safeParse({}).success).toBe(true);
    expect(studyIngestSchema.safeParse({ directory: "courseware", allowExternalDirectory: true }).success).toBe(true);
    expect(studyIngestSchema.safeParse({ allowExternalDirectory: "invalid-boolean" }).success).toBe(false);

    // 8. bounded_lite_study_package: optional stage, directory, allowExternalDirectory
    const studyPackageSchema = tool.schema.object(tools.bounded_lite_study_package?.args as Record<string, any>);
    expect(studyPackageSchema.safeParse({}).success).toBe(true);
    expect(studyPackageSchema.safeParse({ stage: "sources", directory: "docs", allowExternalDirectory: false }).success).toBe(true);

    // 9. bounded_lite_model_config: optional actions, policy, assignment records
    const modelConfigSchema = tool.schema.object(tools.bounded_lite_model_config?.args as Record<string, any>);
    expect(modelConfigSchema.safeParse({ action: "auto" }).success).toBe(true);
    expect(
      modelConfigSchema.safeParse({
        action: "apply",
        assignments: { "command-lead": "openai/gpt-5.4" },
        reasoningEffortAssignments: { "command-lead": "high" },
        taskLeadProfileAssignments: { code: "openai/gpt-5.4" },
        allowUnavailableModels: true,
      }).success,
    ).toBe(true);
    expect(
      modelConfigSchema.safeParse({
        policy: { source: "all", allowCodexBackend: false },
        familyPreference: ["gpt", "claude"],
      }).success,
    ).toBe(true);
  });

  it("returns promises from bounded lite tools and hooks", async () => {
    const hooks = await createBoundedLitePlugin({
      directory: process.cwd(),
    });

    const routeResult = hooks.tool?.bounded_lite_route?.execute(
      { category: "execution" },
      { directory: process.cwd() },
    );
    const backgroundResult = hooks.tool?.bounded_lite_background?.execute(
      {},
      { directory: process.cwd() },
    );
    const runtimeProfileResult = hooks.tool?.bounded_lite_runtime_profile?.execute(
      {},
      { directory: process.cwd() },
    );
    const permissionResult = hooks["permission.ask"]?.(
      { tool: "bounded_lite_route", action: "execute" },
      { status: "deny" },
    );

    expect(routeResult).toBeInstanceOf(Promise);
    expect(backgroundResult).toBeInstanceOf(Promise);
    expect(runtimeProfileResult).toBeInstanceOf(Promise);
    expect(permissionResult).toBeInstanceOf(Promise);
    const routeOutput = await routeResult;
    const backgroundOutput = await backgroundResult;
    const runtimeProfileOutput = await runtimeProfileResult;

    expect(typeof routeOutput).toBe("string");
    expect(typeof backgroundOutput).toBe("string");
    expect(typeof runtimeProfileOutput).toBe("string");
    expect(JSON.parse(routeOutput as string)).toMatchObject({ targetRole: "command-lead" });
    expect(JSON.parse(backgroundOutput as string)).toEqual([]);
    expect(JSON.parse(runtimeProfileOutput as string)).toMatchObject({
      mode: "full",
      visibleModes: ["execution", "planning", "deep-planning"],
    });
  });

  it("allows bounded lite plugin tools without extra permission prompts", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );
    const modelOutput: { status: "allow" | "ask" | "deny" } = { status: "deny" };
    const planOutput: { status: "allow" | "ask" | "deny" } = { status: "deny" };

    await hooks["permission.ask"]?.(
      { tool: "bounded_lite_model_config", action: "execute" },
      modelOutput,
    );
    await hooks["permission.ask"]?.(
      { tool: "bounded_lite_plan_artifact", action: "execute" },
      planOutput,
    );

    expect(modelOutput.status).toBe("allow");
    expect(planOutput.status).toBe("allow");
  });

  it("shows the imported model pool before auto recommendations", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-models-"));

    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        { action: "auto" },
        {
          directory: process.cwd(),
          client: {
            config: {
              providers: async () => ({
                data: {
                  providers: [
                    {
                      id: "openai",
                      models: {
                        "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
                        "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
                      },
                    },
                  ],
                },
              }),
            },
          },
        },
      );

      expect(String(output)).toContain("Available imported model pool (review before recommendations):");
      expect(String(output)).toContain("openai/gpt-5.4");
      expect(String(output).indexOf("Available imported model pool (review before recommendations):"))
        .toBeLessThan(String(output).indexOf("Oh My Lite OpenAgent auto model configuration"));
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("writes model config updates to oh-my-lite-openagent.json and generated agent markdown", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-plugin-jsonc-"));

    try {
      const jsoncPath = path.join(configDir, "opencode.jsonc");
      await writeFile(
        jsoncPath,
        `{
          // Existing JSONC config.
          "agent": {
            "command-lead": {},
          },
        }\n`,
      );
      const agentsDir = path.join(configDir, "agents");

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          reasoningEffortAssignments: { "command-lead": "max" },
          allowUnavailableModels: true,
        },
        {
          directory: process.cwd(),
          client: {},
        },
      );
      const writtenConfigText = await readFile(jsoncPath, "utf8");
      const liteConfigPath = path.join(configDir, "oh-my-lite-openagent.json");
      const writtenLiteConfig = JSON.parse(await readFile(liteConfigPath, "utf8"));
      const generatedAgent = await readFile(path.join(agentsDir, "command-lead.md"), "utf8");

      expect(String(output)).toContain(`Updated ${liteConfigPath}`);
      expect(writtenConfigText).not.toContain('"model": "openai/gpt-5.4"');
      expect(writtenLiteConfig.roleModels["command-lead"]).toBe("openai/gpt-5.4");
      expect(writtenLiteConfig.roleReasoningEffort["command-lead"]).toBe("max");
      expect(generatedAgent).toContain("model: openai/gpt-5.4");
      expect(generatedAgent).toContain("reasoningEffort: max");
      expect(await pathExists(path.join(configDir, "opencode.json"))).toBe(false);
      expect(await pathExists(`${liteConfigPath}.bak`)).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("removes generated agent reasoning effort when only model assignments are applied", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-model-only-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(jsonPath, `${JSON.stringify({ agent: { "command-lead": {} } })}\n`);
      const agentsDir = path.join(configDir, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "command-lead.md"),
        "---\nmode: primary\nreasoningEffort: high\n---\n\n# Command Lead\n",
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          allowUnavailableModels: true,
        },
        {
          directory: process.cwd(),
          client: {},
        },
      );

      const generatedAgent = await readFile(path.join(agentsDir, "command-lead.md"), "utf8");
      const writtenLiteConfig = JSON.parse(await readFile(path.join(configDir, "oh-my-lite-openagent.json"), "utf8"));

      expect(writtenLiteConfig.roleModels["command-lead"]).toBe("openai/gpt-5.4");
      expect(writtenLiteConfig.roleReasoningEffort["command-lead"]).toBeUndefined();
      expect(generatedAgent).toContain("model: openai/gpt-5.4");
      expect(generatedAgent).not.toContain("reasoningEffort:");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("removes stale generated agent reasoning effort on model-only apply", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-stale-reasoning-"));

    try {
      const jsonPath = path.join(configDir, "opencode.json");
      await writeFile(jsonPath, `${JSON.stringify({ agent: { "command-lead": {} } })}\n`);
      await writeFile(path.join(configDir, "oh-my-lite-openagent.json"), `${JSON.stringify({
        schemaVersion: 1,
        roleModels: {},
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      })}\n`);
      const agentsDir = path.join(configDir, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "command-lead.md"),
        "---\nmode: primary\nreasoningEffort: low\n---\n\n# Command Lead\n",
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          allowUnavailableModels: true,
        },
        {
          directory: process.cwd(),
          client: {},
        },
      );

      const generatedAgent = await readFile(path.join(agentsDir, "command-lead.md"), "utf8");

      expect(generatedAgent).toContain("model: openai/gpt-5.4");
      expect(generatedAgent).toContain("reasoningEffort: high");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("persists configured specialists and synchronizes Command Lead delegation at runtime", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-plugin-specialists-"));

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
            "doc-sync": {
              name: "doc-sync",
              description: "Synchronize selected documentation.",
              reasoningEffort: "medium",
              editFolders: ["docs", "specs/**"],
              prompt: "Only update documentation files under the configured folders.",
            },
          },
        })}\n`,
      );

      const hooks = await createBoundedLitePlugin(
        { directory: process.cwd() },
        { configDir },
      );
      const output = await hooks.tool?.bounded_lite_model_config?.execute(
        {
          action: "apply",
          assignments: { "command-lead": "openai/gpt-5.4" },
          specialistAssignments: {
            "doc-sync": {
              model: "openai/gpt-5.4",
              reasoningEffort: "high",
            },
          },
          allowUnavailableModels: true,
        },
        { directory: process.cwd(), client: {} },
      );

      const specialist = await readFile(path.join(configDir, "agents", "doc-sync.md"), "utf8");
      const commandLead = await readFile(path.join(configDir, "agents", "command-lead.md"), "utf8");
      const writtenLiteConfig = JSON.parse(await readFile(path.join(configDir, "oh-my-lite-openagent.json"), "utf8"));

      expect(specialist).toContain("mode: subagent");
      expect(specialist).toContain("hidden: true");
      expect(specialist).toContain("model: openai/gpt-5.4");
      expect(specialist).toContain("reasoningEffort: high");
      expect(specialist).toContain('"docs/**": allow');
      expect(specialist).toContain('"**/docs/**": allow');
      expect(specialist).toContain("question: deny");
      expect(specialist).toContain("Only update documentation files");
      expect(commandLead).toContain("doc-sync: allow");
      expect(writtenLiteConfig.specialists["doc-sync"]).toMatchObject({
        model: "openai/gpt-5.4",
        reasoningEffort: "high",
      });
      expect(String(output)).toContain("Specialist changes applied:");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("ingests only first-level study courseware and reports generated outputs", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-"));

    try {
      await writeFile(
        path.join(coursewareDir, "01-database.pdf"),
        "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Chapter 1 Database Systems covers relational models normalization SQL transactions indexing recovery and exam review checkpoints for final preparation.) Tj ET\n%%EOF\n",
      );
      await writeFile(path.join(coursewareDir, "study-guide.md"), "generated\n");
      await mkdir(path.join(coursewareDir, "nested"));
      await writeFile(path.join(coursewareDir, "nested", "ignored.pdf"), "BT (Nested) Tj ET\n");
      await mkdir(path.join(coursewareDir, "sources"));

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_ingest?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.discoveredFiles).toEqual(["01-database.pdf"]);
      expect(result.ignoredGeneratedOutputs).toEqual(expect.arrayContaining(["study-guide.md", "sources/"]));
      expect(result.sources[0]).toMatchObject({
        filename: "01-database.pdf",
        extension: ".pdf",
        status: "ok",
      });
      expect(result.sources[0].extraction).toMatchObject({
        method: expect.any(String),
        quality: expect.stringMatching(/^(high|medium)$/),
        confidence: expect.any(Number),
        needsManualReview: false,
      });
      expect(result.sources[0].slides[0]).toMatchObject({
        extractionMethod: expect.any(String),
        extractionQuality: expect.stringMatching(/^(high|medium)$/),
        confidence: expect.any(Number),
        needsManualReview: false,
      });
      expect(result.sources[0].slides[0].text).toContain("Chapter 1 Database Systems");
      expect(result.chapterCandidates.some((candidate: string) => candidate.includes("Chapter 1 Database Systems"))).toBe(true);
      expect(result.policy.recursive).toBe(false);
      expect(result.policy.externalLabelRequired).toBe("[External]");
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("returns a recoverable blocker for legacy ppt when soffice is unavailable", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-ppt-"));
    const originalPath = process.env.PATH;

    try {
      process.env.PATH = "";
      await writeFile(path.join(coursewareDir, "legacy.ppt"), "legacy binary placeholder\n");

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_ingest?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.sources[0]).toMatchObject({
        filename: "legacy.ppt",
        extension: ".ppt",
        status: "blocked",
      });
      expect(result.sources[0].extraction).toMatchObject({
        method: "ppt-soffice-missing",
        quality: "blocked",
        confidence: 0,
        needsManualReview: true,
      });
      expect(result.recoverableBlockers[0]).toMatchObject({
        file: "legacy.ppt",
        recoverability: "recoverable",
        requiredTool: "soffice",
      });
    } finally {
      process.env.PATH = originalPath;
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("generates a bounded current-directory study package", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-package-"));

    try {
      await writeFile(
        path.join(coursewareDir, "02-indexes.pdf"),
        "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Chapter 2 Indexes covers B plus trees hash indexes clustered indexes selectivity query planning and common final exam mistakes.) Tj ET\n%%EOF\n",
      );
      await writeFile(path.join(coursewareDir, "AGENTS.md"), "# Course rules\n\nKeep this line.\n");

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_package?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));
      const agents = await readFile(path.join(coursewareDir, "AGENTS.md"), "utf8");
      const sourceIndex = JSON.parse(await readFile(path.join(coursewareDir, "source-index.json"), "utf8"));

      expect(result.status).toBe("ok");
      expect(result.writtenFiles).toEqual(expect.arrayContaining([
        "AGENTS.md",
        "source-index.json",
        "study-guide.md",
        "exam-points.md",
        "mindmap.md",
        "anki_flashcards.csv",
        "practice-questions.md",
        "coverage-report.md",
        "sources/02-indexes.md",
        "summaries/02-indexes.md",
      ]));
      expect(agents).toContain("Keep this line.");
      expect(agents).toContain("oh-my-lite-study:start");
      expect(sourceIndex.discoveredFiles).toEqual(["02-indexes.pdf"]);
      const summary = await readFile(path.join(coursewareDir, "summaries", "02-indexes.md"), "utf8");
      expect(summary).toContain("Manual Text Review");
      expect(summary).not.toContain("Visual Review");
      expect(summary).not.toContain("visual-heavy");
      const sourceNotes = await readFile(path.join(coursewareDir, "sources", "02-indexes.md"), "utf8");
      expect(sourceNotes).not.toContain("visual review");
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("supports a source-only study package stage before full generation", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-sources-"));

    try {
      await writeFile(
        path.join(coursewareDir, "04-transactions.pdf"),
        "%PDF-1.4\n1 0 obj << /Type /Page >> endobj\nBT (Chapter 4 Transactions covers ACID isolation schedules serializability locking logging recovery checkpoints and final exam practice.) Tj ET\n%%EOF\n",
      );

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_package?.execute(
        { stage: "sources" },
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.stage).toBe("sources");
      expect(result.writtenFiles).toEqual(expect.arrayContaining([
        "AGENTS.md",
        "source-index.json",
        "coverage-report.md",
        "sources/04-transactions.md",
      ]));
      expect(result.writtenFiles).not.toContain("study-guide.md");
      expect(result.writtenFiles).not.toContain("summaries/04-transactions.md");
      await expect(readFile(path.join(coursewareDir, "study-guide.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("blocks study package generation for invalid AGENTS markers", async () => {
    const coursewareDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-agents-"));

    try {
      await writeFile(path.join(coursewareDir, "slides.pdf"), "BT (Chapter 3 Recovery) Tj ET\n");
      await writeFile(path.join(coursewareDir, "AGENTS.md"), "<!-- oh-my-lite-study:start -->\nmissing end\n");

      const hooks = await createBoundedLitePlugin({ directory: coursewareDir });
      const output = await hooks.tool?.bounded_lite_study_package?.execute(
        {},
        { directory: coursewareDir },
      );
      const result = JSON.parse(String(output));

      expect(result.status).toBe("blocked");
      expect(result.recoverableBlockers[0]).toMatchObject({
        file: "AGENTS.md",
        recoverability: "recoverable",
      });
    } finally {
      await rm(coursewareDir, { recursive: true, force: true });
    }
  });

  it("requires explicit authorization for study tools outside the current directory", async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-base-"));
    const externalDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-study-external-"));

    try {
      await writeFile(path.join(externalDir, "external.pdf"), "BT (External) Tj ET\n");
      const hooks = await createBoundedLitePlugin({ directory: baseDir });

      await expect(hooks.tool?.bounded_lite_study_ingest?.execute(
        { directory: externalDir },
        { directory: baseDir },
      )).rejects.toThrow("allowExternalDirectory=true");

      const output = await hooks.tool?.bounded_lite_study_ingest?.execute(
        { directory: externalDir, allowExternalDirectory: true },
        { directory: baseDir },
      );
      const result = JSON.parse(String(output));

      expect(result.discoveredFiles).toEqual(["external.pdf"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
      await rm(externalDir, { recursive: true, force: true });
    }
  });
});

function serializePlanToolArgs(args: Record<string, unknown>, flavor: "v1" | "v2"): Record<string, any> {
  // v1 hosts project Zod raw shapes to draft-2020-12 (C01 evidence); the v2
  // projection uses the same pinned Zod 4.1.8 API with its default target.
  const serialized = flavor === "v1"
    ? z.toJSONSchema(z.object(args as z.ZodRawShape), { target: "draft-2020-12" })
    : z.toJSONSchema(z.object(args as z.ZodRawShape));
  return JSON.parse(JSON.stringify(serialized));
}

describe("plan tool schema projection", () => {
  it("serializes both plan tools' registered args to v1 and v2 JSON Schemas exposing typed payload.plan.subtasks", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const tools = hooks.tool ?? {};

    for (const toolName of ["bounded_lite_plan_dag", "bounded_lite_plan_readiness"] as const) {
      // Descriptions are provider-visible metadata on the registered schemas
      // (zod keeps them in a per-copy registry, so read them from the args
      // themselves rather than from a cross-copy projection).
      const payloadArg = tools[toolName]!.args.payload as { description?: string };
      expect(payloadArg.description).toContain("plan.subtasks");
      expect(payloadArg.description).toContain("Example:");

      for (const flavor of ["v1", "v2"] as const) {
        const schema = serializePlanToolArgs(tools[toolName]!.args, flavor);

        expect(schema.type).toBe("object");
        expect(schema.required).toContain("payload");
        expect(schema.properties.dispatch).toBeDefined();

        const payloadSchema = schema.properties.payload;
        expect(payloadSchema.type).toBe("object");
        expect(payloadSchema.required).toContain("plan");
        expect(payloadSchema.additionalProperties).toEqual({});

        const subtasksSchema = payloadSchema.properties.plan.properties.subtasks;
        expect(subtasksSchema.type).toBe("array");
        const subtaskFields = Object.keys(subtasksSchema.items.properties);
        expect(subtaskFields).toEqual(expect.arrayContaining([
          "id",
          "depends_on",
          "attributes",
          "deliverable",
          "description",
        ]));
        expect(subtasksSchema.items.required).toEqual(expect.arrayContaining([
          "id",
          "depends_on",
          "attributes",
          "deliverable",
          "description",
        ]));
      }
    }
  });

  it("keeps the two intentional no-input tools empty in serialized schemas", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const tools = hooks.tool ?? {};

    for (const toolName of ["bounded_lite_background", "bounded_lite_runtime_profile"] as const) {
      for (const flavor of ["v1", "v2"] as const) {
        const schema = serializePlanToolArgs(tools[toolName]!.args, flavor);
        expect(schema.properties).toEqual({});
        expect(schema.required ?? []).toEqual([]);
      }
    }
  });
});

describe("plan tool handler execution", () => {
  it("executes bounded_lite_plan_dag with the structured fixture and optional dispatch", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const payload = await loadStructuredPlanFixture();

    const output = await hooks.tool?.bounded_lite_plan_dag?.execute(
      { payload, dispatch: { concurrency: 5, attributeProfileMap: { security: "sec-profile" } } },
      { directory: process.cwd() },
    );
    const dag = JSON.parse(String(output));

    expect(dag.concurrency).toBe(5);
    expect(dag.waves).toEqual([["C01"], ["C02"], ["C03"]]);
    expect(dag.nodes.find((node: { id: string }) => node.id === "C02")?.dispatch).toMatchObject({
      profile: "sec-profile",
      matchedAttribute: "security",
    });
  });

  it("fails bounded_lite_plan_dag once with an actionable diagnostic for malformed payloads", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const dagTool = hooks.tool!.bounded_lite_plan_dag!.execute;

    await expect(dagTool({}, { directory: process.cwd() }))
      .rejects.toThrow(/Missing `payload`.*Expected the named `payload` object/s);
    await expect(dagTool({ payload: null }, { directory: process.cwd() }))
      .rejects.toThrow(/is null/);
    await expect(dagTool({ payload: ["a"] }, { directory: process.cwd() }))
      .rejects.toThrow(/not an array/);
    await expect(dagTool({ payload: "# raw markdown" }, { directory: process.cwd() }))
      .rejects.toThrow(/raw Markdown document/);
    await expect(dagTool(
      { payload: JSON.stringify(await loadStructuredPlanFixture()) },
      { directory: process.cwd() },
    )).rejects.toThrow(/JSON-encoded string/);
  });

  it("executes bounded_lite_plan_readiness with the structured fixture and optional dispatch", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const payload = await loadStructuredPlanFixture();

    const output = await hooks.tool?.bounded_lite_plan_readiness?.execute(
      { payload, dispatch: { concurrency: 4 } },
      { directory: process.cwd() },
    );
    const result = JSON.parse(String(output));

    expect(result.executable).toBe(true);
    expect(result.decision).toBe("execute");
    expect(result.dag?.waves).toEqual([["C01"], ["C02"], ["C03"]]);
  });

  it("returns one format diagnostic (not a missing-section cascade) for bad readiness payload formats", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const readinessTool = hooks.tool!.bounded_lite_plan_readiness!.execute;
    const markdown = [
      "---",
      "plan_schema_version: 2.1",
      "maturity_level: M3",
      "status: reviewed",
      "---",
      "",
      "# Plan",
      "",
      "## Goals",
    ].join("\n");

    for (const badInput of [
      undefined,
      null,
      ["a"],
      markdown,
      JSON.stringify(await loadStructuredPlanFixture()),
    ]) {
      const output = await readinessTool({ payload: badInput }, { directory: process.cwd() });
      const result = JSON.parse(String(output));

      expect(result.executable).toBe(false);
      expect(result.decision).toBe("revise");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Expected the named `payload` object");
      expect(result.errors[0]).not.toContain("must be present and non-empty");
    }
  });

  it("preserves adversarial blockers and extension metadata through the readiness handler", async () => {
    const hooks = await createBoundedLitePlugin({ directory: process.cwd() });
    const payload = await loadStructuredPlanFixture();

    payload["maturity_level"] = "M2";
    payload["status"] = "draft";
    payload["open_questions"] = [{ question: "[Open Question] Ship now?", blocks_current_phase: true }];
    payload["plan_review"] = {
      decision: "revise",
      findings: [{ location: "plan", issue: "gap", severity: "major", resolved: false }],
    };
    payload["self_check"] = { passed: false, blocked: true };
    (payload["plan"] as { subtasks: unknown[] }).subtasks = [
      { id: "a", depends_on: ["ghost"], attributes: [], deliverable: "a", description: "a", extra: "kept" },
      { id: "a", depends_on: ["b"], attributes: [], deliverable: "dup", description: "dup" },
      { id: "b", depends_on: ["a"], attributes: [], deliverable: "b", description: "b" },
    ];

    const output = await hooks.tool?.bounded_lite_plan_readiness?.execute(
      { payload },
      { directory: process.cwd() },
    );
    const result = JSON.parse(String(output));

    expect(result.executable).toBe(false);
    expect(result.decision).toBe("revise");

    const errors = (result.errors as string[]).join("\n");
    expect(errors).toContain("unresolved major Plan Review finding");
    expect(errors).toContain("open_questions that block the current phase");
    expect(errors).toContain("self-check reports a blocker");
    expect(errors).toContain("depends on unknown subtask ghost");
    expect(errors).toContain("duplicates a");
    expect(errors).toContain("cycle");

    // Passthrough intact: the handler forwarded the same object unchanged.
    expect(payload["plan_review"]).toMatchObject({ decision: "revise" });
    expect(payload["self_check"]).toMatchObject({ blocked: true });
  });

  it("fails title-only artifact writes before any I/O side effect", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "omo-lite-plan-args-"));

    try {
      const hooks = await createBoundedLitePlugin({ directory: process.cwd() });

      await expect(hooks.tool?.bounded_lite_plan_artifact?.execute(
        { title: "Title Only" },
        { directory: root },
      )).rejects.toThrow(/markdown.*content.*before any file write/s);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes through the content alias and rejects artifact enum errors without writing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "omo-lite-plan-args-"));

    try {
      const hooks = await createBoundedLitePlugin({ directory: process.cwd() });

      const output = await hooks.tool?.bounded_lite_plan_artifact?.execute(
        {
          title: "Alias Write",
          content: "# Plan via content alias",
          artifactKind: "detailed-plan",
          status: "reviewed",
        },
        { directory: root },
      );
      expect(String(output)).toContain("plan artifact persisted");

      const plansDir = path.join(root, ".liteagent", "plans");
      const files = await readdir(plansDir);
      expect(files).toHaveLength(1);
      expect(await readFile(path.join(plansDir, files[0]!), "utf8")).toContain("# Plan via content alias");

      const before = await readdir(plansDir);
      for (const badArgs of [
        { title: "Bad Kind", content: "# x", artifactKind: "memo" },
        { title: "Bad Status", content: "# x", status: "published" },
        { title: "Bad Action", content: "# x", action: "delete" },
      ]) {
        await expect(hooks.tool?.bounded_lite_plan_artifact?.execute(badArgs, { directory: root }))
          .rejects.toThrow(/must be/);
      }
      expect(await readdir(plansDir)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
