// C01 compatibility fixture — test scaffolding only, never shipped in the plugin package.
//
// One dual directory entrypoint for OpenCode v1 (>=1.18.29) and v2 hosts:
//   - v1 hosts call `server(input, options)` on the default-exported object
//     (source: opencode v1.18.29/v1.19.1 packages/opencode/src/plugin/shared.ts `readV1Plugin`).
//   - v2 hosts validate the default export as `{ id, setup }` and call `setup(context)`
//     (source: opencode v2.0.30 packages/core/src/plugin/module.ts `Module` schema).
// The fixture appends JSONL evidence events (module evaluation, init, tool execution,
// session-get location lookup) so the smoke runner can assert load counts and shapes.
//
// Evidence goes to $OPENCODE_COMPAT_EVIDENCE_DIR (set by the smoke runner) and, once
// known, to the `evidenceDir` passed through the host's plugin options.
//
// The `echo` tool is registered through each host's native path:
//   - v1: `tool()` helper from `@opencode-ai/plugin` with a Zod raw shape
//   - v2: `ctx.tool.transform(editor => editor.add({...}))` with a plain JSON Schema input
// `@opencode/plugin` (the v2 host runtime module) is probed dynamically via
// `Plugin.define` "if available" and must be supplied by the v2 host itself
// (source: v2.0.30 packages/plugin/dist/runtime-modules.js runtimePackages = ["effect", "@opencode/plugin"]).
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const PLUGIN_ID = "opencode-compat-echo-fixture"

let envEvidenceDir: string | undefined = process.env.OPENCODE_COMPAT_EVIDENCE_DIR
let optionsEvidenceDir: string | undefined

function record(event: string, data: unknown) {
  const dirs = [...new Set([envEvidenceDir, optionsEvidenceDir].filter((d): d is string => typeof d === "string"))]
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify({ event, ...((data as object) ?? {}) })}\n`)
    } catch {
      // Evidence recording must never break the host.
    }
  }
}

function safeJson(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return String(value)
  }
}

// Module evaluation counter — used to prove the shim loads exactly once per host.
record("module.eval", { pid: process.pid })

let pluginDefine: ((plugin: unknown) => unknown) | undefined
let pluginDefineSource: string | undefined

try {
  // Host-supplied v2 runtime module. Must NOT be installed in the fixture's own
  // node_modules; the v2 host maps this specifier to its internal copy.
  // `Plugin.define` appears either top-level or as a `Plugin` namespace export
  // (published @opencode/plugin 2.0.30 main = dist/promise/index.js: `export * as Plugin`).
  const mod = (await import("@opencode/plugin")) as Record<string, unknown>
  const candidate = mod?.define ?? (mod?.Plugin as { define?: unknown } | undefined)?.define
  if (typeof candidate === "function") {
    pluginDefine = candidate as (plugin: unknown) => unknown
    pluginDefineSource = mod?.define ? "host-supplied @opencode/plugin (top-level define)" : "host-supplied @opencode/plugin (Plugin.define)"
  } else {
    pluginDefineSource = "imported @opencode/plugin but no define() found"
  }
} catch (error) {
  pluginDefineSource = `unavailable: ${error instanceof Error ? error.message : String(error)}`
}

// v1: the initialization input carries the SDK client (PluginInput has no client on
// ToolContext, so it must be captured here). Source: @opencode-ai/plugin 1.19.1
// dist/index.d.ts `PluginInput` and dist/tool.d.ts `ToolContext`.
type V1Input = {
  client?: {
    session?: {
      // v1 SDK client contract: path params ride as { path: { id } }.
      // Source: @opencode-ai/sdk 1.19.1 dist/gen/types.gen.d.ts `SessionGetData`.
      get?: (args: unknown) => Promise<{ data?: { directory?: string } }>
    }
  }
  directory?: string
  worktree?: string
}
let capturedV1Client: V1Input["client"] | undefined

const v1Server = (input: V1Input, options: Record<string, unknown> | undefined) => {
  optionsEvidenceDir =
    typeof options?.evidenceDir === "string" ? (options.evidenceDir as string) : optionsEvidenceDir
  record("init.v1", {
    inputKeys: Object.keys(input ?? {}).sort(),
    directory: input?.directory,
    worktree: input?.worktree,
    hasClient: Boolean(input?.client),
    options: options ?? null,
    pluginDefineSource,
  })
  capturedV1Client = input?.client
  return {
    tool: {
      echo: tool({
        description: "Echo fixture tool (v1 registration path).",
        args: {
          message: z.string().describe("Message to echo back"),
        },
        execute: async (args: { message: string }, ctx) => {
          record("execute.v1", {
            argsType: typeof args,
            args,
            contextKeys: Object.keys(ctx ?? {}).sort(),
            contextSessionIDType: typeof (ctx as { sessionID?: unknown } | null)?.sessionID,
            contextDirectory: (ctx as { directory?: string } | null)?.directory,
            contextWorktree: (ctx as { worktree?: string } | null)?.worktree,
          })
          let sessionGet: unknown = null
          try {
            if (capturedV1Client?.session?.get && ctx?.sessionID) {
              const res = await capturedV1Client.session.get({ path: { id: ctx.sessionID } } as never)
              const data = (res as { data?: { directory?: string } } | undefined)?.data
              sessionGet = {
                ok: true,
                directory: data?.directory,
                dataKeys: Object.keys(data ?? {}).sort(),
                raw: safeJson(res),
              }
            } else {
              sessionGet = { ok: false, reason: "no captured client or sessionID" }
            }
          } catch (error) {
            sessionGet = { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
          record("session.get.v1", sessionGet)
          return {
            title: "echo",
            output: `echo:${JSON.stringify(args)}`,
            metadata: args,
          }
        },
      }),
    },
  }
}

// v2: setup receives a context whose `tool.transform` registers tools with plain
// JSON Schema inputs (source: @opencode/plugin 2.0.30 dist/promise/tool.d.ts
// `ToolEditor.add`, `ToolContext`; dist/promise/plugin.d.ts `Plugin`).
type V2Context = {
  options?: Record<string, unknown>
  location?: unknown
  app?: unknown
  session?: Record<string, unknown>
  tool?: {
    transform: (callback: (editor: {
      add: (toolInfo: Record<string, unknown>) => void
    }) => Promise<void> | void) => Promise<unknown>
  }
}
const v2Setup = async (context: V2Context) => {
  optionsEvidenceDir =
    typeof context?.options?.evidenceDir === "string"
      ? (context.options.evidenceDir as string)
      : optionsEvidenceDir
  record("init.v2", {
    contextKeys: Object.keys(context ?? {}).sort(),
    options: context?.options ?? null,
    location: context?.location ?? null,
    app: context?.app ?? null,
    sessionDomainKeys: Object.keys(context?.session ?? {}).sort(),
    pluginDefineSource,
  })
  const transform = context?.tool?.transform
  if (typeof transform !== "function") {
    record("register.v2.error", { reason: "context.tool.transform is not a function" })
    return
  }
  await transform(async (editor) => {
    editor.add({
      name: "echo",
      description: "Echo fixture tool (v2 registration path).",
      // v2 wraps plugin tools in a code-mode `execute` tool by default; opt out so
      // the echo tool is exposed to the provider as a direct function tool.
      options: { codemode: false },
      input: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to echo back" },
        },
        required: ["message"],
        additionalProperties: false,
      },
      execute: async (input: unknown, toolCtx: unknown) => {
        record("execute.v2", {
          argsType: typeof input,
          args: input,
          contextKeys: Object.keys(toolCtx ?? {}).sort(),
        })
        let sessionGet: unknown = null
        try {
          const sessionDomain = context?.session as {
            get?: (args: unknown) => Promise<unknown>
          } | undefined
          const sessionID = (toolCtx as { sessionID?: string } | undefined)?.sessionID
          if (typeof sessionDomain?.get === "function" && sessionID) {
            const res = (await sessionDomain.get({ sessionID })) as {
              data?: { location?: { directory?: string }; directory?: string }
            } | undefined
            sessionGet = {
              ok: true,
              locationDirectory: res?.data?.location?.directory ?? res?.data?.directory,
              raw: safeJson(res),
            }
          } else {
            sessionGet = { ok: false, reason: "no ctx.session.get or sessionID" }
          }
        } catch (error) {
          sessionGet = { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
        record("session.get.v2", {
          pluginLocation: context?.location ?? null,
          sessionDomainKeys: Object.keys(context?.session ?? {}).sort(),
          sessionGet,
        })
        return {
          content: `echo:${JSON.stringify(input)}`,
          metadata: input,
        }
      },
    })
  })
  record("register.v2", { tool: "echo" })
}

// Single default export: v1 selects `server`, v2 selects `setup` (stable `id` required
// by both). `Plugin.define` is applied only if the host supplies it.
const base = { id: PLUGIN_ID, server: v1Server, setup: v2Setup }
export default pluginDefine ? (pluginDefine(base) as typeof base) : base
