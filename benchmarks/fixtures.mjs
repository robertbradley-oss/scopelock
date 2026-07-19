import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MIB = 1024 * 1024;
const DEFAULT_SEED = "scopelock-performance-v1";
const FIXTURE_PREFIX = "scopelock-bench-";
const MANIFEST_SUFFIX = ".manifest.json";
const WRITE_CONCURRENCY = 24;
const FIXTURE_COMMIT_DATE = "2000-01-01T00:00:00Z";

const BLOCKED_GIT_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_SYSTEM",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "GIT_NAMESPACE",
  "GIT_REPLACE_REF_BASE",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
]);

const SAFE_GIT_PREFIX = [
  "--no-pager",
  "--no-optional-locks",
  "--no-lazy-fetch",
  "--no-replace-objects",
  "-c", "core.hooksPath=",
  "-c", "core.fsmonitor=false",
  "-c", "commit.gpgSign=false",
  "-c", "tag.gpgSign=false",
];

const RAW_SCENARIOS = {
  "S-clean": {
    tier: "small",
    tracked_paths: 100,
    outside_tracked_paths: 0,
    activation: {},
    measurement: {},
    expected_findings: {},
  },
  "M-clean": {
    tier: "medium",
    tracked_paths: 1200,
    outside_tracked_paths: 0,
    activation: {},
    measurement: {},
    expected_findings: {},
  },
  "M-mixed": {
    tier: "medium",
    tracked_paths: 1200,
    outside_tracked_paths: 0,
    activation: {},
    measurement: { modified_allowed: 25, untracked_allowed: 200 },
    expected_findings: { in_scope: 225 },
  },
  "M-preexisting": {
    tier: "medium",
    tracked_paths: 1200,
    outside_tracked_paths: 0,
    activation: { modified_allowed: 25 },
    measurement: { modified_preexisting_allowed: 25, untracked_allowed: 200 },
    expected_findings: { in_scope: 225 },
  },
  "M-outside": {
    tier: "medium",
    tracked_paths: 1200,
    outside_tracked_paths: 25,
    activation: {},
    measurement: { modified_allowed: 25, modified_outside: 25 },
    expected_findings: { in_scope: 25, out_of_scope: 25 },
  },
  "L-clean": {
    tier: "large",
    tracked_paths: 10000,
    outside_tracked_paths: 0,
    activation: {},
    measurement: {},
    expected_findings: {},
  },
  "L-mixed": {
    tier: "large",
    tracked_paths: 10000,
    outside_tracked_paths: 0,
    activation: {},
    measurement: { modified_allowed: 100, untracked_allowed: 1000 },
    expected_findings: { in_scope: 1100 },
  },
  "L-untracked-heavy": {
    tier: "large",
    tracked_paths: 10000,
    outside_tracked_paths: 0,
    activation: {},
    measurement: { untracked_allowed: 5000 },
    expected_findings: { in_scope: 5000 },
  },
  "L-hash-heavy": {
    tier: "large",
    tracked_paths: 10000,
    outside_tracked_paths: 0,
    large_tracked_paths: 16,
    large_file_bytes: 16 * MIB,
    activation: { modified_large: 16 },
    measurement: { modified_preexisting_large: 16 },
    expected_findings: { in_scope: 16 },
  },
  "XL-clean": {
    tier: "extra-large",
    tracked_paths: 50000,
    outside_tracked_paths: 0,
    activation: {},
    measurement: {},
    expected_findings: {},
  },
  "XL-mixed": {
    tier: "extra-large",
    tracked_paths: 50000,
    outside_tracked_paths: 0,
    activation: {},
    measurement: { modified_allowed: 250, untracked_allowed: 2000 },
    expected_findings: { in_scope: 2250 },
  },
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normalizedScenario(raw) {
  return {
    ...raw,
    large_tracked_paths: raw.large_tracked_paths ?? 0,
    large_file_bytes: raw.large_file_bytes ?? 0,
    activation: {
      modified_allowed: 0,
      modified_large: 0,
      ...raw.activation,
    },
    measurement: {
      modified_allowed: 0,
      modified_preexisting_allowed: 0,
      modified_outside: 0,
      modified_preexisting_large: 0,
      untracked_allowed: 0,
      untracked_outside: 0,
      ...raw.measurement,
    },
    expected_findings: {
      pre_existing: 0,
      in_scope: 0,
      out_of_scope: 0,
      approved_amendment: 0,
      late_approved: 0,
      uncertain: 0,
      ...raw.expected_findings,
    },
  };
}

const PERFORMANCE_SCENARIOS = deepFreeze(Object.fromEntries(
  Object.entries(RAW_SCENARIOS).map(([id, scenario]) => [id, normalizedScenario(scenario)]),
));

function assertInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function assertScenario(id, scenario) {
  assertInteger(scenario.tracked_paths, `${id}.tracked_paths`);
  assertInteger(scenario.outside_tracked_paths, `${id}.outside_tracked_paths`);
  assertInteger(scenario.large_tracked_paths, `${id}.large_tracked_paths`);
  assertInteger(scenario.large_file_bytes, `${id}.large_file_bytes`);
  if (scenario.tracked_paths === 0) throw new Error(`${id} must contain tracked paths`);
  if (scenario.outside_tracked_paths + scenario.large_tracked_paths > scenario.tracked_paths) {
    throw new Error(`${id} allocates more specialized paths than tracked paths`);
  }
  if ((scenario.large_tracked_paths === 0) !== (scenario.large_file_bytes === 0)) {
    throw new Error(`${id} must define both large path count and byte size`);
  }

  const ordinaryAllowed = scenario.tracked_paths - scenario.outside_tracked_paths - scenario.large_tracked_paths;
  for (const [name, value] of Object.entries({ ...scenario.activation, ...scenario.measurement, ...scenario.expected_findings })) {
    assertInteger(value, `${id}.${name}`);
  }
  if (scenario.activation.modified_allowed > ordinaryAllowed) throw new Error(`${id} modifies unavailable allowed paths at activation`);
  if (scenario.activation.modified_large > scenario.large_tracked_paths) throw new Error(`${id} modifies unavailable large paths at activation`);
  if (scenario.measurement.modified_allowed > ordinaryAllowed - scenario.activation.modified_allowed) {
    throw new Error(`${id} modifies unavailable clean allowed paths at measurement`);
  }
  if (scenario.measurement.modified_preexisting_allowed > scenario.activation.modified_allowed) {
    throw new Error(`${id} re-modifies more ordinary paths than were dirty at activation`);
  }
  if (scenario.measurement.modified_outside > scenario.outside_tracked_paths) throw new Error(`${id} modifies unavailable outside paths`);
  if (scenario.measurement.modified_preexisting_large > scenario.activation.modified_large) {
    throw new Error(`${id} re-modifies more large paths than were dirty at activation`);
  }
}

for (const [id, scenario] of Object.entries(PERFORMANCE_SCENARIOS)) assertScenario(id, scenario);

function scenarioDefinition(scenarioId) {
  const scenario = PERFORMANCE_SCENARIOS[scenarioId];
  if (!scenario) throw new Error(`unknown performance scenario: ${scenarioId}`);
  return structuredClone(scenario);
}

function validateSeed(seed) {
  if (typeof seed !== "string" || seed.length < 1 || seed.length > 120 || /[\u0000-\u001f\u007f]/.test(seed)) {
    throw new Error("fixture seed must be a printable string between 1 and 120 characters");
  }
  return seed;
}

function padded(index) {
  return String(index).padStart(6, "0");
}

function textSpec(projectPath, seed, revision) {
  const value = `${seed}:${projectPath}:r${revision}`;
  const content = projectPath.endsWith(".json")
    ? `${JSON.stringify({ fixture: value })}\n`
    : `export default ${JSON.stringify(value)};\n`;
  return { path: projectPath, kind: "text", content, bytes: Buffer.byteLength(content) };
}

function sparseSpec(projectPath, size, marker) {
  return { path: projectPath, kind: "sparse", size, marker, bytes: size };
}

function specRevision(spec, seed, revision) {
  if (spec.kind === "sparse") return sparseSpec(spec.path, spec.size, 65 + revision);
  return textSpec(spec.path, seed, revision);
}

function sumBytes(specs) {
  return specs.reduce((total, spec) => total + spec.bytes, 0);
}

function uniquePaths(specs) {
  return [...new Set(specs.map((spec) => spec.path))].sort();
}

function expectedState(activationWrites, measurementWrites, measurementUntracked) {
  const currentByPath = new Map();
  for (const spec of [...activationWrites, ...measurementWrites]) currentByPath.set(spec.path, spec);
  return {
    modified_tracked_paths: [...currentByPath.keys()].sort(),
    modified_tracked_count: currentByPath.size,
    modified_tracked_bytes: sumBytes([...currentByPath.values()]),
    untracked_paths: uniquePaths(measurementUntracked),
    untracked_path_count: measurementUntracked.length,
    untracked_bytes: sumBytes(measurementUntracked),
  };
}

function buildFixturePlan(scenarioId, { seed = DEFAULT_SEED } = {}) {
  const scenario = scenarioDefinition(scenarioId);
  const safeSeed = validateSeed(seed);
  const ordinaryAllowedCount = scenario.tracked_paths - scenario.outside_tracked_paths - scenario.large_tracked_paths;

  const allowed = Array.from({ length: ordinaryAllowedCount }, (_, index) => (
    textSpec(`src/allowed/file-${padded(index)}.js`, safeSeed, 0)
  ));
  const large = Array.from({ length: scenario.large_tracked_paths }, (_, index) => (
    sparseSpec(`src/allowed/large-${padded(index)}.bin`, scenario.large_file_bytes, 65)
  ));
  const outside = Array.from({ length: scenario.outside_tracked_paths }, (_, index) => (
    textSpec(`config/file-${padded(index)}.json`, safeSeed, 0)
  ));
  const baselineFiles = [...allowed, ...large, ...outside];

  const activationAllowed = allowed.slice(0, scenario.activation.modified_allowed);
  const activationLarge = large.slice(0, scenario.activation.modified_large);
  const activationWrites = [
    ...activationAllowed.map((spec) => specRevision(spec, safeSeed, 1)),
    ...activationLarge.map((spec) => specRevision(spec, safeSeed, 1)),
  ];

  const cleanAllowedStart = scenario.activation.modified_allowed;
  const measurementAllowed = allowed.slice(
    cleanAllowedStart,
    cleanAllowedStart + scenario.measurement.modified_allowed,
  );
  const measurementPreexistingAllowed = activationAllowed.slice(0, scenario.measurement.modified_preexisting_allowed);
  const measurementOutside = outside.slice(0, scenario.measurement.modified_outside);
  const measurementPreexistingLarge = activationLarge.slice(0, scenario.measurement.modified_preexisting_large);
  const measurementWrites = [
    ...measurementAllowed.map((spec) => specRevision(spec, safeSeed, 2)),
    ...measurementPreexistingAllowed.map((spec) => specRevision(spec, safeSeed, 2)),
    ...measurementOutside.map((spec) => specRevision(spec, safeSeed, 2)),
    ...measurementPreexistingLarge.map((spec) => specRevision(spec, safeSeed, 2)),
  ];

  const measurementUntracked = [
    ...Array.from({ length: scenario.measurement.untracked_allowed }, (_, index) => (
      textSpec(`src/allowed/generated-${padded(index)}.js`, safeSeed, 2)
    )),
    ...Array.from({ length: scenario.measurement.untracked_outside }, (_, index) => (
      textSpec(`config/generated-${padded(index)}.json`, safeSeed, 2)
    )),
  ];

  const activationState = expectedState(activationWrites, [], []);
  const measurementState = expectedState(activationWrites, measurementWrites, measurementUntracked);
  if (baselineFiles.length !== scenario.tracked_paths) throw new Error(`${scenarioId} produced the wrong tracked path count`);
  if (new Set(baselineFiles.map((spec) => spec.path)).size !== baselineFiles.length) throw new Error(`${scenarioId} produced duplicate tracked paths`);
  if (measurementUntracked.some((spec) => baselineFiles.some((tracked) => tracked.path === spec.path))) {
    throw new Error(`${scenarioId} produced a tracked and untracked path collision`);
  }

  return {
    scenario_id: scenarioId,
    seed: safeSeed,
    tier: scenario.tier,
    definition: scenario,
    baseline_files: baselineFiles,
    activation_writes: activationWrites,
    measurement_writes: measurementWrites,
    measurement_untracked: measurementUntracked,
    activation_state: activationState,
    measurement_state: measurementState,
  };
}

function buildFixtureManifest(plan, { stage, baselineHead }) {
  if (!["activation", "measurement"].includes(stage)) throw new Error("fixture stage must be activation or measurement");
  if (typeof baselineHead !== "string" || !/^[0-9a-f]{40,64}$/.test(baselineHead)) throw new Error("baseline HEAD must be a Git object ID");
  const current = stage === "activation" ? plan.activation_state : plan.measurement_state;
  return {
    schema: "scopelock/performance-fixture/v1",
    scenario_id: plan.scenario_id,
    seed: plan.seed,
    tier: plan.tier,
    stage,
    scope: {
      allowed: ["src/allowed/"],
      forbidden: [],
    },
    repository: {
      branch: "main",
      baseline_head: baselineHead,
      tracked_path_count: plan.baseline_files.length,
      tracked_bytes: sumBytes(plan.baseline_files),
      ordinary_allowed_path_count: plan.definition.tracked_paths
        - plan.definition.outside_tracked_paths
        - plan.definition.large_tracked_paths,
      large_tracked_path_count: plan.definition.large_tracked_paths,
      large_file_bytes: plan.definition.large_file_bytes,
      outside_tracked_path_count: plan.definition.outside_tracked_paths,
    },
    activation_state: structuredClone(plan.activation_state),
    measurement_state: structuredClone(plan.measurement_state),
    current_state: structuredClone(current),
    expected_findings: structuredClone(plan.definition.expected_findings),
  };
}

function gitEnvironment() {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_DATE: FIXTURE_COMMIT_DATE,
    GIT_COMMITTER_DATE: FIXTURE_COMMIT_DATE,
  };
  for (const key of Object.keys(env)) {
    if (BLOCKED_GIT_ENV.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  return env;
}

function runGit(projectRoot, args) {
  const result = spawnSync("git", [...SAFE_GIT_PREFIX, ...args], {
    cwd: projectRoot,
    env: gitEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * MIB,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || "unknown Git error").trim().slice(0, 1000);
    throw new Error(`benchmark Git command failed (${args[0]}): ${detail}`);
  }
  return result.stdout.trim();
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function verifiedTempRoot() {
  const root = await realpath(tmpdir());
  const metadata = await stat(root);
  if (!metadata.isDirectory()) throw new Error("operating-system temporary path is not a directory");
  return root;
}

async function assertSafeFixtureRoot(rawRoot, { requireExisting = false } = {}) {
  const tempRoot = await verifiedTempRoot();
  const lexical = path.resolve(rawRoot);
  if (!isWithin(tempRoot, lexical) || !path.basename(lexical).startsWith(FIXTURE_PREFIX)) {
    throw new Error("refusing fixture operation outside a verified benchmark temporary root");
  }
  if (!requireExisting) return { tempRoot, lexical };
  const metadata = await lstat(lexical);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("benchmark fixture root is not a safe directory");
  const resolved = await realpath(lexical);
  if (!isWithin(tempRoot, resolved)) throw new Error("benchmark fixture resolves outside the temporary root");
  return { tempRoot, lexical, resolved };
}

async function createBenchmarkTempDirectory(label = "session") {
  if (typeof label !== "string" || label.length < 1 || label.length > 80) {
    throw new Error("benchmark temporary-directory label must be between 1 and 80 characters");
  }
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "") || "session";
  const tempRoot = await verifiedTempRoot();
  const root = await mkdtemp(path.join(tempRoot, `${FIXTURE_PREFIX}${safeLabel}-`));
  await assertSafeFixtureRoot(root, { requireExisting: true });
  return root;
}

async function cleanupBenchmarkTempDirectory(root) {
  if (typeof root !== "string") throw new Error("benchmark cleanup requires an explicit root");
  const { lexical } = await assertSafeFixtureRoot(root);
  await rm(lexical, { recursive: true, force: true, maxRetries: 3 });
}

async function writeSpec(projectRoot, spec) {
  const target = path.resolve(projectRoot, ...spec.path.split("/"));
  if (!isWithin(projectRoot, target)) throw new Error(`unsafe fixture path: ${spec.path}`);
  await mkdir(path.dirname(target), { recursive: true });
  if (spec.kind === "text") {
    await writeFile(target, spec.content, "utf8");
    return;
  }
  const handle = await open(target, "w");
  try {
    await handle.write(Buffer.from([spec.marker]), 0, 1, 0);
    if (spec.size > 1) await handle.write(Buffer.from([0]), 0, 1, spec.size - 1);
  } finally {
    await handle.close();
  }
}

async function writeSpecs(projectRoot, specs) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(WRITE_CONCURRENCY, Math.max(1, specs.length)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= specs.length) return;
      await writeSpec(projectRoot, specs[index]);
    }
  });
  await Promise.all(workers);
}

function parsePorcelain(source) {
  const tracked = [];
  const untracked = [];
  const records = source.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("? ")) {
      untracked.push(record.slice(2));
      continue;
    }
    if (record.startsWith("1 ")) {
      tracked.push(record.split(" ").slice(8).join(" "));
      continue;
    }
    if (record.startsWith("2 ")) {
      tracked.push(record.split(" ").slice(9).join(" "));
      index += 1;
      continue;
    }
    if (record.startsWith("u ")) tracked.push(record.split(" ").slice(10).join(" "));
  }
  return {
    modified_tracked_paths: tracked.sort(),
    modified_tracked_count: tracked.length,
    untracked_paths: untracked.sort(),
    untracked_path_count: untracked.length,
  };
}

function inspectFixtureState(projectRoot) {
  const source = runGit(projectRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "."]);
  return parsePorcelain(source);
}

function scenarioState(projectRoot) {
  const state = inspectFixtureState(projectRoot);
  const untrackedPaths = state.untracked_paths.filter((candidate) => (
    candidate !== ".codex-scope" && !candidate.startsWith(".codex-scope/")
  ));
  return {
    ...state,
    untracked_paths: untrackedPaths,
    untracked_path_count: untrackedPaths.length,
  };
}

async function cleanupPerformanceFixture(fixture) {
  const root = typeof fixture === "string" ? fixture : fixture?.root;
  if (typeof root !== "string") throw new Error("fixture cleanup requires an explicit root");
  const { lexical } = await assertSafeFixtureRoot(root);
  const manifestPath = `${lexical}${MANIFEST_SUFFIX}`;
  await cleanupBenchmarkTempDirectory(lexical);
  await rm(manifestPath, { force: true });
}

async function createPerformanceFixture(scenarioId, { seed = DEFAULT_SEED, stage = "measurement" } = {}) {
  if (!["activation", "measurement"].includes(stage)) throw new Error("fixture stage must be activation or measurement");
  const plan = buildFixturePlan(scenarioId, { seed });
  const safeId = scenarioId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const root = await createBenchmarkTempDirectory(safeId);
  const manifestPath = `${root}${MANIFEST_SUFFIX}`;
  try {
    await assertSafeFixtureRoot(root, { requireExisting: true });
    runGit(root, ["init", "-b", "main"]);
    runGit(root, ["config", "user.name", "ScopeLock Performance Fixtures"]);
    runGit(root, ["config", "user.email", "scopelock-performance@example.invalid"]);
    await writeSpecs(root, plan.baseline_files);
    runGit(root, ["add", "--", "."]);
    runGit(root, ["commit", "-m", `fixture baseline: ${scenarioId}`]);
    const baselineHead = runGit(root, ["rev-parse", "HEAD"]);
    await writeSpecs(root, plan.activation_writes);
    if (stage === "measurement") {
      await writeSpecs(root, plan.measurement_writes);
      await writeSpecs(root, plan.measurement_untracked);
    }

    const manifest = buildFixtureManifest(plan, { stage, baselineHead });
    const actual = inspectFixtureState(root);
    if (actual.modified_tracked_count !== manifest.current_state.modified_tracked_count) {
      throw new Error(`${scenarioId} materialized the wrong modified tracked count`);
    }
    if (actual.untracked_path_count !== manifest.current_state.untracked_path_count) {
      throw new Error(`${scenarioId} materialized the wrong untracked path count`);
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { root, manifestPath, manifest };
  } catch (error) {
    await cleanupPerformanceFixture({ root }).catch(() => {});
    throw error;
  }
}

async function advancePerformanceFixture(fixture) {
  const root = fixture?.root;
  const manifestPath = fixture?.manifestPath;
  if (typeof root !== "string" || typeof manifestPath !== "string") {
    throw new Error("fixture advancement requires an explicit root and manifest path");
  }
  const { lexical } = await assertSafeFixtureRoot(root, { requireExisting: true });
  if (path.resolve(manifestPath) !== path.resolve(`${lexical}${MANIFEST_SUFFIX}`)) {
    throw new Error("fixture manifest path does not match its verified temporary root");
  }

  const stored = await readFixtureManifest(manifestPath);
  if (stored.stage === "measurement") return { root: lexical, manifestPath, manifest: stored };
  if (stored.stage !== "activation") throw new Error("fixture must be at activation stage before measurement");

  const plan = buildFixturePlan(stored.scenario_id, { seed: stored.seed });
  const currentHead = runGit(lexical, ["rev-parse", "HEAD"]);
  if (currentHead !== stored.repository?.baseline_head) {
    throw new Error("fixture HEAD changed after activation setup");
  }
  const before = scenarioState(lexical);
  if (before.modified_tracked_count !== plan.activation_state.modified_tracked_count
      || before.untracked_path_count !== plan.activation_state.untracked_path_count) {
    throw new Error("fixture state changed before measurement materialization");
  }

  await writeSpecs(lexical, plan.measurement_writes);
  await writeSpecs(lexical, plan.measurement_untracked);
  const manifest = buildFixtureManifest(plan, { stage: "measurement", baselineHead: currentHead });
  const actual = scenarioState(lexical);
  if (actual.modified_tracked_count !== manifest.current_state.modified_tracked_count
      || actual.untracked_path_count !== manifest.current_state.untracked_path_count) {
    throw new Error("fixture materialized the wrong measurement state");
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { root: lexical, manifestPath, manifest };
}

async function readFixtureManifest(manifestPath) {
  const value = JSON.parse(await readFile(manifestPath, "utf8"));
  if (value?.schema !== "scopelock/performance-fixture/v1") throw new Error("invalid performance fixture manifest");
  return value;
}

export {
  DEFAULT_SEED,
  PERFORMANCE_SCENARIOS,
  advancePerformanceFixture,
  buildFixtureManifest,
  buildFixturePlan,
  cleanupBenchmarkTempDirectory,
  cleanupPerformanceFixture,
  createBenchmarkTempDirectory,
  createPerformanceFixture,
  inspectFixtureState,
  readFixtureManifest,
  scenarioDefinition,
};
