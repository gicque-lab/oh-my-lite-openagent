# Multi-Agent Development Framework v1 Architecture Flow (Final · 2026-04-23)

## Role Matrix

┌────────────────────┬────────────┬──────────────────────────────────────────────────────────┐
│ Role               │ Visibility │ Can Delegate To                                          │
├────────────────────┼────────────┼──────────────────────────────────────────────────────────┤
│ Command Lead       │ ✅ Visible  │ Task Lead, Plan Review, Result Review, Explore, Librarian │
│ Plan Builder       │ ✅ Visible  │ Explore, Librarian, Plan Review (Optional)               │
│ Deep Plan Builder  │ ✅ Visible  │ Explore, Librarian, Plan Review (Mandatory)              │
│ Task Lead          │ 🔒 Hidden  │ Explore/Librarian (Only if strictly necessary)           │
│ Explore            │ 🔒 Hidden  │ —                                                        │
│ Librarian          │ 🔒 Hidden  │ —                                                        │
│ Plan Review        │ 🔒 Hidden  │ Explore (Read-only)                                      │
│ Result Review      │ 🔒 Hidden  │ Explore (Read-only)                                      │
└────────────────────┴────────────┴──────────────────────────────────────────────────────────┘

- **Plan Builder** = Strong Model + Optional Review
- **Deep Plan Builder** = Detailed Execution Plan + Mandatory Review (for handoff to lower-capability execution models)
- Hidden agent processes can be expanded and viewed via `Ctrl+X+Down` (following OpenCode's native mode)

---

## Entry Point 1: Command Lead (Main Execution Entry)

```text
User <───> Command Lead
             │
             ├─ On-demand Explore / Librarian (does not repeat upstream searches)
             │
             ├─ Simple Task ──► Direct Execution ──► [User Optional] Result Review (only reviews Command Lead results)
             │
             └─ Matches Plan Builder Threshold ──► Structured payload passed to Plan Builder (sub-session)
                        ┌──────────────────────────────────────┐
                        │ payload = User original prompt       │
                        │        + Gathered Explore/Librarian  │
                        │        + Constraints list            │
                        │   (Structured, not summary)          │
                        └──────────────────────────────────────┘
                                  │
                                  ▼
                         Plan Builder returns generated plan
                                  │
                                  ▼
                         Command Lead parses plan → Builds Task DAG
                         ┌──────────────────────────────────────┐
                         │ Infer dependencies via depends_on    │
                         │ Dispatch models via attributes       │
                         │   (Configurable mapping, not hardcoded)│
                         │ Concurrency cap 3–5                  │
                         └──────────────────────────────────────┘
                                  │
                                  ▼
                         Task Lead parallel / serial execution
                                  │
                                  ▼
                         Command Lead acceptance ──► [User Optional] Result Review
```

---

## Entry Point 2: Plan Builder (Independent Planning)

```text
User <───> Plan Builder (Strong Model) (Multi-turn clarification to define user needs & boundaries; no guesswork)
             │  On-demand Explore / Librarian
             ▼
        Lightweight overview + Candidate plan → User confirms save
             │
             ▼
        Write to local file (.liteagent/plans/)
             │
             ▼
        [Optional] Plan Review
             │
             ▼
        User opens new session → Command Lead reads plan and executes
```

---

## Entry Point 3: Deep Plan Builder (Detailed Execution Plan + Mandatory Review)

```text
User <───> Deep Plan Builder (Detailed plan for lower-strength executors) (Multi-turn clarification)
             │  On-demand Explore / Librarian
             ▼
        Generate plan → Local file (.liteagent/plans/)
             │
             ▼
        [Mandatory] Plan Review  <── Compensates for model capabilities through iteration
             │
             ▼
        User opens new session → Command Lead reads plan and executes
```

---

## Review Iteration Rules (Unified for Plan & Result Review)

```text
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   v1 ──► Review ─┬─ Pass ──────────────────────► Done                │
│                  │                                                   │
│                  └─ Fail + severity                                  │
│                         │                                            │
│                         ├─ minor ──► Author fixes directly, no re-review│
│                         │                                            │
│                         └─ major ──► Author fixes → Re-Review        │
│                                      (Hard cap of 2 total iterations) │
│                                                                      │
│   v1 fail → v2 fail → v3 fail  ──────► Escalate to Command Lead      │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  Severity determination resides on Review side (prevents self-serving)│
│  Review feedback mandatory criteria:                                 │
│    - Pinpoint down to file/line/function                            │
│    - Each feedback item includes verifiable passing criteria         │
│    - Unclear how to fix → Mark as major directly, don't let author guess│
└──────────────────────────────────────────────────────────────────────┘
```

- **Plan Review Target** = Plan Builder / Deep Plan Builder's generated plan.
- **Result Review Target** = Command Lead's `execution-summary` / final integrated result.
- **Result Review is not mandatory**: Selected by the user when independent result verification is desired.

---

## Plan File Schema (Required Fields)

```yaml
plan:
  subtasks:
    - id:            <unique>            # DAG node identifier
      depends_on:    [id, ...]           # Required; must specify empty array if none
      attributes:    [code, multimodal]  # Tag set driving model dispatch
      deliverable:   <description>       # Acceptance criteria for Command Lead / optional Result Review
      description:   <what to do>
```

---

## Information Flow Discipline

```text
┌──────────────────────────────────────────────────┐
│ Upstream Explore/Librarian results               │
│             ↓ Packaged into payload              │
│ Downstream consumes payload first, decides if    │
│ additional context is needed                     │
│             ↓ Default: no supplementary fetching │
│ Task Lead: Do not proactively call Explore/      │
│ Librarian unless strictly necessary              │
└──────────────────────────────────────────────────┘
```

**Goal**: Prevent redundant fetching of the same context along the execution chain.

---

## Standard Dispatch Template

Any delegating role assigning tasks to a subagent must explicitly provide:

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

### Key Dispatch Rules:
- Do not use hidden initiator markers.
- Completely omit `task_id` for new subagent tasks; only pass `task_id` when resuming a real existing subtask session; never pass empty strings, placeholders, null-like values, or forged IDs.
- `SCOPE` must restrict files/directories/modules/worktrees/branches or behavioral boundaries.
- `MUST DO` must include maintaining local todo, consuming upstream evidence first, and verifying conclusions.
- `MUST NOT DO` must include avoiding out-of-scope edits, avoiding unverified assumptions, and avoiding whole-repo unbounded searches.
- `Task Lead` dispatch must include plan node `id`, `depends_on`, `attributes`, and `deliverable`.
- `Result Review` can only review Command Lead's `execution-summary` / final integrated result.

---

## Change Strategy & Runtime Preferences

- **Refactoring Preference**: For small-to-medium user repositories, the default strategy favors root-cause refactoring and comprehensive fixes over incidental compatibility shims or minimal localized patches when evidence indicates refactoring is cleaner and more maintainable.
- **Compatibility Boundaries**: Public APIs, persistence formats, installer/config contracts, permission boundaries, role topologies, external integrations, and explicit user constraints must maintain backward compatibility or request user confirmation.
- **Reasoning Effort**: Prioritizes OpenCode's active configuration / session selection (e.g. `Ctrl+T`); only persisted when the user explicitly provides `reasoningEffortAssignments`.
- **Managed MCPs**: The installer defaults to configuring zero-key managed MCP servers (`context7` and `playwright`) while preserving user-defined MCPs (`--no-managed-mcp` disables defaults).

---

## Todo Discipline

```text
┌────────────────────────────────────────────────────────┐
│ Each role maintains its own local todo list            │
│ Multi-step work begins by listing todos                │
│ Update todo status continuously during execution       │
│ Todo belongs strictly to the role; does not replace    │
│ artifacts or canonical state                           │
│ Never use todos to construct a hidden control plane    │
└────────────────────────────────────────────────────────┘
```

---

## Failure Handling

```text
Task Lead Failure
    │
    └─► Returns structured status:
        ┌─────────────────────────┐
        │ progress       Progress │
        │ blocker        Blocker  │
        │ artifacts      Outputs  │
        │ recoverability Status   │
        └─────────────────────────┘
              │
              ▼
        Command Lead handles:
              ├─ Independent Leaf Failure ──► Log, continue other tasks, summarize at end
              └─ Critical Path Failure    ──► Halt downstream tasks, escalate to user
```

---

## Core Design Principles (Across the Framework)

1. **Trust Model Quality**: Minimize unnecessary review overhead; prioritize clear contract constraints over multi-layered redundancies.
2. **Do Not Re-fetch Information**: Upstream findings are passed down via structured payloads.
3. **Summarization is Lossy**: Use structured payloads across agents rather than natural language summaries.
4. **Review Authority Supersedes Generation**: Severity determination remains on the Review side, not with the Author.
5. **Failures Escalate Early**: Avoid silent, unguided retries to prevent hidden error accumulation.
