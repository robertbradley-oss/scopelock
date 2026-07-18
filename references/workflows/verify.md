# Verify workflow

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
7. Report the helper's exact outcome through its plain-language `summary` headline: passed, warning, failed, or incomplete.
8. Render only the helper's `summary` by default, followed by `Detailed evidence was saved locally.` Do not print the report path unless the user asks for details.
9. Do not close or abandon the Lock. Return to the Lock lifecycle workflow only after the user separately asks for that action.

## Present the result

Use this default shape:

```text
**SUMMARY_HEADLINE**

SUMMARY_LINES

**Next:** SUMMARY_NEXT_ACTION

Detailed evidence was saved locally.
```

- Copy `summary.headline`, each `summary.lines` entry, and `summary.next_action` without adding technical interpretation.
- Do not show evidence labels, category headings, raw JSON, schema names, validation timing, the Lock ID, or the report path unless the user requests details.
- The concise summary may omit evidence-label syntax because it is generated deterministically from classified helper evidence. A requested detailed view and the immutable report must retain the full evidence labels and finding categories.
- If `report_written` is false, do not claim evidence was saved. Render the summary and its one next action only.

## Evidence rules

- Never invent test results, authorship, or a clean repository state.
- A verified out-of-scope finding or failed validation produces `fail`.
- A `late-approved` finding prevents `pass` and caps the outcome at `warning`.
- Missing required validation or stale repository history produces `incomplete`.
- Preserve `[verified]`, `[inferred]`, and `[uncertain]` labels in detailed output and the immutable report.
- Remind the user that ScopeLock detects and warns but is not a sandbox when findings exist.
