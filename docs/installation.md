# Installation and Updates

ScopeLock is packaged as a Git-backed Codex marketplace containing one plugin.

## Requirements

- Codex with plugin support
- Node.js 20 or newer
- Git with support for `--no-lazy-fetch`, `--no-replace-objects`, and `--no-optional-locks`

## Install the local release build

From the ScopeLock source directory:

```text
npm run build:release
```

Add the staged marketplace using its absolute path:

```text
codex plugin marketplace add <absolute-path-to>/dist/scopelock-marketplace-0.1.1
codex plugin add scopelock@scopelock
```

Start a new Codex task after installation so the three skills and optional hooks are loaded.

Verify the configured marketplace and plugin:

```text
codex plugin marketplace list
codex plugin list
```

## Public GitHub installation

Add the public marketplace and install ScopeLock:

```text
codex plugin marketplace add robertbradley-oss/scopelock --ref main
codex plugin add scopelock@scopelock
```

## Update

For the Git-backed marketplace:

```text
codex plugin marketplace upgrade scopelock
codex plugin add scopelock@scopelock
```

Start a new Codex task after every update.

For local development, rebuild the staged marketplace and reinstall the plugin. Do not increase the release version solely to refresh a development cache.

## Verify pickup

In a new task opened on a disposable Git project, try:

```text
Lock this task to src/auth/ and tests/auth/.
```

Then make one change inside `src/auth/` and one outside the approved paths. Ask:

```text
Are we still inside the scope I approved?
```

Status should report the first change as in scope and the second as out of scope. ScopeLock must not claim that the second write was blocked.

## Remove

For the Git-backed marketplace:

```text
codex plugin remove scopelock@scopelock
codex plugin marketplace remove scopelock
```

Removing the plugin does not delete project-local `.codex-scope/` directories.

## Platform verification

Windows is verified. Git Bash confirms the POSIX hook command and quoting. Linux and macOS filesystem, signal, and process semantics remain unverified; the owner accepted this as a known release risk.
