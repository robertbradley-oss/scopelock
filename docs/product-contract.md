# Product Contract

## Problem

Codex can work in a repository that already contains user changes, changes from another agent, generated files, or branch divergence. The user may see a large Git diff without a trustworthy answer to three basic questions:

1. What existed before this task?
2. What changed after the task boundary was established?
3. Which changes fall outside the work the user approved?

## Promise

ScopeLock establishes an explicit task boundary, records the starting repository state, compares later repository state with that baseline, and reports in-scope, out-of-scope, pre-existing, amended, and uncertain findings honestly.

ScopeLock does not promise that it can prevent every write. It provides warning, detection, interruption where supported, and a trustworthy final report.

## Primary user

An individual Codex user working locally in a software project, including a project with uncommitted work.

## Core jobs

### Before work

Create and approve a task contract containing the objective, allowed paths, forbidden paths, constraints, definition of done, and required validation.

### During work

Inspect the current project and identify verified drift from the approved contract without changing source files.

### At completion

Produce a concise verification report that states whether the task remained within scope and whether required validation is evidenced.

## MVP behavior

- Local-first and human-readable.
- Git repository required for the MVP.
- Non-Git projects receive a clear unsupported result and no Lock is activated.
- Scope rules accept exact project-relative files and directory prefixes only.
- Safe around pre-existing staged, unstaged, deleted, renamed, and untracked paths.
- Lock activation does not require committing, stashing, or cleaning existing work.
- Same-branch commits remain comparable while the Baseline commit is still an ancestor of current HEAD.
- Warning-only behavior with no strict blocking option.
- No automatic source edits, commits, pushes, stashes, resets, restores, or reverts.
- No automatic test execution during Lock or Status.
- Verify may run validation only when the user explicitly authorizes the concrete commands.
- Merely listing a required command in the Lock does not authorize its execution.
- No reading or hashing of untracked file contents. Only sanitized relative paths and status are recorded.
- One-way fingerprints may be stored for already-modified tracked files when the path is not likely sensitive.
- No network dependency.

## Non-goals

ScopeLock is not:

- A sandbox or operating-system security boundary.
- A project-management system.
- A task tracker.
- A source-control client.
- A code-ownership system.
- A test framework.
- A generic audit-log platform.
- A telemetry or employee-monitoring product.
- A tool that proves who authored a line of code.
- A tool that silently repairs, reverts, or approves out-of-scope work.

## Evidence labels

Every material conclusion in structured evidence and detailed reports uses one of these evidence classes:

- `[verified]`: proven from the accepted baseline and current repository inspection.
- `[inferred]`: derived from user intent or contextual interpretation, but not independently proven by repository evidence.
- `[uncertain]`: evidence is missing, limited, stale, concurrent, or contradictory.

The default user-facing summary intentionally omits this label syntax. It is generated deterministically from the same classified helper evidence, adds no inferred authorship, and keeps the labeled detail available on request.

Path findings also use one of these categories:

- `pre-existing`
- `in-scope`
- `out-of-scope`
- `approved-amendment`
- `late-approved`
- `uncertain`

ScopeLock never converts user intent into repository fact and never attributes a change to Codex when another writer could have caused it.

## Product principles

1. Honest limitations are product features.
2. Detection is more valuable than a false promise of prevention. The MVP has no strict blocking mode.
3. The user approves scope. The agent does not silently broaden it.
4. The original contract and baseline remain immutable.
5. A later amendment does not erase an earlier out-of-scope observation.
6. Active Locks may expand allowed scope but cannot remove allowed paths or add new forbidden paths.
7. Repository facts are newer authority than stored prose.
8. The approved MVP path grammar contains exact files and directory prefixes only.
9. The plugin must remain useful when hooks are disabled or untrusted.
10. ScopeLock writes only to its own storage during Lock, Amend, Verify, and Close.
11. ScopeLock never reads secrets merely to improve attribution.
12. Stored tracked-file fingerprints are evidence of change, not authorship.
13. Verification and closing are separate user decisions.
14. A late-approved finding preserves history and prevents a completely clean pass for that Lock.
15. Validation requirements are expectations, not standing command authorization.
16. Compatible history advancement is part of the task, while rewritten or divergent history makes the Lock stale.
17. Pre-existing out-of-scope work is protected context, not a new finding.
18. Explicit scope is authorization to activate, while inferred scope must be approved.
19. A Lock without a concrete objective and at least one allowed path is invalid.

## Success test

A stranger can:

1. Install ScopeLock.
2. Lock a task to one directory in a dirty Git repository.
3. Let Codex make one in-scope change and one out-of-scope change.
4. Run Status and understand both findings without reading raw Git output.
5. Run Verify and receive an honest report that does not invent authorship or test results.

## Demo sentence

Lock Codex to one folder, then watch ScopeLock catch a change outside it.
