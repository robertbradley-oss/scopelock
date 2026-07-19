import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  advancePerformanceFixture,
  cleanupBenchmarkTempDirectory,
  cleanupPerformanceFixture,
  createBenchmarkTempDirectory,
  createPerformanceFixture,
} from "./fixtures.mjs";

const LOCK_ID_PATTERN = /\d{4}-\d{2}-\d{2}T\d{6}Z(?:-\d{2})?/g;
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;
const REQUIRED_DIAGNOSTIC_KEYS = [
  "node_child_process_count",
  "git_child_process_count",
  "git_stdout_bytes",
  "repository_captures_attempted",
  "repository_captures_retried",
  "observations_parsed",
  "boundary_filesystem_checks",
  "files_hashed",
  "bytes_hashed",
  "comparison_result",
  "limitation_count",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceAllLiteral(value, search, replacement) {
  return search ? value.split(search).join(replacement) : value;
}

function normalizeString(value, { roots = [], activation = false } = {}) {
  let normalized = value;
  for (const root of roots) {
    normalized = replaceAllLiteral(normalized, root, "<fixture-root>");
    normalized = replaceAllLiteral(normalized, root.replaceAll("\\", "/"), "<fixture-root>");
  }
  if (activation) {
    normalized = normalized.replace(LOCK_ID_PATTERN, "<lock-id>");
    normalized = normalized.replace(TIMESTAMP_PATTERN, "<timestamp>");
  }
  return normalized;
}

function normalizeValue(value, options = {}, key = null) {
  if (typeof value === "string") return normalizeString(value, options);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, options));
  if (!value || typeof value !== "object") return value;
  const normalized = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === "duration_ms") normalized[childKey] = "<duration-ms>";
    else if (childKey === "pid" || childKey === "process_id") normalized[childKey] = "<process-id>";
    else normalized[childKey] = normalizeValue(child, options, childKey);
  }
  void key;
  return normalized;
}

function differencePaths(left, right, current = "$", output = []) {
  if (output.length >= 25) return output;
  if (Object.is(left, right)) return output;
  if (typeof left !== typeof right || left === null || right === null) {
    output.push(current);
    return output;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) output.push(`${current}.length`);
    const count = Math.min(left?.length ?? 0, right?.length ?? 0);
    for (let index = 0; index < count; index += 1) differencePaths(left[index], right[index], `${current}[${index}]`, output);
    return output;
  }
  if (typeof left === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const childKey of keys) {
      if (!(childKey in left) || !(childKey in right)) output.push(`${current}.${childKey}`);
      else differencePaths(left[childKey], right[childKey], `${current}.${childKey}`, output);
      if (output.length >= 25) break;
    }
    return output;
  }
  output.push(current);
  return output;
}

function compareExecutions(reference, candidate, { roots = [], activation = false } = {}) {
  const referenceComparable = {
    exit_status: reference.exit_status,
    timed_out: reference.timed_out,
    stdout_object_count: reference.stdout_object_count,
    output: normalizeValue(reference.parsed_output, { roots, activation }),
  };
  const candidateComparable = {
    exit_status: candidate.exit_status,
    timed_out: candidate.timed_out,
    stdout_object_count: candidate.stdout_object_count,
    output: normalizeValue(candidate.parsed_output, { roots, activation }),
  };
  const differences = differencePaths(referenceComparable, candidateComparable);
  return { equivalent: differences.length === 0, differences, reference: referenceComparable, candidate: candidateComparable };
}

async function cloneFixture(root, label) {
  const container = await createBenchmarkTempDirectory(label);
  const cloneRoot = path.join(container, "fixture");
  try {
    await cp(root, cloneRoot, { recursive: true, force: false, errorOnExist: true });
    const metadata = await lstat(cloneRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("fixture clone is not a safe directory");
    return { container, root: cloneRoot };
  } catch (error) {
    await cleanupBenchmarkTempDirectory(container).catch(() => {});
    throw error;
  }
}

async function walkFiles(root, relative = "", { exclude = new Set() } = {}) {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!relative && exclude.has(entry.name)) continue;
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const child = path.join(root, ...childRelative.split("/"));
    if (entry.isSymbolicLink()) throw new Error(`snapshot refuses symbolic link: ${childRelative}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, childRelative, { exclude }));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

async function walkEntries(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`snapshot refuses symbolic link: ${childRelative}`);
    if (entry.isDirectory()) {
      output.push({ path: childRelative, kind: "directory" });
      output.push(...await walkEntries(root, childRelative));
    } else if (entry.isFile()) output.push({ path: childRelative, kind: "file" });
  }
  return output;
}

async function treeDigest(root, { exclude = new Set() } = {}) {
  try {
    if (!(await stat(root)).isDirectory()) return null;
  } catch {
    return null;
  }
  const hash = createHash("sha256");
  for (const relative of await walkFiles(root, "", { exclude })) {
    hash.update(relative);
    hash.update(await readFile(path.join(root, ...relative.split("/"))));
  }
  return hash.digest("hex");
}

async function mutationSnapshot(root) {
  return {
    source: await treeDigest(root, { exclude: new Set([".git", ".codex-scope"]) }),
    storage: await treeDigest(path.join(root, ".codex-scope")),
  };
}

async function readActivationStorage(root) {
  const storageRoot = path.join(root, ".codex-scope");
  const entries = await walkEntries(storageRoot);
  const records = [];
  let normalizedContract = null;
  let normalizedBaseline = null;
  for (const entry of entries) {
    const relative = entry.path;
    const canonicalPath = normalizeString(relative, { activation: true });
    if (entry.kind === "directory") {
      records.push({ path: canonicalPath, kind: "directory" });
      continue;
    }
    const source = await readFile(path.join(storageRoot, ...relative.split("/")), "utf8");
    let content;
    if (relative.endsWith(".json")) content = normalizeValue(JSON.parse(source), { activation: true });
    else content = normalizeString(source, { activation: true });
    if (canonicalPath.endsWith("/contract.md")) normalizedContract = content;
    if (canonicalPath.endsWith("/baseline.json")) normalizedBaseline = content;
    records.push({ path: canonicalPath, kind: "file", content });
  }
  const active = records.find((record) => record.path === "active.json");
  if (active?.content && normalizedContract !== null && normalizedBaseline !== null) {
    active.content.contract_sha256 = sha256(normalizedContract);
    active.content.baseline_sha256 = sha256(`${JSON.stringify(normalizedBaseline, null, 2)}\n`);
  }
  return records;
}

async function setupActiveFixture(scenarioId, reference, execute, invoke) {
  const fixture = await createPerformanceFixture(scenarioId, { stage: "activation" });
  try {
    const setup = await execute({ ...invoke("activate", reference, fixture.root), retainParsed: true });
    if (!setup.valid) throw new Error(`reference activation failed for equivalence scenario ${scenarioId}`);
    return await advancePerformanceFixture(fixture);
  } catch (error) {
    await cleanupPerformanceFixture(fixture).catch(() => {});
    throw error;
  }
}

async function compareOperation({ scenarioId, operation, reference, candidate, execute, invoke, timeoutMs }) {
  const noStorage = operation === "status-no-storage" || operation === "session-no-lock";
  const fixture = noStorage
    ? await createPerformanceFixture(scenarioId, { stage: "measurement" })
    : await setupActiveFixture(scenarioId, reference, execute, invoke);
  let referenceClone;
  let candidateClone;
  try {
    referenceClone = await cloneFixture(fixture.root, "equivalence-reference");
    candidateClone = await cloneFixture(fixture.root, "equivalence-candidate");
    const referenceResult = await execute({
      ...invoke(operation, reference, referenceClone.root),
      retainParsed: true,
      timeoutMs,
    });
    const candidateResult = await execute({
      ...invoke(operation, candidate, candidateClone.root),
      retainParsed: true,
      timeoutMs,
    });
    const comparison = compareExecutions(referenceResult, candidateResult, {
      roots: [referenceClone.root, candidateClone.root],
    });
    return {
      scenario_id: scenarioId,
      operation,
      equivalent: comparison.equivalent,
      differences: comparison.differences,
      reference_exit_status: referenceResult.exit_status,
      candidate_exit_status: candidateResult.exit_status,
    };
  } finally {
    if (referenceClone) await cleanupBenchmarkTempDirectory(referenceClone.container).catch(() => {});
    if (candidateClone) await cleanupBenchmarkTempDirectory(candidateClone.container).catch(() => {});
    await cleanupPerformanceFixture(fixture).catch(() => {});
  }
}

async function compareActivation({ scenarioId, reference, candidate, execute, invoke, timeoutMs }) {
  let referenceFixture = null;
  let candidateFixture = null;
  try {
    referenceFixture = await createPerformanceFixture(scenarioId, { stage: "activation" });
    candidateFixture = await createPerformanceFixture(scenarioId, { stage: "activation" });
    const referenceResult = await execute({
      ...invoke("activate", reference, referenceFixture.root), retainParsed: true, timeoutMs,
    });
    const candidateResult = await execute({
      ...invoke("activate", candidate, candidateFixture.root), retainParsed: true, timeoutMs,
    });
    const execution = compareExecutions(referenceResult, candidateResult, {
      roots: [referenceFixture.root, candidateFixture.root], activation: true,
    });
    const referenceStorage = await readActivationStorage(referenceFixture.root);
    const candidateStorage = await readActivationStorage(candidateFixture.root);
    const storageDifferences = differencePaths(referenceStorage, candidateStorage, "$.storage");
    return {
      scenario_id: scenarioId,
      operation: "activate",
      equivalent: execution.equivalent && storageDifferences.length === 0,
      differences: [...execution.differences, ...storageDifferences].slice(0, 25),
      reference_exit_status: referenceResult.exit_status,
      candidate_exit_status: candidateResult.exit_status,
      storage_equivalent: storageDifferences.length === 0,
    };
  } finally {
    if (referenceFixture) await cleanupPerformanceFixture(referenceFixture).catch(() => {});
    if (candidateFixture) await cleanupPerformanceFixture(candidateFixture).catch(() => {});
  }
}

function runGit(root, args) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: "2000-01-02T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-02T00:00:00Z",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of Object.keys(env)) {
    if (["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"].includes(key.toUpperCase())) {
      delete env[key];
    }
  }
  const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`failure fixture Git setup failed: ${String(result.stderr || result.error?.message).trim()}`);
}

async function compareFailureCase({ name, reference, candidate, execute, invoke, prepare, operation = "status", timeoutMs = 10_000 }) {
  const base = name === "unsupported"
    ? { root: await createBenchmarkTempDirectory("failure-unsupported"), cleanup: async function cleanup() { await cleanupBenchmarkTempDirectory(this.root); } }
    : await setupActiveFixture("S-clean", reference, execute, invoke);
  let referenceClone;
  let candidateClone;
  try {
    referenceClone = await cloneFixture(base.root, `failure-${name}-reference`);
    candidateClone = await cloneFixture(base.root, `failure-${name}-candidate`);
    await prepare?.(referenceClone.root);
    await prepare?.(candidateClone.root);
    const referenceBefore = await mutationSnapshot(referenceClone.root);
    const candidateBefore = await mutationSnapshot(candidateClone.root);
    const referenceResult = await execute({ ...invoke(operation, reference, referenceClone.root), retainParsed: true, timeoutMs });
    const candidateResult = await execute({ ...invoke(operation, candidate, candidateClone.root), retainParsed: true, timeoutMs });
    const referenceAfter = await mutationSnapshot(referenceClone.root);
    const candidateAfter = await mutationSnapshot(candidateClone.root);
    const execution = compareExecutions(referenceResult, candidateResult, { roots: [referenceClone.root, candidateClone.root] });
    const referenceMutation = {
      source_changed: referenceBefore.source !== referenceAfter.source,
      storage_changed: referenceBefore.storage !== referenceAfter.storage,
    };
    const candidateMutation = {
      source_changed: candidateBefore.source !== candidateAfter.source,
      storage_changed: candidateBefore.storage !== candidateAfter.storage,
    };
    const mutationDifferences = differencePaths(referenceMutation, candidateMutation, "$.mutation");
    return {
      case: name,
      equivalent: execution.equivalent && mutationDifferences.length === 0,
      differences: [...execution.differences, ...mutationDifferences].slice(0, 25),
      reference: { ...execution.reference, mutation: referenceMutation },
      candidate: { ...execution.candidate, mutation: candidateMutation },
    };
  } finally {
    if (referenceClone) await cleanupBenchmarkTempDirectory(referenceClone.container).catch(() => {});
    if (candidateClone) await cleanupBenchmarkTempDirectory(candidateClone.container).catch(() => {});
    if (name === "unsupported") await cleanupBenchmarkTempDirectory(base.root).catch(() => {});
    else await cleanupPerformanceFixture(base).catch(() => {});
  }
}

async function runFailureEquivalenceSuite(options) {
  const cases = [];
  cases.push(await compareFailureCase({
    ...options,
    name: "corrupt",
    prepare: async (root) => {
      const active = JSON.parse(await readFile(path.join(root, ".codex-scope", "active.json"), "utf8"));
      await writeFile(path.join(root, ".codex-scope", active.lock_path, "baseline.json"), "{}\n", "utf8");
    },
  }));
  cases.push(await compareFailureCase({
    ...options,
    name: "hostile",
    prepare: async (root) => runGit(root, ["config", "filter.scopelock-benchmark.clean", "node hostile-filter.mjs"]),
  }));
  cases.push(await compareFailureCase({
    ...options,
    name: "stale",
    prepare: async (root) => {
      runGit(root, ["checkout", "--orphan", "divergent"]);
      runGit(root, ["commit", "-m", "divergent history"]);
    },
  }));
  cases.push(await compareFailureCase({
    ...options,
    name: "unsupported",
    operation: "activate",
    prepare: async () => {},
  }));
  cases.push(await compareFailureCase({
    ...options,
    name: "timeout",
    timeoutMs: 1,
    prepare: async () => {},
  }));
  return cases;
}

function replaceExactly(source, anchor, replacement, label) {
  const pieces = source.split(anchor);
  if (pieces.length !== 2) throw new Error(`diagnostic instrumentation anchor mismatch: ${label}`);
  return `${pieces[0]}${replacement}${pieces[1]}`;
}

function instrumentHelperSource(source) {
  let output = source;
  const diagnosticsBlock = `const BENCHMARK_DIAGNOSTICS_PATH = process.env.SCOPELOCK_BENCH_DIAGNOSTICS_PATH ?? null;
const BENCHMARK_DIAGNOSTICS = {
  node_child_process_count: 1,
  git_child_process_count: 0,
  git_stdout_bytes: 0,
  repository_captures_attempted: 0,
  repository_captures_retried: 0,
  observations_parsed: 0,
  boundary_filesystem_checks: 0,
  files_hashed: 0,
  bytes_hashed: 0,
  comparison_result: null,
  limitation_count: 0,
};

async function writeBenchmarkDiagnostics(response) {
  if (!BENCHMARK_DIAGNOSTICS_PATH) return;
  BENCHMARK_DIAGNOSTICS.comparison_result = response?.result ?? response?.health ?? response?.error?.code ?? null;
  BENCHMARK_DIAGNOSTICS.limitation_count = Array.isArray(response?.limitations)
    ? response.limitations.length
    : Array.isArray(response?.baseline?.limitations) ? response.baseline.limitations.length : 0;
  let previous = null;
  try { previous = JSON.parse(await readFile(BENCHMARK_DIAGNOSTICS_PATH, "utf8")); } catch {}
  if (previous) {
    for (const key of Object.keys(BENCHMARK_DIAGNOSTICS)) {
      if (typeof BENCHMARK_DIAGNOSTICS[key] === "number") BENCHMARK_DIAGNOSTICS[key] += Number(previous[key] ?? 0);
    }
  }
  await writeFile(BENCHMARK_DIAGNOSTICS_PATH, \`${"${JSON.stringify(BENCHMARK_DIAGNOSTICS)}"}\\n\`, "utf8");
}

`;
  output = replaceExactly(output, "class ScopeLockError extends Error {", `${diagnosticsBlock}class ScopeLockError extends Error {`, "diagnostic-state");
  output = replaceExactly(
    output,
    "function runGit(projectRoot, args, { allowFailure = false } = {}) {\n  const result = spawnSync",
    "function runGit(projectRoot, args, { allowFailure = false } = {}) {\n  BENCHMARK_DIAGNOSTICS.git_child_process_count += 1;\n  const result = spawnSync",
    "git-count",
  );
  output = replaceExactly(
    output,
    "  if (result.error) {\n    if (allowFailure) return { ok: false, status: null, stdout: Buffer.alloc(0) };",
    "  BENCHMARK_DIAGNOSTICS.git_stdout_bytes += result.stdout?.length ?? 0;\n  if (result.error) {\n    if (allowFailure) return { ok: false, status: null, stdout: Buffer.alloc(0) };",
    "git-bytes",
  );
  output = replaceExactly(
    output,
    "async function hashTrackedFile(projectRoot, projectPath) {",
    "async function hashTrackedFile(projectRoot, projectPath) {",
    "hash-function",
  );
  output = replaceExactly(
    output,
    "    return hash.digest(\"hex\");\n  } catch {",
    "    const digest = hash.digest(\"hex\");\n    BENCHMARK_DIAGNOSTICS.files_hashed += 1;\n    BENCHMARK_DIAGNOSTICS.bytes_hashed += metadata.size;\n    return digest;\n  } catch {",
    "hash-metrics",
  );
  output = replaceExactly(
    output,
    "async function detectRepositoryBoundaries(projectRoot, observations) {\n  const limitations = [];\n  for (const observation of observations) {",
    "async function detectRepositoryBoundaries(projectRoot, observations) {\n  const limitations = [];\n  for (const observation of observations) {\n    BENCHMARK_DIAGNOSTICS.boundary_filesystem_checks += 1;",
    "boundary-checks",
  );
  output = replaceExactly(
    output,
    "async function captureOnce(projectRoot, fingerprintPaths = new Set(), { checkFilters = false } = {}) {\n  const repository = await getRepositoryInfo(projectRoot);",
    "async function captureOnce(projectRoot, fingerprintPaths = new Set(), { checkFilters = false } = {}) {\n  BENCHMARK_DIAGNOSTICS.repository_captures_attempted += 1;\n  const repository = await getRepositoryInfo(projectRoot);",
    "capture-attempts",
  );
  output = replaceExactly(
    output,
    "  const parsed = parsePorcelainV2(statusBuffer, repository);\n  const indexBuffer",
    "  const parsed = parsePorcelainV2(statusBuffer, repository);\n  BENCHMARK_DIAGNOSTICS.observations_parsed += parsed.observations.length;\n  const indexBuffer",
    "observations",
  );
  output = replaceExactly(
    output,
    "  if (check.capture_token === capture.capture_token) return { ...capture, concurrent: false, retried: false };\n\n  capture = await captureOnce",
    "  if (check.capture_token === capture.capture_token) return { ...capture, concurrent: false, retried: false };\n\n  BENCHMARK_DIAGNOSTICS.repository_captures_retried += 1;\n  capture = await captureOnce",
    "capture-retries",
  );
  output = replaceExactly(
    output,
    "    const child = spawn(command, {",
    "    BENCHMARK_DIAGNOSTICS.node_child_process_count += 1;\n    const child = spawn(command, {",
    "node-children",
  );
  output = replaceExactly(
    output,
    "    const response = await dispatch(command, options);\n    process.stdout.write(`${JSON.stringify(response)}\\n`);",
    "    const response = await dispatch(command, options);\n    await writeBenchmarkDiagnostics(response);\n    process.stdout.write(`${JSON.stringify(response)}\\n`);",
    "success-write",
  );
  output = replaceExactly(
    output,
    "    process.stdout.write(`${JSON.stringify({ schema: \"scopelock/error/v1\", error: { code: safe.code, message: safe.message, ...(safe.details ? { details: safe.details } : {}) } })}\\n`);",
    "    const response = { schema: \"scopelock/error/v1\", error: { code: safe.code, message: safe.message, ...(safe.details ? { details: safe.details } : {}) } };\n    await writeBenchmarkDiagnostics(response);\n    process.stdout.write(`${JSON.stringify(response)}\\n`);",
    "error-write",
  );
  return output;
}

async function createInstrumentedImplementation(implementation) {
  const root = await createBenchmarkTempDirectory("diagnostic-copy");
  try {
    const source = await readFile(implementation.helperPath, "utf8");
    const hook = await readFile(implementation.hookPath);
    const instrumented = instrumentHelperSource(source);
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "scopelock.mjs"), instrumented, "utf8");
    await writeFile(path.join(root, "scripts", "scopelock-hook.mjs"), hook);
    return {
      root,
      helperPath: path.join(root, "scripts", "scopelock.mjs"),
      hookPath: path.join(root, "scripts", "scopelock-hook.mjs"),
      metadata: { ...implementation.metadata, diagnostic_copy: true, source_sha256: sha256(source), instrumented_sha256: sha256(instrumented) },
    };
  } catch (error) {
    await cleanupBenchmarkTempDirectory(root).catch(() => {});
    throw error;
  }
}

async function diagnosticResult({ scenarioId, operation, comparison, diagnosticPath }) {
  const metrics = JSON.parse(await readFile(diagnosticPath, "utf8"));
  if (!["activate", "status", "status-no-storage"].includes(operation)) {
    metrics.node_child_process_count += 1;
  }
  const missing = REQUIRED_DIAGNOSTIC_KEYS.filter((key) => !(key in metrics));
  const validMetrics = missing.length === 0
    && typeof metrics.comparison_result === "string"
    && REQUIRED_DIAGNOSTIC_KEYS.filter((key) => key !== "comparison_result")
      .every((key) => Number.isSafeInteger(metrics[key]) && metrics[key] >= 0);
  return {
    scenario_id: scenarioId,
    operation,
    structurally_equivalent: comparison.equivalent,
    differences: comparison.differences,
    metrics_valid: validMetrics,
    missing_metrics: missing,
    metrics,
    used_for_latency_acceptance: false,
  };
}

async function runDiagnosticPass({ scenarioId, operation, implementation, execute, invoke, timeoutMs }) {
  const instrumented = await createInstrumentedImplementation(implementation);
  const diagnosticPath = path.join(instrumented.root, "diagnostics.json");
  if (operation === "activate") {
    let unmodifiedFixture = null;
    let diagnosticFixture = null;
    try {
      unmodifiedFixture = await createPerformanceFixture(scenarioId, { stage: "activation" });
      diagnosticFixture = await createPerformanceFixture(scenarioId, { stage: "activation" });
      const unmodified = await execute({
        ...invoke(operation, implementation, unmodifiedFixture.root), retainParsed: true, timeoutMs,
      });
      const diagnostic = await execute({
        ...invoke(operation, instrumented, diagnosticFixture.root),
        retainParsed: true,
        timeoutMs,
        env: { SCOPELOCK_BENCH_DIAGNOSTICS_PATH: diagnosticPath },
      });
      const execution = compareExecutions(unmodified, diagnostic, {
        roots: [unmodifiedFixture.root, diagnosticFixture.root], activation: true,
      });
      const storageDifferences = differencePaths(
        await readActivationStorage(unmodifiedFixture.root),
        await readActivationStorage(diagnosticFixture.root),
        "$.storage",
      );
      return await diagnosticResult({
        scenarioId,
        operation,
        diagnosticPath,
        comparison: {
          equivalent: execution.equivalent && storageDifferences.length === 0,
          differences: [...execution.differences, ...storageDifferences].slice(0, 25),
        },
      });
    } finally {
      if (unmodifiedFixture) await cleanupPerformanceFixture(unmodifiedFixture).catch(() => {});
      if (diagnosticFixture) await cleanupPerformanceFixture(diagnosticFixture).catch(() => {});
      await cleanupBenchmarkTempDirectory(instrumented.root).catch(() => {});
    }
  }
  let fixture = null;
  let unmodifiedClone;
  let diagnosticClone;
  try {
    fixture = operation === "status-no-storage" || operation === "session-no-lock"
      ? await createPerformanceFixture(scenarioId, { stage: "measurement" })
      : await setupActiveFixture(scenarioId, implementation, execute, invoke);
    unmodifiedClone = await cloneFixture(fixture.root, "diagnostic-unmodified");
    diagnosticClone = await cloneFixture(fixture.root, "diagnostic-instrumented");
    const unmodified = await execute({
      ...invoke(operation, implementation, unmodifiedClone.root), retainParsed: true, timeoutMs,
    });
    const diagnostic = await execute({
      ...invoke(operation, instrumented, diagnosticClone.root),
      retainParsed: true,
      timeoutMs,
      env: { SCOPELOCK_BENCH_DIAGNOSTICS_PATH: diagnosticPath },
    });
    const comparison = compareExecutions(unmodified, diagnostic, {
      roots: [unmodifiedClone.root, diagnosticClone.root],
    });
    return await diagnosticResult({ scenarioId, operation, comparison, diagnosticPath });
  } finally {
    if (unmodifiedClone) await cleanupBenchmarkTempDirectory(unmodifiedClone.container).catch(() => {});
    if (diagnosticClone) await cleanupBenchmarkTempDirectory(diagnosticClone.container).catch(() => {});
    if (fixture) await cleanupPerformanceFixture(fixture).catch(() => {});
    await cleanupBenchmarkTempDirectory(instrumented.root).catch(() => {});
  }
}

async function runEquivalenceSuite({ scenarios, operations, reference, candidate, execute, invoke, timeoutMs, includeFailures = true }) {
  const comparisons = [];
  for (const scenarioId of scenarios) {
    for (const operation of operations) {
      comparisons.push(operation === "activate"
        ? await compareActivation({ scenarioId, reference, candidate, execute, invoke, timeoutMs })
        : await compareOperation({ scenarioId, operation, reference, candidate, execute, invoke, timeoutMs }));
    }
  }
  const failures = includeFailures
    ? await runFailureEquivalenceSuite({ reference, candidate, execute, invoke })
    : [];
  const all = [...comparisons, ...failures];
  return {
    status: all.every((item) => item.equivalent) ? "pass" : "fail",
    comparison_count: all.length,
    equivalent_count: all.filter((item) => item.equivalent).length,
    comparisons,
    failure_behavior: failures,
  };
}

export {
  REQUIRED_DIAGNOSTIC_KEYS,
  compareActivation,
  compareExecutions,
  compareOperation,
  createInstrumentedImplementation,
  differencePaths,
  instrumentHelperSource,
  normalizeValue,
  runDiagnosticPass,
  runEquivalenceSuite,
  runFailureEquivalenceSuite,
};
