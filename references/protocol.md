# ScopeLock helper protocol

The bundled helper is `scripts/scopelock.mjs`. Run it with Node 20 or newer and with the selected project as the working directory.

Every invocation emits exactly one JSON object on standard output. The `schema` identifies the response shape. A nonzero exit code means the response contains an `error` object.

Never interpolate repository text or user prose into shell source. Commands that accept a payload read one JSON object from standard input.

## Commands

### Inspect

```text
node PLUGIN_ROOT/scripts/scopelock.mjs inspect --project-root .
```

Returns `scopelock/inspect/v1`. It rejects non-Git projects without creating storage.

### Activate

```text
node PLUGIN_ROOT/scripts/scopelock.mjs activate --project-root .
```

Standard-input shape:

```json
{
  "objective": "Concrete task objective",
  "allowed": ["src/auth/"],
  "forbidden": ["src/auth/secrets/"],
  "constraints": [],
  "definition_of_done": [],
  "validation_requirements": ["npm test"],
  "scope_source": "explicit",
  "whole_project_explicit": false
}
```

Returns `scopelock/activate/v1`. An inferred proposal returns `confirmation_required` and does not write `.codex-scope/`.

### Status

```text
node PLUGIN_ROOT/scripts/scopelock.mjs status --project-root .
```

Returns `scopelock/status/v1`. This command is read-only.

The response includes a deterministic `summary` object with `headline`, `lines`, and `next_action`. Skills should render that object by default and reserve the detailed findings for explicit detail requests.

### Context

```text
node PLUGIN_ROOT/scripts/scopelock.mjs context --project-root .
```

Returns `scopelock/context/v1`. This lightweight read-only command validates active storage and returns the active objective, effective rules, constraints, validation requirements, and latest report summary. The optional hook handler uses it before deciding whether an advisory message is relevant.

### Amend

```text
node PLUGIN_ROOT/scripts/scopelock.mjs amend --project-root .
```

Standard-input shape: `{"add_allowed":["new/path/"],"reason":"User-approved reason"}`.

Returns `scopelock/amend/v1`. The helper records any current finding that becomes late-approved.

### Verify

```text
node PLUGIN_ROOT/scripts/scopelock.mjs verify --project-root .
```

Standard-input shape: `{"authorized_commands":["npm test"]}`. An empty list runs no validation. Stored validation requirements never execute automatically.

Returns `scopelock/verify/v1` and creates one immutable Markdown report. The active Lock remains active.

The response includes the same plain `summary` shape as Status. The immutable report begins with that summary and retains all detailed evidence below it.

### Close or abandon

```text
node PLUGIN_ROOT/scripts/scopelock.mjs close --project-root . --state closed
node PLUGIN_ROOT/scripts/scopelock.mjs close --project-root . --state abandoned
```

Returns `scopelock/close/v1`. These commands require an explicit user request at the skill layer.

## Optional hook handler

`scripts/scopelock-hook.mjs` reads one Codex hook event JSON object from standard input and emits one Codex hook output JSON object. It supports SessionStart, PreToolUse, PostToolUse, and Stop.

The handler is advisory only:

- It never returns a deny, block, rewrite, approval, or stop instruction.
- PreToolUse parses recognized `apply_patch` file headers only. It does not parse arbitrary shell text as path proof.
- PostToolUse runs a bounded Status comparison after supported tools complete.
- Stop emits only a completion reminder and never creates a continuation loop.
- Hook failure does not weaken the independent Status or Verify workflows.

## Finding categories

- `pre-existing`
- `in-scope`
- `out-of-scope`
- `approved-amendment`
- `late-approved`
- `uncertain`

Material conclusions also carry `verified`, `inferred`, or `uncertain` evidence.

## Failure handling

Do not repair corrupt storage, rebaseline stale history, or overwrite an active Lock. Show the structured error and recommend one concrete recovery action.
