// Failing dependency-runner injection (offline failure-mode tests): reports an
// npm ci failure without any side effects. Selected via
// OH_MY_LITE_TEST_DEPENDENCY_RUNNER. Test scaffolding only.
export default async function failingDependencyRunner() {
  return { status: 1, stdout: "", stderr: "npm error (stubbed failure): EACCES in offline simulation" };
}
