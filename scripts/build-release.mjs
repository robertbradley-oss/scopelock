#!/usr/bin/env node

import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..");

function gitEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_SYSTEM",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
  ]) {
    delete environment[name];
  }
  return environment;
}

function git(args, failureMessage) {
  const result = spawnSync(
    "git",
    ["--no-pager", "--no-optional-locks", "--no-lazy-fetch", "--no-replace-objects", "-C", PLUGIN_ROOT, ...args],
    { cwd: PLUGIN_ROOT, encoding: null, env: gitEnvironment(), maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error(failureMessage);
  return result.stdout;
}

function committedReleaseFiles() {
  const output = git(["ls-tree", "-r", "-z", "--full-tree", "HEAD", "--"], "The committed release tree could not be read from Git.");
  return output.toString("utf8").split("\0").filter(Boolean).map((record) => {
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error("Git returned an invalid committed release entry.");
    const [mode, type, oid, ...extra] = record.slice(0, separator).split(" ");
    const relative = record.slice(separator + 1);
    const parts = relative.split("/");
    const resolved = path.resolve(PLUGIN_ROOT, ...parts);
    const relationship = path.relative(PLUGIN_ROOT, resolved);
    if (
      !relative
      || relative.includes("\\")
      || parts.includes("..")
      || path.isAbsolute(relationship)
      || relationship.startsWith(`..${path.sep}`)
      || extra.length > 0
      || type !== "blob"
      || !/^[0-7]{6}$/.test(mode)
      || !/^[0-9a-f]+$/.test(oid)
    ) {
      throw new Error("Git returned an unsafe committed release entry.");
    }
    return { relative, oid };
  });
}

function readCommittedFile(file) {
  return git(["cat-file", "blob", file.oid], `The committed release file could not be read: ${file.relative}`);
}

const committedFiles = committedReleaseFiles();
const committedManifest = committedFiles.find(({ relative }) => relative === ".codex-plugin/plugin.json");
if (!committedManifest) throw new Error("The committed plugin manifest is unavailable.");
const manifest = JSON.parse(readCommittedFile(committedManifest).toString("utf8"));
const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--marketplace-name"))) {
  throw new Error("Usage: build-release.mjs [--marketplace-name <name>]");
}
const marketplaceName = args.length === 0 ? "scopelock" : args[1];
if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(marketplaceName)) {
  throw new Error("Marketplace name must use 1-64 lowercase letters, digits, or hyphens and cannot end with a hyphen.");
}
const distRoot = path.join(PLUGIN_ROOT, "dist");
const stageRoot = path.join(distRoot, `scopelock-marketplace-${manifest.version}`);
const pluginTarget = path.join(stageRoot, "plugins", manifest.name);
const excludedRoots = new Set([
  ".git",
  ".codex-handoff",
  ".codex-scope",
  "benchmarks",
  "dist",
  "GAMEPLAN.md",
  "node_modules",
  "tests",
]);
const excludedFiles = new Set(["docs/performance-benchmark-plan.md"]);
const publicRoots = new Set([
  ".gitignore",
  "assets",
  "CHANGELOG.md",
  "docs",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "RELEASE_NOTES.md",
  "scopelock-threat-model.md",
  "SECURITY.md",
  "security_best_practices_report.md",
]);
const packagedScripts = new Set(["check", "demo"]);

function isReleaseFile(file) {
  const root = file.relative.split("/", 1)[0];
  return !excludedRoots.has(root) && !excludedFiles.has(file.relative);
}

async function writeCommittedFile(file, destinationRoot) {
  const parts = file.relative.split("/");
  const destination = path.join(destinationRoot, ...parts);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, readCommittedFile(file));
}

async function sanitizePackagedManifest() {
  const target = path.join(pluginTarget, "package.json");
  const packaged = JSON.parse(await readFile(target, "utf8"));
  const scripts = Object.fromEntries(
    Object.entries(packaged.scripts ?? {}).filter(([name, command]) => packagedScripts.has(name) && typeof command === "string"),
  );
  if ([...packagedScripts].some((name) => typeof scripts[name] !== "string")) {
    throw new Error("A required packaged command is unavailable.");
  }
  packaged.scripts = scripts;
  await writeFile(target, `${JSON.stringify(packaged, null, 2)}\n`, "utf8");
}

const relativeStage = path.relative(PLUGIN_ROOT, stageRoot);
if (relativeStage.startsWith("..") || path.isAbsolute(relativeStage) || !relativeStage.startsWith(`dist${path.sep}`)) {
  throw new Error("Refusing to build outside the project dist directory.");
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(pluginTarget, { recursive: true });
const releaseFiles = committedFiles.filter(isReleaseFile);
for (const file of releaseFiles) await writeCommittedFile(file, pluginTarget);
await sanitizePackagedManifest();

await mkdir(path.join(stageRoot, ".agents", "plugins"), { recursive: true });
const marketplace = {
  name: marketplaceName,
  interface: { displayName: "ScopeLock" },
  plugins: [
    {
      name: manifest.name,
      source: { source: "local", path: `./plugins/${manifest.name}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: manifest.interface.category,
    },
  ],
};
await writeFile(path.join(stageRoot, ".agents", "plugins", "marketplace.json"), `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
for (const file of releaseFiles) {
  if (publicRoots.has(file.relative.split("/", 1)[0])) await writeCommittedFile(file, stageRoot);
}

const resolvedStage = await realpath(stageRoot);
process.stdout.write(`${JSON.stringify({ schema: "scopelock/release-build/v1", result: "built", version: manifest.version, marketplace_name: marketplaceName, marketplace_root: resolvedStage, plugin_path: path.join(resolvedStage, "plugins", manifest.name) })}\n`);
