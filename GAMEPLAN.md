# Game Plan

## Outcome

Finish and publish ScopeLock 0.1.1, then carry the user-approved reserved-sideband compatibility change into ScopeLock 0.2.0 without reopening the stopped performance workstream.

Finalization succeeds when development-only benchmark tooling is excluded from the staged plugin, repository checks and representative local workflows pass, the built package contains only intended release material, QA introduces no unexpected workspace changes, and the candidate is ready for a separate explicit commit or publish decision.

ScopeLock 0.2.0 succeeds when the preserved reserved-sideband patch is reapplied in canonical source under a fresh task boundary, manifests and release documentation use the 0.2.0 compatibility line, `scopelock/context/v2` and Clean Handoff interoperability pass, and the change receives separate release evidence.

## Strategy

Proceed evidence-first and in increasing order of behavioral risk:

1. Freeze ScopeLock runtime and user-facing behavior at the established 0.1.1 baseline.
2. Separate repository development assets from the staged plugin so performance benchmarks and tests remain available to maintainers without shipping to users.
3. Run repository-native hygiene, syntax, automated tests, deterministic demo, release build, and package inspection in that order.
4. Review the complete candidate diff and staged package for unintended files, secrets, generated artifacts, or version/documentation inconsistencies.
5. Stop with a verified release candidate and require explicit authorization before staging, committing, publishing, installing, or deploying it.
6. Begin ScopeLock 0.2.0 from a fresh task boundary, keep separate release-builder work pre-existing, reapply the approved reserved-sideband patch, and rerun cross-repository compatibility evidence.

## Guardrails

- Do not change ScopeLock runtime behavior, stored schemas, findings, evidence labels, warnings, hooks, or failure behavior inside the frozen 0.1.1 candidate.
- Preserve secret-path exclusions, the rule against reading or hashing untracked contents, symlink and repository-boundary protections, hostile-Git defenses, and concurrent-change detection.
- ScopeLock remains advisory: it detects and warns but does not claim to prevent every write.
- Do not resume full performance qualification, set performance budgets, or implement runtime optimization during this phase.
- Keep benchmark code, performance tests, partial result artifacts, and local handoff material out of the staged release plugin.
- Use only local, deterministic validation; do not access accounts, production systems, paid services, or networked release targets.
- Treat reserved-sideband as approved next-release work, not as an unapproved change, while keeping it out of the published 0.1.1 release.
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
- Completed and published ScopeLock 0.1.1: Candidate Recovery preserved reserved-sideband outside the release, default gates remain core-only, QA and packaging passed, public history was reconciled without force-pushing, and the verified build-metadata release was published. Evidence: commit `d098e43`, reconciliation commit `183bc3e`, tag `v0.1.1+codex.20260717130011`, the GitHub release, and `.codex-handoff/artifacts/candidate-recovery-20260719/`.
- Completed ScopeLock 0.2.0 implementation and locked finalization locally: builder hardening is committed in `35ada27`; `scopelock/context/v2`, the authoritative reserved-sideband contract, ordinary-finding protections, tests, manifests, and release documentation are committed in `faa87b1`; Clean Handoff's compatible consumer is committed in `6095a8a`; the public privacy-policy path is corrected; core QA passed with the accepted late-approval warning; and Lock `2026-07-19T163332Z` is closed with evidence retained at `.codex-scope/locks/2026-07-19T163332Z/reports/2026-07-20T032943Z.md`. Commit and publication of the final administrative correction remain incomplete.

### Active

- ScopeLock 0.1.1 is complete and published. Public `origin/main` remains at reconciliation commit `183bc3e`, and the build-metadata tag resolves to approved release commit `d098e43`.
- ScopeLock 0.2.0 is a verified local release candidate at `0.2.0+codex.20260719234815`. Local `main` is two commits ahead of `origin/main`: builder hardening `35ada27` followed by reserved-sideband implementation and lifecycle commit `faa87b1`.
- The five lifecycle files are retained honestly as late-approved history. The final `npm run check` and `npm test` Verify run passed without repository drift; its warning was accepted and Lock `2026-07-19T163332Z` was explicitly closed.
- `.codex-plugin/plugin.json` now points to the tracked root `PRIVACY.md`, and this administrative GamePlan refresh records the final state. These two tracked worktree changes are not yet committed.
- The committed release builder deterministically stages intended plugin and public material from committed `HEAD` while excluding benchmarks, tests, performance planning, GamePlan, handoff, ScopeLock storage, dependencies, and build output; packaged commands remain limited to `check` and `demo`. Evidence: `scripts/build-release.mjs` at `35ada27`.

### Blocked

- Staging and committing the final `.codex-plugin/plugin.json` correction and `GAMEPLAN.md` refresh require explicit approval; `.codex-handoff/` remains excluded.
- Pushing the completed local candidate, creating the `v0.2.0+codex.20260719234815` tag, and publishing the release remain separately approval-gated.
- Performance qualification remains intentionally stopped and is not a completion requirement for the next-release compatibility slice unless the user explicitly reopens it.

## Next Move

Approve a ScopeLock 0.2.0 Candidate Commit Phase that stages exactly `.codex-plugin/plugin.json` and `GAMEPLAN.md`, excludes `.codex-handoff/`, and creates one local finalization commit while keeping publishing separate.

## Open Questions

- Whether to publish the finalized `0.2.0+codex.20260719234815` candidate after its local administrative commit remains explicitly approval-gated.

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
- 2026-07-19 - Publish approved commit `d098e43` through reconciliation commit `183bc3e` and build-metadata tag `v0.1.1+codex.20260717130011`; preserve the existing public `v0.1.1` release and history without force-pushing.
- 2026-07-19 - Retain the staged release-builder change as beneficial, separately scoped 0.2.0 baseline work after targeted package verification; do not fold it into reserved-sideband implementation or commit it without separate approval.
- 2026-07-19 - Select ScopeLock 0.2.0 for `scopelock/context/v2` because the context-schema compatibility boundary is materially breaking and a pre-1.0 minor increment communicates that change more honestly than a patch release.
- 2026-07-19 - Activate ScopeLock `2026-07-19T162020Z` for the approved eight-file reserved-sideband patch, forbid builder and performance paths, preserve current dirty work as Baseline evidence, and allow `GAMEPLAN.md` only for explicitly approved administrative refreshes.
- 2026-07-19 - Abandon stale Lock `2026-07-19T162020Z` after a forbidden builder revision crossed its Baseline, then activate replacement Lock `2026-07-19T162901Z` with the same reserved-sideband boundary and the stable staged/worktree builder state captured as pre-existing evidence.
- 2026-07-19 - Pause replacement Lock `2026-07-19T162901Z` after another task committed the final builder revision as `35ada27` post-Baseline; preserve that beneficial local commit, do not silently rebaseline it, and require explicit approval before one final replacement.
- 2026-07-19 - Abandon Lock `2026-07-19T162901Z` and activate final Lock `2026-07-19T163332Z` at `35ada27`, preserving the committed builder resolution as pre-existing work and keeping reserved-sideband implementation, builder publishing, and performance work separately gated.
- 2026-07-19 - Record `faa87b1` as the local ScopeLock 0.2.0 implementation, version, and release-documentation candidate, while withholding final Lock acceptance because five lifecycle files remain outside the active boundary and required validation has no immutable Verify evidence; do not publish or resume performance work. Superseded on 2026-07-19 after the five files were explicitly late-approved, final core QA passed, and the Lock was closed with its historical warning preserved.
- 2026-07-19 - Correct `.codex-plugin/plugin.json` to use the tracked root `PRIVACY.md`, rerun only `npm run check` and `npm test` through ScopeLock Verify, accept the retained late-approval warning, and close Lock `2026-07-19T163332Z`; keep the final administrative commit and all publishing separately approval-gated.

## Refresh Triggers

- QA reports a runtime, security, privacy, packaging, documentation, or release-build failure.
- The staged plugin contains development-only files or omits a required runtime asset.
- QA creates unexpected tracked changes or leaves local processes or temporary artifacts behind.
- The user explicitly changes the release target, version, scope, or authorization boundary.
- The selected post-0.1.1 package version cannot safely represent the `scopelock/context/v2` compatibility boundary.
- Clean Handoff compatibility evidence differs from the preserved reserved-sideband patch or reveals a weakened ordinary finding.

## Last Refreshed

2026-07-19 - Recorded the corrected privacy-policy URL, passed final core QA, accepted late-approval history, closed Lock `2026-07-19T163332Z`, and reduced the remaining ScopeLock 0.2.0 work to the explicitly gated administrative commit and later publishing decision.
