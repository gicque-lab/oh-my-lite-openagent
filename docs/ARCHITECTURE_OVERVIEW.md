# OpenCode Lightweight Multi-Agent Orchestration Architecture v1

This repository is a lightweight global orchestration plugin for OpenCode, not a general-purpose application framework. The core deliverables are `.opencode/agents/**`, `.opencode/plugins/**`, `.opencode/lib/**`, `scripts/managed-config.mjs`, and `scripts/install.mjs`. The repository root does not contain user-level `opencode.json`.

---

## 1. Fixed Role Topology

Users interact with only 3 visible entry points:

- `command-lead`: Execution entry point.
- `plan-builder`: Planning entry point, strong model, optional Plan Review.
- `deep-plan-builder`: Deep planning entry point, generates detailed execution plans suitable for handoff to lower-capability execution models, mandatory Plan Review.

There are 5 fixed hidden roles:

- `task-lead`: Execution orchestrator for a single bounded task.
- `explore`: Local read-only workspace exploration.
- `librarian`: External documentation and open-source reference retrieval.
- `plan-review`: Plan artifact review.
- `result-review`: User-selectable result review; reviews only Command Lead's execution summary / final integrated result.

OpenCode built-in `build` and `plan` remain disabled via hidden overrides to prevent bypassing the plugin entry points.

---

## 2. Delegation Matrix

```text
Command Lead       -> Task Lead, Plan Builder, Deep Plan Builder, Explore, Librarian, Plan Review, Result Review
Plan Builder       -> Explore, Librarian, Plan Review
Deep Plan Builder  -> Explore, Librarian, Plan Review
Task Lead          -> Explore, Librarian
Plan Review        -> Explore
Result Review      -> Explore
Explore            -> none
Librarian          -> none
```

`MAX_CHILD_ORCHESTRATOR_DEPTH = 1`. No role, hook, manager, or background coordinator may create a second-tier orchestrator.

---

## 3. Execution Entry Point

Command Lead maintains overall routing, approval, artifact persistence, state advancement, and final acceptance.

Simple tasks may be executed directly without requiring Result Review. Result Review is an optional review selected by the user, targeting only Command Lead's `execution-summary` or final integrated result. When the routing threshold selects Plan Builder, Command Lead first gathers necessary Explore/Librarian evidence before passing a structured payload:

```yaml
payload:
  user_request: <user original prompt>
  upstream_evidence:
    explore: []
    librarian: []
  constraints: []
```

The payload is a structured fact package, not a lossy natural-language summary. Downstream roles consume the payload first, only triggering supplementary Explore/Librarian queries when missing blocking facts.

Any delegating role assigning tasks to a subagent must use the explicit field template and omit hidden initiator markers. New task tool invocations must omit `task_id` completely; `task_id` is passed only when resuming an existing subtask session (never pass empty strings, placeholders, null-like values, or forged IDs):

```text
TASK:
<Single bounded task>

EXPECTED OUTCOME:
1. <Must-produce deliverable>
2. <Must-produce deliverable>

ROLE:
<task-lead|explore|librarian|plan-review|result-review>

SCOPE:
<Allowed files, directories, modules, worktrees, branches, or behavioral boundaries>

UPSTREAM EVIDENCE:
- explore: []
- librarian: []
- constraints: []

REQUIRED TOOLS:
<Allowed tools and command categories; restrict bash to safe command families>

MUST DO:
- Maintain local todo for this role.
- Consume upstream evidence first.
- Verify conclusions against sources within the designated SCOPE.

MUST NOT DO:
- Do not exceed SCOPE.
- Do not make assumptions about unexamined code or documentation.
- Do not run unbounded whole-repo searches.

CONTEXT:
<User prompt, worktree status, known decisions, and identified risks>

DELIVERABLE FORMAT:
<Required sections, schema, or artifact format>

FAILURE RETURN:
progress: <current progress>
blocker: <specific blocker>
artifacts: [<existing outputs>]
recoverability: recoverable|partial|blocked
```

Task Lead dispatch must include plan node `id`, `depends_on`, `attributes`, and `deliverable`. Read-only roles must explicitly forbid editing in `MUST NOT DO`. Result Review targets only Command Lead's `execution-summary` or final integration result.

Command Lead's default change strategy for small-to-medium user repositories favors root-cause refactoring: when evidence shows refactoring/migration is cleaner and cheaper than compatibility shims, fix the root cause and update internal call sites, tests, and documentation. Public APIs, persistence formats, installer/config contracts, permission boundaries, role topologies, external integrations, and explicit user constraints must maintain backward compatibility or request user confirmation.

The installer defaults to configuring zero-key managed MCP servers: `context7` and `playwright`. Existing user MCP servers are preserved; user-defined `context7`/`playwright` take precedence. `--no-managed-mcp` disables default managed MCPs. Generated `<configDir>/agents/*.md` files are managed outputs and should not be edited manually for long-term preferences.

Reasoning effort hierarchy: OpenCode's active configuration / session selection (e.g. `Ctrl+T`) > user explicitly persisted `reasoningEffortAssignments` in lite configuration > plugin read-only recommendation defaults. `action: auto` only previews; `action: apply` without reasoning assignments will not persist default reasoning effort.

---

## 4. Planning Entry Points

**Plan Builder** is a strong-model planner focused on requirement clarification and actionable plan skeletons. It clarifies user requirements, boundaries, and acceptance criteria across multiple turns without assuming unstated product decisions. Candidate plans are first presented as lightweight overviews; plans are written to `.liteagent/plans/` only after explicit user confirmation. Plan Review is optional.

**Deep Plan Builder** is a deep planner responsible for generating execution-level detailed plans for handoff to lower-capability execution models, with mandatory Plan Review mitigating handoff risks.

---

## 5. Plan File Schema

The executable plan schema must contain:

```yaml
plan:
  subtasks:
    - id: <unique>
      depends_on: [id, ...]
      attributes: [code, multimodal]
      deliverable: <acceptance criteria for Command Lead / optional Result Review>
      description: <what to do>
```

Rules:
- `depends_on` is required (use empty array if no dependencies).
- `attributes` is a tag set driving configurable model/profile dispatch.
- Command Lead constructs the DAG from `depends_on`.
- Concurrency limit is capped at 3–5.
- Dispatch mappings are configurable; model IDs are never hardcoded in plan parsing logic.

---

## 6. Review Rules

Plan Review reviews only Plan Builder / Deep Plan Builder plan artifacts. Result Review reviews only Command Lead's `execution-summary` or final integrated results, not Task Lead's intermediate summaries. Result Review is optional.

Unified review output:

```yaml
decision: pass|reject|escalate
severity: minor|major
findings:
  - location: <file/line/function/section>
    issue: <specific issue>
    pass_criteria: <verifiable passing criteria>
```

The Review role holds severity decision authority; authors cannot downgrade `major` to `minor`.

Iteration rules:
- `pass`: Finished.
- `reject + minor`: Author fixes directly, no mandatory re-review.
- `reject + major`: Author fixes and submits for re-review.
- Major issues allow a maximum of 2 revision iterations; a 3rd failure escalates to Command Lead or the user.
- Feedback that cannot clearly describe the required fix is classified as `major`.

---

## 7. Todo Discipline

All roles maintain a local todo list following OpenCode's workflow:
- Initialize role todos at the start of multi-step work.
- Update todo status continuously as progress is made.
- Verify todos have converged or document remaining blockers before finishing.
- Todos represent private working memory; they do not form a cross-agent control plane and do not replace artifacts, payloads, or canonical state.

---

## 8. Failure Handling

Task Lead failures return structured status:

```yaml
progress: <current progress>
blocker: <blocker details>
artifacts: [<existing outputs>]
recoverability: recoverable|partial|blocked
```

Command Lead assesses DAG impact:
- **Independent leaf failure**: Log failure, continue unaffected tasks, summarize at the end.
- **Critical path failure**: Halt downstream tasks, escalate to user.

---

## 9. Canonical State Machine

The primary state machine:

```text
draft -> needs-approval -> approved -> executing -> reviewed
reviewed -> needs-approval
reviewed -> draft
reviewed -> approved
```

Only Command Lead advances canonical state. Review roles only output review decisions and never silently modify artifacts.

---

## 10. Plugin Tools

All custom plugin tools must start with `bounded_lite_` and match `^[a-zA-Z0-9_-]+$`.

Current tools:
- `bounded_lite_route`
- `bounded_lite_plan_dag`
- `bounded_lite_plan_readiness`
- `bounded_lite_background`
- `bounded_lite_runtime_profile`
- `bounded_lite_model_config`

The plugin provides thin orchestration enhancements: route resolution, DAG validation, background task tracking, runtime profile reporting, and role model configuration. It is not a secondary hidden runtime.
