---
name: scope-status
description: Compare the current Git repository with an active ScopeLock baseline and report scope drift. Use when the user asks for scope status, what changed since the lock, whether work stayed in bounds, or whether an active ScopeLock is healthy. This is read-only and does not run tests or approve changes.
---

# Scope Status

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

Keep the normal result to one screen and use this order:

1. Lock identity and objective
2. Overall health
3. Baseline-critical changes
4. Pre-existing paths
5. In-scope paths
6. Out-of-scope paths
7. Approved amendments and late approvals
8. Uncertain paths
9. Validation requirements and evidence
10. Exactly one recommended next action

Use `[verified]`, `[inferred]`, and `[uncertain]` labels. State that ScopeLock detects and warns but is not a sandbox when an out-of-scope finding is present.
