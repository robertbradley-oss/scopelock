# Phase 3.5 Reliability Preflight

Date: 2026-07-16

Status: Windows preflight complete. On 2026-07-16 the project owner accepted the unverified Linux and macOS risk and authorized Phase 4.

## Completed work

- Replaced the design-only threat model with an implementation-grounded model.
- Added a language and runtime security review.
- Hardened Git child processes against inherited repository redirection, tracing, optional index writes, replacement objects, lazy fetches, fsmonitor, external diff, rename heuristics, recursive submodules, and repository-local executable filters.
- Added strict UTF-8 and structural validation for active pointers, Baselines, amendments, reports, paths, digests, timestamps, and repository identity.
- Serialized active pointer writes with a cooperative lock and compare-before-swap digest.
- Preserved the previous pointer during the Windows replacement fallback.
- Bounded tracked-file hashing at 64 MiB and surfaced larger files as uncertain evidence.
- Added hostile-environment, fsmonitor, coordinated-tamper, pointer-concurrency, stale-writer-lock, large-repository, oversized-file, and POSIX invalid-byte-path fixtures.

## Validation evidence

- Node syntax checks: passed.
- Existing core and hook regression suite: passed after hardening.
- Extended suite: 32 tests total, 31 passed and the POSIX-only invalid-byte-path fixture skipped on Windows.
- Large fixture: 1,200 tracked files plus 225 later changes completed within the 30-second per-operation bounds.
- Hook fixtures remained within their configured 5 to 12 second timeouts.
- Official plugin validator: passed.
- Official skill validator: passed for `scope-lock`, `scope-status`, and `scope-verify`.
- Git Bash POSIX hook command smoke test: passed with output `{}` and exit status 0.
- Fresh-context routing: passed for Lock, Status, Verify, and active-Lock amendment prompts. The probe also correctly treated conditional validation wording as not yet authorized.
- Runtime network and telemetry scan: no ScopeLock runtime client found.
- WSL, Docker, and Podman availability check: unavailable on this host.

The official Python validators needed PyYAML. It was installed only into the workspace-local `work/validator-deps` directory and was not added to ScopeLock or the system Python environment.

## Residual risks

- Project-local digests cannot authenticate a completely rewritten but structurally valid local record set.
- Explicitly authorized validation commands remain real shell commands with user permissions and possible external effects.
- A crash can leave `.active-write.lock`; ScopeLock fails closed and requires review rather than deleting an unexplained lock.
- User-trusted global or system Git filter programs remain part of the trusted local environment.
- True POSIX filesystem and process semantics remain unverified.

## Phase 4 decision

The preferred next step remained a Linux or macOS run. The project owner reported that neither environment was available, accepted the documented risk, and explicitly directed the project to continue into Phase 4. The missing POSIX evidence remains a known release limitation rather than a completed validation.
