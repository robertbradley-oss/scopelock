#!/usr/bin/env node

import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_COMMIT,
  runBenchmark,
  writeResult,
} from "./scopelock-performance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUALIFICATION_SCHEMA = "scopelock/performance-host-qualification/v1";
const CROSS_PLATFORM_SCHEMA = "scopelock/performance-cross-platform-qualification/v1";
const REPEATABILITY_LIMIT = 0.15;

const BASELINE_MATRIX = Object.freeze({
  "S-clean": Object.freeze([
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
  ]),
  "M-clean": Object.freeze(["activate", "status", "post-tool"]),
  "M-mixed": Object.freeze(["status", "post-tool"]),
  "M-preexisting": Object.freeze(["activate", "status"]),
  "M-outside": Object.freeze(["status", "post-tool"]),
  "L-clean": Object.freeze(["activate", "status", "post-tool"]),
  "L-mixed": Object.freeze(["status", "post-tool"]),
  "L-untracked-heavy": Object.freeze(["status", "post-tool"]),
  "L-hash-heavy": Object.freeze(["activate", "status"]),
  "XL-clean": Object.freeze(["status"]),
  "XL-mixed": Object.freeze(["status"]),
});

const MEDIUM_SCENARIOS = Object.freeze(Object.keys(BASELINE_MATRIX).filter((scenarioId) => scenarioId.startsWith("M-")));

function fixed(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function resultEntries(result) {
  const diagnostics = new Map(result.diagnostics.map((item) => [`${item.scenario_id}/${item.operation}`, item.metrics]));
  return result.scenarios.flatMap((scenario) => scenario.operations.map((operation) => {
    const stats = operation.statistics.reference;
    return {
      scenario_id: scenario.scenario_id,
      tier: scenario.tier,
      operation: operation.operation,
      first_run_ms: stats.first_run_ms,
      sample_count: stats.sample_count,
      min_ms: stats.min_ms,
      max_ms: stats.max_ms,
      mean_ms: stats.mean_ms,
      p50_ms: stats.p50_ms,
      p95_ms: stats.p95_ms,
      timeout_count: stats.timeout_count,
      invalid_sample_count: stats.invalid_sample_count,
      diagnostics: diagnostics.get(`${scenario.scenario_id}/${operation.operation}`) ?? null,
    };
  }));
}

function repeatabilityKey(entry) {
  return `${entry.scenario_id}/${entry.operation}`;
}

function evaluateRepeatability(firstEntries, secondEntries, limit = REPEATABILITY_LIMIT) {
  const first = new Map(firstEntries.map((entry) => [repeatabilityKey(entry), entry]));
  const second = new Map(secondEntries.map((entry) => [repeatabilityKey(entry), entry]));
  const keys = [...new Set([...first.keys(), ...second.keys()])].sort();
  const comparisons = keys.map((key) => {
    const left = first.get(key);
    const right = second.get(key);
    const valid = Number.isFinite(left?.p50_ms) && left.p50_ms > 0 && Number.isFinite(right?.p50_ms);
    const relativeDifference = valid ? Math.abs(right.p50_ms - left.p50_ms) / left.p50_ms : null;
    return {
      key,
      first_p50_ms: left?.p50_ms ?? null,
      second_p50_ms: right?.p50_ms ?? null,
      relative_difference: fixed(relativeDifference, 6),
      limit,
      pass: valid && relativeDifference <= limit,
    };
  });
  return {
    limit,
    result: comparisons.length > 0 && comparisons.every((item) => item.pass) ? "pass" : "fail",
    comparisons,
  };
}

function assertResultPassed(result, label) {
  if (result?.schema !== "scopelock/performance-result/v1") throw new Error(`${label} returned an invalid result schema`);
  if (result.gate?.result !== "pass") throw new Error(`${label} failed: ${(result.gate?.reasons ?? []).join("; ") || "unknown reason"}`);
  if (result.equivalence?.status !== "pass") throw new Error(`${label} did not pass equivalence`);
}

async function verifiedOutputDirectory(rawOutputDirectory) {
  if (typeof rawOutputDirectory !== "string" || !rawOutputDirectory) throw new Error("an explicit output directory is required");
  const resolved = await realpath(path.resolve(rawOutputDirectory));
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("qualification output must be a real directory");
  return resolved;
}

async function writeExclusiveJson(outputDirectory, name, value) {
  await writeFile(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function writeExclusiveText(outputDirectory, name, value) {
  await writeFile(path.join(outputDirectory, name), value.endsWith("\n") ? value : `${value}\n`, { encoding: "utf8", flag: "wx" });
}

async function runMatrix({
  matrix,
  artifactPrefix,
  outputDirectory,
  benchmarkRunner,
  warmups,
  repetitions,
  includeFailureOnFirst = false,
}) {
  const entries = [];
  const artifacts = [];
  let host = null;
  let index = 0;
  for (const [scenarioId, operations] of Object.entries(matrix)) {
    const result = await benchmarkRunner({
      scenarios: [scenarioId],
      operations: [...operations],
      referenceSource: `commit:${REFERENCE_COMMIT}`,
      candidateSource: `commit:${REFERENCE_COMMIT}`,
      ...(warmups === undefined ? {} : { warmups }),
      ...(repetitions === undefined ? {} : { repetitions }),
      includeFailureEquivalence: includeFailureOnFirst && index === 0,
    });
    assertResultPassed(result, `${artifactPrefix}/${scenarioId}`);
    host ??= result.host;
    entries.push(...resultEntries(result));
    const artifact = `${artifactPrefix}-${scenarioId.toLowerCase()}.json`;
    await writeResult(result, path.join(outputDirectory, artifact));
    artifacts.push(artifact);
    index += 1;
  }
  return { entries, artifacts, host };
}

function matrixForScenarios(scenarioIds) {
  return Object.fromEntries(scenarioIds.map((scenarioId) => [scenarioId, BASELINE_MATRIX[scenarioId]]));
}

function baselineMatrixWithoutMedium() {
  return Object.fromEntries(Object.entries(BASELINE_MATRIX).filter(([scenarioId]) => !scenarioId.startsWith("M-")));
}

function renderHostReport(summary) {
  const lines = [
    "# ScopeLock Reference Baseline Qualification",
    "",
    `- Platform: ${summary.platform}`,
    `- Timestamp: ${summary.created_at}`,
    `- Reference commit: ${summary.reference_commit}`,
    `- Host gate: ${summary.gate.result}`,
    `- Medium repeatability: ${summary.repeatability.result} (limit ${(summary.repeatability.limit * 100).toFixed(0)}%)`,
    "",
    "## Repeatability",
    "",
    "| Scenario / operation | First p50 | Second p50 | Difference | Result |",
    "| --- | ---: | ---: | ---: | --- |",
    ...summary.repeatability.comparisons.map((item) => (
      `| ${item.key} | ${item.first_p50_ms?.toFixed?.(3) ?? "n/a"} ms | ${item.second_p50_ms?.toFixed?.(3) ?? "n/a"} ms | ${item.relative_difference === null ? "n/a" : `${(item.relative_difference * 100).toFixed(2)}%`} | ${item.pass ? "pass" : "fail"} |`
    )),
    "",
    "## Reference baseline",
    "",
    "| Scenario | Operation | First run | p50 | p95 | Timeouts | Git processes | Hashed bytes |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.baseline.entries.map((entry) => (
      `| ${entry.scenario_id} | ${entry.operation} | ${entry.first_run_ms?.toFixed?.(3) ?? "n/a"} ms | ${entry.p50_ms?.toFixed?.(3) ?? "n/a"} ms | ${entry.p95_ms?.toFixed?.(3) ?? "n/a"} ms | ${entry.timeout_count} | ${entry.diagnostics?.git_child_process_count ?? "n/a"} | ${entry.diagnostics?.bytes_hashed ?? "n/a"} |`
    )),
    "",
    "Raw machine-readable artifacts are listed by filename in `host-qualification.json`.",
  ];
  return `${lines.join("\n")}\n`;
}

async function runHostQualification({
  outputDirectory: rawOutputDirectory,
  expectedPlatform = process.platform,
  benchmarkRunner = runBenchmark,
  warmups,
  repetitions,
} = {}) {
  if (!["win32", "linux", "darwin"].includes(expectedPlatform)) throw new Error("expected platform must be win32, linux, or darwin");
  if (process.platform !== expectedPlatform) throw new Error(`host platform ${process.platform} does not match required platform ${expectedPlatform}`);
  const outputDirectory = await verifiedOutputDirectory(rawOutputDirectory);
  const mediumMatrix = matrixForScenarios(MEDIUM_SCENARIOS);
  const repeatabilityRuns = [];
  for (let run = 1; run <= 2; run += 1) {
    repeatabilityRuns.push(await runMatrix({
      matrix: mediumMatrix,
      artifactPrefix: `medium-repeatability-${run}`,
      outputDirectory,
      benchmarkRunner,
      warmups,
      repetitions,
    }));
  }
  const repeatability = evaluateRepeatability(repeatabilityRuns[0].entries, repeatabilityRuns[1].entries);
  const remaining = await runMatrix({
    matrix: baselineMatrixWithoutMedium(),
    artifactPrefix: "reference-baseline",
    outputDirectory,
    benchmarkRunner,
    warmups,
    repetitions,
    includeFailureOnFirst: true,
  });
  const baselineEntries = [...repeatabilityRuns[1].entries, ...remaining.entries]
    .sort((a, b) => repeatabilityKey(a).localeCompare(repeatabilityKey(b)));
  const allArtifacts = [
    ...repeatabilityRuns.flatMap((run) => run.artifacts),
    ...remaining.artifacts,
  ];
  const baselineComplete = Object.entries(BASELINE_MATRIX).every(([scenarioId, operations]) => (
    operations.every((operation) => baselineEntries.some((entry) => entry.scenario_id === scenarioId && entry.operation === operation))
  ));
  const reasons = [
    ...(repeatability.result === "pass" ? [] : ["Medium repeatability exceeded the 15% p50 bound"]),
    ...(baselineComplete ? [] : ["The reference baseline matrix is incomplete"]),
    ...(baselineEntries.some((entry) => entry.timeout_count > 0 || entry.invalid_sample_count > 0)
      ? ["The reference baseline contains timeout or invalid samples"] : []),
  ];
  const host = remaining.host ?? repeatabilityRuns[0].host;
  const summary = {
    schema: QUALIFICATION_SCHEMA,
    created_at: new Date().toISOString(),
    platform: process.platform,
    reference_commit: REFERENCE_COMMIT,
    host,
    repeatability,
    baseline: { complete: baselineComplete, entries: baselineEntries },
    artifacts: allArtifacts,
    gate: { result: reasons.length ? "fail" : "pass", reasons },
  };
  await writeExclusiveJson(outputDirectory, "host-qualification.json", summary);
  await writeExclusiveText(outputDirectory, "host-qualification.md", renderHostReport(summary));
  return summary;
}

function combineHostQualifications(summaries) {
  const byPlatform = new Map();
  for (const summary of summaries) {
    if (summary?.schema !== QUALIFICATION_SCHEMA) throw new Error("invalid host qualification schema");
    if (byPlatform.has(summary.platform)) throw new Error(`duplicate host qualification: ${summary.platform}`);
    byPlatform.set(summary.platform, summary);
  }
  const required = ["win32", "linux", "darwin"];
  const missing = required.filter((platform) => !byPlatform.has(platform));
  const failed = required.filter((platform) => byPlatform.get(platform)?.gate?.result !== "pass");
  const reasons = [
    ...(missing.length ? [`Missing host qualifications: ${missing.join(", ")}`] : []),
    ...(failed.length ? [`Failed host qualifications: ${failed.join(", ")}`] : []),
  ];
  return {
    schema: CROSS_PLATFORM_SCHEMA,
    created_at: new Date().toISOString(),
    reference_commit: REFERENCE_COMMIT,
    hosts: required.filter((platform) => byPlatform.has(platform)).map((platform) => ({
      platform,
      created_at: byPlatform.get(platform).created_at,
      gate: byPlatform.get(platform).gate,
      repeatability: byPlatform.get(platform).repeatability,
      baseline_complete: byPlatform.get(platform).baseline.complete,
    })),
    gate: { result: reasons.length ? "incomplete" : "pass", reasons },
  };
}

function renderCrossPlatformReport(summary) {
  return `${[
    "# ScopeLock Cross-Platform Baseline Qualification",
    "",
    `- Reference commit: ${summary.reference_commit}`,
    `- Gate: ${summary.gate.result}`,
    ...summary.gate.reasons.map((reason) => `- Reason: ${reason}`),
    "",
    "| Platform | Host gate | Repeatability | Baseline complete |",
    "| --- | --- | --- | --- |",
    ...summary.hosts.map((host) => `| ${host.platform} | ${host.gate.result} | ${host.repeatability.result} | ${host.baseline_complete} |`),
  ].join("\n")}\n`;
}

function parseCli(args) {
  const command = args[0];
  if (command === "host") {
    const outputIndex = args.indexOf("--output-dir");
    const platformIndex = args.indexOf("--expected-platform");
    if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error("host requires --output-dir <directory>");
    return {
      command,
      outputDirectory: args[outputIndex + 1],
      expectedPlatform: platformIndex >= 0 ? args[platformIndex + 1] : process.platform,
    };
  }
  if (command === "combine") {
    const outputIndex = args.indexOf("--output-dir");
    if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error("combine requires --output-dir <directory>");
    const inputs = [];
    for (let index = 1; index < args.length; index += 1) {
      if (args[index] === "--host" && args[index + 1]) {
        inputs.push(args[index + 1]);
        index += 1;
      }
    }
    if (inputs.length === 0) throw new Error("combine requires at least one --host <host-qualification.json>");
    return { command, outputDirectory: args[outputIndex + 1], inputs };
  }
  throw new Error("usage: qualification.mjs host|combine ...");
}

async function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    if (options.command === "host") {
      const summary = await runHostQualification(options);
      process.stdout.write(`${JSON.stringify({ schema: QUALIFICATION_SCHEMA, gate: summary.gate, platform: summary.platform })}\n`);
      if (summary.gate.result !== "pass") process.exitCode = 1;
      return;
    }
    const outputDirectory = await verifiedOutputDirectory(options.outputDirectory);
    const summaries = await Promise.all(options.inputs.map(async (input) => JSON.parse(await readFile(input, "utf8"))));
    const combined = combineHostQualifications(summaries);
    await writeExclusiveJson(outputDirectory, "cross-platform-qualification.json", combined);
    await writeExclusiveText(outputDirectory, "cross-platform-qualification.md", renderCrossPlatformReport(combined));
    process.stdout.write(`${JSON.stringify({ schema: CROSS_PLATFORM_SCHEMA, gate: combined.gate })}\n`);
    if (combined.gate.result !== "pass") process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema: "scopelock/performance-qualification-error/v1",
      gate: { result: "fail", reasons: [String(error?.message || error).slice(0, 1000)] },
    })}\n`);
    process.exitCode = 1;
  }
}

export {
  BASELINE_MATRIX,
  CROSS_PLATFORM_SCHEMA,
  MEDIUM_SCENARIOS,
  QUALIFICATION_SCHEMA,
  REPEATABILITY_LIMIT,
  combineHostQualifications,
  evaluateRepeatability,
  renderCrossPlatformReport,
  renderHostReport,
  resultEntries,
  runHostQualification,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
