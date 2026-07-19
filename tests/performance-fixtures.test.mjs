import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERFORMANCE_SCENARIOS,
  advancePerformanceFixture,
  buildFixtureManifest,
  buildFixturePlan,
  cleanupPerformanceFixture,
  createPerformanceFixture,
  inspectFixtureState,
  readFixtureManifest,
  scenarioDefinition,
} from "../benchmarks/fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");
const BASELINE_HEAD = "a".repeat(40);

const EXPECTED = {
  "S-clean": { tier: "small", tracked: 100, modified: 0, untracked: 0, inScope: 0, outOfScope: 0 },
  "M-clean": { tier: "medium", tracked: 1200, modified: 0, untracked: 0, inScope: 0, outOfScope: 0 },
  "M-mixed": { tier: "medium", tracked: 1200, modified: 25, untracked: 200, inScope: 225, outOfScope: 0 },
  "M-preexisting": { tier: "medium", tracked: 1200, modified: 25, untracked: 200, inScope: 225, outOfScope: 0 },
  "M-outside": { tier: "medium", tracked: 1200, modified: 50, untracked: 0, inScope: 25, outOfScope: 25 },
  "L-clean": { tier: "large", tracked: 10000, modified: 0, untracked: 0, inScope: 0, outOfScope: 0 },
  "L-mixed": { tier: "large", tracked: 10000, modified: 100, untracked: 1000, inScope: 1100, outOfScope: 0 },
  "L-untracked-heavy": { tier: "large", tracked: 10000, modified: 0, untracked: 5000, inScope: 5000, outOfScope: 0 },
  "L-hash-heavy": { tier: "large", tracked: 10000, modified: 16, untracked: 0, inScope: 16, outOfScope: 0 },
  "XL-clean": { tier: "extra-large", tracked: 50000, modified: 0, untracked: 0, inScope: 0, outOfScope: 0 },
  "XL-mixed": { tier: "extra-large", tracked: 50000, modified: 250, untracked: 2000, inScope: 2250, outOfScope: 0 },
};

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function missing(target) {
  try {
    await access(target);
    return false;
  } catch {
    return true;
  }
}

test("every approved scenario has a deterministic plan and complete manifest", () => {
  assert.deepEqual(Object.keys(PERFORMANCE_SCENARIOS), Object.keys(EXPECTED));
  for (const [scenarioId, expected] of Object.entries(EXPECTED)) {
    const first = buildFixturePlan(scenarioId);
    const second = buildFixturePlan(scenarioId);
    assert.equal(digest(first), digest(second), `${scenarioId} plan is not deterministic`);
    assert.notStrictEqual(scenarioDefinition(scenarioId), PERFORMANCE_SCENARIOS[scenarioId]);
    assert.equal(first.baseline_files.length, expected.tracked);
    assert.equal(new Set(first.baseline_files.map((spec) => spec.path)).size, expected.tracked);
    assert.equal(first.measurement_state.modified_tracked_count, expected.modified);
    assert.equal(first.measurement_state.untracked_path_count, expected.untracked);

    const manifest = buildFixtureManifest(first, { stage: "measurement", baselineHead: BASELINE_HEAD });
    assert.equal(manifest.schema, "scopelock/performance-fixture/v1");
    assert.equal(manifest.tier, expected.tier);
    assert.equal(manifest.repository.tracked_path_count, expected.tracked);
    assert.equal(
      manifest.repository.tracked_bytes,
      first.baseline_files.reduce((total, spec) => total + spec.bytes, 0),
    );
    assert.equal(manifest.current_state.modified_tracked_count, expected.modified);
    assert.equal(manifest.current_state.untracked_path_count, expected.untracked);
    assert.equal(manifest.expected_findings.in_scope, expected.inScope);
    assert.equal(manifest.expected_findings.out_of_scope, expected.outOfScope);
    assert.deepEqual(manifest.scope, { allowed: ["src/allowed/"], forbidden: [] });
  }
});

test("scenario plans preserve pre-existing and large-file semantics", () => {
  const preexisting = buildFixturePlan("M-preexisting");
  assert.equal(preexisting.activation_state.modified_tracked_count, 25);
  assert.equal(preexisting.measurement_writes.length, 25);
  assert.deepEqual(
    preexisting.activation_state.modified_tracked_paths,
    preexisting.measurement_state.modified_tracked_paths,
  );

  const hashHeavy = buildFixturePlan("L-hash-heavy");
  const large = hashHeavy.baseline_files.filter((spec) => spec.kind === "sparse");
  assert.equal(large.length, 16);
  assert.ok(large.every((spec) => spec.bytes === 16 * 1024 * 1024));
  assert.equal(hashHeavy.activation_state.modified_tracked_bytes, 16 * 16 * 1024 * 1024);
  assert.equal(hashHeavy.measurement_state.modified_tracked_bytes, 16 * 16 * 1024 * 1024);
});

test("clean and mixed fixtures materialize the expected Git states", { timeout: 30000 }, async () => {
  const fixtures = [];
  try {
    const clean = await createPerformanceFixture("S-clean");
    fixtures.push(clean);
    assert.deepEqual(inspectFixtureState(clean.root), {
      modified_tracked_paths: [],
      modified_tracked_count: 0,
      untracked_paths: [],
      untracked_path_count: 0,
    });
    assert.deepEqual(await readFixtureManifest(clean.manifestPath), clean.manifest);
    assert.ok(!JSON.stringify(clean.manifest).includes(clean.root));

    const mixed = await createPerformanceFixture("M-mixed");
    fixtures.push(mixed);
    const state = inspectFixtureState(mixed.root);
    assert.equal(state.modified_tracked_count, 25);
    assert.equal(state.untracked_path_count, 200);
    assert.equal(mixed.manifest.current_state.modified_tracked_count, 25);
    assert.equal(mixed.manifest.current_state.untracked_path_count, 200);
  } finally {
    await Promise.all(fixtures.map((fixture) => cleanupPerformanceFixture(fixture)));
  }
});

test("activation and outside-scope profiles materialize distinct dirty states", { timeout: 30000 }, async () => {
  const fixtures = [];
  try {
    const preexisting = await createPerformanceFixture("M-preexisting", { stage: "activation" });
    fixtures.push(preexisting);
    const preexistingState = inspectFixtureState(preexisting.root);
    assert.equal(preexistingState.modified_tracked_count, 25);
    assert.equal(preexistingState.untracked_path_count, 0);
    assert.equal(preexisting.manifest.stage, "activation");
    assert.equal(preexisting.manifest.current_state.modified_tracked_count, 25);

    const outside = await createPerformanceFixture("M-outside");
    fixtures.push(outside);
    const outsideState = inspectFixtureState(outside.root);
    assert.equal(outsideState.modified_tracked_count, 50);
    assert.equal(outsideState.untracked_path_count, 0);
    assert.equal(outside.manifest.expected_findings.in_scope, 25);
    assert.equal(outside.manifest.expected_findings.out_of_scope, 25);
  } finally {
    await Promise.all(fixtures.map((fixture) => cleanupPerformanceFixture(fixture)));
  }
});

test("an activated fixture advances to its deterministic measurement state", { timeout: 30000 }, async () => {
  const fixture = await createPerformanceFixture("M-mixed", { stage: "activation" });
  try {
    assert.equal(fixture.manifest.stage, "activation");
    assert.equal(inspectFixtureState(fixture.root).untracked_path_count, 0);
    const advanced = await advancePerformanceFixture(fixture);
    assert.equal(advanced.manifest.stage, "measurement");
    assert.equal(inspectFixtureState(advanced.root).modified_tracked_count, 25);
    assert.equal(inspectFixtureState(advanced.root).untracked_path_count, 200);
    assert.deepEqual(await readFixtureManifest(advanced.manifestPath), advanced.manifest);
    assert.deepEqual(await advancePerformanceFixture(advanced), advanced);
  } finally {
    await cleanupPerformanceFixture(fixture);
  }
});

test("fixture cleanup is idempotent and refuses project paths", async () => {
  const fixture = await createPerformanceFixture("S-clean");
  await cleanupPerformanceFixture(fixture);
  assert.equal(await missing(fixture.root), true);
  assert.equal(await missing(fixture.manifestPath), true);
  await cleanupPerformanceFixture(fixture);

  await assert.rejects(
    cleanupPerformanceFixture({ root: PROJECT_ROOT }),
    /outside a verified benchmark temporary root/,
  );
  assert.equal(await missing(PROJECT_ROOT), false);
});

test("fixture inputs reject unknown scenarios, unsafe seeds, and invalid stages", async () => {
  assert.throws(() => buildFixturePlan("missing"), /unknown performance scenario/);
  assert.throws(() => buildFixturePlan("S-clean", { seed: "bad\nseed" }), /printable string/);
  await assert.rejects(
    createPerformanceFixture("S-clean", { stage: "invalid" }),
    /activation or measurement/,
  );
});
