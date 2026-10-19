import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePlanReadiness } from "../../.opencode/lib/runtime/plan-readiness.js";

const PLAN_FIXTURES_DIR = fileURLToPath(new URL("../fixtures/plans/", import.meta.url));

async function loadStructuredPlanFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(PLAN_FIXTURES_DIR, "structured-plan.json"), "utf8"));
}

const executablePlan = {
  plan_schema_version: "2.1",
  maturity_level: "M3",
  status: "reviewed",
  goals: ["[User Confirmed] ship the bounded change"],
  scope_boundaries: ["[User Confirmed] only runtime plan validation"],
  acceptance_criteria: ["[User Confirmed] readiness validator accepts the plan"],
  phase_plan: [
    {
      Goal: ["[User Confirmed] validate before execution"],
      Acceptance: ["[User Confirmed] bad plans are rejected"],
    },
  ],
  open_questions: [],
  plan: {
    subtasks: [
      {
        id: "validate",
        depends_on: [],
        attributes: ["code"],
        deliverable: "Plan readiness result",
        description: "Validate the plan payload before dispatch",
      },
    ],
  },
};

describe("plan readiness validation", () => {
  it("accepts M3 plans with required sections and a valid task DAG", () => {
    const result = validatePlanReadiness(executablePlan);

    expect(result.executable).toBe(true);
    expect(result.decision).toBe("execute");
    expect(result.dag?.waves).toEqual([["validate"]]);
  });

  it("rejects M2 plans when open questions block the current phase", () => {
    const result = validatePlanReadiness({
      ...executablePlan,
      maturity_level: "M2",
      status: "draft",
      open_questions: [
        {
          question: "[Open Question] Which compatibility policy applies?",
          blocks_current_phase: true,
        },
      ],
    });

    expect(result.executable).toBe(false);
    expect(result.decision).toBe("revise");
    expect(result.errors).toContain("M2 plan has open_questions that block the current phase.");
  });

  it("rejects blocked or underspecified plans before Task Lead dispatch", () => {
    const result = validatePlanReadiness({
      ...executablePlan,
      status: "blocked",
      acceptance_criteria: [],
    });

    expect(result.executable).toBe(false);
    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("blocked plans are not executable.");
    expect(result.errors).toContain("acceptance_criteria must be present and non-empty before execution.");
  });

  it("rejects invalid DAG payloads through the same gate", () => {
    const result = validatePlanReadiness({
      ...executablePlan,
      plan: {
        subtasks: [
          {
            id: "execute",
            depends_on: ["missing"],
            attributes: ["code"],
            deliverable: "Patch",
            description: "Execute a missing dependency",
          },
        ],
      },
    });

    expect(result.executable).toBe(false);
    expect(result.errors.some((error) => error.includes("unknown subtask missing"))).toBe(true);
  });
});

describe("plan readiness input formats", () => {
  it("accepts the documented structured fixture end to end", async () => {
    const result = validatePlanReadiness(await loadStructuredPlanFixture());

    expect(result.executable).toBe(true);
    expect(result.decision).toBe("execute");
    expect(result.maturityLevel).toBe("M3");
    expect(result.status).toBe("reviewed");
    expect(result.dag?.waves).toEqual([["C01"], ["C02"], ["C03"]]);
  });

  it("extracts the labeled JSON block from the human Markdown plan and validates it", async () => {
    const markdown = await readFile(path.join(PLAN_FIXTURES_DIR, "human-plan.md"), "utf8");
    const block = markdown.match(/```json plan-payload\s*\n([\s\S]*?)```/);

    expect(block).toBeTruthy();
    const payload = JSON.parse(block![1]!);
    const result = validatePlanReadiness(payload);

    expect(result.executable).toBe(true);
    expect(result.decision).toBe("execute");
    expect(result.dag?.waves).toEqual([["C01"], ["C02"], ["C03"]]);
  });

  it("rejects each non-object payload format once with one actionable diagnostic", async () => {
    const structured = await loadStructuredPlanFixture();
    const cases: Array<[unknown, RegExp]> = [
      [undefined, /Missing `payload`/],
      [null, /`payload` is null/],
      [[structured], /must be a single structured object, not an array/],
      ["# Plan\n\nraw markdown body", /raw Markdown document/],
      [JSON.stringify(structured), /JSON-encoded string/],
      [42, /received number/],
    ];

    for (const [badInput, pattern] of cases) {
      const result = validatePlanReadiness(badInput);

      expect(result.executable).toBe(false);
      expect(result.decision).toBe("revise");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(pattern);
      // Every diagnostic ends with the explicit expected named-payload example.
      expect(result.errors[0]).toContain('{"payload":{"plan":{"subtasks"');
      expect(result.warnings).toEqual([]);
    }
  });

  it("rejects raw markdown with one format explanation instead of a misleading section cascade", async () => {
    const result = validatePlanReadiness(
      "---\nplan_schema_version: 2.1\nmaturity_level: M3\nstatus: reviewed\n---\n\n# Plan\n\n## Goals\n",
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/raw Markdown document/);
    expect(result.errors[0]).not.toContain("must be present and non-empty");
  });

  it("never JSON.parses double-encoded string input", async () => {
    const structured = await loadStructuredPlanFixture();
    const result = validatePlanReadiness(JSON.stringify(structured));

    expect(result.executable).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/double-encoded/);
    // A fixture-content marker proves the encoded plan body was never parsed
    // into the validation flow (the static example never contains it).
    expect(result.errors[0]).not.toContain("User Confirmed");
  });

  it("preserves nested frontmatter/sections forms and extension metadata for direct callers", () => {
    const result = validatePlanReadiness({
      frontmatter: {
        plan_schema_version: "2.1",
        maturity_level: "M3",
        status: "reviewed",
      },
      sections: {
        goals: ["[User Confirmed] nested goal"],
        scope_boundaries: { in: ["[User Confirmed] nested scope"], out: ["[Out of Scope] other"] },
        acceptance_criteria: ["[User Confirmed] nested criteria"],
        phase_plan: [{ Goal: ["[User Confirmed] nested goal"], Acceptance: ["[User Confirmed] nested check"] }],
      },
      extension_metadata: { tag: "kept" },
      plan: {
        subtasks: [
          {
            id: "nested",
            depends_on: [],
            attributes: ["code"],
            deliverable: "Nested compatibility proof",
            description: "Validate nested frontmatter/sections forms",
          },
        ],
      },
    });

    expect(result.executable).toBe(true);
    expect(result.decision).toBe("execute");
    expect(result.maturityLevel).toBe("M3");
    expect(result.status).toBe("reviewed");
    expect(result.dag?.waves).toEqual([["nested"]]);
  });

  it("keeps adversarial blockers intact for direct runtime callers instead of stripping them", async () => {
    const payload = await loadStructuredPlanFixture();
    payload["maturity_level"] = "M2";
    payload["status"] = "draft";
    payload["open_questions"] = [{ question: "[Open Question] Ship now?", blocks_current_phase: true }];
    payload["plan_review"] = {
      decision: "revise",
      findings: [{ location: "plan", issue: "gap", severity: "major", resolved: false }],
    };
    payload["self_check"] = { passed: false, blocked: true };
    (payload["plan"] as { subtasks: unknown[] }).subtasks = [
      { id: "a", depends_on: ["ghost"], attributes: [], deliverable: "a", description: "a" },
      { id: "a", depends_on: ["b"], attributes: [], deliverable: "dup", description: "dup" },
      { id: "b", depends_on: ["a"], attributes: [], deliverable: "b", description: "b" },
    ];

    const result = validatePlanReadiness(payload);

    expect(result.executable).toBe(false);
    const errors = result.errors.join("\n");
    expect(errors).toContain("unresolved major Plan Review finding");
    expect(errors).toContain("open_questions that block the current phase");
    expect(errors).toContain("self-check reports a blocker");
    expect(errors).toContain("depends on unknown subtask ghost");
    expect(errors).toContain("duplicates a");
    expect(errors).toContain("cycle");
    // Safety-bearing fields were not stripped during normalization.
    expect(payload["open_questions"]).toEqual([{ question: "[Open Question] Ship now?", blocks_current_phase: true }]);
    expect(payload["plan_review"]).toMatchObject({ decision: "revise" });
    expect(payload["self_check"]).toMatchObject({ blocked: true });
  });
});
