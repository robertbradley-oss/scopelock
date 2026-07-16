# Phased Implementation Plan

## Phase 1: Product definition

Deliver:

- Product contract
- Conceptual model and vocabulary
- Interaction workflows
- Storage and schema contract
- Path grammar
- Evidence model
- Hook feasibility decision
- Risk and adversarial test matrix
- Security context and threat assumptions
- Smallest credible architecture

Stop for approval before implementation.

Current status: complete and approved.

## Phase 2: Skill-only prototype

Current status: complete and approved.

Build:

- Plugin scaffold
- `$scope-lock`
- `$scope-status`
- `$scope-verify`
- Deterministic Node helper
- Git analyzer and explicit non-Git rejection
- Fixture suite

Do not add hooks in this phase.

Acceptance:

- The three workflows pass the core adversarial fixtures.
- Dirty-worktree classification is honest.
- No untracked contents are read.
- No source files are changed by Lock or Status.
- Verify reports validation evidence exactly.
- No strict blocking option is exposed.
- Path matching accepts exact files and directory prefixes only.
- Active-Lock amendments can only add allowed paths.
- Already-modified tracked files use safe one-way fingerprints, excluding sensitive paths.
- Verify leaves the Lock active until the user explicitly closes or abandons it.
- A late-approved finding limits the final result to warning.
- Listed validation commands require separate execution approval.
- Same-branch ancestor-preserving commits remain comparable.
- Dirty repositories activate without requiring commit, stash, or cleanup.
- Explicit complete scope activates directly; inferred material scope requires approval.
- Every Lock requires an objective and at least one allowed path.

## Phase 3: Optional hook assistance

Current status: complete and approved.

Add:

- SessionStart context reinforcement
- PreToolUse advisory warnings
- PostToolUse bounded status checks
- Safe Stop reminder

Acceptance:

- Hooks are optional and trusted explicitly.
- The plugin remains fully usable without them.
- Copy never claims hard blocking.
- The initial hook release does not stop tool execution or automatically halt after a finding.
- Windows behavior is verified and the POSIX command shape is verified through Git Bash. True POSIX semantics are a Phase 3.5 release gate.
- Hook overhead is measured and acceptable.

Evidence:

- Default `hooks/hooks.json` discovery is used without a manifest `hooks` field.
- SessionStart, PreToolUse, PostToolUse, and Stop use one dependency-free Node handler.
- Hook output never denies, rewrites, blocks, or stops execution.
- Shell text is not parsed as proof of a target path.
- Windows test runs completed within the configured 5 to 12 second handler bounds.
- The Phase 3 Windows suite passed 24 tests with zero failures.

## Phase 3.5: Reliability preflight

Current status: Windows preflight complete. The owner accepted the unverified Linux and macOS risk and authorized Phase 4 on 2026-07-16.

Review:

- Security threat model
- Language-specific secure coding
- Path traversal and link handling
- Secret-safe inspection
- Concurrency
- Large repositories
- Corrupt storage
- Nested Git and submodules
- Hook trust and disablement
- Cross-platform behavior

Run plugin validation, skill validation, unit tests, fixture tests, and fresh-session routing tests.

Evidence is recorded in `../PHASE-3.5.md`, `../scopelock-threat-model.md`, and `../security_best_practices_report.md`.

## Phase 4: Package and polish

Current status: complete. The public GitHub repository and `v0.1.0` release were created on 2026-07-16.

Create:

- Public README
- Installation and update instructions
- Privacy documentation
- Icon, logo, and social preview
- Example project
- Demo script and video
- Changelog
- Marketplace entry
- GitHub repository and release

## Phase 5: Real-user test

Ask testers to:

1. Install ScopeLock.
2. Lock a task to one directory in a dirty repository.
3. Create one in-scope and one out-of-scope change.
4. Run Status.
5. Run Verify.

Success:

- A stranger understands the report without raw Git inspection.
- The tester does not mistake ScopeLock for a sandbox.
- ScopeLock catches useful drift without becoming annoying.
- At least one tester says it prevented time spent untangling unrelated changes.

## Development support

Use Clean Handoff after each approved phase to preserve objective, decisions, constraints, repository state, test evidence, and the next action.
