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

function printSummary(summary) {
  process.stdout.write(`${summary.headline}\n\n`);
  process.stdout.write(`${summary.lines.join("\n")}\n\n`);
  process.stdout.write(`Next: ${summary.next_action}\n`);
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
  process.stdout.write("ScopeLock is active for src/auth/ and tests/auth/.\n");
  process.stdout.write(`It kept ${activated.baseline.pre_existing_paths} pre-existing files separate.\n`);
  process.stdout.write("ScopeLock reports unexpected changes; it does not block them.\n");

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
  printSummary(status.summary);

  heading("4. Verify with separately authorized validation");
  const verified = scope(projectRoot, "verify", { authorized_commands: ["node --test"] });
  printSummary(verified.summary);
  process.stdout.write("Detailed evidence was saved locally.\n");

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
