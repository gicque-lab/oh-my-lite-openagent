#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConfigDir } from "./install-paths.mjs";
import {
  RUNTIME_DIR_NAME,
  runtimeBackupDir,
  runtimeNamespaceDir,
  runtimeNpmCacheDir,
  runtimeStagingDir,
} from "./install-paths.mjs";
import { MANAGED_CONFIG, MANAGED_HOST_SESSION_DEPTH } from "./managed-config.mjs";

const PLUGIN_FILE = "bounded-lite.ts";
const MANAGED_DIRS = ["agents", "plugins", "lib"];
const RUNTIME_SHIM_FILE = "server.ts";
// Tarball source names: npm pack always drops nested package.json(/-lock.json),
// so the runtime manifest/lock ship under opaque names and are staged as the
// canonical package.json / package-lock.json inside the managed namespace.
const RUNTIME_MANIFEST_SOURCE = "runtime-package.json";
const RUNTIME_LOCK_SOURCE = "runtime-package-lock.json";
const MANAGED_RUNTIME_SOURCES = [RUNTIME_SHIM_FILE, RUNTIME_MANIFEST_SOURCE, RUNTIME_LOCK_SOURCE];
const RUNTIME_STAGED_FILES = [RUNTIME_SHIM_FILE, "package.json", "package-lock.json"];
const LITE_CONFIG_FILE = "oh-my-lite-openagent.json";
/**
 * Legacy managed specs (keep in sync with .opencode/lib/compat/config.ts,
 * MANAGED_PLUGIN_SPECS): exact managed specs only — strings that merely contain
 * "bounded-lite.ts" belong to users and must never be classified or rewritten
 * as managed. The current managed source is the dedicated runtime directory
 * (C06 decision 9); install.mjs recognizes exactly these two generations:
 * legacy .ts specs (below) and the resolved runtime namespace directory.
 */
const MANAGED_PLUGIN_SPECS = [
  "./.opencode/plugins/bounded-lite.ts",
];
/** Managed runtime dir names/entries the installer owns; anything else found
 * inside the runtime namespace is user data and stops the install (C06). */
const MANAGED_RUNTIME_NAMES = new Set([...MANAGED_DIRS, ...RUNTIME_STAGED_FILES, "node_modules"]);
/** Suffix for the disabled (renamed) superseded copied mounted entrypoint. */
const RUNTIME_ENTRY_DISABLED_SUFFIX = ".omlo-disabled";
const NATIVE_PERMISSION_ACTION_NAMES = {
  bash: "shell",
  task: "subagent",
};
const MANAGED_COMMAND_NAMES = new Set([
  "agent-models",
  "go",
  "study",
  "update-lite",
  "Character-model",
]);
const MANAGED_MCP_NAMES = new Set([
  "context7",
  "playwright",
]);
const BUILTIN_AGENT_OVERRIDES = new Set([
  "build",
  "plan",
]);
const OUR_ROLE_NAMES = new Set([
  "command-lead",
  "plan-builder",
  "deep-plan-builder",
  "task-lead",
  "explore",
  "librarian",
  "plan-review",
  "result-review",
]);
const MANAGED_AGENT_NAMES = new Set([...BUILTIN_AGENT_OVERRIDES, ...OUR_ROLE_NAMES]);
const SPECIALIST_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const RESERVED_SPECIALIST_NAMES = new Set([...MANAGED_AGENT_NAMES]);

// ---------------------------------------------------------------------------
// Role model recommendation data (mirror of role-model-recommendations.ts)
// ---------------------------------------------------------------------------

export const ROLE_MODEL_PROFILES = [
  {
    role: "command-lead",
    capability: "orchestration",
    description: "Main orchestrator — needs strongest reasoning",
    recommendations: [
      "claude-opus",
      "gpt-5.4",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "kimi-k2",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
      "gpt-5-nano",
    ],
  },
  {
    role: "plan-builder",
    capability: "planning",
    description: "Visible planner — needs strong reasoning",
    recommendations: [
      "claude-opus",
      "gpt-5.4",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "kimi-k2",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
  {
    role: "deep-plan-builder",
    capability: "advisory-planning",
    description: "Deep planner — produces detailed plans for lower-strength executors",
    recommendations: [
      "claude-sonnet",
      "kimi-k2",
      "gemini-3-flash",
      "gpt-5.4",
      "claude-opus",
      "gpt-4o",
      "gpt-5.3-codex",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
  {
    role: "task-lead",
    capability: "execution",
    description: "Bounded task executor — mid-tier models sufficient",
    recommendations: [
      "claude-sonnet",
      "kimi-k2",
      "gpt-5.4",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "gpt-4o",
      "gpt-5.3-codex",
      "minimax-m2",
      "gpt-5-nano",
      "big-pickle",
    ],
  },
  {
    role: "explore",
    capability: "fast-retrieval",
    description: "Read-only code exploration — fast, cheap models preferred",
    recommendations: [
      "gpt-5.4-mini",
      "claude-haiku",
      "minimax-m2.7-highspeed",
      "minimax-m2",
      "gemini-2.0-flash",
      "gemini-3-flash",
      "gpt-5-nano",
      "big-pickle",
    ],
  },
  {
    role: "librarian",
    capability: "fast-retrieval",
    description: "External research — fast, cheap models preferred",
    recommendations: [
      "gpt-5.4-mini",
      "claude-haiku",
      "minimax-m2.7-highspeed",
      "minimax-m2",
      "gemini-2.0-flash",
      "gemini-3-flash",
      "gpt-5-nano",
      "big-pickle",
    ],
  },
  {
    role: "plan-review",
    capability: "critical-review",
    description: "Plan review — needs strongest reasoning to catch errors",
    recommendations: [
      "gpt-5.4",
      "claude-opus",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
  {
    role: "result-review",
    capability: "critical-review",
    description: "Result review — needs strongest reasoning to verify completeness",
    recommendations: [
      "gpt-5.4",
      "claude-opus",
      "gemini-2.5-pro",
      "gemini-3.1-pro",
      "claude-sonnet",
      "gpt-4o",
      "glm-5",
      "minimax-m2",
      "big-pickle",
    ],
  },
];

// ---------------------------------------------------------------------------
// Provider question definitions
// ---------------------------------------------------------------------------

const PROVIDER_QUESTIONS = [
  {
    key: "hasClaude",
    label: "Anthropic (Claude)",
    hint: "Claude Opus/Sonnet/Haiku for orchestration, planning, and review",
  },
  {
    key: "hasOpenAI",
    label: "OpenAI (ChatGPT)",
    hint: "GPT-5.4/o3 for strong reasoning and review",
  },
  {
    key: "hasGemini",
    label: "Google (Gemini)",
    hint: "Gemini Pro for planning and multimodal tasks",
  },
  {
    key: "hasCopilot",
    label: "GitHub Copilot",
    hint: "Copilot models as fallback option",
  },
  {
    key: "hasOpenCodeZen",
    label: "OpenCode Zen (opencode/ models)",
    hint: "opencode/ hosted models including Claude, GPT, etc.",
  },
  {
    key: "hasOpenCodeGo",
    label: "OpenCode Go (opencode-go/ models)",
    hint: "opencode-go/ models like Kimi K2 and MiniMax",
  },
  {
    key: "hasKimiCoding",
    label: "Kimi For Coding (kimi-for-coding)",
    hint: "Kimi K2.5 for task execution",
  },
  {
    key: "hasVercelGateway",
    label: "Vercel AI Gateway",
    hint: "Universal proxy for OpenAI, Anthropic, Google, etc.",
  },
];

// ---------------------------------------------------------------------------
// Model mapping: provider availability → primary model per role
// ---------------------------------------------------------------------------

function matchesPattern(modelId, pattern) {
  return modelId.toLowerCase().includes(pattern.toLowerCase());
}

function classifyModelProvider(provider) {
  const normalized = provider.toLowerCase();

  if (["opencode", "opencode-go"].includes(normalized)) {
    return "opencode-subscription";
  }

  if (["openai", "anthropic", "google", "github-copilot", "kimi-for-coding"].includes(normalized)) {
    return "api-provider";
  }

  if (normalized === "vercel") {
    return "gateway";
  }

  return "unknown";
}

function resolveModelsForProviders(availableModels) {
  const assignments = {};
  const resolved = [];
  const unresolved = [];

  for (const profile of ROLE_MODEL_PROFILES) {
    let bestModel = undefined;
    let bestModelSource = undefined;
    let matchedPattern = undefined;

    for (const pattern of profile.recommendations) {
      const matched = availableModels.find((model) => matchesPattern(model.id, pattern));
      if (matched) {
        bestModel = matched.id;
        bestModelSource = matched.source;
        matchedPattern = pattern;
        break;
      }
    }

    if (bestModel) {
      assignments[profile.role] = bestModel;
      resolved.push({ role: profile.role, model: bestModel, source: bestModelSource, matchedPattern });
    } else {
      unresolved.push({ role: profile.role, capability: profile.capability });
    }
  }

  return { assignments, resolved, unresolved };
}

function collectModelsFromProviders(providerAnswers) {
  const models = [];

  if (providerAnswers.hasClaude) {
    models.push(
      { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
      { provider: "anthropic", model: "claude-sonnet-4-6", id: "anthropic/claude-sonnet-4-6" },
      { provider: "anthropic", model: "claude-haiku-4-5", id: "anthropic/claude-haiku-4-5" },
    );
  }

  if (providerAnswers.hasOpenAI) {
    models.push(
      { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      { provider: "openai", model: "gpt-5.4-mini", id: "openai/gpt-5.4-mini" },
      { provider: "openai", model: "gpt-5.3-codex", id: "openai/gpt-5.3-codex" },
      { provider: "openai", model: "gpt-4o", id: "openai/gpt-4o" },
      { provider: "openai", model: "gpt-5-nano", id: "openai/gpt-5-nano" },
    );
  }

  if (providerAnswers.hasGemini) {
    models.push(
      { provider: "google", model: "gemini-2.5-pro", id: "google/gemini-2.5-pro" },
      { provider: "google", model: "gemini-3.1-pro", id: "google/gemini-3.1-pro" },
      { provider: "google", model: "gemini-2.0-flash", id: "google/gemini-2.0-flash" },
      { provider: "google", model: "gemini-3-flash", id: "google/gemini-3-flash" },
    );
  }

  if (providerAnswers.hasCopilot) {
    models.push(
      { provider: "github-copilot", model: "gpt-5.4", id: "github-copilot/gpt-5.4" },
      { provider: "github-copilot", model: "claude-sonnet-4-6", id: "github-copilot/claude-sonnet-4-6" },
    );
  }

  if (providerAnswers.hasOpenCodeZen) {
    models.push(
      { provider: "opencode", model: "claude-opus-4-7", id: "opencode/claude-opus-4-7" },
      { provider: "opencode", model: "claude-sonnet-4-6", id: "opencode/claude-sonnet-4-6" },
      { provider: "opencode", model: "gpt-5.4", id: "opencode/gpt-5.4" },
      { provider: "opencode", model: "big-pickle", id: "opencode/big-pickle" },
      { provider: "opencode", model: "kimi-k2.5", id: "opencode/kimi-k2.5" },
    );
  }

  if (providerAnswers.hasOpenCodeGo) {
    models.push(
      { provider: "opencode-go", model: "kimi-k2.5", id: "opencode-go/kimi-k2.5" },
      { provider: "opencode-go", model: "minimax-m2.7", id: "opencode-go/minimax-m2.7" },
      { provider: "opencode-go", model: "minimax-m2.7-highspeed", id: "opencode-go/minimax-m2.7-highspeed" },
      { provider: "opencode-go", model: "glm-5", id: "opencode-go/glm-5" },
    );
  }

  if (providerAnswers.hasKimiCoding) {
    models.push(
      { provider: "kimi-for-coding", model: "k2p5", id: "kimi-for-coding/k2p5" },
    );
  }

  if (providerAnswers.hasVercelGateway) {
    models.push(
      { provider: "vercel", model: "claude-opus-4-7", id: "vercel/anthropic/claude-opus-4-7" },
      { provider: "vercel", model: "gpt-5.4", id: "vercel/openai/gpt-5.4" },
      { provider: "vercel", model: "gemini-2.5-pro", id: "vercel/google/gemini-2.5-pro" },
    );
  }

  return models.map((model) => ({
    ...model,
    source: classifyModelProvider(model.provider),
  }));
}

// ---------------------------------------------------------------------------
// Interactive prompt helpers
// ---------------------------------------------------------------------------

async function promptYesNo(question, defaultValue = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const defaultHint = defaultValue ? "Y/n" : "y/N";

  return new Promise((resolve) => {
    rl.question(`${question} (${defaultHint}): `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") {
        resolve(defaultValue);
      } else if (trimmed === "y" || trimmed === "yes" || trimmed === "是") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

async function promptProviders() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Non-interactive mode detected. Skipping model provider setup.");
    console.log("Use '/agent-models' with action=auto after installation to configure models.");
    return null;
  }

  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║          Oh My Lite OpenAgent — Model Provider Setup          ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log("║                                                              ║");
  console.log("║  Which AI model providers do you have access to?             ║");
  console.log("║  This will be used to pick the best model for each role.     ║");
  console.log("║                                                              ║");
  console.log("║  You can always change models later using                    ║");
  console.log("║  the /agent-models command in OpenCode.                      ║");
  console.log("║                                                              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");

  const answers = {};

  for (const question of PROVIDER_QUESTIONS) {
    const result = await promptYesNo(
      `  Do you have access to ${question.label}? — ${question.hint}`,
    );
    answers[question.key] = result;
  }

  console.log("");
  return answers;
}

function formatModelAssignments(result) {
  const lines = [];

  lines.push("");
  lines.push("  Recommended model assignments:");
  lines.push("");

  for (const item of result.resolved) {
    const profile = ROLE_MODEL_PROFILES.find((p) => p.role === item.role);
    const tag = profile ? `[${profile.capability}]` : "";
    const source = item.source ? `[${item.source}]` : "";
    lines.push(`    ✓ ${item.role.padEnd(20)} → ${item.model.padEnd(35)} ${tag} ${source}`);
  }

  if (result.unresolved.length > 0) {
    lines.push("");
    lines.push("  Unresolved roles (no matching model found):");
    for (const item of result.unresolved) {
      lines.push(`    ✗ ${item.role.padEnd(20)} needs ${item.capability}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let cliConfigDir = undefined;
  const args = {
    configDir: undefined,
    dryRun: false,
    interactive: false,
    rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--interactive") {
      args.interactive = true;
      continue;
    }

    if (arg === "--no-managed-mcp") {
      args.managedMcp = false;
      continue;
    }

    if (arg === "--config-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--config-dir requires a path");
      cliConfigDir = value;
      index += 1;
      continue;
    }

    if (arg === "--root-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root-dir requires a path");
      args.rootDir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  args.configDir = process.env.OPENCODE_CONFIG_DIR ?? cliConfigDir;
  return args;
}

export { defaultConfigDir };

async function readJsonIfExists(filePath) {
  try {
    return parseJsonConfig(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Failed to read JSON/JSONC ${filePath}: ${error.message}`);
  }
}

function stripJsonComments(content) {
  // keep in sync with .opencode/lib/runtime/jsonc.ts
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        output += content[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(content) {
  // keep in sync with .opencode/lib/runtime/jsonc.ts
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(content[lookahead] ?? "")) lookahead += 1;
      if (content[lookahead] === "}" || content[lookahead] === "]") continue;
    }

    output += char;
  }

  return output;
}

function parseJsonConfig(content) {
  // keep in sync with .opencode/lib/runtime/jsonc.ts
  return JSON.parse(stripTrailingCommas(stripJsonComments(content.replace(/^\uFEFF/, ""))));
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveTargetConfigPath(configDir) {
  const jsonPath = path.join(configDir, "opencode.json");
  const jsoncPath = path.join(configDir, "opencode.jsonc");

  if (await fileExists(jsonPath)) return jsonPath;
  if (await fileExists(jsoncPath)) return jsoncPath;
  return jsonPath;
}

async function copyDir(sourceDir, targetDir, dryRun) {
  if (dryRun) return;

  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(sourceDir)) {
    if (entry === "node_modules") continue;
    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    const info = await stat(sourcePath);

    if (info.isDirectory()) {
      await copyDir(sourcePath, targetPath, dryRun);
      continue;
    }

    if (info.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

// ---------------------------------------------------------------------------
// npm CLI launch (decision 10, plan-review PR-01): the npm JavaScript CLI is
// always launched through process.execPath with an argument array and
// shell:false. npm.cmd is never passed to a shell-free execFile (Windows
// cannot exec .cmd that way), npm.Commands are never concatenated, and a
// missing CLI is a clear failure. The installer never edits user package
// manifests/locks.
// ---------------------------------------------------------------------------

/**
 * Resolve a real npm JavaScript CLI (bin/npm-cli.js). Accepts npm_execpath only
 * when it identifies a valid npm.js CLI; otherwise falls back to the node
 * install prefix. Returns null when nothing valid is found — callers must fail
 * clearly instead of shelling out to "npm" / npm.cmd.
 */
export async function resolveNpmCli(execPath, env, fileExists) {
  const fromEnv = env.npm_execpath;
  if (typeof fromEnv === "string" && fromEnv.endsWith("npm-cli.js") && (await fileExists(fromEnv))) {
    return { file: fromEnv, source: "npm_execpath" };
  }
  // Works for the standard node layout on both POSIX and win32; on win32 the
  // prefix still ships bin/npm-cli.js next to node.exe's .. directory.
  const fromPrefix = path.join(path.dirname(execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (await fileExists(fromPrefix)) {
    return { file: fromPrefix, source: "node-prefix" };
  }
  return null;
}

/**
 * ExecFile plan for the locked private dependency install. Launched as:
 * execFile(process.execPath, [npmCli.js, "ci", ...], { shell: false, cwd }).
 * Locked install only: npm ci --ignore-scripts in the staged private runtime
 * namespace; no arbitrary latest-package fallback, no user manifest edits.
 */
export function buildNpmCiPlan(execPath, npmCliFile, cwd, envExtras = {}) {
  return {
    file: execPath,
    args: [npmCliFile, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    cwd,
    shell: false,
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_loglevel: "notice",
      ...envExtras,
    },
  };
}

/**
 * Verify copied-stage dependency resolution offline: every runtime dependency
 * from the copied manifest must resolve to its package.json inside the staged
 * node_modules. Proves the npm ci stage actually produced the locked tree
 * before the config source is switched.
 */
async function verifyStagedDependencies(stagingDir, dependencies) {
  const missing = [];
  for (const name of Object.keys(dependencies ?? {})) {
    const manifestPath = path.join(stagingDir, "node_modules", ...name.split("/"), "package.json");
    if (!(await fileExists(manifestPath))) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Staged runtime dependency resolution failed: missing ${missing.map((name) => `${name}(package.json)`).join(", ")} under ${path.join(stagingDir, "node_modules")}. npm ci may have failed silently; do not retry with arbitrary versions.`,
    );
  }
}

/**
 * Real launcher: shell-free execFile of process.execPath against the npm
 * JavaScript CLI. Injectable for offline unit tests (tests never run npm).
 * Captures stdout/stderr and surfaces exact failures as install blockers.
 */
export async function defaultDependencyRunner(plan) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(plan.file, plan.args, { cwd: plan.cwd, env: plan.env, shell: false, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        error.npmStderr = typeof stderr === "string" ? stderr.slice(-4000) : "";
        error.npmStdout = typeof stdout === "string" ? stdout.slice(-2000) : "";
        rejectPromise(error);
        return;
      }
      resolvePromise({ status: 0, stdout, stderr });
    });
  });
}

async function runDependencyStage(context) {
  if (context.dryRun) return null;

  const npmCli = await resolveNpmCli(process.execPath, process.env, async (filePath) => {
    try {
      return (await stat(filePath)).isFile();
    } catch {
      return false;
    }
  });
  if (!npmCli) {
    throw new Error(
      "Could not resolve a valid npm JavaScript CLI (bin/npm-cli.js). The launcher uses process.execPath with shell:false and never npm.cmd — set npm_execpath to the real npm.js CLI or install Node with bundled npm, then retry.",
    );
  }

  const plan = buildNpmCiPlan(process.execPath, npmCli.file, context.runtimeStagingDir, {
    npm_config_cache: context.runtimeNpmCacheDir,
    OPENCODE_PLUGIN_STAGE: "oh-my-lite-openagent",
  });
  context.report.dependencyCommand = `execFile ${plan.file} ${JSON.stringify(plan.args)} (shell:false, cwd:${plan.cwd})`;

  const runner = context.dependencyRunner ?? defaultDependencyRunner;
  let result;
  try {
    result = await runner(plan);
  } catch (error) {
    throw new Error(
      `Locked dependency install failed (npm ci --ignore-scripts) in ${context.runtimeStagingDir}: ${error.message}\nstderr: ${error.npmStderr ?? ""}\nPrevious runtime/config kept intact; no arbitrary version fallback will be attempted. Fix the environment and retry explicitly.`,
    );
  }
  if (!result || result.status !== 0) {
    throw new Error(
      `Locked dependency install failed (npm ci --ignore-scripts) in ${context.runtimeStagingDir}: exit status ${result?.status ?? "none"}\nstderr: ${result?.stderr ?? ""}\nPrevious runtime/config kept intact; no arbitrary version fallback will be attempted. Fix the environment and retry explicitly.`,
    );
  }

  const manifest = await readFile(path.join(context.runtimeStagingDir, "package.json"), "utf8");
  await verifyStagedDependencies(context.runtimeStagingDir, JSON.parse(manifest).dependencies);
  context.report.npmCliSource = npmCli.source;
  return result;
}

// ---------------------------------------------------------------------------
// Config dialect helpers
// keep in sync with .opencode/lib/compat/config.ts — the installer runs under
// plain Node and cannot import the TypeScript boundary, so the small
// read/update helpers are mirrored here and locked by parity tests.
// ---------------------------------------------------------------------------

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function detectConfigDialect(config) {
  const legacyOnlyKeys = new Set(["plugin", "agent", "command", "permission", "provider"]);
  const nativeOnlyKeys = new Set(["plugins", "agents", "commands", "permissions", "providers"]);
  const legacyKeys = [];
  const nativeKeys = [];

  for (const key of Object.keys(config)) {
    if (config[key] === undefined) continue;
    if (legacyOnlyKeys.has(key)) legacyKeys.push(key);
    else if (nativeOnlyKeys.has(key)) nativeKeys.push(key);
  }

  const dialect = legacyKeys.length > 0 && nativeKeys.length > 0
    ? "mixed"
    : nativeKeys.length > 0
      ? "native"
      : "legacy";
  return { dialect, legacyKeys, nativeKeys };
}

export function parseModelReference(value) {
  if (typeof value !== "string") return undefined;
  const reference = value.trim();
  if (!reference) return undefined;

  const hash = reference.indexOf("#");
  const base = hash >= 0 ? reference.slice(0, hash) : reference;
  const rawVariant = hash >= 0 ? reference.slice(hash + 1) : undefined;
  const slash = base.indexOf("/");
  if (slash <= 0) return undefined;

  const provider = base.slice(0, slash);
  const model = base.slice(slash + 1);
  if (!provider || !model) return undefined;
  const variant = rawVariant === undefined ? undefined : rawVariant.trim();
  if (rawVariant !== undefined && !variant) return undefined;

  const baseId = `${provider}/${model}`;
  return {
    provider,
    model,
    ...(variant ? { variant } : {}),
    baseId,
    reference: variant ? `${baseId}#${variant}` : baseId,
  };
}

function classifyPluginEntryValue(container, index, value) {
  if (typeof value === "string") {
    const removal = value.startsWith("-");
    return { container, index, packageSpec: removal ? value.slice(1) : value, removal };
  }

  if (container === "native" && isRecord(value)) {
    const packageSpec = value["package"];
    if (typeof packageSpec !== "string" || !packageSpec) return undefined;
    const options = isRecord(value["options"]) ? value["options"] : undefined;
    return { container, index, packageSpec, ...(options ? { options } : {}), removal: false };
  }

  if (container === "legacy" && Array.isArray(value)) {
    const packageSpec = value[0];
    if (typeof packageSpec !== "string" || !packageSpec) return undefined;
    const options = isRecord(value[1]) ? value[1] : undefined;
    return { container, index, packageSpec, ...(options ? { options } : {}), removal: false };
  }

  return undefined;
}

export function readPluginEntries(config) {
  const entries = [];

  const legacyValue = config["plugin"];
  if (typeof legacyValue === "string") {
    const entry = classifyPluginEntryValue("legacy", 0, legacyValue);
    if (entry) entries.push(entry);
  } else if (Array.isArray(legacyValue)) {
    legacyValue.forEach((item, index) => {
      const entry = classifyPluginEntryValue("legacy", index, item);
      if (entry) entries.push(entry);
    });
  }

  const nativeValue = config["plugins"];
  if (Array.isArray(nativeValue)) {
    nativeValue.forEach((item, index) => {
      const entry = classifyPluginEntryValue("native", index, item);
      if (entry) entries.push(entry);
    });
  }

  return entries;
}

export function isManagedPluginEntry(entry) {
  return MANAGED_PLUGIN_SPECS.includes(entry.packageSpec);
}

/**
 * Exact managed-spec classification across both generations: the legacy .ts
 * specs and (configDir-aware) the resolved managed runtime namespace
 * directory. Relative specs are resolved against the config dir; absolute
 * entries must resolve to the exact namespace. User specs that merely contain
 * "bounded-lite.ts" never match.
 */
function normalizeManagedSpecCandidate(spec, configDir) {
  if (MANAGED_PLUGIN_SPECS.includes(spec)) return spec;
  const resolved = path.resolve(configDir, spec);
  return resolved === contextRuntimeDir(configDir) ? spec : undefined;
}

function contextRuntimeDir(configDir) {
  return path.join(configDir, ".opencode", RUNTIME_DIR_NAME);
}

export function isManagedSpec(entry, configDir) {
  return normalizeManagedSpecCandidate(entry.packageSpec, configDir) !== undefined;
}

export function managedPluginOptions(config, configDir) {
  const managed = readPluginEntries(config)
    .filter((entry) => !entry.removal && entry.options)
    .filter(configDir === undefined ? isManagedPluginEntry : (entry) => isManagedSpec(entry, configDir));

  const legacy = managed.filter((entry) => entry.container === "legacy");
  const native = managed.filter((entry) => entry.container === "native");
  const lastOptions = (list) => (list.length > 0 ? list[list.length - 1].options : undefined);

  return lastOptions(native) ?? lastOptions(legacy) ?? {};
}

export function removeManagedPluginEntries(config, container, configDir) {
  const matchesManaged = configDir === undefined ? isManagedPluginEntry : (entry) => isManagedSpec(entry, configDir);
  for (const key of ["plugin", "plugins"]) {
    if (container === "legacy" && key !== "plugin") continue;
    if (container === "native" && key !== "plugins") continue;
    const value = config[key];
    if (!Array.isArray(value)) continue;
    config[key] = value.filter((item) => {
      const entry = classifyPluginEntryValue(key === "plugin" ? "legacy" : "native", 0, item);
      return !(entry && matchesManaged(entry) && !entry.removal);
    });
  }
}

export function upsertManagedPluginEntry(config, spec, options, configDir) {
  const info = detectConfigDialect(config);
  const targetNative = Array.isArray(config["plugins"]) || info.dialect === "native" || info.dialect === "mixed";

  if (targetNative) {
    // Managed value lives only in the effective native location; drop legacy
    // shadows but keep native array positions intact.
    removeManagedPluginEntries(config, "legacy", configDir);
    const plugins = Array.isArray(config["plugins"]) ? [...config["plugins"]] : [];
    const index = plugins.findIndex((item) => {
      const entry = classifyPluginEntryValue("native", 0, item);
      return Boolean(entry && !entry.removal && entry.packageSpec === spec);
    });

    if (index >= 0) {
      const existing = plugins[index];
      const extraEntryKeys = isRecord(existing)
        ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== "package" && key !== "options"))
        : {};
      plugins[index] = { ...extraEntryKeys, package: spec, options };
    } else {
      plugins.push({ package: spec, options });
    }
    config["plugins"] = plugins;
    return;
  }

  const pluginValue = config["plugin"];
  const plugins = Array.isArray(pluginValue)
    ? [...pluginValue]
    : typeof pluginValue === "string"
      ? [pluginValue]
      : [];
  const matchesManaged = configDir === undefined ? isManagedPluginEntry : (entry) => isManagedSpec(entry, configDir);
  const index = plugins.findIndex((item) => {
    const entry = classifyPluginEntryValue("legacy", 0, item);
    return Boolean(entry && !entry.removal && matchesManaged(entry));
  });

  if (index >= 0) {
    plugins[index] = [spec, options];
  } else {
    plugins.push([spec, options]);
  }
  config["plugin"] = plugins;
}

export function nativeAgentEntries(config) {
  return isRecord(config["agents"]) ? config["agents"] : undefined;
}

export function legacyAgentEntries(config) {
  return isRecord(config["agent"]) ? config["agent"] : undefined;
}

export function mergedAgentEntries(config) {
  return { ...(legacyAgentEntries(config) ?? {}), ...(nativeAgentEntries(config) ?? {}) };
}

export function mergedProviderEntries(config) {
  const legacy = isRecord(config["provider"]) ? config["provider"] : {};
  const native = isRecord(config["providers"]) ? config["providers"] : {};
  return { ...legacy, ...native };
}

export function nativeMcpServers(config) {
  const mcp = isRecord(config["mcp"]) ? config["mcp"] : undefined;
  return mcp && isRecord(mcp["servers"]) ? mcp["servers"] : undefined;
}

export function readNativePermissions(config) {
  const value = config["permissions"];
  if (!Array.isArray(value)) return { rules: [], malformed: [] };

  const rules = [];
  const malformed = [];
  value.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw["action"] !== "string") {
      malformed.push({ index, raw });
      return;
    }
    rules.push({
      index,
      raw,
      action: raw["action"],
      ...(typeof raw["resource"] === "string" ? { resource: raw["resource"] } : {}),
      ...(typeof raw["effect"] === "string" ? { effect: raw["effect"] } : {}),
    });
  });
  return { rules, malformed };
}

export function appendNativePermissionRules(config, rules) {
  if (rules.length === 0) return;
  const existing = Array.isArray(config["permissions"]) ? config["permissions"] : [];
  config["permissions"] = [
    ...existing,
    ...rules.map((rule) => ({
      action: rule.action,
      ...(rule.resource !== undefined ? { resource: rule.resource } : {}),
      effect: rule.effect,
    })),
  ];
}

export function findManagedConfigConflicts(config, managedAgentNames, configDir) {
  const conflicts = [];
  const managedNames = new Set(managedAgentNames);
  const matchesManaged = configDir === undefined ? isManagedPluginEntry : (entry) => isManagedSpec(entry, configDir);

  const agents = nativeAgentEntries(config);
  if (agents) {
    for (const [name, raw] of Object.entries(agents)) {
      if (!managedNames.has(name) || !isRecord(raw)) continue;
      conflicts.push({
        location: `agents.${JSON.stringify(name)}`,
        kind: "native-managed-agent-entry",
        detail: `Native agents entry would shadow the generated agents/${name}.md managed definition (keys: ${Object.keys(raw).join(", ") || "<none>"}).`,
        guidance: 'Remove the entry from the native "agents" map (or adopt your entry as the authoritative definition and take over managing that agent) and run the installer again.',
      });
    }
  }

  for (const entry of readPluginEntries(config)) {
    if (!entry.removal || !matchesManaged(entry)) continue;
    conflicts.push({
      location: entry.container === "native"
        ? `plugins[${JSON.stringify(`-${entry.packageSpec}`)}]`
        : `plugin[${JSON.stringify(`-${entry.packageSpec}`)}]`,
      kind: "managed-plugin-removal",
      detail: "The configuration explicitly disables the managed plugin entry.",
      guidance: "Remove the removal entry (or intentionally stop using the managed plugin) and run the installer again.",
    });
  }

  const permissionsValue = config["permissions"];
  if (permissionsValue !== undefined) {
    if (!Array.isArray(permissionsValue)) {
      conflicts.push({
        location: "permissions",
        kind: "native-permissions-shape",
        detail: 'The native "permissions" key exists but is not the documented ordered rule array; its rule format cannot be classified safely.',
        guidance: 'Convert "permissions" to an array of {action, resource, effect} rules (or remove it and rerun the installer; a backup of the previous file is kept before any write).',
      });
    } else {
      for (const item of readNativePermissions(config).malformed) {
        conflicts.push({
          location: `permissions[${item.index}]`,
          kind: "native-permission-rule",
          detail: "Native permission rule entry cannot be classified as an {action, resource, effect} rule without guessing.",
          guidance: 'Give the entry a string "action" (and string "resource"/"effect" fields) or remove it, then run the installer again.',
        });
      }
    }
  }

  return conflicts;
}

/**
 * Native projection of the managed permission policy: ordered rules with
 * broad-first/specific-last ordering preserved from the managed maps, action
 * names mapped to the documented v2 set (bash→shell, task→subagent).
 */
export function nativeManagedPermissionRules(permissionMap) {
  const rules = [];
  if (!isRecord(permissionMap)) return rules;

  for (const [action, value] of Object.entries(permissionMap)) {
    const nativeAction = NATIVE_PERMISSION_ACTION_NAMES[action] ?? action;
    if (isRecord(value)) {
      for (const [resource, effect] of Object.entries(value)) {
        rules.push({ action: nativeAction, resource, effect });
      }
    } else if (typeof value === "string") {
      rules.push({ action: nativeAction, resource: "*", effect: value });
    }
  }
  return rules;
}

/**
 * C07: host session (subagent-nesting) depth. Both host dialects default to 1
 * when the key is absent, which blocks the deepest managed chain. Resolution:
 * - absent -> write the bounded default MANAGED_HOST_SESSION_DEPTH;
 * - existing >= default (more permissive) -> keep the user value, write nothing;
 * - existing < default (stricter) -> keep the user value and report a blocker
 *   naming the exact failing chain and required change (never silently raised).
 * Reading takes the strictest of both keys, because v1 hosts also accept
 * `experimental.subagent_depth` (normalized to the top-level key) and a user
 * could have either form on either dialect.
 */
export function resolveHostSessionDepth(existingConfig, isNativeTarget) {
  const rawValues = [];
  if (typeof existingConfig?.subagent_depth === "number") rawValues.push(existingConfig.subagent_depth);
  if (isRecord(existingConfig?.experimental) && typeof existingConfig.experimental.subagent_depth === "number") {
    rawValues.push(existingConfig.experimental.subagent_depth);
  }
  const configured = rawValues.length === 0 ? undefined : Math.min(...rawValues);
  const writeKey = isNativeTarget ? "experimental" : "top";

  if (configured === undefined) {
    return { configured: null, effectiveDepth: MANAGED_HOST_SESSION_DEPTH, writeKey, needsWrite: true, blocker: null };
  }
  if (configured >= MANAGED_HOST_SESSION_DEPTH) {
    return { configured, effectiveDepth: configured, writeKey, needsWrite: false, blocker: null };
  }
  const keyName = isNativeTarget ? "experimental.subagent_depth" : "subagent_depth";
  return {
    configured,
    effectiveDepth: configured,
    writeKey,
    needsWrite: false,
    blocker: {
      kind: "host-session-depth-stricter",
      key: keyName,
      configured,
      required: MANAGED_HOST_SESSION_DEPTH,
      detail:
        `Existing ${keyName} is ${configured} (stricter than the bounded default ${MANAGED_HOST_SESSION_DEPTH}) and was kept unchanged. ` +
        `The deepest managed chain fails: command-lead -> deep-plan-builder -> plan-review -> explore is rejected at host session depth ${configured}. ` +
        `To run the full role chain, set ${keyName} to ${MANAGED_HOST_SESSION_DEPTH} or higher (plugin child-orchestrator depth stays 1 regardless).`,
    },
  };
}

function applyHostSessionDepthWrite(depthInfo) {
  if (!depthInfo.needsWrite) return {};
  return {
    subagent_depth: depthInfo.writeKey === "top" ? MANAGED_HOST_SESSION_DEPTH : undefined,
    experimental: depthInfo.writeKey === "top" ? undefined : { subagent_depth: MANAGED_HOST_SESSION_DEPTH },
  };
}


function relativePluginOptions(configDir, taskLeadProfiles) {
  return {
    mode: "full",
    configDir,
    ...(isRecord(taskLeadProfiles) ? { taskLeadProfiles } : {}),
  };
}

function createDefaultLiteConfig() {
  return {
    schemaVersion: 1,
    roleModels: {},
    roleReasoningEffort: {},
    taskLeadProfiles: {},
    specialists: {},
    modelPoolPolicy: {
      source: "all",
      allowCodexBackend: false,
    },
  };
}

function normalizeReasoningEffort(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "none") return "minimal";
  if (["minimal", "low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  if (normalized === "med") return "medium";
  if (["x-high", "extra-high", "extra_high", "very-high", "very_high"].includes(normalized)) return "xhigh";
  if (normalized === "maximum") return "max";
  return undefined;
}

function mergeLiteConfig(existingLiteConfig, existingOpenCodeConfig, configDir) {
  const liteConfig = {
    ...createDefaultLiteConfig(),
    ...(isRecord(existingLiteConfig) ? existingLiteConfig : {}),
    roleModels: {
      ...(isRecord(existingLiteConfig?.roleModels) ? existingLiteConfig.roleModels : {}),
    },
    roleReasoningEffort: {
      ...(isRecord(existingLiteConfig?.roleReasoningEffort) ? existingLiteConfig.roleReasoningEffort : {}),
    },
    taskLeadProfiles: {
      ...(isRecord(existingLiteConfig?.taskLeadProfiles) ? existingLiteConfig.taskLeadProfiles : {}),
    },
    specialists: readSpecialistConfigs(existingLiteConfig?.specialists),
    modelPoolPolicy: {
      source: "all",
      allowCodexBackend: false,
      ...(isRecord(existingLiteConfig?.modelPoolPolicy) ? existingLiteConfig.modelPoolPolicy : {}),
    },
  };
  // Effective entries: native `agents` shadows same-name legacy `agent` entries;
  // model references keep an explicit `#variant` intact.
  const agents = mergedAgentEntries(existingOpenCodeConfig);

  for (const roleName of MANAGED_AGENT_NAMES) {
    if (BUILTIN_AGENT_OVERRIDES.has(roleName)) continue;
    const agent = isRecord(agents[roleName]) ? agents[roleName] : {};
    if (agent.disable === true || agent.disabled === true) continue;
    const modelRef = parseModelReference(agent.model);
    const model = modelRef ? modelRef.reference : undefined;
    if (!liteConfig.roleModels[roleName] && model) {
      liteConfig.roleModels[roleName] = model;
    }
    const effort = normalizeReasoningEffort(agent.reasoningEffort);
    if (!liteConfig.roleReasoningEffort[roleName] && effort) {
      liteConfig.roleReasoningEffort[roleName] = effort;
    }
  }

  // Profile preferences: managed plugin options are the effective source;
  // existing lite-config choices always win over migration defaults.
  const pluginProfiles = managedPluginOptions(existingOpenCodeConfig, configDir);
  const profilesSource = isRecord(pluginProfiles.taskLeadProfiles)
    ? pluginProfiles.taskLeadProfiles
    : (isRecord(existingOpenCodeConfig.taskLeadProfiles) ? existingOpenCodeConfig.taskLeadProfiles : {});
  for (const [profileName, profileValue] of Object.entries(profilesSource)) {
    if (!isRecord(profileValue)) continue;
    const profile = isRecord(liteConfig.taskLeadProfiles[profileName])
      ? { ...liteConfig.taskLeadProfiles[profileName] }
      : {};
    const modelRef = parseModelReference(profileValue.model);
    const model = modelRef ? modelRef.reference : undefined;
    if (!profile.model && model) profile.model = model;
    const effort = normalizeReasoningEffort(profileValue.reasoningEffort);
    if (!profile.reasoningEffort && effort) profile.reasoningEffort = effort;
    if (Array.isArray(profileValue.fallbackModels) && !profile.fallbackModels) {
      profile.fallbackModels = profileValue.fallbackModels.filter((item) => typeof item === "string");
    }
    // Existing lite-config choices win; migration only backfills missing keys.
    if (Object.keys(profile).length > 0) liteConfig.taskLeadProfiles[profileName] = profile;
  }

  return liteConfig;
}

function readSpecialistConfigs(value) {
  const specialists = {};
  if (!isRecord(value)) return specialists;

  for (const [specialistName, rawSpecialist] of Object.entries(value)) {
    const specialist = normalizeSpecialistConfig(rawSpecialist, specialistName);
    if (specialist && specialist.name === specialistName) specialists[specialistName] = specialist;
  }

  return specialists;
}

function normalizeSpecialistConfig(value, fallbackName) {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name : fallbackName;
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (!name || !SPECIALIST_NAME_PATTERN.test(name) || RESERVED_SPECIALIST_NAMES.has(name) || !description) return undefined;

  const model = typeof value.model === "string" && value.model.trim().includes("/")
    ? value.model.trim()
    : undefined;
  if (value.model !== undefined && !model) return undefined;

  const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort);
  if (value.reasoningEffort !== undefined && !reasoningEffort) return undefined;

  let editFolders;
  if (value.editFolders !== undefined) {
    if (!Array.isArray(value.editFolders)) return undefined;
    editFolders = value.editFolders.map((folder) => typeof folder === "string" ? folder.trim() : "").filter(Boolean);
    if (editFolders.length !== value.editFolders.length) return undefined;
    if (editFolders.some((folder) => !isSafeRelativeFolder(folder))) return undefined;
  }

  const prompt = value.prompt;
  if (prompt !== undefined && (typeof prompt !== "string" || prompt.trim() === "")) return undefined;
  const promptFile = value.promptFile;
  if (promptFile !== undefined && (
    typeof promptFile !== "string" ||
    promptFile.trim() === "" ||
    !isSafeRelativeFilePath(promptFile)
  )) return undefined;
  if (value.allowBash !== undefined && typeof value.allowBash !== "boolean") return undefined;

  return {
    name,
    description,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(editFolders ? { editFolders } : {}),
    ...(typeof prompt === "string" ? { prompt } : {}),
    ...(typeof promptFile === "string" ? { promptFile: promptFile.trim() } : {}),
    allowBash: value.allowBash === true,
  };
}

function isSafeRelativeFolder(value) {
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "*" || normalized === "**") return true;
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function isSafeRelativeFilePath(value) {
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function mergePermission(existingPermission, sourcePermission) {
  if (!isRecord(existingPermission)) return sourcePermission;
  if (!isRecord(sourcePermission)) return existingPermission;

  return {
    ...sourcePermission,
    ...existingPermission,
    bash: isRecord(existingPermission.bash) ? existingPermission.bash : sourcePermission.bash,
  };
}

/**
 * Native permission backfill: user rules keep their exact order and are never
 * object-spread or sorted. Managed rules are appended only for actions the
 * user does not own (explicit user restrictions win and are preserved).
 */
function backfillNativePermissions(existingConfig, sourceConfig) {
  const read = readNativePermissions(existingConfig);
  const userOwnedActions = new Set(read.rules.map((rule) => rule.action));
  const legacyPermission = isRecord(existingConfig.permission) ? existingConfig.permission : {};
  for (const [action] of Object.entries(legacyPermission)) {
    userOwnedActions.add(NATIVE_PERMISSION_ACTION_NAMES[action] ?? action);
  }

  const backfill = nativeManagedPermissionRules(
    isRecord(sourceConfig.permission) ? sourceConfig.permission : {},
  ).filter((rule) => !userOwnedActions.has(rule.action));

  return [
    ...existingConfig.permissions,
    ...backfill,
  ];
}

function mergeMcpDialectAware(existingConfig, sourceConfig, managedMcp = true, isNativeTarget = false) {
  if (!managedMcp || !isRecord(sourceConfig.mcp)) return existingConfig.mcp;
  const managedSourceMcp = Object.fromEntries(
    Object.entries(sourceConfig.mcp).filter(([serverName]) => MANAGED_MCP_NAMES.has(serverName)),
  );
  const existing = isRecord(existingConfig.mcp) ? existingConfig.mcp : {};
  const existingServers = isRecord(existing.servers) ? existing.servers : undefined;

  if (isNativeTarget || existingServers) {
    const servers = existingServers ? { ...existingServers } : {};
    for (const [serverName, config] of Object.entries(managedSourceMcp)) {
      // User-owned entries (either the direct v1 map or native servers) win;
      // managed defaults only backfill missing names.
      const directOwned = existing[serverName] !== undefined;
      if (servers[serverName] === undefined && !directOwned) servers[serverName] = config;
    }
    return { ...existing, servers };
  }

  return {
    ...managedSourceMcp,
    ...existing,
  };
}

function mergeConfig(existingConfig, sourceConfig, configDir, options = {}) {
  const info = detectConfigDialect(existingConfig);
  const isNativeTarget = info.dialect === "native" || info.dialect === "mixed";

  // Effective managed plugin options: native entries win on mixed files.
  // Detection spans both management generations (legacy .ts specs and the
  // resolved runtime directory).
  const existingManagedOptions = managedPluginOptions(existingConfig, configDir);
  const taskLeadProfiles = isRecord(existingManagedOptions.taskLeadProfiles)
    ? existingManagedOptions.taskLeadProfiles
    : undefined;

  // Plugin containers: remove exact managed entries from both generations
  // (both dialects, never user specs that merely contain the plugin filename),
  // then upsert once in the effective container — native classed/mixed files
  // get the native {package, options} form, legacy-classified files keep the
  // v1 tuple. The single active managed source is the runtime directory.
  const managedSpec = contextRuntimeDir(configDir);
  const pluginContainers = {
    plugin: Array.isArray(existingConfig.plugin)
      ? [...existingConfig.plugin]
      : typeof existingConfig.plugin === "string"
        ? [existingConfig.plugin]
        : undefined,
    plugins: Array.isArray(existingConfig.plugins) ? [...existingConfig.plugins] : undefined,
  };
  removeManagedPluginEntries(pluginContainers, undefined, configDir);
  upsertManagedPluginEntry(pluginContainers, managedSpec, relativePluginOptions(configDir, taskLeadProfiles), configDir);

  // Legacy agent container: installer-owned managed + specialist names are
  // removed; unrelated custom agents are preserved verbatim. The native
  // `agents` container is user data here — it is preserved untouched (managed
  // native entries fail the conflict gate before any write).
  const legacyAgents = isRecord(existingConfig.agent) ? existingConfig.agent : {};
  const customLegacyAgents = Object.fromEntries(
    Object.entries(legacyAgents).filter(([agentName]) => (
      !MANAGED_AGENT_NAMES.has(agentName) &&
      !(options.specialistNames instanceof Set && options.specialistNames.has(agentName))
    )),
  );
  const nativeAgents = nativeAgentEntries(existingConfig);

  const managedCommandEntries = isRecord(sourceConfig.command) ? sourceConfig.command : {};
  const writeLegacyCommands = isRecord(existingConfig.command) || !isNativeTarget;
  const writeNativeCommands = isRecord(existingConfig.commands) || isNativeTarget;
  const legacyCommandContainer = writeLegacyCommands
    ? {
      ...Object.fromEntries(
        Object.entries(isRecord(existingConfig.command) ? existingConfig.command : {}).filter(([commandName]) => (
          !MANAGED_COMMAND_NAMES.has(commandName)
        )),
      ),
      ...managedCommandEntries,
    }
    : undefined;
  const nativeCommandContainer = writeNativeCommands
    ? {
      ...Object.fromEntries(
        Object.entries(isRecord(existingConfig.commands) ? existingConfig.commands : {}).filter(([commandName]) => (
          !MANAGED_COMMAND_NAMES.has(commandName)
        )),
      ),
      ...managedCommandEntries,
    }
    : undefined;

  const hasNativePermissions = Array.isArray(existingConfig.permissions);
  const hasLegacyPermission = isRecord(existingConfig.permission);
  const writeLegacyPermission = hasLegacyPermission || !isNativeTarget;
  let permissionOutput;
  let permissionsOutput;
  if (hasNativePermissions) {
    // Native ordered rule array: user rules first in their original order,
    // managed backfill appended per unowned action (never reordered).
    permissionsOutput = backfillNativePermissions(existingConfig, sourceConfig);
    // Native wins canonically on mixed files; the legacy permission map is
    // user data and passes through untouched (never silently deleted).
    permissionOutput = hasLegacyPermission ? existingConfig.permission : undefined;
  } else if (writeLegacyPermission) {
    permissionOutput = mergePermission(existingConfig.permission, sourceConfig.permission);
  } else {
    // Native-classified file without permission data: emit managed defaults
    // as a v2-shaped ordered rule array, no v1 fields inside native entries.
    permissionsOutput = nativeManagedPermissionRules(
      isRecord(sourceConfig.permission) ? sourceConfig.permission : {},
    );
  }

  const mcpOutput = mergeMcpDialectAware(existingConfig, sourceConfig, options.managedMcp, isNativeTarget);

  // C07: bounded default host session depth, dialect-aware, written only when
  // the user has no existing depth setting and never over a stricter value.
  const hostSessionDepth = resolveHostSessionDepth(existingConfig, isNativeTarget);
  const depthWrite = applyHostSessionDepthWrite(hostSessionDepth);

  const {
    taskLeadProfiles: _legacyTaskLeadProfiles,
    agent: _existingAgents,
    command: _existingCommand,
    commands: _existingCommands,
    plugin: _existingPlugin,
    plugins: _existingPlugins,
    permission: _existingPermission,
    permissions: _existingPermissions,
    mcp: _existingMcp,
    ...preservedExisting
  } = existingConfig;

  return {
    ...preservedExisting,
    $schema: existingConfig.$schema ?? sourceConfig.$schema,
    ...(pluginContainers.plugin !== undefined ? { plugin: pluginContainers.plugin } : {}),
    ...(pluginContainers.plugins !== undefined ? { plugins: pluginContainers.plugins } : {}),
    ...(legacyCommandContainer ? { command: legacyCommandContainer } : {}),
    ...(nativeCommandContainer ? { commands: nativeCommandContainer } : {}),
    ...(mcpOutput !== undefined ? { mcp: mcpOutput } : {}),
    default_agent: sourceConfig.default_agent,
    ...(permissionOutput !== undefined ? { permission: permissionOutput } : {}),
    ...(permissionsOutput !== undefined ? { permissions: permissionsOutput } : {}),
    ...(depthWrite.subagent_depth !== undefined ? { subagent_depth: depthWrite.subagent_depth } : {}),
    ...(depthWrite.experimental !== undefined
      ? { experimental: { ...preservedExisting.experimental, ...depthWrite.experimental } }
      : {}),
    ...(Object.keys(customLegacyAgents).length > 0 ? { agent: customLegacyAgents } : {}),
    ...(nativeAgents !== undefined ? { agents: nativeAgents } : {}),
  };
}

function replaceAllLiteral(value, search, replacement) {
  return value.split(search).join(replacement);
}

function buildUpdateLiteInstallCommand(rootDir, configDir) {
  return `node "${path.join(rootDir, "scripts/install.mjs")}" --root-dir "${rootDir}" --config-dir "${configDir}"`;
}

function buildUpdateLiteCommand(rootDir, configDir) {
  const command = MANAGED_CONFIG.command?.["update-lite"];
  if (!isRecord(command)) return undefined;

  let template = typeof command.template === "string" ? command.template : "";
  template = replaceAllLiteral(template, "__OH_MY_LITE_SOURCE_ROOT__", rootDir);
  template = replaceAllLiteral(template, "__OH_MY_LITE_CONFIG_DIR__", configDir);

  return {
    ...command,
    template,
  };
}

function allowInstallScopedUpdateLite(config, context) {
  const installCommand = buildUpdateLiteInstallCommand(context.rootDir, context.configDir);

  if (Array.isArray(config.permissions)) {
    // Native rule array: append the exact allow rule once, user order preserved.
    const alreadyAllowed = readNativePermissions(config).rules.some((rule) => (
      rule.action === "shell" && rule.resource === installCommand && rule.effect === "allow"
    ));
    if (!alreadyAllowed) {
      appendNativePermissionRules(config, [{ action: "shell", resource: installCommand, effect: "allow" }]);
    }
    return config;
  }

  const permission = isRecord(config.permission) ? config.permission : {};
  const bash = isRecord(permission.bash) ? permission.bash : {};

  return {
    ...config,
    permission: {
      ...permission,
      bash: {
        ...bash,
        [installCommand]: "allow",
      },
    },
  };
}

function injectInstallScopedCommands(config, context) {
  const updateLiteCommand = buildUpdateLiteCommand(context.rootDir, context.configDir);
  if (updateLiteCommand === undefined) return { ...config };

  const withCommand = { ...config };
  // The effective native `commands` container wins on mixed files.
  if (isRecord(withCommand.commands)) {
    withCommand.commands = { ...withCommand.commands, "update-lite": updateLiteCommand };
  } else {
    withCommand.command = {
      ...(isRecord(withCommand.command) ? withCommand.command : {}),
      "update-lite": updateLiteCommand,
    };
  }

  return allowInstallScopedUpdateLite(withCommand, context);
}

function applyModelAssignments(config, assignments) {
  const agents = isRecord(config.agent) ? config.agent : {};

  for (const [role, model] of Object.entries(assignments)) {
    if (typeof model !== "string" || !MANAGED_AGENT_NAMES.has(role)) continue;
    if (!isRecord(agents[role])) {
      agents[role] = { ...(isRecord(agents[role]) ? agents[role] : {}), model };
    } else {
      agents[role].model = model;
    }
  }

  config.agent = agents;
  return config;
}

function applyLiteModelAssignments(liteConfig, assignments) {
  for (const [role, model] of Object.entries(assignments)) {
    if (typeof model !== "string" || !MANAGED_AGENT_NAMES.has(role)) continue;
    if (BUILTIN_AGENT_OVERRIDES.has(role)) continue;
    liteConfig.roleModels[role] = model;
  }
  return liteConfig;
}

function yamlScalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function yamlLines(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    return value.flatMap((child) => {
      if (isRecord(child) || Array.isArray(child)) {
        return [`${prefix}-`, ...yamlLines(child, indent + 2)];
      }
      return [`${prefix}- ${yamlScalar(child)}`];
    });
  }
  if (!isRecord(value)) return [`${prefix}${yamlScalar(value)}`];
  const lines = [];
  for (const [key, child] of Object.entries(value)) {
    const yamlKey = /^[a-zA-Z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
    if (isRecord(child) || Array.isArray(child)) {
      lines.push(`${prefix}${yamlKey}:`);
      lines.push(...yamlLines(child, indent + 2));
    } else {
      lines.push(`${prefix}${yamlKey}: ${yamlScalar(child)}`);
    }
  }
  return lines;
}

function normalizeSpecialistFolder(value) {
  let normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "*" || normalized === "**") return normalized;
  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  while (normalized.endsWith("/**") || normalized.endsWith("/*")) {
    normalized = normalized.slice(0, normalized.lastIndexOf("/"));
  }
  normalized = normalized.replace(/^\.\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized === "." || normalized === ".." || !isSafeRelativeFolder(normalized)) return undefined;
  return normalized;
}

function generateSpecialistEditPermissions(editFolders) {
  if (!Array.isArray(editFolders) || editFolders.length === 0) return { "*": "deny" };
  const folders = new Set(editFolders.map((folder) => (
    typeof folder === "string" ? normalizeSpecialistFolder(folder) : undefined
  )).filter(Boolean));
  if (folders.has("*") || folders.has("**")) return { "*": "allow" };

  const permissions = { "*": "deny" };
  for (const folder of folders) {
    permissions[`${folder}/**`] = "allow";
    permissions[`**/${folder}/**`] = "allow";
  }
  return permissions;
}

function specialistTaskPermissions(agent, specialistNames) {
  if (specialistNames.length === 0) return agent;
  const permission = isRecord(agent.permission) ? agent.permission : {};
  const task = isRecord(permission.task) ? permission.task : {};
  const taskWithoutCatchAll = Object.fromEntries(Object.entries(task).filter(([key]) => key !== "*"));
  const nextTask = { "*": "deny", ...taskWithoutCatchAll };
  for (const specialistName of specialistNames) nextTask[specialistName] = "allow";
  return {
    ...agent,
    permission: {
      ...permission,
      task: nextTask,
    },
  };
}

function specialistFrontmatter(config) {
  return {
    mode: "subagent",
    hidden: true,
    description: config.description,
    ...(config.model ? { model: config.model } : {}),
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    permission: {
      task: { "*": "deny" },
      question: "deny",
      edit: generateSpecialistEditPermissions(config.editFolders),
      bash: { "*": config.allowBash === true ? "allow" : "deny" },
    },
  };
}

function agentFrontmatter(agent, liteConfig, agentName, specialistNames = []) {
  const frontmatter = { ...agent };
  delete frontmatter.prompt;
  if (agentName === "command-lead") {
    Object.assign(frontmatter, specialistTaskPermissions(frontmatter, specialistNames));
  }
  const model = liteConfig.roleModels[agentName];
  if (model) frontmatter.model = model;
  const reasoningEffort = liteConfig.roleReasoningEffort?.[agentName];
  if (reasoningEffort) frontmatter.reasoningEffort = reasoningEffort;
  else delete frontmatter.reasoningEffort;
  return yamlLines(frontmatter).join("\n");
}

async function writeManagedAgentMarkdownFiles(rootDir, configDir, liteConfig, dryRun, journal) {
  const targetAgentsDir = path.join(configDir, "agents");
  if (!dryRun) await mkdir(targetAgentsDir, { recursive: true });

  const sourceAgents = isRecord(MANAGED_CONFIG.agent) ? MANAGED_CONFIG.agent : {};
  const specialistNames = Object.keys(liteConfig.specialists ?? {});
  for (const [agentName, agent] of Object.entries(sourceAgents)) {
    if (!isRecord(agent)) continue;
    const promptRef = typeof agent.prompt === "string" ? agent.prompt.match(/^\{file:(.*)\}$/)?.[1] : undefined;
    let promptText = "";
    if (promptRef) {
      promptText = await readFile(path.resolve(rootDir, promptRef), "utf8");
    } else {
      promptText = `# ${agentName}\n`;
    }
    const targetPath = path.join(targetAgentsDir, `${agentName}.md`);
    const existingContent = await fileExists(targetPath) ? await readFile(targetPath, "utf8") : "";
    const content = `---\n${agentFrontmatter(agent, liteConfig, agentName, specialistNames)}\n---\n\n${promptText.trimEnd()}\n`;
    if (!dryRun) {
      await writeTextFile(targetPath, content, dryRun, journal);
    }
  }

  for (const [specialistName, specialist] of Object.entries(liteConfig.specialists ?? {})) {
    const targetPath = path.join(targetAgentsDir, `${specialistName}.md`);
    let promptText = specialist.prompt;
    if (!promptText && specialist.promptFile) {
      promptText = await readFile(path.resolve(rootDir, specialist.promptFile), "utf8");
    }
    if (!promptText) promptText = `# ${specialistName}\n\n${specialist.description}\n`;
    const content = `---\n${yamlLines(specialistFrontmatter(specialist)).join("\n")}\n---\n\n${promptText.trimEnd()}\n`;
    if (!dryRun) {
      await writeTextFile(targetPath, content, dryRun, journal);
    }
  }
}

async function writeBackupIfExists(filePath) {
  if (await fileExists(filePath)) {
    await writeFile(`${filePath}.bak`, await readFile(filePath, "utf8"));
  }
}

/**
 * Write journal: records prior bytes for every generated-file mutation so a
 * failure after any partial write/swap can restore exact previous content
 * (rollback, C06 plan risk row "installer update partially changes a working
 * installation"). Reversed-order undo; file-on-disk .bak backups are kept
 * independent of the journal.
 */
function createWriteJournal() {
  const entries = [];
  const journal = {
    entries,
    async undoAll() {
      for (const entry of [...entries].reverse()) {
        try {
          if (entry.kind === "rename") {
            if (await pathExists(entry.to)) await rm(entry.to, { recursive: true, force: true });
            if (await pathExists(entry.from)) await rename(entry.from, entry.to);
          } else if (entry.kind === "runtime") {
            await undoActiveRuntime(entry);
          } else if (entry.kind === "file") {
            if (entry.existed) await writeFile(entry.path, entry.priorBytes ?? "");
            else await rm(entry.path, { recursive: true, force: true });
          }
        } catch (undoError) {
          entry.undoError = String(undoError?.message ?? undoError);
        }
      }
    },
  };
  return journal;
}

async function pathExistsAny(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJson(filePath, value, dryRun, journal) {
  if (dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeBackupIfExists(filePath);
  if (journal) {
    const existed = await pathExistsAny(filePath);
    journal.entries.push({
      kind: "file",
      path: filePath,
      existed,
      ...(existed ? { priorBytes: await readFile(filePath, "utf8") } : {}),
    });
  }
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(filePath, content, dryRun, journal) {
  if (dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeBackupIfExists(filePath);
  if (journal) {
    const existed = await pathExistsAny(filePath);
    journal.entries.push({
      kind: "file",
      path: filePath,
      existed,
      ...(existed ? { priorBytes: await readFile(filePath, "utf8") } : {}),
    });
  }
  await writeFile(filePath, content);
}

/**
 * Offline test injection only: when OH_MY_LITE_TEST_DEPENDENCY_RUNNER names a
 * module, its default export replaces the real npm launcher (single-guarded
 * opt-in; unset means the real locked npm ci path). Never used by real runs.
 */
async function loadTestDependencyRunner() {
  const injectionPath = process.env.OH_MY_LITE_TEST_DEPENDENCY_RUNNER;
  if (!injectionPath) return undefined;
  const mod = await import(pathToFileURL(path.resolve(injectionPath)).href);
  const runner = mod.default ?? mod;
  if (typeof runner !== "function") {
    throw new Error(`OH_MY_LITE_TEST_DEPENDENCY_RUNNER module has no callable export: ${injectionPath}`);
  }
  return runner;
}

async function prepareInstallContext(options) {
  const rootDir = path.resolve(
    options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const configDir = path.resolve(options.configDir ?? defaultConfigDir());
  const targetConfigPath = await resolveTargetConfigPath(configDir);
  const liteConfigPath = path.join(configDir, LITE_CONFIG_FILE);
  const existingConfig = await readJsonIfExists(targetConfigPath);
  const existingLiteConfig = await readJsonIfExists(liteConfigPath);
  const dependencyRunner =
    typeof options.dependencyRunner === "function"
      ? options.dependencyRunner
      : await loadTestDependencyRunner();

  return {
    rootDir,
    configDir,
    targetConfigPath,
    liteConfigPath,
    existingConfig,
    existingLiteConfig,
    dryRun: Boolean(options.dryRun),
    interactive: Boolean(options.interactive),
    managedMcp: options.managedMcp !== false,
    dependencyRunner,
    sourceOpenCodeDir: path.join(rootDir, ".opencode"),
    targetOpenCodeDir: path.join(configDir, ".opencode"),
    runtimeDir: runtimeNamespaceDir(configDir),
    runtimeStagingDir: runtimeStagingDir(configDir),
    runtimeBackupDir: runtimeBackupDir(configDir),
    runtimeNpmCacheDir: runtimeNpmCacheDir(configDir),
    report: {},
  };
}

/**
 * Managed runtime namespace inspection (C06 failure_handling): unrecognized
 * files or a custom (non-managed) package manifest inside the namespace stop
 * the install instead of being overwritten or deleted.
 */
async function inspectManagedRuntimeNamespace(context) {
  if (!(await pathExistsAny(context.runtimeDir))) return { exists: false, unknown: [], manifestCollision: false };
  const unknown = [];
  for (const entry of await readdir(context.runtimeDir)) {
    if (!MANAGED_RUNTIME_NAMES.has(entry)) unknown.push(entry);
  }
  let manifestCollision = false;
  const managedManifestPath = await managedSourceFile(context, RUNTIME_MANIFEST_SOURCE);
  let managedManifest;
  try {
    managedManifest = await readFile(managedManifestPath, "utf8");
  } catch {
    throw missingRuntimeManifestError(context, managedManifestPath);
  }
  const priorManifestPath = path.join(context.runtimeDir, "package.json");
  if (await fileExists(priorManifestPath)) {
    let priorManifest;
    try {
      priorManifest = await readFile(priorManifestPath, "utf8");
    } catch (error) {
      throw new Error(`Managed runtime manifest ${priorManifestPath} is unreadable (${error.message}); stopping instead of overwriting.`);
    }
    const normalize = (text) => JSON.stringify(JSON.parse(stripTrailingCommas(stripJsonComments(text.replace(/^\uFEFF/, "")))) ?? {});
    manifestCollision = normalize(managedManifest) !== normalize(priorManifest);
  }
  if (unknown.length > 0 || manifestCollision) throw runtimeNamespaceCollisionError(context, unknown, manifestCollision);
  return { exists: true, unknown, manifestCollision };
}

function runtimeNamespaceCollisionError(context, unknown, manifestCollision) {
  const details = [];
  if (unknown.length > 0) {
    details.push(`Unrecognized files inside the managed runtime namespace ${context.runtimeDir}: ${unknown.join(", ")}.`);
  }
  if (manifestCollision) {
    details.push(`Your existing ${path.join(context.runtimeDir, "package.json")} does not match the managed runtime manifest (custom manifest collision).`);
  }
  return new Error([
    "Install stopped: the managed runtime namespace already contains data this installer does not own.",
    ...details,
    "Review these files, remove or rename them yourself (no user file is ever deleted by the installer), and run the installer again.",
  ].join("\n"));
}

async function managedSourceFile(context, fileName) {
  // The shim + runtime manifest/lock are packaged at .opencode/ by C05/C06;
  // prefer them there, fall back to the repo root .opencode layout.
  const candidates = [
    path.join(context.sourceOpenCodeDir, fileName),
    path.join(context.rootDir, fileName),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return candidates[0];
}

function missingRuntimeManifestError(context, manifestPath) {
  return new Error(
    `Missing managed runtime manifest source: ${manifestPath}.\n` +
      `Expected packaged inputs: "${MANAGED_RUNTIME_SOURCES.join('", "')}" plus agents/, plugins/, lib/ under ${context.sourceOpenCodeDir}.\n` +
      `The install requires the ${RUNTIME_SHIM_FILE} shim and the runtime manifest/lock shipped with oh-my-lite-openagent >= C06; without them the host cannot resolve the directory entrypoint. Update the source (npm view oh-my-lite-openagent version / git pull) and retry.`,
  );
}

/**
 * Stage managed runtime files + locked dependencies into a separate staging
 * directory and verify resolution BEFORE switching the configured plugin
 * source. Dry run copies nothing and runs nothing.
 */
async function stageManagedRuntime(context) {
  const steps = [];

  steps.push(`Upcoming current runtime: ${context.runtimeDir}${(await pathExistsAny(context.runtimeDir)) ? " (exists — will be backed up before the swap)" : " (new install)"}`);
  steps.push(`Stage managed runtime files into ${context.runtimeStagingDir}: ${MANAGED_RUNTIME_SOURCES.join(", ")} (staged as ${RUNTIME_STAGED_FILES.slice(1).join("/")}), plus ${MANAGED_DIRS.join("/")}`);

  if (context.dryRun) {
    steps.push(`npm dependency command: ci --ignore-scripts --no-audit --no-fund (execFile ${process.execPath} with a resolved bin/npm-cli.js, shell:false) inside ${context.runtimeStagingDir}`);
    steps.push(`npm cache: ${context.runtimeNpmCacheDir}`);
    steps.push("Verify staged dependency resolution (node_modules manifests) before activation");
    context.report.dependenciesInstalled = false;
    const shimSource = path.join(context.sourceOpenCodeDir, RUNTIME_SHIM_FILE);
    steps.push(
      (await fileExists(shimSource))
        ? `Shim source found: ${shimSource}`
        : `WARNING: shim source ${shimSource} is missing (pending C05 combined-export integration); the real run will fail before activation until it exists.`,
    );
    return steps;
  }

  // Copy managed files into the staging namespace (a stale staging dir from an
  // interrupted prior run is ours and is replaced wholesale).
  await rm(context.runtimeStagingDir, { recursive: true, force: true });
  await mkdir(context.runtimeStagingDir, { recursive: true });
  for (const managedDir of MANAGED_DIRS) {
    const sourceDir = path.join(context.sourceOpenCodeDir, managedDir);
    if (!(await pathExistsAny(sourceDir))) continue;
    await copyDir(sourceDir, path.join(context.runtimeStagingDir, managedDir), context.dryRun);
  }
  const runtimeFileDestinations = { [RUNTIME_SHIM_FILE]: RUNTIME_SHIM_FILE, [RUNTIME_MANIFEST_SOURCE]: "package.json", [RUNTIME_LOCK_SOURCE]: "package-lock.json" };
  for (const [managedSource, managedDest] of Object.entries(runtimeFileDestinations)) {
    const sourcePath = await managedSourceFile(context, managedSource);
    if (managedSource === RUNTIME_SHIM_FILE && !(await fileExists(sourcePath))) {
      // server.ts is delivered by the C05 combined export integration; the
      // packed runtime cannot activate without it.
      await rm(context.runtimeStagingDir, { recursive: true, force: true });
      throw new Error(
        `Missing managed runtime shim ${RUNTIME_SHIM_FILE}: expected ${path.join(context.sourceOpenCodeDir, RUNTIME_SHIM_FILE)}. The v1 host resolves the ./server export of the configured directory and the v2 host probes server.ts/index — this file is required and is integrated by the C05 combined-export workstream. Update the source and retry.`,
      );
    }
    await copyFile(sourcePath, path.join(context.runtimeStagingDir, managedDest));
  }

  const result = await runDependencyStage(context);
  context.report.dependenciesInstalled = true;
  steps.push(`Locked dependencies installed (npm ci --ignore-scripts, ${context.report.npmCliSource} cli via ${process.execPath}, shell:false)`);

  const manifest = await readFile(path.join(context.runtimeStagingDir, "package.json"), "utf8");
  await verifyStagedDependencies(context.runtimeStagingDir, JSON.parse(manifest).dependencies);
  steps.push(`Verified resolved runtime dependencies under ${path.join(context.runtimeStagingDir, "node_modules")}`);

  return steps;
}

/**
 * Swap the verified staging namespace into place. The prior runtime namespace
 * (if any) is moved aside as a backup — never deleted on failure.
 */
async function activateRuntimeNamespace(context, journal) {
  const priorExisted = await pathExistsAny(context.runtimeDir);
  if (context.dryRun) return { priorExisted };
  journal.entries.push({ kind: "runtime", priorExisted, runtimeDir: context.runtimeDir, backupDir: context.runtimeBackupDir });

  if (priorExisted) {
    await rm(context.runtimeBackupDir, { recursive: true, force: true });
    await rename(context.runtimeDir, context.runtimeBackupDir);
  }
  try {
    await rename(context.runtimeStagingDir, context.runtimeDir);
  } catch (error) {
    throw new Error(`Runtime namespace activation failed: ${error.message}`);
  }
  context.report.runtimeBackuped = priorExisted ? context.runtimeBackupDir : null;
  return { priorExisted };
}

async function undoActiveRuntime(runtimeEntry) {
  if (!runtimeEntry) return;
  try {
    await rm(runtimeEntry.runtimeDir, { recursive: true, force: true });
    if (runtimeEntry.priorExisted) {
      await rename(runtimeEntry.backupDir, runtimeEntry.runtimeDir);
    }
  } catch (undoError) {
    runtimeEntry.undoError = String(undoError?.message ?? undoError);
  }
}

/**
 * Old copied-tree entrypoint: if the legacy "<config>/.opencode/plugins/
 * bounded-lite.ts" file still exists it may be auto-discovered as a second,
 * active copy of the plugin. Never delete user files wholesale — back it up
 * and disable exactly this known managed entrypoint; the action is recorded
 * and fully reversible.
 */
async function disableLegacyManagedEntrypoint(context, journal) {
  const legacyFile = path.join(context.targetOpenCodeDir, "plugins", PLUGIN_FILE);
  if (!(await fileExists(legacyFile))) return null;
  if (context.dryRun) {
    return `Legacy copied entrypoint ${legacyFile} still exists; the real run will back it up to ${legacyFile}.bak and disable it (rename to ${RUNTIME_ENTRY_DISABLED_SUFFIX}) so exactly one managed source stays active.`;
  }
  const backupPath = `${legacyFile}.bak`;
  await writeFile(backupPath, await readFile(legacyFile, "utf8"));
  const disabledPath = `${legacyFile}${RUNTIME_ENTRY_DISABLED_SUFFIX}`;
  await rename(legacyFile, disabledPath);
  journal.entries.push({ kind: "rename", from: disabledPath, to: legacyFile });
  context.report.disabledLegacyEntrypoint = { backupPath, disabledPath };
  return `Disabled superseded copied entrypoint: backed up to ${backupPath}, renamed to ${disabledPath}. Old copied trees stay inert (nothing under user config was deleted).`;
}

function mergeAll(context) {
  const liteConfig = mergeLiteConfig(context.existingLiteConfig, context.existingConfig, context.configDir);
  const mergedConfig = mergeConfig(context.existingConfig, MANAGED_CONFIG, context.configDir, {
    managedMcp: context.managedMcp,
    specialistNames: new Set(Object.keys(liteConfig.specialists ?? {})),
  });
  // Same pure decision mergeConfig applied; surfaced here for the install
  // report so a stricter user depth limit is a reported blocker, never a
  // silent rewrite.
  const dialectInfo = detectConfigDialect(context.existingConfig);
  const hostSessionDepth = resolveHostSessionDepth(
    context.existingConfig,
    dialectInfo.dialect === "native" || dialectInfo.dialect === "mixed",
  );

  return {
    liteConfig,
    mergedConfig: injectInstallScopedCommands(mergedConfig, context),
    hostSessionDepth,
  };
}

function installConflictNames(context, liteConfig) {
  const specialistNames = Object.keys(liteConfig?.specialists ?? {});
  return [...MANAGED_AGENT_NAMES, ...specialistNames];
}

function collectInstallConflicts(context, liteConfig, configDir) {
  return findManagedConfigConflicts(context.existingConfig, installConflictNames(context, liteConfig), configDir);
}

function formatInstallConflicts(conflicts) {
  return [
    "Installer stopped before writing files: the existing OpenCode configuration contains entries that would conflict with or shadow managed values.",
    "",
    ...conflicts.map((conflict) => (
      `- ${conflict.location} (${conflict.kind})\n  ${conflict.detail}\n  Guidance: ${conflict.guidance}`
    )),
    "",
    "No files were written. Resolve the listed entries and run the installer again.",
  ].join("\n");
}

async function runInteractiveSetup(liteConfig, context) {
  if (!context.interactive) return liteConfig;

  const providerAnswers = await promptProviders();
  if (!providerAnswers) return liteConfig;

  const availableModels = collectModelsFromProviders(providerAnswers);
  const result = resolveModelsForProviders(availableModels);

  console.log(formatModelAssignments(result));

  if (Object.keys(result.assignments).length > 0) {
    liteConfig = applyLiteModelAssignments(liteConfig, result.assignments);
    console.log(
      context.dryRun
        ? `  [Dry run] Model assignments would be written to ${LITE_CONFIG_FILE}.`
        : `  Model assignments will be written to ${LITE_CONFIG_FILE}.`,
    );
  }

  if (result.unresolved.length > 0) {
    console.log("  Some roles could not be matched. Consider adding more providers.");
    console.log("  You can use '/agent-models' in OpenCode to configure them manually.");
  }

  return liteConfig;
}

async function writeOutputs(context, mergedConfig, liteConfig, journal) {
  await writeJson(context.targetConfigPath, mergedConfig, context.dryRun, journal);
  await writeJson(context.liteConfigPath, liteConfig, context.dryRun, journal);
  await writeManagedAgentMarkdownFiles(context.rootDir, context.configDir, liteConfig, context.dryRun, journal);
}

export async function install(options = {}) {
  const context = await prepareInstallContext(options);
  const merged = mergeAll(context);

  // Stop before any file mutation (or managed-dir copy) when existing native
  // or mixed entries would shadow managed values and cannot be classified
  // without guessing. Dry runs report the same gate and write nothing.
  const conflicts = collectInstallConflicts(context, merged.liteConfig, context.configDir);
  if (conflicts.length > 0) {
    throw new Error(formatInstallConflicts(conflicts));
  }

  // C07: a stricter user-configured host session depth is kept and reported
  // (not silently raised); the install itself still proceeds.
  if (merged.hostSessionDepth?.blocker) {
    context.report.hostSessionDepthBlocker = merged.hostSessionDepth.blocker;
  }

  const inspection = await inspectManagedRuntimeNamespace(context);
  context.report.runtimeNamespaceExisted = inspection.exists;

  const journal = createWriteJournal();
  try {
    const stageSteps = await stageManagedRuntime(context);

    if (!context.dryRun) {
      // Activation order: runtime swap first, then configuration switch —
      // the staged runtime is fully verified before any config source is
      // changed. Any later failure rolls back both, restoring the exact
      // prior bytes for every journaled generated file.
      await activateRuntimeNamespace(context, journal);
    }
    const legacyDisableStep = await disableLegacyManagedEntrypoint(context, journal);

    const liteConfig = await runInteractiveSetup(merged.liteConfig, context);
    await writeOutputs(context, merged.mergedConfig, liteConfig, journal);

    if (context.dryRun) {
      context.report.plan = [
        ...stageSteps,
        ...(legacyDisableStep ? [legacyDisableStep] : []),
        `Swap staging into ${context.runtimeDir} (prior namespace backed up to ${context.runtimeBackupDir})`,
        `Backup + write ${context.targetConfigPath}`,
        `Backup + write ${context.liteConfigPath}`,
        `Backup + overwrite generated agent Markdown under ${path.join(context.configDir, "agents")}`,
      ];
      context.report.dependenciesInstalled = false;
    }

    return {
      configDir: context.configDir,
      configPath: context.targetConfigPath,
      liteConfigPath: context.liteConfigPath,
      runtimeDir: context.runtimeDir,
      plugin: context.runtimeDir,
      report: context.report,
      dryRun: context.dryRun,
    };
  } catch (error) {
    if (!context.dryRun) {
      await journal.undoAll();
    }
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = await install(args);
  } finally {
    // no-op (kept for symmetry with rollback reporting below)
  }

  console.log(`OpenCode config: ${result.configPath}`);
  console.log(`Oh My Lite config: ${result.liteConfigPath}`);
  console.log(`Managed runtime (directory entrypoint): ${result.runtimeDir}`);

  if (result.dryRun && Array.isArray(result.report?.plan)) {
    console.log("");
    console.log("Planned install actions (dry run — nothing written, nothing installed):");
    for (const step of result.report.plan) console.log(`  - ${step}`);
  }

  if (result.report?.hostSessionDepthBlocker) {
    console.log("");
    console.log("WARN: " + result.report.hostSessionDepthBlocker.detail);
  }

  if (args.interactive) {
    console.log(result.dryRun ? "Dry run with model setup complete; no files were written." : "Install with model setup complete.");
    console.log("");
    console.log("You can reconfigure models anytime using the /agent-models command in OpenCode.");
    console.log("Use action=auto for automatic configuration, action=list to view current settings,");
    console.log("or action=apply for manual per-role assignment.");
  } else {
    console.log(result.dryRun ? "Dry run complete; no files were written." : "Install complete.");
    console.log("");
    console.log("To configure models for each role, run:");
    console.log("  node scripts/install.mjs --interactive");
    console.log("Or use the /agent-models command in OpenCode.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
