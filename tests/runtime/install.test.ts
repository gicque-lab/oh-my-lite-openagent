import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  buildFixtureSourceRoot,
  createStubDependencyRunner,
  snapshotPaths,
} from "./install-fixture.js";

const execFileAsync = promisify(execFile);

const installScript = await readFile(path.resolve(process.cwd(), "scripts/install.mjs"), "utf8");

const installerModule = (await import(pathToFileURL(path.resolve(process.cwd(), "scripts/install.mjs")).href)) as {
  install: (options?: Record<string, unknown>) => Promise<InstallResult>;
  resolveNpmCli: (
    execPath: string,
    env: Record<string, string | undefined>,
    fileExists: (filePath: string) => Promise<boolean>,
  ) => Promise<{ file: string; source: string } | null>;
  buildNpmCiPlan: (
    execPath: string,
    npmCliFile: string,
    cwd: string,
    envExtras?: Record<string, string>,
  ) => { file: string; args: string[]; cwd: string; shell: boolean; env: Record<string, string | undefined> };
  defaultDependencyRunner: (plan: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ status: number }>;
};

interface InstallResult {
  configDir: string;
  configPath: string;
  liteConfigPath: string;
  runtimeDir: string;
  plugin: string;
  report: Record<string, unknown>;
  dryRun: boolean;
}

async function installFixture(configDir: string, fixtureRoot: string, extraOptions: Record<string, unknown> = {}) {
  return installerModule.install({ configDir, rootDir: fixtureRoot, ...extraOptions });
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

function runningAsRoot(): boolean {
  const getuid = (process as unknown as { getuid?: () => number }).getuid;
  return typeof getuid === "function" && getuid() === 0;
}

// ---------------------------------------------------------------------------
// Source-level contract checks (regression evidence).
// ---------------------------------------------------------------------------

describe("global installer contract", () => {
  it("does not treat old legacy role names as managed agents", () => {
    const managedAgentBlock = installScript.match(
      /const OUR_ROLE_NAMES = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1] ?? "";

    expect(managedAgentBlock).not.toContain('"review"');
    expect(managedAgentBlock).not.toContain('"power-plan-builder"');
    expect(managedAgentBlock).toContain('"plan-review"');
    expect(managedAgentBlock).toContain('"result-review"');
  });

  it("removes old managed command names during config merge", () => {
    expect(installScript).toContain("const MANAGED_COMMAND_NAMES = new Set");
    expect(installScript).toContain('"agent-models"');
    expect(installScript).toContain('"go"');
    expect(installScript).toContain('"study"');
    expect(installScript).toContain('"update-lite"');
    expect(installScript).toContain('"Character-model"');
    expect(installScript).toContain("!MANAGED_COMMAND_NAMES.has(commandName)");
  });

  it("injects install-scoped paths into the update-lite command", () => {
    expect(installScript).toContain("function buildUpdateLiteCommand(rootDir, configDir)");
    expect(installScript).toContain("function buildUpdateLiteInstallCommand(rootDir, configDir)");
    expect(installScript).toContain("function allowInstallScopedUpdateLite(config, context)");
    expect(installScript).toContain("__OH_MY_LITE_SOURCE_ROOT__");
    expect(installScript).toContain("__OH_MY_LITE_CONFIG_DIR__");
    expect(installScript).toContain("injectInstallScopedCommands(mergedConfig, context)");
  });

  it("tracks managed MCP names separately from user MCP servers", () => {
    expect(installScript).toContain("const MANAGED_MCP_NAMES = new Set");
    expect(installScript).toContain('"context7"');
    expect(installScript).toContain('"playwright"');
    expect(installScript).toContain(
      "function mergeMcpDialectAware(existingConfig, sourceConfig, managedMcp = true, isNativeTarget = false)",
    );
    expect(installScript).toContain("MANAGED_MCP_NAMES.has(serverName)");
    expect(installScript).toContain("--no-managed-mcp");
  });

  it("writes the target configDir into the managed plugin options", () => {
    expect(installScript).toContain("function relativePluginOptions(configDir, taskLeadProfiles)");
    expect(installScript).toContain("configDir,");
    expect(installScript).toContain(
      "upsertManagedPluginEntry(pluginContainers, managedSpec, relativePluginOptions(configDir, taskLeadProfiles), configDir)",
    );
  });

  it("keeps model provider source classification in the installer", () => {
    expect(installScript).toContain("function classifyModelProvider(provider)");
    expect(installScript).toContain('"opencode-subscription"');
    expect(installScript).toContain('"api-provider"');
    expect(installScript).toContain('"gateway"');
    expect(installScript).not.toContain('["opencode", "opencode-go", "fish"]');
  });

  it("names built-in disabled overrides separately from real roles", () => {
    expect(installScript).toContain("const BUILTIN_AGENT_OVERRIDES = new Set");
    expect(installScript).toContain("const OUR_ROLE_NAMES = new Set");
    expect(installScript).toContain("new Set([...BUILTIN_AGENT_OVERRIDES, ...OUR_ROLE_NAMES])");
  });

  it("keeps the installer JSONC parser synchronized with the runtime JSONC helper", () => {
    expect(installScript).toContain("keep in sync with .opencode/lib/runtime/jsonc.ts");
    expect(installScript).toContain("function stripJsonComments(content)");
    expect(installScript).toContain("function stripTrailingCommas(content)");
    expect(installScript).toContain("function parseJsonConfig(content)");
  });

  it("keeps install flow split into named steps", () => {
    expect(installScript).toContain("async function prepareInstallContext(options)");
    expect(installScript).toContain("function mergeAll(context)");
    expect(installScript).toContain("async function runInteractiveSetup(liteConfig, context)");
    expect(installScript).toContain("async function writeOutputs(context, mergedConfig, liteConfig, journal)");
    expect(installScript).toContain("async function stageManagedRuntime(context)");
    expect(installScript).toContain("async function activateRuntimeNamespace(context, journal)");
    expect(installScript).toContain("async function disableLegacyManagedEntrypoint(context, journal)");
  });
});

// ---------------------------------------------------------------------------
// C06 managed runtime delivery: functional behavior (offline, stubbed npm).
// ---------------------------------------------------------------------------

describe("C06 managed runtime delivery", () => {
  it("first install builds the verified directory runtime with locked deps before switching config", async () => {
    const base = makeTempDir("omo-lite-runtime-first-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const { runner, calls } = createStubDependencyRunner();

    try {
      const result = await installFixture(configDir, fixtureRoot, { dependencyRunner: runner });

      const runtimeDirAbs = path.resolve(result.runtimeDir);
      for (const required of ["server.ts", "package.json", "package-lock.json", "agents", "plugins", "lib"]) {
        expect(existsSync(path.join(runtimeDirAbs, required)), `${required} in runtime`).toBe(true);
      }
      expect(result.report?.dependenciesInstalled).toBe(true);
      expect(calls).toHaveLength(1);

      // npm launch contract (decision 10 / PR-01): process.execPath + argument
      // array + shell:false, locked npm ci --ignore-scripts in the staging dir.
      const call = calls[0] as { file: unknown; args: unknown; cwd: string; shell: unknown };
      expect(call.file).toBe(process.execPath);
      expect(call.shell).toBe(false);
      expect(call.args).toEqual([
        expect.stringContaining("npm-cli.js"),
        "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ]);
      expect(call.cwd).toContain(".opencode/oh-my-lite-openagent.omlo-staging");
      // Staged → activated: staging moved into place, no leftovers.
      expect(existsSync(call.cwd)).toBe(false);
      expect(existsSync(path.join(runtimeDirAbs, "node_modules/@opencode-ai/plugin/package.json"))).toBe(true);
      expect(existsSync(path.join(runtimeDirAbs, "node_modules/zod/package.json"))).toBe(true);

      // Configured source is the DIRECTORY, not a .ts file path (decision 9).
      const config = await readJson(result.configPath);
      const pluginEntries = ([config.plugin].flat() ?? []) as unknown[];
      const managedEntries = pluginEntries.filter(
        (item) => Array.isArray(item) && String((item as unknown[])[0]).includes("oh-my-lite-openagent"),
      ) as unknown[][];
      expect(managedEntries).toHaveLength(1);
      expect(managedEntries[0]![0]).toBe(runtimeDirAbs);
      expect((managedEntries[0]![1] as Record<string, unknown>).configDir).toBe(configDir);
      expect(JSON.stringify(config)).not.toContain("bounded-lite.ts");

      // Active generated agents stay at <config-dir>/agents (decision 9).
      expect(existsSync(path.join(configDir, "agents", "command-lead.md"))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("dependency-stage failure keeps prior config/integrations and reports the locked error", async () => {
    const base = makeTempDir("omo-lite-runtime-depfail-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify({ provider: { sentinel: { key: "keep" } } }, null, 2)}\n`,
    );
    const failingRunner = async () => ({ status: 1, stderr: "npm error (stubbed failure)" });

    try {
      await expect(installFixture(configDir, fixtureRoot, { dependencyRunner: failingRunner }))
        .rejects.toThrow(/Locked dependency install failed/);

      expect(existsSync(path.join(configDir, "oh-my-lite-openagent.json"))).toBe(false);
      // Nothing switched: no runtime namespace, no runtime backup, config unchanged.
      expect(existsSync(path.join(configDir, ".opencode/oh-my-lite-openagent"))).toBe(false);
      expect(existsSync(path.join(configDir, ".opencode/oh-my-lite-openagent.omlo-backup"))).toBe(false);
      expect(await readFile(path.join(configDir, "opencode.json"), "utf8")).toContain("sentinel");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("repeated install stays idempotent: one managed source, prior runtime backed up", async () => {
    const base = makeTempDir("omo-lite-runtime-repeat-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const { runner: runner1 } = createStubDependencyRunner();
    const { runner: runner2 } = createStubDependencyRunner();

    try {
      const first = await installFixture(configDir, fixtureRoot, { dependencyRunner: runner1 });
      expect(existsSync(path.join(first.runtimeDir, "package.json"))).toBe(true);

      const second = await installFixture(configDir, fixtureRoot, { dependencyRunner: runner2 });
      expect(existsSync(path.join(second.runtimeDir, "package.json"))).toBe(true);

      const config = await readJson(second.configPath);
      const pluginEntries = ([config.plugin].flat() ?? []) as unknown[];
      const managedEntries = pluginEntries.filter(
        (item) => Array.isArray(item) && String((item as unknown[])[0]).includes("oh-my-lite-openagent"),
      );
      expect(managedEntries).toHaveLength(1);
      // Old runtime namespace was backed up, not destroyed.
      expect(existsSync(path.join(configDir, ".opencode", "oh-my-lite-openagent.omlo-backup", "package.json"))).toBe(true);
      expect(second.report?.runtimeNamespaceExisted).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("upgrades from the old managed spec and disables only the superseded copied entrypoint", async () => {
    const base = makeTempDir("omo-lite-runtime-upgrade-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    await mkdir(path.join(configDir, ".opencode", "plugins"), { recursive: true });
    const legacySpec = "./.opencode/plugins/bounded-lite.ts";
    await writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify({
        plugin: ["./user-custom.ts", [legacySpec, { mode: "full" }]],
        provider: { openai: {} },
      }, null, 2)}\n`,
    );
    await writeFile(path.join(configDir, ".opencode", "plugins", "bounded-lite.ts"), "old-copy\n");
    const { runner } = createStubDependencyRunner();

    try {
      const result = await installFixture(configDir, fixtureRoot, { dependencyRunner: runner });

      // Exactly one active managed source: the runtime directory.
      const config = await readJson(result.configPath);
      const pluginEntries = ([config.plugin].flat() ?? []) as unknown[];
      expect(pluginEntries).toContain("./user-custom.ts");
      const managedEntries = pluginEntries.filter(
        (item) => Array.isArray(item) && String((item as unknown[])[0]).includes("oh-my-lite-openagent"),
      );
      expect(managedEntries).toHaveLength(1);
      expect(pluginEntries.filter((item) => Array.isArray(item) && (item as unknown[])[0] === legacySpec)).toHaveLength(0);

      // Old tree left inert: the known managed entrypoint was backed up and
      // disabled (renamed), nothing user-owned was deleted.
      const disabledPath = path.join(configDir, ".opencode", "plugins", "bounded-lite.ts.omlo-disabled");
      expect(existsSync(disabledPath)).toBe(true);
      expect(existsSync(path.join(configDir, ".opencode", "plugins", "bounded-lite.ts"))).toBe(false);
      expect(await readFile(`${disabledPath.slice(0, -".omlo-disabled".length)}.bak`, "utf8")).toContain("old-copy");
      expect(result.report?.disabledLegacyEntrypoint).toBeTruthy();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("preserves third-party native plugin order/options and effective managed native options", async () => {
    const base = makeTempDir("omo-lite-runtime-native-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const runtimeSpec = path.join(configDir, ".opencode", "oh-my-lite-openagent");
    await writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify({
        plugins: [
          "./third-party.ts",
          { package: runtimeSpec, options: { mode: "full", configDir, taskLeadProfiles: { code: { model: "a/b" } } } },
        ],
        providers: { openai: {} },
      }, null, 2)}\n`,
    );
    const { runner } = createStubDependencyRunner();

    try {
      const result = await installFixture(configDir, fixtureRoot, { dependencyRunner: runner });
      const config = await readJson(result.configPath);
      const plugins = config.plugins as Array<Record<string, unknown> | string>;

      expect(plugins[0]).toBe("./third-party.ts");
      expect(plugins).toHaveLength(2);
      const managed = plugins[1] as Record<string, unknown>;
      expect(managed.package).toBe(runtimeSpec);
      expect((managed.options as Record<string, unknown>).configDir).toBe(configDir);
      expect(((managed.options as Record<string, unknown>).taskLeadProfiles as Record<string, unknown>).code).toEqual({ model: "a/b" });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("stops on a custom manifest collision inside the managed namespace and writes nothing", async () => {
    const base = makeTempDir("omo-lite-runtime-collision-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const runtimeDir = path.join(configDir, ".opencode", "oh-my-lite-openagent");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path.join(runtimeDir, "package.json"), `${JSON.stringify({ name: "user-custom-manifest", private: false }, null, 2)}\n`);
    const { runner } = createStubDependencyRunner();

    try {
      await expect(installFixture(configDir, fixtureRoot, { dependencyRunner: runner }))
        .rejects.toThrow(/custom manifest collision/);

      expect(existsSync(path.join(configDir, "opencode.json"))).toBe(false);
      expect(existsSync(path.join(runtimeDir, "server.ts"))).toBe(false);
      // The user manifest survived untouched.
      expect(await readFile(path.join(runtimeDir, "package.json"), "utf8")).toContain("user-custom-manifest");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("stops on unrecognized user files inside the managed namespace", async () => {
    const base = makeTempDir("omo-lite-runtime-unknown-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const runtimeDir = path.join(configDir, ".opencode", "oh-my-lite-openagent");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(path.join(runtimeDir, "user-notes.txt"), "mine\n");
    const { runner } = createStubDependencyRunner();

    try {
      await expect(installFixture(configDir, fixtureRoot, { dependencyRunner: runner }))
        .rejects.toThrow(/user-notes\.txt/);

      expect(await readFile(path.join(runtimeDir, "user-notes.txt"), "utf8")).toBe("mine\n");
      expect(existsSync(path.join(configDir, "opencode.json"))).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("dry run is fully side-effect-free: no dirs, caches, package files, or npm runs", async () => {
    const base = makeTempDir("omo-lite-runtime-dryrun-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "opencode.json"),
      `${JSON.stringify({ plugin: [{ package: "./user.ts", options: { keep: true } }, ["./.opencode/plugins/bounded-lite.ts", { mode: "full" }]] }, null, 2)}\n`,
    );
    // Legacy copied entrypoint from a pre-C06 install, so the dry-run plan also
    // reports the backup/disable step.
    await mkdir(path.join(configDir, ".opencode", "plugins"), { recursive: true });
    await writeFile(path.join(configDir, ".opencode", "plugins", "bounded-lite.ts"), "old tree\n");
    const snapshotBefore = snapshotPaths(configDir);
    const runnerCalls: unknown[] = [];
    const spyRunner = async () => {
      runnerCalls.push("called");
      throw new Error("dry run must never execute npm");
    };

    try {
      const result = await installFixture(configDir, fixtureRoot, {
        dependencyRunner: spyRunner,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(runnerCalls).toHaveLength(0);
      expect(snapshotPaths(configDir)).toEqual(snapshotBefore);
      const plan = result.report?.plan as string[];
      expect(plan).toEqual(expect.arrayContaining([
        expect.stringContaining("npm dependency command: ci --ignore-scripts"),
        expect.stringContaining("Swap staging into"),
        expect.stringContaining("Backup + write"),
      ]));
      expect(plan.join("\n")).toContain("Legacy copied entrypoint");
      expect(result.report?.dependenciesInstalled).toBe(false);
      // No npm cache dir was created anywhere.
      expect(existsSync(path.join(configDir, ".opencode", "oh-my-lite-openagent.omlo-npm-cache"))).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("permission failure during activation rolls back config bytes and restores the prior runtime", async () => {
    if (runningAsRoot()) {
      console.log("skip POSIX permission-failure rollback (running as root)");
      return;
    }
    const base = makeTempDir("omo-lite-runtime-rollback-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const { runner: runner1 } = createStubDependencyRunner();
    await installFixture(configDir, fixtureRoot, { dependencyRunner: runner1 });

    // Mark the working runtime with a probe, then break the next activation
    // where the config write happens: make the config dir unwritable so the
    // backup step fails after the runtime swap.
    const runtimeDir = path.join(configDir, ".opencode", "oh-my-lite-openagent");
    await writeFile(path.join(runtimeDir, "prior-runtime-marker.txt"), "prior\n");
    const configBefore = await readFile(path.join(configDir, "opencode.json"), "utf8");
    const { runner: runner2 } = createStubDependencyRunner();
    await chmod(configDir, 0o555);

    try {
      await expect(installFixture(configDir, fixtureRoot, { dependencyRunner: runner2 }))
        .rejects.toThrow();

      expect(await readFile(path.join(configDir, "opencode.json"), "utf8")).toBe(configBefore);
      // Prior runtime restored exactly, marker intact.
      expect(existsSync(path.join(runtimeDir, "prior-runtime-marker.txt"))).toBe(true);
    } finally {
      await chmod(configDir, 0o755);
      await rm(base, { recursive: true, force: true });
    }
  });

  it("fails over an unreadable/unwritable agents dir and keeps the previous config active (permission failure + rollback)", async () => {
    if (runningAsRoot()) {
      console.log("skip POSIX permission-failure rollback (running as root)");
      return;
    }
    const base = makeTempDir("omo-lite-runtime-perm-");
    const fixtureRoot = buildFixtureSourceRoot(base);
    const configDir = path.join(base, "target");
    await mkdir(configDir, { recursive: true });
    const priorConfig = JSON.stringify({ provider: { priorOnly: {} } }, null, 2);
    await writeFile(path.join(configDir, "opencode.json"), `${priorConfig}\n`);
    await mkdir(path.join(configDir, "agents"), { recursive: true });
    await writeFile(path.join(configDir, "agents", "command-lead.md"), "prior agent\n");
    const { runner } = createStubDependencyRunner();
    await chmod(path.join(configDir, "agents"), 0o555);

    try {
      await expect(installFixture(configDir, fixtureRoot, { dependencyRunner: runner })).rejects.toThrow();

      // Rollback: restored prior config bytes (not partially merged output).
      expect(await readFile(path.join(configDir, "opencode.json"), "utf8")).toBe(`${priorConfig}\n`);
      expect(await readFile(path.join(configDir, "agents", "command-lead.md"), "utf8")).toBe("prior agent\n");
    } finally {
      await chmod(path.join(configDir, "agents"), 0o755);
      await rm(base, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// npm JS-CLI launch helper: real process execution (execFile via
// process.execPath), argument fidelity in hostile paths, no injection,
// failure propagation, and Windows argv-shape coverage without npm.cmd.
// ---------------------------------------------------------------------------

describe("npm JS-CLI launch helper", () => {
  const fixtureCli = path.resolve(process.cwd(), "tests/fixtures/install/safe-echo-cli.js");

  it("launches a valid JS CLI through process.execPath with exact argv in hostile paths", async () => {
    const hostileDir = path.join(os.tmpdir(), "space dir with `metachars`; $(maybe) & piple|");
    await mkdir(hostileDir, { recursive: true });
    const hostileCli = path.join(hostileDir, "safe-echo-cli.js");
    copyFileSync(fixtureCli, hostileCli);

    try {
      const maliciousArg = `x && touch ${path.join(hostileDir, "injected")} ; rm -rf would-be-shell`;
      const result = await execFileAsync(
        process.execPath,
        [hostileCli, maliciousArg, "$HOME", "`pwd` 2>/dev/null", "--", "final; & `arg`"],
        { shell: false, cwd: hostileDir, encoding: "utf8" },
      );

      const parsed = JSON.parse(result.stdout.trim()) as { argv: string[] };
      expect(parsed.argv).toEqual([
        maliciousArg,
        "$HOME",
        "`pwd` 2>/dev/null",
        "--",
        "final; & `arg`",
      ]);
      // No shell interpolation happened: the crafted touch target never exists.
      expect(existsSync(path.join(hostileDir, "injected"))).toBe(false);
    } finally {
      await rm(hostileDir, { recursive: true, force: true });
    }
  });

  it("propagates nonzero exits and errors from the launched CLI", async () => {
    await expect(execFileAsync(
      process.execPath,
      [fixtureCli, "--exit-code-1"],
      { shell: false, encoding: "utf8" },
    )).rejects.toMatchObject({ code: 1 });

    // A missing CLI file must surface as a launch error (never a shell fallback).
    // Node versions differ in surfacing spawn ENOENT (code "ENOENT" vs exit 1).
    const missingCli = path.join(os.tmpdir(), "does-not-exist-cli.js");
    await expect(execFileAsync(process.execPath, [missingCli], { shell: false, encoding: "utf8" }))
      .rejects.toThrow(/ENOENT|Command failed/);
  });

  it("resolves a real npm JavaScript CLI and never a .cmd/npm shim", async () => {
    const win32 = process.platform === "win32";
    const fakeExecPath = win32 ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/bin/node";
    const prefixCliJs = win32
      ? "C:\\Program Files\\lib\\node_modules\\npm\\bin\\npm-cli.js"
      : "/usr/lib/node_modules/npm/bin/npm-cli.js";

    const existsPaths = new Set<string>([prefixCliJs]);
    const fileExists = async (filePath: string) => existsPaths.has(filePath);

    // (a) npm_execpath is trusted ONLY when it ends in npm-cli.js and exists.
    const envCmd = { npm_execpath: win32 ? "C:\\Users\\u\\npm\\npm.cmd" : "/opt/npm/npm.cmd" };
    expect(await installerModule.resolveNpmCli(fakeExecPath, envCmd, fileExists)).toEqual({ file: prefixCliJs, source: "node-prefix" });
    const envJsNotOnDisk = { npm_execpath: "/tmp/path-missingnpm-cli.js" };
    expect(await installerModule.resolveNpmCli(fakeExecPath, envJsNotOnDisk, fileExists)).toEqual({ file: prefixCliJs, source: "node-prefix" });
    existsPaths.add(win32 ? "C:\\prefix\\npm\\bin\\npm-cli.js" : "/opt/npm/bin/npm-cli.js");
    const envJsOnDisk = { npm_execpath: win32 ? "C:\\prefix\\npm\\bin\\npm-cli.js" : "/opt/npm/bin/npm-cli.js" };
    expect(await installerModule.resolveNpmCli(fakeExecPath, envJsOnDisk, fileExists)).toEqual({
      file: envJsOnDisk.npm_execpath!,
      source: "npm_execpath",
    });

    // (b) Nothing resolvable → clear failure, no arbitrary shell fallback.
    expect(await installerModule.resolveNpmCli(fakeExecPath, {}, async () => false)).toBeNull();

    // (c) Executable plan shape: process.execPath + argv array + shell:false;
    // npm.cmd is impossible as args[0] because resolution rejects non-.js.
    const plan = installerModule.buildNpmCiPlan(
      fakeExecPath,
      "C:\\prefix\\npm\\bin\\npm-cli.js",
      "C:\\Users\\space user\\.opencode\\unused",
    );
    expect(plan.file).toBe(fakeExecPath);
    expect(plan.args[0]).toBe("C:\\prefix\\npm\\bin\\npm-cli.js");
    expect(plan.args[0]).not.toMatch(/\.cmd$/i);
    expect(plan.args[1]).toBe("ci");
    expect(plan.shell).toBe(false);
    expect(String(plan.cwd)).toContain("space user");
  });

  it("runs the real execFile launcher end-to-end against the fixture CLI (no shell, exact env pass-through)", async () => {
    const result = await installerModule.defaultDependencyRunner({
      file: process.execPath,
      args: [fixtureCli, "plain-value"],
      cwd: os.tmpdir(),
      env: { ...process.env },
    });
    expect(result.status).toBe(0);
  });
});
