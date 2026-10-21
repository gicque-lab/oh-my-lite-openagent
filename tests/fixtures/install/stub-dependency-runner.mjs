// Offline dependency-runner injection for installer tests (npm test stays
// offline). Selected via OH_MY_LITE_TEST_DEPENDENCY_RUNNER; creates the
// node_modules skeleton the real `npm ci --ignore-scripts` would produce and
// records the execFile plan it was called with into <cwd>/.dependency-runner-calls.json.
// Test scaffolding only — never used by real installs.
export default async function stubDependencyRunner(plan) {
  const { mkdir, readFile, writeFile, appendFile } = await import("node:fs/promises");
  await mkdir(plan.cwd, { recursive: true });
  const manifest = JSON.parse(await readFile(`${plan.cwd}/package.json`, "utf8"));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const modDir = `${plan.cwd}/node_modules/${name.split("/").join("/")}`;
    await mkdir(modDir, { recursive: true });
    await writeFile(`${modDir}/package.json`, `${JSON.stringify({ name, version: "stub-1.0.0", main: "index.js" }, null, 2)}\n`);
  }
  await appendFile(`${plan.cwd}/.dependency-runner-calls.json`, `${JSON.stringify({
    file: plan.file,
    args: plan.args,
    cwd: plan.cwd,
    shell: plan.shell,
  })}\n`);
  return { status: 0, stdout: "", stderr: "" };
}
