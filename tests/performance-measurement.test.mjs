import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanupBenchmarkTempDirectory,
  createBenchmarkTempDirectory,
} from "../benchmarks/fixtures.mjs";
import {
  REFERENCE_COMMIT,
  materializeImplementation,
  nearestRank,
  runBenchmark,
  summarizeSamples,
  writeResult,
} from "../benchmarks/scopelock-performance.mjs";

test("nearest-rank and arithmetic statistics follow the approved definitions", () => {
  assert.equal(nearestRank([1, 2, 3, 4], 0.5), 2);
  assert.equal(nearestRank([1, 2, 3, 4], 0.95), 4);
  assert.equal(nearestRank([], 0.95), null);
  const summary = summarizeSamples([
    { phase: "first", valid: true, duration_ms: 9, timed_out: false },
    { phase: "warmup", valid: true, duration_ms: 8, timed_out: false },
    { phase: "measured", valid: true, duration_ms: 1, timed_out: false },
    { phase: "measured", valid: true, duration_ms: 2, timed_out: false },
    { phase: "measured", valid: true, duration_ms: 3, timed_out: false },
    { phase: "measured", valid: false, duration_ms: 99, timed_out: true },
  ]);
  assert.deepEqual(summary, {
    expected_count: 4,
    sample_count: 3,
    min_ms: 1,
    max_ms: 3,
    mean_ms: 2,
    p50_ms: 2,
    p95_ms: 3,
    timeout_count: 1,
    invalid_sample_count: 1,
    first_run_ms: 9,
  });
});

test("reference and worktree implementations materialize unchanged adjacent entry points", async () => {
  const reference = await materializeImplementation(`commit:${REFERENCE_COMMIT}`, { label: "test-reference" });
  const candidate = await materializeImplementation("worktree", { label: "test-candidate" });
  try {
    assert.equal(reference.metadata.commit, REFERENCE_COMMIT);
    assert.equal(reference.metadata.kind, "commit");
    assert.equal(candidate.metadata.kind, "worktree");
    assert.match(reference.metadata.digests["scripts/scopelock.mjs"], /^[0-9a-f]{64}$/);
    assert.deepEqual(reference.metadata.digests, candidate.metadata.digests);
    assert.equal(path.dirname(reference.helperPath), path.dirname(reference.hookPath));
    assert.equal(path.dirname(candidate.helperPath), path.dirname(candidate.hookPath));
  } finally {
    await cleanupBenchmarkTempDirectory(reference.root);
    await cleanupBenchmarkTempDirectory(candidate.root);
  }
});

test("small and medium scenarios emit complete raw child-process samples", { timeout: 90000 }, async () => {
  const result = await runBenchmark({
    scenarios: ["S-clean", "M-mixed"],
    operations: ["status"],
    warmups: 0,
    repetitions: 1,
    timeoutMs: 20_000,
    includeFailureEquivalence: false,
  });
  assert.equal(result.schema, "scopelock/performance-result/v1");
  assert.equal(result.gate.result, "pass");
  assert.equal(result.equivalence.status, "pass");
  assert.equal(result.equivalence.comparison_count, 2);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.every((item) => item.structurally_equivalent && item.metrics_valid));
  assert.equal(result.scenarios.length, 2);
  for (const scenario of result.scenarios) {
    const operation = scenario.operations[0];
    assert.equal(operation.samples.length, 4);
    assert.ok(operation.samples.every((sample) => sample.valid));
    assert.ok(operation.samples.every((sample) => sample.stdout_bytes > 0));
    assert.equal(operation.statistics.reference.sample_count, 1);
    assert.equal(operation.statistics.candidate.sample_count, 1);
    assert.equal(operation.statistics.paired_sample_count, 1);
  }
  assert.equal(JSON.stringify(result).includes(process.cwd()), false);
});

test("hook entry points are measured through the outer child process", { timeout: 60000 }, async () => {
  const result = await runBenchmark({
    scenarios: ["S-clean"],
    operations: ["pre-tool-noop"],
    warmups: 0,
    repetitions: 1,
    timeoutMs: 20_000,
    includeFailureEquivalence: false,
  });
  const operation = result.scenarios[0].operations[0];
  assert.equal(result.gate.result, "pass");
  assert.ok(operation.samples.every((sample) => sample.output.kind === "hook"));
  assert.ok(operation.samples.every((sample) => sample.parse_valid));
  assert.equal(result.equivalence.status, "pass");
  assert.equal(result.diagnostics[0].structurally_equivalent, true);
  assert.ok(result.diagnostics[0].metrics.node_child_process_count >= 2);
});

test("result files are explicit, machine-readable, and never overwritten", async () => {
  const root = await createBenchmarkTempDirectory("result-test");
  const target = path.join(root, "result.json");
  const result = { schema: "scopelock/performance-result/v1", gate: { result: "pass", reasons: [] } };
  try {
    await writeResult(result, target);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), result);
    await assert.rejects(writeResult(result, target), /EEXIST/);
  } finally {
    await cleanupBenchmarkTempDirectory(root);
  }
});
