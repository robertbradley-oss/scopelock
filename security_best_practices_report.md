# Security Best Practices Report

Review date: 2026-07-16

## Scope and method

This review covers the dependency-free Node CLI, Git child processes, project-local storage, advisory hook helper, and the related fixture suite. The available secure-coding references did not include a dedicated Node CLI profile, so the review applied the repository's threat model, Node filesystem and child-process safety practices, and official Git command behavior.

Official Git documentation confirms the intended effects of `--no-replace-objects`, `--no-lazy-fetch`, and `--no-optional-locks`: <https://git-scm.com/docs/git>. Git also documents that background `status` callers should use `--no-optional-locks`: <https://git-scm.com/docs/git-status>.

## Summary

No known critical or unresolved high-severity implementation vulnerability remains after the Phase 3.5 fixes. Four material findings were remediated. Two residual risks and one cross-platform verification gap remain documented below.

## Findings

### SBP-001: Repository-controlled Git execution and redirection

- Severity: High
- Status: Remediated
- Risk: Inherited `GIT_*` variables or repository-local clean/process filters could redirect inspection or cause a command to run. Fsmonitor, replacement objects, optional index refresh, or lazy object fetching could also add side effects.
- Fix: Strip repository-control and tracing environment variables, use a fixed C locale, disable optional locks, lazy fetch, replacement objects, fsmonitor, external diff, renames, and submodule recursion, and reject repository-local clean/process filters.
- Evidence: `scripts/scopelock.mjs:33`, `scripts/scopelock.mjs:225`, `scripts/scopelock.mjs:278`, `scripts/scopelock-hook.mjs:55`, `tests/scopelock.test.mjs:443`, and `tests/scopelock.test.mjs:473`.

### SBP-002: Digest-only trust in project-local storage

- Severity: High
- Status: Remediated for unsafe and malformed records
- Risk: An attacker could change a Baseline and update its pointer digest, bypassing a digest-only integrity check and inserting traversal or malformed rules.
- Fix: Read and hash each JSON record from the same bytes, require strict UTF-8, reject unknown pointer and Baseline fields, validate IDs, timestamps, digests, project boundaries, repository identity, scope rules, observations, amendments, reports, and contained paths.
- Evidence: `scripts/scopelock.mjs:791`, `scripts/scopelock.mjs:902`, `scripts/scopelock.mjs:1083`, and `tests/scopelock.test.mjs:487`.

### SBP-003: Lost active-pointer updates

- Severity: Medium
- Status: Remediated
- Risk: Two ScopeLock processes could read the same active pointer and silently overwrite one another's amendment, report, or close transition.
- Fix: Use a bounded cooperative writer lock, compare the current pointer digest with the digest originally read, preserve the old pointer during the Windows replacement fallback, and fail closed on stale locks or stale updates.
- Evidence: `scripts/scopelock.mjs:731`, `tests/scopelock.test.mjs:507`, and `tests/scopelock.test.mjs:524`.

### SBP-004: Unbounded hashing of modified tracked files

- Severity: Medium
- Status: Remediated
- Risk: A very large tracked file could create excessive CPU and disk I/O during activation or comparison.
- Fix: Stream hashes only for ordinary contained files and skip files over 64 MiB, recording `content-unavailable` and uncertain evidence instead of guessing.
- Evidence: `scripts/scopelock.mjs:454` and `tests/scopelock.test.mjs:564`.

### SBP-005: No external authenticity anchor for local records

- Severity: Medium
- Status: Accepted residual risk
- Risk: A same-user attacker that rewrites every ScopeLock record can create a different but structurally valid contract, Baseline, and matching digests.
- Rationale: The local-first MVP has no account, key service, remote log, or trusted storage outside the project. Project-local hashes provide change detection, not independent authenticity.
- Recommendation: Keep this limitation visible. If a later product version requires tamper evidence, add an explicitly designed external signing or append-only authority rather than implying that local hashes are signatures.

### SBP-006: Authorized shell command process tree and external effects

- Severity: Medium
- Status: Accepted residual risk
- Risk: Verify intentionally uses `shell: true` for the exact command the user authorizes. The command can mutate files, access services, expose secrets through indirect output, or leave descendants running after the parent timeout.
- Controls: Separate authorization, exact command recording, bounded captured output, redaction, exit evidence, and repository comparison before and after execution.
- Evidence: `scripts/scopelock.mjs:1716` and `scripts/scopelock.mjs:1787`.
- Recommendation: Do not broaden command authorization or auto-run stored commands. Consider platform-specific process-tree containment only if it can be implemented without adding a false sandbox claim.

### SBP-007: True POSIX runtime not exercised

- Severity: Release verification gap
- Status: Open
- Risk: Linux or macOS path bytes, link semantics, signals, and shell process behavior may differ from Windows and Git Bash.
- Current evidence: The POSIX hook command succeeds through Git Bash, and the POSIX invalid-UTF-8 fixture is present but skipped on Windows at `tests/scopelock.test.mjs:588`.
- Required action: Run the full suite on Linux or macOS before Phase 4 packaging is approved.

## Release conclusion

The Windows implementation is ready for a true POSIX validation run. Phase 4 should remain gated until that run passes or produces reviewed platform-specific limitations.
