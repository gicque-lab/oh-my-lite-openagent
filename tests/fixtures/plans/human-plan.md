---
plan_schema_version: 2.1
maturity_level: M3
status: reviewed
title: C02 — Fix structured validation arguments, schema projection and diagnostics
generated_by: deep-plan-builder
---

# C02 — Fix structured validation arguments, schema projection and diagnostics

Human-readable companion to `structured-plan.json`. The labeled block below is
the same executable payload: extract the fenced `json plan-payload` block and
`JSON.parse` it, then submit it as the named `payload` object of
`bounded_lite_plan_readiness` / `bounded_lite_plan_dag`.

## Executable plan payload

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

## Notes

- Raw Markdown alone is not a valid tool argument: submit the parsed payload
  object. Strings are never `JSON.parse`-ed by the tools.
- DAG-only callers may supply just `plan.subtasks`; readiness callers add the
  frontmatter-style fields shown above.
