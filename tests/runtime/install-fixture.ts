import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Build a hermetic fixture source root for installer tests: the real managed
 * trees (agents/plugins/lib with relative imports preserved) plus the C06
 * runtime inputs. .opencode/server.ts is the C05 deliverable and is referenced
 * by path only — the fixture writes a local shim copy inside this fixture root
 * so installer tests stay runnable before, during and after the C05
 * integration, without ever creating .opencode/server.ts in the real repo.
 */
export function buildFixtureSourceRoot(baseDir: string): string {
  const root = path.join(baseDir, "omlo-source-root");
  mkdirSync(root, { recursive: true });
  const sourceOpenCode = path.join(root, ".opencode");
  for (const managedDir of ["agents", "plugins", "lib"]) {
    cpSync(path.resolve(process.cwd(), ".opencode", managedDir), path.join(sourceOpenCode, managedDir), { recursive: true });
  }
  // Fixture shim inside the fixture root only.
  writeFileSync(path.join(sourceOpenCode, "server.ts"), 'export { default } from "./plugins/bounded-lite.ts";\n');
  // Manifest/lock are byte-copies of the real managed runtime inputs (packaged
  // under the runtime-* names because npm pack drops nested package.json).
  for (const manifestFile of ["runtime-package.json", "runtime-package-lock.json"]) {
    const realPath = path.resolve(process.cwd(), ".opencode", manifestFile);
    writeFileSync(path.join(sourceOpenCode, manifestFile), readFileSync(realPath));
  }
  mkdirSync(path.join(baseDir, "omlo-target"), { recursive: true });
  return root;
}

/**
 * Offline dependency runner: creates the node_modules skeleton a real
 * `npm ci --ignore-scripts` produces (node_modules/<dep>/package.json) and
 * records each execFile plan call. Never touches the network.
 */
export function createStubDependencyRunner() {
  const calls: Array<{ file: unknown; args: unknown; cwd: unknown; shell: unknown }> = [];
  const runner = async (plan: { file: string; args: string[]; cwd: string; shell: boolean }) => {
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    calls.push({ file: plan.file, args: plan.args, cwd: plan.cwd, shell: plan.shell });
    const manifest = JSON.parse(await readFile(path.join(plan.cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const modDir = path.join(plan.cwd, "node_modules", ...name.split("/"));
      await mkdir(modDir, { recursive: true });
      await writeFile(path.join(modDir, "package.json"), `${JSON.stringify({ name, version: "stub-1.0.0" }, null, 2)}\n`);
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

/** Recursive path snapshot relative to dir (paths only, sorted). */
export function snapshotPaths(dir: string): string[] {
  const walk = (absoluteDir: string, relativePrefix: string): string[] => {
    const output: string[] = [];
    for (const entry of readdirSync(absoluteDir)) {
      const relativePath = relativePrefix ? `${relativePrefix}/${entry}` : entry;
      output.push(relativePath);
      if (statSync(path.join(absoluteDir, entry)).isDirectory()) {
        output.push(...walk(path.join(absoluteDir, entry), relativePath));
      }
    }
    return output;
  };
  return walk(dir, "").sort();
}

export async function installViaModule(configDir: string, fixtureRoot: string, options: Record<string, unknown> = {}) {
  const { pathToFileURL } = await import("node:url");
  const module = (await import(pathToFileURL(path.resolve(process.cwd(), "scripts/install.mjs")).href)) as {
    install: (options?: Record<string, unknown>) => Promise<{
      configDir: string;
      configPath: string;
      liteConfigPath: string;
      runtimeDir: string;
      plugin: string;
      report: Record<string, unknown>;
      dryRun: boolean;
    }>;
    installScriptSource?: string;
  };
  const result = await module.install({ configDir, rootDir: fixtureRoot, ...options });
  return result;
}
