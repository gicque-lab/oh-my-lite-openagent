# OpenCode Compatibility Guide

English compatibility, validation handoff, and recovery reference for Oh My Lite OpenAgent on OpenCode v1 and v2 hosts. Everything here is aligned with the implemented behavior of the installer and plugin runtime; when this file and the code disagree, fix one of them before trusting either.

## Supported versions and boundaries

- Minimum supported OpenCode v1 line: **1.18.29**. Real-host verified: **v1.18.29, v1.19.1, and v2.0.30** (delegation stage 30/30 PASS on each).
- "OpenCode v2" means the v2 **product** (`@opencode/cli`, native config keys such as `plugins`, `permissions`, `experimental.subagent_depth`). It is not the same thing as the v1 SDK's `/v2` **subpaths** (for example `@opencode-ai/plugin/v2/effect`), which are versioned import paths inside the v1 SDK line.
- Node `>=20.19.0` is the installer's floor (`package.json` `engines`). This is a requirement of the installer process itself; hosting OpenCode v2 by raw Node is neither supported nor claimed.
- Roles and visibility are identical on both hosts: exactly 3 visible entrypoints (`command-lead`, `plan-builder`, `deep-plan-builder`), 5 hidden subagents (`task-lead`, `explore`, `librarian`, `plan-review`, `result-review`), and the hidden disabled `build`/`plan` overrides. Specialists are user-configured hidden leaf workers.
- npm releases can lag the repository `main` branch. Check the published version with `npm view oh-my-lite-openagent version`, or install from source (clone, `npm install`, `npm run install:opencode`) for the newest documented behavior.

## Submitting plan payloads

`bounded_lite_plan_readiness` and `bounded_lite_plan_dag` take a **named `payload` object** plus an optional `dispatch` sibling. Never submit raw Markdown or a JSON-encoded string; the tools never `JSON.parse` string input and never parse Markdown documents.

Minimal valid readiness/DAG call (this exact example is also emitted by the tools themselves):

```json
{
  "payload": {
    "plan": {
      "subtasks": [
        {
          "id": "C02",
          "depends_on": ["C01"],
          "attributes": ["code"],
          "deliverable": "Shared plan contract",
          "description": "Fix structured validation arguments"
        }
      ]
    }
  },
  "dispatch": { "concurrency": 4 }
}
```

- `payload.plan.subtasks[]` requires `id`, `depends_on` (array, may be empty), `attributes`, `deliverable`, and `description`.
- DAG-only callers may supply just `plan.subtasks`.
- Readiness callers add frontmatter-style fields (`plan_schema_version: "2.1"`, `maturity_level` M0–M3, `status` draft/reviewed/blocked, plus non-empty `goals`, `scope_boundaries`, `acceptance_criteria`, `phase_plan`), and may include `plan_review`/`review`, `open_questions`, `self_check`, and extension metadata. These safety-bearing fields pass through unchanged to the runtime gates — they must not be stripped.
- `dispatch` is optional; keys such as `concurrency` (integer 3–5), `defaultProfile`, and `attributeProfileMap` tune Task Lead profile resolution.

### Invalid formats and the exact corrections

Each bad input fails **once** with one actionable diagnostic that ends with the expected named-payload example:

| Submitted | Diagnostic says | Corrected call |
| --- | --- | --- |
| `payload` absent or empty | ``Missing `payload`: plan validation requires a structured `payload` object, not an absent or empty argument.`` | Resubmit with the `payload` key present, as in the example above. |
| Raw Markdown document (`---` frontmatter or `#` heading) | `` `payload` was received as a raw Markdown document. Submit the structured `payload` object; plan tools do not parse Markdown documents.`` | Extract the labeled JSON block (see below), parse it, and submit the resulting object as `payload`. |
| JSON-encoded string (`payload` is `"{\"plan\":...}"`) | `` `payload` was received as a JSON-encoded string (double-encoded input). Parse it before submitting or send the object directly; plan tools never JSON.parse string input.`` | Send the object itself, not a string containing JSON. |
| Array (even `[thePlanObject]`) | `` `payload` must be a single structured object, not an array of N item(s).`` | Unwrap the array; submit one object. |
| Other non-object (number, boolean, …) | `` `payload` must be an object with plan.subtasks (received number).`` | Submit the `payload` object. |

### JSON validation object for newly generated plans

Every newly generated Plan Builder / Deep Plan Builder artifact must provide, alongside the human-readable Markdown, one complete JSON object in a fenced block labeled exactly `json plan-payload` (three backticks + that label). It must include the review/open-question/self-check information when present — not just a subtasks-only summary, which can hide blockers. The executable shared fixture is [`tests/fixtures/plans/structured-plan.json`](../tests/fixtures/plans/structured-plan.json) with its human-readable companion [`tests/fixtures/plans/human-plan.md`](../tests/fixtures/plans/human-plan.md); `tests/config/docs-parity.test.ts` locks the copy in this document to that fixture so they cannot drift. Submit it to `bounded_lite_plan_readiness` as `{ payload: <this object> }`:

```json plan-payload
{
  "plan_schema_version": "2.1",
  "maturity_level": "M3",
  "status": "reviewed",
  "goals": [
    "[User Confirmed] Make valid plan submissions straightforward and malformed submissions fail once at the correct boundary"
  ],
  "scope_boundaries": {
    "in": [
      "[User Confirmed] One structured plan/tool argument contract with v1/v2 schema projection",
      "[User Confirmed] Early input-format validation with actionable diagnostics"
    ],
    "out": [
      "[Out of Scope] New tools, new coordinator layers, or permission-hook changes",
      "[Out of Scope] Arbitrary Markdown or YAML parsing during readiness"
    ]
  },
  "acceptance_criteria": [
    "[User Confirmed] The documented structured fixture passes readiness with an executable DAG",
    "[User Confirmed] Missing payload, array, null, raw Markdown, and double-encoded input each fail with one format diagnostic",
    "[User Confirmed] Serialized v1 and v2 schemas both expose payload with typed plan.subtasks"
  ],
  "phase_plan": [
    {
      "Goal": [
        "[User Confirmed] Ship the shared plan payload contract and wire shapes",
        "[User Confirmed] Keep readiness and DAG gates semantically unchanged"
      ],
      "Acceptance": [
        "[User Confirmed] Regression tests cover projection, handlers, and adversarial payloads"
      ]
    }
  ],
  "open_questions": [
    {
      "question": "[Open Question] None currently blocking; C09 owns final host-schema inspection",
      "blocks_current_phase": false
    }
  ],
  "plan_review": {
    "decision": "pass",
    "findings": [
      {
        "location": "wire contract",
        "issue": "Confirm payload object passthrough preserves extension metadata",
        "severity": "minor",
        "resolved": true,
        "resolution": "Passthrough verified by adversarial normalization tests"
      }
    ]
  },
  "self_check": {
    "passed": true,
    "blocked": false,
    "notes": "Offline verification only; host runs belong to C01/C09."
  },
  "extension_metadata": {
    "generator": "oh-my-lite-openagent C02",
    "tags": ["structured-plan", "fixture"]
  },
  "plan": {
    "subtasks": [
      {
        "id": "C01",
        "depends_on": [],
        "attributes": ["code", "deep"],
        "deliverable": "Dual v1/v2 loader spike evidence",
        "description": "Prove loaders and dependency contracts on real pinned hosts"
      },
      {
        "id": "C02",
        "depends_on": ["C01"],
        "attributes": ["code", "security"],
        "deliverable": "Shared structured plan/tool argument contract",
        "description": "Fix structured validation arguments, schema projection and diagnostics"
      },
      {
        "id": "C03",
        "depends_on": ["C01", "C02"],
        "attributes": ["code", "deep"],
        "deliverable": "Shared handlers and SDK-typed v1 adapter",
        "description": "Extract existing behavior behind a small runtime and repair the v1 host boundary"
      }
    ]
  }
}
```

## Delegation on v1 and v2

The two hosts expose subagent dispatch under different tool names and field names:

| | v1 (`opencode` product line ≤ 1.x) | v2 (`@opencode/cli` product line 2.x) |
| --- | --- | --- |
| Tool | `task` | `subagent` |
| Agent field | `subagent_type` | `agent` |
| Other fields | `prompt`, `description`, `task_id` | `prompt`, `description`, optional `sessionID`, `background`, `model` |
| Fresh call | omit `task_id` entirely | omit `sessionID` |
| Resume | pass only a real, previously returned `task_id` — never an empty string, placeholder, null-like value, or fabricated id | pass only a real returned `sessionID` |

- Permitted hidden roles (`task-lead`, `explore`, `librarian`, `plan-review`, `result-review`) are reachable **by exact ID on both hosts**, even though the v2 UI catalog omits hidden agents (the host builds that catalog from non-hidden agents only). The plugin exposes the allowed delegation edges as generated guidance inside the `bounded_lite_route` tool description, because that is a model-visible channel that does not make roles UI-selectable.
- Profile/model recommendations (`recommendedModel`, `fallbackChain`, Task Lead profiles) are dispatch metadata, not new agents, and not per-task model overrides unless the runtime explicitly supports one.
- Managed generated agent Markdown carries legacy nested permission maps in frontmatter. The pinned v2.0.30 host accepts them and rewrites `task`→`subagent` and `bash`→`shell` while preserving rule order — no native-frontmatter rewrite is required or performed.
- Depth: the plugin child-orchestrator cap is **1** on every host. Host session (subagent-nesting) depth is a separate config value; the managed installer writes **3** (v1: top-level `subagent_depth`; v2: `experimental.subagent_depth`) only when the key is absent. A stricter existing user value is kept verbatim and reported: the install report contains `hostSessionDepthBlocker` and the CLI prints a `WARN:` line naming the failing chain `command-lead -> deep-plan-builder -> plan-review -> explore`. Forbidden chains (self-delegation, retrieval-role widening, dispatching the disabled `build`/`plan` overrides, unknown specialists) are denied by host permission rules on both hosts; explicit user deny rules always win.

## Config locations, restart, and v1/v2 coexistence

- v1 and v2 read the **same config directory** (Linux/macOS `~/.config/opencode`, Windows `%APPDATA%\opencode`). Oh My Lite installs into it: generated agents at `<configDir>/agents/*.md`, role/profile settings at `<configDir>/oh-my-lite-openagent.json`, and the managed runtime at `<configDir>/.opencode/oh-my-lite-openagent/`.
- **Restart after installation or config-time changes** — Starting a new conversation is not enough:
  - v1: exit and relaunch the `opencode` process so plugin, agents, commands, and depth config reload.
  - v2: restart the OpenCode service/plugin runtime (quit and start OpenCode again) so the updated managed runtime loads.
- A config directory whose active config is **native-v2 format must not be reused by a v1 host**. Keep one host dialect per config directory; when switching back to v1, restore a legacy-format config rather than pointing v1 at native-v2 files.

## Install, update, backup, and recovery

- The installer (`scripts/install.mjs`, or `npm run install:opencode`) writes the managed runtime into a **private namespace** `<configDir>/.opencode/oh-my-lite-openagent/`: the `server.ts` shim, its own `package.json`/`package-lock.json`, dependencies installed with `npm ci --ignore-scripts` from that lock into its own `node_modules`, plus copies of `agents/`, `plugins/`, and `lib/`. It makes **no global user-manifest changes**: the user's global npm root, `package.json`, and lockfiles are untouched.
- Offline or failed dependency installation fails the install **before activation** with the exact npm stderr, and the previous runtime/config are kept intact; no arbitrary version fallback is attempted. Fix the environment (network, npm) and retry explicitly.
- `--dry-run` prints the complete planned action list and writes nothing, installs nothing.
- Backups: every generated overwrite of an existing file writes a `.bak` first (`opencode.json.bak`/`opencode.jsonc.bak`, `oh-my-lite-openagent.json.bak`, `agents/<role>.md.bak`); first-time files get no empty backup. The prior managed runtime namespace is renamed to a backup directory before the staged one is swapped in.
- Failure recovery order: on any error the installer's write journal undoes its mutations in reverse order — staged runtime swap, legacy entrypoint rename, config JSON writes, generated agent Markdown — restoring the prior install so a failed run leaves a working setup. Manual recovery restores the `.bak` file named active in the installer output (README "Uninstall" has copy commands).
- Updates: `/update-lite` runs `git pull --ff-only` in the recorded local source repository, reruns the installer with the recorded `--root-dir`/`--config-dir`, and preserves user providers, models, keys, unrelated plugins, MCP entries, and custom agents throughout. It then requires the same restart as above.

## Troubleshooting plan-tool failures

Collect before filing or diagnosing: host version (`opencode --version`), the active plugin id/source (`opencode debug config` — the managed runtime directory `<configDir>/.opencode/oh-my-lite-openagent/`), the published package version (`npm view oh-my-lite-openagent version`), the provider-visible tool schema for the failing tool, a sanitized version of the exact call, and the exact error text.

Classify the failure:

1. **Stale active process.** Install/config files changed but the running host still shows old tools, prompts, or depth behavior → restart (v1: process; v2: service/plugin runtime), then retry.
2. **Schema projection.** The host's serialized tool schema may render the source Zod shapes differently per host line, but every projection still requires the named `payload` object; check the schema the host actually sent to the provider, not only the source.
3. **Missing named payload.** Error starts with ``Missing `payload` `` → the `payload` key was absent or empty; resubmit with the object (example above).
4. **Invalid format.** One diagnostic naming raw Markdown / double-encoded string / array → apply the matching corrected call from the table above; the tools never parse strings or Markdown.
5. **Semantic gate failure.** The payload was accepted and `bounded_lite_plan_readiness` returned `executable: false` with named errors (blocked status, M0/M1 maturity, blocking open question, unresolved major Plan Review finding, self-check blocker, unknown/duplicate/cyclic subtasks, missing sections) → fix the plan content, not the call format; do not strip the safety fields to make the error go away.

## Verified real-host compatibility results (2026-10-22)

The compat runner (`npm run test:compat`, equivalent to `node scripts/test-opencode-compat.mjs --stage all`) proved the real bounded-lite plugin on all five mandatory host/config cases with a deterministic scripted provider, isolated HOME/XDG/npm-cache state, no PATH fallback, and no credentials or real LLM. Overall result on 2026-10-22: **ALL PASS** — consolidated in `.liteagent/scratch/opencode-compat/compatibility-report.md` with machine results in `.liteagent/scratch/opencode-compat/report.json`.

| case | host (exact version) | config dialect | result |
| --- | --- | --- | --- |
| v1.18.29-legacy | opencode-ai@1.18.29 (v1.18.29) | legacy `plugin` | PASS |
| v1.19.1-legacy | opencode-ai@1.19.1 (v1.19.1) | legacy `plugin` | PASS |
| v2.0.30-legacy | @opencode/cli@2.0.30 (v2.0.30) | legacy `plugin` | PASS |
| v2.0.30-native | @opencode/cli@2.0.30 (v2.0.30) | native `plugins` | PASS |
| v2.0.30-mixed | @opencode/cli@2.0.30 (v2.0.30) | mixed (`plugin` + `plugins`) | PASS |

Per case the run proves: the nine provider-visible `bounded_lite_*` tools, the host-exported plan-tool JSON Schemas captured from live provider payloads, the documented plan object passing readiness with `executable: true` and DAG with bounded waves through real host execution, one actionable diagnostic per format/semantic negative, and the final scripted round trip.

### Documented limitation: v2 double-encoded JSON-string tool arguments

The format table above describes the plugin's own input validation, which every host passes through. One host-level difference is pinned by the runner:

| v1 (1.18.29 / 1.19.1) | v2 (2.0.30) |
| --- | --- |
| Strict rejection: a JSON-encoded `payload` string arrives as a string and fails with the standard double-encoded diagnostic. | The host normalizes (parses) JSON-string tool arguments before the plugin receives them, so the same call completes and returns the same result as the equivalent object call. |

The v2 coercion is not a bypass: the runner sends the double-encoded string and the equivalent object call of the same documented fixture, and the coerced result is identical (same waves/nodes), proving the full readiness/DAG/validation gates still apply to the coerced object. Raw Markdown documents, array payloads, and wrapper payloads remain rejected by the host schema on both host lines, and all ten semantic gates still return real `executable: false` diagnostics. This limitation is verified verbatim from host evidence (.liteagent/scratch/opencode-compat/evidence/matrix-v2.0.30-*), not assumed.

**Warning — behavior pin (tripwire):** the compat runner pins the per-host double-encoded behavior intentionally: v1 hosts must keep the strict JSON-encoded-string rejection, and the v2.0.30 host must keep its pre-coercion. If any future host changes either (for example, a v2 build stops normalizing string arguments and rejects them raw), the matrix stage fails and CI flags it. A documented re-verification of the new behavior is then required before any support claim is updated.

### Reproducing and inspecting the results

Reproduce with `npm run test:compat` from the repository source. The consolidated machine report is `.liteagent/scratch/opencode-compat/report.json` (top-level `allOk: true`; matrix 5/5 passed); the human-readable report links each case's evidence directory (`.liteagent/scratch/opencode-compat/evidence/<case>/`), per-host run stdout/stderr (`.liteagent/scratch/opencode-compat/logs/`), and the exact host binary sha256 checksums keyed to the pinned npm packages (`opencode-ai@1.18.29`, `opencode-ai@1.19.1`, `@opencode/cli@2.0.30`).

Known limitation of this verification: the compat runner is POSIX-only (Linux). Windows actual-host coverage is NOT verified — no compatible official Windows host artifact was exercised; installer-level and unit-level Windows coverage exists in the offline suite only.
