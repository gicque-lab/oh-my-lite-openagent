import { ROLE_CONTRACTS, type RoleName } from "../contracts.js";
import {
  legacyAgentEntries,
  managedPluginOptions,
  mergedAgentEntries,
  nativeAgentEntries,
  parseModelReference,
} from "../compat/config.js";
import {
  normalizeSpecialistConfig,
  type SpecialistAgentConfig,
} from "./specialist-registry.js";
import { DEFAULT_TASK_LEAD_PROFILES, isKnownTaskLeadProfile } from "./task-lead-profiles.js";
import type { ProviderModel } from "./model-config.js";

export const LITE_CONFIG_FILE = "oh-my-lite-openagent.json";
export const LITE_CONFIG_SCHEMA_VERSION = 1;

export type LiteReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface LiteTaskLeadProfileConfig {
  model?: string;
  reasoningEffort?: LiteReasoningEffort;
  fallbackModels?: string[];
}

export interface LiteOpenAgentConfig {
  schemaVersion: number;
  roleModels: Partial<Record<RoleName, string>>;
  roleReasoningEffort: Partial<Record<RoleName, LiteReasoningEffort>>;
  taskLeadProfiles: Record<string, LiteTaskLeadProfileConfig>;
  specialists?: Record<string, SpecialistAgentConfig>;
  modelPoolPolicy?: Record<string, unknown>;
}

export interface ApplyLiteModelConfigResult {
  changed: Array<{ role: RoleName; previous?: string; next: string }>;
  skipped: Array<{ role: string; reason: string }>;
  warnings: Array<{ role: RoleName; warning: string }>;
}

export interface ApplyLiteReasoningConfigResult {
  changed: Array<{ role: RoleName; previous?: LiteReasoningEffort; next: LiteReasoningEffort; requested?: string }>;
  skipped: Array<{ role: string; reason: string }>;
}

export interface ApplyLiteTaskLeadProfileModelConfigResult {
  changed: Array<{ profile: string; previous?: string; next: string }>;
  skipped: Array<{ profile: string; reason: string }>;
  warnings: Array<{ profile: string; warning: string }>;
}

export interface ApplyLiteTaskLeadProfileReasoningConfigResult {
  changed: Array<{ profile: string; previous?: LiteReasoningEffort; next: LiteReasoningEffort; requested?: string }>;
  skipped: Array<{ profile: string; reason: string }>;
}

/** Which config surfaces an agent preference belongs to. */
export type AgentPreferenceKind = "role" | "task-lead-profile" | "specialist";

/**
 * Normalized stored preference shape consumed by the C05 v2 request-hook work.
 * All values come from oh-my-lite-openagent.json ("stored"); a stored value is
 * never a runtime-effectiveness guarantee. When the stored model carries an
 * explicit `#variant`, the selected variant takes precedence over any stored
 * reasoning effort, recorded here as `reasoningConflict`.
 */
export interface AgentModelPreference {
  agentId: string;
  kind: AgentPreferenceKind;
  /** Full stored model reference, including an explicit variant when present. */
  storedModel?: string;
  /** Parsed provider/model base of the stored reference. */
  baseModel?: string;
  /** Explicit `#variant` parsed from the stored reference. */
  selectedVariant?: string;
  /** Requested reasoning effort persisted through apply. */
  storedReasoningEffort?: LiteReasoningEffort;
  /** True when an explicit model variant takes precedence over storedReasoningEffort. */
  reasoningConflict: boolean;
}

export const DEFAULT_ROLE_REASONING_EFFORT: Readonly<Record<RoleName, LiteReasoningEffort>> = {
  "command-lead": "high",
  "plan-builder": "high",
  "deep-plan-builder": "high",
  "task-lead": "medium",
  explore: "low",
  librarian: "low",
  "plan-review": "high",
  "result-review": "high",
};

export const DEFAULT_TASK_LEAD_PROFILE_REASONING_EFFORT: Readonly<Record<string, LiteReasoningEffort>> = {
  quick: "low",
  code: "medium",
  research: "low",
  writing: "medium",
  visual: "high",
  deep: "xhigh",
  "risk-high": "xhigh",
};

const ROLE_NAMES = new Set<string>(ROLE_CONTRACTS.map((role) => role.name));

export function createDefaultLiteConfig(): LiteOpenAgentConfig {
  return {
    schemaVersion: LITE_CONFIG_SCHEMA_VERSION,
    roleModels: {},
    roleReasoningEffort: {},
    taskLeadProfiles: {},
    modelPoolPolicy: {
      source: "all",
      allowCodexBackend: false,
    },
  };
}

export function readLiteConfig(value: unknown): LiteOpenAgentConfig {
  const input = isRecord(value) ? value : {};
  const config = createDefaultLiteConfig();

  config.schemaVersion = typeof input["schemaVersion"] === "number"
    ? input["schemaVersion"]
    : LITE_CONFIG_SCHEMA_VERSION;
  config.roleModels = readRoleModels(input["roleModels"]);
  config.roleReasoningEffort = readRoleReasoning(input["roleReasoningEffort"]);
  config.taskLeadProfiles = readProfileConfigs(input["taskLeadProfiles"]);
  const specialists = readSpecialists(input["specialists"]);
  if (Object.keys(specialists).length > 0) config.specialists = specialists;
  if (isRecord(input["modelPoolPolicy"])) config.modelPoolPolicy = { ...input["modelPoolPolicy"] };

  return config;
}

export function mergeLiteConfig(
  current: LiteOpenAgentConfig,
  patch: Partial<LiteOpenAgentConfig>,
): LiteOpenAgentConfig {
  const merged: LiteOpenAgentConfig = {
    schemaVersion: patch.schemaVersion ?? current.schemaVersion ?? LITE_CONFIG_SCHEMA_VERSION,
    roleModels: {
      ...current.roleModels,
      ...(patch.roleModels ?? {}),
    },
    roleReasoningEffort: {
      ...current.roleReasoningEffort,
      ...(patch.roleReasoningEffort ?? {}),
    },
    taskLeadProfiles: {
      ...current.taskLeadProfiles,
      ...(patch.taskLeadProfiles ?? {}),
    },
    modelPoolPolicy: {
      ...(current.modelPoolPolicy ?? {}),
      ...(patch.modelPoolPolicy ?? {}),
    },
  };
  const specialists = {
    ...(current.specialists ?? {}),
    ...(patch.specialists ?? {}),
  };
  if (Object.keys(specialists).length > 0) merged.specialists = specialists;
  return merged;
}

export function migrateLiteConfigFromOpenCodeConfig(
  config: Record<string, unknown>,
  existing: LiteOpenAgentConfig = createDefaultLiteConfig(),
): LiteOpenAgentConfig {
  const patch: Partial<LiteOpenAgentConfig> = {
    roleModels: {},
    roleReasoningEffort: {},
    taskLeadProfiles: {},
  };
  // Effective entries: mixed configs read native `agents` over legacy `agent`
  // per name; each entry may be legacy- or native-shaped but never both.
  const agents = mergedAgentEntries(config);

  for (const role of ROLE_CONTRACTS) {
    const rawAgent = agents[role.name];
    if (!isRecord(rawAgent)) continue;
    if (rawAgent["disable"] === true || rawAgent["disabled"] === true) continue;
    // Parse the reference fully; explicit `#variant` is preserved, never discarded.
    const parsed = parseModelReference(rawAgent["model"]);
    const model = parsed ? parsed.reference : undefined;
    const effort = normalizeLiteReasoningEffort(rawAgent["reasoningEffort"])
      ?? (isRecord(rawAgent["options"]) ? normalizeLiteReasoningEffort(rawAgent["options"]["reasoningEffort"]) : undefined);
    if (model && !existing.roleModels[role.name]) patch.roleModels![role.name] = model;
    if (effort && !existing.roleReasoningEffort[role.name]) patch.roleReasoningEffort![role.name] = effort;
  }

  // Profile preferences: managed plugin options are the effective source when
  // present; otherwise the (legacy) top-level `taskLeadProfiles` map.
  const pluginOptions = managedPluginOptions(config);
  const profileSource = isRecord(pluginOptions["taskLeadProfiles"])
    ? pluginOptions["taskLeadProfiles"]
    : (isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {});
  for (const [profileName, rawProfile] of Object.entries(profileSource)) {
    if (!isKnownTaskLeadProfile(profileName) || !isRecord(rawProfile)) continue;
    const currentProfile = existing.taskLeadProfiles[profileName] ?? {};
    const nextProfile: LiteTaskLeadProfileConfig = { ...currentProfile };
    const model = typeof rawProfile["model"] === "string" && rawProfile["model"].includes("/")
      ? rawProfile["model"]
      : undefined;
    const effort = normalizeLiteReasoningEffort(rawProfile["reasoningEffort"]);
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    if (model && !nextProfile.model) nextProfile.model = model;
    if (effort && !nextProfile.reasoningEffort) nextProfile.reasoningEffort = effort;
    if (fallbackModels.length > 0 && !nextProfile.fallbackModels) nextProfile.fallbackModels = fallbackModels;
    if (Object.keys(nextProfile).length > 0) patch.taskLeadProfiles![profileName] = nextProfile;
  }

  return mergeLiteConfig(existing, patch);
}

export function withLiteConfigAppliedToOpenCodeConfig(
  config: Record<string, unknown>,
  liteConfig: LiteOpenAgentConfig,
): Record<string, unknown> {
  const legacyAgents = legacyAgentEntries(config);
  const nativeAgents = nativeAgentEntries(config);
  const effective: Record<string, unknown> = {
    ...config,
    taskLeadProfiles: {
      ...(isRecord(config["taskLeadProfiles"]) ? config["taskLeadProfiles"] : {}),
    },
  };

  // Project role preferences into the effective container. Mixed configs keep
  // native `agents` entries as native (never adding legacy fields inside
  // native entries); values never cross containers.
  if (legacyAgents) effective["agent"] = { ...legacyAgents };
  if (nativeAgents) effective["agents"] = { ...nativeAgents };
  if (!legacyAgents && !nativeAgents) effective["agent"] = {};

  for (const role of ROLE_CONTRACTS) {
    // Managed updates always target the effective native container when one
    // exists (mixed configs must not write shadowed legacy fields); only
    // legacy-classified configs keep writing the v1 `agent` map.
    const source = legacyAgents && !nativeAgents
      ? (effective["agent"] as Record<string, unknown>)
      : (effective["agents"] as Record<string, unknown>);
    if (!source) continue;
    const rawAgent = source[role.name];
    const agent: Record<string, unknown> = isRecord(rawAgent) ? { ...rawAgent } : {};
    const model = liteConfig.roleModels[role.name];
    const effort = liteConfig.roleReasoningEffort[role.name];
    const currentEffort = normalizeLiteReasoningEffort(agent["reasoningEffort"])
      ?? (isRecord(agent["options"]) ? normalizeLiteReasoningEffort(agent["options"]["reasoningEffort"]) : undefined);
    if (model) agent["model"] = model;
    if (effort && !currentEffort) agent["reasoningEffort"] = effort;
    source[role.name] = agent;
  }

  for (const profile of DEFAULT_TASK_LEAD_PROFILES) {
    const profiles = effective["taskLeadProfiles"] as Record<string, unknown>;
    const rawProfile = profiles[profile.name];
    const current: Record<string, unknown> = isRecord(rawProfile) ? { ...rawProfile } : {};
    const configured = liteConfig.taskLeadProfiles[profile.name];
    if (configured?.model) current["model"] = configured.model;
    if (configured?.reasoningEffort) current["reasoningEffort"] = configured.reasoningEffort;
    if (configured?.fallbackModels && configured.fallbackModels.length > 0) {
      current["fallbackModels"] = configured.fallbackModels;
    }
    profiles[profile.name] = current;
  }

  return effective;
}

export function normalizeLiteReasoningEffort(value: unknown): LiteReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");

  if (normalized === "none") return "minimal";
  if (normalized === "minimal") return "minimal";
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

export function defaultRoleReasoningEffort(role: RoleName): LiteReasoningEffort {
  return DEFAULT_ROLE_REASONING_EFFORT[role];
}

export function defaultTaskLeadProfileReasoningEffort(profile: string): LiteReasoningEffort {
  return DEFAULT_TASK_LEAD_PROFILE_REASONING_EFFORT[profile] ?? "medium";
}

export function resolveSupportedReasoningEffort(input: {
  model?: ProviderModel | string;
  requested?: unknown;
  fallback: LiteReasoningEffort;
}): LiteReasoningEffort | undefined {
  const requested = normalizeLiteReasoningEffort(input.requested) ?? input.fallback;
  const supported = supportedReasoningEfforts(input.model);
  if (supported.length === 0) return undefined;

  for (const effort of downgradeChain(requested)) {
    if (supported.includes(effort)) return effort;
  }

  for (const effort of downgradeChain(input.fallback)) {
    if (supported.includes(effort)) return effort;
  }

  return undefined;
}

export function applyLiteRoleModelConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
  options: { allowUnavailableModels?: boolean } = {},
): ApplyLiteModelConfigResult {
  const availableModels = new Set(availableModelIds);
  const changed: ApplyLiteModelConfigResult["changed"] = [];
  const skipped: ApplyLiteModelConfigResult["skipped"] = [];
  const warnings: ApplyLiteModelConfigResult["warnings"] = [];

  for (const [role, modelValue] of Object.entries(assignments)) {
    if (!ROLE_NAMES.has(role)) {
      skipped.push({ role, reason: "unknown role" });
      continue;
    }
    if (typeof modelValue !== "string" || modelValue.trim() === "") {
      skipped.push({ role, reason: "model must be a non-empty string" });
      continue;
    }
    const model = modelValue.trim();
    const parsed = parseModelReference(model);
    if (!parsed) {
      skipped.push({ role, reason: "model must use provider/model format" });
      continue;
    }
    // The explicit variant is stored with the assignment; the base model is
    // validated separately against the imported pool.
    if (availableModels.size === 0 && !options.allowUnavailableModels) {
      skipped.push({ role, reason: "no imported model pool is available" });
      continue;
    }
    if (availableModels.size > 0 && !availableModels.has(model) && !availableModels.has(parsed.baseId)) {
      if (!options.allowUnavailableModels) {
        skipped.push({ role, reason: "model is not in the imported model pool" });
        continue;
      }
      warnings.push({ role: role as RoleName, warning: "model was not found in the provider list; writing it anyway" });
    }

    const previous = liteConfig.roleModels[role as RoleName];
    liteConfig.roleModels[role as RoleName] = model;
    changed.push({ role: role as RoleName, ...(previous ? { previous } : {}), next: model });
  }

  return { changed, skipped, warnings };
}

export function applyLiteRoleReasoningEffortConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
): ApplyLiteReasoningConfigResult {
  const changed: ApplyLiteReasoningConfigResult["changed"] = [];
  const skipped: ApplyLiteReasoningConfigResult["skipped"] = [];

  for (const [role, value] of Object.entries(assignments)) {
    if (!ROLE_NAMES.has(role)) {
      skipped.push({ role, reason: "unknown role" });
      continue;
    }
    const effort = normalizeLiteReasoningEffort(value);
    if (!effort) {
      const fallback = defaultRoleReasoningEffort(role as RoleName);
      const previous = liteConfig.roleReasoningEffort[role as RoleName];
      liteConfig.roleReasoningEffort[role as RoleName] = fallback;
      changed.push({ role: role as RoleName, ...(previous ? { previous } : {}), next: fallback, requested: String(value) });
      continue;
    }
    const previous = liteConfig.roleReasoningEffort[role as RoleName];
    liteConfig.roleReasoningEffort[role as RoleName] = effort;
    changed.push({ role: role as RoleName, ...(previous ? { previous } : {}), next: effort });
  }

  return { changed, skipped };
}

export function applyLiteTaskLeadProfileModelConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
  availableModelIds: readonly string[] = [],
  options: { allowUnavailableModels?: boolean } = {},
): ApplyLiteTaskLeadProfileModelConfigResult {
  const availableModels = new Set(availableModelIds);
  const changed: ApplyLiteTaskLeadProfileModelConfigResult["changed"] = [];
  const skipped: ApplyLiteTaskLeadProfileModelConfigResult["skipped"] = [];
  const warnings: ApplyLiteTaskLeadProfileModelConfigResult["warnings"] = [];

  for (const [profileName, modelValue] of Object.entries(assignments)) {
    if (!isKnownTaskLeadProfile(profileName)) {
      skipped.push({ profile: profileName, reason: "unknown task lead profile" });
      continue;
    }
    if (typeof modelValue !== "string" || modelValue.trim() === "") {
      skipped.push({ profile: profileName, reason: "model must be a non-empty string" });
      continue;
    }
    const model = modelValue.trim();
    const parsed = parseModelReference(model);
    if (!parsed) {
      skipped.push({ profile: profileName, reason: "model must use provider/model format" });
      continue;
    }
    if (availableModels.size === 0 && !options.allowUnavailableModels) {
      skipped.push({ profile: profileName, reason: "no imported model pool is available" });
      continue;
    }
    if (availableModels.size > 0 && !availableModels.has(model) && !availableModels.has(parsed.baseId)) {
      if (!options.allowUnavailableModels) {
        skipped.push({ profile: profileName, reason: "model is not in the imported model pool" });
        continue;
      }
      warnings.push({ profile: profileName, warning: "model was not found in the provider list; writing it anyway" });
    }

    const profile: LiteTaskLeadProfileConfig = liteConfig.taskLeadProfiles[profileName] ?? {};
    const previous = profile.model;
    liteConfig.taskLeadProfiles[profileName] = { ...profile, model };
    changed.push({ profile: profileName, ...(previous ? { previous } : {}), next: model });
  }

  return { changed, skipped, warnings };
}

export function applyLiteTaskLeadProfileReasoningEffortConfig(
  liteConfig: LiteOpenAgentConfig,
  assignments: Record<string, unknown>,
): ApplyLiteTaskLeadProfileReasoningConfigResult {
  const changed: ApplyLiteTaskLeadProfileReasoningConfigResult["changed"] = [];
  const skipped: ApplyLiteTaskLeadProfileReasoningConfigResult["skipped"] = [];

  for (const [profileName, value] of Object.entries(assignments)) {
    if (!isKnownTaskLeadProfile(profileName)) {
      skipped.push({ profile: profileName, reason: "unknown task lead profile" });
      continue;
    }
    const effort = normalizeLiteReasoningEffort(value) ?? defaultTaskLeadProfileReasoningEffort(profileName);
    const profile = liteConfig.taskLeadProfiles[profileName] ?? {};
    const previous = profile.reasoningEffort;
    liteConfig.taskLeadProfiles[profileName] = { ...profile, reasoningEffort: effort };
    changed.push({ profile: profileName, ...(previous ? { previous } : {}), next: effort, ...(normalizeLiteReasoningEffort(value) ? {} : { requested: String(value) }) });
  }

  return { changed, skipped };
}

/**
 * Normalizes stored model/reasoning preferences for the C05 v2 request-hook
 * work. Distinguishes the stored reference (with any explicit variant) from
 * the stored requested reasoning effort; an explicit variant always takes
 * precedence over a conflicting stored effort. Returned values describe what
 * is persisted, not what is runtime-effective.
 */
export function listAgentModelPreferences(liteConfig: LiteOpenAgentConfig): AgentModelPreference[] {
  const preferences: AgentModelPreference[] = [];

  const pushPreference = (
    agentId: string,
    kind: AgentPreferenceKind,
    storedModel: string | undefined,
    storedReasoningEffort: LiteReasoningEffort | undefined,
  ): void => {
    const parsed = storedModel ? parseModelReference(storedModel) : undefined;
    preferences.push({
      agentId,
      kind,
      ...(storedModel ? { storedModel } : {}),
      ...(parsed ? { baseModel: parsed.baseId } : {}),
      ...(parsed?.variant ? { selectedVariant: parsed.variant } : {}),
      ...(storedReasoningEffort ? { storedReasoningEffort } : {}),
      reasoningConflict: Boolean(parsed?.variant && storedReasoningEffort),
    });
  };

  for (const [role, storedModel] of Object.entries(liteConfig.roleModels)) {
    pushPreference(role, "role", storedModel, liteConfig.roleReasoningEffort[role as RoleName]);
  }
  for (const role of ROLE_CONTRACTS) {
    if (liteConfig.roleModels[role.name]) continue;
    const effort = liteConfig.roleReasoningEffort[role.name];
    if (!effort) continue;
    pushPreference(role.name, "role", undefined, effort);
  }
  // Roles without any stored preference are omitted entirely.

  for (const [profileName, profile] of Object.entries(liteConfig.taskLeadProfiles)) {
    pushPreference(profileName, "task-lead-profile", profile.model, profile.reasoningEffort);
  }
  for (const [specialistName, specialist] of Object.entries(liteConfig.specialists ?? {})) {
    pushPreference(specialistName, "specialist", specialist.model, specialist.reasoningEffort);
  }

  return preferences;
}

function supportedReasoningEfforts(model?: ProviderModel | string): LiteReasoningEffort[] {
  const modelId = typeof model === "string" ? model : model?.id;
  const provider = typeof model === "string" ? model.split("/")[0] : model?.provider;
  const variants = typeof model === "string" ? [] : (model?.variants ?? []);
  const normalizedVariants = variants
    .map((variant) => normalizeLiteReasoningEffort(variant))
    .filter((variant): variant is LiteReasoningEffort => Boolean(variant));

  if (normalizedVariants.length > 0) return [...new Set(normalizedVariants)];
  if (typeof model !== "string" && model?.reasoning === false) return [];

  const normalizedProvider = provider?.toLowerCase();
  if (normalizedProvider === "opencode" || normalizedProvider === "opencode-go") {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  if (
    normalizedProvider === "openai" ||
    normalizedProvider === "anthropic" ||
    normalizedProvider === "google" ||
    normalizedProvider === "github-copilot" ||
    normalizedProvider === "kimi-for-coding"
  ) {
    return ["low", "medium", "high"];
  }
  if (modelId && (modelId.toLowerCase().includes("gpt") || modelId.toLowerCase().includes("claude") || modelId.toLowerCase().includes("gemini"))) {
    return ["low", "medium", "high"];
  }

  return [];
}

function downgradeChain(effort: LiteReasoningEffort): LiteReasoningEffort[] {
  if (effort === "max") return ["max", "xhigh", "high", "medium", "low"];
  if (effort === "xhigh") return ["xhigh", "high", "medium", "low"];
  if (effort === "high") return ["high", "medium", "low"];
  if (effort === "medium") return ["medium", "low"];
  if (effort === "low") return ["low"];
  return ["minimal", "low"];
}

function readRoleModels(value: unknown): Partial<Record<RoleName, string>> {
  const result: Partial<Record<RoleName, string>> = {};
  if (!isRecord(value)) return result;
  for (const [role, model] of Object.entries(value)) {
    if (ROLE_NAMES.has(role) && typeof model === "string" && model.includes("/")) {
      result[role as RoleName] = model;
    }
  }
  return result;
}

function readSpecialists(value: unknown): Record<string, SpecialistAgentConfig> {
  const result: Record<string, SpecialistAgentConfig> = {};
  if (!isRecord(value)) return result;

  for (const [specialistName, rawSpecialist] of Object.entries(value)) {
    if (!isRecord(rawSpecialist)) continue;
    const candidate = {
      ...rawSpecialist,
      name: typeof rawSpecialist["name"] === "string" ? rawSpecialist["name"] : specialistName,
    };
    const specialist = normalizeSpecialistConfig(candidate);
    if (specialist && specialist.name === specialistName) result[specialistName] = specialist;
  }

  return result;
}

function readRoleReasoning(value: unknown): Partial<Record<RoleName, LiteReasoningEffort>> {
  const result: Partial<Record<RoleName, LiteReasoningEffort>> = {};
  if (!isRecord(value)) return result;
  for (const [role, effortValue] of Object.entries(value)) {
    const effort = normalizeLiteReasoningEffort(effortValue);
    if (ROLE_NAMES.has(role) && effort) result[role as RoleName] = effort;
  }
  return result;
}

function readProfileConfigs(value: unknown): Record<string, LiteTaskLeadProfileConfig> {
  const result: Record<string, LiteTaskLeadProfileConfig> = {};
  if (!isRecord(value)) return result;
  for (const [profileName, rawProfile] of Object.entries(value)) {
    if (!isKnownTaskLeadProfile(profileName) || !isRecord(rawProfile)) continue;
    const profile: LiteTaskLeadProfileConfig = {};
    if (typeof rawProfile["model"] === "string" && rawProfile["model"].includes("/")) profile.model = rawProfile["model"];
    const effort = normalizeLiteReasoningEffort(rawProfile["reasoningEffort"]);
    if (effort) profile.reasoningEffort = effort;
    const fallbackModels = readStringArray(rawProfile["fallbackModels"]);
    if (fallbackModels.length > 0) profile.fallbackModels = fallbackModels;
    if (Object.keys(profile).length > 0) result[profileName] = profile;
  }
  return result;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
