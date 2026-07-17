#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..");
const manifest = JSON.parse(await readFile(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"));
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
const exclusions = new Set([".git", ".codex-handoff", ".codex-scope", "dist", "node_modules"]);

const relativeStage = path.relative(PLUGIN_ROOT, stageRoot);
if (relativeStage.startsWith("..") || path.isAbsolute(relativeStage) || !relativeStage.startsWith(`dist${path.sep}`)) {
  throw new Error("Refusing to build outside the project dist directory.");
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(pluginTarget, { recursive: true });
for (const entry of await readdir(PLUGIN_ROOT, { withFileTypes: true })) {
  if (exclusions.has(entry.name)) continue;
  await cp(path.join(PLUGIN_ROOT, entry.name), path.join(pluginTarget, entry.name), { recursive: true });
}

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
for (const publicEntry of [
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
]) {
  await cp(path.join(PLUGIN_ROOT, publicEntry), path.join(stageRoot, publicEntry), { recursive: true });
}

const resolvedStage = await realpath(stageRoot);
process.stdout.write(`${JSON.stringify({ schema: "scopelock/release-build/v1", result: "built", version: manifest.version, marketplace_name: marketplaceName, marketplace_root: resolvedStage, plugin_path: path.join(resolvedStage, "plugins", manifest.name) })}\n`);
