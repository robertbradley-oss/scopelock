# Game Plan

## Outcome

Reduce ScopeLock's user-visible runtime overhead, especially the hooks that run around tool calls, without weakening its evidence model, security boundaries, advisory-only behavior, or compatibility with active Locks in other projects.

The performance work succeeds when repeatable cross-platform benchmarks show materially lower latency, the normalized Status findings and evidence remain equivalent, the adversarial fixture matrix passes, no new timeout failures appear, and the optimized path can be introduced gradually with a straightforward rollback.

## Strategy

Proceed evidence-first and in increasing order of behavioral risk:

1. Establish a repeatable benchmark matrix and record the current baseline.
2. Remove unnecessary hook work before changing repository-comparison semantics.
3. Consolidate repeated repository metadata probes and stable captures while preserving concurrent-change detection.
4. Optimize boundary inspection and tracked-file hashing only after profiling shows their contribution.
5. Release the optimized path through an opt-in flag or prerelease, compare it with the current implementation, and canary it in selected projects before general adoption.

Favor intra-invocation work reduction over cross-invocation caching. Cross-invocation caches are deferred until there is evidence they are necessary and can remain trustworthy when repositories change concurrently.

## Guardrails

- Do not change ScopeLock runtime behavior until the benchmark specification, fixture matrix, and recoverable Git baseline exist.
- Preserve the current stored ScopeLock schema during the initial performance work.
- Preserve normalized Status findings, evidence classifications, warnings, and failure behavior unless the user explicitly approves a product change.
- Preserve secret-path exclusions, the rule against reading or hashing untracked contents, symlink and repository-boundary protections, hostile-Git defenses, and concurrent-change detection.
- ScopeLock remains advisory: it detects and warns but does not claim to prevent every write.
- Do not silently roll changes into projects already using ScopeLock; use an opt-in flag, prerelease, or similarly reversible canary.
- Require zero new timeout failures and no security or adversarial-test regression.
- Target at least a 50% reduction in medium-repository PostToolUse latency before broad rollout; set absolute p50 and p95 budgets only after the cross-platform baseline exists.
- Keep benchmark artifacts concise and reproducible; do not add production telemetry or networked runtime components.
- Preserve unrelated workspace changes and do not commit, stage, reset, clean, or publish without explicit authorization.

## Workstreams

1. **Benchmarking and budgets** - Cover clean, dirty, untracked-heavy, large-file, nested-repository, shallow-clone, and submodule scenarios at representative repository sizes. Record p50, p95, Git subprocess count, bytes hashed, and timeout rate on Windows, Linux, and macOS.
2. **Hook fast paths** - Avoid repository discovery and context loading for hook events that cannot produce a warning. Remove the redundant context-helper call from PostToolUse when equivalent behavior can be preserved.
3. **Capture consolidation** - Compute repository metadata once per invocation and reduce the ordinary stable comparison from three full captures to two without losing race detection.
4. **Filesystem and hashing** - Profile boundary checks, introduce carefully bounded hashing concurrency or aggregate budgets if justified, and retain all safety limitations and evidence semantics.
5. **Compatibility and rollout** - Compare normalized old/new output across the adversarial fixture matrix, canary in selected projects, document rollback, and broaden adoption only after the performance and equivalence gates pass.

## Current State

### Completed

- Completed the read-only performance review and isolated Windows baseline. The dominant candidate hot path is repeated synchronous Git and helper-process work in `scripts/scopelock.mjs` and `scripts/scopelock-hook.mjs`; the measured medium fixture put direct Status and PostToolUse above one second. Evidence: source inspection, `tests/scopelock.test.mjs`, and the benchmark recorded in the 2026-07-18 performance-review task.
- Locked the evidence-first performance strategy, safety guardrails, sequencing, compatibility gates, and staged rollout approach in this canonical plan.
- Established the reviewed initial repository baseline after excluding local Clean Handoff checkpoints, scanning the commit candidate for secret indicators and unwanted artifacts, passing the syntax gate, and passing the Windows fixture suite with only its expected POSIX-only skip. Evidence: the initial Git commit and the validation output from the 2026-07-18 baseline task.

### Active

- No runtime optimization is underway. The project is ready for the benchmark specification and fixture matrix.

### Blocked

- None.

## Next Move

Draft `docs/performance-benchmark-plan.md` without changing runtime code. It should define the repository-size and drift scenarios, Windows/Linux/macOS execution matrix, p50 and p95 methodology, Git-process and hashing measurements, equivalence oracle, interim 50% improvement gate, and the evidence required before hook optimization begins. Completion evidence is an approved specification that another agent can implement without reopening strategy.

## Open Questions

- What absolute p50 and p95 latency budgets should govern small, medium, and large repositories after Windows, Linux, and macOS baselines are available?
- Should the canary use an environment-controlled capture path, a separate prerelease package, or both?
- Which one or two active projects are appropriate canary candidates?
- How large should the aggregate tracked-file hashing budget be before evidence becomes explicitly limited?

## Decisions

- 2026-07-18 - Optimize performance through measurement, low-risk hook gating, capture consolidation, targeted filesystem work, and canary rollout in that order; this minimizes behavioral risk for projects already using ScopeLock.
- 2026-07-18 - Preserve the storage schema and normalized Status semantics during the initial optimization; performance work must not become an implicit product-contract change.
- 2026-07-18 - Require a repeatable cross-platform benchmark matrix and a recoverable Git baseline before runtime changes.
- 2026-07-18 - Use a relative rollout gate of at least 50% lower medium-repository PostToolUse latency with zero new timeouts until cross-platform evidence supports absolute budgets.
- 2026-07-18 - Prefer reversible opt-in or prerelease canaries over silently updating projects that already depend on ScopeLock.

## Refresh Triggers

- Cross-platform measurements identify a different dominant bottleneck than repeated Git captures and helper processes.
- A proposed optimization changes findings, evidence classifications, stored data, security boundaries, or concurrent-change behavior.
- The 50% latency target proves unrealistic or insufficient after representative benchmarks.
- Canary projects show timeout, correctness, compatibility, or workflow regressions.
- A new ScopeLock release or repository architecture materially changes the reviewed hot path.
- The user explicitly revises the outcome, strategy, guardrails, or rollout tolerance.

## Last Refreshed

2026-07-18 - Advanced from baseline creation to benchmark specification after the secret and artifact audit, syntax validation, Windows fixture run, and initial repository commit approved in this task.
