import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cleanupBenchmarkTempDirectory,
} from "../benchmarks/fixtures.mjs";
import {
  compareExecutions,
  instrumentHelperSource,
  runDiagnosticPass,
  runEquivalenceSuite,
  runFailureEquivalenceSuite,
} from "../benchmarks/equivalence.mjs";
import {
  REFERENCE_COMMIT,
  materializeImplementation,
  operationInvocation,
  runChildSample,
} from "../benchmarks/scopelock-performance.mjs";

let reference;
let candidate;

before(async () => {
  reference = await materializeImplementation(`commit:${REFERENCE_COMMIT}`, { label: "equivalence-reference-test" });
  candidate = await materializeImplementation(`commit:${REFERENCE_COMMIT}`, { label: "equivalence-candidate-test" });
});

after(async () => {
  if (reference) await cleanupBenchmarkTempDirectory(reference.root);
  if (candidate) await cleanupBenchmarkTempDirectory(candidate.root);
});

test("diagnostic instrumentation requires every approved source anchor", async () => {
  const source = await readFile(reference.helperPath, "utf8");
  const instrumented = instrumentHelperSource(source);
  assert.notEqual(instrumented, source);
  assert.match(instrumented, /BENCHMARK_DIAGNOSTICS\.git_child_process_count/);
  assert.throws(
    () => instrumentHelperSource(source.replace("function runGit", "function renamedRunGit")),
    /anchor mismatch: git-count/,
  );
});

test("unexplained warning differences fail closed", () => {
  const common = { exit_status: 0, timed_out: false, stdout_object_count: 1 };
  const comparison = compareExecutions(
    { ...common, parsed_output: { result: "ok", warning: "reference warning" } },
    { ...common, parsed_output: { result: "ok", warning: "candidate warning" } },
  );
  assert.equal(comparison.equivalent, false);
  assert.deepEqual(comparison.differences, ["$.output.warning"]);
});

test("reference self-equivalence covers every primary operation", { timeout: 240_000 }, async () => {
  const operations = [
    "activate",
    "status",
    "status-no-storage",
    "session-start",
    "session-no-lock",
    "pre-tool-noop",
    "pre-tool-in-scope",
    "pre-tool-outside",
    "post-tool",
    "stop-progress",
    "stop-complete",
  ];
  const result = await runEquivalenceSuite({
    scenarios: ["S-clean"],
    operations,
    reference,
    candidate,
    execute: runChildSample,
    invoke: operationInvocation,
    timeoutMs: 20_000,
    includeFailures: false,
  });
  assert.equal(result.status, "pass", JSON.stringify(result.comparisons.map((item) => ({ operation: item.operation, differences: item.differences }))));
  assert.equal(result.comparison_count, operations.length);
  assert.equal(result.equivalent_count, operations.length);
  assert.ok(result.comparisons.every((comparison) => comparison.differences.length === 0));
  assert.equal(result.comparisons.find((comparison) => comparison.operation === "activate").storage_equivalent, true);
});

test("reference failure behavior is equivalent for every required class", { timeout: 180_000 }, async () => {
  const cases = await runFailureEquivalenceSuite({
    reference,
    candidate,
    execute: runChildSample,
    invoke: operationInvocation,
  });
  assert.deepEqual(cases.map((item) => item.case), ["corrupt", "hostile", "stale", "unsupported", "timeout"]);
  assert.ok(
    cases.every((item) => item.equivalent),
    JSON.stringify(cases.map((item) => ({ case: item.case, differences: item.differences }))),
  );
  assert.ok(cases.every((item) => item.reference.mutation.source_changed === item.candidate.mutation.source_changed));
  assert.ok(cases.every((item) => item.reference.mutation.storage_changed === item.candidate.mutation.storage_changed));
});

test("reference Status self-equivalence preserves in-scope and out-of-scope findings", { timeout: 120_000 }, async () => {
  const result = await runEquivalenceSuite({
    scenarios: ["M-mixed", "M-outside"],
    operations: ["status"],
    reference,
    candidate,
    execute: runChildSample,
    invoke: operationInvocation,
    timeoutMs: 20_000,
    includeFailures: false,
  });
  assert.equal(result.status, "pass");
  assert.equal(result.equivalent_count, 2);
});

test("temporary diagnostic copies preserve output and emit all required metrics", { timeout: 90_000 }, async () => {
  const result = await runDiagnosticPass({
    scenarioId: "S-clean",
    operation: "status",
    implementation: candidate,
    execute: runChildSample,
    invoke: operationInvocation,
    timeoutMs: 20_000,
  });
  assert.equal(result.structurally_equivalent, true);
  assert.equal(result.metrics_valid, true);
  assert.equal(result.used_for_latency_acceptance, false);
  assert.ok(result.metrics.node_child_process_count >= 1);
  assert.ok(result.metrics.git_child_process_count >= 1);
  assert.ok(result.metrics.repository_captures_attempted >= 1);

  const activation = await runDiagnosticPass({
    scenarioId: "S-clean",
    operation: "activate",
    implementation: candidate,
    execute: runChildSample,
    invoke: operationInvocation,
    timeoutMs: 20_000,
  });
  assert.equal(activation.structurally_equivalent, true);
  assert.equal(activation.metrics_valid, true);
});
