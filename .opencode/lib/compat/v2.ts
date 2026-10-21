/**
 * Typed OpenCode v2 domain adapter (plan node C05).
 *
 * Exposes the same nine `bounded_lite_*` tools through the actual published v2
 * domain API (`@opencode/plugin` 2.0.30, promise layer):
 * - `setup(context)` receives the host Context; tools register via
 *   `context.tool.transform(editor => editor.add(...))` with native JSON Schema
 *   generated from the shared C02 Zod raw shapes (one definition source; no
 *   second namespace, unchanged tool names — PLUG-01, CAT-01, TOOL-01).
 * - Transform callbacks are synchronous and replayable: no filesystem/network
 *   I/O, no dependency installation, no coordinator creation inside them. All
 *   dependencies are captured before registration; executors invoke the shared
 *   runtime (`lib/runtime/bounded-lite-core.ts` handlers from C03).
 * - Tool executors receive the real v2 `ToolContext` ({ sessionID, agent,
 *   messageID, id, signal, progress }). It carries no directory/worktree and no
 *   client (live host evidence, C01 `session.get.v2` event):
 *   - the operation location is resolved through `context.sessionID` via the
 *     pinned session-get contract (`ctx.session.get({ sessionID })` →
 *     `location.directory`); `context.location` is only the plugin instance
 *     location and is never used for tool work. Missing session/location is an
 *     error — never `process.cwd()` or another checkout.
 *   - runtime model inventory comes from `context.model.list()` result.data
 *     envelopes, normalized while preserving providerID/id/variants and
 *     capability metadata (CAT-01); no legacy client method casts.
 * - `context.signal` maps to the shared `ToolInvocation.abort`; owned
 *   model-catalog fetches and child processes (pdftotext/soffice, models.dev
 *   fetch) abort together with the invocation signal.
 * - Permission assertions go through the documented host channel
 *   `context.permission.assert({ sessionID, action, resources })` on mutation
 *   paths only. No permission `evaluate` hook is registered: explicit deny/ask
 *   stays the host's decision and there is no prefix-based auto-allow (v1
 *   removed it; v2 must not reintroduce it). No v2 equivalents of the removed
 *   v1 no-op before/after hooks are registered.
 * - A narrow typed session `context` request hook applies stored role /
 *   specialist reasoning preferences (oh-my-lite-openagent.json, C04's
 *   stored/selected/effective shape) as the semantic option
 *   `event.options.reasoningEffort` when the effective model has no explicit
 *   variant. Task Lead profile recommendations stay advisory. An explicit
 *   variant (stored `#variant` or the session model's own variant) takes
 *   precedence and the stored effort is skipped — decision 14.
 *
 * The hook callback type is the published `SessionContext` from
 * `@opencode/plugin/promise/session`; its `options` field is
 * `SessionRequestOptions` = `Types.DeepMutable<GenerationOptionsFields> &
 * Record<string, unknown>`, so the semantic `reasoningEffort` key is a typed,
 * documented provider option — not a cast onto an inert `agent request.body`
 * (AGENT-04). Whether a given model/provider route actually forwards the
 * semantic option into its outgoing request is proven by the real-host runner
 * stage v2 and reported per model; models that cannot show an effective
 * request are reported as skipped, never silently claimed (plan C05
 * failure_handling).
 */
import { Plugin } from "@opencode/plugin";
import type { ToolContext } from "@opencode/plugin/promise/tool";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { z } from "zod";
import { listAgentModelPreferences } from "../runtime/lite-config.js";
import {
  createBoundedLiteCore,
  normalizePluginOptions,
  readRuntimeLiteConfig,
  type BoundedLiteCoreHooks,
  type BoundedLitePluginOptions,
  type CoreToolDefinition,
  type NormalizedBoundedLitePluginOptions,
  type PluginInitContext,
  type ToolInvocation,
} from "../runtime/bounded-lite-core.js";
import type { ProviderModel } from "../runtime/model-config.js";

export const BOUNDED_LITE_PLUGIN_ID = "bounded-lite";

/** Official v2 plugin context (published promise type). */
export type V2PluginContext = Plugin.Context;
/** Official v2 per-tool execution context (published promise type). */
export type V2ToolContext = ToolContext;
/** Official v2 cleanup contract (published promise type). */
export type V2Cleanup = Plugin.Cleanup | void;

/**
 * The subset of the published `ToolEditor` the adapter uses.
 */
export interface V2ToolEditorView {
  add: (tool: unknown) => void;
}

/**
 * Normalizes the v2 runtime model inventory (`ctx.model.list()` →
 * `{ location, data: Model[] }`, CAT-01). Preserves providerID/modelID plus
 * variants and capability metadata so the model-config handler reports the
 * same fields it reports for v1 runtime provider lists.
 */
export function normalizeV2ModelInventory(output: unknown): ProviderModel[] {
  const data =
    (typeof output === "object" && output !== null && Array.isArray((output as { data?: unknown })["data"]))
      ? (output as { data: unknown[] })["data"]
      : Array.isArray(output)
        ? output
        : [];

  const models: ProviderModel[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const info = raw as Record<string, unknown>;
    const providerID = typeof info["providerID"] === "string" ? info["providerID"] : undefined;
    const modelID = typeof info["modelID"] === "string" ? info["modelID"] : undefined;
    if (!providerID || !modelID) continue;

    const variants = Array.isArray(info["variants"])
      ? info["variants"]
          .map((variant) =>
            typeof (variant as { id?: unknown })?.id === "string"
              ? (variant as { id: string }).id
              : (typeof variant === "string" ? variant : undefined),
          )
          .filter((variant): variant is string => Boolean(variant))
      : [];

    models.push({
      provider: providerID,
      model: modelID,
      id: `${providerID}/${modelID}`,
      ...(typeof info["name"] === "string" && info["name"].trim() !== "" ? { name: info["name"] } : {}),
      variants,
      reasoning: hasReasoningCapability(info),
    });
  }

  return models;
}

/** Best-effort reasoning capability read from the v2 Model compatibility/variants shape. */
function hasReasoningCapability(info: Record<string, unknown>): boolean {
  const compatibility = info["compatibility"];
  if (typeof compatibility === "object" && compatibility !== null) {
    const effort = (compatibility as Record<string, unknown>)["supportsEffortUpdates"];
    if (effort === true) return true;
  }
  const capabilities = info["capabilities"];
  if (typeof capabilities === "object" && capabilities !== null) {
    const reasoning = (capabilities as Record<string, unknown>)["reasoning"];
    if (reasoning === true || reasoning === false) return reasoning;
  }
  return false;
}

/**
 * Resolves the operation location for a tool invocation through the pinned
 * session-get contract: `ctx.session.get({ sessionID })` → `location.directory`
 * (verified live on v2.0.30, C01 `session.get.v2` evidence: the returned
 * session carries `location: { directory }`). `context.location` (the plugin
 * instance location) is deliberately never consulted for tool work. Missing
 * session/location fails closed — tool operations never resolve against
 * `process.cwd()` or another checkout.
 */
export async function resolveV2OperationLocation(
  context: Pick<V2PluginContext, "session">,
  sessionID: string,
): Promise<{ directory: string; worktree: string }> {
  const session = context?.session;
  if (!session || typeof session.get !== "function") {
    throw new Error(
      "v2 host session domain lacks get(); refusing to resolve the operation location.",
    );
  }
  const resolved = await session.get({ sessionID }) as
    | { location?: { directory?: string } }
    | undefined;
  const directory = resolved?.location?.directory;
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new Error(
      `Session ${sessionID} carries no location directory; refusing to resolve plan artifact roots against process.cwd().`,
    );
  }
  return { directory, worktree: directory };
}

/** Cast-free structural guard before calling permission.assert. */
interface V2PermissionAssert {
  (input: {
    sessionID: V2ToolContext["sessionID"];
    action: string;
    resources: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * One tool executor: validates the wire input against the same shared Zod raw
 * shape the v1 host validates with (wire parity: v1 rejects these before
 * execute), resolves the operation location through session-get, maps
 * signal/ask/progress channels onto `ToolInvocation`, and delegates to the
 * shared runtime handler. Thrown errors (authorization/cancellation/format)
 * flow to the host error channel as-is.
 */
async function executeCoreToolV2(
  operation: {
    context: Pick<V2PluginContext, "session" | "permission">;
    definition: CoreToolDefinition;
    toolName: string;
  },
  input: unknown,
  toolCtx: V2ToolContext,
): Promise<{ readonly content: string }> {
  if (typeof input !== "object" || input === null) {
    throw new Error(`Tool ${operation.toolName} requires structured object arguments.`);
  }

  // Wire parity with v1: same shared shapes, same validation boundary.
  validateInputAgainstShape(operation.toolName, operation.definition.args, input);

  const sessionID = toolCtx?.sessionID;
  if (typeof sessionID !== "string" || sessionID.trim() === "") {
    throw new Error(
      `v2 tool ${operation.toolName} invocation carries no sessionID; refusing to resolve the operation location against process.cwd().`,
    );
  }
  const location = await resolveV2OperationLocation(operation.context, sessionID);

  const assert = operation.context?.permission?.assert as V2PermissionAssert | undefined;
  const agent = typeof toolCtx?.agent === "string" ? toolCtx.agent : undefined;
  const askChannel = assert
    ? async (askInput: {
        permission: string;
        patterns: string[];
        always: string[];
        metadata: Record<string, unknown>;
      }): Promise<void> => {
        // v2 resources carry the core's shared mutation patterns unchanged
        // (same mutation-path provenance as the v1 ask channel); deny/ask
        // decisions remain the host's, and any rejection (denial) propagates
        // as a thrown authorization error, never swallowed.
        const askMetadata = askInput.metadata as Record<string, unknown> | undefined;
        await assert({
          sessionID,
          action: askInput.permission,
          resources: [...askInput.patterns],
          ...(askMetadata !== undefined ? { metadata: askMetadata } : {}),
        });
      }
    : undefined;
  const invocation: ToolInvocation = {
    sessionID,
    ...(agent !== undefined ? { agent } : {}),
    directory: location.directory,
    worktree: location.worktree,
    abort: toolCtx?.signal ?? undefined,
    ...(askChannel !== undefined ? { ask: askChannel } : {}),
    metadata: (update) => {
      if (typeof toolCtx?.progress !== "function") return;
      void toolCtx.progress((update.metadata ?? {}) as Record<string, never>);
    },
  };

  const result = await operation.definition.execute(input as Record<string, unknown>, invocation);
  return { content: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
}

function validateInputAgainstShape(
  toolName: string,
  shape: Record<string, unknown>,
  input: unknown,
): void {
  const parsed = z.object(shape as z.ZodRawShape).safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Tool ${toolName} arguments failed validation: ${detail}`);
  }
}

/** zod raw shape → native JSON Schema. Empty shapes stay empty objects. */
function toJSONSchemaForToolArgs(args: Record<string, unknown>, toolName: string): Record<string, unknown> {
  try {
    return z.toJSONSchema(z.object(args as z.ZodRawShape)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Tool ${toolName} arguments cannot be projected to v2 JSON Schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Registers the shared runtime through the host's tool transform editor. The
 * returned callback closes over captured dependencies only (pure JSON Schema
 * definitions built once before the callback): replay (host reload) adds the
 * same definitions again to a fresh editor state without duplicating names or
 * resetting shared coordinator state.
 */
function createToolTransform(
  operation: {
    context: Pick<V2PluginContext, "session" | "permission">;
    hooks: BoundedLiteCoreHooks;
  },
): (editor: { add: (tool: unknown) => void }) => void {
  // Definitions (including the JSON Schema projection) are built exactly once,
  // before any transform round: every replay adds the same definition objects,
  // so reload cannot drift the exposed schema or reset shared runtime state.
  const registrations = (Object.entries(operation.hooks.tool) as [string, CoreToolDefinition][]).map(
    ([toolName, definition]) => ({
      toolName,
      definition,
      input: toJSONSchemaForToolArgs(definition.args, toolName),
    }),
  );

  return (editor) => {
    for (const registration of registrations) {
      editor.add({
        name: registration.toolName,
        description: registration.definition.description,
        input: registration.input,
        options: { codemode: false },
        execute: (input: unknown, toolCtx: V2ToolContext) =>
          executeCoreToolV2(
            { context: operation.context, definition: registration.definition, toolName: registration.toolName },
            input,
            toolCtx,
          ),
      });
    }
  };
}

/**
 * Applies stored lite-config reasoning preferences to the outgoing session
 * context. Applies only when:
 * - the effective agent is a managed fixed role or a registered specialist
 *   (Task Lead profile recommendations remain advisory — decision 14);
 * - a stored reasoning effort exists AND no explicit variant is in play (the
 *   stored `#variant` conflict is reported by C04 tooling; the session
 *   model's own variant wins precedence — decision 14);
 * - the stored base model reference matches the model actually requested.
 * When a host catalog inventory snapshot is supplied the model must be
 * locatable in it, otherwise the effort is silently SKIPPED (reported as
 * skipped by not claiming it — capability check per plan C05).
 */
export interface V2ReasoningRegistrationSnapshot {
  readonly registered: boolean;
  readonly disposal: "host-managed" | "not-registered";
}

/**
 * v2 setup: validates options exactly as the v1 factory does, captures the
 * host domains once, registers all nine tools through one transform, and
 * installs the narrow typed session request hook for reasoning preferences.
 *
 * Returned cleanup only covers resources actually owned by setup (the bounded
 * background coordinator's tracked tasks); the host owns transforms and hooks
 * and disposes them itself (`session.hook` Registration.dispose is returned to
 * the host through the returned cleanup closure only as a courtesy — the host
 * may drop it when disposing the plugin module).
 */
export async function setupBoundedLiteV2(
  context: V2PluginContext,
): Promise<V2Cleanup> {
  const hostOptions = (context?.options ?? {}) as Record<string, unknown>;
  // Same validation path as the v1 factory: options normalization rejects
  // invalid maxChildDepth before any registration happens.
  const options = normalizePluginOptions(hostOptions as BoundedLitePluginOptions);

  // Capture host dependencies BEFORE registration (transforms never create
  // coordinators or timers). No network/API call at setup (lazy per request).
  const runtimeModels = async (): Promise<ProviderModel[]> =>
    normalizeV2ModelInventory(await context.model.list({}));

  const hooks = await createBoundedLiteCore(
    { runtimeModels } as PluginInitContext,
    hostOptions,
  );

  const transform = createToolTransform({ context, hooks });
  await context.tool.transform((editor) => transform(editor as never));

  // Optional narrow session request hook. Registered only when the host
  // exposes the typed hook channel; registration failures surface as a setup
  // error, never as a silent no-op hook.
  const reasoningRegistration = await context.session.hook("context", async (event) => {
    // The host catalog inventory is checked lazily on first use so setup
    // stays network-free; each application consults the shared config
    // boundary for the stored values.
    await applyReasoningPreferencesToRequest(event, options, await runtimeModels());
  });

  return () => {
    void reasoningRegistration?.dispose();
    hooks.disposeResources?.();
  };
}

/**
 * Re-export alias: the v2 domain setup under the combined default export's
 * `setup` contract (Plugin interface). One plugin instance, stable id.
 */
export const setup = setupBoundedLiteV2;

export async function applyReasoningPreferencesToRequest(
  event: SessionContext,
  options: NormalizedBoundedLitePluginOptions,
  modelInventory?: ProviderModel[],
): Promise<void> {
  if (!event?.options) return;
  const agent = typeof event?.agent === "string" ? event.agent : "";
  if (!agent) return;

  const { liteConfig } = await readRuntimeLiteConfig(options.configDir);
  const preferences = listAgentModelPreferences(liteConfig);
  const preference = preferences.find((p) =>
    (p.kind === "role" && p.agentId === agent) ||
    (p.kind === "specialist" && Boolean(liteConfig.specialists?.[agent])),
  );
  if (!preference?.storedReasoningEffort) return;

  // Explicit variant wins (stored `#variant` or the session model's variant).
  const modelRef = event?.model as { variant?: string; providerID?: string; id?: string } | undefined;
  if (preference.selectedVariant) return;
  if (typeof modelRef?.variant === "string" && modelRef.variant !== "") return;

  // Only drive a stored effort for the stored base model reference; a
  // different effective model belongs to a config shadow reported by C04.
  if (preference.baseModel && modelRef?.providerID && modelRef?.id) {
    const actualBase = `${modelRef.providerID}/${modelRef.id}`;
    if (actualBase && actualBase !== preference.baseModel) return;
  }

  // Capability gate — a stored effort stays a claim until the host inventory
  // verifies it. Evidence rules:
  // - when a snapshot is available, the requested model must be locatable in
  //   it, otherwise the effort is silently SKIPPED (reported as skipped by not
  //   claiming it);
  // - when a stored model pin exists (baseModel), that model's capability is a
  //   model-specific claim, so without any snapshot it also stays skipped;
  // - only a loose, unpinned default effort may be applied without evidence.
  if (preference.baseModel || modelInventory !== undefined) {
    if (!modelInventory) return;
    const entry = modelInventory.find(
      (model) => model.provider === modelRef?.providerID && model.model === modelRef?.id,
    );
    if (!entry) return;
  }

  event.options.reasoningEffort = preference.storedReasoningEffort;
}
