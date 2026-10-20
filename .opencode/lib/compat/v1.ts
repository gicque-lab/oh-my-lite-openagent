import {
  type Hooks,
  type ToolContext,
  tool,
} from "@opencode-ai/plugin";

export {
  type BoundedLitePluginOptions,
  type NormalizedBoundedLitePluginOptions,
  normalizePluginOptions,
  type ToolInvocation,
  type PluginInitContext,
} from "../runtime/bounded-lite-core.js";
import {
  type BoundedLitePluginOptions,
  createBoundedLiteCore,
  type CoreToolDefinition,
  type PluginInitContext,
} from "../runtime/bounded-lite-core.js";

/**
 * Narrow structural subset of the official v1 `PluginInput` that the runtime
 * actually consumes. Real v1 hosts pass the full PluginInput (client, project,
 * worktree, serverUrl, $); unit harnesses pass lightweight fakes. Only the
 * initialization client matters here — it is captured once and never re-read
 * from tool execution context.
 */
export interface V1PluginInput extends PluginInitContext {}

/**
 * Correctly typed v1 adapter: wraps each SDK-neutral core tool in the official
 * v1 `tool()` helper so args are validated by the registered Zod shape and
 * execute receives the real v1 `ToolContext` (which carries directory, worktree,
 * abort, metadata and ask — and no client/project fields).
 */
export async function createBoundedLitePlugin(
  input: V1PluginInput,
  rawOptions?: Record<string, unknown>,
): Promise<Hooks> {
  const core = await createBoundedLiteCore(input as PluginInitContext, rawOptions);

  const toolEntries: Record<string, ReturnType<typeof tool>> = {};
  for (const [toolName, definition] of Object.entries(core.tool) as [string, CoreToolDefinition][]) {
    toolEntries[toolName] = tool({
      description: definition.description,
      args: definition.args as never,
      async execute(args, context: ToolContext) {
        return definition.execute(args as Record<string, unknown>, context) as never;
      },
    });
  }

  const hooks: Hooks = {};
  hooks.tool = toolEntries as NonNullable<Hooks["tool"]>;
  if (core.config) hooks.config = core.config;
  return hooks;
}
