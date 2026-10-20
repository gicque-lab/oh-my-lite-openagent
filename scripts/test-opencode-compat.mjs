#!/usr/bin/env node
// C01 compatibility smoke runner — bounded, credential-free, fully isolated.
//
// Proves the dual OpenCode v1/v2 loader and dependency contracts on pinned host
// binaries with every piece of state (config, HOME/XDG, TMPDIR, npm cache, deps,
// logs) inside .liteagent/scratch/opencode-compat/. Hosts are never put on PATH.
//
// Usage:
//   node scripts/test-opencode-compat.mjs [--stage loader|v1|all]
//
// Stages:
//   loader (default)
//            Stage pinned hosts + fixture, run each host against the dual
//            directory entrypoint, capture host-exported tool schemas and a
//            structured echo tool round trip through a deterministic scripted
//            OpenAI-compatible provider (no credentials, no real LLM).
//   v1       C03 real-host gate on the two pinned v1 hosts: the REAL bounded-lite
//            plugin (.opencode/plugins/bounded-lite.ts -> lib/compat/v1.ts ->
//            lib/runtime/bounded-lite-core.ts) is staged as a directory entrypoint
//            package and driven through a scripted provider. Proves: plugin load +
//            registered bounded_lite tools, one successful structured plan-tool
//            round trip (object-only payload contract), malformed Markdown-string
//            payload rejection with a format diagnostic, plan artifact root
//            confinement against the invocation worktree (nested directory case,
//            not process.cwd), runtime model discovery through the captured init
//            client, and a host-configured deny staying deny (no auto-allow).
//   all      loader + v1.
//
// Host acquisition: official npm distribution packages with exact pins
//   v1.18.29  opencode-ai@1.18.29     (platform pkg opencode-linux-x64)
//   v1.19.1   opencode-ai@1.19.1      (platform pkg opencode-linux-x64)
//   v2.0.30   @opencode/cli@2.0.30    (platform pkg @opencode/cli-linux-x64)
// npm lifecycle scripts are blocked by default in npm >= 12; the host packages'
// postinstall.mjs is executed manually with the isolated environment instead.
import { spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..")
const SCROOT = join(REPO_ROOT, ".liteagent", "scratch", "opencode-compat")
const FIXTURE_SRC = join(REPO_ROOT, "tests", "fixtures", "opencode-compat")

const HOSTS = [
  { id: "opencode-v1.18.29", pkg: "opencode-ai@1.18.29", line: "v1" },
  { id: "opencode-v1.19.1", pkg: "opencode-ai@1.19.1", line: "v1" },
  { id: "opencode-v2.0.30", pkg: "@opencode/cli@2.0.30", line: "v2" },
]

const paths = {
  hosts: join(SCROOT, "hosts"),
  fixtureStage: join(SCROOT, "fixture-stage"),
  v1FixtureStage: join(SCROOT, "v1-fixture-stage"),
  project: join(SCROOT, "project"),
  v1Project: join(SCROOT, "project-v1"),
  config: join(SCROOT, "config"),
  data: join(SCROOT, "data"),
  cache: join(SCROOT, "cache"),
  home: join(SCROOT, "home"),
  tmp: join(SCROOT, "tmp"),
  logs: join(SCROOT, "logs"),
  evidence: join(SCROOT, "evidence"),
  npmCache: join(SCROOT, "npm-cache"),
  provider: join(SCROOT, "scripted-provider.mjs"),
  report: join(SCROOT, "report.json"),
}

function log(msg) {
  process.stdout.write(`[opencode-compat] ${msg}\n`)
}

function ensureDirs() {
  for (const dir of [paths.hosts, paths.fixtureStage, paths.v1FixtureStage, paths.project, paths.v1Project, paths.config, paths.data, paths.cache, paths.home, paths.tmp, paths.logs, paths.evidence, paths.npmCache]) {
    mkdirSync(dir, { recursive: true })
  }
}

// npm CLI resolution: npm_execpath when present, then the node install prefix,
// then bare "npm" (libuv PATH lookup). Never modifies PATH itself.
function npmCli() {
  const fromEnv = process.env.npm_execpath
  if (fromEnv && fromEnv.endsWith("npm-cli.js") && existsSync(fromEnv)) return fromEnv
  const fromPrefix = join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  if (existsSync(fromPrefix)) return fromPrefix
  return "npm"
}

function runNpm(args, cwd, extraEnv = {}) {
  const cli = npmCli()
  const res = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: paths.home,
      TMPDIR: paths.tmp,
      npm_config_cache: paths.npmCache,
      npm_config_audit: "false",
      npm_config_fund: "false",
      ...extraEnv,
    },
    encoding: "utf8",
  })
  return res
}

// Stage a pinned host binary. Never modifies PATH; never touches ~/.opencode.
function stageHost(host) {
  const dir = join(paths.hosts, host.id)
  const v1Bin = join(dir, "node_modules", "opencode-ai", "bin", "opencode.exe")
  const v2Bin = join(dir, "node_modules", "@opencode", "cli", "bin", "opencode.exe")
  if (existsSync(v1Bin) && statSync(v1Bin).size > 1_000_000) return v1Bin
  if (existsSync(v2Bin) && statSync(v2Bin).size > 1_000_000) return v2Bin

  log(`staging host ${host.id} from ${host.pkg}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "opencode-compat-host-stage", private: true, type: "module" }))
  const install = runNpm(["install", "--no-audit", "--no-fund", host.pkg], dir)
  if (install.status !== 0) {
    throw new Error(`npm install failed for ${host.pkg}: ${install.stderr?.slice(-800)}`)
  }
  // npm >= 12 blocks lifecycle scripts by default; run the pinned host's postinstall manually.
  const postinstall = existsSync(join(dir, "node_modules", "opencode-ai", "postinstall.mjs"))
    ? join(dir, "node_modules", "opencode-ai", "postinstall.mjs")
    : join(dir, "node_modules", "@opencode", "cli", "postinstall.mjs")
  const nodeBinDir = dirname(process.execPath)
  const post = spawnSync(process.execPath, [postinstall], {
    cwd: dir,
    env: { ...process.env, HOME: paths.home, TMPDIR: paths.tmp, npm_config_cache: paths.npmCache, PATH: `${nodeBinDir}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  })
  if (post.status !== 0) throw new Error(`postinstall failed for ${host.pkg}: ${post.stderr?.slice(-800)}`)

  const bin = host.line === "v1" ? v1Bin : v2Bin
  if (!existsSync(bin) || statSync(bin).size < 1_000_000) throw new Error(`host binary missing after postinstall: ${bin}`)
  return bin
}

function hostVersion(bin) {
  const res = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 60_000 })
  return (res.stdout ?? "").trim().split("\n").pop() ?? ""
}

// Stage the fixture package (server.ts + package.json with ./server export) and
// install its own dependencies so dependency resolution happens from the plugin's
// own directory. The staged node_modules intentionally has NO @opencode/plugin —
// the v2 host must supply that runtime module itself.
function stageFixture(host) {
  const dir = join(paths.fixtureStage, host.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(FIXTURE_SRC, "server.ts"), join(dir, "server.ts"))
  copyFileSync(join(FIXTURE_SRC, "package.json"), join(dir, "package.json"))
  const install = runNpm(["install", "--no-audit", "--no-fund"], dir)
  if (install.status !== 0) throw new Error(`fixture install failed for ${host.id}: ${install.stderr?.slice(-800)}`)
  if (existsSync(join(dir, "node_modules", "@opencode", "plugin"))) {
    throw new Error(`fixture for ${host.id} must NOT contain its own @opencode/plugin copy`)
  }
  return dir
}

// Stage the REAL bounded-lite plugin as a v1 directory entrypoint package:
// server-side copies of .opencode/{plugins,lib} preserving relative imports, a
// ./server export, and its own dependencies installed from the warm npm cache.
// This mirrors how a real install looks (C01 proven layout: the v1 host resolves
// the ./server export of the configured directory and dependency resolution
// happens from the plugin's own directory, not the checkout's node_modules).
function stageV1Fixture(host) {
  const dir = join(paths.v1FixtureStage, host.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  cpSync(join(REPO_ROOT, ".opencode", "lib"), join(dir, "lib"), { recursive: true })
  mkdirSync(join(dir, "plugins"), { recursive: true })
  copyFileSync(join(REPO_ROOT, ".opencode", "plugins", "bounded-lite.ts"), join(dir, "plugins", "bounded-lite.ts"))
  writeFileSync(join(dir, "server.ts"), 'export { createBoundedLitePlugin as default } from "./plugins/bounded-lite.ts"\n')
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({
    name: "bounded-lite-v1-compat-fixture",
    version: "0.0.0",
    private: true,
    type: "module",
    description: "Real bounded-lite plugin staged as a v1 directory entrypoint for the C03 compat gate.",
    exports: { "./server": { import: "./server.ts", types: "./server.ts" } },
    dependencies: { "@opencode-ai/plugin": "1.19.1", "zod": "4.1.8" },
  }, null, 2)}\n`)
  const install = runNpm(["install", "--no-audit", "--no-fund"], dir)
  if (install.status !== 0) throw new Error(`v1 fixture install failed for ${host.id}: ${install.stderr?.slice(-800)}`)
  return dir
}

// Deterministic scripted provider: prints {"port": N} on stdout.
// Echo mode: startProvider(port, captureOut). Script mode (v1 stage) adds
// scriptFile (tool-call steps) and requestLog (JSONL of every request body).
function startProvider(port, captureOut, scriptFile, requestLog) {
  const child = spawn(process.execPath, [paths.provider, String(port), captureOut, scriptFile ?? "", requestLog ?? ""].filter((arg) => arg !== ""), {
    env: { ...process.env, TMPDIR: paths.tmp },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return new Promise((resolvePromise, rejectPromise) => {
    let out = ""
    const timer = setTimeout(() => rejectPromise(new Error("scripted provider did not report a port")), 15_000)
    child.stdout.on("data", (c) => {
      out += c
      const hit = out.match(/\{"port":\s*(\d+)\}/)
      if (hit) {
        clearTimeout(timer)
        resolvePromise({ child, port: Number(hit[1]) })
      }
    })
    child.on("exit", (code) => rejectPromise(new Error(`scripted provider exited early: ${code}`)))
    child.stderr.on("data", (c) => process.stderr.write(`[provider] ${c}`))
  })
}

function writeHostConfig(host, fixtureDir, evidenceDir, providerPort) {
  const projectDir = join(paths.project, host.id)
  mkdirSync(projectDir, { recursive: true })
  // The v2 host discovers .opencode dirs in EVERY ancestor (v2.0.30 discovery.ts
  // fs.up without stop); an isolated nested .git does not stop that walk. Each
  // scratch project keeps its own git root so the v1 host treats it as the project.
  if (!existsSync(join(projectDir, ".git"))) {
    spawnSync("git", ["init", "-q", projectDir])
  }
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      scripted: {
        npm: "@ai-sdk/openai-compatible",
        name: "Scripted",
        options: { baseURL: `http://127.0.0.1:${providerPort}/v1` },
        models: { "echo-model": { name: "Echo Model", tool_call: true } },
      },
    },
    small_model: "scripted/echo-model",
  }
  if (host.line === "v1") {
    // v1 dialect: plugin entries are specs or [spec, options] tuples.
    config.plugin = [[fixtureDir, { evidenceDir }]]
  } else {
    // v2 dialect: native `plugins` key accepts { package, options } objects.
    // The `-` prefix removes an auto-discovered plugin (v2.0.30 source.ts parse());
    // used to suppress the checkout's own production plugin discovered by the
    // ancestor walk.
    config.plugins = [
      { package: fixtureDir, options: { evidenceDir } },
      `-` + join(REPO_ROOT, ".opencode", "plugins", "bounded-lite.ts"),
    ]
  }
  writeFileSync(join(projectDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`)
  return projectDir
}

// v1 stage project layout: <projectDir> is its own git worktree root and the host
// is invoked from <projectDir>/nested, so the invocation worktree (worktree root)
// and the host process cwd (nested dir) differ — proving plan artifact roots
// resolve from the invocation worktree, never from process.cwd(). The configured
// bash deny must stay deny: the real plugin must not auto-allow host policy.
function writeV1HostConfig(host, fixtureDir, providerPort) {
  const projectDir = join(paths.v1Project, host.id)
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(join(projectDir, "nested"), { recursive: true })
  spawnSync("git", ["init", "-q", projectDir])
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      scripted: {
        npm: "@ai-sdk/openai-compatible",
        name: "Scripted",
        options: { baseURL: `http://127.0.0.1:${providerPort}/v1` },
        models: { "echo-model": { name: "Echo Model", tool_call: true } },
      },
    },
    small_model: "scripted/echo-model",
    // Real plugin directory entrypoint (v1 dialect), no plugin options.
    plugin: [fixtureDir],
    permission: { bash: "deny" },
  }
  writeFileSync(join(projectDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`)
  return { projectDir, nestedDir: join(projectDir, "nested") }
}

// v2 hosts daemonize a shared `serve --service` process that outlives the runner
// invocation. A warm service has already evaluated the plugin module, which would
// zero the loader stage's module.eval count on repeat runs. Kill only processes
// whose cmdline contains the STAGED host directory — the user's own opencode
// installs never match that path.
function killStagedHostServices(bin) {
  spawnSync("pkill", ["-f", dirname(bin)])
}

function runHost(host, bin, projectDir, evidenceDir, timeoutMs, { prompt = "Call the echo tool once with any message.", logPrefix = host.id } = {}) {
  killStagedHostServices(bin)
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: join(paths.home, host.id),
    XDG_CONFIG_HOME: join(paths.config, host.id),
    XDG_DATA_HOME: join(paths.data, host.id),
    XDG_CACHE_HOME: join(paths.cache, host.id),
    TMPDIR: paths.tmp,
    npm_config_cache: paths.npmCache,
    OPENCODE_COMPAT_EVIDENCE_DIR: evidenceDir,
    OPENCODE_DISABLE_AUTOUPGRADE: "1",
  }
  const args = ["run", "-m", "scripted/echo-model", prompt, "--format", "json"]
  if (host.line === "v1") {
    // v1 has no --standalone (it is already a private server per invocation).
    args.splice(1, 1)
  }
  const res = spawnSync(bin, args, { cwd: projectDir, env, encoding: "utf8", timeout: timeoutMs })
  killStagedHostServices(bin)
  writeFileSync(join(paths.logs, `${logPrefix}-run.out`), res.stdout ?? "")
  writeFileSync(join(paths.logs, `${logPrefix}-run.err`), res.stderr ?? "")
  return res
}

function readEvents(evidenceDir) {
  const file = join(evidenceDir, "events.jsonl")
  if (!existsSync(file)) return []
  return file
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
}

function assert(cond, message, problems) {
  if (!cond) problems.push(message)
  return cond
}

async function runLoaderStage() {
  ensureDirs()
  const results = []

  for (const host of HOSTS) {
    const problems = []
    const evidenceDir = join(paths.evidence, host.id)
    rmSync(evidenceDir, { recursive: true, force: true })
    mkdirSync(evidenceDir, { recursive: true })

    let bin, fixtureDir, version
    try {
      bin = stageHost(host)
      version = hostVersion(bin)
      fixtureDir = stageFixture(host)
    } catch (error) {
      results.push({ host: host.id, ok: false, stage: "staging", error: String(error.message ?? error) })
      continue
    }
    log(`host ${host.id} staged: ${bin} (${version})`)

    const { child: provider, port } = await startProvider(0, join(evidenceDir, "provider-capture.json"))
    let runRes
    try {
      const projectDir = writeHostConfig(host, fixtureDir, evidenceDir, port)
      runRes = runHost(host, bin, projectDir, evidenceDir, 180_000)
    } finally {
      provider.kill()
    }

    const events = readEvents(evidenceDir)
    const moduleEvals = events.filter((e) => e.event === "module.eval")
    const initEvent = events.find((e) => e.event === `init.${host.line}`)
    const executeEvent = events.find((e) => e.event === `execute.${host.line}`)
    const registerEvent = events.find((e) => e.event === `register.${host.line}`) ?? (host.line === "v1" ? { present: true } : undefined)

    // Host-exported tool schema captured from the scripted provider payload.
    let echoSchema = null
    let providerToolNames = []
    try {
      const capture = JSON.parse(readFileSync(join(evidenceDir, "provider-capture.json"), "utf8"))
      providerToolNames = (capture.tools ?? []).map((t) => t?.function?.name).filter(Boolean)
      echoSchema = (capture.tools ?? []).find((t) => t?.function?.name === "echo")?.function?.parameters ?? null
    } catch {}

    let roundTrip = false
    try {
      roundTrip = (readFileSync(join(paths.logs, `${host.id}-run.out`), "utf8").includes("echo-roundtrip-ok"))
    } catch {}

    assert(runRes.status === 0, `host run exited ${runRes.status}`, problems)
    assert(moduleEvals.length === 1, `expected exactly 1 module.eval, got ${moduleEvals.length}`, problems)
    assert(Boolean(initEvent), `missing init.${host.line} event`, problems)
    if (initEvent) {
      assert(Boolean(initEvent.options?.evidenceDir), "options from config did not reach the plugin", problems)
      assert(Boolean(initEvent.pluginDefineSource), "plugin.define probe did not run", problems)
      if (host.line === "v1") assert(initEvent.hasClient === true, "v1 init input did not carry the SDK client", problems)
      if (host.line === "v2") assert(Array.isArray(initEvent.sessionDomainKeys) && initEvent.sessionDomainKeys.includes("get"), "v2 session domain lacks get()", problems)
    }
    if (host.line === "v2") assert(Boolean(registerEvent), "missing register.v2 event (echo tool registration)", problems)
    assert(Boolean(executeEvent), `missing execute.${host.line} event`, problems)
    if (executeEvent) {
      assert(executeEvent.argsType === "object", `structured call args arrived as ${executeEvent.argsType}`, problems)
      assert(executeEvent.args?.message === "structured-hello-from-runner", "echo args value mismatch", problems)
    }
    assert(Boolean(echoSchema) && echoSchema?.type === "object" && Array.isArray(echoSchema?.required), "host-exported echo tool schema missing from provider payload", problems)
    assert(roundTrip, "final assistant text (echo-roundtrip-ok) missing from run output", problems)

    const sessionGet = events.find((e) => e.event.startsWith("session.get"))
    results.push({
      host: host.id,
      pkg: host.pkg,
      line: host.line,
      ok: problems.length === 0,
      problems,
      hostBinary: bin,
      hostVersion: version,
      fixtureDir,
      evidenceDir,
      init: initEvent ?? null,
      execute: executeEvent ?? null,
      sessionGet: sessionGet ?? null,
      providerToolNames,
      echoSchema,
    })
  }

  return results
}

// Scripted tool-call sequence for the v1 stage (played in order by the provider).
const V1_FINAL_TEXT = "v1-compat-final-ok"

function buildV1Script() {
  return [
    // 1. Structured plan tool round trip: object-only payload contract (C02).
    {
      tool: "bounded_lite_plan_dag",
      arguments: {
        payload: {
          plan: {
            subtasks: [
              {
                id: "V1A",
                depends_on: [],
                attributes: ["code"],
                deliverable: "Runner verification artifact",
                description: "Valid structured DAG payload from the compat runner.",
              },
            ],
          },
        },
      },
    },
    // 2. Plan artifact write: resolves its root from the invocation worktree.
    {
      tool: "bounded_lite_plan_artifact",
      arguments: {
        title: "V1 Compat Confinement Probe",
        markdown: "---\ntitle: V1 Compat Confinement Probe\nmaturity_level: M3\n---\n\n# V1 Compat Confinement Probe\n\nRunner-generated plan artifact for worktree confinement verification.\n",
        path: ".liteagent/plans/v1-compat-confinement-probe.md",
      },
    },
    // 3. Runtime model discovery through the captured init client.
    { tool: "bounded_lite_model_config", arguments: { action: "list" } },
    // 4. Host-configured deny probe: must not become allow (no auto-allow).
    { tool: "bash", arguments: { command: "echo DENIED-PROBE-OUTPUT", description: "Permission deny probe (must stay denied)" } },
    // 5. Malformed Markdown-string payload: one format diagnostic, no cascade.
    {
      tool: "bounded_lite_plan_dag",
      arguments: {
        payload: "---\ntitle: Not An Object\n---\n\n# Raw Markdown Submission\n\n## goals\n- must be rejected as a format error\n",
      },
    },
  ]
}

// Extract real tool results (per tool name, in completion order) from the JSONL
// request log the scripted provider appends to in script mode.
function readToolResults(requestLog) {
  if (!existsSync(requestLog)) return []
  const callNames = new Map()
  const toolResults = []
  for (const line of readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean)) {
    let body
    try {
      body = JSON.parse(line)?.body
    } catch {
      continue
    }
    for (const message of body?.messages ?? []) {
      if (message?.role === "assistant") {
        for (const call of message?.tool_calls ?? []) {
          if (call?.id && call?.function?.name) callNames.set(call.id, call.function.name)
        }
      } else if (message?.role === "tool") {
        toolResults.push({
          callID: message.tool_call_id ?? null,
          name: callNames.get(message.tool_call_id) ?? `(unknown:${message.tool_call_id})`,
          content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        })
      }
    }
  }
  return toolResults
}

async function runV1Stage() {
  ensureDirs()
  const results = []

  for (const host of HOSTS.filter((h) => h.line === "v1")) {
    const problems = []
    const evidenceDir = join(paths.evidence, `v1-${host.id}`)
    rmSync(evidenceDir, { recursive: true, force: true })
    mkdirSync(evidenceDir, { recursive: true })

    let bin, version, fixtureDir
    try {
      bin = stageHost(host)
      version = hostVersion(bin)
      fixtureDir = stageV1Fixture(host)
    } catch (error) {
      results.push({ host: host.id, pkg: host.pkg, line: host.line, stage: "v1", ok: false, error: String(error.message ?? error) })
      continue
    }
    log(`v1 host ${host.id} staged: ${bin} (${version})`)

    const requestLog = join(evidenceDir, "provider-requests.jsonl")
    writeFileSync(join(evidenceDir, "v1-script.json"), `${JSON.stringify(buildV1Script(), null, 2)}\n`)

    const { child: provider, port } = await startProvider(
      0,
      join(evidenceDir, "provider-capture.json"),
      join(evidenceDir, "v1-script.json"),
      requestLog,
    )
    let runRes, projectDir, nestedDir
    try {
      ;({ projectDir, nestedDir } = writeV1HostConfig(host, fixtureDir, port))
      runRes = runHost(host, bin, nestedDir, evidenceDir, 240_000, {
        prompt: "Execute the scripted tool calls exactly as they arrive, in order. Do not improvise other calls.",
        logPrefix: `v1-${host.id}`,
      })
    } finally {
      provider.kill()
    }

    // Host-exported tool names from the scripted provider capture: the real
    // plugin's bounded_lite tools must be visible to the provider.
    let providerToolNames = []
    try {
      const capture = JSON.parse(readFileSync(join(evidenceDir, "provider-capture.json"), "utf8"))
      providerToolNames = (capture.tools ?? []).map((t) => t?.function?.name).filter(Boolean)
    } catch {}
    const boundedTools = providerToolNames.filter((name) => name.startsWith("bounded_lite_"))

    const toolResults = readToolResults(requestLog)

    // (1) Real plugin load: all nine bounded_lite tools exposed, no fixture echo.
    assert(boundedTools.length >= 9, `expected the real plugin's >= 9 bounded_lite tools, got [${boundedTools.join(", ")}]`, problems)
    for (const required of ["bounded_lite_plan_dag", "bounded_lite_plan_readiness", "bounded_lite_plan_artifact", "bounded_lite_model_config"]) {
      assert(boundedTools.includes(required), `real plugin tool ${required} missing from provider payload`, problems)
    }
    assert(!providerToolNames.includes("echo"), "fixture echo tool leaked into the v1 stage (real plugin not loaded?)", problems)

    // (2) Valid structured plan_dag call round-trips with DAG waves.
    const dagOk = toolResults.find((r) => r.name === "bounded_lite_plan_dag" && r.content.includes('"waves"'))
    assert(Boolean(dagOk), "valid bounded_lite_plan_dag call produced no DAG waves", problems)
    if (dagOk) {
      let waveHits = false
      try {
        waveHits = JSON.stringify(JSON.parse(dagOk.content).waves[0]).includes("V1A")
      } catch {}
      assert(waveHits, "DAG waves do not contain the scripted subtask V1A", problems)
    }

    // (3) Malformed Markdown-string payload rejected with a format diagnostic.
    const malformed = toolResults.filter((r) => r.name === "bounded_lite_plan_dag" && !r.content.includes('"waves"')).at(-1)
    assert(Boolean(malformed), "Markdown-string payload was not rejected (no failing plan_dag result)", problems)
    if (malformed) {
      const diagnostic = /payload/i.test(malformed.content) && /(structured|object|markdown|expected)/i.test(malformed.content)
      assert(diagnostic, `malformed payload rejection lacks a format diagnostic: ${malformed.content.slice(0, 300)}`, problems)
    }

    // (4) Artifact root confinement: worktree root, never process.cwd().
    const artifactResult = toolResults.find((r) => r.name === "bounded_lite_plan_artifact")
    const artifactOk = Boolean(artifactResult) && artifactResult.content.includes("plan artifact persisted")
    assert(artifactOk, `bounded_lite_plan_artifact did not persist: ${artifactResult?.content?.slice(0, 200) ?? "no result"}`, problems)
    const worktreeArtifact = join(projectDir, ".liteagent", "plans", "v1-compat-confinement-probe.md")
    assert(existsSync(worktreeArtifact), `plan artifact missing under invocation worktree root: ${worktreeArtifact}`, problems)
    assert(!existsSync(join(nestedDir, ".liteagent")), "plan artifact resolved against process.cwd() (nested dir) instead of the worktree", problems)

    // (5) Runtime model discovery through the captured init client.
    const modelResult = toolResults.find((r) => r.name === "bounded_lite_model_config")
    const modelDiscovery = Boolean(modelResult) && modelResult.content.includes("scripted/echo-model")
    assert(modelDiscovery, `runtime model discovery did not surface scripted/echo-model: ${modelResult?.content?.slice(0, 200) ?? "no result"}`, problems)

    // (6) Configured deny stays deny. v1 host policy removes the denied tool from
    // the provider surface entirely and rejects the scripted call ("Model tried
    // to call unavailable tool 'bash'"); it must never execute. Match by the
    // stable scripted call id — the host rewrites the rejected call's name.
    const denyResult = toolResults.find((r) => r.callID === "call_scripted_3")
    assert(Boolean(denyResult), "bash deny probe never produced a host rejection result", problems)
    const denied = !toolResults.some((r) => r.content.includes("DENIED-PROBE-OUTPUT"))
    assert(denied, "configured deny became allow: bash probe executed", problems)

    // (7) Full scripted round trip finished with the final assistant text.
    let roundTrip = false
    try {
      roundTrip = readFileSync(join(paths.logs, `v1-${host.id}-run.out`), "utf8").includes(V1_FINAL_TEXT)
    } catch {}
    assert(roundTrip, `final assistant text (${V1_FINAL_TEXT}) missing from run output`, problems)

    assert(runRes.status === 0, `host run exited ${runRes.status}`, problems)

    results.push({
      host: host.id,
      pkg: host.pkg,
      line: host.line,
      stage: "v1",
      ok: problems.length === 0,
      problems,
      hostBinary: bin,
      hostVersion: version,
      fixtureDir,
      evidenceDir,
      projectDir,
      nestedDir,
      providerToolNames,
      boundedToolCount: boundedTools.length,
      tools: {
        planDagValid: dagOk ? { ok: true, resultExcerpt: dagOk.content.slice(0, 200) } : { ok: false },
        planArtifact: artifactOk
          ? { ok: true, artifactPath: worktreeArtifact }
          : { ok: false, resultExcerpt: artifactResult?.content?.slice(0, 300) ?? null },
        modelDiscovery: modelResult
          ? { ok: modelDiscovery, resultExcerpt: modelResult.content.slice(0, 400) }
          : { ok: false, resultExcerpt: null },
        denyProbe: denyResult
          ? { denied, resultExcerpt: denyResult.content.slice(0, 300) }
          : { missing: true },
        planDagMalformed: malformed
          ? { rejected: true, diagnosticExcerpt: malformed.content.slice(0, 400) }
          : { rejected: false },
      },
      finalTextSeen: roundTrip,
    })
  }

  return results
}

async function main() {
  const stageIndex = process.argv.indexOf("--stage")
  const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : "loader"
  if (!["loader", "v1", "all"].includes(stage)) {
    process.stderr.write(`Unknown stage: ${stage}. Supported: loader, v1, all\n`)
    process.exit(2)
  }

  const runLoader = stage === "loader" || stage === "all"
  const runV1 = stage === "v1" || stage === "all"

  let loaderResults = []
  let v1Results = []
  if (runLoader) loaderResults = await runLoaderStage()
  if (runV1) v1Results = await runV1Stage()

  // v1-only runs keep the loader-stage host results from the previous report so
  // the merged report still counts all three loader hosts alongside the v1 gate.
  let carriedLoader = false
  if (!runLoader && runV1) {
    try {
      const previous = JSON.parse(readFileSync(paths.report, "utf8"))
      if (Array.isArray(previous.hosts) && previous.hosts.length > 0) {
        loaderResults = previous.hosts
        carriedLoader = true
      }
    } catch {}
  }

  const allOk =
    (runLoader ? loaderResults.every((r) => r.ok) : true) &&
    (runV1 ? v1Results.every((r) => r.ok) : true)

  const summary = {
    stage,
    ranAt: new Date().toISOString(),
    node: process.version,
    allOk,
    hosts: loaderResults,
    ...(runV1 && !runLoader ? { hostsSource: carriedLoader ? "carried-from-previous-report" : "none" } : {}),
    ...(runV1 ? { v1: v1Results, counts: {
      loader: { ran: runLoader, carried: carriedLoader, total: loaderResults.length, passed: loaderResults.filter((r) => r.ok).length },
      v1: { ran: runV1, total: v1Results.length, passed: v1Results.filter((r) => r.ok).length },
    } } : {}),
  }
  writeFileSync(paths.report, `${JSON.stringify(summary, null, 2)}\n`)

  if (runLoader) {
    for (const r of loaderResults) {
      log(`${r.ok ? "PASS" : "FAIL"} ${r.host} (${r.hostVersion ?? "?"}) ${r.ok ? "" : "problems: " + r.problems.join("; ")}`)
    }
  }
  if (runV1) {
    for (const r of v1Results) {
      log(`v1 ${r.ok ? "PASS" : "FAIL"} ${r.host} (${r.hostVersion ?? "?"}) ${r.ok ? "" : "problems: " + r.problems.join("; ")}`)
    }
  }
  log(`report: ${paths.report}`)
  process.exit(summary.allOk ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`[opencode-compat] fatal: ${error?.stack ?? error}\n`)
  process.exit(1)
})
