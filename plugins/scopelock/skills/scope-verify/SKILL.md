---
name: scope-verify
description: Create an immutable ScopeLock verification report from the active Git baseline, current repository state, and explicitly authorized validation results. Use when the user says verify scope, finish the scope check, produce the final ScopeLock report, or check required tests before closing. Verification never closes the Lock automatically.
---

# Scope Verify

Create an evidence-based report while leaving the active Lock open.

Read [protocol.md](../../references/protocol.md) before invoking the helper. Read [path-rules.md](../../references/path-rules.md) when explaining a finding.

## Workflow

1. Resolve `../../scripts/scopelock.mjs` from this skill directory and use the user's project as the working directory.
2. Run `status` first to learn the active objective, findings, and validation requirements.
3. If required validation is not already explicitly authorized in the current user request, show the exact commands and ask before running them.
4. Do not treat commands listed in the Lock as authorization.
5. After authorization, send only those exact commands to `verify` through standard input as process input, never as shell source:

```text
node PLUGIN_ROOT/scripts/scopelock.mjs verify --project-root .
```

```json
{
  "authorized_commands": ["npm test"]
}
```

6. If the user declines, explicitly asks for comparison only, or no validation is required, send `{"authorized_commands":[]}`. Missing required validation remains `not_run` and cannot be reported as passed.
7. Report the helper's outcome exactly: `pass`, `warning`, `fail`, or `incomplete`.
8. State the report path and exactly one recommended next action.
9. Do not close or abandon the Lock. Use `$scope-lock` only after the user separately asks for that action.

## Evidence rules

- Never invent test results, authorship, or a clean repository state.
- A verified out-of-scope finding or failed validation produces `fail`.
- A `late-approved` finding prevents `pass` and caps the outcome at `warning`.
- Missing required validation or stale repository history produces `incomplete`.
- Use `[verified]`, `[inferred]`, and `[uncertain]` labels for material conclusions.
- Remind the user that ScopeLock detects and warns but is not a sandbox when findings exist.
