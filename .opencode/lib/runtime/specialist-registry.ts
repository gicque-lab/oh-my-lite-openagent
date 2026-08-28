import { ROLE_CONTRACTS } from "../contracts.js";
import type { LiteReasoningEffort } from "./lite-config.js";

const SPECIALIST_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const CORE_ROLE_NAMES = new Set<string>(ROLE_CONTRACTS.map((role) => role.name));
const BUILTIN_AGENT_OVERRIDE_NAMES = new Set(["build", "plan"]);
const RESERVED_SPECIALIST_NAMES = new Set<string>([
  ...CORE_ROLE_NAMES,
  ...BUILTIN_AGENT_OVERRIDE_NAMES,
]);

export interface SpecialistAgentConfig {
  name: string;
  description: string;
  model?: string;
  reasoningEffort?: LiteReasoningEffort;
  editFolders?: string[];
  prompt?: string;
  promptFile?: string;
  allowBash?: boolean;
}

function normalizeSpecialistReasoningEffort(value: unknown): LiteReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");

  if (normalized === "none" || normalized === "minimal") return "minimal";
  if (normalized === "low") return "low";
  if (normalized === "medium" || normalized === "med") return "medium";
  if (normalized === "high") return "high";
  if (
    normalized === "xhigh" ||
    normalized === "x-high" ||
    normalized === "extra-high" ||
    normalized === "extra_high" ||
    normalized === "very-high" ||
    normalized === "very_high"
  ) return "xhigh";
  if (normalized === "max" || normalized === "maximum") return "max";

  return undefined;
}

export interface SpecialistNameValidationResult {
  valid: boolean;
  error?: string;
}

export interface SpecialistConfigValidationResult {
  valid: boolean;
  errors: string[];
  config?: SpecialistAgentConfig;
}

/**
 * Returns whether a name belongs to a managed core role or disabled built-in
 * OpenCode agent. Specialist names must not shadow either category.
 */
export function isReservedRoleName(name: unknown): boolean {
  return typeof name === "string" && RESERVED_SPECIALIST_NAMES.has(name);
}

export function validateSpecialistName(name: unknown): SpecialistNameValidationResult {
  if (typeof name !== "string") {
    return {
      valid: false,
      error: "specialist name must be a string",
    };
  }

  if (!SPECIALIST_NAME_PATTERN.test(name)) {
    return {
      valid: false,
      error: "specialist name must match ^[a-z0-9][a-z0-9_-]*$",
    };
  }

  if (CORE_ROLE_NAMES.has(name)) {
    return {
      valid: false,
      error: `specialist name is a reserved core role: ${name}`,
    };
  }

  if (BUILTIN_AGENT_OVERRIDE_NAMES.has(name)) {
    return {
      valid: false,
      error: `specialist name is a reserved built-in override: ${name}`,
    };
  }

  return { valid: true };
}

/**
 * Validates and normalizes an untrusted specialist configuration value.
 *
 * Unknown properties are ignored so the returned value can safely be passed
 * to frontmatter generation without leaking configuration-only fields.
 */
export function validateSpecialistConfig(value: unknown): SpecialistConfigValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ["specialist configuration must be an object"],
    };
  }

  const name = value["name"];
  const nameValidation = validateSpecialistName(name);
  if (!nameValidation.valid && nameValidation.error) errors.push(nameValidation.error);

  const description = value["description"];
  if (typeof description !== "string" || description.trim() === "") {
    errors.push("specialist description must be a non-empty string");
  }

  const model = value["model"];
  if (model !== undefined && (typeof model !== "string" || model.trim() === "")) {
    errors.push("specialist model must be a non-empty string when provided");
  } else if (typeof model === "string" && !model.trim().includes("/")) {
    errors.push("specialist model must use provider/model format");
  }

  const reasoningEffort = value["reasoningEffort"];
  const normalizedReasoningEffort = reasoningEffort === undefined
    ? undefined
    : normalizeSpecialistReasoningEffort(reasoningEffort);
  if (reasoningEffort !== undefined && !normalizedReasoningEffort) {
    errors.push("specialist reasoningEffort is not supported");
  }

  const editFolders = value["editFolders"];
  if (editFolders !== undefined) {
    if (!Array.isArray(editFolders)) {
      errors.push("specialist editFolders must be an array of strings");
    } else {
      for (const folder of editFolders) {
        if (typeof folder !== "string" || folder.trim() === "") {
          errors.push("specialist editFolders entries must be non-empty strings");
          continue;
        }

        if (!isSafeRelativeFolder(folder)) {
          errors.push(`specialist editFolders entry is not a safe relative folder: ${folder}`);
        }
      }
    }
  }

  const prompt = value["prompt"];
  if (prompt !== undefined && (typeof prompt !== "string" || prompt.trim() === "")) {
    errors.push("specialist prompt must be a non-empty string when provided");
  }

  const promptFile = value["promptFile"];
  if (promptFile !== undefined) {
    if (typeof promptFile !== "string" || promptFile.trim() === "") {
      errors.push("specialist promptFile must be a non-empty relative path when provided");
    } else if (!isSafeRelativeFilePath(promptFile)) {
      errors.push(`specialist promptFile must be a safe relative path: ${promptFile}`);
    }
  }

  const allowBash = value["allowBash"];
  if (allowBash !== undefined && typeof allowBash !== "boolean") {
    errors.push("specialist allowBash must be a boolean when provided");
  }

  if (errors.length > 0) return { valid: false, errors };

  const config: SpecialistAgentConfig = {
    name: name as string,
    description: (description as string).trim(),
    allowBash: allowBash === true,
  };
  if (typeof model === "string") config.model = model.trim();
  if (normalizedReasoningEffort) config.reasoningEffort = normalizedReasoningEffort;
  if (Array.isArray(editFolders)) config.editFolders = editFolders.map((folder) => (folder as string).trim());
  if (typeof prompt === "string") config.prompt = prompt;
  if (typeof promptFile === "string") config.promptFile = promptFile.trim();

  return {
    valid: true,
    errors: [],
    config,
  };
}

/**
 * Returns the normalized specialist config or undefined for invalid input.
 */
export function normalizeSpecialistConfig(value: unknown): SpecialistAgentConfig | undefined {
  return validateSpecialistConfig(value).config;
}

/**
 * Builds OpenCode edit permission rules for a specialist.
 *
 * OpenCode resolves matching rules using last-match-wins semantics, so the
 * catch-all rule is deliberately inserted first. Each selected folder gets a
 * root-relative and nested-path pattern to support both execution contexts.
 */
export function generateSpecialistEditPermissions(editFolders?: string[]): Record<string, string> {
  if (!Array.isArray(editFolders) || editFolders.length === 0) {
    return { "*": "deny" };
  }

  const normalizedFolders = new Set<string>();
  for (const folder of editFolders) {
    if (typeof folder !== "string") continue;
    const normalized = normalizeFolderPattern(folder);
    if (normalized) normalizedFolders.add(normalized);
  }

  if (normalizedFolders.has("*") || normalizedFolders.has("**")) {
    return { "*": "allow" };
  }

  const permissions: Record<string, string> = { "*": "deny" };
  for (const folder of normalizedFolders) {
    const rootPattern = `${folder}/**`;
    const nestedPattern = `**/${folder}/**`;
    permissions[rootPattern] = "allow";
    permissions[nestedPattern] = "allow";
  }

  return permissions;
}

export function buildSpecialistFrontmatter(
  config: SpecialistAgentConfig,
): Record<string, unknown> {
  const validation = validateSpecialistConfig(config);
  if (!validation.valid || !validation.config) {
    throw new Error(`Invalid specialist configuration: ${validation.errors.join("; ")}`);
  }

  const normalized = validation.config;
  return {
    mode: "subagent",
    hidden: true,
    description: normalized.description,
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.reasoningEffort ? { reasoningEffort: normalized.reasoningEffort } : {}),
    permission: {
      task: { "*": "deny" },
      question: "deny",
      edit: generateSpecialistEditPermissions(normalized.editFolders),
      bash: { "*": normalized.allowBash ? "allow" : "deny" },
    },
  };
}

function normalizeFolderPattern(value: string): string | undefined {
  let normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "*" || normalized === "**") return normalized;

  normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  while (normalized.endsWith("/**") || normalized.endsWith("/*")) {
    normalized = normalized.slice(0, normalized.lastIndexOf("/"));
  }
  normalized = normalized.replace(/^\.\/+/, "").replace(/\/+/g, "/");

  if (normalized === "" || normalized === "." || normalized === "..") return undefined;
  if (!isSafeRelativeFolder(normalized)) return undefined;
  if (normalized === "*" || normalized === "**") return normalized;
  return normalized;
}

function isSafeRelativeFolder(value: string): boolean {
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "*" || normalized === "**") return true;
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function isSafeRelativeFilePath(value: string): boolean {
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
