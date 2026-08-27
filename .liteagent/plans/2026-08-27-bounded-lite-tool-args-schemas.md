---
plan_schema_version: 2.1
plan_id: bounded-lite-args-schemas-20260827
title: Add explicit argument schemas to bounded_lite_* OpenCode tools
maturity_level: M2
status: reviewed
generated_by: deep_plan_builder
updated_at: 2026-08-27T13:17:33Z
recommended_plan_path: .liteagent/plans/2026-08-27-bounded-lite-tool-args-schemas.md
---

# Add explicit argument schemas to `bounded_lite_*` OpenCode tools

## goals

- Make every custom `bounded_lite_*` tool expose a non-empty, OpenCode-compatible `args` shape so the model can discover and submit valid tool calls.
- Preserve the existing runtime validators, accepted aliases, defaults, dispatch behavior, and error messages unless a test proves that a compatibility adjustment is required.
- Add a focused regression test that fails if any registered tool omits `args` or loses a required top-level argument key.
- Keep the change upgrade-safe for this public fork: modify the source repository only, add no dependency, and leave `/update-lite` and `scripts/install.mjs` behavior unchanged.

## scope_boundaries

### In scope

- `.opencode/plugins/bounded-lite.ts`: add explicit raw argument shapes to all nine registered tools.
- `.opencode/lib/runtime/plugin-types.ts`: make the local tool-definition contract require an `args` shape if needed to make omission a compile-time error.
- `tests/runtime/plugin-load.test.ts`: assert registration and representative schema acceptance.
- The plan artifact and `.liteagent/plan-index.jsonl` entry for this work.
- Validation of source loading, TypeScript, tests, build, and the existing installer dry-run path.

### Out of scope

- Replacing existing runtime parsing or validation with new Zod schemas.
- Renaming tools, changing tool descriptions, changing handler selection, or changing the `execute` return contract.
- Changing the payload formats accepted by `buildTaskDAG`, `validatePlanReadiness`, or `persistPlanArtifact`.
- Adding a direct `zod` dependency, changing `package.json`, `package-lock.json`, or introducing a schema library.
- Rewriting all tool definitions through the `tool()` wrapper; the minimal fix is to add `args` to the existing definitions.
- Modifying `scripts/install.mjs`, `/update-lite`, `opencode.json`, global configuration, or installed copies under `~/.config/opencode/`.
- Committing, pushing, merging, or releasing unless separately authorized.

## evidence

- Repository: `/home/rconnor/app-dev/oh-my-lite-openagent`.
- Current branch snapshot observed during exploration: `feature/gl/args-fix` at `10bdb0bd1808fe76a7362f13ef2f04fbef1cb5ac`; worktree was clean and the `origin` fork plus fetched `upstream` remote were present.
- `.opencode/plugins/bounded-lite.ts`: all nine custom tools currently omit `args`, which causes OpenCode to expose empty argument schemas and results in model-side `empty payload` failures.
- `.opencode/lib/runtime/plugin-types.ts`: the local `ToolDefinition` shim currently permits `args?: unknown`; this allows the source omission to compile.
- `tests/runtime/plugin-load.test.ts`: already loads `createBoundedLitePlugin`, obtains `hooks.tool`, and executes tools directly, so it is the smallest existing place for registration and schema regression assertions.
- `.opencode/lib/runtime/plan-dag.ts`: `buildTaskDAG(payload: unknown, dispatchInput: Partial<TaskDispatchConfig> = {})`; the first argument is intentionally opaque at the tool boundary and must remain runtime-validated.
- `.opencode/lib/runtime/plan-readiness.ts`: `validatePlanReadiness(payload: unknown, dispatchInput: Partial<TaskDispatchConfig> = {})`; it has the same opaque payload boundary.
- `.opencode/lib/artifacts/schema.ts` and `spec/plan builder spec.md`: define the plan/artifact payload conventions that the existing runtime validators enforce.
- `scripts/install.mjs`: copies `.opencode/{agents,plugins,lib}` from the source repository into `~/.config/opencode/.opencode/`; no installer change is needed for a source plugin edit.
- `AGENTS.md`: repository validation requires the native project test and typecheck commands; follow its exact command names during execution.
- OpenCode plugin/tool documentation: a custom tool definition uses a Zod raw shape under `args`; the installed `@opencode-ai/plugin` package exposes the supported `tool.schema` constructors. Use that existing package rather than importing a new schema dependency.

## assumptions

- The reported failure is caused by missing tool metadata, not by a change required in the underlying plan or routing payload contracts.
- After `npm ci`, the package resolved from the lockfile remains the source of truth for available `tool.schema` constructors; the install must leave `package.json` and `package-lock.json` unchanged.
- `unknown` is the correct public schema for opaque structured inputs whose existing runtime functions own validation; narrowing those payloads in this patch would duplicate and potentially diverge from the authoritative validators.
- Existing field names and aliases discovered in the plugin are the compatibility surface. The executor must use the current implementation and tests as the final field-name reference rather than inventing new names.
- The user wants a source-repository fix that can later be pulled by `/update-lite`, not a manual patch to the currently installed global copy.

## decisions

1. **Add raw `args` shapes directly to the existing definitions.** This is the smallest change that matches the OpenCode plugin contract and avoids changing execution behavior.
2. **Use `tool.schema` from `@opencode-ai/plugin`.** It is already installed and is the supported integration point; do not add or directly import `zod`.
3. **Keep opaque payloads as `tool.schema.unknown()` and optional dispatch/config values as broad object/primitive schemas.** Runtime functions continue to validate semantic content, while OpenCode receives discoverable top-level fields.
4. **Make `args` required in the local type shim.** Every tool, including no-argument tools, must declare `args: {}`; this turns the original omission into a future type error.
5. **Test both completeness and representative usability.** Key-set assertions catch omissions across all nine tools; representative `safeParse` checks catch malformed shape choices without duplicating every runtime validator.
6. **Do not change installer or update-command code.** The existing copy path already deploys `.opencode/plugins/bounded-lite.ts` and its local library dependencies.

## execution_strategy

- Execute in dependency order: install the exact locked dependencies with `npm ci`, inspect the current tool names and handlers, add schemas and type enforcement, add regression coverage, run focused validation, then run the full repository gates and installer dry-run.
- `npm ci` is an environment prerequisite, not a dependency change: verify it produces no diff in `package.json` or `package-lock.json` before running the baseline test.
- Keep implementation work bounded to two source files and one test file. No task should touch dependency manifests or deployment logic.
- The schema task and test task are sequential because the test must validate the final public argument names. Validation can be split into focused and full-gate passes after both edits exist.
- The plan is safe for a lower-strength executor because it names the exact files, preserves runtime validators, supplies a per-tool schema matrix, and defines explicit stop conditions for uncertain field names or package API differences.

## phase_plan

### Phase 1 — Define the compatibility surface [Completed]

Confirm the nine registered tool names, their current execute handlers, and each handler's accepted top-level inputs. Do not alter behavior.

**Phase acceptance:** the executor can map every tool to a schema entry and can identify which inputs are opaque, optional, boolean, string, array, or record-shaped. (Completed: 9-tool matrix confirmed against baseline tests and handlers)

### Phase 2 — Add schemas and compile-time enforcement [Completed]

Add `args` to every tool using the installed `tool.schema` constructors. Make the local definition require `args` if the existing shim is the only reason omission remains legal.

**Phase acceptance:** all nine tools have explicit args, no new dependency is introduced, and `npm run typecheck` passes. (Completed: all 9 tools expose raw schemas, ToolDefinition requires args, typecheck passes)

### Phase 3 — Add regression coverage [Completed]

Extend `tests/runtime/plugin-load.test.ts` with a complete tool/schema matrix and representative parse checks for the two plan gates, artifact persistence, model configuration, routing, and no-argument/runtime-profile tools.

**Phase acceptance:** the focused test fails on missing `args` or missing required top-level keys and passes against the implementation. (Completed: 9-tool key matrix and representative safeParse assertions verified green in tests/runtime/plugin-load.test.ts)

### Phase 4 — Validate source and upgrade path [Completed]

Run the repository's focused and full validation commands, inspect the final diff, and exercise the installer dry-run without modifying global configuration.

**Phase acceptance:** all required gates pass, the diff is limited to the intended files plus the plan/index artifacts, and the user can deploy by pulling the fork and restarting OpenCode. (Completed: typecheck, focused plugin tests, 18/18 full suite test files, build, and installer dry-run verified green with clean minimal diff)

## plan

  subtasks:
    - id: inspect-tool-contract
      depends_on: []
      attributes: [research, code]
      deliverable: A confirmed nine-tool argument matrix tied to current handlers and runtime validators.
      description: Inspect the current bounded-lite plugin, local tool type shim, tests, and relevant validators before editing; record exact existing field names and aliases.
    - id: add-tool-argument-schemas
      depends_on: [inspect-tool-contract]
      attributes: [code, risk-high]
      deliverable: All nine bounded_lite_* definitions expose explicit OpenCode-compatible args shapes, with no runtime behavior change.
      description: Add tool.schema-based args to every registered tool and require args in the local tool-definition type where appropriate.
    - id: add-schema-regression-test
      depends_on: [add-tool-argument-schemas]
      attributes: [code]
      deliverable: A focused plugin-load regression test covering schema presence, key completeness, and representative parsing.
      description: Extend the existing runtime plugin test rather than creating a new harness; keep the test independent of a live OpenCode process.
    - id: run-validation-and-upgrade-check
      depends_on: [add-schema-regression-test]
      attributes: [code, risk-high]
      deliverable: Passing focused/full validation evidence and a clean, minimal source/install-path diff.
      description: Run typecheck, focused test, full test, build if required by AGENTS.md, diff checks, and installer dry-run; stop on unrelated failures and report them separately.

## task_details

  - id: inspect-tool-contract
    objective: Establish the exact public argument surface before any edit.
    scope:
      files_or_dirs:
        - .opencode/plugins/bounded-lite.ts
        - .opencode/lib/runtime/plugin-types.ts
        - .opencode/lib/runtime/plan-dag.ts
        - .opencode/lib/runtime/plan-readiness.ts
        - .opencode/lib/artifacts/schema.ts
        - tests/runtime/plugin-load.test.ts
      allowed_commands:
        - git status --short
        - git diff -- .opencode/plugins/bounded-lite.ts .opencode/lib/runtime/plugin-types.ts tests/runtime/plugin-load.test.ts
        - npm ci
        - npm test -- tests/runtime/plugin-load.test.ts
      out_of_scope:
        - Editing files.
        - Changing accepted payload fields or runtime validator behavior.
        - Reading or modifying installed files under ~/.config/opencode/.
    depends_on: []
    implementation_notes:
      - Enumerate the nine keys returned by the plugin's `tool` hook and keep their existing names unchanged.
      - Trace each `execute` closure to its called function. Use the current implementation as the source of truth for accepted aliases and optional values.
      - Treat the two plan gate payloads as opaque at the OpenCode boundary because both functions accept `payload: unknown` and perform their own validation.
      - Identify no-argument tools. They still need `args: {}`; omission is not an acceptable representation.
      - Run `npm ci` first to install exactly the lockfile-resolved dependencies. Confirm it leaves `package.json` and `package-lock.json` diff-clean before running tests or inspecting package exports.
      - Confirm the package installed by the lockfile exposes `tool.schema` constructors before choosing exact constructor names. If it does not, stop and escalate rather than adding a dependency or guessing an API.
    steps:
      - Run `npm ci` to install the exact locked dependency set and confirm that `package.json` and `package-lock.json` remain unchanged.
      - Read the tool registry and write a temporary working matrix of tool name, handler, accepted keys, and intended schema kind; do not commit a second matrix file.
      - Check the local `ToolDefinition` type and determine whether making `args` required is compatible with all current tool definitions.
      - Compare the planned key matrix with existing tests and runtime validators; resolve any discrepancy from source evidence before proceeding.
    verification:
      - command: npm ci
        proves: The exact locked dependency set, including `@opencode-ai/plugin`, is available for the baseline and leaves dependency manifests unchanged.
      - command: npm test -- tests/runtime/plugin-load.test.ts
        proves: The existing plugin can be loaded and its current direct execution tests establish a baseline before edits.
    done_criteria:
      - All nine registered tool names are accounted for.
      - Every schema key in the implementation task is backed by an existing handler input or an explicitly justified empty args object.
      - No unresolved field-name ambiguity remains.
    failure_handling:
      - trigger: A handler's accepted keys cannot be established from the current source.
        action: Stop and escalate with the tool name and conflicting evidence; do not invent a schema contract.
      - trigger: `npm ci` fails or changes `package.json`/`package-lock.json`.
        action: Stop and report the environment or lockfile problem; do not edit dependency manifests as part of this plan.
      - trigger: The baseline focused test fails after a clean `npm ci` and before edits.
        action: Stop, report the pre-existing failure, and do not attribute it to this plan.

  - id: add-tool-argument-schemas
    objective: Make OpenCode expose usable argument metadata for every bounded-lite tool without changing execution semantics.
    scope:
      files_or_dirs:
        - .opencode/plugins/bounded-lite.ts
        - .opencode/lib/runtime/plugin-types.ts
      allowed_commands:
        - npm run typecheck
        - git diff --check
      out_of_scope:
        - .opencode/lib/runtime/plan-dag.ts
        - .opencode/lib/runtime/plan-readiness.ts
        - .opencode/lib/artifacts/schema.ts
        - package.json
        - package-lock.json
        - scripts/install.mjs
        - Any handler logic, error strings, tool names, or descriptions.
    depends_on:
      - inspect-tool-contract
    implementation_notes:
      - Add a new `import { tool } from "@opencode-ai/plugin"` in `.opencode/plugins/bounded-lite.ts`; this is not a new dependency because `@opencode-ai/plugin` is already pinned in `package.json`/`package-lock.json`. Do not import `zod` directly.
      - Supply `args` as a raw shape, not a JSON Schema document and not a pre-wrapped object, matching the OpenCode plugin contract.
      - Use the following intended matrix, adjusting only to the exact field names confirmed in the inspection task:
        - `bounded_lite_route`: `category` string; preserve any existing accepted category aliases in runtime code.
        - `bounded_lite_plan_dag`: `payload` unknown and optional `dispatch` record/object, matching `buildTaskDAG(payload, dispatchInput)`.
        - `bounded_lite_plan_readiness`: `payload` unknown and optional `dispatch` record/object, matching `validatePlanReadiness(payload, dispatchInput)`.
        - `bounded_lite_plan_artifact`: required `title` and primary `markdown` (`content` accepted as an alias); optional `action` (default `write`), `planId`/`plan_id`, `maturityLevel`/`maturity_level`, `generatedBy`/`generated_by`, `path`/`recommended_plan_path`, `artifactKind`, `status`, and `overwrite`, each represented with the broadest type already accepted by the handler; do not narrow runtime validation.
        - `bounded_lite_study_ingest`: existing optional `directory` string and `allowExternalDirectory` boolean fields.
        - `bounded_lite_study_package`: existing `stage`/directory/authorization fields, preserving the current stage values and defaults in runtime code.
        - `bounded_lite_model_config`: existing action plus source/provider/model assignment and policy fields; use broad record/array/boolean/string shapes where the handler accepts dynamic maps or aliases.
        - `bounded_lite_background`: `args: {}` if the handler accepts no inputs; otherwise expose only its current optional inputs.
        - `bounded_lite_runtime_profile`: `args: {}` because it reports state without caller input.
      - For an optional argument, use the supported optional constructor/chaining form so omitted values remain valid. Do not make optional runtime inputs required merely to produce a non-empty schema.
      - For opaque payloads, use `tool.schema.unknown()` (or the exact installed equivalent) so OpenCode can submit either the raw serialized payload shape accepted by the existing validator without duplicating it.
      - For dynamic maps, use the installed schema's record/object constructor with an unknown value type unless current handler code proves a narrower primitive type.
      - If the local shim is changed, make `args` required and type it as the repository's broad raw-shape-compatible type. Keep the shim minimal; do not recreate the full upstream SDK type.
      - Keep each existing `execute` function body byte-for-byte unchanged where possible; only add the sibling `args` property and any import/type adjustment needed for it.
    steps:
      - Add the supported `tool.schema` import/reference and define args directly beside each existing tool's description and execute function.
      - Add `args: {}` to every no-input tool rather than leaving it absent.
      - Add the plan gate payload and dispatch shapes without moving validation out of `plan-dag.ts` or `plan-readiness.ts`.
      - Add the artifact, study, model, and route fields confirmed during inspection, preserving current aliases and optionality.
      - Make `args` required in `plugin-types.ts` only if the local type permits omission; update no other type property.
      - Run typecheck and inspect the diff for accidental handler changes or dependency edits.
    verification:
      - command: npm run typecheck
        proves: The new raw shapes and any required local type change compile against the repository and installed plugin package.
      - command: git diff --check
        proves: The source edit has no whitespace errors.
      - command: git diff -- .opencode/plugins/bounded-lite.ts .opencode/lib/runtime/plugin-types.ts
        proves: The patch only adds schema metadata/type enforcement and does not alter runtime handlers.
    done_criteria:
      - Every one of the nine tool definitions contains an `args` property.
      - No-input tools expose `{}`; input tools expose all required top-level keys used by their handlers.
      - Opaque payloads remain runtime-validated and no direct `zod` dependency/import was added.
      - `npm run typecheck` passes.
    failure_handling:
      - trigger: `tool.schema` is unavailable or has a different constructor name than expected.
        action: Inspect the installed `@opencode-ai/plugin` exports and repository lockfile; stop and escalate if an API-compatible choice cannot be confirmed. Do not add `zod` as a workaround.
      - trigger: TypeScript rejects a schema shape because the local shim is too narrow.
        action: Broaden only the local raw-shape type to the smallest compatible type, then rerun typecheck; do not cast away the entire tool definition.
      - trigger: A schema change alters an execute-path test.
        action: Revert the behavioral change and keep the schema broad; runtime behavior is outside this task's scope.

  - id: add-schema-regression-test
    objective: Prevent future tool definitions from silently returning empty or incomplete OpenCode argument schemas.
    scope:
      files_or_dirs:
        - tests/runtime/plugin-load.test.ts
      allowed_commands:
        - npm test -- tests/runtime/plugin-load.test.ts
        - npm run typecheck
      out_of_scope:
        - A live OpenCode server or network-dependent test.
        - Duplicating all semantic validation already covered by runtime modules.
        - Adding a new test framework, fixture system, or dependency.
    depends_on:
      - add-tool-argument-schemas
    implementation_notes:
      - Reuse the existing `createBoundedLitePlugin` loading setup and `hooks.tool` access in `tests/runtime/plugin-load.test.ts`.
      - Add a new `import { tool } from "@opencode-ai/plugin"` in the test only if the raw shape needs `tool.schema.object(...)` wrapping; this reuses the package already pinned in `package.json`, not a new dependency.
      - Assert the complete expected nine-tool name set so a removed or renamed registration is visible.
      - For every tool, assert `definition.args` is defined. This must fail for no-input tools that regress to omitted args.
      - Assert the expected top-level argument key set for input-bearing tools. Sort keys before comparison to avoid order coupling.
      - Add representative parse checks using the schema objects already supplied by the definitions, without importing `zod` directly. At minimum cover: a route category string, an opaque plan payload plus omitted dispatch, an artifact title/action, a study authorization boolean, a model assignment record, and the two `{}` tools.
      - Keep representative values minimal and derived from existing test fixtures/validator examples. Do not assert undocumented business semantics in this metadata test.
      - If the raw shape is not itself a parser, use `tool.schema.object(...)` from that explicit import in the test to model OpenCode's wrapping step; keep any cast local and explain it with the repository's existing types rather than adding a utility abstraction.
    steps:
      - Add an expected tool-to-key matrix near the existing plugin registration test.
      - Load the plugin and retrieve the registered tool map through the existing test path.
      - Assert exact tool names, defined args, and expected keys for each entry.
      - Run minimal `safeParse`/equivalent checks for representative required and optional values, including omitted optional dispatch and empty no-input args.
      - Run the focused test and typecheck; keep the test diff limited to this existing file.
    verification:
      - command: npm test -- tests/runtime/plugin-load.test.ts
        proves: The plugin registers all expected tools and every declared schema accepts the representative valid call shapes.
      - command: npm run typecheck
        proves: Test access to the schema metadata is type-safe.
    done_criteria:
      - The regression test fails if any tool's args is absent.
      - The regression test fails if a required top-level schema key is removed or renamed.
      - The test does not require a running OpenCode process, network access, or new dependencies.
      - Focused test and typecheck pass.
    failure_handling:
      - trigger: The test cannot access a parser from the raw shape with the current package types.
        action: Retain key-presence assertions and use the smallest supported object-wrapper helper or a local unknown cast; do not weaken the production schema.
      - trigger: A representative value fails because it reflects an outdated fixture rather than a schema defect.
        action: Re-read the current handler and existing validator fixture, update only the test value, and record the compatibility reason in the diff.
      - trigger: The test requires importing a package not already present.
        action: Stop and remove that approach; use the existing plugin helper/test utilities.

  - id: run-validation-and-upgrade-check
    objective: Prove the fix is source-correct, regression-safe, and deployable through the existing fork update path.
    scope:
      files_or_dirs:
        - .opencode/plugins/bounded-lite.ts
        - .opencode/lib/runtime/plugin-types.ts
        - tests/runtime/plugin-load.test.ts
        - .liteagent/plans/2026-08-27-bounded-lite-tool-args-schemas.md
        - .liteagent/plan-index.jsonl
      allowed_commands:
        - git status --short
        - git diff --check
        - npm run typecheck
        - npm test -- tests/runtime/plugin-load.test.ts
        - npm test
        - npm run build
        - node scripts/install.mjs --dry-run
      out_of_scope:
        - Running the real installer against ~/.config/opencode/ during repository validation.
        - Editing or deleting unrelated worktree changes.
        - Pushing or merging without explicit authorization.
    depends_on:
      - add-schema-regression-test
    implementation_notes:
      - Run commands from `/home/rconnor/app-dev/oh-my-lite-openagent`.
      - Follow `AGENTS.md` if its exact test/build command differs from the command family listed here; preserve the repository-native command.
      - Run the focused test before the full suite so failures are localized.
      - Use `node scripts/install.mjs --dry-run` only if the script supports that flag. If it does not, inspect its help/source and use its non-mutating verification path; do not run a mutating install as a substitute.
      - Confirm the final diff has no package manifest, lockfile, installer, global config, or installed-copy changes.
      - After source deployment by `/update-lite`, the user must restart OpenCode because plugins are loaded at startup; this is an operational requirement, not a code edit.
    steps:
      - Run `git diff --check` and the focused regression test.
      - Run `npm run typecheck`.
      - Run the full `npm test` suite.
      - Run `npm run build` when required by `AGENTS.md` or when it is an existing repository gate.
      - Exercise the installer dry-run/non-mutating check and inspect that `bounded-lite.ts` remains within the copied plugin set.
      - Review `git diff --stat`, `git diff`, and `git status --short` for scope compliance.
      - Record command outcomes, any pre-existing failures, and the exact final file list for the implementation handoff.
    verification:
      - command: git diff --check
        proves: The complete patch has no whitespace errors.
      - command: npm run typecheck
        proves: Source and tests compile.
      - command: npm test -- tests/runtime/plugin-load.test.ts
        proves: The new schema regression is green in isolation.
      - command: npm test
        proves: Existing behavior remains green across the repository.
      - command: npm run build
        proves: The distributable/source build remains valid when this repository gate exists.
      - command: node scripts/install.mjs --dry-run
        proves: The existing deployment path recognizes the source files without requiring installer changes, when the script supports a dry-run.
      - command: git diff --name-only
        proves: Only intended source, test, and plan/index files changed.
    done_criteria:
      - All applicable repository gates pass, or any pre-existing/unrelated failure is explicitly reported with command output context.
      - The final diff contains no dependency, lockfile, installer, global-config, or installed-copy change.
      - The update path remains: pull the fork's `origin/main`, run `/update-lite`, then restart OpenCode.
      - The implementation handoff includes the focused test and full-suite results.
    failure_handling:
      - trigger: Focused schema test fails.
        action: Return to `add-tool-argument-schemas`; compare the failing tool's expected keys with its handler and fix the smallest metadata-only mismatch.
      - trigger: Full suite fails in an unrelated existing test.
        action: Preserve the schema fix, capture the failing command/test, verify the focused test and typecheck, and escalate as a pre-existing or unrelated failure rather than broadening scope.
      - trigger: Installer dry-run would mutate global configuration or the flag is unsupported.
        action: Do not run it mutating; inspect the script's copy list/source path and report deployment verification as manual follow-up.
      - trigger: Diff contains changes outside the allowed list.
        action: Stop, restore only accidental changes if they belong to this task, and ask before touching unrelated user work.

## verification_strategy

1. **Baseline:** run the existing focused plugin test before implementation so pre-existing failures are distinguishable.
2. **Static scope check:** run `git diff --check` after edits and again before handoff.
3. **Typecheck:** run `npm run typecheck` after the production schema/type changes and after the test changes.
4. **Focused regression:** run `npm test -- tests/runtime/plugin-load.test.ts`; this proves tool registration, args presence, key completeness, and representative schema usability.
5. **Full suite:** run `npm test`; this guards all existing runtime behavior and compatibility paths.
6. **Build:** run `npm run build` if required by `AGENTS.md` or listed as a repository gate.
7. **Deployment inspection:** use the installer's non-mutating/dry-run path if supported, then inspect `scripts/install.mjs` and the final diff to confirm the source plugin is already in the deployment set.
8. **Manual post-deploy check:** after the fork is pulled and `/update-lite` is run, restart OpenCode and invoke one no-argument tool plus one payload-bearing tool. This is performed by the user/operator because it affects the installed global configuration.

## risk_and_recovery

- **Schema/API mismatch:** `tool.schema` constructors are package-version-specific. Confirm the installed package API first. If unavailable, stop rather than adding a duplicate schema dependency.
- **Runtime contract drift:** Overly narrow schemas could reject inputs that existing validators accept. Use `unknown`/broad shapes at opaque boundaries and preserve runtime validation.
- **Incomplete coverage:** One omitted tool would leave the bug partially fixed. The exact nine-tool name/key matrix and per-entry `args` assertion are mandatory.
- **Optionality regression:** Making optional dispatch/config fields required would change accepted calls. Mark them optional in the metadata and leave handler defaults untouched.
- **Alias regression:** Route/model/artifact aliases are compatibility inputs. Do not replace them with enum-only schemas unless current code already enforces that exact enum.
- **Type-shim false confidence:** Making `args` required only helps if all local definitions are checked by TypeScript. Keep the regression test as the runtime guard.
- **Installer/config risk:** Installing during validation could modify the user's global OpenCode setup. Use source tests and a dry-run/inspection; deploy only through the existing update flow.
- **Fork/upstream divergence:** Do not overwrite unrelated fork work or resolve upstream changes as part of this fix. If the branch is rebased or merged, rerun the complete validation sequence.
- **Rollback:** If the schema causes runtime incompatibility, revert only the added `args` metadata/type change and its regression test, then preserve the prior source state; no database, installer, or user-config rollback is required.
- **Escalate when:** package API cannot be confirmed, existing field names conflict, baseline tests fail, or validation reveals behavior changes outside schema discovery.

## acceptance_criteria

- [x] All nine `bounded_lite_*` tools registered by `.opencode/plugins/bounded-lite.ts` declare an explicit `args` raw shape.
- [x] No-input tools declare `{}` rather than omitting `args`.
- [x] Input-bearing tools expose every existing required top-level input and preserve current optionality/aliases.
- [x] Plan DAG/readiness payloads remain opaque at the tool schema boundary and continue using their existing runtime validators.
- [x] `@opencode-ai/plugin`'s existing `tool.schema` support is reused; no direct `zod` dependency or lockfile change is introduced.
- [x] `tests/runtime/plugin-load.test.ts` fails on missing args or missing required schema keys and passes for representative valid calls.
- [x] `npm run typecheck`, focused tests, and full tests pass; build passes when it is a repository gate.
- [x] The diff does not modify handlers, tool names/descriptions, installer code, update-command behavior, global config, or installed copies.
- [x] The fork deployment path remains pull → `/update-lite` → restart OpenCode.

## plan_review

- reviewer: Plan Review agent
- verdict: pass
- findings: []
- revisions:
  - Added `npm ci` as the locked-dependency prerequisite before baseline testing, with manifest diff checks and failure handling.
  - Corrected the artifact schema matrix to use primary `markdown`, the `content` alias, and all confirmed optional alias pairs.
  - Clarified that `import { tool } from "@opencode-ai/plugin"` is a new source/test import from an already-pinned dependency, not a dependency addition.
- major_findings_unresolved: false
- review_note: Plan Review passed on the revised artifact; no blocking findings remain. Execution dispatch remains owned by Command Lead.
