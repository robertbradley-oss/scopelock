import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, mkdir, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSensitivePath, normalizeRuleSyntax, ruleMatches, sanitizeText } from "../scripts/scopelock.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../scripts/scopelock.mjs");
const TEMP_PREFIX = path.join(tmpdir(), "scopelock-test-");
const PLUGIN_ROOT = path.resolve(HERE, "..");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result;
}

function run(cwd, command, { input, env, extraArgs = [] } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, command, "--project-root", ".", ...extraArgs], {
    cwd,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, `expected one JSON line: ${result.stdout}\n${result.stderr}`);
  return { status: result.status, json: JSON.parse(lines[0]) };
}

async function runAsync(cwd, command, env, extraArgs = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, command, "--project-root", ".", ...extraArgs], {
      cwd, windowsHide: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      try {
        const lines = Buffer.concat(stdout).toString("utf8").trim().split(/\r?\n/).filter(Boolean);
        assert.equal(lines.length, 1);
        resolve({ status, json: JSON.parse(lines[0]) });
      } catch (error) { reject(error); }
    });
  });
}

function defaultFiles() {
  return {
    "src/auth/login.js": "export const login = true;\n",
    "src/auth/secrets/key.js": "export const name = 'safe';\n",
    "tests/auth/login.test.js": "export const covered = true;\n",
    "config/prod.json": "{\"mode\":\"prod\"}\n",
  };
}

async function write(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createRepo(files = defaultFiles()) {
  const root = await mkdtemp(TEMP_PREFIX);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "ScopeLock Tests"]);
  git(root, ["config", "user.email", "scopelock-tests@example.invalid"]);
  for (const [relative, content] of Object.entries(files)) await write(root, relative, content);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  return root;
}

function activationInput(overrides = {}) {
  return {
    objective: "Update the authentication flow",
    allowed: ["src/auth/", "tests/auth/"],
    forbidden: ["src/auth/secrets/"],
    constraints: ["Keep public behavior stable"],
    definition_of_done: ["The change is verified"],
    validation_requirements: [],
    scope_source: "explicit",
    whole_project_explicit: false,
    ...overrides,
  };
}

function activate(root, overrides = {}) {
  return run(root, "activate", { input: activationInput(overrides) });
}

async function jsonFile(root, relative) {
  return JSON.parse(await readFile(path.join(root, ...relative.split("/")), "utf8"));
}

async function cleanup(root) {
  if (!root) return;
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temp = await realpath(tmpdir());
  assert.ok(resolved.startsWith(temp + path.sep), `refusing to remove ${resolved}`);
  await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}

test("path grammar, matching, and sanitization are conservative", () => {
  assert.deepEqual(normalizeRuleSyntax("src//auth/./"), { path: "src/auth/", match: "directory" });
  assert.throws(() => normalizeRuleSyntax("../secret"), /traverse/);
  assert.throws(() => normalizeRuleSyntax("src/**/*.js"), /safe project-relative/);
  assert.throws(() => normalizeRuleSyntax("C:\\temp\\file"), /safe project-relative/);
  assert.throws(() => normalizeRuleSyntax("."), /explicit user approval/);
  assert.deepEqual(normalizeRuleSyntax(".", { wholeProjectExplicit: true }), { path: ".", match: "directory" });
  assert.equal(ruleMatches({ path: "src/auth/", match: "directory" }, "src/auth/login.js"), true);
  assert.equal(ruleMatches({ path: "src/auth.js", match: "file" }, "src/auth.js/child"), false);
  if (process.platform === "win32") assert.equal(ruleMatches({ path: "SRC/Auth/", match: "directory" }, "src/auth/login.js"), true);
  assert.equal(isSensitivePath(".env.local"), true);
  assert.equal(isSensitivePath("cert/server.pem"), true);
  assert.equal(isSensitivePath("src/auth/login.js"), false);
  assert.equal(sanitizeText("API_TOKEN=supersecret"), "API_TOKEN=[REDACTED]");
  assert.equal(sanitizeText("tool --password supersecret"), "tool --password [REDACTED]");
  assert.equal(sanitizeText('tool --password "two words" next'), "tool --password [REDACTED] next");
  assert.ok(!sanitizeText("https://user:password@example.com/path").includes("password"));
});

test("plugin manifest and three skill packages have the required structure", async () => {
  const manifest = JSON.parse(await readFile(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "scopelock");
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.skills, "./skills/");
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category", "capabilities", "defaultPrompt"]) {
    assert.ok(manifest.interface[field], `missing interface.${field}`);
  }
  for (const name of ["scope-lock", "scope-status", "scope-verify"]) {
    const skillRoot = path.join(PLUGIN_ROOT, "skills", name);
    const source = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(frontmatter, `${name} frontmatter missing`);
    assert.deepEqual(frontmatter[1].split(/\r?\n/).map((line) => line.split(":", 1)[0]), ["name", "description"]);
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, "m"));
    const agent = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
    assert.match(agent, /display_name:/);
    assert.match(agent, /short_description:/);
    assert.match(agent, new RegExp(`default_prompt:.*\\$${name}`));
    for (const match of source.matchAll(/\]\((\.\.\/\.\.\/references\/[^)]+)\)/g)) {
      await access(path.resolve(skillRoot, match[1]));
    }
  }
  await access(path.join(PLUGIN_ROOT, "hooks", "hooks.json"));
  assert.equal(Object.hasOwn(manifest, "hooks"), false, "default hook discovery must not add a manifest hooks field");
});

test("non-Git and inferred proposals create no storage", async () => {
  let nonGit;
  let repo;
  try {
    nonGit = await mkdtemp(TEMP_PREFIX);
    await write(nonGit, "note.txt", "hello\n");
    assert.equal(run(nonGit, "inspect").json.result, "unsupported");
    assert.equal(activate(nonGit).json.result, "unsupported");
    await assert.rejects(readFile(path.join(nonGit, ".codex-scope", "active.json")));
    repo = await createRepo();
    const proposal = activate(repo, { scope_source: "inferred" }).json;
    assert.equal(proposal.result, "confirmation_required");
    assert.equal(proposal.storage_written, false);
    await assert.rejects(readFile(path.join(repo, ".codex-scope", "active.json")));
  } finally {
    await cleanup(nonGit);
    await cleanup(repo);
  }
});

test("Lock and Status preserve source files and classify clean changes", async () => {
  let root;
  try {
    root = await createRepo();
    const login = await readFile(path.join(root, "src/auth/login.js"), "utf8");
    const activated = activate(root).json;
    assert.equal(activated.result, "activated");
    assert.match(activated.warning, /not a sandbox/);
    assert.equal(await readFile(path.join(root, "src/auth/login.js"), "utf8"), login);
    const pointerBeforeStatus = await readFile(path.join(root, ".codex-scope", "active.json"), "utf8");
    assert.equal(run(root, "status").json.health, "clean");
    assert.equal(await readFile(path.join(root, ".codex-scope", "active.json"), "utf8"), pointerBeforeStatus);
    const overwrite = activate(root);
    assert.equal(overwrite.status, 1);
    assert.equal(overwrite.json.error.code, "active-lock-exists");
    await write(root, "src/auth/login.js", "export const login = 'changed';\n");
    await write(root, "config/prod.json", "{\"mode\":\"changed\"}\n");
    await write(root, "src/auth/secrets/key.js", "export const name = 'changed';\n");
    const status = run(root, "status").json;
    assert.ok(status.findings.in_scope.some((item) => item.path === "src/auth/login.js"));
    assert.ok(status.findings.out_of_scope.some((item) => item.path === "config/prod.json"));
    assert.equal(status.findings.out_of_scope.find((item) => item.path === "src/auth/secrets/key.js").rule, "src/auth/secrets/");
    assert.equal(status.storage_written, false);
  } finally { await cleanup(root); }
});

test("dirty Baselines protect existing work and never store untracked contents", async () => {
  let root;
  try {
    root = await createRepo({ ...defaultFiles(), ".env": "PLACEHOLDER=one\n" });
    await write(root, "config/prod.json", "{\"mode\":\"existing\"}\n");
    await write(root, "src/auth/login.js", "export const login = 'existing';\n");
    await write(root, ".env", "PLACEHOLDER=two\n");
    await write(root, "notes/untracked.txt", "DO_NOT_STORE_THIS_CONTENT\n");
    activate(root);
    const pointer = await jsonFile(root, ".codex-scope/active.json");
    const baselinePath = path.join(root, ".codex-scope", pointer.lock_path, "baseline.json");
    const baselineText = await readFile(baselinePath, "utf8");
    const baseline = JSON.parse(baselineText);
    assert.ok(baseline.sensitive_path_hash_exclusions.includes(".env"));
    assert.ok(!baselineText.includes("DO_NOT_STORE_THIS_CONTENT"));
    assert.equal(baseline.pre_existing.find((item) => item.path === "notes/untracked.txt").worktree_sha256, undefined);
    const first = run(root, "status").json;
    assert.ok(first.findings.pre_existing.some((item) => item.path === "config/prod.json"));
    assert.ok(first.findings.pre_existing.some((item) => item.path === "notes/untracked.txt" && item.evidence === "uncertain"));
    await write(root, "config/prod.json", "{\"mode\":\"again\"}\n");
    await write(root, "notes/untracked.txt", "STILL_NOT_STORED\n");
    await write(root, ".env", "PLACEHOLDER=three\n");
    const second = run(root, "status").json;
    assert.ok(second.findings.out_of_scope.some((item) => item.path === "config/prod.json"));
    assert.ok(second.findings.pre_existing.some((item) => item.path === "notes/untracked.txt"));
    assert.ok(second.findings.pre_existing.some((item) => item.path === ".env" && item.evidence === "uncertain"));
  } finally { await cleanup(root); }
});

test("Status and Verify provide an overly simple default summary without losing detailed evidence", async () => {
  let root;
  try {
    root = await createRepo({ ...defaultFiles(), "README.md": "# Fixture\n" });
    await write(root, "README.md", "# Fixture\n\nExisting documentation work.\n");
    const command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
    activate(root, { validation_requirements: [command] });
    await write(root, "src/auth/login.js", "export const login = 'changed';\n");
    await write(root, "tests/auth/login.test.js", "export const covered = 'changed';\n");
    await write(root, "config/prod.json", "{\"mode\":\"changed\"}\n");

    const status = run(root, "status").json;
    assert.deepEqual(status.summary, {
      headline: "Scope needs attention.",
      lines: [
        "1 unexpected file changed: `config/prod.json`.",
        "2 task files are within scope.",
        "`README.md` was already changed before this task.",
        "Required checks have not run yet.",
        "ScopeLock only reports changes; it does not block them.",
      ],
      next_action: "Review `config/prod.json` before committing.",
    });
    assert.ok(status.findings.pre_existing.some((item) => item.path === "README.md"));
    assert.ok(status.findings.in_scope.some((item) => item.path === "src/auth/login.js"));
    assert.ok(status.findings.out_of_scope.some((item) => item.path === "config/prod.json"));

    const verified = run(root, "verify", { input: { authorized_commands: [command] } }).json;
    assert.equal(verified.outcome, "fail");
    assert.deepEqual(verified.summary, {
      headline: "Scope check failed.",
      lines: [
        "Checks passed, but 1 unexpected file changed: `config/prod.json`.",
        "2 task files were within scope.",
        "`README.md` was already changed before this task.",
        "ScopeLock only reports changes; it does not block them.",
      ],
      next_action: "Review `config/prod.json` before committing.",
    });
    const report = await readFile(path.join(root, ...verified.report_path.split("/")), "utf8");
    assert.match(report, /## Quick summary/);
    assert.match(report, /\*\*Scope check failed\.\*\*/);
    assert.match(report, /Checks passed, but 1 unexpected file changed: `config\/prod\.json`\./);
    assert.match(report, /## Out-of-scope findings\n\n- \[verified\] `config\/prod\.json`/);
  } finally { await cleanup(root); }
});

test("untracked additions, deletions, and cross-boundary renames are classified", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    await write(root, "src/auth/new.js", "export const added = true;\n");
    await rm(path.join(root, "tests/auth/login.test.js"));
    git(root, ["mv", "src/auth/login.js", "config/login.js"]);
    const findings = run(root, "status").json.findings;
    assert.ok(findings.in_scope.some((item) => item.path === "src/auth/new.js"));
    assert.ok(findings.in_scope.some((item) => item.path === "tests/auth/login.test.js"));
    assert.ok(findings.out_of_scope.some((item) => item.path === "config/login.js"));
    assert.ok(findings.in_scope.some((item) => item.path === "src/auth/login.js"));
  } finally { await cleanup(root); }
});

test("late-approved amendments remain visible and cap Verify at warning", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root, { allowed: ["src/auth/"], forbidden: [] });
    await write(root, "config/prod.json", "{\"mode\":\"late\"}\n");
    assert.ok(run(root, "status").json.findings.out_of_scope.some((item) => item.path === "config/prod.json"));
    const amended = run(root, "amend", { input: { add_allowed: ["config/prod.json"], reason: "Approved configuration work" } }).json;
    assert.deepEqual(amended.late_approved_paths, ["config/prod.json"]);
    const tightening = run(root, "amend", { input: { add_allowed: ["src/auth/new.js"], remove_allowed: ["src/auth/"], reason: "Try to tighten" } });
    assert.equal(tightening.status, 1);
    assert.equal(tightening.json.error.code, "invalid-input");
    assert.ok(run(root, "status").json.findings.late_approved.some((item) => item.path === "config/prod.json"));
    const verified = run(root, "verify", { input: { authorized_commands: [] } }).json;
    assert.equal(verified.outcome, "warning");
    assert.equal(verified.lock_state, "active");
  } finally { await cleanup(root); }
});

test("ancestor-preserving commits compare and branch changes become stale", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    await write(root, "src/auth/login.js", "export const login = 'committed';\n");
    git(root, ["add", "src/auth/login.js"]);
    git(root, ["commit", "-m", "allowed change"]);
    const compatible = run(root, "status").json;
    assert.equal(compatible.result, "ok");
    assert.ok(compatible.baseline_critical.some((item) => item.condition === "head-advanced-with-baseline-ancestor"));
    assert.ok(compatible.findings.in_scope.some((item) => item.path === "src/auth/login.js"));
    git(root, ["switch", "-c", "different-branch"]);
    const stale = run(root, "status").json;
    assert.equal(stale.result, "stale");
    assert.equal(stale.health, "stale");
  } finally { await cleanup(root); }
});

test("rewritten history on the same branch makes the Baseline stale", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    git(root, ["switch", "--orphan", "replacement"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "replacement history"]);
    git(root, ["branch", "-M", "main"]);
    const stale = run(root, "status").json;
    assert.equal(stale.result, "stale");
    assert.ok(stale.baseline_critical.some((item) => item.condition === "baseline-head-is-not-an-ancestor"));
  } finally { await cleanup(root); }
});

test("Verify requires authorization, records results, and leaves the Lock active", async () => {
  let root;
  try {
    root = await createRepo();
    const command = `${JSON.stringify(process.execPath)} -e "process.exit(0)"`;
    activate(root, { validation_requirements: [command] });
    const missing = run(root, "verify", { input: { authorized_commands: [] } }).json;
    assert.equal(missing.outcome, "incomplete");
    assert.equal(missing.validation_evidence[0].result, "not_run");
    const approved = run(root, "verify", { input: { authorized_commands: [command] } }).json;
    assert.equal(approved.outcome, "pass");
    assert.equal(approved.validation_evidence[0].result, "passed");
    assert.equal((await jsonFile(root, ".codex-scope/active.json")).state, "active");
    assert.equal(run(root, "status").json.validation_evidence[0].result, "passed");
  } finally { await cleanup(root); }
});

test("failed authorized validation is recorded exactly and fails verification", async () => {
  let root;
  try {
    root = await createRepo();
    const command = `${JSON.stringify(process.execPath)} -e "process.exit(7)"`;
    activate(root, { validation_requirements: [command] });
    const verified = run(root, "verify", { input: { authorized_commands: [command] } }).json;
    assert.equal(verified.outcome, "fail");
    assert.equal(verified.validation_evidence[0].result, "failed");
    assert.equal(verified.validation_evidence[0].exit_status, 7);
  } finally { await cleanup(root); }
});

test("validation mutations are compared and secret-like output is redacted", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const command = `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync('config/generated.txt','x'); console.log('API' + '_TOKEN=' + String.fromCharCode(115,117,112,101,114,115,101,99,114,101,116))"`;
    const verified = run(root, "verify", { input: { authorized_commands: [command] } }).json;
    assert.equal(verified.outcome, "fail");
    assert.equal(verified.repository_comparison.changed_during_validation, true);
    assert.ok(verified.findings.out_of_scope.some((item) => item.path === "config/generated.txt"));
    assert.ok(!JSON.stringify(verified).includes("supersecret"));
    const report = await readFile(path.join(root, ...verified.report_path.split("/")), "utf8");
    assert.ok(!report.includes("supersecret"));
    assert.match(report, /\[REDACTED/);
  } finally { await cleanup(root); }
});

test("corrupt immutable storage is unavailable and Verify is incomplete", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const pointer = await jsonFile(root, ".codex-scope/active.json");
    await write(root, `.codex-scope/${pointer.lock_path}/baseline.json`, "{}\n");
    const status = run(root, "status").json;
    assert.equal(status.result, "unavailable");
    assert.equal(status.error.code, "corrupt-storage");
    const verified = run(root, "verify", { input: { authorized_commands: [] } }).json;
    assert.equal(verified.outcome, "incomplete");
    assert.equal(verified.report_written, false);
  } finally { await cleanup(root); }
});

test("unsafe storage links are rejected without external writes", async (t) => {
  let root;
  let outside;
  try {
    root = await createRepo();
    outside = await mkdtemp(TEMP_PREFIX);
    try {
      await symlink(outside, path.join(root, ".codex-scope"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`link creation unavailable: ${error.code}`);
      return;
    }
    const result = activate(root);
    assert.equal(result.status, 1);
    assert.equal(result.json.error.code, "unsafe-storage");
    await assert.rejects(readFile(path.join(outside, "active.json")));
  } finally {
    await cleanup(root);
    await cleanup(outside);
  }
});

test("nested repositories and submodule state are limitations", async () => {
  let root;
  let child;
  try {
    root = await createRepo();
    const nested = path.join(root, "nested");
    await mkdir(nested);
    git(nested, ["init", "-b", "main"]);
    assert.ok(run(root, "inspect").json.limitations.some((item) => item.startsWith("nested-git-repository:nested")));
    await rm(nested, { recursive: true, force: true });
    child = await createRepo({ "child.txt": "child\n" });
    git(root, ["-c", "protocol.file.allow=always", "submodule", "add", child, "vendor/sub"]);
    git(root, ["commit", "-am", "add submodule"]);
    const submoduleLock = activate(root, { allowed: ["src/auth/", "vendor/sub/"] });
    assert.equal(submoduleLock.json.result, "activated");
    await write(root, "vendor/sub/child.txt", "changed\n");
    assert.ok(run(root, "status").json.limitations.some((item) => item.startsWith("submodule-state:vendor/sub")));
  } finally {
    await cleanup(root);
    await cleanup(child);
  }
});

test("repeated concurrent writes return incomplete rather than clean", async () => {
  let root;
  let timer;
  try {
    root = await createRepo();
    activate(root);
    let counter = 0;
    timer = setInterval(() => {
      counter += 1;
      void write(root, "src/auth/login.js", `export const login = ${counter};\n`);
    }, 10);
    const result = await runAsync(root, "status", { SCOPELOCK_TEST_CAPTURE_DELAY_MS: "120" });
    clearInterval(timer);
    timer = undefined;
    assert.equal(result.json.result, "incomplete");
    assert.ok(result.json.limitations.includes("concurrent-change-during-inspection"));
  } finally {
    if (timer) clearInterval(timer);
    await cleanup(root);
  }
});

test("close is an explicit transition that retains immutable records", async () => {
  let root;
  try {
    root = await createRepo();
    const lock = activate(root).json;
    const closed = run(root, "close", { extraArgs: ["--state", "closed"] }).json;
    assert.equal(closed.result, "closed");
    const pointer = await jsonFile(root, ".codex-scope/active.json");
    assert.equal(pointer.state, "closed");
    assert.equal(pointer.active_lock_id, lock.lock_id);
    assert.match(await readFile(path.join(root, ".codex-scope", pointer.lock_path, "contract.md"), "utf8"), /# ScopeLock Contract/);
  } finally { await cleanup(root); }
});

test("Git environment overrides are ignored and repository-local filters fail closed", async () => {
  let root;
  let other;
  try {
    root = await createRepo();
    other = await createRepo({ "other.txt": "other\n" });
    const expectedHead = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    const inspected = run(root, "inspect", {
      env: {
        GIT_DIR: path.join(other, ".git"),
        GIT_WORK_TREE: other,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.fsmonitor",
        GIT_CONFIG_VALUE_0: "malicious-command",
      },
    }).json;
    assert.equal(inspected.result, "ok");
    assert.equal(inspected.repository.head, expectedHead);

    git(root, ["config", "filter.scopelock-test.clean", "malicious-command"]);
    const rejected = run(root, "inspect");
    assert.equal(rejected.status, 1);
    assert.equal(rejected.json.error.code, "active-git-filter");
    assert.equal(rejected.json.error.message.includes("repository-local"), true);
  } finally {
    await cleanup(root);
    await cleanup(other);
  }
});

test("command-scoped Git configuration disables repository fsmonitor execution", async () => {
  let root;
  try {
    root = await createRepo();
    const marker = path.join(root, "fsmonitor-ran.txt");
    const monitor = path.join(root, "fsmonitor-test.mjs");
    await writeFile(monitor, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran\\n");\n`, "utf8");
    git(root, ["config", "core.fsmonitor", `node ${monitor.replaceAll("\\", "/")}`]);
    const inspected = run(root, "inspect").json;
    assert.equal(inspected.result, "ok");
    await assert.rejects(access(marker));
  } finally { await cleanup(root); }
});

test("coordinated Baseline and pointer tampering cannot insert unsafe scope rules", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const pointer = await jsonFile(root, ".codex-scope/active.json");
    const baselineRelative = `.codex-scope/${pointer.lock_path}/baseline.json`;
    const baseline = await jsonFile(root, baselineRelative);
    baseline.scope.allowed = [{ path: "../escape", match: "directory" }];
    const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
    await write(root, baselineRelative, baselineText);
    pointer.baseline_sha256 = createHash("sha256").update(baselineText).digest("hex");
    await write(root, ".codex-scope/active.json", `${JSON.stringify(pointer, null, 2)}\n`);

    const status = run(root, "status").json;
    assert.equal(status.result, "unavailable");
    assert.equal(status.error.code, "corrupt-storage");
  } finally { await cleanup(root); }
});

test("active pointer writes are serialized and reject stale concurrent updates", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const env = { SCOPELOCK_TEST_POINTER_WRITE_DELAY_MS: "300" };
    const results = await Promise.all([
      runAsync(root, "close", env, ["--state", "closed"]),
      runAsync(root, "close", env, ["--state", "closed"]),
    ]);
    assert.deepEqual(results.map((item) => item.status).sort(), [0, 1]);
    assert.equal(results.find((item) => item.status === 0).json.result, "closed");
    assert.equal(results.find((item) => item.status === 1).json.error.code, "concurrent-storage-change");
    assert.equal((await jsonFile(root, ".codex-scope/active.json")).state, "closed");
  } finally { await cleanup(root); }
});

test("an unexplained active writer lock fails closed without changing the pointer", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    await write(root, ".codex-scope/.active-write.lock", "unknown-writer\n");
    const result = run(root, "close", { extraArgs: ["--state", "closed"] });
    assert.equal(result.status, 1);
    assert.equal(result.json.error.code, "storage-write-locked");
    assert.equal((await jsonFile(root, ".codex-scope/active.json")).state, "active");
  } finally { await cleanup(root); }
});

test("large repositories remain comparable within a bounded local run", { timeout: 60000 }, async () => {
  let root;
  try {
    root = await createRepo();
    const bulk = path.join(root, "src", "auth", "bulk");
    await mkdir(bulk, { recursive: true });
    await Promise.all(Array.from({ length: 1200 }, (_, index) => writeFile(path.join(bulk, `file-${String(index).padStart(4, "0")}.js`), `export default ${index};\n`, "utf8")));
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "large fixture"]);

    const activationStarted = performance.now();
    assert.equal(activate(root).json.result, "activated");
    const activationMs = performance.now() - activationStarted;
    await Promise.all([
      ...Array.from({ length: 25 }, (_, index) => writeFile(path.join(bulk, `file-${String(index).padStart(4, "0")}.js`), `export default ${index + 5000};\n`, "utf8")),
      ...Array.from({ length: 200 }, (_, index) => writeFile(path.join(bulk, `new-${String(index).padStart(4, "0")}.js`), `export default ${index};\n`, "utf8")),
    ]);
    const statusStarted = performance.now();
    const status = run(root, "status").json;
    const statusMs = performance.now() - statusStarted;
    assert.equal(status.result, "ok");
    assert.equal(status.findings.in_scope.length, 225);
    assert.ok(activationMs < 30000, `activation took ${Math.round(activationMs)}ms`);
    assert.ok(statusMs < 30000, `status took ${Math.round(statusMs)}ms`);
  } finally { await cleanup(root); }
});

test("oversized tracked files are not hashed into the Baseline", async () => {
  let root;
  let handle;
  try {
    root = await createRepo();
    handle = await open(path.join(root, "src", "auth", "login.js"), "r+");
    await handle.truncate(64 * 1024 * 1024 + 1);
    await handle.close();
    handle = undefined;
    assert.equal(activate(root).json.result, "activated");
    const pointer = await jsonFile(root, ".codex-scope/active.json");
    const baseline = await jsonFile(root, `.codex-scope/${pointer.lock_path}/baseline.json`);
    const observation = baseline.pre_existing.find((item) => item.path === "src/auth/login.js");
    assert.equal(observation.worktree_sha256, undefined);
    assert.equal(observation.fingerprint_limited, "content-unavailable");
    const status = run(root, "status").json;
    assert.equal(status.result, "ok");
    assert.equal(status.findings.pre_existing.find((item) => item.path === "src/auth/login.js").evidence, "uncertain");
  } finally {
    await handle?.close().catch(() => {});
    await cleanup(root);
  }
});

test("invalid UTF-8 Git paths fail closed on POSIX", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows filenames cannot exercise the POSIX byte-path case");
    return;
  }
  let root;
  try {
    root = await createRepo();
    const target = Buffer.concat([Buffer.from(`${root}${path.sep}`), Buffer.from([0xff])]);
    await writeFile(target, "invalid path bytes\n");
    const result = run(root, "inspect");
    assert.equal(result.status, 1);
    assert.equal(result.json.error.code, "unsupported-git-encoding");
  } finally { await cleanup(root); }
});
