# ScopeLock 0.1.1

ScopeLock 0.1.1 makes Status and Verify much easier to understand without weakening the underlying evidence.

## What changed

- Status and Verify now lead with a short plain-language result and one next action.
- Unexpected files are named directly, while Lock IDs, schemas, evidence labels, raw JSON, and report paths stay hidden unless details are requested.
- Mixed outcomes remain explicit: ScopeLock can say that tests passed while the overall scope check failed because unrelated drift remains.
- The summary states that ScopeLock reports changes and does not block them.
- Immutable Verify reports begin with the same quick summary and retain the full detailed evidence below it.
- The release builder can assign an isolated marketplace name for safer local candidate testing.

## Validation

- 33 automated tests: 32 passed, 0 failed, and 1 POSIX-only fixture skipped on Windows.
- Official plugin and skill validation passed for the source, staged marketplace, and installed cache.
- A fresh Codex task loaded the installed candidate and completed Lock, Status, and Verify in a dirty disposable Git repository.
- `node --test` passed while Verify correctly failed because `config/prod.json` was outside the approved task boundary.

## Install

```text
codex plugin marketplace add robertbradley-oss/scopelock --ref main
codex plugin add scopelock@scopelock
```

Start a new Codex task after installation.

## Platform note

Windows is release-verified. Git Bash validates the POSIX hook command and quoting, but true Linux and macOS filesystem, signal, and process behavior remains unverified by owner decision.
