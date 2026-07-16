# ScopeLock 0.1.0

ScopeLock is a local-first Codex plugin that records an approved task boundary and later reports repository changes as in scope, out of scope, pre-existing, amended, or uncertain.

## Highlights

- Three workflows: Lock, Status, and Verify.
- Dirty-worktree-aware Git Baselines and evidence-labeled findings.
- Optional advisory hooks that never claim to be a sandbox or write barrier.
- Local-only storage with no account, API key, telemetry, hosted service, or built-in network client.
- Strict storage validation, bounded hashing, hostile Git defenses, and concurrent repository detection.
- Public documentation, example project, deterministic demo, and 14-second visual walkthrough.

## Install

```text
codex plugin marketplace add robertbradley-oss/scopelock --ref main
codex plugin add scopelock@scopelock
```

Start a new Codex task after installation.

## Platform note

Windows is release-verified. Git Bash validates the POSIX hook command and quoting, but true Linux and macOS filesystem, signal, and process behavior remain unverified for this release by owner decision.
