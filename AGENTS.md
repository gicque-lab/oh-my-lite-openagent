# AGENTS.md

## Repository Positioning
- This is a lightweight global orchestration plugin repository for OpenCode, not a standalone application. The core deliverables are `.opencode/agents/**`, `.opencode/plugins/**`, `.opencode/lib/**`, the managed plugin configuration fragment `scripts/managed-config.mjs`, and the installer script `scripts/install.mjs`.
- The repository root must NOT contain `opencode.json`; that is the user's personal global configuration. Providers, models, API keys, third-party plugins, and custom agents must remain in the user's config and are merged with managed fragments by the installer.
- Hard architectural runtime invariants are defined in `.opencode/lib/contracts.ts`. Related tests verify consistency between these constants and `scripts/managed-config.mjs`. Synchronize both sides before modifying roles, visible modes, or routing categories.

## High-Value Commands
- Install dependencies: `npm install`
- Test: `npm test`
- Type check: `npm run typecheck`
- Build: `npm run build`
- Dry-run installer locally without writing files: `node scripts/install.mjs --dry-run`
- Install to OpenCode global configuration: `npm run install:opencode`
- Specify OpenCode configuration directory: `npm run install:opencode -- --config-dir /path/to/opencode-config`

## Recommended Verification Order
- After modifying `.opencode/**/*.ts`, `scripts/managed-config.mjs`, installer, or test contracts, run at least: `npm test && npm run typecheck`
- Only run `npm run build` when confirming TypeScript output artifacts.

## Code and Configuration Boundaries
- `tsconfig.json` compiles only `.opencode/**/*.ts`, `tests/**/*.ts`, and `vitest.config.ts`. Other `.ts` files in the repository root are excluded from the build by default.
- `dist/` is a build artifact directory; source modifications must be made in `.opencode/**` or `scripts/install.mjs`. Do not apply fixes directly in `dist/`.
- The template definition for the role model configuration command `/agent-models` is in `scripts/managed-config.mjs`, while its actual implementation is the plugin tool `bounded_lite_model_config`. Both must maintain semantic parity.
- Plan artifacts are written by default to the project's `.liteagent/plans/` directory, indexed at `.liteagent/plan-index.jsonl`. Do not write user plans into `.opencode/`.

## Installer and Configuration Merging Rules
- `scripts/install.mjs` only manages the copied `.opencode/{agents,plugins,lib}` tree plus the dedicated managed runtime namespace `<config-dir>/.opencode/oh-my-lite-openagent/` (the `server.ts` shim with its own package manifest/lock and installed dependencies) in the target OpenCode configuration directory.
- The installer overwrites/writes plugin entries and agent definitions managed by this repository, but preserves existing user providers, models, API keys, other plugins, and custom configurations. Do not break this when modifying merging logic.
- Before writing to user OpenCode configuration, a backup is created in the same directory (e.g. `opencode.json.bak` or `opencode.jsonc.bak`). Model configuration writebacks in the plugin also create backups first.
- OpenCode configuration directory priority: `OPENCODE_CONFIG_DIR` > `--config-dir` > platform default directory.
- Packages on npm registry may lag behind the repository `main` branch; when documenting the latest behaviors, remind users they can install from source or check the published version via `npm view oh-my-lite-openagent version`.

## Architectural Invariants (Enforced by Tests)
- Exactly 3 visible modes must be maintained: `execution`, `planning`, and `deep-planning`.
- Exactly 8 fixed real roles: `command-lead`, `plan-builder`, `deep-plan-builder`, `task-lead`, `explore`, `librarian`, `plan-review`, and `result-review`. In addition, `build` and `plan` are hidden disabled overrides.
- Users must only see 3 entry points: `command-lead`, `plan-builder`, and `deep-plan-builder`. `task-lead`, `explore`, `librarian`, `plan-review`, and `result-review` must remain hidden subagents.
- Maximum child orchestrator depth is capped at `MAX_CHILD_ORCHESTRATOR_DEPTH = 1`. Never introduce a second orchestration layer.
- Custom tool names must remain provider-safe and start with `bounded_lite_`. Tests verify that tool names contain no dots and match `^[a-zA-Z0-9_-]+$`.
- Permission rule ordering is strict: `task` permission rules must place `"*": "deny"` first, because OpenCode operates on "last match wins" semantics.
- Real roles have default bash permissions of `"*": "allow"`, asking for confirmation only on dangerous/sensitive commands. Built-in disabled overrides `build` and `plan` remain fully denied. The broad bash allow must also be placed before specific ask rules.

## Testing Guidelines
- `tests/config/*.test.ts` validates consistency between `scripts/managed-config.mjs`, contracts, and permissions. Check here first when updating agent registrations, hidden flags, modes, or delegations.
- `tests/runtime/model-config.test.ts` constrains role model writeback logic: only modify known roles; require `provider/model` format; allow writing models not in the provider list but issue a warning.
- `tests/integration/degraded-mode.test.ts` and `conformance.test.ts` verify degraded mode and architecture invariants. Do not break the invariant: "retaining the same visible architecture when optional enhancements are disabled".

## Agent Working Conventions
- If `README.md` conflicts with tests or scripts, defer to `scripts/install.mjs`, `scripts/managed-config.mjs`, `.opencode/lib/**`, and tests as the canonical source of truth.
- When modifying roles, routing, permissions, or model configurations, search for corresponding tests and update them together; many constraints in this repository are explicitly locked by tests.
- To verify OpenCode side integration, run `node scripts/install.mjs --dry-run` to inspect target paths and merge results before deciding to write to global configuration.
- Primary language: English.
