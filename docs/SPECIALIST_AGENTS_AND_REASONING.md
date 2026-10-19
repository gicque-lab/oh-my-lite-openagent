# Specialist Agents and Reasoning Configuration

This guide explains how to register bounded specialist agents, restrict their write access, assign models, and configure reasoning effort for Oh My Lite OpenAgent.

## Configuration locations

Oh My Lite stores durable role, profile, and specialist settings in the Lite configuration file:

```text
Linux/macOS: ~/.config/opencode/oh-my-lite-openagent.json
Windows:     %APPDATA%\opencode\oh-my-lite-openagent.json
```

Use `--config-dir` when the OpenCode configuration is stored elsewhere:

```bash path=null start=null
npm run install:opencode -- --config-dir /path/to/opencode-config
```

Generated files under `<configDir>/agents/` are managed outputs. Configure durable behavior in `oh-my-lite-openagent.json`, then rerun the installer or use the runtime model-config tool. Do not hand-edit generated agent markdown files because regeneration will replace those edits.

## Register a specialist agent

Add a `specialists` object to `oh-my-lite-openagent.json`. Each key must match the specialist's `name`.

```json path=null start=null
{
  "schemaVersion": 1,
  "roleModels": {},
  "roleReasoningEffort": {},
  "taskLeadProfiles": {},
  "specialists": {
    "security-audit": {
      "name": "security-audit",
      "description": "Audit security-sensitive source files.",
      "model": "anthropic/claude-sonnet-4-6",
      "reasoningEffort": "high",
      "editFolders": [
        "src/security",
        "security-reports"
      ],
      "prompt": "Only modify files inside the configured edit folders. Report findings and verification steps.",
      "allowBash": false
    }
  }
}
```

### Specialist fields

- `name` — required. Must match `^[a-z0-9][a-z0-9_-]*$`.
- `description` — required, non-empty description shown by OpenCode.
- `model` — optional `provider/model` identifier, such as `anthropic/claude-sonnet-4-6`.
- `reasoningEffort` — optional `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Common aliases such as `extra-high` and `maximum` are normalized.
- `editFolders` — optional list of relative folder patterns the specialist may edit.
- `prompt` — optional inline instructions.
- `promptFile` — optional safe relative path to a prompt file. Use either `prompt` or `promptFile` when possible.
- `allowBash` — optional; defaults to `false`.

Specialist names cannot shadow the managed roles (`command-lead`, `plan-builder`, `deep-plan-builder`, `task-lead`, `explore`, `librarian`, `plan-review`, or `result-review`) or the disabled OpenCode built-ins `build` and `plan`.

## Directory-scoped edit permissions

Specialist edit permissions are deny-first:

- No `editFolders`, or an empty list, produces `{"*": "deny"}`.
- `editFolders: ["*"]` or `editFolders: ["**"]` explicitly allows all edits.
- A folder such as `docs` produces both `docs/**` and `**/docs/**` allow rules.
- Trailing `/**` or `/*`, leading/trailing slashes, and repeated separators are normalized.
- Internal glob segments are preserved, so `src/*/generated/**` remains scoped to that pattern.

For example:

```json path=null start=null
{
  "editFolders": [
    "src/components",
    "tests/unit",
    "specs/**"
  ]
}
```

generates permissions equivalent to:

```yaml path=null start=null
permission:
  edit:
    "*": deny
    "src/components/**": allow
    "**/src/components/**": allow
    "tests/unit/**": allow
    "**/tests/unit/**": allow
    "specs/**": allow
    "**/specs/**": allow
```

OpenCode uses last-match-wins permission matching, which is why the catch-all deny rule is emitted first. Specialists are always generated as hidden leaf workers with task delegation denied, question prompts denied, and bash denied unless `allowBash` is explicitly `true`.

## Generate and verify specialist agents

After adding or changing a specialist definition, rerun the installer:

```bash path=null start=null
npm run install:opencode
```

The installer generates:

- `<configDir>/agents/<specialist-name>.md`
- Command Lead task permission allowing the registered specialist
- Specialist frontmatter containing model, reasoning, edit, task, question, and bash permissions

Verify the generated configuration:

```bash path=null start=null
opencode debug agent security-audit
opencode debug agent command-lead
```

The generated specialist should be hidden, use `mode: subagent`, deny task delegation, and show the expected folder-scoped edit rules. Command Lead should have an explicit task permission for `security-audit`.

## Set reasoning effort

Reasoning effort is configured separately for managed roles, Task Lead profiles, and registered specialists.

### How to run the model configuration actions

The `bounded_lite_model_config({ ... })` examples below are **internal tool payloads**. They are not shell commands and should not be pasted into a terminal.

Use the OpenCode TUI instead:

1. Start OpenCode:

   ```bash path=null start=null
   opencode
   ```

2. In the OpenCode prompt, type `/agent-models` and press Enter.
3. Ask Command Lead what you want it to do. For example:

   ```text path=null start=null
   Import the available model pool and show me the results. Do not apply any changes.
   ```

   This runs the equivalent of `action: "import"`.

4. To inspect current settings without changing anything, ask:

   ```text path=null start=null
   List the current role models, Task Lead profile settings, and registered specialist settings. Do not modify configuration.
   ```

   This runs the equivalent of `action: "list"`.

5. To preview recommendations, ask:

   ```text path=null start=null
   Show me model and reasoning recommendations, but do not apply them yet.
   ```

   This runs the equivalent of `action: "auto"`.

6. After reviewing the results, ask Command Lead to apply the exact changes you want. For example:

   ```text path=null start=null
   Set command-lead reasoning to high, set the code profile to medium, and set the security-audit specialist to high. Show me the proposed changes before applying them.
   ```

   Command Lead translates this into an `action: "apply"` call.

If `/agent-models` is not recognized, rerun the installer and restart OpenCode:

```bash path=null start=null
npm run install:opencode
```

### Managed roles

Use `/agent-models` in the OpenCode TUI and ask Command Lead to apply explicit assignments. The following shows the payload that Command Lead uses internally:

```json path=null start=null
{
  "action": "apply",
  "reasoningEffortAssignments": {
    "command-lead": "high",
    "plan-builder": "xhigh",
    "task-lead": "medium",
    "explore": "low"
  }
}
```

These settings are persisted in `roleReasoningEffort` and synchronized into generated role markdown frontmatter.

### Task Lead profiles

Task Lead profiles are dispatch metadata for the single hidden `task-lead` agent; they do not create additional agents:

```json path=null start=null
{
  "action": "apply",
  "taskLeadProfileReasoningEffortAssignments": {
    "quick": "low",
    "code": "medium",
    "visual": "high",
    "deep": "xhigh",
    "risk-high": "max"
  }
}
```

The built-in defaults are:

- `quick`: `low`
- `code`: `medium`
- `research`: `low`
- `writing`: `medium`
- `visual`: `high`
- `deep`: `xhigh`
- `risk-high`: `xhigh`

The selected profile and resolved reasoning effort are included in `bounded_lite_plan_dag` and `bounded_lite_plan_readiness` dispatch output.

### Specialist agents

Once a specialist is registered, assign its model and reasoning effort with `specialistAssignments`:

```json path=null start=null
{
  "action": "apply",
  "specialistAssignments": {
    "security-audit": {
      "model": "anthropic/claude-sonnet-4-6",
      "reasoningEffort": "high"
    }
  }
}
```

Specialist model assignments are checked against the imported provider model pool. Run `action: "import"` or `action: "list"` first; use `allowUnavailableModels: true` only when intentionally configuring a model that OpenCode cannot currently discover.

## Reasoning precedence and persistence

Use these rules when deciding where to configure a level:

1. The active OpenCode configuration or session-level model choice takes precedence.
2. Explicit persisted `reasoningEffortAssignments` or profile assignments in Lite config are used by generated agents and dispatch.
3. `action: "auto"` only previews recommendations and never writes configuration.
4. Applying a model without a reasoning assignment does not create a default reasoning level.
5. Provider/model capabilities may limit the effective level; unsupported role/model combinations are reduced to a supported value or left for the provider default.

To inspect current settings and registered specialists:

```json path=null start=null
{
  "action": "list"
}
```

To preview model and reasoning recommendations without writing anything:

```json path=null start=null
{
  "action": "auto"
}
```

## Combined example

The following applies a role model, a Task Lead profile model and reasoning level, and a specialist model and reasoning level in one call:

```json path=null start=null
{
  "action": "apply",
  "assignments": {
    "command-lead": "anthropic/claude-opus-4-7"
  },
  "taskLeadProfileAssignments": {
    "code": "anthropic/claude-sonnet-4-6"
  },
  "taskLeadProfileReasoningEffortAssignments": {
    "code": "medium",
    "risk-high": "xhigh"
  },
  "specialistAssignments": {
    "security-audit": {
      "model": "anthropic/claude-sonnet-4-6",
      "reasoningEffort": "high"
    }
  }
}
```

Only use model identifiers returned by the imported provider pool unless `allowUnavailableModels` is deliberately enabled.

## Troubleshooting

### The specialist is not available

Check that:

- The name is lowercase and does not collide with a managed role, `build`, or `plan`.
- The configuration key and `name` value are identical.
- `description` is non-empty.
- The Lite configuration file is in the active OpenCode config directory.
- The installer was rerun after the configuration change.

### The specialist cannot edit a file

Add the file's directory to `editFolders`. Remember that omitted or empty `editFolders` denies all edits. Prefer directory paths such as `src/security` rather than broad wildcards.

### A model assignment is rejected

Run `bounded_lite_model_config({ "action": "import" })` and use an exact `provider/model` ID from the imported pool. Set `allowUnavailableModels: true` only for an intentional unavailable-model escape hatch.

### The configured level is not reflected in a session

Start a new OpenCode session or reload the generated agent state. Session-level model controls can override persisted defaults by design.

## Related documentation

- [`README.md`](../README.md) — installation and model configuration overview.
- [`AI-INSTALL.md`](../AI-INSTALL.md) — AI-assisted installation and `/agent-models` workflow.
- [`ARCHITECTURE_OVERVIEW.md`](ARCHITECTURE_OVERVIEW.md) — role topology and reasoning hierarchy.
- [`FOCUS_SPECIALIST_AGENTS_AND_REASONING_IMPLEMENTATION_PLAN.md`](FOCUS_SPECIALIST_AGENTS_AND_REASONING_IMPLEMENTATION_PLAN.md) — implementation details and verification history.
