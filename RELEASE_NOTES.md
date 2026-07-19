# ScopeLock 0.2.0

ScopeLock 0.2.0 publishes the shared reserved-sideband contract required by Clean Handoff while preserving ordinary scope findings.

## What changed

- The packaged context operation now returns `scopelock/context/v2`.
- Every inactive and active context includes one complete `scopelock/reserved-sideband/v1` classification.
- `.agentreceipt/`, `.codex-handoff/`, and `.codex-scope/` are classified separately as tool-owned sideband; they are not added to approved source scope.
- Runtime and hook findings continue to use the existing forbidden, allowed, amendment, and default-deny rules for all ordinary paths.

## Compatibility

The context schema changed from v1 to v2. Integrations must validate both the v2 context and the exact reserved-sideband classification, and must fail closed for missing, malformed, or unsupported evidence.

## Validation

- ScopeLock source syntax and core tests pass on Windows, including inactive and active v2 context fixtures and shared-sideband runtime and hook coverage.
- The release candidate still requires package validation and installed-runtime verification before it can be treated as release-ready.
- True Linux and macOS filesystem, signal, and process behavior remains unverified pending cross-platform release evidence.

## Local install

Build from the reviewed committed candidate, add the generated local marketplace, reinstall `scopelock@scopelock`, and start a new Codex task so the updated skills and hooks are loaded.

No push, tag, or public publication is implied by these release notes.
