# Game Plan

## Outcome

Finish ScopeLock 0.1.1 as a clean, verified release candidate, then carry the user-approved reserved-sideband compatibility change into the next ScopeLock release without reopening the stopped performance workstream.

Finalization succeeds when development-only benchmark tooling is excluded from the staged plugin, repository checks and representative local workflows pass, the built package contains only intended release material, QA introduces no unexpected workspace changes, and the candidate is ready for a separate explicit commit or publish decision.

The next-release work succeeds when the preserved reserved-sideband patch is reapplied in canonical source under a fresh task boundary, its `scopelock/context/v2` compatibility and package version are reconciled explicitly, Clean Handoff interoperability passes, and the change receives separate release evidence.

## Strategy

Proceed evidence-first and in increasing order of behavioral risk:

1. Freeze ScopeLock runtime and user-facing behavior at the established 0.1.1 baseline.
2. Separate repository development assets from the staged plugin so performance benchmarks and tests remain available to maintainers without shipping to users.
3. Run repository-native hygiene, syntax, automated tests, deterministic demo, release build, and package inspection in that order.
4. Review the complete candidate diff and staged package for unintended files, secrets, generated artifacts, or version/documentation inconsistencies.
5. Stop with a verified release candidate and require explicit authorization before staging, committing, publishing, installing, or deploying it.
6. After the 0.1.1 candidate decision, begin a separate next-release slice from a stable baseline, reapply the approved reserved-sideband patch, choose the compatible package version explicitly, and rerun cross-repository compatibility evidence.

## Guardrails

- Do not change ScopeLock runtime behavior, stored schemas, findings, evidence labels, warnings, hooks, or failure behavior inside the frozen 0.1.1 candidate.
- Preserve secret-path exclusions, the rule against reading or hashing untracked contents, symlink and repository-boundary protections, hostile-Git defenses, and concurrent-change detection.
- ScopeLock remains advisory: it detects and warns but does not claim to prevent every write.
- Do not resume full performance qualification, set performance budgets, or implement runtime optimization during this phase.
- Keep benchmark code, performance tests, partial result artifacts, and local handoff material out of the staged release plugin.
- Use only local, deterministic validation; do not access accounts, production systems, paid services, or networked release targets.
- Treat reserved-sideband as approved next-release work, not as an unapproved change, while keeping it out of the frozen 0.1.1 candidate until that candidate's commit decision is resolved.
- Reapply and validate next-release work only in canonical source repositories under a fresh ScopeLock; never edit an installed plugin cache.
- Preserve unrelated workspace changes and do not commit, stage, reset, clean, or publish without explicit authorization.

## Workstreams

1. **Release scope and packaging** - Keep maintainer-only benchmarks, tests, handoff evidence, and temporary output outside the staged plugin while preserving required runtime skills, scripts, references, assets, and documentation.
2. **Quality assurance** - Exercise repository hygiene, syntax checks, automated tests, and relevant security/privacy invariants using declared local commands.
3. **Product smoke** - Run the deterministic demo and inspect its ordinary Lock, Status, and Verify behavior without changing product semantics.
4. **Release candidate** - Build and inspect the staged marketplace, verify versions and release documentation, compare Git state before and after QA, and hand off for explicit commit or publish approval.
5. **Next-release compatibility** - Reapply the approved reserved-sideband patch after the 0.1.1 decision, reconcile the context and package versions, and prove ScopeLock and Clean Handoff interoperability without weakening ordinary findings.

## Current State

### Completed

- Established the ScopeLock 0.1.1 runtime, documentation, deterministic demo, release builder, and reviewed Git baseline. Evidence: commit `ceab256`, `README.md`, `RELEASE_NOTES.md`, and the existing core test suite.
- Completed the performance review and dependency-free benchmark tooling through Phase 4 qualification support without changing runtime code. The costly three-platform qualification was stopped incomplete by user decision; valid partial Windows evidence remains local. Evidence: `docs/performance-benchmark-plan.md`, `benchmarks/`, `tests/performance-*.test.mjs`, and `.codex-handoff/artifacts/phase4-windows-20260718-interrupted/`.
- Completed ScopeLock 0.1.1 release finalization and Candidate Recovery: the builder excludes maintainer-only assets, the reserved-sideband source change is preserved outside the frozen candidate, default `check` and `test` gates are core-only while performance commands remain explicit and opt-in, core QA and the deterministic demo passed, the staged package was inspected, and local marketplace documentation was corrected. Evidence: `package.json`, `.codex-handoff/artifacts/candidate-recovery-20260719/README.md`, its sibling `reserved-sideband.patch`, `README.md`, `docs/installation.md`, and the staged package produced by `scripts/build-release.mjs`.
- Staged the reviewed ScopeLock 0.1.1 source candidate without `.codex-handoff` and created one local finalization commit; publishing was not performed.

### Active

- ScopeLock 0.1.1 Finalization is complete and committed locally. Publishing remains a separate explicit decision.
- Reserved-sideband is approved for the next ScopeLock release. Its eight-file source change is not currently applied to the 0.1.1 candidate; the recoverable patch remains at `.codex-handoff/artifacts/candidate-recovery-20260719/reserved-sideband.patch` pending the separate next-release slice.

### Blocked

- Performance qualification remains intentionally stopped and was not run during Candidate Recovery.
- Publishing remains intentionally approval-gated.
- Next-release reapplication remains separate from the committed 0.1.1 line so the compatibility change cannot be confused with or silently folded into that release.

## Next Move

Explicitly approve or reject publishing the committed ScopeLock 0.1.1 release. Keep the reserved-sideband next-release slice separate until that release decision is resolved.

## Open Questions

- Which package version should carry the already-approved `scopelock/context/v2` compatibility boundary after 0.1.1 is resolved?

## Decisions

- 2026-07-18 - Optimize performance through measurement, low-risk hook gating, capture consolidation, targeted filesystem work, and canary rollout in that order; this minimizes behavioral risk for projects already using ScopeLock.
- 2026-07-18 - Preserve the storage schema and normalized Status semantics during the initial optimization; performance work must not become an implicit product-contract change.
- 2026-07-18 - Require a repeatable cross-platform benchmark matrix and a recoverable Git baseline before runtime changes.
- 2026-07-18 - Use a relative rollout gate of at least 50% lower medium-repository PostToolUse latency with zero new timeouts until cross-platform evidence supports absolute budgets.
- 2026-07-18 - Prefer reversible opt-in or prerelease canaries over silently updating projects that already depend on ScopeLock.
- 2026-07-18 - Approve `docs/performance-benchmark-plan.md`, including its scenarios, repetition counts, three-operating-system baseline gate, equivalence oracle, temporary diagnostic instrumentation, and interim 50% PostToolUse p95 target; this unblocks benchmark-harness implementation but not runtime optimization.
- 2026-07-18 - Govern implementation through named, completion-gated phases rather than isolated steps; this keeps each body of work coherent and preserves an explicit evidence review before advancing.
- 2026-07-18 - Approve Phase 2 as the measurement-engine phase, with equivalence, diagnostic attribution, cross-platform qualification, budget setting, and runtime optimization reserved for later approval gates.
- 2026-07-18 - Approve Phase 3 as the equivalence-and-diagnostic-attribution phase, while preserving unmodified helpers for primary latency measurements and reserving cross-platform qualification, budgets, and runtime optimization for later gates.
- 2026-07-18 - Approve Phase 4 as baseline qualification, while keeping runtime optimization and budget approval gated on complete Windows, Linux, and macOS evidence.
- 2026-07-19 - Retain the Phase 4 qualification files after review because they implement required performance-evidence gates and do not affect ScopeLock runtime latency; no separate recovery or resumability tooling was approved or implemented.
- 2026-07-19 - Stop Phase 4 incomplete because the remaining Windows, Linux, and macOS qualification cost is not worthwhile. Preserve the valid partial Windows evidence, do not advance to budgets or optimization under the unmet gate, and require an explicit decision to reopen the work.
- 2026-07-19 - Start the ScopeLock 0.1.1 Finalization Phase with runtime frozen, performance work stopped, benchmark tooling retained for maintainers but excluded from the staged plugin, and commit or publish reserved for separate approval.
- 2026-07-19 - Do not approve the then-current staged package as the 0.1.1 candidate because concurrent `reserved-sideband` runtime/schema edits appeared during QA and the repository-wide test command was red; preserve all changes and stop before cleanup, staging, commit, or publish. Partially superseded on 2026-07-19: reserved-sideband is now explicitly approved for the next release, but remains excluded from 0.1.1.
- 2026-07-19 - Complete Candidate Recovery by preserving the eight-file `reserved-sideband` patch outside the release, restoring the frozen `ceab256` runtime boundary, and accepting core-only QA as the finalization test scope; do not resume performance work.
- 2026-07-19 - Keep the candidate unapproved until the two documented local marketplace paths match the versioned directory produced by the builder.
- 2026-07-19 - Complete Finalization after correcting both local marketplace paths and passing the lightweight build/path verification; retain explicit approval gates for commit and publish.
- 2026-07-19 - Approve reserved-sideband as next-release work rather than an unplanned change. Preserve the frozen 0.1.1 candidate, reuse the recovery patch only after the 0.1.1 decision, and require an explicit compatible package version plus fresh cross-repository evidence.
- 2026-07-19 - Keep ScopeLock's default `npm run check` and `npm test` release gates core-only; retain performance checks and tests as explicit maintainer commands so the stopped performance workstream cannot run implicitly.
- 2026-07-19 - Approve staging the reviewed ScopeLock 0.1.1 source candidate without `.codex-handoff` and creating one local commit; keep publishing as a separate decision.

## Refresh Triggers

- QA reports a runtime, security, privacy, packaging, documentation, or release-build failure.
- The staged plugin contains development-only files or omits a required runtime asset.
- QA creates unexpected tracked changes or leaves local processes or temporary artifacts behind.
- The user explicitly changes the release target, version, scope, or authorization boundary.
- The selected post-0.1.1 package version cannot safely represent the `scopelock/context/v2` compatibility boundary.
- Clean Handoff compatibility evidence differs from the preserved reserved-sideband patch or reveals a weakened ordinary finding.

## Last Refreshed

2026-07-19 - Committed the reviewed ScopeLock 0.1.1 candidate locally without `.codex-handoff`, retained the publishing gate, and kept reserved-sideband isolated as next-release work.
