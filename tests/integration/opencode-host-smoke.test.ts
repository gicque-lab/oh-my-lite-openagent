// C01 offline smoke: direct pinned-SDK imports and fixture-package structure under
// the current unit-test runner (Node + vitest, no network, no host binaries).
// Real-host loader/round-trip proof lives in scripts/test-opencode-compat.mjs
// (`node scripts/test-opencode-compat.mjs --stage loader`) because it requires the
// pinned host executables; see .liteagent/scratch/opencode-compat/report.md.
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as v1Plugin from "@opencode-ai/plugin"
import * as v2Plugin from "@opencode/plugin"

const require = createRequire(import.meta.url)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const fixtureDir = join(repoRoot, "tests", "fixtures", "opencode-compat")

describe("opencode-compat fixture package (offline structure)", () => {
  it("is a directory package exposing ./server at server.ts", () => {
    const manifest = JSON.parse(readFileSync(join(fixtureDir, "package.json"), "utf8"))
    expect(manifest.type).toBe("module")
    expect(manifest.exports?.["./server"]?.import).toBe("./server.ts")
    expect(readFileSync(join(fixtureDir, "server.ts"), "utf8")).toContain("export default")
  })

  it("declares its own dependencies (loaded from the plugin directory, not the host)", () => {
    const manifest = JSON.parse(readFileSync(join(fixtureDir, "package.json"), "utf8"))
    // v1-line SDK for the tool() helper + Zod raw shapes; @opencode/plugin is
    // intentionally absent (the v2 host supplies that runtime module itself).
    expect(manifest.dependencies?.["@opencode-ai/plugin"]).toBe("1.19.1")
    expect(manifest.dependencies?.zod).toBe("4.1.8")
    expect(manifest.dependencies?.["@opencode/plugin"]).toBeUndefined()
  })

  it("loads the dual default export under plain Node module loading", async () => {
    const mod = (await import(join(fixtureDir, "server.ts"))) as {
      default: { id: string; server: unknown; setup: unknown }
    }
    expect(mod.default.id).toBe("opencode-compat-echo-fixture")
    expect(typeof mod.default.server).toBe("function")
    expect(typeof mod.default.setup).toBe("function")
  })
})

describe("pinned SDK direct import under the current runner", () => {
  it("imports the v1-line SDK (@opencode-ai/plugin) with the tool() helper", () => {
    expect(typeof v1Plugin.tool).toBe("function")
    const definition = v1Plugin.tool({
      description: "offline shape probe",
      args: { message: v1Plugin.tool.schema.string() },
      execute: async () => "ok",
    })
    expect(typeof definition.execute).toBe("function")
    expect(Object.keys(definition.args)).toEqual(["message"])
  })

  it("imports the v2 SDK (@opencode/plugin) with Plugin.define", () => {
    const define = (v2Plugin as { Plugin?: { define?: unknown } }).Plugin?.define ?? (v2Plugin as { define?: unknown }).define
    expect(typeof define).toBe("function")
  })

  it("resolves the shared Zod version directly", () => {
    // Zod is imported directly by plugin sources and the fixture; it must be a
    // declared dependency. Both SDK lines resolve zod 4.1.8 in this repo.
    expect(require("zod/package.json").version).toBe("4.1.8")
  })
})
