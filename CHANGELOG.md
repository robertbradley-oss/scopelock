# Changelog

All notable changes to ScopeLock are documented in this file.

## Unreleased

## 0.1.1 - 2026-07-16

### Changed

- Status and Verify now return deterministic plain-language summaries for the default user experience.
- Immutable Verify reports now begin with a short quick summary while retaining all labeled evidence and finding categories.
- The Status and Verify skills hide Lock IDs, schemas, evidence taxonomy, and report paths by default and show them when details are requested.
- The deterministic demo now presents the simplified summary instead of technical JSON.
- The release builder accepts a validated marketplace name so local release candidates can be installed without colliding with the public marketplace.

## 0.1.0 - 2026-07-16

### Added

- `$scope-lock` for creating, amending, closing, and abandoning a task boundary.
- `$scope-status` for read-only repository comparison.
- `$scope-verify` for immutable evidence reports and separately authorized validation.
- Local `.codex-scope/` contracts, Baselines, amendments, reports, and active pointer.
- Git-only dirty-worktree, rename, deletion, branch, history, nested-repository, and submodule handling.
- Optional SessionStart, PreToolUse, PostToolUse, and Stop hooks with advisory-only output.
- Strict storage validation, concurrent repository detection, and serialized active-pointer updates.
- Sensitive-path exclusions, untracked-content protection, output sanitization, and bounded tracked-file hashing.
- Public documentation, brand assets, example project, deterministic demo, demo video, and staged marketplace release builder.

### Known limitations

- ScopeLock warns and detects but does not block every write.
- Git repositories are required for activation.
- Local hashes do not authenticate evidence against an attacker who can rewrite the complete local record set.
- Authorized validation commands retain normal shell permissions and possible external side effects.
- Windows is verified; true Linux and macOS execution remains unverified for `0.1.0` by owner decision.
