# Security Context

Status: updated through Phase 3.5 on 2026-07-16

ScopeLock is an implemented local Codex plugin containing three skills, a dependency-free Node helper, optional trusted hooks, and project-local human-readable storage.

It has no hosted service, network API, account, authentication system, database, telemetry, or built-in network client. An explicitly authorized validation command is outside that guarantee because it is an ordinary local shell command.

## Trust boundaries

- The user explicitly approves material task scope and each validation command.
- Repository paths, metadata, links, attributes, contents, repository-local Git configuration, and `.codex-scope/` records are untrusted.
- The installed ScopeLock package, operating system, Node runtime, Git executable, and user-managed global or system Git configuration are trusted local components.
- The helper has the user's filesystem permissions and is not a sandbox.
- Hooks require explicit trust, may be disabled, and provide advice rather than enforcement.

## Implemented controls

- Git-only activation and explicit non-Git rejection.
- Strict path grammar, root containment, link checks, and safe storage creation.
- No reads or hashes of untracked contents.
- Sensitive tracked-path exclusions and a 64 MiB tracked-file hash cap.
- Side-effect-reduced Git invocation with environment stripping and repository-local executable-filter rejection.
- Strict UTF-8, fixed schemas, contained record paths, and digest checks.
- Serialized compare-before-swap active pointer writes.
- Concurrent repository capture detection with retry and incomplete fallback.
- Same-branch ancestry requirements and stale-history outcomes.
- Separate validation authorization, bounded output capture, redaction, and before/after comparison.
- Advisory-only hooks with bounded timeouts and no block, deny, rewrite, or continuation-loop output.

## Residual limitations

- Local digests do not authenticate records against an attacker who can rewrite the full project-local record set.
- Sensitive filename heuristics cannot identify every secret-bearing tracked file.
- Validation commands retain user permissions and may have external effects or surviving descendants.
- Global or system Git filter programs are trusted environment components.
- True POSIX execution remains pending; Git Bash validates command quoting only.

The implementation-grounded threat model is stored at `../scopelock-threat-model.md`. The detailed secure-coding review is stored at `../security_best_practices_report.md`.
