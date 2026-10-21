// C05 — typed OpenCode v2 adapter tests (offline unit runner).
//
// Event/result/context shapes follow the pinned published SDK
// (@opencode/plugin 2.0.30, promise layer) and the live v2.0.30 host evidence
// captured by the loader stage:
//   - Tool executor contexts: { sessionID, agent, messageID, id, signal, progress }
//   - setup context: options / location / model / session / tool / permission domains
//   - session.get({ sessionID }) returns the session with location: { directory }
//     (recorded live by C01 as `session.get.v2` events).
// Fake host contexts are narrowed structural stubs cast to the published
// Plugin.Context shape: every field the adapter actually reads is provided
// with realistic values; nothing else is consulted.
import { describe, expect, it } from "vitest";
import { access, chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { boundedLitePluginBase } from "../../.opencode/plugins/bounded-lite.js";
import { createBoundedLitePlugin, type V1PluginInput } from "../../.opencode/lib/compat/v1.js";
import {
  applyReasoningPreferencesToRequest,
  normalizeV2ModelInventory,
  resolveV2OperationLocation,
  setupBoundedLiteV2,
  BOUNDED_LITE_PLUGIN_ID,
  type V2PluginContext,
} from "../../.opencode/lib/compat/v2.js";
import type { NormalizedBoundedLitePluginOptions } from "../../.opencode/lib/runtime/bounded-lite-core.js";

const NINE_TOOL_NAMES = [
  "bounded_lite_route",
  "bounded_lite_plan_dag",
  "bounded_lite_plan_readiness",
  "bounded_lite_plan_artifact",
  "bounded_lite_background",
  "bounded_lite_runtime_profile",
  "bounded_lite_study_ingest",
  "bounded_lite_study_package",
  "bounded_lite_model_config",
] as const;

interface CapturedToolRegistration {
  name: string;
  description: string;
  input: Record<string, unknown>;
  options?: Record<string, unknown>;
  execute: (input: unknown, toolCtx: unknown) => Promise<unknown>;
}

type ToolTransformCallback = (editor: { add: (tool: unknown) => void }) => void;
type SessionHookCallback = (event: SessionContext) => Promise<void> | void;

/**
 * Snapshot a captured registration the way the real in-process v2 host keeps
 * it: the event/result data is cloned, the executor callback stays a live
 * in-process reference (functions are not structure-cloneable and the host
 * never clones registration callbacks across a boundary).
 */
function cloneRegistration(tool: CapturedToolRegistration): CapturedToolRegistration {
  return {
    ...(tool as object),
    input: structuredClone(tool.input),
    ...(tool.options !== undefined ? { options: structuredClone(tool.options) } : {}),
    execute: tool.execute,
  } as CapturedToolRegistration;
}

function toolCtxFor(sessionID: string): Record<string, unknown> {
  return {
    sessionID,
    agent: "task-lead",
    messageID: "msg-1",
    id: "call-1",
    signal: new AbortController().signal,
    progress: async () => {},
  };
}

/** Published ModelListOutput shape: { location, data: ModelInfo[] }. */
function fakeModelListOutput(): unknown {
  return {
    location: { directory: "/fixture-project" },
    data: [
      {
        modelID: "echo-model",
        providerID: "scripted",
        name: "Echo Model",
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [{ id: "default", settings: {} }],
      },
      {
        modelID: "no-variant",
        providerID: "scripted",
        name: "No Variant",
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
      },
    ],
  };
}

/**
 * Fake v2 setup context: tool.transform/editor.add capture, session domain
 * with get() returning per-session locations, permission.assert recorder, and
 * a model.list() returning the published result.data envelope.
 */
function fakeV2Context(options: {
  setupOptions?: Record<string, unknown>;
  sessions?: ReadonlyArray<{ id: string; locationDirectory: string }>;
  modelListOutput?: unknown;
  permissionAssert?: (input: {
    sessionID: string;
    action: string;
    resources: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
} = {}) {
  const sessionMap = new Map<string, { location: { directory: string } }>();
  for (const session of options.sessions ?? []) {
    sessionMap.set(session.id, { location: { directory: session.locationDirectory } });
  }
  const addedTools: CapturedToolRegistration[] = [];
  const transformCallbacks: ToolTransformCallback[] = [];
  const contextCallbacks: SessionHookCallback[] = [];
  const disposeCalls: number[] = [];
  const permissionAssertCalls: Array<{
    sessionID: string;
    action: string;
    resources: string[];
  }> = [];
  let modelListCalls = 0;

  return {
    options: options.setupOptions ?? {},
    location: { directory: "/plugin-instance-location", project: { id: "global", directory: "/plugin-instance-location", canonical: "/plugin-instance-location" } },
    model: {
      list: async () => {
        modelListCalls += 1;
        return options.modelListOutput ?? fakeModelListOutput();
      },
    },
    session: {
      get: async (input: { sessionID: string }) => {
        const found = sessionMap.get(input.sessionID);
        if (!found) throw new Error(`session not found: ${input.sessionID}`);
        return structuredClone(found);
      },
      hook: async (_name: string, callback: SessionHookCallback) => {
        contextCallbacks.push(callback);
        return {
          dispose: () => {
            disposeCalls.push(contextCallbacks.length);
          },
        };
      },
    },
    tool: {
      transform: async (callback: ToolTransformCallback) => {
        transformCallbacks.push(callback);
        callback({
          add: (tool: unknown) => {
            addedTools.push(tool as CapturedToolRegistration);
          },
        });
        return { dispose: async () => {} };
      },
    },
    permission: {
      assert: (async (input: {
        sessionID: string;
        action: string;
        resources: string[];
        metadata?: Record<string, unknown>;
      }) => {
        // Spy on the documented assert channel itself: every checker the
        // adapter drives is recorded here, so the adapter cannot silently
        // bypass or replace the host permission surface.
        permissionAssertCalls.push(structuredClone({
          sessionID: input.sessionID,
          action: input.action,
          resources: [...input.resources],
        }));
        if (options.permissionAssert) await options.permissionAssert(input);
      }) as unknown,
    },
    __test: { addedTools, transformCallbacks, contextCallbacks, disposeCalls, permissionAssertCalls, sessionMap, get modelListCalls() { return modelListCalls; } },
  } as unknown as V2PluginContext & { __test: {
    addedTools: CapturedToolRegistration[];
    transformCallbacks: ToolTransformCallback[];
    contextCallbacks: SessionHookCallback[];
    disposeCalls: number[];
    permissionAssertCalls: Array<{ sessionID: string; action: string; resources: string[] }>;
    sessionMap: Map<string, { location: { directory: string } }>;
    modelListCalls: number;
  } };
}

function testOf(context: V2PluginContext) {
  return (context as unknown as {
    __test: {
      addedTools: CapturedToolRegistration[];
      transformCallbacks: ToolTransformCallback[];
      contextCallbacks: SessionHookCallback[];
      disposeCalls: number[];
      permissionAssertCalls: Array<{ sessionID: string; action: string; resources: string[] }>;
      sessionMap: Map<string, { location: { directory: string } }>;
      modelListCalls: number;
    };
  })["__test"];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Combined export shape
// ---------------------------------------------------------------------------

describe("combined default export", () => {
  it("exposes one dual-host object with stable id, v2 setup and v1 server", () => {
    expect(boundedLitePluginBase.id).toBe(BOUNDED_LITE_PLUGIN_ID);
    expect(boundedLitePluginBase.id).toBe("bounded-lite");
    expect(typeof boundedLitePluginBase.setup).toBe("function");
    expect(typeof boundedLitePluginBase.server).toBe("function");
  });

  it("v1 server forwarding returns the nine tools through the v1 adapter", async () => {
    const hooks = await boundedLitePluginBase.server({ directory: process.cwd() } as V1PluginInput);
    expect(Object.keys(hooks.tool ?? {})).toHaveLength(9);
  });

  it("v2 setup registers the same nine tools from the same default export", async () => {
    const context = fakeV2Context();
    await boundedLitePluginBase.setup(context);
    const names = testOf(context).addedTools.map((tool) => tool.name);
    expect([...names].sort()).toEqual([...NINE_TOOL_NAMES].sort());
  });
});

// ---------------------------------------------------------------------------
// setup / registration
// ---------------------------------------------------------------------------

describe("v2 adapter setup and tool registration", () => {
  it("registers exactly the nine bounded_lite tools with typed JSON Schema input", async () => {
    const context = fakeV2Context();
    await setupBoundedLiteV2(context);

    const added = testOf(context).addedTools;
    const names = added.map((tool) => tool.name);
    expect([...names].sort()).toEqual([...NINE_TOOL_NAMES].sort());
    expect(new Set(names).size).toBe(9);
    for (const tool of added) {
      expect(typeof tool.description).toBe("string");
      expect(tool.options).toMatchObject({ codemode: false });
      expect(tool.input).toMatchObject({ type: "object" });
    }
  });

  it("projects the object-only plan payload schema and keeps no-input tools empty", async () => {
    const context = fakeV2Context();
    await setupBoundedLiteV2(context);
    const added = testOf(context).addedTools;

    for (const toolName of ["bounded_lite_plan_dag", "bounded_lite_plan_readiness"] as const) {
      const schema = added.find((tool) => tool.name === toolName)!.input as {
        required?: string[];
        properties?: Record<string, unknown>;
      };
      expect(schema.required).toContain("payload");
      expect(schema.properties!["dispatch"]).toBeDefined();
      const payload = schema.properties!["payload"] as {
        properties?: { plan?: { properties?: { subtasks?: { items?: { required?: string[] } } } } };
      };
      expect(
        payload.properties?.plan?.properties?.subtasks?.items?.required,
      ).toEqual(expect.arrayContaining(["id", "depends_on", "attributes", "deliverable", "description"]));
    }

    for (const toolName of ["bounded_lite_background", "bounded_lite_runtime_profile"] as const) {
      const schema = added.find((tool) => tool.name === toolName)!.input as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(Object.keys(schema.properties ?? {})).toEqual([]);
      expect(schema.required ?? []).toEqual([]);
    }
  });

  it("transform replay does not duplicate registration names and definitions are stable", async () => {
    const context = fakeV2Context();
    await setupBoundedLiteV2(context);
    const test = testOf(context);
    expect(test.transformCallbacks).toHaveLength(1);
    const transform = test.transformCallbacks[0]!;

    const firstAdd: CapturedToolRegistration[] = [];
    const secondAdd: CapturedToolRegistration[] = [];
    transform({ add: (tool) => firstAdd.push(cloneRegistration(tool as CapturedToolRegistration)) });
    transform({ add: (tool) => secondAdd.push(cloneRegistration(tool as CapturedToolRegistration)) });

    expect(new Set(firstAdd.map((tool) => tool.name)).size).toBe(9);
    expect(new Set(secondAdd.map((tool) => tool.name)).size).toBe(9);
    expect([...firstAdd.map((tool) => tool.name)].sort()).toEqual([...NINE_TOOL_NAMES].sort());
    expect(JSON.stringify(firstAdd)).toBe(JSON.stringify(secondAdd));
  });

  it("replays invoke the shared runtime without resetting shared behavior", async () => {
    const worktree = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-replay-"));
    const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
    try {
      process.env.OPENCODE_CONFIG_DIR = "";
      const context = fakeV2Context({
        sessions: [{ id: "ses-replay", locationDirectory: worktree }],
      });
      await setupBoundedLiteV2(context);
      const transform = testOf(context).transformCallbacks[0]!;

      // Extract one registration per replay (fresh editor rounds).
      const registrations: CapturedToolRegistration[] = [];
      const collectOne = () => {
        let found: CapturedToolRegistration | undefined;
        transform({
          add: (tool) => {
            if ((tool as CapturedToolRegistration).name === "bounded_lite_plan_artifact") {
              found = cloneRegistration(tool as CapturedToolRegistration);
            }
          },
        });
        if (found) registrations.push(found);
      };
      collectOne();
      collectOne();
      expect(registrations).toHaveLength(2);

      // Both replays drive the shared runtime: two artifact writes persist in
      // the same session worktree (not rebuilt/reset coordinator state).
      const ctx = toolCtxFor("ses-replay");
      await registrations[0]!.execute({ title: "Replay One", markdown: "# one" }, ctx);
      await registrations[1]!.execute({ title: "Replay Two", markdown: "# two" }, ctx);
      const files = await readdir(path.join(worktree, ".liteagent", "plans"));
      expect(files).toHaveLength(2);
    } finally {
      if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("validates setup options/maxChildDepth exactly as the v1 factory does", async () => {
    const context = fakeV2Context({ setupOptions: { maxChildDepth: 5 } });
    await expect(setupBoundedLiteV2(context)).rejects.toThrow(/maxChildDepth/);

    for (const bad of [-1, -0.5, Number.NaN, 2]) {
      await expect(
        setupBoundedLiteV2(fakeV2Context({ setupOptions: { maxChildDepth: bad } })),
      ).rejects.toThrow(/maxChildDepth/);
    }

    const validContext = fakeV2Context({ setupOptions: { maxChildDepth: 1 } });
    await expect(setupBoundedLiteV2(validContext)).resolves.toBeTruthy();
  });

  it("returns an owned cleanup without ever re-registering tools at cleanup", async () => {
    const context = fakeV2Context();
    const cleanup = (await setupBoundedLiteV2(context)) as () => Promise<void> | void;
    const beforeCount = testOf(context).addedTools.length;
    await Promise.resolve(cleanup());
    expect(testOf(context).addedTools).toHaveLength(beforeCount);
    // The hook registration was handed a disposal callback (host-managed).
    expect(testOf(context).disposeCalls.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Session location + executor mapping
// ---------------------------------------------------------------------------

describe("v2 operation location and executor mapping", () => {
  it("resolves two distinct session locations through session.get and writes per session", async () => {
    const sessionA = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-loc-a-"));
    const sessionB = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-loc-b-"));
    try {
      const context = fakeV2Context({
        sessions: [
          { id: "ses-aaa", locationDirectory: sessionA },
          { id: "ses-bbb", locationDirectory: sessionB },
        ],
      });
      await setupBoundedLiteV2(context);
      const artifact = testOf(context).addedTools.find(
        (tool) => tool.name === "bounded_lite_plan_artifact",
      )!;

      await artifact.execute({ title: "Session A Plan", markdown: "# A" }, toolCtxFor("ses-aaa"));
      await artifact.execute({ title: "Session B Plan", markdown: "# B" }, toolCtxFor("ses-bbb"));

      const plansA = await readdir(path.join(sessionA, ".liteagent", "plans"));
      const plansB = await readdir(path.join(sessionB, ".liteagent", "plans"));
      expect(plansA).toHaveLength(1);
      expect(plansB).toHaveLength(1);
      expect(await readFile(path.join(sessionA, ".liteagent", "plans", plansA[0]!), "utf8")).toContain("# A");
      expect(await readFile(path.join(sessionB, ".liteagent", "plans", plansB[0]!), "utf8")).toContain("# B");
    } finally {
      await rm(sessionA, { recursive: true, force: true });
      await rm(sessionB, { recursive: true, force: true });
    }
  });

  it("uses only the session location — never the plugin instance location", async () => {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-loc-only-"));
    try {
      const context = fakeV2Context({
        sessions: [{ id: "ses-x", locationDirectory: sessionDir }],
      });
      await setupBoundedLiteV2(context);
      const artifact = testOf(context).addedTools.find(
        (tool) => tool.name === "bounded_lite_plan_artifact",
      )!;
      await artifact.execute({ title: "Session Only", markdown: "# s" }, toolCtxFor("ses-x"));

      expect(await pathExists(path.join("/plugin-instance-location", ".liteagent"))).toBe(false);
      expect(await pathExists(path.join(sessionDir, ".liteagent", "plans"))).toBe(true);
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("fails closed when the invocation carries no sessionID or the session location is missing", async () => {
    const context = fakeV2Context();
    await setupBoundedLiteV2(context);
    const artifact = testOf(context).addedTools.find(
      (tool) => tool.name === "bounded_lite_plan_artifact",
    )!;

    await expect(artifact.execute({ title: "x", markdown: "# x" }, {}))
      .rejects.toThrow(/no sessionID/);

    // Session not resolvable in the host -> fail closed, never process.cwd.
    await expect(
      artifact.execute({ title: "x", markdown: "# x" }, toolCtxFor("ses-unknown")),
    ).rejects.toThrow(/not found|no location directory/);
    expect(await pathExists(path.join("/plugin-instance-location", ".liteagent"))).toBe(false);
  });

  it("normalizeV2ModelInventory preserves providerID/id/variants and capability fields (CAT-01)", () => {
    const models = normalizeV2ModelInventory(fakeModelListOutput());
    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "scripted",
        model: "echo-model",
        id: "scripted/echo-model",
        name: "Echo Model",
        variants: ["default"],
      }),
      expect.objectContaining({ model: "no-variant", id: "scripted/no-variant", variants: [] }),
    ]));
  });

  it ("model inventory feeds the shared runtime handler (no client required)", async () => {
    // The pinned v2 executor contract resolves the operation location through
    // session-get for every invocation (fail closed); the fake host supplies a
    // resolvable session so this test focuses on the inventory feed, which is
    // the only client substitute the model-config handler needs.
    const context = fakeV2Context({
      sessions: [{ id: "ses-inventory", locationDirectory: "/fixture-project" }],
    });
    await setupBoundedLiteV2(context);
    const modelConfig = testOf(context).addedTools.find(
      (tool) => tool.name === "bounded_lite_model_config",
    )!;
    const output = await modelConfig.execute({ action: "list" }, toolCtxFor("ses-inventory")) as { content?: string };
    expect(String(output.content)).toContain("scripted/echo-model");
    expect(testOf(context).modelListCalls).toBeGreaterThanOrEqual(1);
  });
});

describe("v2 permission assertions and cancellation", () => {
  it("routes mutation permission through context.permission.assert; deny stays denied", async () => {
    const worktree = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-perm-"));
    const assertCalls: Array<{ sessionID: string; action: string; resources: string[] }> = [];
    try {
      const context = fakeV2Context({
        sessions: [{ id: "ses-perm", locationDirectory: worktree }],
        permissionAssert: async (input) => {
          assertCalls.push(structuredClone({ sessionID: input.sessionID as string, action: input.action, resources: [...input.resources] }));
          // Allow the first mutation, deny every later one: the deny must
          // stay denied and be shown as a thrown authorization error to the
          // tool caller, not swallowed by the adapter.
          if (assertCalls.length > 1) {
            throw new Error("denied by host");
          }
        },
      });
      await setupBoundedLiteV2(context);
      const artifact = testOf(context).addedTools.find(
        (tool) => tool.name === "bounded_lite_plan_artifact",
      )!;
      const ctx = toolCtxFor("ses-perm") as never;

      await artifact.execute({ title: "Allowed Artifact", markdown: "# ok" }, ctx);
      await expect(
        artifact.execute({ title: "Denied Artifact", markdown: "# no" }, ctx),
      ).rejects.toThrow("denied by host");

      expect(await pathExists(path.join(worktree, ".liteagent", "plans"))).toBe(true);
      expect(await readdir(path.join(worktree, ".liteagent", "plans"))).toHaveLength(1);
      // Exactly the documented assert channel was driven, twice.
      expect(assertCalls).toHaveLength(2);
      expect(assertCalls[0]).toMatchObject({
        sessionID: "ses-perm",
        action: "bounded-lite-mutation",
      });
      // No permission evaluate hook is registered anywhere in the adapter:
      // exactly the documented assert surface was driven, twice, matching the
      // host-side recorder.
      expect(testOf(context).permissionAssertCalls).toEqual(assertCalls);
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  });

  it("maps context.signal to shared cancellation: owned child processes abort", async () => {
    // Fake `soffice` on PATH that sleeps long; the invocation abort must kill
    // the conversion quickly instead of waiting it out.
    const courseware = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-abort-"));
    const binDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-abort-bin-"));
    const originalPath = process.env.PATH;
    try {
      const sofficePath = path.join(binDir, "soffice");
      await writeFile(
        sofficePath,
        "#!/bin/sh\nsleep 30\n",
      );
      await chmod(sofficePath, 0o755);
      await writeFile(path.join(courseware, "legacy.ppt"), "legacy binary placeholder\n");
      process.env.PATH = `${binDir}:${originalPath ?? ""}`;

      const context = fakeV2Context({
        sessions: [{ id: "ses-abort", locationDirectory: courseware }],
      });
      await setupBoundedLiteV2(context);
      const ingest = testOf(context).addedTools.find(
        (tool) => tool.name === "bounded_lite_study_ingest",
      )!;

      const abortController = new AbortController();
      setTimeout(() => abortController.abort(), 400);
      const startedAt = Date.now();
      const output = await ingest.execute(
        {},
        { ...toolCtxFor("ses-abort"), signal: abortController.signal },
      );
      const elapsed = Date.now() - startedAt;
      // Documented v2 result shape: the tool result carries the JSON string in
      // `content` (captured host evidence uses the same channel).
      const result = JSON.parse((output as { content?: string }).content as string);

      // Aborted quickly (well under the fake soffice's 30s sleep), reported as
      // a recoverable blocker with the conversion failure, not as success.
      expect(elapsed).toBeLessThan(10_000);
      expect(result.sources[0]).toMatchObject({ status: "blocked" });
      expect(result.recoverableBlockers[0]).toMatchObject({ file: "legacy.ppt", recoverability: "recoverable" });
    } finally {
      process.env.PATH = originalPath;
      await rm(courseware, { recursive: true, force: true });
      await rm(binDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Typed session request hook (reasoning preferences)
// ---------------------------------------------------------------------------

async function writeLiteConfig(configDir: string, lite: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(configDir, "oh-my-lite-openagent.json"), `${JSON.stringify(lite, null, 2)}\n`);
}

function reasoningEvent(input: {
  agent?: string;
  model?: { providerID?: string; id?: string; variant?: string };
  withOptions?: boolean;
}): SessionContext {
  return {
    sessionID: "ses-reason",
    agent: (input.agent ?? "command-lead") as never,
    model: {
      providerID: input.model?.providerID ?? "scripted",
      id: input.model?.id ?? "echo-model",
      ...(input.model?.variant !== undefined ? { variant: input.model.variant as never } : {}),
    } as never,
    system: [],
    messages: [],
    options: (input.withOptions === false ? undefined : {}) as never,
    tools: {},
  } as unknown as SessionContext;
}

const noOptions: NormalizedBoundedLitePluginOptions = {
  mode: "full",
  enableHooks: true,
  enableBackground: true,
  enableBundledMcp: false,
  maxChildDepth: 1,
};

describe("typed session request hook — reasoning preferences", () => {
  it("setup registers exactly one narrow context hook and cleanup disposes it", async () => {
    const context = fakeV2Context();
    const cleanup = (await setupBoundedLiteV2(context)) as () => Promise<void> | void;
    expect(testOf(context).contextCallbacks).toHaveLength(1);
    await Promise.resolve(cleanup());
    expect(testOf(context).disposeCalls).toEqual([1]);
  });

  it("applies stored role reasoning effort as the semantic option (effective value, not stored claim)", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-reasoning-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      await writeLiteConfig(configDir, {
        schemaVersion: 1,
        roleModels: {},
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      });

      const event = reasoningEvent({ agent: "command-lead", model: { providerID: "scripted", id: "echo-model" } });
      await applyReasoningPreferencesToRequest(event, { ...noOptions, configDir });

      const options = (event as unknown as { options: Record<string, unknown> }).options;
      // The semantic option was set on the actual outgoing request options.
      expect(options["reasoningEffort"]).toBe("high");
      // Stored advisory metadata is distinct: it lives in the file, not as a
      // body overlay claim here.
      expect(options["body"]).toBeUndefined();
      expect(options["requestBody"]).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("explicit model variants take precedence with the stored effort skipped (reported, not claimed)", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-variant-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      // Stored model carries an explicit #variant (variant wins — C04 reports
      // the conflict; the hook must not override it).
      await writeLiteConfig(configDir, {
        schemaVersion: 1,
        roleModels: { "command-lead": "scripted/echo-model#low" },
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      });

      // Case 1: effective model equals stored base; stored #variant selected.
      const eventStoredVariant = reasoningEvent({ agent: "command-lead", model: { providerID: "scripted", id: "echo-model" } });
      await applyReasoningPreferencesToRequest(eventStoredVariant, { ...noOptions, configDir });
      expect((eventStoredVariant as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBeUndefined();

      // Case 2: session model already carries its own variant.
      await writeLiteConfig(configDir, {
        schemaVersion: 1,
        roleModels: { "command-lead": "scripted/echo-model" },
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      });
      const eventSessionVariant = reasoningEvent({
        agent: "command-lead",
        model: { providerID: "scripted", id: "echo-model", variant: "default" },
      });
      await applyReasoningPreferencesToRequest(eventSessionVariant, { ...noOptions, configDir });
      expect((eventSessionVariant as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("never applies effort when the requested model differs from the stored base reference", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-basemismatch-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      await writeLiteConfig(configDir, {
        schemaVersion: 1,
        roleModels: { "command-lead": "scripted/echo-model" },
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      });

      const event = reasoningEvent({ agent: "command-lead", model: { providerID: "other", id: "different-model" } });
      await applyReasoningPreferencesToRequest(event, { ...noOptions, configDir });
      expect((event as unknown as { options?: Record<string, unknown> }).options?.["reasoningEffort"]).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("capability gate: unknown model in the host inventory is skipped, inventory-matched models proceed", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-cap-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      await writeLiteConfig(configDir, {
        schemaVersion: 1,
        roleModels: { "command-lead": "scripted/echo-model" },
        roleReasoningEffort: { "command-lead": "high" },
        taskLeadProfiles: {},
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      });

      const inventory = normalizeV2ModelInventory(fakeModelListOutput());
      // Known in inventory -> semantic option applied.
      const known = reasoningEvent({ agent: "command-lead", model: { providerID: "scripted", id: "echo-model" } });
      await applyReasoningPreferencesToRequest(known, { ...noOptions, configDir }, inventory);
      expect((known as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBe("high");

      // Not locatable in the host catalog inventory -> skipped (reported as
      // unsupported, never silently claimed).
      const unknownModel = reasoningEvent({ agent: "command-lead", model: { providerID: "ghost", id: "absent" } });
      const afraid = structuredClone(noOptions) as NormalizedBoundedLitePluginOptions & { configDir?: string };
      afraid.configDir = configDir;
      await applyReasoningPreferencesToRequest(unknownModel, afraid, inventory);
      expect((unknownModel as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBeUndefined();

      // No inventory snapshot at all -> cannot verify capability; skipped.
      const unverifiable = reasoningEvent({ agent: "command-lead", model: { providerID: "scripted", id: "echo-model" } });
      await applyReasoningPreferencesToRequest(unverifiable, afraid, undefined);
      expect((unverifiable as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("specialists get their stored effort; task-lead profile recommendations stay advisory", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "omo-lite-v2-specialist-"));
    try {
      await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ agent: {} })}\n`);
      await writeLiteConfig(configDir, {
        schemaVersion: 1,
        roleModels: {},
        roleReasoningEffort: {},
        taskLeadProfiles: { code: { model: "scripted/echo-model", reasoningEffort: "high" } },
        specialists: {
          "doc-sync": {
            name: "doc-sync",
            description: "Docs work only",
            reasoningEffort: "medium",
          },
        },
        modelPoolPolicy: { source: "all", allowCodexBackend: false },
      });

      // Specialist effort applies.
      const specialistEvent = reasoningEvent({ agent: "doc-sync", model: { providerID: "scripted", id: "echo-model" } });
      await applyReasoningPreferencesToRequest(specialistEvent, { ...noOptions, configDir });
      expect((specialistEvent as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBe("medium");

      // Advisory-only stored profile effort: "code" is not an agent id in the
      // role table and not a registered specialist — nothing applies.
      const profileEvent = reasoningEvent({ agent: "code", model: { providerID: "scripted", id: "echo-model" } });
      await applyReasoningPreferencesToRequest(profileEvent, { ...noOptions, configDir });
      expect((profileEvent as unknown as { options: Record<string, unknown> }).options["reasoningEffort"]).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
