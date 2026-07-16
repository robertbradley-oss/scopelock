# ScopeLock Marketplace Listing

## Identity

- Name: ScopeLock
- Plugin ID: `scopelock`
- Version: `0.1.0`
- Developer: RobertOS
- Category: Productivity
- Brand color: `#65D4FF`
- License: MIT

## Short description

Catch changes outside an approved task boundary.

## Long description

ScopeLock creates a local task boundary in a Git project, compares later repository state with the accepted Baseline, and reports in-scope, out-of-scope, pre-existing, amended, and uncertain changes honestly. It is advisory, not a sandbox or write barrier.

## Starter prompts

1. Lock this task to the files I approve.
2. Show whether this task is still within scope.
3. Verify this task against its ScopeLock boundary.

## Capabilities and permissions

- Interactive local workflow
- Project-local writes under `.codex-scope/`
- Read-only Git inspection for Lock and Status
- Optional explicitly trusted advisory hooks
- Optional user-authorized validation commands during Verify
- No account, authentication, API key, telemetry, hosted backend, or built-in network client

## Assets

- Composer icon: `assets/icon.png`
- Logo: `assets/logo.png`
- Social preview: `assets/social-preview.png`
- Demo video: `assets/scopelock-demo.mp4`

## Known limitation statement

ScopeLock detects and warns. It does not prevent every write. Windows is verified; true Linux and macOS execution remains unverified for `0.1.0` by owner decision.
