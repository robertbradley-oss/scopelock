# Status workflow

Inspect the active Lock without changing its contract, Baseline, amendments, reports, source files, or Git state.

Read [protocol.md](../../references/protocol.md) before invoking the helper. Read [path-rules.md](../../references/path-rules.md) when explaining a match.

## Workflow

1. Resolve `../../scripts/scopelock.mjs` from this skill directory and use the user's project as the working directory.
2. Run:

```text
node PLUGIN_ROOT/scripts/scopelock.mjs status --project-root .
```

3. Do not run tests, create amendments, update the Baseline, close the Lock, or write a report.
4. Treat `stale`, `unavailable`, and `incomplete` results as non-clean. Never guess around missing or contradictory evidence.
5. Never attribute a change to Codex, the user, or another process.

## Present the result

Default to the helper's `summary` object. Render only this shape:

```text
**SUMMARY_HEADLINE**

SUMMARY_LINES

**Next:** SUMMARY_NEXT_ACTION
```

- Copy `summary.headline`, each `summary.lines` entry, and `summary.next_action` without adding technical interpretation.
- Keep the summary to a few plain sentences. Do not show the Lock ID, objective, evidence labels, category headings, raw JSON, schema names, rules, counts not already in `summary`, or contract path unless the user asks for details.
- The summary may omit `[verified]`, `[inferred]`, and `[uncertain]` syntax because it is generated deterministically from the helper's classified evidence. Never remove those labels from a requested detailed view.
- When the helper reports an out-of-scope or late-approved change, retain its plain warning that ScopeLock reports changes but does not block them.
- If the user asks for details, then show the underlying categories, validation evidence, limitations, Lock identity, and exactly one recommended next action. Preserve every evidence label and never attribute authorship.
