import { z } from "zod";
import { executablePlanPayloadSchema } from "../artifacts/schema.js";

/**
 * Shared tool argument (wire) contracts for the bounded_lite_* tools.
 *
 * Shapes are plain Zod raw shapes so the plugin registers them directly as
 * `args` (hosts project them per host line) while tests serialize the same
 * shapes with the pinned Zod 4.1.8 `z.toJSONSchema()` API.
 */

export const planToolArgsShape = {
  payload: executablePlanPayloadSchema.describe(
    `Structured plan payload object with required plan.subtasks. Example: ${JSON.stringify({
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
    })}`,
  ),
  dispatch: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional task dispatch settings, e.g. {"concurrency": 4, "defaultProfile": "code", "attributeProfileMap": {"code": "code-profile"}}.',
    ),
} as const;

/** Artifact document aliases: exactly one of `markdown` / `content` carries the text. */
export type PlanArtifactWriteInput = {
  title: string;
  markdown: string;
};

const ARTIFACT_KIND_VALUES = ["plan-skeleton", "detailed-plan"] as const;
const ARTIFACT_STATUS_VALUES = ["draft", "reviewed", "blocked"] as const;

/**
 * Cross-field guard for bounded_lite_plan_artifact writes: the v1 raw-shape
 * helper cannot express title-plus-one-of(markdown, content) at the root, so
 * the rule is documented on the arg descriptions and enforced HERE, before any
 * I/O side effect. Title-only calls fail before any file write.
 */
export function assertPlanArtifactWriteArgs(args: Record<string, unknown>): PlanArtifactWriteInput {
  const action = readString(args["action"]) ?? "write";

  if (action !== "write") {
    throw new Error(`bounded_lite_plan_artifact action must be "write" (received "${action}").`);
  }

  const title = args["title"];

  if (typeof title !== "string" || title.trim() === "") {
    throw new Error(
      `bounded_lite_plan_artifact requires a non-empty string "title" (received ${
        title === undefined ? "no title" : typeof title
      }).`,
    );
  }

  const markdown = args["markdown"];
  const content = args["content"];
  const document = readString(markdown) ?? readString(content);

  if (!document) {
    throw new Error(
      `bounded_lite_plan_artifact write requires document text: provide "markdown" or its alias "content" as a non-empty string alongside "title". Title-only submissions are rejected before any file write.`,
    );
  }

  const artifactKind = args["artifactKind"];

  if (
    artifactKind !== undefined &&
    !(ARTIFACT_KIND_VALUES as readonly unknown[]).includes(artifactKind)
  ) {
    throw new Error(
      `bounded_lite_plan_artifact "artifactKind" must be one of ${ARTIFACT_KIND_VALUES.map((kind) => `"${kind}"`).join(" | ")} (received ${JSON.stringify(artifactKind) ?? String(artifactKind)}).`,
    );
  }

  const status = args["status"];

  if (status !== undefined && !(ARTIFACT_STATUS_VALUES as readonly unknown[]).includes(status)) {
    throw new Error(
      `bounded_lite_plan_artifact "status" must be one of ${ARTIFACT_STATUS_VALUES.map((value) => `"${value}"`).join(" | ")} (received ${JSON.stringify(status) ?? String(status)}).`,
    );
  }

  return { title, markdown: document };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
