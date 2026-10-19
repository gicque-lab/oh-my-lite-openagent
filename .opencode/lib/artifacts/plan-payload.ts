import { z } from "zod";

/**
 * Single executable plan payload contract (wire + runtime).
 *
 * artifacts/schema.ts is the authoritative entrypoint and re-exports this module;
 * runtime/plan-dag.ts and runtime/plan-readiness.ts consume the same types here
 * instead of maintaining a second incompatible shape.
 *
 * The Zod schemas below are the provider-visible wire projection. Required
 * semantic fields (plan_schema_version, maturity_level, ...) and DAG correctness
 * stay runtime checks in plan-readiness.ts/plan-dag.ts so incomplete structured
 * plans yield useful revise results instead of losing review information here.
 * Everything except `plan.subtasks` stays unmodeled + passthrough so nested
 * frontmatter/sections forms, plan_review/review, open_questions, self_check and
 * extension metadata reach the runtime gates unstripped.
 */

export interface PlanSubtask {
  id: string;
  depends_on: string[];
  attributes: string[];
  deliverable: string;
  description: string;
}

export interface ExecutablePlanPayload {
  plan: {
    subtasks: PlanSubtask[];
  };
}

export const planSubtaskSchema: z.ZodType<PlanSubtask> = z
  .object({
    id: z.string().describe('Unique subtask id, e.g. "C02".'),
    depends_on: z.array(z.string()).describe("Ids of subtasks that must finish first (must stay acyclic)."),
    attributes: z.array(z.string()).describe('Task Lead profile attributes, e.g. ["code", "security"].'),
    deliverable: z.string().describe("Concrete deliverable produced by this subtask."),
    description: z.string().describe("One-sentence description of the subtask work."),
  })
  .passthrough();

export const executablePlanPayloadSchema: z.ZodType<ExecutablePlanPayload> = z
  .object({
    plan: z
      .object({
        subtasks: z
          .array(planSubtaskSchema)
          .describe(
            "Ordered, acyclic execution nodes. DAG-only callers may supply just plan.subtasks; readiness callers add frontmatter-style fields (plan_schema_version, maturity_level, status, goals, scope_boundaries, acceptance_criteria, phase_plan, plan_review/review, open_questions, self_check) which pass through unchanged to the runtime gates.",
          ),
      })
      .passthrough(),
  })
  .passthrough()
  .describe(
    'Structured plan payload object. Required: plan.subtasks. Extension metadata and nested frontmatter/sections forms are preserved (passthrough).',
  );

/** Exact minimal example of the expected named tool input (payload + optional dispatch). */
export const PLAN_TOOL_INPUT_EXAMPLE = JSON.stringify({
  payload: {
    plan: {
      subtasks: [
        {
          id: "C02",
          depends_on: ["C01"],
          attributes: ["code"],
          deliverable: "Shared plan contract",
          description: "Fix structured validation arguments",
        },
      ],
    },
  },
  dispatch: { concurrency: 4 },
});

/**
 * One clear diagnostic per bad input format (missing key, null, array, raw
 * Markdown string, JSON-encoded string). Used by the tool handlers AND by the
 * direct runtime gates so both boundaries reject the format once instead of
 * cascading misleading missing-section errors. String input is never
 * JSON.parse'd and no extra wrappers are guessed.
 */
export function describePlanPayloadFormatError(value: unknown): string {
  const expected = `Expected the named \`payload\` object (with optional \`dispatch\`), for example: ${PLAN_TOOL_INPUT_EXAMPLE}.`;

  if (value === undefined) {
    return `Missing \`payload\`: plan validation requires a structured \`payload\` object, not an absent or empty argument. ${expected}`;
  }

  if (value === null) {
    return `\`payload\` is null: plan validation requires a structured \`payload\` object. ${expected}`;
  }

  if (Array.isArray(value)) {
    return `\`payload\` must be a single structured object, not an array of ${value.length} item(s). ${expected}`;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return `\`payload\` was received as a JSON-encoded string (double-encoded input). Parse it before submitting or send the object directly; plan tools never JSON.parse string input. ${expected}`;
    }

    if (/^---\s*$/.test(trimmed.split(/\r?\n/)[0] ?? "") || /^\s*#{1,6}\s/.test(trimmed)) {
      return `\`payload\` was received as a raw Markdown document. Submit the structured \`payload\` object; plan tools do not parse Markdown documents. ${expected}`;
    }

    return `\`payload\` must be a structured object (received a plain string). ${expected}`;
  }

  return `\`payload\` must be an object with plan.subtasks (received ${typeof value}). ${expected}`;
}
