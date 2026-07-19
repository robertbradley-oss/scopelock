# Schemas and Path Rules

## Storage layout

```text
.codex-scope/
  active.json
  locks/
    2026-07-16T183000Z/
      contract.md
      baseline.json
      amendments/
        2026-07-16T190000Z.md
      reports/
        2026-07-16T193000Z.md
```

Properties:

- No symbolic links are used for plugin storage.
- Each Lock directory is unique and never overwritten.
- `contract.md` and `baseline.json` are immutable after activation.
- Expansion-only amendments and reports use exclusive create-new writes.
- `active.json` is the only replaceable coordination file.
- Unknown files under `.codex-scope/` are preserved.
- ScopeLock reports its own storage under the shared reserved-sideband classification rather than as implementation work.
- ScopeLock never edits `.gitignore` automatically.

## Lock contract format

Format identifier: `scopelock/v1`

Required frontmatter:

```yaml
format: "scopelock/v1"
version: 1
lock_id: "2026-07-16T183000Z"
created_at: "2026-07-16T18:30:00Z"
lifecycle: "active"
project_root: "."
repository_kind: "git"
baseline: "baseline.json"
```

Required body sections, in order:

1. Objective
2. Allowed scope
3. Forbidden scope
4. Locked constraints
5. Definition of done
6. Validation requirements
7. Baseline summary
8. Evidence limitations

Each substantive claim carries `[verified]`, `[inferred]`, or `[uncertain]`.

Activation validation requires a non-empty objective and at least one allowed scope rule. The project-wide rule `.` is valid only when explicitly provided by the user.

## Active pointer format

Format identifier: `scopelock/active/v1`

Required fields:

- `schema`
- `active_lock_id`, which may be `null`
- `lock_path`, which may be `null`
- `updated_at`
- `state`: `active`, `closed`, or `abandoned`

The pointer never contains the full contract.

## Baseline snapshot format

Format identifier: `scopelock/snapshot/v1`

Required groups:

- Schema and Lock identity
- Capture timestamp
- Project scope
- Repository kind
- Git root relationship
- Branch state and name
- HEAD and object format
- Index fingerprint
- Worktree fingerprint
- Structured pre-existing path observations
- Sensitive-path hash exclusions
- Comparison limitations

The MVP accepts only `repository_kind: "git"`. A non-Git project returns an unsupported result before Lock activation.

The helper returns sanitized relative paths only. It never returns file contents, diff hunks, environment values, credentials, or absolute user paths.

## Packaged context format

Format identifier: `scopelock/context/v2`

Every inactive, active, or unavailable result contains this authoritative classification object:

```json
{
  "reserved_sideband": {
    "schema": "scopelock/reserved-sideband/v1",
    "classification": "reserved-sideband",
    "rules": [
      { "path": ".agentreceipt/", "match": "directory" },
      { "path": ".codex-handoff/", "match": "directory" },
      { "path": ".codex-scope/", "match": "directory" }
    ]
  }
}
```

The schema and complete rule set are versioned as one compatibility boundary. Consumers fail closed when either schema is missing, malformed, or unsupported.

## Plain summary object

Status and Verify responses include a deterministic summary for the default user experience:

```json
{
  "summary": {
    "headline": "Scope check failed.",
    "lines": [
      "Checks passed, but 1 unexpected file changed: `config/prod.json`."
    ],
    "next_action": "Review `config/prod.json` before committing."
  }
}
```

The summary adds no authorship claims and does not replace categorized findings, validation evidence, or immutable report detail.

## Verification report format

Format identifier: `scopelock/report/v1`

Required sections:

1. Quick summary
2. Outcome
3. Lock summary
4. Repository comparison
5. Pre-existing findings
6. Reserved sideband findings
7. In-scope findings
8. Out-of-scope findings
9. Amendments and late approvals
10. Uncertain findings
11. Validation evidence
12. Limitations
13. Recommended next action

Reports are immutable.

## Path grammar

The approved MVP supports only two rule types:

### Exact file

```text
package.json
src/auth/login.ts
```

### Directory prefix

Directory rules end with `/` and include every descendant:

```text
src/auth/
tests/auth/
```

The MVP does not support `*`, `**`, brace expansion, regular expressions, Git pathspecs, or shell globs. Wildcard support is deferred until the simple matcher is proven.

## Path normalization

- Store paths relative to the fixed project root.
- Store `/` as the separator on every platform.
- Reject absolute paths, drive-qualified paths, UNC paths, empty paths, NUL bytes, and `..` traversal.
- Normalize `.` segments and repeated separators.
- Treat a trailing `/` as a directory rule.
- Resolve existing targets before any ScopeLock write.
- Reject or flag a symlink, junction, or reparse target that escapes the project root.
- Match case-insensitively on Windows.
- Match case-sensitively on other platforms in the MVP and report case-insensitive volume behavior as a limitation when it cannot be established safely.

## Rule precedence

1. Unsafe or escaping path
2. Forbidden rule
3. Allowed rule
4. Out-of-scope by default

Before forbidden and allowed rules, ScopeLock applies the packaged `scopelock/reserved-sideband/v1` classification to these exact directory roots:

- `.agentreceipt/`
- `.codex-handoff/`
- `.codex-scope/`

Matching paths are reported as `reserved-sideband`. They are not added to the user's allowed source scope and cannot be reclassified by a forbidden rule, allowed rule, or amendment. Ordinary paths continue through the existing forbidden, allowed, amendment, and default-deny precedence unchanged.

## Baseline evidence policy

### Tracked paths

- Use Git-native status, index object IDs, and repository metadata where possible.
- For a pre-existing modified tracked path, store a local one-way content fingerprint only when the path is not classified as likely secret-bearing.
- Store hashes only, never content.
- A changed hash after activation proves that the path changed again, but does not prove who changed it.
- A pre-existing tracked path outside allowed scope is not an out-of-scope finding unless later evidence proves another change.

### Untracked paths

- Record sanitized relative paths and status only.
- Never read or hash untracked contents.
- If an untracked path existed at Baseline and still exists later, content changes remain uncertain.
- A pre-existing untracked path outside allowed scope remains `pre-existing` unless a later path-level change can be proven.

### Sensitive paths

Do not fingerprint or inspect paths likely to contain secrets, including common environment, key, credential, cookie, token, and authentication files. Record a structured limitation instead.

## History compatibility and stale Baseline rules

The Lock remains comparable when:

- The project and Git roots are unchanged.
- The branch identity is unchanged.
- Current HEAD equals the Baseline HEAD, or the Baseline HEAD is an ancestor of current HEAD.

When history advanced compatibly, ScopeLock compares:

- Committed changes from Baseline HEAD through current HEAD
- Current index changes
- Current worktree changes
- Current untracked paths

The Lock becomes stale when:

- Project root changes.
- Git root relationship changes.
- Repository kind changes.
- Branch identity changes.
- Baseline HEAD is not an ancestor of current HEAD.
- History was reset, rebased, replaced, or otherwise diverged.
- Git object format changes.

When ancestry cannot be established because history is shallow or unavailable, comparison is incomplete rather than clean.

A stale Lock cannot receive a passing Verification report. The user must reconcile the change and create a new Lock. An amendment does not rebaseline repository history.
