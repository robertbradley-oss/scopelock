#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  PERFORMANCE_SCENARIOS,
  advancePerformanceFixture,
  cleanupBenchmarkTempDirectory,
  cleanupPerformanceFixture,
  createBenchmarkTempDirectory,
  createPerformanceFixture,
} from "./fixtures.mjs";
import { runDiagnosticPass, runEquivalenceSuite } from "./equivalence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
const REFERENCE_COMMIT = "ceab256a9ef625bbef1648374943d6b63dad9e7f";
const RESULT_SCHEMA = "scopelock/performance-result/v1";
const HARNESS_VERSION = "1";
const MAX_CAPTURE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const IMPLEMENTATION_FILES = ["scripts/scopelock.mjs", "scripts/scopelock-hook.mjs"];
const SAMPLE_COUNTS = Object.freeze({
  small: { warmups: 3, repetitions: 30 },
  medium: { warmups: 3, repetitions: 20 },
  large: { warmups: 2, repetitions: 10 },
  "extra-large": { warmups: 1, repetitions: 5 },
});
const OPERATIONS = new Set([
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
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitEnvironment() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (upper === "NODE_OPTIONS" || upper === "NODE_PATH" || upper.startsWith("GIT_TRACE")
      || upper === "GIT_DIR" || upper === "GIT_WORK_TREE" || upper === "GIT_INDEX_FILE"
      || upper === "GIT_OBJECT_DIRECTORY" || upper === "GIT_ALTERNATE_OBJECT_DIRECTORIES"
      || upper === "GIT_COMMON_DIR" || upper === "GIT_CONFIG" || upper === "GIT_CONFIG_COUNT"
      || upper === "GIT_CONFIG_GLOBAL" || upper === "GIT_CONFIG_SYSTEM"
      || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(upper)) delete env[key];
  }
  return env;
}

function runGit(args, { cwd = PROJECT_ROOT, encoding = "utf8", maxBuffer = 64 * 1024 * 1024 } = {}) {
  const result = spawnSync("git", ["--no-pager", "--no-optional-locks", "--no-lazy-fetch", "--no-replace-objects", ...args], {
    cwd,
    env: gitEnvironment(),
    encoding,
    maxBuffer,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || "unknown Git error").trim().slice(0, 800);
    throw new Error(`benchmark Git command failed (${args[0]}): ${detail}`);
  }
  return encoding ? result.stdout.trim() : result.stdout;
}

function validateCommitRef(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(value)) {
    throw new Error("implementation commit reference is invalid");
  }
  return value;
}

async function readRegularFile(root, relative) {
  const target = path.resolve(root, ...relative.split("/"));
  const relativeToRoot = path.relative(root, target);
  if (relativeToRoot.startsWith(`..${path.sep}`) || relativeToRoot === ".." || path.isAbsolute(relativeToRoot)) {
    throw new Error("implementation file resolves outside its source root");
  }
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`implementation source is not a regular file: ${relative}`);
  return await readFile(target);
}

function normalizeSource(source) {
  if (typeof source === "string") {
    if (source === "worktree") return { kind: "worktree", root: PROJECT_ROOT, label: "worktree" };
    if (source.startsWith("commit:")) return { kind: "commit", ref: validateCommitRef(source.slice(7)), label: source };
  }
  if (source?.kind === "worktree") return { kind: "worktree", root: path.resolve(source.root || PROJECT_ROOT), label: source.label || "worktree" };
  if (source?.kind === "commit") {
    const ref = validateCommitRef(source.ref);
    return { kind: "commit", ref, label: source.label || `commit:${ref}` };
  }
  throw new Error("implementation source must be worktree or commit:<ref>");
}

async function materializeImplementation(source, { label = "implementation" } = {}) {
  const normalized = normalizeSource(source);
  const root = await createBenchmarkTempDirectory(label);
  try {
    const bytes = {};
    for (const relative of IMPLEMENTATION_FILES) {
      bytes[relative] = normalized.kind === "commit"
        ? runGit(["show", `${normalized.ref}:${relative}`], { encoding: null })
        : await readRegularFile(normalized.root, relative);
    }
    await mkdir(path.join(root, "scripts"), { recursive: true });
    for (const relative of IMPLEMENTATION_FILES) await writeFile(path.join(root, ...relative.split("/")), bytes[relative]);

    const commit = normalized.kind === "commit"
      ? runGit(["rev-parse", "--verify", `${normalized.ref}^{commit}`])
      : runGit(["rev-parse", "HEAD"], { cwd: normalized.root });
    const dirty = normalized.kind === "worktree"
      ? runGit(["status", "--porcelain", "--untracked-files=no", "--", ...IMPLEMENTATION_FILES], { cwd: normalized.root }) !== ""
      : false;
    return {
      root,
      helperPath: path.join(root, "scripts", "scopelock.mjs"),
      hookPath: path.join(root, "scripts", "scopelock-hook.mjs"),
      metadata: {
        kind: normalized.kind,
        label: normalized.label,
        commit,
        dirty,
        digests: Object.fromEntries(IMPLEMENTATION_FILES.map((relative) => [relative, sha256(bytes[relative])])),
      },
    };
  } catch (error) {
    await cleanupBenchmarkTempDirectory(root).catch(() => {});
    throw error;
  }
}

function outputSummary(parsed, expectedKind = null) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (expectedKind === "hook" || parsed.hookSpecificOutput || parsed.systemMessage) {
    return {
      kind: "hook",
      keys: Object.keys(parsed).sort(),
      hook_event_name: parsed.hookSpecificOutput?.hookEventName ?? null,
      has_system_message: typeof parsed.systemMessage === "string",
    };
  }
  return {
    kind: "core",
    schema: typeof parsed.schema === "string" ? parsed.schema : null,
    result: typeof parsed.result === "string" ? parsed.result : null,
    health: typeof parsed.health === "string" ? parsed.health : null,
    error_code: typeof parsed.error?.code === "string" ? parsed.error.code : null,
  };
}

async function runChildSample({ script, args = [], cwd, env = {}, input, outputKind = null, retainParsed = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const started = performance.now();
  return await new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let overflow = false;
    let settled = false;
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...gitEnvironment(), ...env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const capture = (collection, chunk, kind) => {
      if (kind === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes <= MAX_CAPTURE_BYTES) collection.push(chunk);
      else {
        overflow = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => capture(stderr, chunk, "stderr"));
    child.on("error", (error) => finish(null, error));
    child.on("close", (status, signal) => finish(status, null, signal));

    function finish(status, spawnError, signal = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = performance.now() - started;
      const text = Buffer.concat(stdout).toString("utf8").trim();
      const lines = text.split(/\r?\n/).filter(Boolean);
      let parsed = null;
      let parseValid = false;
      if (lines.length === 1) {
        try {
          parsed = JSON.parse(lines[0]);
          parseValid = Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
        } catch {}
      }
      const valid = !spawnError && !timedOut && !overflow && status === 0 && parseValid;
      resolve({
        duration_ms: Number(durationMs.toFixed(3)),
        exit_status: Number.isInteger(status) ? status : null,
        signal,
        timed_out: timedOut,
        output_overflow: overflow,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        parse_valid: parseValid,
        valid,
        output: outputSummary(parsed, outputKind),
        ...(retainParsed ? { parsed_output: parsed, stdout_object_count: lines.length } : {}),
        error: spawnError ? String(spawnError.message).slice(0, 300) : null,
      });
    }

    if (input === undefined) child.stdin.end();
    else child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

function activationInput() {
  return {
    objective: "Measure ScopeLock performance",
    allowed: ["src/allowed/"],
    forbidden: [],
    constraints: ["Preserve benchmark fixture behavior"],
    definition_of_done: ["Measurement completes"],
    validation_requirements: [],
    scope_source: "explicit",
    whole_project_explicit: false,
  };
}

function operationInvocation(operation, implementation, fixtureRoot) {
  if (operation === "activate") {
    return { script: implementation.helperPath, args: ["activate", "--project-root", fixtureRoot], cwd: fixtureRoot, input: activationInput(), outputKind: "core" };
  }
  if (operation === "status" || operation === "status-no-storage") {
    return { script: implementation.helperPath, args: ["status", "--project-root", fixtureRoot], cwd: fixtureRoot, outputKind: "core" };
  }
  const base = { hook_event_name: "SessionStart", cwd: fixtureRoot };
  if (operation === "session-no-lock" || operation === "session-start") base.hook_event_name = "SessionStart";
  if (operation.startsWith("pre-tool")) {
    base.hook_event_name = "PreToolUse";
    base.tool_name = operation === "pre-tool-noop" ? "exec_command" : "apply_patch";
    base.tool_input = {
      command: operation === "pre-tool-outside"
        ? "*** Begin Patch\n*** Update File: config/file-000000.json\n*** End Patch"
        : "*** Begin Patch\n*** Update File: src/allowed/file-000000.js\n*** End Patch",
    };
  }
  if (operation === "post-tool") base.hook_event_name = "PostToolUse";
  if (operation.startsWith("stop-")) {
    base.hook_event_name = "Stop";
    base.last_assistant_message = operation === "stop-complete" ? "Implementation complete." : "Work remains in progress.";
  }
  return { script: implementation.hookPath, cwd: fixtureRoot, input: base, outputKind: "hook" };
}

function nearestRank(sorted, percentile) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeSamples(samples) {
  const measured = samples.filter((sample) => sample.phase === "measured");
  const validDurations = measured.filter((sample) => sample.valid).map((sample) => sample.duration_ms).sort((a, b) => a - b);
  const total = validDurations.reduce((sum, value) => sum + value, 0);
  return {
    expected_count: measured.length,
    sample_count: validDurations.length,
    min_ms: validDurations.length ? validDurations[0] : null,
    max_ms: validDurations.length ? validDurations.at(-1) : null,
    mean_ms: validDurations.length ? Number((total / validDurations.length).toFixed(3)) : null,
    p50_ms: nearestRank(validDurations, 0.50),
    p95_ms: nearestRank(validDurations, 0.95),
    timeout_count: measured.filter((sample) => sample.timed_out).length,
    invalid_sample_count: measured.filter((sample) => !sample.valid).length,
    first_run_ms: samples.find((sample) => sample.phase === "first" && sample.valid)?.duration_ms ?? null,
  };
}

function summarizeOperation(samples) {
  const reference = samples.filter((sample) => sample.implementation === "reference");
  const candidate = samples.filter((sample) => sample.implementation === "candidate");
  const paired = new Map();
  for (const sample of samples.filter((item) => item.phase === "measured" && item.valid)) {
    const pair = paired.get(sample.iteration) || {};
    pair[sample.implementation] = sample.duration_ms;
    paired.set(sample.iteration, pair);
  }
  const relative = [...paired.values()]
    .filter((pair) => pair.reference > 0 && Number.isFinite(pair.candidate))
    .map((pair) => (pair.candidate - pair.reference) / pair.reference);
  return {
    reference: summarizeSamples(reference),
    candidate: summarizeSamples(candidate),
    paired_median_relative_change: relative.length ? Number(median(relative).toFixed(6)) : null,
    paired_sample_count: relative.length,
  };
}

async function setupSharedFixture(scenarioId, operation, reference, timeoutMs) {
  const noStorage = operation === "status-no-storage" || operation === "session-no-lock";
  const fixture = await createPerformanceFixture(scenarioId, { stage: noStorage ? "measurement" : "activation" });
  try {
    if (noStorage) return fixture;
    const setup = await runChildSample({
      ...operationInvocation("activate", reference, fixture.root),
      timeoutMs,
    });
    if (!setup.valid) throw new Error(`reference activation setup failed for ${scenarioId}/${operation}`);
    return await advancePerformanceFixture(fixture);
  } catch (error) {
    await cleanupPerformanceFixture(fixture).catch(() => {});
    throw error;
  }
}

async function samplePair({ scenarioId, operation, phase, iteration, order, implementations, fixture, timeoutMs }) {
  const samples = [];
  const beforeFingerprint = operation === "activate" ? null : fixtureFingerprint(fixture.root);
  for (const implementationName of order) {
    const implementation = implementations[implementationName];
    let sampleFixture = fixture;
    if (operation === "activate") sampleFixture = await createPerformanceFixture(scenarioId, { stage: "activation" });
    try {
      const measured = await runChildSample({
        ...operationInvocation(operation, implementation, sampleFixture.root),
        timeoutMs,
      });
      samples.push({ phase, iteration, implementation: implementationName, order: order.indexOf(implementationName) + 1, ...measured });
    } finally {
      if (operation === "activate") await cleanupPerformanceFixture(sampleFixture);
    }
  }
  if (beforeFingerprint !== null && fixtureFingerprint(fixture.root) !== beforeFingerprint) {
    throw new Error(`fixture state changed during ${scenarioId}/${operation}`);
  }
  return samples;
}

async function measureOperation({ scenarioId, operation, implementations, warmups, repetitions, timeoutMs }) {
  if (!OPERATIONS.has(operation)) throw new Error(`unknown benchmark operation: ${operation}`);
  let fixture = null;
  try {
    if (operation !== "activate") fixture = await setupSharedFixture(scenarioId, operation, implementations.reference, timeoutMs);
    const samples = [];
    const phases = [
      { phase: "first", count: 1 },
      { phase: "warmup", count: warmups },
      { phase: "measured", count: repetitions },
    ];
    let orderIndex = 0;
    for (const { phase, count } of phases) {
      for (let iteration = 0; iteration < count; iteration += 1) {
        const order = orderIndex % 2 === 0 ? ["reference", "candidate"] : ["candidate", "reference"];
        samples.push(...await samplePair({ scenarioId, operation, phase, iteration, order, implementations, fixture, timeoutMs }));
        orderIndex += 1;
      }
    }
    return { operation, warmups, repetitions, samples, statistics: summarizeOperation(samples) };
  } finally {
    if (fixture) await cleanupPerformanceFixture(fixture);
  }
}

function gitVersion() {
  return runGit(["--version"]).replace(/^git version\s+/, "");
}

function fixtureFingerprint(root) {
  return sha256(runGit(["status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "."], {
    cwd: root,
    encoding: null,
  }));
}

function hostMetadata(reference, candidate) {
  const cpus = os.cpus();
  return {
    timestamp: new Date().toISOString(),
    harness_version: HARNESS_VERSION,
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    cpu: { model: cpus[0]?.model ?? null, logical_cores: cpus.length },
    total_memory_bytes: os.totalmem(),
    filesystem_type: null,
    power_mode: null,
    antivirus_or_indexing_exclusion: null,
    node_version: process.version,
    git_version: gitVersion(),
    reference_commit: reference.metadata.commit,
    candidate_commit: candidate.metadata.commit,
  };
}

async function runBenchmark({
  scenarios = ["S-clean"],
  operations = ["status"],
  referenceSource = `commit:${REFERENCE_COMMIT}`,
  candidateSource = "worktree",
  warmups,
  repetitions,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  equivalence = true,
  diagnostics = true,
  includeFailureEquivalence = true,
} = {}) {
  for (const scenarioId of scenarios) if (!PERFORMANCE_SCENARIOS[scenarioId]) throw new Error(`unknown performance scenario: ${scenarioId}`);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeout must be a positive integer");
  for (const [name, value] of [["warmups", warmups], ["repetitions", repetitions]]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (name === "repetitions" ? 1 : 0))) {
      throw new Error(`${name} override is invalid`);
    }
  }

  const reference = await materializeImplementation(referenceSource, { label: "reference" });
  let candidate = null;
  try {
    candidate = await materializeImplementation(candidateSource, { label: "candidate" });
    const result = {
      schema: RESULT_SCHEMA,
      session: {
        scenarios: [...scenarios],
        operations: [...operations],
        timeout_ms: timeoutMs,
        sample_overrides: { warmups: warmups ?? null, repetitions: repetitions ?? null },
      },
      host: hostMetadata(reference, candidate),
      reference: reference.metadata,
      candidate: candidate.metadata,
      scenarios: [],
      equivalence: { status: "not_run" },
      diagnostics: [],
      gate: { result: "pending", reasons: [] },
    };
    if (equivalence) {
      result.equivalence = await runEquivalenceSuite({
        scenarios,
        operations,
        reference,
        candidate,
        execute: runChildSample,
        invoke: operationInvocation,
        timeoutMs,
        includeFailures: includeFailureEquivalence,
      });
      if (result.equivalence.status !== "pass") {
        result.gate = { result: "fail", reasons: ["reference and candidate are not behaviorally equivalent"] };
        return result;
      }
    }
    for (const scenarioId of scenarios) {
      const definition = PERFORMANCE_SCENARIOS[scenarioId];
      const counts = SAMPLE_COUNTS[definition.tier];
      const scenario = { scenario_id: scenarioId, tier: definition.tier, operations: [] };
      for (const operation of operations) {
        scenario.operations.push(await measureOperation({
          scenarioId,
          operation,
          implementations: { reference, candidate },
          warmups: warmups ?? counts.warmups,
          repetitions: repetitions ?? counts.repetitions,
          timeoutMs,
        }));
      }
      result.scenarios.push(scenario);
    }
    if (diagnostics) {
      for (const scenarioId of scenarios) {
        for (const operation of operations) {
          result.diagnostics.push(await runDiagnosticPass({
            scenarioId,
            operation,
            implementation: candidate,
            execute: runChildSample,
            invoke: operationInvocation,
            timeoutMs,
          }));
        }
      }
    }
    const invalid = result.scenarios.flatMap((scenario) => scenario.operations)
      .flatMap((operation) => operation.samples)
      .filter((sample) => !sample.valid);
    const diagnosticFailures = result.diagnostics.filter((item) => !item.structurally_equivalent || !item.metrics_valid);
    const reasons = [
      ...(invalid.length ? [`${invalid.length} timeout or invalid child-process sample(s)`] : []),
      ...(diagnosticFailures.length ? [`${diagnosticFailures.length} diagnostic pass(es) failed structural or metric validation`] : []),
    ];
    result.gate = reasons.length ? { result: "fail", reasons } : { result: "pass", reasons: [] };
    return result;
  } finally {
    await cleanupBenchmarkTempDirectory(reference.root).catch(() => {});
    if (candidate) await cleanupBenchmarkTempDirectory(candidate.root).catch(() => {});
  }
}

async function writeResult(result, outputPath) {
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(serialized);
    return null;
  }
  const target = path.resolve(outputPath);
  const parent = await realpath(path.dirname(target));
  if (!(await stat(parent)).isDirectory()) throw new Error("result parent is not a directory");
  await writeFile(path.join(parent, path.basename(target)), serialized, { encoding: "utf8", flag: "wx" });
  return target;
}

function parseArgs(args) {
  const options = { scenarios: [], operations: [] };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (["--scenario", "--operation", "--reference", "--candidate", "--output", "--warmups", "--repetitions", "--timeout-ms"].includes(flag)) {
      if (value === undefined) throw new Error(`${flag} requires a value`);
      index += 1;
    } else throw new Error(`unknown benchmark option: ${flag}`);
    if (flag === "--scenario") options.scenarios.push(value);
    if (flag === "--operation") options.operations.push(value);
    if (flag === "--reference") options.referenceSource = value;
    if (flag === "--candidate") options.candidateSource = value;
    if (flag === "--output") options.output = value;
    if (flag === "--warmups") options.warmups = Number(value);
    if (flag === "--repetitions") options.repetitions = Number(value);
    if (flag === "--timeout-ms") options.timeoutMs = Number(value);
  }
  if (options.scenarios.length === 0) options.scenarios = ["S-clean"];
  if (options.operations.length === 0) options.operations = ["status"];
  return options;
}

export {
  DEFAULT_TIMEOUT_MS,
  HARNESS_VERSION,
  OPERATIONS,
  REFERENCE_COMMIT,
  RESULT_SCHEMA,
  SAMPLE_COUNTS,
  materializeImplementation,
  nearestRank,
  operationInvocation,
  parseArgs,
  activationInput,
  runBenchmark,
  runChildSample,
  summarizeOperation,
  summarizeSamples,
  writeResult,
};

async function main() {
  let output = null;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    output = parsed.output ?? null;
    const { output: ignoredOutput, ...options } = parsed;
    void ignoredOutput;
    const result = await runBenchmark(options);
    await writeResult(result, output);
    if (result.gate.result !== "pass") process.exitCode = 1;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    const failure = {
      schema: RESULT_SCHEMA,
      session: null,
      host: null,
      reference: null,
      candidate: null,
      scenarios: [],
      equivalence: { status: "not_run" },
      diagnostics: [],
      gate: { result: "fail", reasons: [message] },
    };
    try {
      await writeResult(failure, output);
    } catch {
      process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    }
    process.stderr.write("ScopeLock performance harness failed. See the JSON gate reasons.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
