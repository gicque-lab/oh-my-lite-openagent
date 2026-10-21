import os from "node:os";
import path from "node:path";

// Managed runtime namespace (C06, plan decision 9): a dedicated
// non-auto-discovered package directory holding server.ts, its own
// manifest/lock, copies of agents/plugins/lib, and installed runtime deps.
export const RUNTIME_DIR_NAME = "oh-my-lite-openagent";

export function runtimeNamespaceDir(configDir) {
  return path.join(configDir, ".opencode", RUNTIME_DIR_NAME);
}
export function runtimeStagingDir(configDir) {
  return `${runtimeNamespaceDir(configDir)}.omlo-staging`;
}
export function runtimeBackupDir(configDir) {
  return `${runtimeNamespaceDir(configDir)}.omlo-backup`;
}
// Private npm cache inside the managed .opencode namespace (risk table:
// "Private namespace/cache, pinned integrity lock, ignore-scripts").
export function runtimeNpmCacheDir(configDir) {
  return `${runtimeNamespaceDir(configDir)}.omlo-npm-cache`;
}

export function defaultConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "opencode");
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode");
}
