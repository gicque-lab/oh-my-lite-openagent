#!/usr/bin/env node
// C01 compatibility smoke runner — bounded, credential-free, fully isolated.
//
// Proves the dual OpenCode v1/v2 loader and dependency contracts on pinned host
// binaries with every piece of state (config, HOME/XDG, TMPDIR, npm cache, deps,
// logs) inside .liteagent/scratch/opencode-compat/. Hosts are never put on PATH.
//
// Usage:
//   node scripts/test-opencode-compat.mjs --stage loader
//
// Stages:
//   loader   Stage pinned hosts + fixture, run each host against the dual
//            directory entrypoint, capture host-exported tool schemas and a
//            structured echo tool round trip through a deterministic scripted
//            OpenAI-compatible provider (no credentials, no real LLM).
//
// Host acquisition: official npm distribution packages with exact pins
//   v1.18.29  opencode-ai@1.18.29     (platform pkg opencode-linux-x64)
//   v1.19.1   opencode-ai@1.19.1      (platform pkg opencode-linux-x64)
//   v2.0.30   @opencode/cli@2.0.30    (platform pkg @opencode/cli-linux-x64)
// npm lifecycle scripts are blocked by default in npm >= 12; the host packages'
// postinstall.mjs is executed manually with the isolated environment instead.
import { spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
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
  project: join(SCROOT, "project"),
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
  for (const dir of [paths.hosts, paths.fixtureStage, paths.project, paths.config, paths.data, paths.cache, paths.home, paths.tmp, paths.logs, paths.evidence, paths.npmCache]) {
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

// Deterministic scripted provider: prints {"port": N} on stdout.
function startProvider(port, captureOut) {
  const child = spawn(process.execPath, [paths.provider, String(port), captureOut], {
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

function runHost(host, bin, projectDir, evidenceDir, timeoutMs) {
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
  const args = ["run", "--standalone", "-m", "scripted/echo-model", "Call the echo tool once with any message.", "--format", "json"]
  if (host.line === "v1") {
    // v1 has no --standalone (it is already a private server per invocation).
    args.splice(1, 1)
  }
  const res = spawnSync(bin, args, { cwd: projectDir, env, encoding: "utf8", timeout: timeoutMs })
  writeFileSync(join(paths.logs, `${host.id}-run.out`), res.stdout ?? "")
  writeFileSync(join(paths.logs, `${host.id}-run.err`), res.stderr ?? "")
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

async function main() {
  const stageIndex = process.argv.indexOf("--stage")
  const stage = stageIndex >= 0 ? process.argv[stageIndex + 1] : "loader"
  if (!["loader", "all"].includes(stage)) {
    process.stderr.write(`Unknown stage: ${stage}. Supported: loader\n`)
    process.exit(2)
  }
  const results = await runLoaderStage()

  const summary = {
    stage,
    ranAt: new Date().toISOString(),
    node: process.version,
    allOk: results.every((r) => r.ok),
    hosts: results,
  }
  writeFileSync(paths.report, `${JSON.stringify(summary, null, 2)}\n`)

  for (const r of results) {
    log(`${r.ok ? "PASS" : "FAIL"} ${r.host} (${r.hostVersion ?? "?"}) ${r.ok ? "" : "problems: " + r.problems.join("; ")}`)
  }
  log(`report: ${paths.report}`)
  process.exit(summary.allOk ? 0 : 1)
}

main().catch((error) => {
  process.stderr.write(`[opencode-compat] fatal: ${error?.stack ?? error}\n`)
  process.exit(1)
})
