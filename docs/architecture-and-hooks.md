# Architecture and Hook Feasibility

## Current architecture

The Phase 3 plugin contains:

```text
.codex-plugin/
  plugin.json
skills/
  scope-lock/
    SKILL.md
    agents/openai.yaml
  scope-status/
    SKILL.md
    agents/openai.yaml
  scope-verify/
    SKILL.md
    agents/openai.yaml
scripts/
  scopelock.mjs
references/
  protocol.md
  path-rules.md
hooks/
  hooks.json
```

## Runtime components

### Skills

Skills contain judgment, user interaction, safety policy, and output presentation.

- `scope-lock`: propose, activate, amend, close, or abandon a Lock.
- `scope-status`: perform a read-only comparison and present one-screen status.
- `scope-verify`: compare, optionally run explicitly approved validation, and write a report.

Each skill has one concern and loads shared references only when needed.

### Deterministic Node helper

The helper contains fragile mechanical behavior:

- Project-root validation
- Storage-boundary validation
- Path normalization and matching
- Git inspection
- Snapshot creation and validation
- Lock discovery
- Comparison
- Exclusive archive writes
- Secret-safe sanitization
- Structured JSON output

Use Node built-ins only unless a dependency becomes necessary and is explicitly justified.

Proposed command surface:

- `inspect`
- `activate`
- `status`
- `context`
- `amend`
- `verify`
- `close`

Each command returns exactly one versioned JSON object and never emits repository-derived shell commands.

### Local project storage

Project contracts and evidence live under `.codex-scope/`. Plugin installation state and optional hook data may use `PLUGIN_DATA`, but project scope evidence remains with the project so it is inspectable and portable.

## No MCP or app

The MVP needs no MCP server, app connector, account, authentication, hosted service, or custom UI. Skills plus one local helper are the correct surface.

## Current hook facts

Current Codex documentation establishes:

- Plugins can bundle `hooks/hooks.json`.
- Plugin hooks require explicit trust before they run.
- Hooks can match `apply_patch`, `Edit`, `Write`, `Bash`, and other tool names.
- `SessionStart` can add developer context.
- `PreToolUse` can surface advisory context and can deny some supported calls, but interception is incomplete.
- `PreToolUse` does not support `continue: false`.
- `PostToolUse` can stop normal result processing only after the tool has already run.
- Hook command handlers support a Windows-specific command override.
- Hook transcript paths are convenient but not a stable interface.

## Consequence for the product promise

ScopeLock cannot honestly promise hard prevention through current hooks. The approved MVP therefore has no strict blocking option.

The supported model is:

1. Warn before a direct `apply_patch` call when exact target paths can be proven from the patch envelope.
2. Inspect after a tool call.
3. Surface verified findings after a tool call.
4. Always detect again during Status and Verify.

ScopeLock deliberately does not use the current denial, rewrite, continuation, or stop capabilities. A future pause-after-finding option would require separate design and explicit opt-in.

This is warning and detection, not a security boundary.

## Phase 3 hook implementation

### SessionStart

Use for `startup`, `resume`, and `compact`.

Behavior:

- Load the active Lock summary.
- Reinforce the objective, path boundary, and locked constraints.
- Warn when the Lock is stale or unavailable.
- Continue normally when no active Lock exists.

### PreToolUse

Match direct editing tools and Bash.

Behavior:

- Parse only recognized `apply_patch` file headers and warn when a proven direct path is outside scope.
- Never claim the warning blocked the tool.
- Never parse arbitrary shell text as proof of target paths.
- Never deny, rewrite, approve, or stop the tool call.

### PostToolUse

Match direct editing tools and selected shell tools.

Behavior:

- Run a bounded read-only status comparison.
- Surface out-of-scope findings.
- Remain silent when the comparison is healthy.
- Never return a blocking or stopping decision.

Risks:

- Performance overhead.
- Repeated warnings.
- Concurrent changes.
- A change has already occurred before interruption.

### Stop

Behavior:

- When the assistant uses completion language, remind it that required ScopeLock verification has not happened or is non-passing.
- Return a warning only, never a continuation decision.
- Remain silent during ordinary in-progress turns and after a passing or warning report.

### Shared handler

All four events call the built-in-only `scripts/scopelock-hook.mjs` handler. It reads one bounded JSON object from standard input, discovers the nearest active ScopeLock within the current Git worktree, and delegates authoritative storage and comparison work to `scripts/scopelock.mjs`.

The hook configuration provides POSIX and Windows commands through `command` and `commandWindows`. Handler timeouts range from 5 to 12 seconds. The handler fails open with no enforcement claim, and Status and Verify remain authoritative. Windows behavior and Git Bash command quoting are verified. True Linux or macOS filesystem and process semantics remain a Phase 4 gate.

## Hook packaging decision

Use default `hooks/hooks.json` discovery in Phase 3.

Current official documentation allows a `hooks` manifest field, while the locally available plugin validator currently rejects that field. Default folder discovery avoids the conflict and remains plugin-native.

## Hook-independent behavior

The plugin must pass its product-success test with hooks disabled:

- Lock still creates the contract and Baseline.
- Status still detects scope findings.
- Verify still creates a report.

Hooks improve timing. They do not define correctness.

## Validation tooling

Use:

- Plugin validator from `plugin-creator`
- Skill validator from `skill-creator`
- Node unit and fixture tests
- Cross-platform command tests where available
- Fresh-session routing tests

Do not use the current RobertOS Quality Gate for ScopeLock. Its documented project scope is limited to the Rep application family and does not cover Codex plugins.
