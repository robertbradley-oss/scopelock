# Interaction Workflows

The MVP exposes three focused skills:

- `$scope-lock`
- `$scope-status`
- `$scope-verify`

`$scope-lock` also handles explicit amendments and closing so the plugin does not become a menu of tiny skills.

## Job story

When I ask Codex to change a limited part of a project, I want to approve what it may touch and later see whether the repository stayed inside that boundary, so I do not need to manually untangle a large diff.

## Lock workflow

### Place: No active Lock

- Create a proposed Lock -> Proposed Lock
- Inspect product status -> No active Lock result

Content:

- Current branch and HEAD
- Existing staged, unstaged, deleted, renamed, and untracked paths
- Repository limitations

### Place: Proposed Lock

- Approve -> Active Lock
- Revise objective or scope -> Proposed Lock
- Cancel -> No active Lock

Content:

- Objective
- Allowed files and directories
- Forbidden files and directories
- Locked constraints
- Definition of done
- Required validation
- Baseline limitations

Rules:

- When the user supplies the objective and exact scope, ScopeLock may activate without a second confirmation.
- When ScopeLock infers a material path, constraint, or boundary, it must present the proposal and ask before activation.
- The proposal must not be activated while the allowed scope remains ambiguous.
- The proposal must contain a concrete objective and at least one allowed file or directory.
- Allowing `.` requires an explicit user instruction because it covers the whole project.
- Invoking Lock authorizes writes only under `.codex-scope/`.
- If an active Lock already exists, the user must amend, close, or abandon it. ScopeLock never overwrites it.
- Existing staged, unstaged, deleted, renamed, and untracked paths do not block activation.
- Existing outside-scope paths are recorded as `pre-existing`.

### Place: Active Lock created

- Inspect status -> Status result
- Amend scope -> Proposed amendment
- Continue project work -> Outside ScopeLock
- Verify -> Verification result
- Close or abandon -> No active Lock

Content:

- Lock ID
- Human-readable contract path
- Baseline summary
- Important limitations

## Status workflow

### Place: Active Lock

- Inspect current repository -> Status result

Status is read-only. It does not update the Baseline, approve findings, run tests, or modify source files.

### Place: Status result

- Continue work -> Active Lock
- Propose amendment -> Proposed amendment
- Verify -> Verification result
- Inspect a reported path -> Outside ScopeLock

Default presentation:

1. One plain-language headline
2. A few helper-generated summary sentences
3. One recommended next action

Lock identity, evidence labels, category detail, rules, and validation records remain available when the user asks for details.

Failure paths:

- Missing active pointer
- Corrupt contract or Baseline
- Branch changed or history became incompatible with the Baseline
- Project root changed
- Concurrent repository change during inspection
- Unsupported repository state
- Non-Git project, which is unsupported in the MVP

## Amendment workflow

### Place: Proposed amendment

- Approve -> Active Lock with amendment
- Revise -> Proposed amendment
- Reject -> Active Lock unchanged

Content:

- Exact allowed paths being added
- Reason
- Current findings affected
- Whether any finding was observed before the amendment
- Evidence limitations

Rules:

- The original contract and Baseline remain unchanged.
- The amendment is a separate timestamped record.
- An already observed out-of-scope finding becomes `late-approved`, not originally in-scope.
- The MVP does not remove allowed paths or add forbidden paths to an active Lock.
- Tightening scope requires closing the active Lock and creating a new one.
- ScopeLock never infers approval from a code change, package installation, or checkpoint text.

## Verify workflow

### Place: Active Lock

- Compare without running validation -> Verification result
- Run explicitly approved validation -> Validation running
- Cancel -> Active Lock

### Place: Validation running

- Command passes -> Verification result
- Command fails -> Verification result
- Command cannot run -> Verification result

Validation rules:

- Lock and Status never run tests.
- Verify runs only commands the current user explicitly approves.
- A command listed under Validation requirements is not automatically approved for execution.
- Each command records exact result, exit status when available, and a concise sanitized summary.
- A missing result is `not run` or `unknown`, never `passed`.

### Place: Verification result

- Continue fixing findings -> Active Lock
- Amend scope -> Proposed amendment
- Close -> No active Lock
- Abandon -> No active Lock

Content:

- Default: one plain-language outcome, a few helper-generated summary sentences, and exactly one recommended next action
- On request: repository comparison; committed, staged, unstaged, deleted, renamed, and untracked changes; categorized findings; validation evidence; limitations; and the local report path

Verify writes an immutable report but does not close the Lock automatically.

A report containing any `late-approved` finding cannot receive `pass`. Its best possible outcome is `warning`.

## Close and abandon

Close means the user intentionally finished using the Lock.

Abandon means the user intentionally ended the Lock without a clean verification.

Neither action deletes the Lock, Baseline, amendments, or reports.

Closing and abandoning are explicit. A successful Verify does not perform either action.

## Interaction principles

- Ask only when a decision materially changes scope, evidence, or source state.
- Never ask for confirmation merely to perform Status.
- Show paths and findings before explanations.
- Keep Status to one screen when practical.
- Never describe warnings as enforcement.
- Keep stored user intent separate from live repository facts.
