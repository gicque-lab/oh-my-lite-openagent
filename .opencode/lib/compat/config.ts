/**
 * Format-boundary helpers for reading and updating OpenCode configuration
 * safely across the legacy (v1) and native (v2) dialects.
 *
 * Facts fixed by the documented v1→v2 migration (CFG-01,
 * https://opencode.ai/v2/docs/migrate-v1) and pinned live-host evidence (C01):
 * - Legacy keys: `plugin`, `agent`, `command`, `permission`, `provider`; native
 *   keys: `plugins`, `agents`, `commands`, `permissions`, `providers`. `mcp`
 *   moves to `mcp.servers`; actions rename (bash→shell, task→subagent,
 *   write/patch→edit). `model`, `default_agent` keep their names.
 * - Both dialects may coexist at the top level; "when both forms set the same
 *   canonical value, a valid native V2 value takes precedence regardless of
 *   JSON key order". Nested agent/provider/command/model entries must stay
 *   internally one format (v2 never recursively infers entry formats).
 * - Legacy `plugin` decodes v1 specs only (`string` or `[spec, options]`
 *   tuples); a v2 `{package, options}` object there is malformed. Native
 *   `plugins` accepts strings or `{package, options}` objects; a `-<target>`
 *   entry removes that registration.
 * - Model references are `provider/model` with an optional `#variant` joined
 *   onto the end.
 *
 * Detection uses these documented fields only — never a product version or a
 * `$schema` URL. Every helper is additive at the managed boundary and never
 * normalizes or rewrites unrelated user data.
 */

export type ConfigDialect = "legacy" | "native" | "mixed";

const LEGACY_ONLY_KEYS = new Set(["plugin", "agent", "command", "permission", "provider"]);
const NATIVE_ONLY_KEYS = new Set(["plugins", "agents", "commands", "permissions", "providers"]);

export interface ConfigDialectInfo {
  dialect: ConfigDialect;
  /** Recognized legacy-only top-level keys present in the config. */
  legacyKeys: string[];
  /** Recognized native-only top-level keys present in the config. */
  nativeKeys: string[];
}

export function detectConfigDialect(config: Record<string, unknown>): ConfigDialectInfo {
  const legacyKeys: string[] = [];
  const nativeKeys: string[] = [];

  for (const key of Object.keys(config)) {
    // Present-but-undefined values count as absent (JSON never emits them);
    // identical to how a serialized config file classifies.
    if (config[key] === undefined) continue;
    if (LEGACY_ONLY_KEYS.has(key)) legacyKeys.push(key);
    else if (NATIVE_ONLY_KEYS.has(key)) nativeKeys.push(key);
  }

  const dialect: ConfigDialect = legacyKeys.length > 0 && nativeKeys.length > 0
    ? "mixed"
    : nativeKeys.length > 0
      ? "native"
      : "legacy";

  return { dialect, legacyKeys, nativeKeys };
}

// ---------------------------------------------------------------------------
// Model references: provider/model or provider/model#variant
// ---------------------------------------------------------------------------

export interface ModelReference {
  provider: string;
  /** Model id; may itself contain "/" for gateway-style references. */
  model: string;
  /** Explicit `#variant` suffix, when present. */
  variant?: string;
  /** provider/model without any variant. */
  baseId: string;
  /** Normalized reference including the explicit variant when present. */
  reference: string;
}

/**
 * Parses `provider/model`, `provider/model#variant`, and gateway forms such as
 * `vercel/anthropic/claude-opus`. Returns undefined for malformed references so
 * callers can skip them with an explicit reason; a present-but-empty variant is
 * rejected rather than silently discarded.
 */
export function parseModelReference(value: unknown): ModelReference | undefined {
  if (typeof value !== "string") return undefined;
  const reference = value.trim();
  if (!reference) return undefined;

  const hash = reference.indexOf("#");
  const base = hash >= 0 ? reference.slice(0, hash) : reference;
  const rawVariant = hash >= 0 ? reference.slice(hash + 1) : undefined;
  const slash = base.indexOf("/");
  if (slash <= 0) return undefined;

  const provider = base.slice(0, slash);
  const model = base.slice(slash + 1);
  if (!provider || !model) return undefined;
  const variant = rawVariant === undefined ? undefined : rawVariant.trim();
  if (rawVariant !== undefined && !variant) return undefined;

  const baseId = `${provider}/${model}`;
  return {
    provider,
    model,
    ...(variant ? { variant } : {}),
    baseId,
    reference: variant ? `${baseId}#${variant}` : baseId,
  };
}

// ---------------------------------------------------------------------------
// Plugin entries
// ---------------------------------------------------------------------------

/**
 * Configuration specs this project writes for its managed plugin. Matching is
 * exact — an arbitrary path string that merely *contains* `bounded-lite.ts`
 * belongs to the user and must never be classified as managed.
 */
export const MANAGED_PLUGIN_SPECS: readonly string[] = [
  "./.opencode/plugins/bounded-lite.ts",
];

export interface PluginEntryView {
  container: "legacy" | "native";
  /** Zero-based index within the container array (single string entries land at 0). */
  index: number;
  /** Package/path spec; for removal entries the leading "-" is stripped. */
  packageSpec: string;
  /** Options payload of `[spec, options]` tuples or `{package, options}` objects. */
  options?: Record<string, unknown>;
  /** True for native `"-<target>"` removal entries (recognized defensively in legacy too). */
  removal: boolean;
}

function classifyPluginEntryValue(
  container: "legacy" | "native",
  index: number,
  value: unknown,
): PluginEntryView | undefined {
  if (typeof value === "string") {
    const removal = value.startsWith("-");
    return { container, index, packageSpec: removal ? value.slice(1) : value, removal };
  }

  if (container === "native" && isRecord(value)) {
    const packageSpec = value["package"];
    if (typeof packageSpec !== "string" || !packageSpec) return undefined;
    const options = isRecord(value["options"]) ? value["options"] : undefined;
    return { container, index, packageSpec, ...(options ? { options } : {}), removal: false };
  }

  if (container === "legacy" && Array.isArray(value)) {
    const packageSpec = value[0];
    if (typeof packageSpec !== "string" || !packageSpec) return undefined;
    const options = isRecord(value[1]) ? value[1] : undefined;
    return { container, index, packageSpec, ...(options ? { options } : {}), removal: false };
  }

  return undefined;
}

/** Reads plugin entries from both containers, skipping malformed items like the host does. */
export function readPluginEntries(config: Record<string, unknown>): PluginEntryView[] {
  const entries: PluginEntryView[] = [];

  const legacyValue = config["plugin"];
  if (typeof legacyValue === "string") {
    const entry = classifyPluginEntryValue("legacy", 0, legacyValue);
    if (entry) entries.push(entry);
  } else if (Array.isArray(legacyValue)) {
    legacyValue.forEach((item, index) => {
      const entry = classifyPluginEntryValue("legacy", index, item);
      if (entry) entries.push(entry);
    });
  }

  const nativeValue = config["plugins"];
  if (Array.isArray(nativeValue)) {
    nativeValue.forEach((item, index) => {
      const entry = classifyPluginEntryValue("native", index, item);
      if (entry) entries.push(entry);
    });
  }

  return entries;
}

export function isManagedPluginEntry(entry: PluginEntryView): boolean {
  return MANAGED_PLUGIN_SPECS.includes(entry.packageSpec);
}

/**
 * Effective managed plugin options across both containers. With mixed
 * top-level forms the native value takes precedence; within a container the
 * last non-removal managed entry wins (array order is the documented removal
 * direction for native `-<target>` entries).
 */
export function managedPluginOptions(config: Record<string, unknown>): Record<string, unknown> {
  const managed = readPluginEntries(config)
    .filter(isManagedPluginEntry)
    .filter((entry) => !entry.removal && entry.options);

  const legacy = managed.filter((entry) => entry.container === "legacy");
  const native = managed.filter((entry) => entry.container === "native");
  const lastOptions = (list: PluginEntryView[]) =>
    list.length > 0 ? list[list.length - 1]!.options : undefined;

  return lastOptions(native) ?? lastOptions(legacy) ?? {};
}

/** Removes exact managed plugin entries (never removal entries), in place. */
export function removeManagedPluginEntries(
  config: Record<string, unknown>,
  container?: "legacy" | "native",
): void {
  for (const key of ["plugin", "plugins"] as const) {
    if (container === "legacy" && key !== "plugin") continue;
    if (container === "native" && key !== "plugins") continue;
    const value = config[key];
    if (!Array.isArray(value)) continue;
    config[key] = value.filter((item) => {
      const entry = classifyPluginEntryValue(key === "plugin" ? "legacy" : "native", 0, item);
      return !(entry && isManagedPluginEntry(entry) && !entry.removal);
    });
  }
}

/**
 * Upserts the managed plugin entry in the file's effective container:
 * native-classified or mixed files (and any file with a `plugins` array) get a
 * native `{package, options}` entry in `plugins`; legacy-classified files keep
 * the v1 `[spec, options]` tuple in `plugin` at its existing position. When
 * both containers hold managed entries, the legacy shadow is removed so the
 * managed value lives only in the effective native location.
 */
export function upsertManagedPluginEntry(
  config: Record<string, unknown>,
  spec: string,
  options: Record<string, unknown>,
): void {
  const info = detectConfigDialect(config);
  const targetNative = Array.isArray(config["plugins"]) || info.dialect === "native" || info.dialect === "mixed";

  if (targetNative) {
    // The managed value must live only in the effective native location; drop
    // legacy shadow entries but keep the native array's positions intact.
    removeManagedPluginEntries(config, "legacy");
    const plugins = Array.isArray(config["plugins"]) ? [...config["plugins"]] : [];
    const index = plugins.findIndex((item) => {
      const entry = classifyPluginEntryValue("native", 0, item);
      return Boolean(entry && !entry.removal && entry.packageSpec === spec);
    });

    if (index >= 0) {
      const existing = plugins[index];
      const extraEntryKeys = isRecord(existing)
        ? Object.fromEntries(Object.entries(existing).filter(([key]) => key !== "package" && key !== "options"))
        : {};
      plugins[index] = { ...extraEntryKeys, package: spec, options };
    } else {
      plugins.push({ package: spec, options });
    }
    config["plugins"] = plugins;
    return;
  }

  // Legacy-classified file (or fresh config without plugin data): v1 tuple form.
  const pluginValue = config["plugin"];
  const plugins = Array.isArray(pluginValue)
    ? [...pluginValue]
    : typeof pluginValue === "string"
      ? [pluginValue]
      : [];
  const index = plugins.findIndex((item) => {
    const entry = classifyPluginEntryValue("legacy", 0, item);
    return Boolean(entry && !entry.removal && isManagedPluginEntry(entry));
  });

  if (index >= 0) {
    plugins[index] = [spec, options];
  } else {
    plugins.push([spec, options]);
  }
  config["plugin"] = plugins;
}

// ---------------------------------------------------------------------------
// Effective entry reads (native values take precedence over legacy same-name values)
// ---------------------------------------------------------------------------

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function nativeAgentEntries(config: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordOrUndefined(config["agents"]);
}

export function legacyAgentEntries(config: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordOrUndefined(config["agent"]);
}

/** Effective agent entries: native `agents` shadows same-name legacy `agent` entries. */
export function mergedAgentEntries(config: Record<string, unknown>): Record<string, unknown> {
  return { ...(legacyAgentEntries(config) ?? {}), ...(nativeAgentEntries(config) ?? {}) };
}

export function nativeProviderEntries(config: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordOrUndefined(config["providers"]);
}

export function legacyProviderEntries(config: Record<string, unknown>): Record<string, unknown> | undefined {
  return recordOrUndefined(config["provider"]);
}

/** Effective provider entries: native `providers` shadows same-name legacy `provider` entries. */
export function mergedProviderEntries(config: Record<string, unknown>): Record<string, unknown> {
  return { ...(legacyProviderEntries(config) ?? {}), ...(nativeProviderEntries(config) ?? {}) };
}

/** Native `mcp.servers` container, when present as a record. */
export function nativeMcpServers(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const mcp = recordOrUndefined(config["mcp"]);
  return mcp ? recordOrUndefined(mcp["servers"]) : undefined;
}

// ---------------------------------------------------------------------------
// Native permission rules
// ---------------------------------------------------------------------------

export interface NativePermissionRule {
  index: number;
  action?: string;
  resource?: string;
  effect?: string;
  raw: unknown;
}

export interface NativePermissionsRead {
  rules: NativePermissionRule[];
  malformed: Array<{ index: number; raw: unknown }>;
}

/**
 * Reads the native ordered `permissions` rule array. Entries are usable when
 * they are records with a string `action`; regulations keep their original
 * array order (last match wins) and are never sorted or object-spread.
 */
export function readNativePermissions(config: Record<string, unknown>): NativePermissionsRead {
  const value = config["permissions"];
  if (!Array.isArray(value)) return { rules: [], malformed: [] };

  const rules: NativePermissionRule[] = [];
  const malformed: Array<{ index: number; raw: unknown }> = [];

  value.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw["action"] !== "string") {
      malformed.push({ index, raw });
      return;
    }
    rules.push({
      index,
      raw,
      action: raw["action"],
      ...(typeof raw["resource"] === "string" ? { resource: raw["resource"] } : {}),
      ...(typeof raw["effect"] === "string" ? { effect: raw["effect"] } : {}),
    });
  });

  return { rules, malformed };
}

/** Appends rules to the native `permissions` array, creating it only when missing. Never reorders. */
export function appendNativePermissionRules(
  config: Record<string, unknown>,
  rules: ReadonlyArray<{ action: string; resource?: string; effect: string }>,
): void {
  if (rules.length === 0) return;
  const existing = Array.isArray(config["permissions"]) ? config["permissions"] : [];
  config["permissions"] = [
    ...existing,
    ...rules.map((rule) => ({
      action: rule.action,
      ...(rule.resource !== undefined ? { resource: rule.resource } : {}),
      effect: rule.effect,
    })),
  ];
}

// ---------------------------------------------------------------------------
// Conflict detection for managed writes
// ---------------------------------------------------------------------------

export type ManagedConfigConflictKind =
  | "native-managed-agent-entry"
  | "managed-plugin-removal"
  | "native-permissions-shape"
  | "native-permission-rule";

export interface ManagedConfigConflict {
  /** Exact location/key conflict, e.g. `agents."command-lead"` or `permissions[3]`. */
  location: string;
  kind: ManagedConfigConflictKind;
  detail: string;
  guidance: string;
}

/**
 * Detects existing entries that would shadow or prematurely disable managed
 * values and that cannot be classified without guessing:
 * - user-authored native `agents` entries for managed roles/built-in overrides
 *   (these shadow the generated agents/<name>.md definitions),
 * - explicit managed plugin removal entries,
 * - the native `permissions` container in a non-array shape or with rules that
 *   cannot be parsed.
 */
export function findManagedConfigConflicts(
  config: Record<string, unknown>,
  managedAgentNames: Iterable<string>,
): ManagedConfigConflict[] {
  const conflicts: ManagedConfigConflict[] = [];
  const managedNames = new Set(managedAgentNames);

  const agents = nativeAgentEntries(config);
  if (agents) {
    for (const [name, raw] of Object.entries(agents)) {
      if (!managedNames.has(name) || !isRecord(raw)) continue;
      conflicts.push({
        location: `agents.${JSON.stringify(name)}`,
        kind: "native-managed-agent-entry",
        detail: `Native agents entry would shadow the generated agents/${name}.md managed definition (keys: ${Object.keys(raw).join(", ") || "<none>"}).`,
        guidance: 'Remove the entry from the native "agents" map (or adopt your entry as the authoritative definition and take over managing that agent) and run the installer again.',
      });
    }
  }

  for (const entry of readPluginEntries(config)) {
    if (!entry.removal || !isManagedPluginEntry(entry)) continue;
    conflicts.push({
      location: entry.container === "native"
        ? `plugins[${JSON.stringify(`-${entry.packageSpec}`)}]`
        : `plugin[${JSON.stringify(`-${entry.packageSpec}`)}]`,
      kind: "managed-plugin-removal",
      detail: "The configuration explicitly disables the managed plugin entry.",
      guidance: "Remove the removal entry (or intentionally stop using the managed plugin) and run the installer again.",
    });
  }

  const permissionsValue = config["permissions"];
  if (permissionsValue !== undefined) {
    if (!Array.isArray(permissionsValue)) {
      conflicts.push({
        location: "permissions",
        kind: "native-permissions-shape",
        detail: 'The native "permissions" key exists but is not the documented ordered rule array; its rule format cannot be classified safely.',
        guidance: "Convert \"permissions\" to an array of {action, resource, effect} rules (or remove it and rerun the installer; a backup of the previous file is kept before any write).",
      });
    } else {
      for (const item of readNativePermissions(config).malformed) {
        conflicts.push({
          location: `permissions[${item.index}]`,
          kind: "native-permission-rule",
          detail: "Native permission rule entry cannot be classified as an {action, resource, effect} rule without guessing.",
          guidance: 'Give the entry a string "action" (and string "resource"/"effect" fields) or remove it, then run the installer again.',
        });
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
