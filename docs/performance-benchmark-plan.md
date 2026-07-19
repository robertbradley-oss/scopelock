# Performance Benchmark Plan

## Purpose

Define the evidence required to optimize ScopeLock's runtime and hook latency without weakening repository comparison, storage integrity, security boundaries, or advisory-only behavior.

This document is the implementation contract for the benchmark harness. It does not authorize runtime optimization. Optimization begins only after the harness is implemented, the reference baseline is recorded on the required operating systems, and the resulting absolute budgets are approved.

Approval status: approved by the user on 2026-07-18. Material changes to the required scenarios, repetition counts, three-operating-system baseline gate, equivalence oracle, temporary diagnostic instrumentation, or interim 50% PostToolUse p95 improvement target require renewed approval.

## Governing baseline

- Reference commit: `ceab256a9ef625bbef1648374943d6b63dad9e7f`
- Reference version: `0.1.1+codex.20260717130011`
- Runtime: Node.js 20 or newer, using built-in modules only
- Reference helper: `scripts/scopelock.mjs` from the reference commit
- Reference hook: `scripts/scopelock-hook.mjs` from the reference commit
- Existing scale fixture: [`../tests/scopelock.test.mjs`](../tests/scopelock.test.mjs)
- Risk model: [`risk-and-test-matrix.md`](risk-and-test-matrix.md)
- Hook contract: [`architecture-and-hooks.md`](architecture-and-hooks.md)

The initial one-run Windows observation for a repository with 1,200 tracked files, 25 modified files, and 200 untracked files was approximately:

| Operation | Observed latency |
|---|---:|
| Activate | 802 ms |
| Status | 1,092 ms |
| PostToolUse | 1,233 ms |

These values justify measurement but are not an acceptance baseline. They came from one run and do not provide p50, p95, variability, or cross-platform evidence.

## Questions the benchmark must answer

1. How much latency does ScopeLock add to activation, direct Status, and each hook path?
2. How does latency scale with tracked files, changed tracked files, untracked paths, and hashed bytes?
3. How much time comes from process startup, Git commands, storage loading, path inspection, and hashing?
4. Does a candidate implementation return the same findings, evidence, limitations, warnings, and failure states as the reference?
5. Does the candidate meet the relative improvement gate without causing regressions or new timeouts?
6. Are results repeatable on Windows, Linux, and macOS when reference and candidate run on the same host?

## Non-goals

- Do not add production telemetry, network calls, accounts, or hosted result collection.
- Do not benchmark through a live user repository.
- Do not change the stored ScopeLock schema to make measurement easier.
- Do not weaken concurrent-change checks, secret exclusions, link handling, hostile-Git defenses, or output validation.
- Do not use a benchmark-only fast path in production.
- Do not claim cold-filesystem measurements unless the host can prove that its filesystem cache was cleared. The standard suite reports first-run and warm-cache measurements instead.
- Do not use the existing 30-second scale-test ceiling as an interactive performance budget.

## Proposed benchmark package

The implementation should add a dependency-free package with this conceptual layout:

```text
benchmarks/
  scopelock-performance.mjs
  fixtures.mjs
  equivalence.mjs
```

The exact internal module split may change, but the public command must support:

- selecting reference and candidate helpers;
- selecting scenario, operation, repetitions, and output path;
- running only inside verified temporary directories;
- emitting one machine-readable JSON result document;
- returning nonzero when setup, equivalence, timeout, or measurement requirements fail;
- cleaning temporary fixtures without touching the source workspace;
- running without third-party packages or network access.

Raw results must be written to an explicitly selected output path or a verified temporary directory. The harness must not silently add result files to the repository.

## Fixture construction rules

Every fixture must be deterministic from its scenario ID and seed.

- Initialize a fresh Git repository with a named branch and local test identity.
- Use short deterministic JavaScript files unless a scenario explicitly tests large files.
- Commit the tracked baseline before activating ScopeLock.
- Use `src/allowed/` as the allowed directory and `config/` as the default outside-scope directory.
- Never use real credentials, user documents, user repositories, or network content.
- Record a fixture manifest containing the seed, tracked path count, tracked bytes, dirty tracked count, untracked count, untracked bytes, repository mode, and expected findings.
- Exclude fixture creation, copying, cleanup, and result serialization from measured operation latency.
- Run scenarios sequentially. Parallel fixture execution would distort process and disk measurements.
- Resolve the temporary root and verify that cleanup remains inside it before recursive removal.

## Repository-size tiers

| Tier | Tracked paths | Intended use |
|---|---:|---|
| Small | 100 | Startup and regression sensitivity |
| Medium | 1,200 | Current representative interactive workload |
| Large | 10,000 | Monorepo-like scaling |
| Extra large | 50,000 | Bounded smoke and timeout behavior |

The extra-large tier is not required for every drift profile. It exists to expose nonlinear scaling and hard bounds without making the standard suite impractical.

## Required performance scenarios

| ID | Tier | State at activation | State at measurement | Primary operations |
|---|---|---|---|---|
| `S-clean` | Small | Clean | Clean | Activate, Status, all no-op hooks |
| `M-clean` | Medium | Clean | Clean | Activate, Status, PostToolUse |
| `M-mixed` | Medium | Clean | 25 modified tracked, 200 new untracked | Status, PostToolUse |
| `M-preexisting` | Medium | 25 modified tracked | 25 of those changed again, 200 new untracked | Activate, Status |
| `M-outside` | Medium | Clean | 25 allowed changes, 25 outside-scope changes | Status, PostToolUse |
| `L-clean` | Large | Clean | Clean | Activate, Status, PostToolUse |
| `L-mixed` | Large | Clean | 100 modified tracked, 1,000 new untracked | Status, PostToolUse |
| `L-untracked-heavy` | Large | Clean | 5,000 new untracked | Status, PostToolUse |
| `L-hash-heavy` | Large | 16 modified tracked files of 16 MiB each | The same files changed again | Activate, Status |
| `XL-clean` | Extra large | Clean | Clean | Status smoke |
| `XL-mixed` | Extra large | Clean | 250 modified tracked, 2,000 new untracked | Status and timeout smoke |

Each scenario must assert its expected finding counts and categories before its timing samples are accepted.

## Required guardrail scenarios

The following scenarios are correctness and boundedness gates. Their latency is recorded, but they do not need the full repetition count used for the performance matrix:

- sensitive tracked path excluded from hashing;
- tracked file larger than the current 64 MiB per-file hashing limit;
- nested Git repository;
- submodule state change;
- shallow clone;
- project root below the Git root;
- branch switch and rewritten history;
- repository-local clean or process filter;
- disabled repository fsmonitor;
- concurrent repository change during capture;
- corrupt active storage;
- storage or allowed-path link escape;
- no active Lock;
- no ScopeLock storage;
- invalid UTF-8 Git path on true POSIX filesystems.

The existing adversarial suite remains authoritative for behavior. The benchmark guardrail scenarios supplement it and must not replace it.

## Operations to measure

### Core commands

- `activate` on a fresh fixture;
- `status` with no storage;
- `status` with an active clean Lock;
- `status` with representative in-scope, out-of-scope, pre-existing, uncertain, and stale states.

### Hook paths

- SessionStart with no active Lock;
- SessionStart with an active clean Lock;
- PreToolUse for a matched non-`apply_patch` tool that produces no warning;
- PreToolUse for in-scope `apply_patch`;
- PreToolUse for out-of-scope `apply_patch`;
- PostToolUse with an active clean Lock;
- PostToolUse with in-scope changes;
- PostToolUse with out-of-scope changes;
- Stop with ordinary in-progress language;
- Stop with completion language and no verification report.

Hook measurements include the outer hook handler process because that is the delay experienced by the host.

## Measurement methodology

### Process isolation

Measure the actual CLI and hook entry points in fresh Node processes. Do not import their functions into the benchmark process for primary latency samples. Process startup is part of the user-visible cost.

### Samples

| Tier | Warmups | Measured repetitions |
|---|---:|---:|
| Small | 3 | 30 |
| Medium | 3 | 20 |
| Large | 2 | 10 |
| Extra large | 1 | 5 |

- Record the first successful invocation separately as `first_run_ms`.
- Discard warmups from percentile calculations, but retain them in raw output.
- Alternate reference and candidate order for each measured repetition to reduce thermal and cache-order bias.
- Use the same fixture state for reference and candidate Status and hook samples because those operations are read-only.
- Use independent fresh fixtures for each activation sample because activation writes storage.
- Stop the scenario and mark it invalid if fixture state changes unexpectedly between samples.

### Timing

- Measure wall-clock duration around the child process using a monotonic high-resolution clock.
- Start immediately before process creation and stop after exit and complete stdout/stderr capture.
- Do not include fixture construction, fixture cloning, expected-output calculation, cleanup, or report serialization.
- Record exit status, timeout status, stdout bytes, stderr bytes, and parse validity for every sample.

### Statistics

For valid measured samples, report:

- sample count;
- minimum and maximum;
- arithmetic mean;
- p50 using nearest-rank `ceil(0.50 * n)`;
- p95 using nearest-rank `ceil(0.95 * n)`;
- median relative change between candidate and reference;
- timeout and invalid-sample counts.

Do not interpolate percentiles or silently replace failed samples. A timeout or invalid sample is a gate failure and remains visible in the result.

### Host metadata

Every result must include:

- operating system and version;
- CPU model and logical-core count;
- total memory;
- filesystem type when discoverable without additional privileges;
- Node version;
- Git version;
- reference and candidate commit IDs;
- power mode when known;
- whether antivirus or indexing exclusions were present, when known;
- timestamp and benchmark harness version.

Reference and candidate comparisons are valid only when run on the same host in the same benchmark session. Absolute values from different hosts must not be compared as if they measured a code change.

## Diagnostic attribution

Primary latency measurements must use unmodified reference and candidate files.

Git-process count, Git-output bytes, hashed-file count, and hashed bytes require a separate diagnostic pass. The harness may create a temporary instrumented copy of the exact helper source that:

- counts calls at the existing Git execution boundary;
- counts successful file-hash operations and the bytes admitted by their size checks;
- writes diagnostic data to a benchmark-owned file, never stdout;
- preserves the helper's one-JSON-object stdout contract;
- is never used for latency acceptance;
- is deleted with the temporary fixture;
- fails setup if the expected instrumentation anchors do not match exactly.

Before diagnostic output is trusted, the instrumented copy must produce output structurally equivalent to the unmodified helper for the same guardrail fixtures. Production instrumentation is not authorized by this plan.

Required diagnostic metrics are:

- Node child-process count;
- Git child-process count;
- Git stdout bytes captured;
- repository captures attempted;
- repository captures retried;
- observations parsed;
- boundary filesystem checks;
- files hashed;
- bytes hashed;
- comparison result and limitation count.

Peak memory may be reported when the operating system provides it consistently, but it is not a cross-platform acceptance gate.

## Reference and candidate materialization

The harness must materialize the reference helper and hook from the immutable reference commit into a temporary reference directory. The hook and helper must remain adjacent so the reference hook invokes the reference helper.

The candidate comes from an explicit commit or a user-specified worktree. The harness must record whether the candidate was clean or dirty. Release-gate results require a clean candidate commit.

Do not modify checkout files to switch between reference and candidate implementations.

## Equivalence oracle

Performance samples count only when the candidate is behaviorally equivalent to the reference for that fixture.

### Status and hooks

For Status and hook comparisons:

1. Activate a fixture once with the reference helper.
2. Duplicate the complete fixture, including `.git/` and `.codex-scope/`, into verified temporary reference and candidate roots.
3. Run reference and candidate against their matching copies.
4. Parse the single JSON object from each invocation.
5. Compare deep structure with array order preserved.

The following may be normalized only when they are inherently fixture-specific:

- absolute temporary-root paths in sanitized error text;
- process IDs;
- timestamps created by the benchmark itself;
- measured duration fields from authorized validation commands.

Lock IDs, findings, evidence labels, health, result, limitations, summaries, storage-write flags, and hook warning text are not volatile and must remain equivalent.

### Activation

Activation uses independent fixtures, so normalize only generated Lock IDs and timestamps before comparing:

- command output;
- `active.json` structure;
- contract frontmatter and scope content;
- Baseline repository metadata, observations, fingerprints, exclusions, and limitations;
- set of created storage paths.

Digest values derived from normalized generated identifiers may be recomputed for comparison. No field may be dropped merely because it differs.

### Failure behavior

For corrupt, hostile, stale, unsupported, and timeout fixtures, compare:

- exit status;
- schema and result;
- structured error code;
- health and limitations;
- stdout object count;
- whether storage or source files changed.

Any unexplained difference blocks performance acceptance and requires explicit product review.

## Cross-platform execution matrix

| Gate | Windows | Linux | macOS |
|---|---|---|---|
| Harness development | Required | Optional | Optional |
| Reference baseline | Required | Required | Required |
| Candidate comparison | Required | Required | Required |
| POSIX invalid-byte fixture | Not applicable | Required | Required where filesystem permits |
| Canary approval | Required | Required | Required |

Use a true operating-system run. Git Bash on Windows does not satisfy Linux or macOS evidence.

The reference baseline may be collected on different hardware for each operating system, but every candidate comparison must pair reference and candidate on the same host. If one platform is temporarily unavailable, benchmark implementation may continue, but hook optimization must not begin until all three reference baselines are recorded or the user explicitly revises this gate.

## Acceptance gates

### Benchmark harness gate

Before optimization begins, the harness must demonstrate:

- deterministic fixture manifests for every required performance scenario;
- successful cleanup confined to verified temporary roots;
- complete raw samples and summary statistics;
- 100% reference self-equivalence;
- two consecutive Medium-suite runs whose reference p50 values differ by no more than 15% per operation;
- reference baselines on Windows, Linux, and macOS;
- no workspace writes other than an explicitly selected result path;
- a concise human-readable report plus machine-readable JSON.

### Candidate correctness gate

Every candidate must pass:

- the existing syntax and fixture suites;
- all equivalence scenarios;
- all guardrail scenarios applicable to the host;
- zero unexplained changes to findings, evidence, limitations, warning text, exit behavior, or storage writes;
- zero new timeouts.

### Interim performance gate

Until absolute budgets are approved from the cross-platform baseline:

- Medium `PostToolUse` p95 must improve by at least 50% on each supported operating system;
- no required scenario may regress by more than 10% at p95 unless both reference and candidate are below 20 ms;
- Large and Extra-large scenarios must produce zero timeouts;
- Git-process count and repository-capture count must not increase;
- hashed bytes must not increase for equivalent evidence;
- first-run latency must remain visible and may not be hidden by warmup-only reporting.

Passing the relative gate does not authorize broad rollout. Absolute p50 and p95 budgets must be proposed from the baseline evidence and explicitly added to the GamePlan before canary approval.

## Result document

The machine-readable result must contain at least:

```json
{
  "schema": "scopelock/performance-result/v1",
  "session": {},
  "host": {},
  "reference": {},
  "candidate": {},
  "scenarios": [],
  "equivalence": {},
  "gate": {
    "result": "pass|fail|incomplete",
    "reasons": []
  }
}
```

Raw samples belong under their scenario and operation. The report must never include fixture file contents, environment-variable values, repository configuration values, validation output beyond the existing sanitizer, or user paths outside the benchmark root.

## Implementation phases

### Phase 1: Fixture foundation

Implement deterministic fixture definitions, safe temporary-root creation and cleanup, fixture manifests, expected repository states, and focused fixture tests for the required performance scenarios. This phase does not add operation timing, reference-versus-candidate execution, equivalence, diagnostic instrumentation, package scripts, or runtime optimization.

Exit gate: fixture tests prove deterministic path and byte counts, correct clean and dirty Git states, stable expected findings metadata, and cleanup confined to verified temporary roots.

Status: implemented and validated on Windows on 2026-07-18. Evidence: `../benchmarks/fixtures.mjs`, `../tests/performance-fixtures.test.mjs`, the focused Phase 1 fixture run, and the full repository suite. The existing POSIX-only invalid-byte-path fixture remains skipped on Windows.

### Phase 2: Measurement engine

Implement unmodified reference and candidate materialization, child-process execution, raw sampling, statistics, host metadata, and machine-readable JSON output. Keep fixture construction and cleanup outside measured durations.

Exit gate: Small and Medium scenarios produce complete raw samples and correct summary statistics without writing outside verified temporary or explicitly selected result paths.

Status: implemented and validated on Windows on 2026-07-18. Evidence: `../benchmarks/scopelock-performance.mjs`, `../tests/performance-measurement.test.mjs`, complete Small and Medium raw-sample smoke runs, nearest-rank and paired-statistics assertions, outer hook-process coverage, exclusive JSON-output coverage, the 44-pass full repository suite with its existing POSIX-only skip, and a final audit showing zero benchmark temporary artifacts. Equivalence, diagnostic instrumentation, cross-platform qualification, absolute budgets, and runtime optimization have not started.

### Phase 3: Equivalence and diagnostic attribution

Implement Status and hook equivalence, activation normalization, failure-behavior equivalence, and the temporary diagnostic-instrumentation pass. Primary latency results continue to use unmodified helpers.

Exit gate: reference self-equivalence is 100%, diagnostic copies remain structurally equivalent to unmodified helpers, and unexplained output differences fail the run.

Status: implemented and validated on Windows on 2026-07-18. Evidence: `../benchmarks/equivalence.mjs`, `../tests/performance-equivalence.test.mjs`, the Phase 3 integration in `../benchmarks/scopelock-performance.mjs`, 100% immutable-reference self-equivalence across all 11 primary operations, representative in-scope and out-of-scope Status results, and corrupt, hostile, stale, unsupported, and timeout behavior. Anchor-checked Status, activation, and hook diagnostic copies remained structurally equivalent while emitting every required metric; a synthetic warning difference failed closed. The full repository suite passed 50 tests with only the existing Windows POSIX-byte-path skip, and the final cleanup audit found zero benchmark temporary artifacts. Phase 4 cross-platform baseline qualification and runtime optimization have not started.

### Phase 4: Baseline qualification

Run repeatability checks and the complete reference baseline on Windows, Linux, and macOS. Produce the concise human report and machine-readable result artifacts required by the harness gate.

Exit gate: two consecutive Medium runs satisfy the 15% repeatability bound, every required host baseline is complete, and no correctness, cleanup, timeout, or data-exposure failure remains unresolved.

### Phase 5: Budget approval and optimization handoff

Propose absolute p50 and p95 budgets from the qualified baseline, update the GamePlan, and stop for explicit approval. Only after budget approval may the separately governed hook-fast-path optimization phase begin.

Exit gate: the user explicitly approves absolute budgets and the benchmark evidence is sufficient to evaluate candidate optimization without changing the benchmark contract.

Do not combine benchmark implementation with runtime optimization in the same change. The benchmark must establish the evidence surface before it evaluates a candidate optimization.

## Completion evidence

The benchmark workstream is ready for optimization only when these artifacts exist:

- approved benchmark specification;
- committed dependency-free harness;
- fixture manifest for every required scenario;
- reference self-equivalence report;
- repeatability report;
- reference baseline result from Windows, Linux, and macOS;
- proposed absolute budgets awaiting or carrying explicit approval;
- no unresolved correctness, cleanup, or data-exposure failure.

Until then, the next phase remains measurement, not optimization.
