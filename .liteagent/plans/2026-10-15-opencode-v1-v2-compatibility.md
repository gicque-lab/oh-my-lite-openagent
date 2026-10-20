---
plan_schema_version: "2.1"
plan_id: opencode-v1-v2-compatibility-20261015
title: Dual OpenCode v1/v2 support and reliable plan validation
maturity_level: M3
status: reviewed
active_node: C05+C06 (Phase 2 — next, NOT started; awaiting user go-ahead)
generated_by: deep_plan_builder
updated_at: 2026-10-20T00:00:00Z
recommended_plan_path: .liteagent/plans/2026-10-15-opencode-v1-v2-compatibility.md
---

# Dual OpenCode v1/v2 support and reliable plan validation

This is a planning artifact, not authorization to implement, install globally, publish, or advance canonical state. Command Lead retains execution-readiness, dispatch, approval, and state ownership. All review-facing material is in English.

## goals

1. Support OpenCode **v1.18.29 and newer v1 releases**, including the user's **v1.19.1**, and OpenCode **v2**, initially verified against **v2.0.30**.
2. Keep one set of orchestration/business rules and use small, separately typed v1/v2 host adapters. Preserve the three visible entrypoints, eight fixed roles, optional registered specialists, bounded delegation, and existing workflows.
3. Install successfully from both a source checkout and the published-package tarball into a clean configuration directory, without inheriting this checkout's `node_modules`.
4. Preserve both legacy and native v2 user configuration, credentials, third-party plugins, custom agents, permissions, and model selections. Do not perform a general config conversion.
5. Fix recurring plan-submission errors at their actual boundaries: explicit structured argument schemas, clear format diagnostics, unchanged safety gates, complete examples, and host-exposed-schema regression tests.
6. Repair related demonstrated defects in runtime-client/context handling and unsafe permission-hook assumptions; investigate other failures only within these compatibility and validation paths.

## scope_boundaries

### in

- `.opencode/plugins/bounded-lite.ts`; `.opencode/lib/**`; `.opencode/agents/**`; one new `.opencode/server.ts` shim outside auto-discovery directories.
- `scripts/install.mjs`, `scripts/install-paths.mjs`, `scripts/managed-config.mjs`; narrowly scoped script/fixture files needed for compatibility testing.
- Root and nested package manifests/lockfiles, `tsconfig.json` only if required for actual SDK typing, `.github/workflows/ci.yml`, and relevant tests.
- English `README.md`, `AI-INSTALL.md`, `AGENTS.md`, and relevant English architecture/compatibility documentation.
- Installer-generated files in isolated test configuration directories; a dedicated managed runtime directory rather than modifying users' dependency manifests.
- Plan objects, their tool schemas and diagnostics, current artifact aliases, prompt handoff examples, and schema projection through the real hosts.
- Full and degraded modes, `/agent-models`, `/go`, `/study`, `/update-lite`, generated role/specialist Markdown, profile metadata, backup/rollback behavior.

### out

- No implementation as part of this planning session. No writes to personal global config, credential stores, or external directories without separate authorization.
- No project-root `opencode.json`, fixes in `dist/`, role renaming, extra visible modes, extra orchestration layers, or alternate model-routing control planes.
- No TUI plugin/UI extension: this repository is a server plugin and installer. Do not add `@opencode/plugin/tui`, Solid, OpenTUI, or optional TUI peers.
- No support claim for v1 releases earlier than 1.18.29, arbitrary future v2 releases, or the v2 raw-Node host on Node 20.19.
- No native-v2-to-v1 config downgrade, automatic whole-file v2 conversion, credential migration, broad permission/policy redesign, general Markdown/YAML parser, or new compatibility framework.
- Existing non-English documents need not all be translated. Any excerpt or changed document the user must review must be provided in English; do not make a non-English document a required review input.
- No commits, publication, installation of a different system `opencode` binary, or deletion of existing plan/index records.

## evidence

Repository snapshot: `3b702f7` (`feat: add specialist agents and reasoning configuration`); initial `git status --short` was empty. Evidence collected 2026-10-15. Line ranges describe this snapshot, not proposed file locations.

### Structured upstream inputs

The following are selected, traceable evidence fragments from the scoped Explore/Librarian returns. They are inputs to this plan, not substitutes for their cited sources. External moving documentation is supplemented by tagged source wherever behavior differs.

```yaml
upstream_inputs:
  - role: explore
    task_id: ses_ebe7b1a5effe6tf3HZ0m7v2Dtk
    fragments:
      - id: plugin-entrypoint
        path: .opencode/plugins/bounded-lite.ts
        lines: [1301-1354, 1827-1843]
        fact: The default export is a legacy factory returning config, tool, permission.ask, and tool.execute hooks. The config hook only checks the maxChildDepth option; the execute hooks are effectively no-ops.
        implication: Port real behavior, not no-op hooks, and validate depth options during both host initializations.
      - id: custom-context-types
        path: .opencode/lib/runtime/plugin-types.ts
        lines: [3-12, 31-62]
        fact: Local types conflate plugin initialization and tool execution; the SDK client is unknown and the factory discards its initialization input.
        implication: Local mocks can pass while real host invocation fails; use official SDK types at adapters and an explicit SDK-neutral operation context internally.
      - id: runtime-provider-root-cause
        path: .opencode/plugins/bounded-lite.ts
        lines: [1175-1199, 1546-1566]
        fact: Runtime model discovery reads input.client from the tool execution context, although the inspected official v1 ToolContext has no client field.
        implication: Capture the initialization client, do not move it into synthetic tool arguments.
      - id: permission-sdk-shape
        path: .opencode/plugins/bounded-lite.ts
        lines: [1827-1830]
        fact: The hook calls input.tool.startsWith and unconditionally changes matching decisions to allow; inspected v1 SDK Permission declares type rather than tool.
        implication: Remove the unsupported-field assumption and never overwrite an explicit deny/ask merely because a name has the plugin prefix.
      - id: dependency-pins
        path: package.json; .opencode/package.json; scripts/install.mjs
        lines: [package.json:55-57, .opencode/package.json:1-5, scripts/install.mjs:1184-1192]
        fact: Root pins @opencode-ai/plugin 1.14.29; nested development pins 1.18.34. The published files omit the nested manifest and installer only copies managed directories without installing dependencies.
        implication: Align tested dependency environments and prove copied-plugin dependency resolution on clean installs.
      - id: model-config-write
        path: .opencode/plugins/bounded-lite.ts
        lines: [989-1087, 1771-1779]
        fact: Model apply writes oh-my-lite-openagent.json and generated global agent Markdown; writeOpenCodeConfig exists but is not the active write path.
        implication: Adapt the actual writer, not an unused JSON writer. Preserve the separate lite-config file.
      - id: installer-merge
        path: scripts/install.mjs
        lines: [642-655, 697-750, 822-909, 934-961, 1093-1130]
        fact: Managed detection/options/config merging use legacy plugin/agent/permission/command fields; generated agents go to config-dir/agents.
        implication: Native settings can shadow newly written legacy settings. Make the complete managed read/write path dialect-aware.
  - role: explore
    task_id: ses_ebe7b1a14ffe33uiUsxCjdGKr3
    fragments:
      - id: E1
        path: .opencode/plugins/bounded-lite.ts
        lines: [1338-1372]
        fact: Plan tools explicitly declare payload as tool.schema.unknown and dispatch as an optional record, then read args.payload.
        implication: Current source does not reproduce missing declarations; opaque schemas still admit invalid formats and can project poorly.
      - id: E2
        path: .opencode/lib/runtime/plan-readiness.ts
        lines: [54-85, 103-142, 204-218]
        fact: A Markdown string supplies only parsed frontmatter; required sections are read from objects, and the original string still reaches the DAG validator.
        implication: A complete saved Markdown plan is not a valid readiness payload. Reject the format once with an actionable message rather than misleading missing-section errors.
      - id: E3
        path: .opencode/lib/runtime/plan-dag.ts
        lines: [14-26, 121-199, 248-297]
        fact: The DAG requires an object containing plan.subtasks with id, depends_on, attributes, deliverable, and description. Its payload types are defined here, not in artifacts/schema.ts.
        implication: Reconcile the advertised authoritative schema entrypoint with the actual executable-plan contract without touching canonical-state ownership.
      - id: E8
        path: .opencode/plugins/bounded-lite.ts; tests/runtime/plugin-load.test.ts
        lines: [bounded-lite.ts:1374-1403, plugin-load.test.ts:145-164]
        fact: The artifact schema accepts title-only input although the handler requires title and markdown or content; schema-only tests never execute that input.
        implication: Add shared cross-field validation and handler-level tests, preserving content and metadata aliases.
      - id: E10
        path: tests/runtime/plugin-load.test.ts; .liteagent/plans/2026-08-27-bounded-lite-tool-args-schemas.md
        lines: [plugin-load.test.ts:55-172, historical-plan:41-53]
        fact: The current test matrix declares all nine tools; only background and runtime_profile are intentionally no-input. A prior missing-args defect was already fixed.
        implication: Do not repeat that old fix or assert a stale installed plugin is proven. Test final provider-visible schemas and actual calls.
  - role: librarian
    task_id: ses_ebe7b19c8ffedXRkTd2Inv979z
    fragments:
      - id: PLUG-01
        url: https://opencode.ai/v2/docs/build/plugins/migrate-v1
        section: Support V1 and V2 from one package
        fact: A single default-exported object can spread Plugin.define({id,setup}) and include server(). V1 calls server and v2 calls setup. V1 object entrypoints require 1.18.29+.
        implication: Use one dual entrypoint and separate adapters; renaming config cannot port hooks.
      - id: CFG-01
        url: https://opencode.ai/v2/docs/migrate-v1
        section: Configuration; Plugins; Agent files
        fact: Supported legacy config/files remain accepted. Native keys include plugins, agents, commands, permissions and providers; native values take precedence. Individual nested agent/provider/command/model entries must not mix formats.
        implication: Keep legacy configs legacy, preserve native entries as native, and test mixed top-level precedence.
      - id: TOOL-01
        url: https://github.com/anomalyco/opencode/blob/v2.0.30/packages/plugin/src/promise/tool.ts
        section: ToolHooks; ToolContext
        fact: V2 before-hooks receive one mutable event.input; after-hooks discriminate completed/error. Tool contexts have IDs and signal, not directory/client/location.
        implication: Resolve operation location from the session using sessionID, not process.cwd or the plugin instance's canonical checkout.
      - id: CAT-01
        url: https://github.com/anomalyco/opencode/blob/v2.0.30/packages/client/src/promise/generated/types.ts
        section: AgentListOutput; ModelListOutput; ProviderListOutput
        fact: API list methods return location/data envelopes. Provider metadata does not itself contain model inventories; ctx.model.list supplies models.
        implication: Normalize result.data and model providerID/id explicitly rather than applying the old provider parser blindly.
      - id: AGENT-04
        url: https://opencode.ai/v2/docs/agents#request
        section: Request
        fact: Per-agent request overlays are preserved but not currently sent by the v2 session runner. Plugin context request hooks can set semantic event.options.reasoningEffort.
        implication: Do not advertise reasoning support based on request.body serialization alone; verify an effective request or use a verified model variant.
      - id: SUB-01
        url: https://github.com/anomalyco/opencode/blob/v2.0.30/packages/core/src/tool/plugin/subagent.ts
        section: Input; execute; available subagent catalog
        fact: The tool is subagent with agent/prompt/description and optional sessionID/model/background; default session depth is 1. Hidden agents are excluded from its advertised catalog but can be resolved by ID.
        implication: Preserve hidden roles while supplying their permitted IDs to model context; map invocation fields and session-depth limits deliberately.
      - id: V2-DEPS-01
        url: https://github.com/anomalyco/opencode/blob/v2.0.30/packages/core/src/plugin/module.ts
        section: PluginModule.load
        fact: Local-plugin loading does not install external dependencies. The v2 host supplies its own @opencode/plugin runtime module.
        implication: Test host module identity and install other dependencies explicitly; do not rely on workspace resolution.
      - id: PKG-01
        url: https://registry.npmjs.org/%40opencode%2Fplugin/latest
        section: Published manifest, fetched 2026-10-15
        fact: Current v2 plugin package is @opencode/plugin 2.0.30; the v1 package line is @opencode-ai/plugin 1.19.1.
        implication: Do not confuse v1 SDK /v2 subpaths with the OpenCode v2 product API.
  - role: librarian
    task_id: ses_ebe68085affe8Gb6BisvXhSdid
    fragments:
      - id: directory-entrypoint
        urls:
          - https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/plugin/shared.ts
          - https://github.com/anomalyco/opencode/blob/v1.19.1/packages/opencode/src/plugin/shared.ts
          - https://github.com/anomalyco/opencode/blob/v2.0.30/packages/plugin/src/host.ts
          - https://github.com/anomalyco/opencode/blob/v2.0.30/packages/core/src/config/plugin/source.ts
        fact: V1 directory packages resolve the ./server export. V2 configured local targets must be directories and probe server then index; an arbitrary package export to plugins/bounded-lite.ts is insufficient.
        implication: Use a package directory with server.ts plus a ./server export, verified by an early actual-host spike.
      - id: discovery-boundary
        url: https://github.com/anomalyco/opencode/blob/v2.0.30/packages/core/src/config/discovery.ts
        fact: Global config root and project .opencode are distinct discovery sources; a nested .opencode under the global config is not the global plugin discovery root.
        implication: Keep the managed runtime in a dedicated non-discovered namespace and register it once; detect duplication in real hosts.
      - id: node-caveat
        urls:
          - https://github.com/anomalyco/opencode/blob/v2.0.30/packages/util/src/runtime/import.node.ts
          - https://nodejs.org/docs/v20.19.0/api/module.html
        fact: Tagged v2 Node loading paths use registerHooks, absent from Node 20.19. Published package metadata does not establish a Node host support floor.
        implication: Separate installer Node support from official Bun-hosted OpenCode support; verify SDK imports under actual test runners instead of assuming the whole project must raise engines.node.
```

Additional direct facts:

- `.opencode/lib/contracts.ts:25-29,75-143`: orchestrator depth is 1; permitted delegation includes `command-lead -> deep-plan-builder -> plan-review -> explore`. The latter needs three **session** child levels, which is not three child orchestrators.
- `.opencode/lib/artifacts/schema.ts:10-65` and `state-machine.ts` own artifact kinds/ownership/state transitions. They must remain authoritative; executable-payload validation can be exported through this schema entrypoint without changing lifecycle authority.
- `package.json:38-58`, `tsconfig.json:1-17`, `.github/workflows/ci.yml:10-33`: installer Node floor is 20.19; CI currently runs Vitest/typecheck on Linux/Windows with Node 20.19; only `.opencode/**`, tests and Vitest config are TypeScript source inputs.
- Baseline run in this planning session: `TMPDIR=/home/rconnor/oh-my-lite-openagent/.liteagent npm test` passed **22 files / 190 tests**; `npm run typecheck` passed. This does **not** establish real v1/v2 host compatibility.
- Official general migration guide: <https://opencode.ai/v2/docs/migrate-v1>; plugin migration: <https://opencode.ai/v2/docs/build/plugins/migrate-v1>; plugin API: <https://opencode.ai/v2/docs/build/plugins>; permissions: <https://opencode.ai/v2/docs/permissions>; agents: <https://opencode.ai/v2/docs/agents>; client: <https://opencode.ai/v2/docs/build/client>. Context7 corroborated the combined-entrypoint and tool-transform examples; versioned source wins over stale examples.

### Confirmed versus unconfirmed defects

| Finding | Classification | Treatment |
| --- | --- | --- |
| Raw Markdown passes the opaque argument schema but cannot satisfy readiness/DAG object validation | Confirmed source contract defect | C02: object schemas, early format diagnostic, exact object examples and end-to-end fixture |
| Artifact title-only schema-valid call is rejected by handler | Confirmed cross-field gap | C02: common validation before side effects, explicit descriptions and execution tests |
| Tool execution reads a client that belongs to initialization | Confirmed against inspected SDK types and callers | C03: capture client, realistic context mocks |
| Permission hook assumes `input.tool` and overrides deny/ask | Confirmed unsafe source assumption; exact target-runtime event must be verified | C03/C05: remove prefix auto-allow, preserve host policy and test real shapes |
| Root/nested dependency versions differ; copied runtime has no explicit dependency installation | Confirmed packaging gap | C01/C06: aligned pins and clean packaged installs |
| Current installed session exposes empty args for plan tools | Not reproduced; no failing call or active-plugin version provided | C09: capture active source/version and host-exposed schema; do not assume an old install or blame a provider without evidence |
| Native config can shadow legacy writes; v2 hidden-role discovery/default depth can break delegated workflows | Direct consequence of current source plus official v2 contracts; not live-reproduced here | C04/C07/C09: explicit negative/positive real-host tests |

## assumptions

- The compatibility baseline uses official Bun-hosted OpenCode releases. Raw Node hosting of v2 is not a requested feature.
- No TUI integration is needed; server behavior and installer/configuration are the deliverables.
- Pinned host/SDK versions are the dated starting matrix, not a promise that every later v2 version works. Revalidate source/package differences before finalizing pins.
- Network access is needed during implementation for exact host binaries and locked runtime dependencies. Tests must never replace the user's installed `opencode` executable.
- Existing separate `oh-my-lite-openagent.json` remains the plugin's source of truth for role/profile/specialist preferences. Runtime host registries are not configuration-file writers.
- The supported saved-plan representation remains Markdown for human review and a structured object for executable validation. Arbitrary Markdown/YAML parsing is deliberately not added.
- Nonblocking technical uncertainties are explicit implementation gates in C01/C09, with stop conditions; there is no unresolved user/product decision.

## decisions

1. **[User Confirmed]** Minimum supported v1 is **1.18.29**; the user runs **1.19.1**. Reject a legacy-pre-1.18.29 adapter/distribution: it adds a third compatibility path the user does not need.
2. **[User Confirmed]** Support both legacy and native v2 configs, preserving existing format and unrelated settings. Do not rewrite native configuration into v1 shape.
3. **[User Confirmed]** All communication and review-facing documents/excerpts are English. Fresh subagent instances are preferred for bounded work; reuse a session only when its prior state is genuinely required.
4. Use the documented default-export object containing `id`, v2 `setup()`, and v1 `server()`, with `Plugin.define` checking the v2 definition. Keep **one** discovered entrypoint `.opencode/plugins/bounded-lite.ts`; adapter/helper modules live under `.opencode/lib/compat/` and `.opencode/lib/runtime/`.
5. Reuse the nine existing tool names, output text, pure DAG/readiness/model/profile logic, and existing test runner. Keep two intentional no-input schemas. Do not create a general host abstraction/plugin registry framework.
6. Replace plan tools' `unknown` wire input with a documented **object-only** executable-plan contract. Keep `payload` and optional `dispatch`; **do not** add path/Markdown overloads, guessed wrappers, or double-encoded JSON strings. Saved plans contain one clearly labeled JSON validation object for mechanical handoff.
7. Preserve top-level/nested `frontmatter` and `sections` forms already supported by readiness, extensions, review findings, open questions and self-check fields. Schema normalization must not strip safety-bearing fields. Artifact lifecycle ownership stays unchanged.
8. Use existing Zod capability for v1 schemas and native JSON-Schema generation for v2, after verifying the pinned Zod API. Declare a direct Zod dependency if importing it directly; do not rely on a transitive import or add a second validation library. Use one set of raw shape definitions, not independently maintained schemas per adapter.
9. Install a private runtime package at `<config-dir>/.opencode/oh-my-lite-openagent/`, with `server.ts` and `exports["./server"]`. Its copies of `agents/`, `plugins/`, and `lib/` preserve relative imports. Configure that **directory**, not a `.ts` file. Keep generated active agent files at `<config-dir>/agents/` as today. This adds an explicitly managed runtime manifest/lock/shim to the install boundary; it does not authorize modifying `<config-dir>/package.json` or its lock.
10. Install locked dependencies explicitly in the private namespace before switching configuration. `--dry-run` performs no writes, dependency installs, network bootstrap, or global mutations. Do not install TUI peers or rely on this checkout's dependency tree.
11. Preserve custom-tool policy: no prefix-based unconditional allow. Honor explicit deny/ask and existing outside-directory authorization. Remove no-op hooks rather than porting them. Introduce mutation permission assertions only at touched host boundaries where required, not a broad new policy subsystem.
12. Retain `MAX_CHILD_ORCHESTRATOR_DEPTH = 1`. Separately set/verify the host's bounded **session depth** sufficient for existing allowed chains (v2 `experimental.subagent_depth: 3`) while retaining role allowlists and no further child orchestrator delegation. Do not silently raise a user's explicit stricter depth limit; report a compatibility blocker with the exact failing chain and required change.
13. Preserve hidden internal roles. Add only the permitted hidden-role IDs/descriptions to model-visible delegation guidance/tool descriptions; do not make roles visible to solve v2 catalog omissions.
14. Lite-config reasoning preferences must affect actual requests on supported models. V2 agent `request.body` is not accepted as proof. Prefer an explicitly configured, catalog-verified `#variant`; when no explicit variant exists, apply supported semantic options through a typed request hook. Explicit variants take precedence over conflicting stored effort and produce a warning. Profile recommendations remain advisory unless a verified runtime override is explicitly supported.

## execution_strategy

- Implement only after Command Lead accepts the reviewed plan and runs readiness on the structured object below.
- Start with a small real-loader spike before relocating installer output. Lock its verified layout/API facts as fixtures so later executors do not reinvent them.
- Repair validation contracts next, independently of host-specific behavior; then extract existing handlers and fix the v1 adapter before adding v2.
- Make configuration reading/serialization dialect-aware before connecting v2 or changing the installer.
- C05 (v2 adapter) and C06 (installer/package delivery) may run concurrently after C04: their allowed implementation files differ. They must not both edit the shared core or package pins; return a scoped follow-up if those change.
- C07 integrates role/delegation and depth behavior only after both adapters and installer are available. C08 aligns English prompts/examples. C09 validates the final published contents and actual host surface.
- The DAG permits fewer simultaneous tasks than the 3-5 dispatch ceiling; never invent parallel tasks to fill slots. Shared file ownership and phase barriers take precedence.
- Assign `risk-high`, `security`, `migration`, and `deep` nodes to appropriately capable execution profiles. Lower-strength executors must follow the enumerated checks and stop rather than design an alternative compatibility strategy.
- Use fresh bounded specialist instances by default, include upstream evidence and exact node scope in each assignment, and do not pass placeholder resume IDs.

## phase_plan

| Phase | Nodes | Status | Exit condition |
| --- | --- | --- | --- |
| 0: Establish the real contracts | C01 | ✅ done (commit `6c42a03`) | Official host binaries are isolated; one dual directory entrypoint and dependency-resolution spike passes all three host versions, or implementation stops with a precise blocker |
| 1: Fix shared boundaries | C02-C04 | ✅ done — C02 (`288d203`), C03 (`e09783e`), C04 complete 2026-10-20 (uncommitted: `.opencode/lib/compat/config.ts` + runtime/installer/test changes; 25 files / 260 tests + typecheck + read-only dry-run pass) | Plan calls have meaningful schemas/diagnostics; real v1 contexts work; configuration preserves effective legacy/native values and user data |
| 2: Implement and deliver v2 | C05-C06 | ⬜ **NEXT** (parallel after C04; not started) | Separate typed v2 adapter and clean source/package installer path work without workspace dependencies |
| 3: Preserve orchestration and guidance | C07-C08 | ⬜ pending | Hidden-role delegation, allowed nested chains, permissions, depth and English examples agree in both runtimes |
| 4: Prove compatibility | C09 | ⬜ pending | Matrix, exported schemas, negative gates, packaged installs, rollback and existing regression suite pass; limitations are documented honestly |

### Structured validation payload / executable core

The following is a **JSON object**, not Markdown input. Command Lead should extract this object and call `bounded_lite_plan_readiness({"payload": OBJECT})`, optionally adding `dispatch` as a sibling argument. Do not send this entire file, a JSON string, `args`, or an extra `plan` wrapper. This is a compact executable projection; it does not replace the task instructions or authorize dispatch.

```json
{
  "plan_schema_version": "2.1",
  "maturity_level": "M3",
  "status": "reviewed",
  "goals": ["Support OpenCode v1.18.29+, including v1.19.1, and v2.0.30", "Preserve both user config formats and bounded orchestration", "Fix plan argument contracts and related confirmed defects"],
  "scope_boundaries": {"in": ["Plugin adapters and shared runtime", "Installer, manifests, generated agents and config merging", "Tests, CI and English documentation"], "out": ["Global writes without separate permission", "TUI extensions", "New roles or orchestration layers", "General config conversion"]},
  "acceptance_criteria": ["Real host and clean packaged-install matrix passes", "Provider-visible plan schemas accept structured calls and reject wrong formats", "Review/open-question/self-check and DAG gates cannot be bypassed", "Legacy/native configuration and user data survive install, update and rollback"],
  "phase_plan": ["C01: prove loaders and dependency contracts", "C02-C04: shared validation, v1 contexts and configuration", "C05-C06: v2 adapter and installer", "C07-C08: orchestration and English guidance", "C09: final host/package compatibility gates"],
  "open_questions": [],
  "plan_review": {"decision": "pass", "findings": [{"severity": "minor", "resolved": true, "location": "C06 Windows npm launch", "issue": "npm.cmd cannot be launched directly using shell-free execFile", "resolution": "Launch a verified npm JavaScript CLI via process.execPath with shell false; add real Windows metacharacter/path and failure tests"}]},
  "plan": {
    "subtasks": [
      {"id": "C01", "depends_on": [], "attributes": ["research", "deep", "migration"], "deliverable": "Pinned host/API evidence and passing isolated dual-entrypoint loader spike", "description": "Verify the shared directory shim, SDK dependency resolution, runtime identities and test-runner constraints on v1.18.29, v1.19.1 and v2.0.30 before production changes."},
      {"id": "C02", "depends_on": ["C01"], "attributes": ["code", "deep", "security"], "deliverable": "One structured plan/tool argument contract with actionable diagnostics and regression tests", "description": "Replace opaque plan wire schemas, preserve existing safety gates and aliases, and test serialized schemas plus valid and invalid tool executions."},
      {"id": "C03", "depends_on": ["C02"], "attributes": ["code", "deep", "security"], "deliverable": "Shared existing handlers and SDK-typed v1 adapter with context/client and permission defects repaired", "description": "Separate host plumbing from existing behavior, capture the real initialization client, use actual execution contexts, and remove unsafe auto-allow and no-op hooks."},
      {"id": "C04", "depends_on": ["C03"], "attributes": ["code", "migration", "risk-high"], "deliverable": "Dialect-aware config access and safe generated-agent/model preference persistence", "description": "Read effective legacy/native values and update only managed entries without shadowed writes, mixed nested formats, lost variants, reordered user permissions or unrelated mutations."},
      {"id": "C05", "depends_on": ["C04"], "attributes": ["code", "deep", "security"], "deliverable": "Typed v2 domain adapter and documented combined default export", "description": "Register all existing tools through replayable transforms, normalize v2 contexts/catalogs/results, preserve cancellation and policy, and apply effective reasoning options safely."},
      {"id": "C06", "depends_on": ["C04"], "attributes": ["code", "migration", "risk-high"], "deliverable": "Clean source/tarball installer with private runtime dependencies, backups and rollback", "description": "Install the verified directory shim and locked dependencies in a dedicated namespace, preserve both config dialects, migrate only known managed specs and keep dry runs side-effect-free."},
      {"id": "C07", "depends_on": ["C05", "C06"], "attributes": ["code", "deep", "security"], "deliverable": "Equivalent role visibility, permitted delegation and bounded host-depth behavior on both runtimes", "description": "Map task/subagent contracts, expose permitted hidden IDs only to model guidance, distinguish session depth from orchestrator depth, and verify allowed and forbidden delegation chains."},
      {"id": "C08", "depends_on": ["C07"], "attributes": ["docs", "writing"], "deliverable": "English compatibility, validation handoff, install/update and recovery documentation", "description": "Align agent prompts, managed command templates and review-facing documentation with actual argument shapes, version boundaries, config preservation and restart/rollback instructions."},
      {"id": "C09", "depends_on": ["C08"], "attributes": ["code", "deep", "risk-high"], "deliverable": "Passing Linux/Windows regression coverage and pinned real-host/package compatibility report", "description": "Run final source and packaged-install matrix, inspect provider-visible schemas and actual calls, exercise safety failures and cleanup, and block release for unresolved compatibility defects."}
    ]
  }
}
```

## task_details

### C01 — Verify host/package contracts before committing to a layout

```yaml
id: C01
objective: Establish a reproducible compatibility baseline and remove dependency/loader guesswork.
scope:
  files_or_dirs: [package.json, package-lock.json, .opencode/package.json, .opencode/package-lock.json, tests/fixtures/opencode-compat/**, tests/integration/opencode-host-smoke.test.ts, scripts/test-opencode-compat.mjs, .liteagent/scratch/opencode-compat/**]
  allowed_commands: [git status/diff, npm test, npm run typecheck, npm ci, npm view, npm pack, explicitly pinned OpenCode binaries under isolated environment variables]
  out_of_scope: [production plugin refactoring, personal config, system binary replacement, TUI installation, global npm installation]
depends_on: []
implementation_notes:
  - Use SDK/runtime versions verified at execution time; initial pins are @opencode-ai/plugin 1.19.1 and @opencode/plugin 2.0.30. Align root/nested declarations and locks, recording the exact shared Zod version/API.
  - Verify actual published package JS/types against tagged source; source manifests can differ from published manifests.
  - Create fixture-only directory entry with server.ts and package exports ./server; default export has stable id, setup and server. Register one harmless echo tool in each host path.
  - Declare any directly imported Zod package explicitly; use its existing JSON-Schema facility, not a new validator/converter framework.
  - Keep Node 20.19 installer support separate from SDK test-host compatibility. If a v2 SDK import requires a newer Node runner, isolate adapter smoke tests under the official Bun host or a verified newer CI Node; do not raise the installer engine without evidence and an explicit documented consequence.
steps:
  - Record pristine/dirty baseline and existing tests; do not overwrite unrelated changes.
  - Add a bounded smoke runner with pinned, separately addressed host executables; no PATH replacement. Put config, HOME/XDG state, temp, dependency cache, test artifacts and logs under project .liteagent/scratch/opencode-compat.
  - Prove the directory shim loads exactly once in all three hosts, accepts options and dependencies from its own directory, and resolves v2 host runtime modules without foreign-copy identity errors.
  - Confirm the session-get location field and official v1 permission/tool contexts from the pinned SDKs; save minimum typed fixtures plus citations.
  - Capture a host-exported tool schema for the echo tool and a successful structured call; this mechanism will be reused for final plugin schemas without relying on an LLM guessing a tool call.
  - Run a direct SDK import/typecheck under the current unit-test environment and record whether the runner needs the bounded adjustment described above.
verification:
  - command: npm test && npm run typecheck
    proves: Pin/fixture additions do not break existing regressions.
  - command: node scripts/test-opencode-compat.mjs --stage loader
    proves: The runner added by this task exercises exact v1.18.29, v1.19.1 and v2.0.30 hosts, directory entrypoints, options, dependencies, identity and schema capture.
done_criteria:
  - All three isolated loader cases pass without repository node_modules or personal credentials; exact host paths and versions are reported.
  - Root/nested pins and lockfiles agree; the selected install layout and operation-location API are recorded in the fixtures/report.
failure_handling:
  - trigger: A host cannot resolve the shim, needs a different package surface, or reports duplicate/foreign runtime loading.
    action: Stop dependent nodes; return version, source citation, schema/error and a minimal verified layout correction to Command Lead. Do not implement speculative detectors or silently drop a target.
  - trigger: Network access, host binary, or a credential-free execution harness is unavailable.
    action: Mark real-host verification blocked; unit-only evidence is not a substitute for this gate.
```

### C02 — Fix structured validation arguments, schema projection and diagnostics

```yaml
id: C02
objective: Make valid plan submissions straightforward and malformed submissions fail once at the correct boundary.
scope:
  files_or_dirs: [.opencode/lib/artifacts/schema.ts, .opencode/lib/artifacts/plan-payload.ts, .opencode/lib/runtime/plan-dag.ts, .opencode/lib/runtime/plan-readiness.ts, .opencode/lib/runtime/tool-contracts.ts, .opencode/plugins/bounded-lite.ts, tests/runtime/plan-readiness.test.ts, tests/runtime/plan-dag.test.ts, tests/runtime/plugin-load.test.ts, tests/runtime/plan-artifact.test.ts, tests/fixtures/plans/**]
  allowed_commands: [npm test, npm run typecheck, local fixture/schema inspection]
  out_of_scope: [changing review decisions/state ownership, relaxing readiness, arbitrary Markdown or YAML parsing, plan_path overloads, disk reads during readiness]
depends_on: [C01]
implementation_notes:
  - Export the executable plan payload contract via artifacts/schema.ts while preserving artifact-record/state ownership exports. Make plan-dag consume or re-export that same contract instead of maintaining a second incompatible shape.
  - Define reusable Zod raw tool shapes and convert their object schema to v2 JSON Schema using the pinned supported API. Required payload must be an object with typed plan.subtasks; dispatch remains optional and existing valid options remain accepted.
  - Preserve nested frontmatter/sections compatibility and extension metadata. Use passthrough/explicit fields as appropriate so plan_review/review, open_questions, self_check and their nested severity/resolved flags reach the unchanged runtime gates.
  - Do not require extra human document sections in the wire object or flatten away existing fields. DAG-only calls may supply plan.subtasks without readiness metadata.
  - Reject missing payload, arrays, null, Markdown strings and JSON-encoded strings with an explicit example of the expected named payload object; do not guess extra wrappers or silently JSON.parse string input.
  - Required semantic fields and DAG correctness remain runtime checks so incomplete structured plans yield useful revise/blocked results rather than losing review information at the adapter.
  - Keep artifact content and metadata aliases. If the v1 raw-shape helper cannot express title-plus-one-of-markdown/content at the root, document the cross-field rule and enforce it in a shared boundary guard before writing; do not pretend schema-only acceptance guarantees execution.
steps:
  - Add a valid structured fixture with all required fields and a matching human Markdown plan whose labeled JSON block can be extracted with JSON.parse in the test harness.
  - Add shared wire contracts and early input-format validation. Keep readiness/DAG result keys and semantic decisions stable; direct runtime callers also receive the clear wrong-format diagnostic.
  - Replace opaque plan payload declarations and add property descriptions plus exact minimal examples. Give artifact title/content/action/enum errors specific diagnostics.
  - Test the actual serialized v1 JSON Schema and v2 JSON Schema, not only Object.keys or wrapping args in Zod. Both must expose payload and its plan/subtasks fields; the two no-input tools remain empty.
  - Exercise handlers with valid input, title-only artifact input, content alias input, absent/wrong payload and optional dispatch. Invalid inputs must cause no writes or config changes.
  - Add adversarial checks that normalization preserves unresolved major findings, blocking questions, self-check blockers, unknown dependencies, duplicate IDs and cycles.
verification:
  - command: npm test -- tests/runtime/plan-readiness.test.ts tests/runtime/plan-dag.test.ts tests/runtime/plan-artifact.test.ts tests/runtime/plugin-load.test.ts
    proves: Structured calls, schema projection, actionable failures, aliases and existing safety gates are exercised.
  - command: npm run typecheck
    proves: One payload/schema source is consumed consistently without SDK-typed escape hatches.
done_criteria:
  - The documented structured fixture succeeds; raw Markdown fails with one format explanation, not a cascade of misleading missing sections.
  - Neither schema conversion nor adapter parsing strips a review/open-question/self-check blocker.
  - Artifact title-only calls fail before I/O; markdown/content aliases succeed; all nine names remain stable.
failure_handling:
  - trigger: Schema conversion yields an empty/invalid payload schema or loses runtime-required fields.
    action: Fix the source schema/conversion at the common boundary; do not patch every prompt or add provider-specific guessed arguments.
  - trigger: A provider rejects valid recursive/open JSON-Schema constructs.
    action: Capture the final rejected schema; simplify only its wire representation while preserving common runtime validation. Never remove a safety gate to satisfy projection.
```

### C03 — Extract existing behavior and repair the v1 host boundary

```yaml
id: C03
objective: Preserve existing functionality behind a small SDK-neutral runtime and a correctly typed v1 adapter.
scope:
  files_or_dirs: [.opencode/plugins/bounded-lite.ts, .opencode/lib/runtime/bounded-lite-core.ts, .opencode/lib/runtime/plugin-types.ts, .opencode/lib/compat/v1.ts, tests/runtime/plugin-load.test.ts, tests/runtime/study*.test.ts, tests/integration/degraded-mode.test.ts]
  allowed_commands: [npm test, npm run typecheck, isolated v1 smoke runner]
  out_of_scope: [new tools, new coordinator, unrelated study extraction changes, SDK client fields in model-facing arguments]
depends_on: [C02]
implementation_notes:
  - Move existing handlers/helpers without redesigning their algorithms. Shared handlers consume the common argument contract and a small operation context, not PluginInput from either SDK.
  - Keep schema descriptors and handlers associated by existing tool name; both adapters call the same handlers. Do not create factories/interfaces for unrelated future hosts.
  - Separate initialization services (captured client/options) from invocation data (session, agent, directory/worktree, cancellation and permission callbacks).
  - Use official v1 Plugin/Hooks/ToolContext types where available. Delete or restrict the misleading custom SDK facsimiles. Preserve existing named test imports only as narrow compatibility re-exports if needed.
  - Retain lazy client access; capture the initialization client without calling network APIs at plugin initialization.
  - Remove the prefix-based permission auto-allow hook and no-op before/after hooks. Never turn an existing deny or ask into allow. For touched mutation paths, use the documented host permission assertion rather than assuming direct filesystem writes are host-checked.
steps:
  - Add realistic SDK-shaped tool contexts without client/project and provide the model-catalog mock only to initialization. Reproduce the broken discovery test before fixing it.
  - Extract the common runtime, preserve all nine outputs and configDir/environment precedence, and wire provider lookup to the captured real client with invocation location.
  - Resolve artifact roots from invocation worktree and study input from invocation directory; test a nested directory and a second worktree. Do not silently fall back to process.cwd for a malformed real-host context.
  - Validate maxChildDepth at factory setup, including negative/non-finite/over-limit inputs; keep the contract cap and ordinary defaults.
  - Test actual v1 permission input shapes and configured deny/ask behavior. Stop pretending a mock-only input.tool demonstrates host compatibility.
  - Check enableHooks/degraded behavior: optional enhancements may be absent, but validation, input checks, authorization, visible topology and direct tool behavior must remain safe.
verification:
  - command: npm test && npm run typecheck
    proves: Extraction retains existing business behavior and typed v1 adapters no longer depend on fabricated execution fields.
  - command: node scripts/test-opencode-compat.mjs --stage v1
    proves: Actual v1.18.29 and v1.19.1 load/invocation, runtime discovery, nested-root behavior and policy handling work.
done_criteria:
  - Real v1 calls discover supplied runtime models with no client in ToolContext.
  - No prefix auto-allow or unsupported input.tool access remains; no-op hooks are not carried forward.
  - Existing full/degraded workflows and provider-safe names pass regressions.
failure_handling:
  - trigger: An extraction changes study/model output or introduces a new global side effect.
    action: Revert the mechanical move locally and redo it in smaller steps; preserve algorithms and repair the shared boundary only.
  - trigger: Target v1 SDK field differences remain uncertain.
    action: Consult C01 pinned evidence and reproduce against that host; stop rather than weakening types with any or fabricated context fields.
```

### C04 — Preserve legacy/native configuration and actual model write paths

```yaml
id: C04
objective: Make effective config reads and managed writes format-aware without converting unrelated user data.
scope:
  files_or_dirs: [.opencode/lib/compat/config.ts, .opencode/lib/runtime/lite-config.ts, .opencode/lib/runtime/model-config.ts, .opencode/lib/runtime/specialist-registry.ts, .opencode/lib/runtime/bounded-lite-core.ts, scripts/managed-config.mjs, scripts/install.mjs, tests/runtime/model-config.test.ts, tests/runtime/lite-config.test.ts, tests/runtime/install-jsonc.test.ts, tests/config/**]
  allowed_commands: [npm test, npm run typecheck, installer dry-run against isolated fixtures]
  out_of_scope: [whole-file config migration, credentials conversion, serializing runtime Agent.Info as config, changing model-pool selection policy]
depends_on: [C03]
implementation_notes:
  - Detect format by documented native/legacy fields, not by an assumed product version or $schema URL. Native top-level canonical values win; nested entries must remain internally one format.
  - Keep each plugin entry type intact: v1 string/tuple versus v2 string or package/options object. Update only exact known managed paths/package IDs, not arbitrary strings containing bounded-lite.ts.
  - Cover plugin/options, agent/agents, provider/providers and model variants, command/commands, permission/permissions and mcp/mcp.servers in the actual read/write pipeline.
  - Preserve unrelated native fields, provider keys, third-party plugin order/options, custom agent/request settings, MCP credentials and global permission rule order. Native permission arrays must not be object-spread or sorted.
  - Keep model preferences in oh-my-lite-openagent.json and active generated Markdown. Do not switch apply to the currently unused writeOpenCodeConfig helper.
  - Legacy files can remain legacy because v2 supports translation. Existing native per-agent entries must be read and managed updates must target the effective native location instead of writing shadowed legacy fields.
  - Parse provider/model#variant safely; preserve an explicit variant through read, list, install and apply. Validate base model separately from variant without silently discarding either.
  - Existing lite-config choices take precedence over one-time config migration defaults; avoid repeatedly importing stale user defaults over an explicit model apply.
steps:
  - Add JSON and JSONC fixtures for legacy, native and permitted mixed top-level configs, plus conflicting native/legacy managed values and native hidden/disabled overrides.
  - Implement small read/serialize helpers at the format boundary and parity tests for any installer/runtime duplication; do not port the entire OpenCode config normalizer.
  - Update config inference, profile options and migration reads to use effective entries. Normalize v2 catalog models separately; do not infer inventory from provider metadata alone.
  - Update installer merging and active Markdown writing so managed roles/models/permissions/commands take effect in native files without adding V1 fields inside native entries. Preserve unrelated custom entries and user providers completely.
  - Add backups before any generated file mutation. Keep policy defaults ordered broad-first, specific-last; built-in build/plan overrides remain hidden and fully denied.
  - Store requested reasoning preferences in lite-config, distinguish stored/selected/effective values in reports, and provide C05 the normalized preferences needed for actual v2 request hooks.
verification:
  - command: npm test -- tests/config tests/runtime/model-config.test.ts tests/runtime/lite-config.test.ts tests/runtime/install-jsonc.test.ts tests/runtime/plugin-load.test.ts
    proves: Both config dialects, precedence, aliases, specialist boundaries, model variants and real writer behavior are covered.
  - command: npm run typecheck
    proves: Host runtime info and disk config shapes are not conflated.
done_criteria:
  - Reinstall/model apply preserves non-managed configuration values and effective managed assignments for every fixture.
  - A native managed override cannot silently defeat the install/apply result; conflicting explicit user restrictions are reported, not overwritten covertly.
  - Generated active agents remain in config-dir/agents; bodies and unrelated frontmatter survive model-only apply.
failure_handling:
  - trigger: A native/mixed entry cannot be classified without guessing or a later source shadows the managed value.
    action: Stop the write with the exact location/key conflict and corrective guidance. Do not normalize the whole user file.
  - trigger: A requested reasoning effort is unsupported or conflicts with an explicit variant.
    action: Preserve the explicit variant and report the skipped effort/effective choice; never claim a stored value proves runtime behavior.
```

### C05 — Add the v2 adapter and combined export

```yaml
id: C05
objective: Expose the same bounded plugin through v2's actual domain API.
scope:
  files_or_dirs: [.opencode/lib/compat/v2.ts, .opencode/plugins/bounded-lite.ts, .opencode/server.ts, tests/runtime/plugin-v2.test.ts, tests/integration/opencode-host-smoke.test.ts]
  allowed_commands: [npm test, npm run typecheck, isolated v2 host runner]
  out_of_scope: [installer merging, package pin changes without C01 coordination, shared-handler rewrites, TUI APIs, new role topology]
depends_on: [C04]
implementation_notes:
  - Default export spreads Plugin.define with stable id bounded-lite, setup and v1 server forwarding. Add server.ts re-export outside plugin auto-discovery.
  - Read ctx.options; register all nine tools using ctx.tool.transform editor.add with native JSON Schema from C02. Do not introduce a second namespace that changes effective tool names.
  - Transform callbacks are synchronous/replayable: no filesystem/network I/O, dependency installation, background coordinator creation or one-time registrations inside them. Capture dependencies before registration and keep executors invoking the shared runtime.
  - Return structured v2 results with content containing the existing text/JSON string. Use output only if it matches a declared schema. Preserve thrown authorization/cancellation errors in the host error channel.
  - Resolve session location through context.sessionID and the exact pinned session-get contract from C01. ctx.location is only the plugin instance location. A missing session/location is an error, not permission to write to cwd or another checkout.
  - Read result.data for provider/model/agent API lists. Use ctx.model.list for model inventory and preserve providerID/id/model variants/capabilities in normalization.
  - Map context.signal to shared cancellation. For model catalog fetch or child processes touched by the port, wire cancellation and cleanup rather than leaving work running after a stopped session.
  - Remove no-op v1 hooks instead of registering v2 equivalents. Do not add a generic evaluate hook that grants custom tools permission by prefix.
steps:
  - Add typed adapter tests with genuine event/result/context shapes, including completed/error outcomes if an after-hook is actually needed.
  - Register tool definitions and executors, verify transform replay/reload does not duplicate registrations or reset shared state, and prove setup options/maxChildDepth validation runs.
  - Map session/worktree operation context, cancellation, permission assertions and v2 catalog envelopes into the common runtime. Include two distinct session locations in the test.
  - Register a narrow typed session context request hook for supported role/specialist reasoning preferences when no explicit model variant takes precedence. Scope provider-specific semantic options appropriately; do not use inert agent request.body as an implementation.
  - Demonstrate effective outgoing request options with a local deterministic provider/request fixture; distinguish stored profile advisory metadata from actual host overrides.
  - Return cleanup only for resources actually owned by setup; let the host dispose transforms/hooks, and abort any owned timers/subscriptions/processes. Do not add resources merely to test cleanup.
verification:
  - command: npm test -- tests/runtime/plugin-v2.test.ts tests/runtime/plugin-load.test.ts
    proves: Both adapters share behavior while v2 schemas/results/events/catalogs and permission failures use correct contracts.
  - command: npm run typecheck
    proves: The v2 definition and callbacks compile against the actual SDK, not local facsimiles.
  - command: node scripts/test-opencode-compat.mjs --stage v2
    proves: Actual host load, tool names/schema/calls, options, request reasoning, reload and cancellation operate correctly.
done_criteria:
  - v1 server and v2 setup are selected by their hosts from one default export; exactly one plugin instance and nine correctly named tools are active.
  - v2 operations do not use legacy client method casts, global config mutation hooks, or an assumed ToolContext.location.
  - Full/degraded behavior and explicit deny/ask are preserved.
failure_handling:
  - trigger: Docs examples differ from pinned SDK response/hook types.
    action: Follow published types and tagged host behavior, add a minimal regression fixture and update the cited compatibility note; do not force a cast.
  - trigger: Reasoning settings cannot be shown in an effective request.
    action: Mark that model/provider capability unsupported with a clear report and return to Command Lead; do not pass based on serialization alone.
```

### C06 — Deliver the verified runtime safely from source and tarball

```yaml
id: C06
objective: Install a self-contained local runtime without clobbering user files or relying on host bootstrap.
scope:
  files_or_dirs: [scripts/install.mjs, scripts/install-paths.mjs, package.json, .opencode/package.json, .opencode/package-lock.json, tests/runtime/install.test.ts, tests/runtime/install-jsonc.test.ts, tests/fixtures/install/**, scripts/test-opencode-compat.mjs]
  allowed_commands: [npm test, npm run typecheck, npm pack --dry-run, npm pack --pack-destination within project scratch, installer dry-run, explicit npm ci within staged managed runtime directories]
  out_of_scope: [personal global installation without permission, user package manifest/lock edits, global package installs, alternate SDK version choices, modifying adapter/shared core files owned by C05]
depends_on: [C04]
implementation_notes:
  - Consume the C01 loader-proven directory layout and the C04 dialect-aware merging. Do not return to the old explicitly configured .ts file path.
  - Managed runtime target is config-dir/.opencode/oh-my-lite-openagent with server.ts, its own manifest/lock, agents/plugins/lib and installed runtime dependencies. Active agent Markdown remains config-dir/agents.
  - Include shim and runtime manifest/lock in npm files. Align root/nested required SDK/Zod pins with C01 and include every relative imported helper in the tarball.
  - Launch a verified npm JavaScript CLI using process.execPath plus an argument array and shell false on both platforms. Resolve the CLI from the current npm installation (including npm_execpath only when it identifies a valid npm CLI), not arbitrary user input. On Windows, do not pass npm.cmd to shell-free execFile and do not switch to shell true or concatenate commands; fail clearly if the CLI cannot be resolved. Use locked npm ci --ignore-scripts in the staged private runtime, unless C01 proves a necessary lifecycle script and Command Lead explicitly approves the exception.
  - Preserve config directory priority OPENCODE_CONFIG_DIR > --config-dir > platform default. Keep source-root versus target-config paths distinct in update-lite commands.
  - Stage managed files/dependencies and verify resolution before switching the configured source. Keep backups of the prior runtime namespace, config, lite config and overwritten managed Markdown; roll back on partial write/swap failures.
  - Identify old/new managed specs exactly across plugin/plugins and tuple/object forms; remove only superseded managed config entries, preserve third-party order/options, and ensure a single active managed source.
  - Do not delete old copied files just because they look managed. Leave inert old trees initially; if discovery makes a specific old entry active, back up and disable only the known managed entrypoint, recording the action for rollback. Never recursively delete users' .opencode or node_modules.
steps:
  - Update target/runtime paths, manifest/lock copying, source directory spec and native/legacy option serialization; update returned plugin path/report to the real installed source.
  - Add dependency staging and a dry-run report of targets, commands, backup and activation order. Dry run must not create directories, caches, package files or run npm.
  - Cover first install, repeated install, upgrade from the old managed file spec, native plugin object options, --managed-mcp false, model/profile retention and install-scoped update command permissions.
  - Inject/stub the dependency runner in unit tests so normal npm test remains offline; real dependency resolution belongs to C01/C09 integration gates, not every unit test.
  - Add an actual Windows process-execution test of the launch helper, beyond a stubbed command assertion. Use a valid npm-compatible JavaScript CLI fixture for offline checks and verify exact argv in paths containing spaces and shell metacharacters, no command injection, nonzero-exit/error propagation and dry-run non-execution; the package stage also exercises the real resolved npm CLI.
  - Add dependency-download failure, malformed config, permission failure, interrupted activation, custom manifest collision and rollback tests. Do not report Install complete after a failed dependency stage.
  - Pack to project scratch, extract/install from the tarball in an isolated config with no ancestor repository node_modules, and verify the runtime has all required files.
verification:
  - command: npm test -- tests/runtime/install.test.ts tests/runtime/install-jsonc.test.ts
    proves: Paths, merging, dry-run purity, dependency staging, idempotence, failure and rollback behavior, including actual Windows CLI launch with adversarial path/argument characters.
  - command: node scripts/install.mjs --dry-run
    proves: Current default inspection is read-only and shows the new directory/dependency actions without writing global configuration.
  - command: npm run pack:dry-run
    proves: Published file list includes the runtime shim, manifests/lock and all source helpers.
  - command: node scripts/test-opencode-compat.mjs --stage package
    proves: Source and extracted-tarball installs resolve their own dependencies, activate once and retain user configuration.
done_criteria:
  - Clean install and repeated install work without workspace dependencies; no user dependency manifest is modified.
  - Existing providers/credentials/custom agents/third-party plugins are structurally preserved, and managed options/models remain effective in both dialects.
  - Failure before activation leaves the previous usable config/runtime in place; backups restore overwritten managed files.
  - Real Windows process tests prove argument preservation, failure propagation and no execution during dry run; no npm.cmd/execFile or shell-concatenation workaround remains.
failure_handling:
  - trigger: Dependency install fails, lock mismatch occurs, or integrity verification fails.
    action: Do not switch config or fall back to arbitrary latest packages. Preserve prior runtime, report the exact locked dependency error and allow an explicit retry.
  - trigger: Managed namespace contains unrecognized user files or the old source would remain active twice.
    action: Stop and report the collision/source list; do not overwrite or delete unknown files to make the test pass.
```

### C07 — Preserve role topology, hidden delegation and bounded depth

```yaml
id: C07
objective: Keep the existing orchestration architecture usable and bounded under both hosts.
scope:
  files_or_dirs: [.opencode/lib/contracts.ts, .opencode/lib/runtime/safety.ts, .opencode/lib/compat/v1.ts, .opencode/lib/compat/v2.ts, scripts/managed-config.mjs, scripts/install.mjs, .opencode/agents/**, tests/config/**, tests/integration/conformance.test.ts, tests/integration/degraded-mode.test.ts, tests/integration/opencode-host-smoke.test.ts]
  allowed_commands: [npm test, npm run typecheck, isolated host delegation/permission smoke runner]
  out_of_scope: [new real roles, second child orchestrator, making hidden roles visible, blanket permission grants, general admin policy framework]
depends_on: [C05, C06]
implementation_notes:
  - Keep contracts and managed config synchronized: exactly three plugin-managed visible entrypoints, eight fixed roles, disabled build/plan overrides and optional specialists hidden. Preserve unrelated user agents; do not claim the user can have only three total agents.
  - Preserve allowed role edges from ROLE_CONTRACTS, including Task Lead to Explore/Librarian and reviewer to Explore. No task-lead-to-task-lead or retrieval-role delegation.
  - Native permissions use action shell/subagent/edit with ordered resource/effect rules. Legacy uses bash/task maps; broad deny/allow rules precede exceptions. Existing user explicit denies must not be erased by a hook.
  - Provide v2 context with the permitted hidden IDs/descriptions when the host omits them from its catalog, filtered by role allowlist and effective deny rules. Do not replace the subagent tool or duplicate the runtime scheduler.
  - Session depth and child orchestrator depth are distinct. Set the bounded native host session ceiling to 3 only when not explicitly configured more strictly, to admit the deepest existing allowed chain; retain MAX_CHILD_ORCHESTRATOR_DEPTH 1 and role denials.
  - V2 calls use agent/prompt/description and optional sessionID/background/model; v1 calls use the pinned actual tool contract. Never emit empty or fabricated resume IDs. Profile model recommendations remain metadata unless a verified allowed override exists.
steps:
  - Add parity tests for legacy and native generated permissions, hidden/disabled fields, defaults and specialist folder/bash limits; preserve source contract constants.
  - Test permitted hidden-role dispatch through actual v2 subagent execution without exposing them in normal UI selection.
  - Verify command-lead to task-lead to explore and command-lead to deep-plan-builder to plan-review to explore. Verify direct entrypoint planning/review paths too.
  - Verify forbidden recursive Task Lead, retrieval-to-child, disabled builtins and unknown specialist dispatch are rejected; repeat with saved approvals where supported.
  - Test explicit stricter user depth as a reported blocker, not a silent rewrite; document the minimal opt-in change if needed. If a supported legacy host ignores a legacy depth key, use only its verified supported field and keep native v2 additions isolated.
  - Cover foreground/background completion/cancellation and fresh/resumed child invocation. Keep the plugin background tool honest about tracking only its own coordinator rather than claiming all native host jobs.
verification:
  - command: npm test -- tests/config tests/integration/conformance.test.ts tests/integration/degraded-mode.test.ts
    proves: Architecture, permission order, default behavior and degraded-mode invariants remain unchanged.
  - command: node scripts/test-opencode-compat.mjs --stage delegation
    proves: Real allowed nested chains work, hidden roles stay hidden, disallowed chains fail and host-depth limits are not confused with orchestrator depth.
done_criteria:
  - Both hosts implement the same role authorization graph, including hidden-role invocation, without adding an orchestration layer.
  - Existing denied sensitive actions and specialist boundaries remain denied; no policy decision is relaxed by adapter hooks.
failure_handling:
  - trigger: A host cannot preserve an allowed chain without widening role authority or visibility.
    action: Stop and escalate the exact chain/API limitation to Command Lead; do not change the architecture to accommodate the host.
  - trigger: Native config precedence or another plugin defeats a managed restriction.
    action: Report the effective source and fail the conformance case; do not introduce broad hard-deny policies without an explicit follow-up decision.
```

### C08 — Align English handoff and recovery documentation

```yaml
id: C08
objective: Make plan calls, compatibility boundaries and recovery instructions unambiguous for users and lower-strength executors.
scope:
  files_or_dirs: [.opencode/agents/command-lead.md, .opencode/agents/plan-builder.md, .opencode/agents/deep-plan-builder.md, .opencode/agents/plan-review.md, .opencode/agents/task-lead.md, scripts/managed-config.mjs, README.md, AI-INSTALL.md, AGENTS.md, docs/opencode-compatibility.md, tests/config/**, tests/fixtures/plans/**]
  allowed_commands: [npm test, npm run typecheck, documentation/example inspection]
  out_of_scope: [requiring review of untranslated docs, rewriting historical plans, removing legacy user-language examples unrelated to the change]
depends_on: [C07]
implementation_notes:
  - State minimum v1.18.29 and tested v1.19.1/v2.0.30; distinguish product v2 from v1 SDK /v2 paths, and Node installer versus actual host support.
  - Describe the exact payload argument, object shape and optional dispatch sibling; never instruct a caller to submit a raw Markdown artifact or stringify the object.
  - Require newly generated plans to provide a clearly labeled JSON validation object alongside human Markdown. The fixture/example must include review/open-question/self-check information when present, not just a subtasks-only summary that can hide blockers.
  - Reconcile prompts claiming artifacts/schema.ts is the plan schema with C02's exported executable contract; preserve planner persistence permissions, mandatory deep-plan review and Command Lead ownership.
  - Explain v1 task versus v2 subagent field names, fresh/resume behavior, permitted hidden roles and profile metadata without inventing universal tool argument names.
steps:
  - Add one minimal valid readiness tool-call example and invalid-format examples with the exact corrected call. Use the same fixture in executable tests and docs to prevent drift.
  - Add troubleshooting: capture host version, active plugin ID/source, package version, tool schema, sanitized call and exact error; distinguish stale active process, schema projection, missing named payload, invalid format and semantic gate failure.
  - Document restart of the v1 process or v2 service/plugin runtime after installation/config-time changes, not merely starting a new conversation. Document that v1/v2 share config locations and native-v2 files must not be reused by v1.
  - Document private runtime/dependency installation, no global user-manifest changes, offline failure behavior, dry run, backups, update-lite preservation and rollback order.
  - Update AGENTS.md's installer boundary to include only the dedicated managed manifest/lock/shim in addition to agents/plugins/lib. Keep all review-facing text and compatibility reports English.
  - Explain that npm releases can lag source; include npm view oh-my-lite-openagent version and source-install alternative without publishing anything.
verification:
  - command: npm test -- tests/config tests/runtime/plan-readiness.test.ts
    proves: Managed prompts/templates remain semantically aligned and the documented JSON fixture is executable.
  - command: Inspect docs and prompt diffs against final SDK and installer outputs
    proves: No nonexistent key, misleading effective reasoning claim, non-English required review input, or unrequested global write instruction remains.
done_criteria:
  - A new executor can extract the example object and submit it correctly without re-deriving wrappers or parser rules.
  - English docs explain supported versions, both config formats, restart and recovery, including all known capability limitations.
failure_handling:
  - trigger: Example and implementation disagree.
    action: Fix the shared fixture or implementation before documenting success; do not add a second contradictory example.
```

### C09 — Final real-host, provider-schema and packaged-install gates

```yaml
id: C09
objective: Prove the delivered plugin, not only local helper functions, works on the stated support matrix.
scope:
  files_or_dirs: [tests/**, scripts/test-opencode-compat.mjs, .github/workflows/ci.yml, package.json, docs/opencode-compatibility.md, .liteagent/scratch/opencode-compat/**]
  allowed_commands: [npm ci, npm test, npm run typecheck, npm run build, npm run pack:dry-run, npm pack to project scratch, pinned isolated host runner]
  out_of_scope: [global install without permission, publishing, weakening tests to hide an unsupported target, external credential use without authorization]
depends_on: [C08]
implementation_notes:
  - Preserve existing Linux/Windows offline unit/typecheck CI. Add pinned actual-host compatibility jobs and deterministic provider fixtures where host APIs require model execution; do not require real provider secrets for ordinary CI.
  - Matrix minimum: v1.18.29 + legacy; v1.19.1 + legacy; v2.0.30 + legacy; v2.0.30 + native; v2.0.30 + permitted mixed top-level config. Native-v2 config is intentionally not fed to v1.
  - Exercise source install and extracted npm tarball, full/degraded options, nondefault config dir, clean dependencies, nested working directory, distinct worktree/session location, and no personal HOME/config/state fallback.
  - Inspect the provider-visible final JSON Schema/tool definitions emitted by each host, not merely registry source shapes. Compare required/properties and representative schema-valid calls after host conversion.
  - If using a deterministic local provider/tool-call fixture, capture the actual outbound schema and return scripted tool calls; do not count direct handler calls as a real schema round trip.
steps:
  - Run the entire offline suite/typecheck and a build only to confirm TypeScript outputs; never patch dist.
  - Execute the host/package/config matrix with the final plugin. Validate exactly one active source and all nine tools, including intentional no-input schemas and actionable format errors.
  - Submit the documented complete plan object through actual host execution and record executable true; then test absent/wrong payload, raw Markdown, double encoding, extra wrapper, blocked/M0/M1 plans, blocking M2 question, unresolved major finding, self-check blocker, duplicate/unknown/cyclic subtasks and bad dispatch.
  - Persist a human plan fixture, extract its labeled JSON block mechanically and validate it. Verify that review changes update that object too; no stale pass snapshot may bypass a current blocker.
  - Exercise runtime model import/list/auto/apply using real initialization clients/catalog envelopes, specialist generation, effective reasoning request options, study source-only/full path confinement and managed AGENTS markers, all managed commands and no-secret/no-unrelated-config mutation checks.
  - Exercise C07 delegation/deny/depth tests, abort/reload/removal, transform replay, dependency failure and rollback. Confirm dry-run snapshot before/after has no writes or subprocess dependency installation.
  - Add CI commands/jobs from the reproducible runner; record exact versions, source/package checksums, schema samples and limitations in the English compatibility report.
verification:
  - command: npm test && npm run typecheck
    proves: Entire regression suite and source typing pass.
  - command: npm run build && npm run pack:dry-run
    proves: Build inputs and distributable contents include every required module/manifest; generated outputs are not source fixes.
  - command: node scripts/test-opencode-compat.mjs --stage all
    proves: Complete pinned host/config/source/package/schema/tool/security/recovery matrix passes in isolated locations.
done_criteria:
  - All mandatory cases pass and final English report links their reproducible outputs; skipped/blocked host cases cannot be called dual-version support.
  - No unresolved major defect remains in compatibility, authorization, configuration preservation or plan-input handling.
  - Command Lead can request Result Review of its integrated execution-summary; no implementer or planner grants release approval or advances canonical state.
failure_handling:
  - trigger: A mandatory host case is unavailable or fails while unit tests pass.
    action: Block release and report the exact target/input/output; do not weaken the support boundary or mark it verified.
  - trigger: A new defect is found outside the stated paths.
    action: Return a bounded follow-up with evidence and impact; expand scope only with Command Lead/user approval.
```

## verification_strategy

1. **Baseline facts:** preserve the current clean status and passing 190-test/typecheck result. Existing passing tests are regression evidence only, not proof of host compatibility.
2. **Loader first:** C01 adds the runner named in later commands. Its `loader` stage must pass on isolated v1.18.29, v1.19.1 and v2.0.30 before production layout changes proceed. Commands referencing this new runner do not exist at the planning baseline.
3. **Contract tests:** run plan/DAG/artifact/schema projection tests before adapter extraction. Confirm object fields, aliases, wrong-format errors, mandatory safety fields and no side effects on invalid input.
4. **Typed v1 then v2:** validate actual initialization/execution/permission types and response envelopes, no mock-only fields, one registration, setup option checks, replay/cancellation and effective request settings.
5. **Configuration and install fixtures:** structural before/after comparison for legacy/native/mixed JSON/JSONC, exact third-party config/order preservation, managed effective values, private dependency manifests, idempotence, failure and rollback. JSONC comments need not be preserved by the existing rewrite approach, but backups must preserve original bytes and no semantic user data may be lost.
6. **Host matrix:** use C09's five config/version cases with source/tarball paths; add Linux/Windows unit/installer coverage. Actual-host Windows coverage is mandatory when a compatible official host artifact is available; otherwise record the packaging/host distribution limitation and do not claim it verified.
7. **Provider-facing reproduction:** inspect final host-exported schemas and an actual tool-call round trip with scripted inputs. Missing `payload`, empty projected schema, Markdown format failure and semantic readiness rejection must be distinguishable. Capture source/version/input/error with no secrets.
8. **Safety and workflows:** allowed and denied nested role chains, hidden visibility, explicit permission deny/ask, stricter user depth, plan gates, path/worktree confinement, specialist folder limits, full/degraded behavior, study markers, commands, reasoning capability limits.
9. **Final repository commands:** `npm test && npm run typecheck`; `npm run build` only to confirm generated TypeScript outputs; `npm run pack:dry-run`; `node scripts/install.mjs --dry-run`; `node scripts/test-opencode-compat.mjs --stage all`.
10. All filesystem-writing checks run in the project or explicitly authorized isolated test locations. Set HOME/XDG/OPENCODE_CONFIG_DIR/TMPDIR/npm cache/test output paths to project scratch; never start hosts against personal configs. Any live credential/provider verification is an optional, separately authorized supplement, not a replacement for deterministic checks.

## risk_and_recovery

| Risk / sensitive invariant | Prevention / verification | Recovery / escalation |
| --- | --- | --- |
| Shared import cannot load in one host, or installed SDK differs from workspace types | C01 pinned actual-host fixture, published metadata versus tagged-source check, SDK-typed adapters | Stop downstream work and return the minimal reproducer; do not use version-detection guesses or silently remove a host |
| v2 configured local-file spec is skipped; dependency imports fail on clean install | Directory `server.ts` shim plus ./server export, private locked install, source/tarball tests | Keep previous config/runtime active; retry only the exact failed stage; no global package fallback |
| Runtime package/host module identity conflict | Do not vendor SDK runtimes into an ad-hoc bundle; use documented imports and actual v2 host identity checks | Treat foreign-copy errors as blocking; refine dependency layout in C01 rather than duplicating SDKs |
| Plan schema is empty/opaque after host/provider conversion | Strong object shapes, single schema source, final emitted-schema inspection and actual calls | Capture the rejected schema/version, repair conversion once at the common boundary, restart the actual host and retest |
| Schema normalization drops blockers | Preserve plan_review/review, open_questions, self_check and extension fields; adversarial tests | Revert normalization until every safety-bearing field survives; never treat a stripped payload as approved |
| A saved JSON validation block drifts from current human review | Single labeled object and fixture round trip; update it on review changes; Command Lead checks its review state against current artifact | Reject stale/incomplete projections and resubmit the complete object, not a hand-built subtasks-only summary |
| Native values shadow managed legacy writes or permissions are reordered | Read effective format; update only managed entries in their existing dialect; preserve user array order and nested format consistency | Stop before write on ambiguous conflict; restore exact backup bytes on partial changes |
| Authorization broadened by porting prefix auto-allow or mutable permission hooks | Remove unsafe hook; preserve explicit denies/asks; use proper host assertions for touched mutations; retain role denials | Block compatibility claim; no blanket allow/policy rewrite to force a passing smoke test |
| v2 default session depth breaks allowed reviews or an increased depth enables recursion | Separate session ceiling 3 from child orchestrator cap 1; role allowlist and negative delegation tests; no silent change to stricter user limits | Report exact blocked chain; request a bounded explicit setting change, not a second orchestration layer |
| Hidden roles disappear from v2 advertised subagent choices | Supply allowed hidden IDs only in model context; keep UI hidden flags | Fail hidden-role dispatch tests; never unhide roles as a workaround |
| Tool writes to canonical checkout/cwd instead of active session/worktree | SDK-correct invocation context and session location lookup, nested/two-worktree tests | Fail closed when location is unavailable; no process.cwd fallback for real invocations |
| Reasoning configuration is stored but inactive in v2 | Check actual semantic outgoing options/verified variant; explicit variant precedence; capability warnings | Report unsupported/skipped setting honestly; never claim serialization is execution |
| Installer update loses user settings or partially changes a working installation | Dedicated managed namespace; preserve config/lite/agents backups; stage dependencies before activation; failure injection | Restore previous source entry, runtime namespace, config/lite config and generated agent backups; do not remove unrelated files |
| Optional enhancements disabled but topology/security changes | Same three visible plugin roles/eight fixed roles in full/degraded mode; mandatory checks independent of enhancements | Revert optional enhancement behavior, retain core validation and authorization |
| Dependency scripts/network/bootstrap modify user environment | Private namespace/cache, pinned integrity lock, ignore-scripts unless explicitly approved, pure dry run | Stop and report; no global npm mutation or automatic system OpenCode replacement |
| Research/review context grows or claims are untraceable | Fresh bounded specialist instances; copy scoped structured evidence and exact task contracts | Start a fresh bounded investigation with the necessary fragments, not an unbounded continuation |

Implementation rollback is per boundary: contract/core changes revert together with their tests; host adapters are independently reviewable; installer activation restores prior runtime/config together. Do not mix an old runtime with new native-only configuration during rollback. Actual personal-global restoration requires user authorization and byte-preserving backups. Never use destructive Git resets or delete existing user plans/index entries.

## acceptance_criteria

- [ ] v1.18.29, the user's v1.19.1, and v2.0.30 load the final packaged plugin through the documented API, with one active source and stable ID/tool names.
- [ ] A clean source install and extracted-tarball install work without this repository's dependencies; SDK/Zod pins/locks agree and required runtime files are shipped.
- [ ] Legacy and native v2 configs (including supported mixed top-level shapes) retain unrelated providers, credentials, plugins, custom agents, MCP settings, policies, variants and permission order across install/update/model apply.
- [ ] Valid structured plan calls work from the documented fixture through actual hosts; wrong formats fail with a specific corrected-call example; final provider-visible schemas expose meaningful named inputs.
- [ ] Existing blocked/maturity/question/review/self-check/DAG safety checks cannot be bypassed by normalization, aliases or a stale/incomplete validation projection.
- [ ] Actual initialization clients and SDK-shaped invocation contexts drive model discovery; unsupported permission fields and prefix auto-allow are gone.
- [ ] Three plugin-managed visible entrypoints, eight fixed roles, hidden internal roles/specialists, disabled builtins and `MAX_CHILD_ORCHESTRATOR_DEPTH = 1` remain consistent with contracts/tests.
- [ ] All existing allowed delegation chains, including review-to-Explore, work; recursive/unauthorized chains remain denied. Session depth is handled explicitly without silently weakening user settings.
- [ ] Role/specialist reasoning preferences are verified as effective on supported request paths or clearly reported as unsupported/skipped; no inert-overlays success claim.
- [ ] Nested session/worktree path confinement, explicit authorization, study managed markers, cancellation, replay, cleanup and full/degraded behavior pass.
- [ ] Dry run writes nothing; dependency or activation failures leave a usable previous install and documented backups/rollback.
- [ ] Existing unit/typecheck regressions, build-content check, Linux/Windows installer coverage and the mandatory host/config/package matrix pass; any unavailable target is labeled unverified, not passed.
- [ ] English prompts/docs provide exact validation arguments, compatibility boundaries, restart, troubleshooting and rollback; fresh bounded execution/review subagents are the default.
- [ ] No unresolved major compatibility/security/validation finding remains; Command Lead owns final integrated Result Review and approval.

## plan_review

```yaml
reviewer: plan-review
review_task_id: ses_ebe5e52e3ffegi85lGAJYvBUwV
decision: pass
severity: minor
blocking: false
confidence: high
review_iterations_allowed: 2
review_passes_completed: 1
findings:
  - id: PR-01
    severity: minor
    location: C06 Windows dependency runner
    issue: Direct shell-free execFile of npm.cmd does not execute Windows command scripts.
    resolved: true
    resolution: C06 now requires a verified npm JavaScript CLI through process.execPath with shell false, clear resolution failure, and real Windows process tests for spaces/metacharacters, exit propagation and dry-run non-execution.
major_findings_unresolved: 0
revisions:
  - Applied the reviewer's single minor Windows launch correction directly, as allowed by the bounded review policy; no major findings were reported.
execution_approval: not_granted
```

### Final planner self-check

- Frontmatter includes schema 2.1, M3, reviewed status and the `.liteagent/plans/` recommended path; the JSON validation object carries matching status and the resolved review finding.
- Nine unique core nodes include id/depends_on/attributes/deliverable/description; C01-C09 all have matching bounded details, checks, done criteria and failure handling.
- Dependency graph is acyclic; the only implementation parallelism is C05/C06 with distinct file ownership. C07 joins them before topology integration.
- User-confirmed version/config/language/context-size decisions are recorded; no product question is disguised as an assumption.
- High-risk install/config/permission/role/depth/model/review-gate invariants and rollback boundaries are explicit.
- SDK/package/layout uncertainty is gated by C01, not treated as an already verified implementation. Baseline tests are distinguished from future real-host proof.
- Mandatory Plan Review passed; its one minor finding was resolved and documented. This plan does not execute implementation or grant readiness/dispatch/state approval.
