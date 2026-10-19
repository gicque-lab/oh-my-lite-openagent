import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  PLAN_ARTIFACT_DIR,
  PLAN_INDEX_FILE,
  sanitizeSlug,
  writePlanArtifact,
} from "../../.opencode/lib/runtime/plan-artifact.js";
import { assertPlanArtifactWriteArgs } from "../../.opencode/lib/runtime/tool-contracts.js";

describe("plan artifact persistence", () => {
  it("writes plans under .liteagent/plans and appends the index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liteagent-plan-"));
    const result = await writePlanArtifact({
      projectRoot: root,
      title: "Router Threshold Fix",
      markdown: "---\nplan_schema_version: 2.1\n---\n\n# Plan\n",
      now: new Date("2026-04-25T01:02:03.000Z"),
      artifactKind: "detailed-plan",
      maturityLevel: "M2",
      generatedBy: "deep-plan-builder",
    });

    expect(result.relativePath).toBe(`${PLAN_ARTIFACT_DIR}/2026-04-25-router-threshold-fix.md`);
    expect(await readFile(path.join(root, result.relativePath), "utf8")).toContain("plan_schema_version: 2.1");

    const index = await readFile(path.join(root, PLAN_INDEX_FILE), "utf8");
    expect(index).toContain('"artifact_kind":"detailed-plan"');
    expect(index).toContain('"generated_by":"deep-plan-builder"');
  });

  it("rejects requested paths outside .liteagent/plans", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liteagent-plan-"));

    await expect(writePlanArtifact({
      projectRoot: root,
      title: "Bad Path",
      markdown: "# Plan",
      requestedPath: "../bad.md",
    })).rejects.toThrow(/cannot traverse|must start/);
  });

  it("normalizes non-ascii or unsafe slugs to a safe fallback", () => {
    expect(sanitizeSlug("修复 模型导入!")).toBe("plan");
    expect(sanitizeSlug("Agent Models Import Fix")).toBe("agent-models-import-fix");
  });
});

describe("plan artifact write guard", () => {
  it("keeps markdown and content aliases accepted and resolves markdown first", () => {
    expect(assertPlanArtifactWriteArgs({ title: "T", markdown: "# m" })).toEqual({ title: "T", markdown: "# m" });
    expect(assertPlanArtifactWriteArgs({ title: "T", content: "# c" })).toEqual({ title: "T", markdown: "# c" });
    expect(assertPlanArtifactWriteArgs({ title: "T", markdown: "# m", content: "# c" }))
      .toEqual({ title: "T", markdown: "# m" });
  });

  it("fails title-only input with the documented cross-field rule before any write", () => {
    expect(() => assertPlanArtifactWriteArgs({ title: "T" }))
      .toThrow(/provide "markdown" or its alias "content".*before any file write/s);
    expect(() => assertPlanArtifactWriteArgs({ title: "T", markdown: 42, content: undefined }))
      .toThrow(/document text/);
    expect(() => assertPlanArtifactWriteArgs({ title: "T", markdown: "   " }))
      .toThrow(/document text/);
  });

  it("gives specific diagnostics for title, action and enum errors", () => {
    expect(() => assertPlanArtifactWriteArgs({ markdown: "# m" }))
      .toThrow(/non-empty string "title"/);
    expect(() => assertPlanArtifactWriteArgs({ title: 42, markdown: "# m" }))
      .toThrow(/non-empty string "title".*received number/s);
    expect(() => assertPlanArtifactWriteArgs({ title: "T", markdown: "# m", action: "delete" }))
      .toThrow(/action must be "write".*"delete"/s);
    expect(() => assertPlanArtifactWriteArgs({ title: "T", markdown: "# m", artifactKind: "memo" }))
      .toThrow(/"artifactKind" must be one of "plan-skeleton" \| "detailed-plan".*"memo"/s);
    expect(() => assertPlanArtifactWriteArgs({ title: "T", markdown: "# m", status: "published" }))
      .toThrow(/"status" must be one of "draft" \| "reviewed" \| "blocked".*"published"/s);
  });

  it("keeps the guard pure: it performs no filesystem or config work", () => {
    // Calling the guard without a project root or config must not throw for
    // valid input — it never touches I/O; writes happen in writePlanArtifact.
    expect(() => assertPlanArtifactWriteArgs({ title: "Pure", content: "# ok" })).not.toThrow();
  });
});
