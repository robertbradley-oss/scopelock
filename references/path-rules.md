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

`.codex-scope/` is internal storage. It is excluded from findings and is never part of user-approved source scope.

## Amendments

An active Lock may add allowed rules only. It may not remove an allowed rule or add a forbidden rule. Tightening requires closing the Lock and creating a new one.

A change observed outside scope before its path is added remains `late-approved`. A later amendment does not erase the earlier finding.
