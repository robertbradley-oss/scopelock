#!/usr/bin/env node

import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..");
const CORE = path.join(PLUGIN_ROOT, "scripts", "scopelock.mjs");
const FIXTURE = path.join(PLUGIN_ROOT, "examples", "auth-demo");
const KEEP = process.argv.includes("--keep");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
}
function scope(cwd, command, input, extraArgs = []) {
  const result = spawnSync(process.execPath, [CORE, command, "--project-root", ".", ...extraArgs], {
    cwd,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
  });
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error(`ScopeLock returned unexpected output: ${result.stdout}${result.stderr}`);
  const response = JSON.parse(lines[0]);
  if (result.status !== 0) throw new Error(`${command} failed: ${response.error?.code ?? "unknown"}`);
  return response;
}

function heading(value) {
  process.stdout.write(`\n=== ${value} ===\n`);
}

function findingSummary(findings) {
  return {
    in_scope: findings.in_scope.map((item) => item.path),
    out_of_scope: findings.out_of_scope.map((item) => item.path),
    pre_existing: findings.pre_existing.map((item) => item.path),
    uncertain: findings.uncertain.map((item) => item.path),
  };
}

let projectRoot;
try {
  projectRoot = await mkdtemp(path.join(tmpdir(), "scopelock-demo-"));
  await cp(FIXTURE, projectRoot, { recursive: true });
  git(projectRoot, ["init", "-b", "main"]);
  git(projectRoot, ["config", "user.name", "ScopeLock Demo"]);
  git(projectRoot, ["config", "user.email", "scopelock-demo@example.invalid"]);
  git(projectRoot, ["add", "."]);
  git(projectRoot, ["commit", "-m", "Initial demo project"]);

  heading("1. Lock the task");
  const activated = scope(projectRoot, "activate", {
    objective: "Harden the login redirect behavior",
    allowed: ["src/auth/", "tests/auth/"],
    forbidden: [],
    constraints: ["Do not change production configuration"],
    definition_of_done: ["Redirect tests pass"],
    validation_requirements: ["node --test"],
    scope_source: "explicit",
    whole_project_explicit: false,
  });
  process.stdout.write(`${JSON.stringify({ result: activated.result, lock_id: activated.lock_id, pre_existing_paths: activated.baseline.pre_existing_paths }, null, 2)}\n`);

  heading("2. Make one allowed change and one drift change");
  const loginPath = path.join(projectRoot, "src", "auth", "login.js");
  const login = await readFile(loginPath, "utf8");
  await writeFile(loginPath, `${login.trimEnd()}\n\nexport const redirectPolicy = "local-only";\n`, "utf8");
  const configPath = path.join(projectRoot, "config", "prod.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.redirectAudit = true;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  process.stdout.write("Changed src/auth/login.js and config/prod.json.\n");

  heading("3. Status");
  const status = scope(projectRoot, "status");
  process.stdout.write(`${JSON.stringify({ result: status.result, health: status.health, findings: findingSummary(status.findings), next: status.recommended_next_action }, null, 2)}\n`);

  heading("4. Verify with separately authorized validation");
  const verified = scope(projectRoot, "verify", { authorized_commands: ["node --test"] });
  process.stdout.write(`${JSON.stringify({ outcome: verified.outcome, report_path: verified.report_path, validation: verified.validation_evidence, next: verified.recommended_next_action }, null, 2)}\n`);

  heading("Demo result");
  process.stdout.write("ScopeLock detected the out-of-scope configuration change and did not claim it was blocked.\n");
  if (KEEP) process.stdout.write(`Temporary demo project retained at ${projectRoot}\n`);
} finally {
  if (projectRoot && !KEEP) {
    const resolved = await realpath(projectRoot).catch(() => path.resolve(projectRoot));
    const temp = await realpath(tmpdir());
    if (!resolved.startsWith(`${temp}${path.sep}`)) throw new Error(`Refusing to remove unexpected demo path: ${resolved}`);
    await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  }
}
