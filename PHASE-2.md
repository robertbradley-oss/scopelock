# ScopeLock Phase 2

Status: complete and awaiting approval before Phase 3

Phase 2 delivers a hook-free Codex plugin prototype. It creates a local task boundary in a Git project, compares later repository state with the accepted Baseline, and reports findings without claiming hard prevention.

## Delivered

- Plugin manifest at `.codex-plugin/plugin.json`
- `$scope-lock` for activation, expansion-only amendments, close, and abandon
- `$scope-status` for read-only repository comparison
- `$scope-verify` for immutable verification reports and explicitly authorized validation
- Built-in-only Node helper at `scripts/scopelock.mjs`
- Shared helper and path references
- Node fixture suite covering the Phase 2 adversarial matrix

## Verified behavior

- Git-only activation with explicit non-Git rejection
- Direct activation for complete explicit scope and confirmation for inferred scope
- Exact files and directory-prefix rules only
- Explicit approval for the whole-project `.` rule
- Forbidden rules overriding allowed parent directories
- Safe dirty-worktree activation without commit, stash, reset, or cleanup
- One-way fingerprints for safe pre-existing tracked changes
- No reading or hashing of untracked contents
- Sensitive-path fingerprint exclusions
- Pre-existing, in-scope, out-of-scope, amendment, late-approved, and uncertain findings
- Same-branch ancestor-preserving commit comparison
- Stale results for branch changes and rewritten same-branch history
- Expansion-only amendments with preserved late approvals
- Separate validation authorization and exact pass, fail, not-run, and unknown evidence
- Repository comparison after authorized validation commands
- Secret-like output redaction
- Immutable contracts, Baselines, amendments, and reports
- Verify leaves the Lock active until explicit close or abandon
- Status does not change the active pointer or source files
- Storage-link escape rejection, corrupt-storage handling, nested Git limitations, submodule limitations, and concurrent-writer detection

## Verification evidence

- `npm.cmd test`: 17 tests passed, 0 failed
- `node --check scripts/scopelock.mjs`: passed
- Manifest and skill structural test: passed
- No hook folder or hook manifest field: verified
- No runtime network or telemetry references: verified
- No external package dependencies: verified
- No em dash characters or placeholder markers in Phase 2 artifacts: verified

## Known limitations

- ScopeLock detects and warns. It is not a sandbox and does not block every write.
- The MVP supports Git worktrees only.
- Pre-existing untracked content changes remain uncertain because contents are never inspected.
- Filename-based sensitive-path detection is conservative but cannot identify every possible secret-bearing tracked file.
- The suite ran on Windows. POSIX execution remains a Phase 3.5 verification item.
- The official Python plugin and skill validators could not run because this machine has no working Python runtime. Equivalent manifest and skill structure checks pass in the Node suite. The official validators remain required before release.
- No hooks exist in Phase 2.

## Approval gate

Phase 3 has not started. The next phase may add optional advisory hooks only after explicit approval.
