# ScopeLock Phase 3

Status: complete and awaiting approval before Phase 3.5

Phase 3 adds optional advisory Codex lifecycle hooks while preserving the hook-independent Lock, Status, and Verify workflows.

## Delivered

- Default plugin hook discovery at `hooks/hooks.json`
- One dependency-free Node handler at `scripts/scopelock-hook.mjs`
- SessionStart context reinforcement for startup, resume, clear, and compact
- PreToolUse warnings for proven out-of-scope `apply_patch` targets
- PostToolUse bounded repository comparison after Bash and direct file edits
- Stop reminders when completion language appears without passing verification evidence
- Windows-specific command overrides through `commandWindows`
- Lightweight read-only `context` command in the core helper
- Seven hook-focused tests alongside the seventeen Phase 2 tests

## Safety behavior

- Hooks are optional and require Codex trust before they run.
- The core plugin remains fully usable when hooks are disabled or skipped.
- Hook output never denies, rewrites, approves, blocks, or stops a tool call.
- PreToolUse does not parse arbitrary shell text as path proof.
- PostToolUse runs after a tool has completed and never claims to undo it.
- Stop never requests continuation and cannot create a continuation loop.
- Hook failures fail open, while Status and Verify remain authoritative.
- Runtime behavior remains local-only, dependency-free, and free of telemetry.

## Verification evidence

- `npm.cmd test`: 24 tests passed, 0 failed on Windows
- `node --check scripts/scopelock.mjs`: passed
- `node --check scripts/scopelock-hook.mjs`: passed
- Official plugin validator: attempted with the bundled Python runtime but unavailable because its `yaml` module is missing
- Default hook discovery without a manifest `hooks` field: verified
- SessionStart, PreToolUse, PostToolUse, and Stop configuration: verified
- POSIX and Windows command definitions: structurally verified
- Advisory-only output with no blocking fields: verified
- Observed Windows hook fixture durations: approximately 0.7 to 3.1 seconds per test scenario
- Configured hook timeouts: 5 to 12 seconds

## Known limitations

- Codex hook interception is incomplete and cannot form a sandbox.
- PreToolUse warns only when a direct `apply_patch` target is mechanically recoverable.
- Shell-created paths are detected after the tool call, not before it.
- The Stop reminder uses conservative completion-language detection and may miss unusual wording.
- Hook performance has been measured only on Windows.
- POSIX execution remains a Phase 3.5 verification item.
- The official plugin validator could not run because the bundled Python runtime lacks its required `yaml` module. No package was installed. The official plugin and skill validators remain Phase 3.5 work.

## Approval gate

Phase 3.5 has not started. The next phase is the reliability preflight covering security review, official validators, POSIX behavior, large repositories, concurrency, corrupt storage, nested Git, submodules, hook trust, and fresh-session routing.
