import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DOC = readFileSync(path.join(ROOT, "docs/opencode-compatibility.md"), "utf8");
const FIXTURE = JSON.parse(
  readFileSync(path.join(ROOT, "tests/fixtures/plans/structured-plan.json"), "utf8"),
) as Record<string, unknown>;

describe("compatibility documentation parity (C08)", () => {
  it("embeds the executable shared fixture as the labeled JSON validation object", () => {
    const block = DOC.match(/```json plan-payload\s*\n([\s\S]*?)```/);

    expect(block).toBeTruthy();
    const payload = JSON.parse(block![1]!);

    // Drift lock: docs example and executable tests/fixtures must stay the same
    // object (including review/open_questions/self_check, not subtasks only).
    expect(payload).toEqual(FIXTURE);
    expect(FIXTURE).toHaveProperty("plan_review");
    expect(FIXTURE).toHaveProperty("open_questions");
    expect(FIXTURE).toHaveProperty("self_check");
  });

  it("states the supported host and Node boundaries without inventing claims", () => {
    expect(DOC).toContain("1.18.29");
    expect(DOC).toContain("1.19.1");
    expect(DOC).toContain("2.0.30");
    expect(DOC).toContain("20.19.0");
    expect(DOC).toContain("v1.18.29, v1.19.1, and v2.0.30");
    expect(DOC).toContain("npm view oh-my-lite-openagent version");
    // Product v2 vs v1 SDK /v2 subpaths stay clearly distinguished.
    expect(DOC).toContain("@opencode/cli");
    expect(DOC).toContain("@opencode-ai/plugin/v2/effect");
  });

  it("documents restart, install boundaries, and recovery against real installer behavior", () => {
    expect(DOC).toContain("v1: exit and relaunch the `opencode` process");
    expect(DOC).toContain("v2: restart the OpenCode service/plugin runtime");
    expect(DOC).toContain("Starting a new conversation is not enough");
    expect(DOC).toContain("native-v2 format must not be reused by a v1 host");
    expect(DOC).toContain("<configDir>/.opencode/oh-my-lite-openagent/");
    expect(DOC).toContain("npm ci --ignore-scripts");
    expect(DOC).toContain("no global user-manifest changes");
    expect(DOC).toContain("no arbitrary version fallback");
    expect(DOC).toContain("hostSessionDepthBlocker");
    expect(DOC).toContain("never `JSON.parse` string input");
  });

  it("keeps AGENTS.md installer boundary aligned with the managed runtime namespace", () => {
    expect(readFileSync(path.join(ROOT, "AGENTS.md"), "utf8")).toContain(
      "dedicated managed runtime namespace `<config-dir>/.opencode/oh-my-lite-openagent/` (the `server.ts` shim with its own package manifest/lock and installed dependencies)",
    );
  });

  it("keeps README and AI-INSTALL restart instructions aligned", () => {
    for (const file of ["README.md", "AI-INSTALL.md"]) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      expect(text, file).toContain("<configDir>/.opencode/oh-my-lite-openagent/");
      expect(text, file).toContain("v1, exit and relaunch the `opencode` process");
      expect(text, file).toContain("v2, restart the OpenCode service/plugin runtime");
    }
  });
});
