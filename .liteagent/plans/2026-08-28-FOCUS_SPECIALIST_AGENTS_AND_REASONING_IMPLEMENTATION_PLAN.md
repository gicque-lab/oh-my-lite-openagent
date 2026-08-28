# FOCUS Implementation Plan: Dynamic Specialist Agent Registry & Thinking Effort Configuration

## 1. Problem Statement & Motivation

1. **Specialist Agents with Directory-Scoped Write Permissions**:
   The current runtime architecture is statically structured around 8 fixed core roles (`command-lead`, `plan-builder`, `deep-plan-builder`, `task-lead`, `explore`, `librarian`, `plan-review`, `result-review`). Users require the capability to register on-demand specialist subagents (e.g., security audits, architecture reviews, documentation drift monitors, or localized code generators) that have write capabilities strictly bounded to specific directory globs (analogous to `plan-builder`'s write boundary at `.liteagent/**`).

2. **Thinking / Reasoning Effort Transparency & Dispatch Control**:
   While `lite-config.ts` defines `LiteReasoningEffort` types and helper utilities, reasoning effort is not currently transparent or dynamically integrated end-to-end:
   - `bounded_lite_plan_dag` and `bounded_lite_plan_readiness` do not dynamically reload `oh-my-lite-openagent.json` during execution.
   - Resolved `reasoningEffort` is missing from `TaskLeadProfileSelection` and `TaskDAGNode.dispatch` outputs.
   - Markdown frontmatter generation strips `reasoningEffort` even when explicitly configured in `oh-my-lite-openagent.json`.
   - `bounded_lite_runtime_profile` does not surface configured thinking effort levels.

---

## 2. Core Architectural Invariants & Non-Negotiables

To preserve repository safety and prevent test regressions, the implementation must adhere strictly to these constraints:

1. **Clean Base Managed Config Invariant**:
   - `scripts/managed-config.mjs` and `.opencode/lib/contracts.ts` MUST remain the pristine base specification for the 8 core roles.
   - Dynamic specialist agents must **NEVER** be statically hardcoded into `scripts/managed-config.mjs` or `ROLE_CONTRACTS`.
   - Specialist definitions live in user configuration (`oh-my-lite-openagent.json` under `specialists` or optional project-level `.opencode/specialists/*.json`).
   - The installer (`scripts/install.mjs`) and runtime plugin (`bounded-lite.ts`) dynamically generate `.opencode/agents/<specialist>.md` and inject delegation rules into `.opencode/agents/command-lead.md` at install/runtime.

2. **Leaf Worker Subagent Invariant (`MAX_CHILD_ORCHESTRATOR_DEPTH = 1`)**:
   - All specialist agents MUST be registered with `mode: "subagent"`, `hidden: true`, and `permission.task: { "*": "deny" }`.
   - Specialists cannot spawn subagents or delegate tasks, preserving the depth limit of $\le 1$.
   - Interactive prompt tool `permission.question` MUST be `"deny"` for all specialist subagents.

3. **OpenCode Permission Ordering & Directory-Scoped Dual-Expansion ("Last Match Wins")**:
   - Users can specify any custom list of target directory folders for each specialist via `editFolders` (e.g., `["docs"]`, `["src/components", "tests/unit"]`, `["specs/**"]`, or `["*"]`).
   - For directory-scoped edit permissions, `"*": "deny"` MUST be the very first key in `permission.edit`.
   - Every specified folder path is normalized (trimming trailing slashes and wildcard suffixes) and dual-expanded (e.g., `"docs"` becomes `"docs/**": "allow"` and `"**/docs/**": "allow"`) to ensure strict directory scoping across both root-relative and subpath execution contexts.
   - Default bash permissions for specialists must be `"*": "deny"` unless explicitly opted into safe bash capability.

4. **Backward Compatibility of Runtime Profile**:
   - Additive fields (`roleReasoningEffort`, `taskLeadProfileReasoningEffort`, `specialists`) on `RuntimeProfile` must be optional to ensure existing conformance tests (`conformance.test.ts`, `degraded-mode.test.ts`) pass without modification.

---

## 3. Phased Implementation Plan

### Phase 1 — Specialist Agent Registry & Directory-Scoped Write Permissions

#### Slice 1.1: Registry Types, Validation, & Permission Normalization
**Status: COMPLETE — 2026-08-28**
- **Target File**: `.opencode/lib/runtime/specialist-registry.ts` (New)
- **Data Contract**:
  ```ts
  export interface SpecialistAgentConfig {
    name: string; // Identifier: must match ^[a-z0-9][a-z0-9_-]*$
    description: string;
    model?: string; // e.g. "anthropic/claude-sonnet-4-6"
    reasoningEffort?: LiteReasoningEffort;
    editFolders?: string[]; // e.g. ["docs/**", "src/security/**"] or ["*"]
    prompt?: string; // Inline custom instructions
    promptFile?: string; // Relative path to markdown prompt file
    allowBash?: boolean; // Default: false (bash denied)
  }
  ```
- **Validation Rules**:
  - Name cannot collide with the 8 core role names (`command-lead`, `plan-builder`, `deep-plan-builder`, `task-lead`, `explore`, `librarian`, `plan-review`, `result-review`).
  - Name cannot collide with disabled built-in overrides (`build`, `plan`).
  - Name must be lowercase alphanumeric with hyphens or underscores.
- **Permission Normalization Functions**:
  - `generateSpecialistEditPermissions(editFolders?: string[]): Record<string, string>`
    - If empty/omitted: `{ "*": "deny" }`
    - If `["*"]` or `"*"`: `{ "*": "allow" }`
    - If specific folders (e.g. `["docs", "src/security", "reports/**"]`):
      - Starts with `{ "*": "deny" }` as the first entry.
      - Normalizes each folder entry (strips leading/trailing slashes, removes trailing `/**` or `/*` to extract base directory path).
      - Dual-expands each normalized directory: adds `<clean-dir>/**: "allow"` and `**/<clean-dir>/**: "allow"`.
      - Preserves internal relative glob segments when custom globs are provided while normalizing trailing directory wildcards.
  - `buildSpecialistFrontmatter(config: SpecialistAgentConfig): Record<string, unknown>`
    - `mode: "subagent"`
    - `hidden: true`
    - `description: config.description`
    - `model?: config.model`
    - `reasoningEffort?: config.reasoningEffort`
    - `permission: { task: { "*": "deny" }, question: "deny", edit: ..., bash: ... }`
- **Completed implementation**:
  - Added strict specialist identifier and configuration validation, including reserved-name collision guards and safe relative folder/prompt paths.
  - Added normalized specialist configuration handling and OpenCode frontmatter generation with leaf-worker delegation and question denials.
  - Added `tests/runtime/specialist-registry.test.ts` covering 14 unit cases for validation, folder selection, dual expansion, permission ordering, deduplication, and frontmatter invariants.
- **Verification record**:
  - `npm test -- tests/runtime/specialist-registry.test.ts` — passed (14 tests).
  - `npm run typecheck` — passed.
  - `npm test` — passed (179 tests across 19 files).
  - `npm run build` — passed.
  - `node scripts/install.mjs --dry-run` — passed; no files were written.

#### Slice 1.2: Config Schema Integration & Dynamic Frontmatter Generation
**Status: COMPLETE — 2026-08-28**
- **Target Files**:
  - `.opencode/lib/runtime/lite-config.ts` (Edit)
  - `scripts/install.mjs` (Edit)
- **Implementation**:
  - Extend `LiteOpenAgentConfig`:
    ```ts
    export interface LiteOpenAgentConfig {
      schemaVersion: number;
      roleModels: Partial<Record<RoleName, string>>;
      roleReasoningEffort: Partial<Record<RoleName, LiteReasoningEffort>>;
      taskLeadProfiles: Record<string, LiteTaskLeadProfileConfig>;
      specialists?: Record<string, SpecialistAgentConfig>; // New
      modelPoolPolicy?: Record<string, unknown>;
    }
    ```
  - Update `readLiteConfig`, `mergeLiteConfig`, and `migrateLiteConfigFromOpenCodeConfig` to handle `specialists`.
  - In `scripts/install.mjs`:
    - Read `liteConfig.specialists` and generate `.opencode/agents/<specialist-name>.md` files.
    - When generating `.opencode/agents/command-lead.md`, dynamically inject `permission.task.<specialist-name>: "allow"` into the frontmatter.
    - Keep `scripts/managed-config.mjs` completely untouched.
- **Verification record**:
  - `tests/runtime/lite-config-specialists.test.ts` and `tests/runtime/install-jsonc.test.ts` passed.
  - Installer/config coverage passed as part of the final 190-test regression suite.
  - `node scripts/install.mjs --dry-run` passed without writing files.

#### Slice 1.3: Plugin Runtime Integration & Prompt Documentation
**Status: COMPLETE — 2026-08-28**
- **Target Files**:
  - `.opencode/plugins/bounded-lite.ts` (Edit)
  - `.opencode/agents/command-lead.md` (Edit)
- **Implementation**:
  - In `bounded-lite.ts`, update `updateGeneratedAgentMarkdownFiles` to persist specialist markdown files and sync `command-lead.md` task permissions.
  - In `command-lead.md`, add explicit routing instructions for delegating bounded tasks to registered dynamic specialists when requested by the user or plan.
- **Verification record**:
  - `tests/runtime/plugin-load.test.ts` and `tests/runtime/specialist-permissions.test.ts` passed.
  - Runtime generation verifies hidden leaf-worker frontmatter, scoped edit permissions, and Command Lead delegation.

---

### Phase 2 — Thinking Effort Configuration & Dynamic DAG Dispatch

#### Slice 2.1: Dynamic Lite Config Loading in DAG Dispatch & Readiness Gates
**Status: COMPLETE — 2026-08-28**
- **Target Files**:
  - `.opencode/lib/runtime/task-lead-profiles.ts` (Edit)
  - `.opencode/lib/runtime/plan-dag.ts` (Edit)
  - `.opencode/plugins/bounded-lite.ts` (Edit)
- **Implementation**:
  - Extend `TaskLeadProfileSelection`:
    ```ts
    export interface TaskLeadProfileSelection {
      profile: string;
      matchedAttribute?: string;
      recommendedModel?: string;
      reasoningEffort?: LiteReasoningEffort; // New
      fallbackChain?: string[];
      fallbackPatterns?: string[];
      promptAppend?: string;
    }
    ```
  - In `task-lead-profiles.ts`, update `TaskLeadProfileDispatchConfig` and `resolveTaskLeadProfileDispatch` to resolve and attach configured or default reasoning effort.
  - In `plan-dag.ts`, ensure `TaskDAGNode.dispatch` includes `reasoningEffort`.
  - In `bounded-lite.ts`, modify `bounded_lite_plan_dag` and `bounded_lite_plan_readiness` to execute `await readLiteConfigFile(options.configDir)` at runtime, dynamically incorporating user changes made via `/agent-models`.
- **Verification record**:
  - `tests/runtime/task-lead-profiles.test.ts` and `tests/runtime/plan-dag.test.ts` passed.
  - `tests/runtime/reasoning-effort-dag.test.ts` verified live config reload for both DAG and readiness dispatch.

#### Slice 2.2: Markdown Frontmatter Synchronization & Runtime Profile Reporting
**Status: COMPLETE — 2026-08-28**
- **Target Files**:
  - `.opencode/plugins/bounded-lite.ts` (Edit)
  - `scripts/install.mjs` (Edit)
  - `.opencode/lib/runtime/safety.ts` (Edit)
- **Implementation**:
  - Update `updateGeneratedAgentMarkdownFiles` in `bounded-lite.ts` and `writeManagedAgentMarkdownFiles` in `install.mjs`:
    - If `liteConfig.roleReasoningEffort[role]` is set, write `reasoningEffort: "<effort>"` into agent markdown frontmatter.
    - If not set, omit `reasoningEffort` to preserve interactive session control.
  - Update `createRuntimeProfile` in `safety.ts` with optional additive fields:
    ```ts
    export interface RuntimeProfile {
      mode: "full" | "degraded";
      hooksEnabled: boolean;
      backgroundEnabled: boolean;
      bundledMcpEnabled: boolean;
      visibleModes: readonly string[];
      roleNames: readonly RoleName[];
      canonicalStates: readonly string[];
      roleReasoningEffort?: Partial<Record<RoleName, LiteReasoningEffort>>; // Additive
      taskLeadProfileReasoningEffort?: Record<string, LiteReasoningEffort>; // Additive
      specialists?: string[]; // Additive
    }
    ```
  - In `bounded-lite.ts`, have `bounded_lite_runtime_profile` populate these additive fields from the effective config.
- **Verification record**:
  - `tests/runtime/plugin-load.test.ts` verified persisted and omitted reasoning-effort frontmatter behavior.
  - Runtime profile and conformance/degraded-mode suites passed with additive fields.

#### Slice 2.3: Model Config Tool Enhancement
**Status: COMPLETE — 2026-08-28**
- **Target Files**:
  - `.opencode/lib/runtime/model-config.ts` (Edit)
  - `.opencode/plugins/bounded-lite.ts` (Edit)
- **Implementation**:
  - Update `bounded_lite_model_config`:
    - `action: "list"`: Output summary of role models, role reasoning efforts, Task Lead profiles, and registered specialists.
    - `action: "auto"`: Output recommended reasoning efforts alongside model recommendations.
    - `action: "apply"`: Accept optional `specialistAssignments` to configure model and reasoning effort on registered specialist agents.
- **Verification record**:
  - `tests/runtime/model-config.test.ts` passed specialist summaries, validation, assignment, and warning cases.
  - `tests/runtime/plugin-load.test.ts` verified `specialistAssignments` persistence and generated markdown synchronization.

---

### Phase 3 — Verification & Testing Strategy

#### Slice 3.1: Unit & Integration Tests
**Status: COMPLETE — 2026-08-28**
- **New Test Files**:
  - `tests/runtime/specialist-registry.test.ts`:
    - Schema validation, name collision guards (cannot collide with 8 core roles or `build`/`plan`).
    - Permission generator checks ensuring `"*": "deny"` is first in `permission.edit` and `permission.task: { "*": "deny" }`.
    - Markdown frontmatter generation.
  - `tests/runtime/specialist-permissions.test.ts`:
    - Test that dynamic specialists are correctly given folder-scoped permissions.
    - Test that `command-lead` can delegate to registered specialists.
    - Test that specialists cannot delegate to other subagents (depth = 1 invariant).
  - `tests/runtime/reasoning-effort-dag.test.ts`:
    - Test that `bounded_lite_plan_dag` propagates configured `reasoningEffort` into `TaskDAGNode.dispatch`.
    - Test dynamic reloading of `oh-my-lite-openagent.json`.
- **Existing Test Suites to Verify**:
  - `tests/config/agents.test.ts` (Must remain 100% passing; `managed-config.mjs` unchanged)
  - `tests/config/parity.test.ts` (Must remain 100% passing)
  - `tests/config/permissions.test.ts` (Must remain 100% passing)
  - `tests/integration/conformance.test.ts` (Must remain 100% passing)
  - `tests/integration/degraded-mode.test.ts` (Must remain 100% passing)
- **Verification record**:
  - Added and passed `tests/runtime/specialist-permissions.test.ts` (2 tests).
  - Added and passed `tests/runtime/reasoning-effort-dag.test.ts` (1 test).
  - Full suite passed: 190 tests across 22 files.

#### Slice 3.2: Full Regression & Gate Verification
**Status: COMPLETE — 2026-08-28**
Execute full validation commands:
1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `node scripts/install.mjs --dry-run`
- **Verification record**:
  - `npm run typecheck` — passed.
  - `npm test` — passed (190 tests across 22 files).
  - `npm run build` — passed.
  - `node scripts/install.mjs --dry-run` — passed; no files were written.
