#!/usr/bin/env node

import { lstat, realpath, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_TEXT = 1600;
const MAX_PATHS = 12;
const CORE = fileURLToPath(new URL("./scopelock.mjs", import.meta.url));
const IS_WINDOWS = process.platform === "win32";
const BLOCKED_GIT_ENV = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_ASKPASS",
  "GIT_ATTR_SOURCE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PAGER",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_WORK_TREE",
]);

function sanitizeText(value, maxLength = MAX_OUTPUT_TEXT) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function comparable(value) {
  return IS_WINDOWS ? value.toLowerCase() : value;
}

function isWithin(root, candidate) {
  const relative = path.relative(comparable(root), comparable(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function gitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (
      BLOCKED_GIT_ENV.has(upper) ||
      upper.startsWith("GIT_TRACE") ||
      upper === "GIT_DIFF_OPTS" ||
      upper === "GIT_CONFIG_COUNT" ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(upper)
    ) {
      delete env[key];
    }
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}

async function readHookInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("hook input too large");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8").trim();
  const value = JSON.parse(source || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("hook input must be an object");
  return value;
}

function gitRoot(cwd) {
  const result = spawnSync("git", [
    "--no-pager",
    "--no-optional-locks",
    "--no-lazy-fetch",
    "--no-replace-objects",
    "-c", "core.fsmonitor=false",
    "rev-parse",
    "--show-toplevel",
  ], {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 1500,
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || null;
}

async function discoverProjectRoot(rawCwd) {
  const cwd = await realpath(path.resolve(typeof rawCwd === "string" ? rawCwd : process.cwd()));
  if (!(await stat(cwd)).isDirectory()) throw new Error("invalid cwd");
  const rawGitRoot = gitRoot(cwd);
  const boundary = rawGitRoot ? await realpath(rawGitRoot).catch(() => cwd) : cwd;
  if (!isWithin(boundary, cwd)) return cwd;

  let current = cwd;
  while (true) {
    try {
      await lstat(path.join(current, ".codex-scope"));
      return current;
    } catch {
      // Keep walking toward the Git root.
    }
    if (comparable(current) === comparable(boundary)) break;
    const parent = path.dirname(current);
    if (parent === current || !isWithin(boundary, parent)) break;
    current = parent;
  }
  return boundary;
}

function runHelper(projectRoot, command, timeout) {
  const result = spawnSync(process.execPath, [CORE, command, "--project-root", projectRoot], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("ScopeLock helper unavailable");
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error("invalid ScopeLock helper output");
  return JSON.parse(lines[0]);
}

function normalizeCandidate(raw, projectRoot) {
  let value = String(raw ?? "").trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\\/g, "/");
  if (value.startsWith("a/") || value.startsWith("b/")) value = value.slice(2);
  if (path.isAbsolute(value) || /^[A-Za-z]:\//.test(value)) {
    const absolute = path.resolve(value);
    if (!isWithin(projectRoot, absolute)) return null;
    value = path.relative(projectRoot, absolute).split(path.sep).join("/");
  }
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return parts.join("/");
}

function extractPatchPaths(command, projectRoot) {
  if (typeof command !== "string" || command.length > MAX_INPUT_BYTES) return [];
  const paths = [];
  const seen = new Set();
  const patterns = [
    /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/,
    /^\*\*\* Move to:\s*(.+)$/,
    /^\+\+\+\s+(?:b\/)?(.+)$/,
  ];
  for (const line of command.split(/\r?\n/)) {
    let candidate = null;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        candidate = normalizeCandidate(match[1], projectRoot);
        break;
      }
    }
    if (!candidate || candidate === ".codex-scope" || candidate.startsWith(".codex-scope/")) continue;
    const key = comparable(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(candidate);
    if (paths.length >= MAX_PATHS) break;
  }
  return paths;
}

function ruleMatches(rule, projectPath) {
  const candidate = comparable(projectPath);
  const rulePath = comparable(rule.path);
  if (rulePath === ".") return true;
  if (rule.match === "file") return candidate === rulePath;
  const prefix = rulePath.replace(/\/$/, "");
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function classifyPath(context, projectPath) {
  const forbidden = context.forbidden.find((rule) => ruleMatches(rule, projectPath));
  if (forbidden) return { category: "out-of-scope", reason: `forbidden by ${forbidden.path}` };
  const allowed = context.effective_allowed.find((rule) => ruleMatches(rule, projectPath));
  if (allowed) return { category: "in-scope", reason: `allowed by ${allowed.path}` };
  return { category: "out-of-scope", reason: "outside the approved boundary" };
}

function hookOutput(eventName, additionalContext, systemMessage) {
  return {
    ...(systemMessage ? { systemMessage: sanitizeText(systemMessage, 500) } : {}),
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: sanitizeText(additionalContext),
    },
  };
}

function summarizeRules(rules, limit = 8) {
  if (!Array.isArray(rules) || rules.length === 0) return "none";
  const values = rules.slice(0, limit).map((rule) => rule.path);
  return `${values.join(", ")}${rules.length > limit ? `, plus ${rules.length - limit} more` : ""}`;
}

async function sessionStart(input, projectRoot, context) {
  if (context.result !== "active") return {};
  let health = "unknown";
  let statusNote = "Run $scopelock for a current comparison.";
  try {
    const status = runHelper(projectRoot, "status", 6000);
    health = status.health ?? status.result ?? "unknown";
    if (health === "clean") statusNote = "The current comparison has no attention finding.";
    else if (health === "attention") statusNote = "The current comparison needs attention. Run $scopelock before continuing.";
    else statusNote = `The current comparison is ${sanitizeText(health, 80)}. Run $scopelock before relying on it.`;
  } catch {
    statusNote = "The advisory startup comparison was unavailable. Run $scopelock before relying on the Lock.";
  }
  const text = [
    `ScopeLock is active for objective: ${JSON.stringify(sanitizeText(context.objective, 500))}.`,
    `Allowed: ${summarizeRules(context.effective_allowed)}.`,
    `Forbidden: ${summarizeRules(context.forbidden)}.`,
    context.constraints.length ? `Constraints: ${context.constraints.slice(0, 5).map((item) => sanitizeText(item, 200)).join("; ")}.` : "",
    `Status: ${health}. ${statusNote}`,
    "ScopeLock is advisory only. It does not block every write. Use $scopelock to verify before closing the task.",
  ].filter(Boolean).join(" ");
  return hookOutput("SessionStart", text, health === "clean" ? null : "ScopeLock is active and its current status needs review.");
}

async function preToolUse(input, projectRoot, context) {
  if (context.result !== "active" || input.tool_name !== "apply_patch") return {};
  const paths = extractPatchPaths(input.tool_input?.command, projectRoot);
  if (paths.length === 0) return {};
  const outside = paths
    .map((projectPath) => ({ path: projectPath, ...classifyPath(context, projectPath) }))
    .filter((item) => item.category === "out-of-scope");
  if (outside.length === 0) return {};
  const details = outside.slice(0, 5).map((item) => `${item.path} (${item.reason})`).join(", ");
  return hookOutput(
    "PreToolUse",
    `ScopeLock advisory before apply_patch: ${details}. The tool call was not blocked. Confirm or amend scope before relying on this warning.`,
    `ScopeLock warns that ${outside.length} proposed path${outside.length === 1 ? " is" : "s are"} outside the approved boundary.`,
  );
}

function findingPaths(findings, key) {
  const items = Array.isArray(findings?.[key]) ? findings[key] : [];
  return items.slice(0, 5).map((item) => sanitizeText(item.path, 300));
}

async function postToolUse(input, projectRoot, context) {
  if (context.result !== "active") return {};
  let status;
  try {
    status = runHelper(projectRoot, "status", 8000);
  } catch {
    return hookOutput(
      "PostToolUse",
      "ScopeLock could not complete its bounded advisory comparison after the tool call. Run $scopelock before relying on the task boundary.",
      "ScopeLock post-tool comparison was unavailable. The completed tool action was not undone.",
    );
  }
  const outside = findingPaths(status.findings, "out_of_scope");
  const late = findingPaths(status.findings, "late_approved");
  const uncertain = findingPaths(status.findings, "uncertain");
  const needsAttention = status.result !== "ok" || outside.length > 0 || late.length > 0 || uncertain.length > 0;
  if (!needsAttention) return {};
  const facts = [
    `Comparison: ${sanitizeText(status.result, 80)}; health: ${sanitizeText(status.health, 80)}.`,
    outside.length ? `Out of scope: ${outside.join(", ")}.` : "",
    late.length ? `Late approved: ${late.join(", ")}.` : "",
    uncertain.length ? `Uncertain: ${uncertain.join(", ")}.` : "",
    "This advisory ran after the tool completed and did not undo or halt it. Run $scopelock for the full report.",
  ].filter(Boolean).join(" ");
  return hookOutput("PostToolUse", facts, "ScopeLock found a post-tool condition that needs attention.");
}

function looksLikeCompletion(message) {
  const text = sanitizeText(message, 4000).toLowerCase();
  return /\b(complete|completed|done|finished|implemented|ready for review|all tests pass|hand-?off)\b/.test(text);
}

async function stopHook(input, projectRoot, context) {
  void projectRoot;
  if (context.result !== "active" || !looksLikeCompletion(input.last_assistant_message)) return {};
  const outcome = context.latest_report?.outcome ?? null;
  if (outcome === "pass" || outcome === "warning") return {};
  return {
    systemMessage: outcome
      ? `ScopeLock remains active and the latest verification outcome is ${sanitizeText(outcome, 80)}. Review it before closing the task.`
      : "ScopeLock remains active without a verification report. Run $scopelock to verify before closing the task.",
  };
}

async function dispatch(input) {
  const eventName = input.hook_event_name;
  if (!["SessionStart", "PreToolUse", "PostToolUse", "Stop"].includes(eventName)) return {};
  const projectRoot = await discoverProjectRoot(input.cwd);
  const context = runHelper(projectRoot, "context", 2500);
  if (context.result === "unavailable") {
    if (eventName === "SessionStart" || eventName === "PostToolUse") {
      return hookOutput(
        eventName,
        "ScopeLock local state is unavailable. Run $scopelock to inspect it. This hook did not block or undo any tool action.",
        "ScopeLock local state needs review.",
      );
    }
    return {};
  }
  if (eventName === "SessionStart") return await sessionStart(input, projectRoot, context);
  if (eventName === "PreToolUse") return await preToolUse(input, projectRoot, context);
  if (eventName === "PostToolUse") return await postToolUse(input, projectRoot, context);
  return await stopHook(input, projectRoot, context);
}

export {
  classifyPath,
  dispatch,
  extractPatchPaths,
  looksLikeCompletion,
  normalizeCandidate,
  ruleMatches,
};

async function main() {
  let output = {};
  try {
    output = await dispatch(await readHookInput());
  } catch {
    // Advisory hooks fail open. Status and Verify remain authoritative.
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
