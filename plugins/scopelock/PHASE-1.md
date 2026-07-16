# ScopeLock Phase 1

Status: Phase 1 complete and approved

ScopeLock keeps a Codex task inside an explicitly approved project boundary and reports when repository changes fall outside that boundary.

Phase 1 contains product and architecture decisions only. It does not contain a plugin manifest, skills, hooks, executable helpers, or enforcement code.

## Product sentence

Set a boundary for a Codex task and catch anything that crosses it.

## Phase 1 artifacts

- [Product contract](docs/product-contract.md)
- [Conceptual model](docs/conceptual-model.md)
- [Interaction workflows](docs/workflows.md)
- [Schemas and path rules](docs/schemas-and-path-rules.md)
- [Architecture and hook feasibility](docs/architecture-and-hooks.md)
- [Risk and adversarial test matrix](docs/risk-and-test-matrix.md)
- [Security context](docs/security-context.md)
- [Threat model](scopelock-threat-model.md)
- [Stress-test summary](docs/stress-test-summary.md)
- [Phased implementation plan](docs/phased-implementation-plan.md)

## Confirmed decisions

1. The MVP is warning-only. It does not include a strict blocking option or claim hard prevention.
2. ScopeLock never reads or hashes untracked file contents. It records only sanitized relative paths and status.
3. The MVP supports Git projects only. Non-Git projects receive a clear unsupported result and no Lock is activated.
4. Scope rules use only exact project-relative files and directory prefixes. The MVP has no wildcard or glob language.
5. Active Locks support expansion-only amendments. Tightening scope requires a new Lock.
6. ScopeLock stores one-way fingerprints for already-modified tracked files when safe, while excluding likely sensitive paths.
7. Verify writes a report but does not close the Lock. Closing or abandoning is always explicit.
8. A finding approved after it occurs remains `late-approved` and limits the final outcome to `warning`.
9. Listing required validation does not authorize execution. Verify asks before running missing commands.
10. Same-branch commits keep the Lock valid when the Baseline commit remains an ancestor of current HEAD.
11. A dirty repository can be locked. Existing outside-scope changes remain `pre-existing` unless they change again.
12. Explicit complete scope can activate immediately. Materially inferred scope requires confirmation.
13. Every Lock requires a concrete objective and at least one allowed path. Repository-wide scope requires explicit `.`.
14. Forbidden rules always override allowed parent directories.
15. The original contract and Baseline are immutable.
16. Hooks are optional and advisory. The core skills remain authoritative without them.
17. ScopeLock requires no MCP server, backend, database, account, API key, network access, or telemetry.

## Approval gate

The product definition, security assumptions, stress test, and architecture are complete. Implementation must not begin until the user approves Phase 2.
