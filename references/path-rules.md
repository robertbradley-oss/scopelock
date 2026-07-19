# ScopeLock path rules

Use project-relative paths with `/` separators.

## Accepted rules

- Exact file: `package.json` or `src/auth/login.ts`
- Directory prefix: `src/auth/` or `tests/auth/`
- Whole project: `.` only when the user explicitly approves it

A directory rule includes every descendant. An exact file rule matches only that file. Forbidden rules always override allowed rules.

## Rejected rules

Reject absolute paths, drive-qualified paths, UNC paths, empty paths, NUL bytes, `..` traversal, Git pathspecs, regular expressions, and wildcard characters such as `*`, `?`, `{`, and `}`.

Normalize repeated separators and `.` segments. Match case-insensitively on Windows and case-sensitively on other platforms. Reject an existing symlink, junction, or reparse target that resolves outside the project root.

The packaged `scopelock/reserved-sideband/v1` contract classifies `.agentreceipt/`, `.codex-handoff/`, and `.codex-scope/` as reserved tool-owned sideband. These roots are reported separately as `reserved-sideband`; they are never treated as user-approved source scope and never become ordinary in-scope, out-of-scope, late-approved, or pre-existing implementation findings.

## Amendments

An active Lock may add allowed rules only. It may not remove an allowed rule or add a forbidden rule. Tightening requires closing the Lock and creating a new one.

A change observed outside scope before its path is added remains `late-approved`. A later amendment does not erase the earlier finding.
