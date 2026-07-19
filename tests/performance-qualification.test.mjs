import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  cleanupBenchmarkTempDirectory,
  createBenchmarkTempDirectory,
} from "../benchmarks/fixtures.mjs";
import {
  BASELINE_MATRIX,
  CROSS_PLATFORM_SCHEMA,
  QUALIFICATION_SCHEMA,
  combineHostQualifications,
  evaluateRepeatability,
  renderCrossPlatformReport,
  renderHostReport,
  runHostQualification,
} from "../benchmarks/qualification.mjs";

function fakeBenchmarkResult(options) {
  const scenarioId = options.scenarios[0];
  const tier = scenarioId.startsWith("S-") ? "small"
    : scenarioId.startsWith("M-") ? "medium"
      : scenarioId.startsWith("XL-") ? "extra-large" : "large";
  return {
    schema: "scopelock/performance-result/v1",
    host: {
      os: { platform: process.platform, release: "test", arch: process.arch },
      node_version: process.version,
      reference_commit: "ceab256a9ef625bbef1648374943d6b63dad9e7f",
      candidate_commit: "ceab256a9ef625bbef1648374943d6b63dad9e7f",
    },
    scenarios: [{
      scenario_id: scenarioId,
      tier,
      operations: options.operations.map((operation, index) => ({
        operation,
        statistics: {
          reference: {
            first_run_ms: 12 + index,
            sample_count: 2,
            min_ms: 9 + index,
            max_ms: 11 + index,
            mean_ms: 10 + index,
            p50_ms: 10 + index,
            p95_ms: 11 + index,
            timeout_count: 0,
            invalid_sample_count: 0,
          },
        },
      })),
    }],
    diagnostics: options.operations.map((operation) => ({
      scenario_id: scenarioId,
      operation,
      metrics: {
        node_child_process_count: 1,
        git_child_process_count: 8,
        git_stdout_bytes: 100,
        repository_captures_attempted: 3,
        repository_captures_retried: 0,
        observations_parsed: 0,
        boundary_filesystem_checks: 0,
        files_hashed: 0,
        bytes_hashed: 0,
        comparison_result: "ok",
        limitation_count: 0,
      },
    })),
    equivalence: { status: "pass" },
    gate: { result: "pass", reasons: [] },
  };
}

test("baseline matrix covers every approved performance scenario and operation class", () => {
  assert.deepEqual(Object.keys(BASELINE_MATRIX), [
    "S-clean", "M-clean", "M-mixed", "M-preexisting", "M-outside",
    "L-clean", "L-mixed", "L-untracked-heavy", "L-hash-heavy", "XL-clean", "XL-mixed",
  ]);
  assert.deepEqual(new Set(BASELINE_MATRIX["S-clean"]), new Set([
    "activate", "status", "status-no-storage", "session-start", "session-no-lock",
    "pre-tool-noop", "pre-tool-in-scope", "pre-tool-outside", "post-tool",
    "stop-progress", "stop-complete",
  ]));
});

test("repeatability uses the approved 15 percent p50 bound", () => {
  const first = [{ scenario_id: "M-clean", operation: "status", p50_ms: 100 }];
  assert.equal(evaluateRepeatability(first, [{ scenario_id: "M-clean", operation: "status", p50_ms: 114 }]).result, "pass");
  const failed = evaluateRepeatability(first, [{ scenario_id: "M-clean", operation: "status", p50_ms: 116 }]);
  assert.equal(failed.result, "fail");
  assert.equal(failed.comparisons[0].relative_difference, 0.16);
});

test("host qualification writes complete raw and human artifacts to an explicit directory", { timeout: 30_000 }, async () => {
  const outputDirectory = await createBenchmarkTempDirectory("qualification-test");
  try {
    const summary = await runHostQualification({
      outputDirectory,
      expectedPlatform: process.platform,
      benchmarkRunner: async (options) => fakeBenchmarkResult(options),
      warmups: 0,
      repetitions: 2,
    });
    assert.equal(summary.schema, QUALIFICATION_SCHEMA);
    assert.equal(summary.gate.result, "pass");
    assert.equal(summary.repeatability.result, "pass");
    assert.equal(summary.baseline.complete, true);
    assert.equal(
      summary.baseline.entries.length,
      Object.values(BASELINE_MATRIX).reduce((total, operations) => total + operations.length, 0),
    );
    await access(`${outputDirectory}/host-qualification.json`);
    await access(`${outputDirectory}/host-qualification.md`);
    const stored = JSON.parse(await readFile(`${outputDirectory}/host-qualification.json`, "utf8"));
    assert.equal(stored.gate.result, "pass");
    assert.equal(renderHostReport(summary).includes(outputDirectory), false);
  } finally {
    await cleanupBenchmarkTempDirectory(outputDirectory);
  }
});

test("cross-platform qualification stays incomplete until all three true hosts pass", () => {
  const base = {
    schema: QUALIFICATION_SCHEMA,
    created_at: "2026-07-18T00:00:00.000Z",
    reference_commit: "ceab256a9ef625bbef1648374943d6b63dad9e7f",
    repeatability: { result: "pass", comparisons: [], limit: 0.15 },
    baseline: { complete: true, entries: [] },
    gate: { result: "pass", reasons: [] },
  };
  const incomplete = combineHostQualifications([{ ...base, platform: "win32" }]);
  assert.equal(incomplete.gate.result, "incomplete");
  assert.match(incomplete.gate.reasons[0], /linux, darwin/);

  const complete = combineHostQualifications([
    { ...base, platform: "win32" },
    { ...base, platform: "linux" },
    { ...base, platform: "darwin" },
  ]);
  assert.equal(complete.schema, CROSS_PLATFORM_SCHEMA);
  assert.equal(complete.gate.result, "pass");
  assert.match(renderCrossPlatformReport(complete), /\| darwin \| pass \| pass \| true \|/);
});
