#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const STORAGE_NAME = ".codex-scope";
const INTERNAL_PREFIX = ".codex-scope/";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_GIT_BYTES = 64 * 1024 * 1024;
const MAX_TRACKED_HASH_BYTES = 64 * 1024 * 1024;
const MAX_TEXT_LENGTH = 4000;
const MAX_COMMAND_LENGTH = 2000;
const VALIDATION_TIMEOUT_MS = 5 * 60 * 1000;
const IS_WINDOWS = process.platform === "win32";
const LOCK_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{6}Z(?:-\d{2})?$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SAFE_GIT_PREFIX = [
  "--no-pager",
  "--no-optional-locks",
  "--no-lazy-fetch",
  "--no-replace-objects",
  "-c", "color.ui=false",
  "-c", "core.fsmonitor=false",
  "-c", "core.quotePath=true",
  "-c", "core.safecrlf=false",
  "-c", "diff.external=",
  "-c", "diff.renames=false",
  "-c", "status.renames=false",
  "-c", "submodule.recurse=false",
  "-c", "diff.submodule=short",
];
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

class ScopeLockError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ScopeLockError";
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/:/g, "").replace(/\.\d{3}Z$/, "Z");
}

function uniqueStrings(value, field, { allowEmpty = true, max = 100 } = {}) {
  if (!Array.isArray(value)) {
    throw new ScopeLockError("invalid-input", `${field} must be an array of strings.`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new ScopeLockError("invalid-input", `${field} must contain at least one item.`);
  }
  if (value.length > max) {
    throw new ScopeLockError("invalid-input", `${field} contains too many items.`);
  }
  const output = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new ScopeLockError("invalid-input", `${field} must contain non-empty strings.`);
    }
    const normalized = item.trim();
    if (normalized.length > MAX_TEXT_LENGTH || normalized.includes("\0")) {
      throw new ScopeLockError("invalid-input", `${field} contains an unsafe or oversized value.`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "�")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s]+)/gi, "$1=[REDACTED]")
    .replace(/(--(?:api[-_]?key|password|token|secret|credential)(?:=|\s+))("[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function safeUserString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ScopeLockError("invalid-input", `${field} must be a non-empty string.`);
  }
  if (value.length > MAX_TEXT_LENGTH || value.includes("\0")) {
    throw new ScopeLockError("invalid-input", `${field} is oversized or unsafe.`);
  }
  return sanitizeText(value.trim());
}

function rejectUnknownKeys(value, allowedKeys) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new ScopeLockError("invalid-input", "The input contains unsupported fields.");
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { projectRoot: ".", state: undefined };
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === "--project-root") {
      options.projectRoot = rest[index + 1];
      index += 1;
    } else if (item === "--state") {
      options.state = rest[index + 1];
      index += 1;
    } else {
      throw new ScopeLockError("invalid-arguments", "Unknown command-line argument.");
    }
  }
  if (!command) throw new ScopeLockError("invalid-arguments", "A command is required.");
  if (typeof options.projectRoot !== "string" || options.projectRoot.includes("\0")) {
    throw new ScopeLockError("invalid-arguments", "The project root is invalid.");
  }
  return { command, options };
}

async function readStdinJson({ optional = false } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new ScopeLockError("invalid-input", "Input JSON is too large.");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString("utf8").trim();
  if (!source && optional) return {};
  if (!source) throw new ScopeLockError("invalid-input", "One JSON object is required on standard input.");
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw new ScopeLockError("invalid-input", "Standard input must contain one valid JSON object.");
  }
}

async function resolveProjectRoot(rawRoot) {
  const absolute = path.resolve(rawRoot);
  let resolved;
  try {
    resolved = await realpath(absolute);
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) throw new Error("not directory");
  } catch {
    throw new ScopeLockError("invalid-project-root", "The project root must be an existing directory.");
  }
  return resolved;
}

function comparablePath(value) {
  const normalized = path.normalize(value);
  return IS_WINDOWS ? normalized.toLowerCase() : normalized;
}

function isWithin(root, candidate) {
  const relative = path.relative(comparablePath(root), comparablePath(candidate));
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

function decodeGitUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ScopeLockError("unsupported-git-encoding", "Git returned path or repository data that is not valid UTF-8.");
  }
}

function runGit(projectRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", [...SAFE_GIT_PREFIX, ...args], {
    cwd: projectRoot,
    env: gitEnvironment(),
    encoding: null,
    windowsHide: true,
    maxBuffer: MAX_GIT_BYTES,
  });
  if (result.error) {
    if (allowFailure) return { ok: false, status: null, stdout: Buffer.alloc(0) };
    throw new ScopeLockError("git-unavailable", "Git could not be executed.");
  }
  if (result.status !== 0) {
    if (allowFailure) return { ok: false, status: result.status, stdout: result.stdout ?? Buffer.alloc(0) };
    throw new ScopeLockError("git-command-failed", "Git repository inspection failed.", { exit_status: result.status });
  }
  return { ok: true, status: result.status, stdout: result.stdout ?? Buffer.alloc(0) };
}

function gitText(projectRoot, args, options = {}) {
  const result = runGit(projectRoot, args, options);
  return { ...result, text: decodeGitUtf8(result.stdout).trim() };
}

function rejectExecutableGitFilters(projectRoot) {
  for (const scope of ["--local", "--worktree"]) {
    const result = runGit(
      projectRoot,
      ["config", scope, "--null", "--get-regexp", "^filter\\..*\\.(clean|process)$"],
      { allowFailure: true },
    );
    if (result.ok && result.stdout.length > 0) {
      throw new ScopeLockError(
        "active-git-filter",
        "ScopeLock will not inspect a repository with executable repository-local Git clean or process filters configured.",
      );
    }
    if (!result.ok && ![1, 5].includes(result.status)) {
      throw new ScopeLockError("git-config-unavailable", "Git filter configuration could not be inspected safely.");
    }
  }
}

async function getRepositoryInfo(projectRoot) {
  const inside = gitText(projectRoot, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (!inside.ok || inside.text !== "true") return { supported: false, reason: "not-a-git-worktree" };

  const gitRootText = gitText(projectRoot, ["rev-parse", "--show-toplevel"]).text;
  const gitRoot = await realpath(gitRootText);
  if (!isWithin(gitRoot, projectRoot)) {
    throw new ScopeLockError("invalid-project-root", "The selected project is outside the detected Git root.");
  }
  const relativeProject = path.relative(gitRoot, projectRoot).split(path.sep).join("/");
  const branchResult = gitText(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  const headResult = gitText(projectRoot, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const objectFormatResult = gitText(projectRoot, ["rev-parse", "--show-object-format"], { allowFailure: true });
  const shallowResult = gitText(projectRoot, ["rev-parse", "--is-shallow-repository"], { allowFailure: true });

  return {
    supported: true,
    gitRoot,
    git_root_relationship: relativeProject ? "project-within-git-root" : "same-as-project",
    project_prefix: relativeProject,
    branch_state: branchResult.ok ? "named" : headResult.ok ? "detached" : "unborn",
    branch: branchResult.ok ? branchResult.text : null,
    head: headResult.ok ? headResult.text : null,
    object_format: objectFormatResult.ok ? objectFormatResult.text : "sha1",
    shallow: shallowResult.ok ? shallowResult.text === "true" : null,
  };
}

function splitFixed(record, fieldCountBeforePath) {
  const fields = [];
  let start = 0;
  for (let count = 0; count < fieldCountBeforePath; count += 1) {
    const next = record.indexOf(" ", start);
    if (next < 0) return null;
    fields.push(record.slice(start, next));
    start = next + 1;
  }
  fields.push(record.slice(start));
  return fields;
}

function changeName(code) {
  return ({ M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", T: "type-changed", U: "unmerged" })[code] ?? "changed";
}

function normalizeGitPath(rawPath, repositoryInfo) {
  if (typeof rawPath !== "string" || !rawPath || /[\u0000-\u001f\u007f]/.test(rawPath)) return null;
  const value = rawPath.replace(/\\/g, "/");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").includes("..")) return null;
  if (!repositoryInfo.project_prefix) return value;
  if (value === repositoryInfo.project_prefix) return ".";
  const prefix = `${repositoryInfo.project_prefix}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function parsePorcelainV2(buffer, repositoryInfo) {
  const parts = decodeGitUtf8(buffer).split("\0");
  const observations = [];
  const limitations = [];
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    if (!record) continue;
    let observation;
    if (record.startsWith("1 ")) {
      const fields = splitFixed(record, 8);
      if (!fields) continue;
      const [type, xy, sub, modeHead, modeIndex, modeWorktree, headOid, indexOid, rawPath] = fields;
      observation = { type, xy, sub, mode_head: modeHead, mode_index: modeIndex, mode_worktree: modeWorktree, head_oid: headOid, index_oid: indexOid, rawPath };
    } else if (record.startsWith("2 ")) {
      const fields = splitFixed(record, 9);
      if (!fields) continue;
      const [type, xy, sub, modeHead, modeIndex, modeWorktree, headOid, indexOid, score, rawPath] = fields;
      const rawOldPath = parts[index + 1] ?? "";
      index += 1;
      observation = { type, xy, sub, mode_head: modeHead, mode_index: modeIndex, mode_worktree: modeWorktree, head_oid: headOid, index_oid: indexOid, score, rawPath, rawOldPath };
    } else if (record.startsWith("u ")) {
      const fields = splitFixed(record, 10);
      if (!fields) continue;
      observation = { type: "u", xy: fields[1], sub: fields[2], rawPath: fields[10], index_oid: null };
    } else if (record.startsWith("? ")) {
      observation = { type: "?", xy: "??", sub: "N...", rawPath: record.slice(2), index_oid: null };
    } else {
      continue;
    }

    const projectPath = normalizeGitPath(observation.rawPath, repositoryInfo);
    const oldPath = observation.rawOldPath ? normalizeGitPath(observation.rawOldPath, repositoryInfo) : null;
    if (!projectPath || projectPath === STORAGE_NAME || projectPath.startsWith(INTERNAL_PREFIX)) {
      if (!projectPath && observation.rawPath) limitations.push("unsafe-or-outside-project-path-omitted");
      continue;
    }
    const x = observation.xy[0] ?? ".";
    const y = observation.xy[1] ?? ".";
    const changeCode = observation.type === "?" ? "A" : observation.type === "2" ? "R" : y !== "." ? y : x;
    observations.push({
      path: projectPath,
      old_path: oldPath,
      kind: observation.type === "?" ? "untracked" : observation.type === "u" ? "unmerged" : "tracked",
      status: observation.xy,
      staged: x !== "." && x !== "?",
      worktree: y !== "." && y !== "?",
      change: changeName(changeCode),
      index_oid: observation.index_oid,
      submodule: observation.sub !== "N..." ? observation.sub : null,
    });
  }
  observations.sort((a, b) => a.path.localeCompare(b.path));
  return { observations, limitations: [...new Set(limitations)] };
}

function parseNameStatus(buffer, repositoryInfo) {
  const parts = decodeGitUtf8(buffer).split("\0").filter((item) => item !== "");
  const changes = [];
  const limitations = [];
  for (let index = 0; index < parts.length; ) {
    let statusCode = parts[index];
    let firstPath;
    index += 1;
    if (statusCode.includes("\t")) {
      const tab = statusCode.indexOf("\t");
      firstPath = statusCode.slice(tab + 1);
      statusCode = statusCode.slice(0, tab);
    } else {
      firstPath = parts[index] ?? "";
      index += 1;
    }
    const code = statusCode[0];
    let rawOld = null;
    let rawCurrent = firstPath;
    if (code === "R" || code === "C") {
      rawOld = firstPath;
      rawCurrent = parts[index] ?? "";
      index += 1;
    }
    const currentPath = normalizeGitPath(rawCurrent, repositoryInfo);
    const oldPath = rawOld ? normalizeGitPath(rawOld, repositoryInfo) : null;
    if (!currentPath) {
      limitations.push("unsafe-or-outside-project-committed-path-omitted");
      continue;
    }
    changes.push({ path: currentPath, old_path: oldPath, change: changeName(code), source: "committed" });
  }
  return { changes, limitations: [...new Set(limitations)] };
}

function isSensitivePath(projectPath) {
  const base = projectPath.split("/").at(-1).toLowerCase();
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    [".npmrc", ".pypirc", ".netrc", "credentials", "credentials.json", "secrets.json"].includes(base) ||
    /(?:^|[._-])(secret|secrets|credential|credentials|token|tokens|cookie|cookies)(?:[._-]|$)/i.test(base) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(base) ||
    /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(base)
  );
}

async function hashTrackedFile(projectRoot, projectPath) {
  const lexical = path.resolve(projectRoot, ...projectPath.split("/"));
  if (!isWithin(projectRoot, lexical)) return null;
  let metadata;
  let resolved;
  try {
    metadata = await lstat(lexical);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_TRACKED_HASH_BYTES) return null;
    resolved = await realpath(lexical);
    if (!isWithin(projectRoot, resolved)) return null;
  } catch {
    return null;
  }

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(resolved, flags);
    const hash = createHash("sha256");
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function detectRepositoryBoundaries(projectRoot, observations) {
  const limitations = [];
  for (const observation of observations) {
    if (observation.submodule) limitations.push(`submodule-state:${observation.path}`);
    const candidate = path.resolve(projectRoot, ...observation.path.split("/"));
    try {
      const metadata = await lstat(candidate);
      if (metadata.isDirectory()) {
        await access(path.join(candidate, ".git"));
        limitations.push(`nested-git-repository:${observation.path}`);
      }
    } catch {
      // Missing paths and ordinary directories are not boundary findings.
    }
  }
  return [...new Set(limitations)];
}

async function captureOnce(projectRoot, fingerprintPaths = new Set(), { checkFilters = false } = {}) {
  const repository = await getRepositoryInfo(projectRoot);
  if (!repository.supported) return { supported: false, repository };
  if (checkFilters) rejectExecutableGitFilters(projectRoot);
  const statusBuffer = runGit(projectRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "."]).stdout;
  const parsed = parsePorcelainV2(statusBuffer, repository);
  const indexBuffer = runGit(projectRoot, ["ls-files", "--stage", "-z", "--", "."]).stdout;
  const sensitive_path_hash_exclusions = [];

  for (const observation of parsed.observations) {
    if (observation.kind !== "tracked" || !fingerprintPaths.has(observation.path)) continue;
    if (isSensitivePath(observation.path)) {
      sensitive_path_hash_exclusions.push(observation.path);
      continue;
    }
    observation.worktree_sha256 = await hashTrackedFile(projectRoot, observation.path);
  }

  const boundaryLimitations = await detectRepositoryBoundaries(projectRoot, parsed.observations);
  const tokenPayload = {
    branch_state: repository.branch_state,
    branch: repository.branch,
    head: repository.head,
    object_format: repository.object_format,
    index: sha256(indexBuffer),
    worktree: sha256(stableJson(parsed.observations)),
  };
  return {
    supported: true,
    repository,
    observations: parsed.observations,
    index_fingerprint: tokenPayload.index,
    worktree_fingerprint: tokenPayload.worktree,
    capture_token: sha256(stableJson(tokenPayload)),
    sensitive_path_hash_exclusions,
    limitations: [...new Set([...parsed.limitations, ...boundaryLimitations])],
  };
}

function testDelayMs() {
  const value = Number(process.env.SCOPELOCK_TEST_CAPTURE_DELAY_MS ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(1000, value)) : 0;
}

function testPointerDelayMs() {
  const value = Number(process.env.SCOPELOCK_TEST_POINTER_WRITE_DELAY_MS ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(1000, value)) : 0;
}

async function delay(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureRepository(projectRoot, fingerprintPaths = new Set(), { fingerprintCurrentTracked = false } = {}) {
  let effectiveFingerprintPaths = new Set(fingerprintPaths);
  let capture = await captureOnce(projectRoot, effectiveFingerprintPaths, { checkFilters: true });
  if (!capture.supported) return capture;
  if (fingerprintCurrentTracked) {
    for (const observation of capture.observations) {
      if (observation.kind === "tracked" && !isSensitivePath(observation.path)) effectiveFingerprintPaths.add(observation.path);
    }
    capture = await captureOnce(projectRoot, effectiveFingerprintPaths);
  }
  await delay(testDelayMs());
  let check = await captureOnce(projectRoot, effectiveFingerprintPaths);
  if (check.capture_token === capture.capture_token) return { ...capture, concurrent: false, retried: false };

  capture = await captureOnce(projectRoot, effectiveFingerprintPaths);
  if (fingerprintCurrentTracked) {
    for (const observation of capture.observations) {
      if (observation.kind === "tracked" && !isSensitivePath(observation.path)) effectiveFingerprintPaths.add(observation.path);
    }
    capture = await captureOnce(projectRoot, effectiveFingerprintPaths);
  }
  await delay(testDelayMs());
  check = await captureOnce(projectRoot, effectiveFingerprintPaths);
  if (check.capture_token === capture.capture_token) {
    return { ...capture, concurrent: false, retried: true, limitations: [...new Set([...capture.limitations, "concurrent-change-retried"])] };
  }
  return { ...capture, concurrent: true, retried: true, limitations: [...new Set([...capture.limitations, "concurrent-change-during-inspection"])] };
}

function normalizeRuleSyntax(rawRule, { wholeProjectExplicit = false } = {}) {
  if (typeof rawRule !== "string" || !rawRule.trim()) throw new ScopeLockError("invalid-scope-rule", "Scope rules must be non-empty strings.");
  let value = rawRule.trim().replace(/\\/g, "/");
  if (value === ".") {
    if (!wholeProjectExplicit) throw new ScopeLockError("whole-project-requires-explicit-approval", "The whole-project rule requires explicit user approval.");
    return { path: ".", match: "directory" };
  }
  if (
    value.includes("\0") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/") ||
    value.startsWith("//") ||
    /^[A-Za-z]:/.test(value) ||
    /[*?{}\[\]]/.test(value)
  ) {
    throw new ScopeLockError("invalid-scope-rule", "Scope rules must use safe project-relative exact paths or directory prefixes.");
  }
  const directory = value.endsWith("/");
  const parts = value.split("/").filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.includes("..")) throw new ScopeLockError("invalid-scope-rule", "Scope rules cannot be empty or traverse outside the project.");
  value = parts.join("/") + (directory ? "/" : "");
  if (value === STORAGE_NAME || value.startsWith(INTERNAL_PREFIX)) {
    throw new ScopeLockError("reserved-scope-rule", "ScopeLock storage cannot be used as source scope.");
  }
  return { path: value, match: directory ? "directory" : "file" };
}

async function validateRuleBoundary(projectRoot, rule) {
  const target = path.resolve(projectRoot, ...rule.path.replace(/\/$/, "").split("/"));
  if (!isWithin(projectRoot, target)) throw new ScopeLockError("scope-boundary-escape", "A scope rule escapes the project root.");
  let candidate = target;
  while (true) {
    try {
      const resolved = await realpath(candidate);
      if (!isWithin(projectRoot, resolved)) throw new ScopeLockError("scope-boundary-escape", "A scope rule resolves outside the project root.");
      if (candidate === target) {
        const metadata = await lstat(candidate);
        if (metadata.isSymbolicLink()) throw new ScopeLockError("unsafe-scope-link", "A scope rule targets a symbolic link or reparse point.");
        if (rule.match === "directory" && !metadata.isDirectory()) throw new ScopeLockError("scope-type-mismatch", "A directory rule targets an existing non-directory path.");
        if (rule.match === "file" && metadata.isDirectory()) throw new ScopeLockError("scope-type-mismatch", "An exact file rule targets an existing directory.");
      }
      return rule;
    } catch (error) {
      if (error instanceof ScopeLockError) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate || !isWithin(projectRoot, parent)) throw new ScopeLockError("scope-boundary-unavailable", "A scope rule could not be validated inside the project root.");
      candidate = parent;
    }
  }
}

async function normalizeRules(projectRoot, rawRules, options = {}) {
  const rules = [];
  const seen = new Set();
  for (const raw of rawRules) {
    const rule = normalizeRuleSyntax(raw, options);
    const key = IS_WINDOWS ? rule.path.toLowerCase() : rule.path;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(await validateRuleBoundary(projectRoot, rule));
  }
  return rules;
}

function ruleMatches(rule, projectPath) {
  const normalizedPath = IS_WINDOWS ? projectPath.toLowerCase() : projectPath;
  const normalizedRule = IS_WINDOWS ? rule.path.toLowerCase() : rule.path;
  if (normalizedRule === ".") return true;
  if (rule.match === "file") return normalizedPath === normalizedRule;
  const prefix = normalizedRule.replace(/\/$/, "");
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

async function ensureStorage(projectRoot, { create = false } = {}) {
  const storagePath = path.join(projectRoot, STORAGE_NAME);
  try {
    const metadata = await lstat(storagePath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ScopeLockError("unsafe-storage", "ScopeLock storage is not a safe local directory.");
  } catch (error) {
    if (error instanceof ScopeLockError) throw error;
    if (!create) throw new ScopeLockError("no-storage", "No ScopeLock storage exists in this project.");
    try {
      await mkdir(storagePath);
    } catch {
      throw new ScopeLockError("storage-create-failed", "ScopeLock storage could not be created safely.");
    }
  }
  const resolved = await realpath(storagePath);
  if (!isWithin(projectRoot, resolved) || comparablePath(resolved) !== comparablePath(storagePath)) {
    throw new ScopeLockError("unsafe-storage", "ScopeLock storage resolves outside its expected project location.");
  }
  return storagePath;
}

async function ensureChildDirectory(parent, name) {
  const child = path.join(parent, name);
  try {
    const metadata = await lstat(child);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ScopeLockError("unsafe-storage", "A ScopeLock storage directory is unsafe.");
  } catch (error) {
    if (error instanceof ScopeLockError) throw error;
    await mkdir(child);
  }
  const resolved = await realpath(child);
  if (!isWithin(parent, resolved)) throw new ScopeLockError("unsafe-storage", "A ScopeLock storage directory escapes its parent.");
  return child;
}

async function readJsonRecord(filePath, description) {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JSON_BYTES) throw new Error("unsafe");
    const source = await readFile(filePath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(source);
    return { value: JSON.parse(text), digest: sha256(source) };
  } catch {
    throw new ScopeLockError("corrupt-storage", `${description} is missing, unsafe, or invalid.`);
  }
}

async function readJsonFile(filePath, description) {
  return (await readJsonRecord(filePath, description)).value;
}

async function fileDigest(filePath) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JSON_BYTES) throw new ScopeLockError("corrupt-storage", "A ScopeLock record is unsafe or oversized.");
  return sha256(await readFile(filePath));
}

async function writeExclusive(filePath, content) {
  try {
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch {
    throw new ScopeLockError("record-write-failed", "An immutable ScopeLock record could not be created exclusively.");
  }
}

async function activePointerDigest(target) {
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new ScopeLockError("corrupt-storage", "The active Lock pointer could not be inspected safely.");
  }
  return (await readJsonRecord(target, "The active Lock pointer")).digest;
}

async function writeActivePointer(storagePath, pointer, { expectedDigest }) {
  const target = path.join(storagePath, "active.json");
  const writerLock = path.join(storagePath, ".active-write.lock");
  const temporary = path.join(storagePath, `.active.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  await delay(testPointerDelayMs());
  let lockHandle;
  for (let attempt = 0; attempt <= 10; attempt += 1) {
    try {
      lockHandle = await open(writerLock, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt === 10) {
        throw new ScopeLockError("storage-write-locked", "Another ScopeLock writer may be active. The active pointer was not changed.");
      }
      await delay(25);
    }
  }
  try {
    await lockHandle.writeFile(`${process.pid}\n`, "utf8");
  } catch {
    await lockHandle?.close().catch(() => {});
    await rm(writerLock, { force: true }).catch(() => {});
    throw new ScopeLockError("storage-write-locked", "Another ScopeLock writer may be active. The active pointer was not changed.");
  }

  let writeSucceeded = false;
  try {
    const currentDigest = await activePointerDigest(target);
    if (currentDigest !== expectedDigest) {
      throw new ScopeLockError("concurrent-storage-change", "The active Lock pointer changed during this operation. The newer pointer was preserved.");
    }

    await writeExclusive(temporary, `${JSON.stringify(pointer, null, 2)}\n`);
    try {
      await rename(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
        throw new ScopeLockError("active-pointer-write-failed", "The active Lock pointer could not be replaced.");
      }

      const backup = path.join(storagePath, `.active.${process.pid}.${randomBytes(6).toString("hex")}.bak`);
      await rename(target, backup).catch(() => {
        throw new ScopeLockError("active-pointer-write-failed", "The existing active Lock pointer could not be preserved for replacement.");
      });
      try {
        await rename(temporary, target);
      } catch {
        await rename(backup, target).catch(() => {});
        throw new ScopeLockError("active-pointer-write-failed", "The active Lock pointer replacement failed; recovery may be required.");
      }
      await rm(backup, { force: true }).catch(() => {});
    }
    writeSucceeded = true;
  } finally {
    if (!writeSucceeded) await rm(temporary, { force: true }).catch(() => {});
    await lockHandle.close().catch(() => {});
    await rm(writerLock, { force: true }).catch(() => {});
  }
}

function validatePointerBasics(pointer) {
  const allowedKeys = new Set([
    "schema",
    "active_lock_id",
    "lock_path",
    "updated_at",
    "state",
    "contract_sha256",
    "baseline_sha256",
    "amendments",
    "latest_report",
  ]);
  if (
    !pointer ||
    typeof pointer !== "object" ||
    Array.isArray(pointer) ||
    Object.keys(pointer).some((key) => !allowedKeys.has(key)) ||
    pointer.schema !== "scopelock/active/v1" ||
    !LOCK_ID_RE.test(pointer.active_lock_id ?? "") ||
    pointer.lock_path !== `locks/${pointer.active_lock_id}` ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(pointer.updated_at ?? "") ||
    !["active", "closed", "abandoned"].includes(pointer.state) ||
    !SHA256_RE.test(pointer.contract_sha256 ?? "") ||
    !SHA256_RE.test(pointer.baseline_sha256 ?? "") ||
    !Array.isArray(pointer.amendments)
  ) {
    throw new ScopeLockError("corrupt-storage", "The active Lock pointer has an invalid schema or path.");
  }
  const amendmentPaths = new Set();
  for (const entry of pointer.amendments) {
    const keys = entry && typeof entry === "object" && !Array.isArray(entry) ? Object.keys(entry) : [];
    if (
      keys.length !== 2 ||
      !keys.includes("path") ||
      !keys.includes("sha256") ||
      typeof entry.path !== "string" ||
      !/^amendments\/\d{4}-\d{2}-\d{2}T\d{6}Z(?:-\d{2})?\.md$/.test(entry.path) ||
      !SHA256_RE.test(entry.sha256 ?? "") ||
      amendmentPaths.has(entry.path)
    ) {
      throw new ScopeLockError("corrupt-storage", "The active pointer contains an invalid amendment reference.");
    }
    amendmentPaths.add(entry.path);
  }
  if (pointer.latest_report !== undefined) {
    const report = pointer.latest_report;
    const reportKeys = report && typeof report === "object" && !Array.isArray(report) ? Object.keys(report) : [];
    if (
      !report ||
      typeof report !== "object" ||
      Array.isArray(report) ||
      reportKeys.some((key) => !["path", "sha256", "created_at", "outcome", "validation_evidence"].includes(key)) ||
      typeof report.path !== "string" ||
      !/^reports\/\d{4}-\d{2}-\d{2}T\d{6}Z(?:-\d{2})?\.md$/.test(report.path) ||
      !SHA256_RE.test(report.sha256 ?? "") ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(report.created_at ?? "") ||
      !["pass", "warning", "fail", "incomplete"].includes(report.outcome) ||
      !Array.isArray(report.validation_evidence)
    ) {
      throw new ScopeLockError("corrupt-storage", "The active pointer contains an invalid latest report reference.");
    }
    for (const evidence of report.validation_evidence) {
      if (
        !evidence ||
        typeof evidence !== "object" ||
        Array.isArray(evidence) ||
        typeof evidence.command !== "string" ||
        !evidence.command ||
        evidence.command.length > MAX_COMMAND_LENGTH ||
        typeof evidence.required !== "boolean" ||
        !["passed", "failed", "not_run", "unknown"].includes(evidence.result) ||
        !(evidence.exit_status === null || Number.isInteger(evidence.exit_status)) ||
        !(evidence.duration_ms === null || (Number.isFinite(evidence.duration_ms) && evidence.duration_ms >= 0)) ||
        typeof evidence.summary !== "string"
      ) {
        throw new ScopeLockError("corrupt-storage", "The active pointer contains invalid validation evidence.");
      }
    }
  }
}

function validateStoredPath(value, { allowNull = false } = {}) {
  if (allowNull && value === null) return true;
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_TEXT_LENGTH ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) return false;
  const parts = value.split("/");
  return !parts.some((part) => !part || part === "." || part === "..") && value !== STORAGE_NAME && !value.startsWith(INTERNAL_PREFIX);
}

function validateStoredRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule) || Object.keys(rule).some((key) => !["path", "match"].includes(key))) return false;
  if (!["file", "directory"].includes(rule.match)) return false;
  try {
    const normalized = normalizeRuleSyntax(rule.path, { wholeProjectExplicit: true });
    return normalized.path === rule.path && normalized.match === rule.match;
  } catch {
    return false;
  }
}

function validStringArray(value, { allowEmpty = true, maxLength = MAX_TEXT_LENGTH } = {}) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === "string" && item.length > 0 && item.length <= maxLength && !item.includes("\0"));
}

function validateBaseline(baseline, lockId) {
  const allowedKeys = new Set([
    "schema",
    "version",
    "lock_id",
    "captured_at",
    "project",
    "repository_kind",
    "repository",
    "index_fingerprint",
    "worktree_fingerprint",
    "capture_token",
    "scope",
    "pre_existing",
    "sensitive_path_hash_exclusions",
    "comparison_limitations",
  ]);
  if (
    !baseline ||
    typeof baseline !== "object" ||
    Array.isArray(baseline) ||
    Object.keys(baseline).some((key) => !allowedKeys.has(key)) ||
    baseline.schema !== "scopelock/snapshot/v1" ||
    baseline.version !== 1 ||
    baseline.lock_id !== lockId ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(baseline.captured_at ?? "") ||
    baseline.repository_kind !== "git" ||
    !SHA256_RE.test(baseline.index_fingerprint ?? "") ||
    !SHA256_RE.test(baseline.worktree_fingerprint ?? "") ||
    !SHA256_RE.test(baseline.capture_token ?? "")
  ) {
    throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has an invalid schema or identity.");
  }
  if (
    !baseline.project ||
    typeof baseline.project !== "object" ||
    Array.isArray(baseline.project) ||
    baseline.project.root !== "." ||
    !["same-as-project", "project-within-git-root"].includes(baseline.project.git_root_relationship)
  ) {
    throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has an invalid project boundary.");
  }
  const repository = baseline.repository;
  if (
    !repository ||
    typeof repository !== "object" ||
    Array.isArray(repository) ||
    repository.kind !== "git" ||
    !["same-as-project", "project-within-git-root"].includes(repository.git_root_relationship) ||
    !["named", "detached", "unborn"].includes(repository.branch_state) ||
    !(repository.branch === null || (typeof repository.branch === "string" && repository.branch.length <= 512 && !/[\u0000-\u001f\u007f]/.test(repository.branch))) ||
    !(repository.head === null || /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(repository.head)) ||
    !["sha1", "sha256"].includes(repository.object_format) ||
    !(repository.shallow === null || typeof repository.shallow === "boolean")
  ) {
    throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has invalid repository identity.");
  }
  const scope = baseline.scope;
  if (
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    typeof scope.objective !== "string" ||
    !scope.objective ||
    scope.objective.length > MAX_TEXT_LENGTH ||
    !Array.isArray(scope.allowed) ||
    scope.allowed.length === 0 ||
    !scope.allowed.every(validateStoredRule) ||
    !Array.isArray(scope.forbidden) ||
    !scope.forbidden.every(validateStoredRule) ||
    !validStringArray(scope.constraints) ||
    !validStringArray(scope.definition_of_done) ||
    !validStringArray(scope.validation_requirements, { maxLength: MAX_COMMAND_LENGTH })
  ) {
    throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has invalid scope data.");
  }
  if (!Array.isArray(baseline.pre_existing)) {
    throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has invalid path observations.");
  }
  const observedPaths = new Set();
  for (const observation of baseline.pre_existing) {
    if (
      !observation ||
      typeof observation !== "object" ||
      Array.isArray(observation) ||
      !validateStoredPath(observation.path) ||
      !validateStoredPath(observation.old_path, { allowNull: true }) ||
      !["tracked", "untracked", "unmerged"].includes(observation.kind) ||
      typeof observation.status !== "string" ||
      typeof observation.change !== "string" ||
      typeof observation.staged !== "boolean" ||
      typeof observation.worktree !== "boolean" ||
      !(observation.submodule === null || typeof observation.submodule === "string") ||
      !(observation.index_oid === null || /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(observation.index_oid)) ||
      !(observation.worktree_sha256 === undefined || SHA256_RE.test(observation.worktree_sha256)) ||
      !(observation.fingerprint_limited === undefined || ["sensitive-path", "content-unavailable", "untracked-content-not-read"].includes(observation.fingerprint_limited)) ||
      observedPaths.has(comparableScopePath(observation.path))
    ) {
      throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has invalid path observations.");
    }
    observedPaths.add(comparableScopePath(observation.path));
  }
  if (
    !Array.isArray(baseline.sensitive_path_hash_exclusions) ||
    !baseline.sensitive_path_hash_exclusions.every((item) => validateStoredPath(item)) ||
    !validStringArray(baseline.comparison_limitations)
  ) {
    throw new ScopeLockError("corrupt-storage", "The active Lock Baseline has invalid limitations.");
  }
}

async function allocateId(directory) {
  const base = timestampId();
  for (let index = 0; index < 100; index += 1) {
    const id = index === 0 ? base : `${base}-${String(index).padStart(2, "0")}`;
    try {
      await access(path.join(directory, id));
    } catch {
      return id;
    }
  }
  throw new ScopeLockError("id-allocation-failed", "A unique ScopeLock record ID could not be allocated.");
}

async function allocateFileId(directory, extension) {
  const base = timestampId();
  for (let index = 0; index < 100; index += 1) {
    const id = index === 0 ? base : `${base}-${String(index).padStart(2, "0")}`;
    try {
      await access(path.join(directory, `${id}${extension}`));
    } catch {
      return id;
    }
  }
  throw new ScopeLockError("id-allocation-failed", "A unique ScopeLock record ID could not be allocated.");
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function markdownLines(items, evidence = "inferred") {
  if (items.length === 0) return `- [${evidence}] None.`;
  return items.map((item) => `- [${evidence}] ${sanitizeText(item)}`).join("\n");
}

function markdownRules(rules) {
  return rules.map((rule) => `- [inferred] ${codeSpan(rule.path)} (${rule.match})`).join("\n") || "- [inferred] None.";
}

function codeSpan(value) {
  const text = sanitizeText(value);
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(1, ...runs.map((run) => run.length + 1)));
  return `${fence}${text}${fence}`;
}

function blockquote(text) {
  return sanitizeText(text).split(/\r?\n/).map((line) => `> ${line}`).join("\n");
}

function buildContract({ lockId, createdAt, objective, allowed, forbidden, constraints, definitionOfDone, validationRequirements, baseline }) {
  return `---\nformat: "scopelock/v1"\nversion: 1\nlock_id: ${yamlString(lockId)}\ncreated_at: ${yamlString(createdAt)}\nlifecycle: "active"\nproject_root: "."\nrepository_kind: "git"\nbaseline: "baseline.json"\n---\n\n# ScopeLock Contract\n\n## Objective\n\n[inferred] User-approved task objective:\n\n${blockquote(objective)}\n\n## Allowed scope\n\n${markdownRules(allowed)}\n\n## Forbidden scope\n\n${markdownRules(forbidden)}\n\n## Locked constraints\n\n${markdownLines(constraints)}\n\n## Definition of done\n\n${markdownLines(definitionOfDone)}\n\n## Validation requirements\n\n${markdownLines(validationRequirements)}\n\n## Baseline summary\n\n- [verified] Repository kind: Git.\n- [verified] Branch: ${baseline.repository.branch ?? baseline.repository.branch_state}.\n- [verified] HEAD: ${baseline.repository.head ?? "unborn"}.\n- [verified] Pre-existing changed paths: ${baseline.pre_existing.length}.\n\n## Evidence limitations\n\n${markdownLines(baseline.comparison_limitations, "uncertain")}\n`;
}

function buildAmendment({ schema, amendment_id, lock_id, created_at, reason, added_allowed, known_findings_before }) {
  return `---\nschema: ${yamlString(schema)}\namendment_id: ${yamlString(amendment_id)}\nlock_id: ${yamlString(lock_id)}\ncreated_at: ${yamlString(created_at)}\nadded_allowed_json: ${JSON.stringify(added_allowed)}\nknown_findings_before_json: ${JSON.stringify(known_findings_before)}\n---\n\n# ScopeLock Amendment\n\n## Reason\n\n[inferred] ${sanitizeText(reason)}\n\n## Added allowed scope\n\n${markdownRules(added_allowed)}\n\n## Findings observed before approval\n\n${markdownLines(known_findings_before, "verified")}\n`;
}

function parseFrontmatterJson(markdown, key) {
  const frontmatterEnd = markdown.indexOf("\n---", 4);
  if (!markdown.startsWith("---\n") || frontmatterEnd < 0) throw new ScopeLockError("corrupt-storage", "An amendment has invalid frontmatter.");
  const match = markdown.slice(4, frontmatterEnd).match(new RegExp(`^${key}: (.+)$`, "m"));
  if (!match) throw new ScopeLockError("corrupt-storage", "An amendment is missing required machine-readable fields.");
  try {
    return JSON.parse(match[1]);
  } catch {
    throw new ScopeLockError("corrupt-storage", "An amendment contains invalid machine-readable fields.");
  }
}

async function loadActive(projectRoot, { requireActive = true } = {}) {
  const storagePath = await ensureStorage(projectRoot, { create: false });
  const activePath = path.join(storagePath, "active.json");
  const pointerRecord = await readJsonRecord(activePath, "The active Lock pointer");
  const pointer = pointerRecord.value;
  validatePointerBasics(pointer);
  if (requireActive && pointer.state !== "active") throw new ScopeLockError("no-active-lock", "There is no active ScopeLock in this project.");

  const lockPath = path.join(storagePath, "locks", pointer.active_lock_id);
  const lockMetadata = await lstat(lockPath).catch(() => null);
  if (!lockMetadata?.isDirectory() || lockMetadata.isSymbolicLink() || !isWithin(storagePath, await realpath(lockPath))) {
    throw new ScopeLockError("corrupt-storage", "The active Lock directory is missing or unsafe.");
  }
  const contractPath = path.join(lockPath, "contract.md");
  const baselinePath = path.join(lockPath, "baseline.json");
  const contractDigest = await fileDigest(contractPath).catch(() => null);
  const baselineRecord = await readJsonRecord(baselinePath, "The active Lock Baseline").catch(() => null);
  if (!contractDigest || !baselineRecord || pointer.contract_sha256 !== contractDigest || pointer.baseline_sha256 !== baselineRecord.digest) {
    throw new ScopeLockError("corrupt-storage", "The active Lock contract or Baseline is missing or changed.");
  }
  const baseline = baselineRecord.value;
  validateBaseline(baseline, pointer.active_lock_id);

  const amendments = [];
  for (const entry of pointer.amendments ?? []) {
    if (!entry || typeof entry.path !== "string" || !entry.path.startsWith("amendments/") || !entry.path.endsWith(".md")) {
      throw new ScopeLockError("corrupt-storage", "The active pointer contains an invalid amendment path.");
    }
    const amendmentPath = path.join(lockPath, ...entry.path.split("/"));
    if (!isWithin(lockPath, amendmentPath) || (await fileDigest(amendmentPath)) !== entry.sha256) {
      throw new ScopeLockError("corrupt-storage", "An amendment is missing, unsafe, or changed.");
    }
    const markdown = await readFile(amendmentPath, "utf8");
    const amendmentId = path.basename(entry.path, ".md");
    if (
      parseFrontmatterJson(markdown, "schema") !== "scopelock/amendment/v1" ||
      parseFrontmatterJson(markdown, "amendment_id") !== amendmentId ||
      parseFrontmatterJson(markdown, "lock_id") !== pointer.active_lock_id
    ) {
      throw new ScopeLockError("corrupt-storage", "An amendment has an invalid identity.");
    }
    const addedAllowed = parseFrontmatterJson(markdown, "added_allowed_json");
    const knownFindingsBefore = parseFrontmatterJson(markdown, "known_findings_before_json");
    if (
      !Array.isArray(addedAllowed) ||
      addedAllowed.length === 0 ||
      !addedAllowed.every(validateStoredRule) ||
      !Array.isArray(knownFindingsBefore) ||
      !knownFindingsBefore.every((item) => validateStoredPath(item))
    ) {
      throw new ScopeLockError("corrupt-storage", "An amendment contains invalid scope data.");
    }
    amendments.push({
      id: amendmentId,
      added_allowed: addedAllowed,
      known_findings_before: knownFindingsBefore,
    });
  }
  if (pointer.latest_report) {
    const reportPath = path.join(lockPath, ...pointer.latest_report.path.split("/"));
    if (!isWithin(lockPath, reportPath) || (await fileDigest(reportPath)) !== pointer.latest_report.sha256) {
      throw new ScopeLockError("corrupt-storage", "The latest verification report is missing, unsafe, or changed.");
    }
  }
  return { storagePath, pointer, pointerDigest: pointerRecord.digest, lockPath, contractPath, baselinePath, baseline, amendments };
}

function classifyByRules(projectPath, baseline, amendments) {
  const forbidden = baseline.scope.forbidden.find((rule) => ruleMatches(rule, projectPath));
  if (forbidden) return { category: "out-of-scope", rule: forbidden.path, source: "forbidden" };
  const initialAllowed = baseline.scope.allowed.find((rule) => ruleMatches(rule, projectPath));
  if (initialAllowed) return { category: "in-scope", rule: initialAllowed.path, source: "initial" };
  for (const amendment of amendments) {
    const rule = amendment.added_allowed.find((candidate) => ruleMatches(candidate, projectPath));
    if (!rule) continue;
    const late = amendment.known_findings_before.some((knownPath) => comparableScopePath(knownPath) === comparableScopePath(projectPath));
    return { category: late ? "late-approved" : "approved-amendment", rule: rule.path, source: amendment.id };
  }
  return { category: "out-of-scope", rule: null, source: "default-deny" };
}

function comparableScopePath(value) {
  return IS_WINDOWS ? value.toLowerCase() : value;
}

function observationSignature(observation) {
  if (!observation) return null;
  return stableJson({
    kind: observation.kind,
    status: observation.status,
    change: observation.change,
    index_oid: observation.index_oid,
    old_path: observation.old_path,
    submodule: observation.submodule,
  });
}

function historyCompatibility(projectRoot, baselineRepository, currentRepository) {
  const changes = [];
  if (baselineRepository.git_root_relationship !== currentRepository.git_root_relationship) changes.push("git-root-relationship-changed");
  if (baselineRepository.object_format !== currentRepository.object_format) changes.push("git-object-format-changed");
  if (baselineRepository.branch_state !== currentRepository.branch_state || baselineRepository.branch !== currentRepository.branch) changes.push("branch-identity-changed");
  if (changes.length > 0) return { state: "stale", changes };
  if (baselineRepository.head === currentRepository.head) return { state: "comparable", changes: [] };
  if (!baselineRepository.head && currentRepository.head) return { state: "incomplete", changes: ["unborn-history-advanced"] };
  if (baselineRepository.head && !currentRepository.head) return { state: "stale", changes: ["history-became-unborn"] };
  if (baselineRepository.head && currentRepository.head) {
    const ancestor = runGit(projectRoot, ["merge-base", "--is-ancestor", baselineRepository.head, currentRepository.head], { allowFailure: true });
    if (ancestor.ok) return { state: "comparable", changes: ["head-advanced-with-baseline-ancestor"] };
    if (ancestor.status === 1) return { state: "stale", changes: ["baseline-head-is-not-an-ancestor"] };
    return { state: "incomplete", changes: ["git-ancestry-unavailable"] };
  }
  return { state: "comparable", changes: [] };
}

function addEvent(eventMap, event) {
  if (!event.path || event.path === STORAGE_NAME || event.path.startsWith(INTERNAL_PREFIX)) return;
  const key = comparableScopePath(event.path);
  const existing = eventMap.get(key);
  if (!existing) {
    eventMap.set(key, { ...event, sources: [...new Set(event.sources ?? [event.source].filter(Boolean))] });
    return;
  }
  existing.sources = [...new Set([...existing.sources, ...(event.sources ?? [event.source].filter(Boolean))])];
  existing.changes = [...new Set([...(existing.changes ?? [existing.change]), event.change].filter(Boolean))];
  if (event.old_path) existing.old_path = event.old_path;
}

async function committedChanges(projectRoot, baseline, currentRepository) {
  if (!baseline.repository.head || baseline.repository.head === currentRepository.head) return { changes: [], limitations: [] };
  const buffer = runGit(projectRoot, ["diff", "--name-status", "-z", "--find-renames", baseline.repository.head, currentRepository.head, "--", "."]).stdout;
  return parseNameStatus(buffer, currentRepository);
}

async function compareRepository(projectRoot, active) {
  const baseline = active.baseline;
  const safeFingerprintPaths = new Set(
    baseline.pre_existing
      .filter((item) => item.kind === "tracked" && !isSensitivePath(item.path))
      .map((item) => item.path),
  );
  const current = await captureRepository(projectRoot, safeFingerprintPaths, { fingerprintCurrentTracked: true });
  if (!current.supported) {
    return { state: "unavailable", baseline_critical: ["repository-kind-changed"], findings: emptyFindings(), limitations: ["not-a-git-worktree"], current: null };
  }
  const compatibility = historyCompatibility(projectRoot, baseline.repository, current.repository);
  const limitations = [...new Set([...(baseline.comparison_limitations ?? []), ...current.limitations])];
  if (current.concurrent) compatibility.state = "incomplete";

  const eventMap = new Map();
  const preExisting = [];
  const baselineMap = new Map(baseline.pre_existing.map((item) => [comparableScopePath(item.path), item]));
  const currentMap = new Map(current.observations.map((item) => [comparableScopePath(item.path), item]));

  if (compatibility.state === "comparable") {
    const committed = await committedChanges(projectRoot, baseline, current.repository);
    limitations.push(...committed.limitations);
    for (const change of committed.changes) {
      addEvent(eventMap, { ...change, evidence: "verified" });
      if (change.old_path && comparableScopePath(change.old_path) !== comparableScopePath(change.path)) {
        addEvent(eventMap, { path: change.old_path, change: "renamed-from", source: "committed", evidence: "verified", destination: change.path });
      }
    }
  }

  for (const observation of current.observations) {
    const baselineObservation = baselineMap.get(comparableScopePath(observation.path));
    if (!baselineObservation) {
      addEvent(eventMap, { path: observation.path, old_path: observation.old_path, change: observation.change, source: "worktree", evidence: "verified" });
      if (observation.old_path) addEvent(eventMap, { path: observation.old_path, change: "renamed-from", source: "worktree", evidence: "verified", destination: observation.path });
      continue;
    }

    if (baselineObservation.kind === "untracked" && observation.kind === "untracked") {
      preExisting.push({ category: "pre-existing", evidence: "uncertain", path: observation.path, change: observation.change, explanation: "The untracked path existed at Baseline; its contents were not read or hashed." });
      continue;
    }

    const signatureChanged = observationSignature(baselineObservation) !== observationSignature(observation);
    const indexChanged = Boolean(baselineObservation.index_oid && observation.index_oid && baselineObservation.index_oid !== observation.index_oid);
    const worktreeChanged = Boolean(
      baselineObservation.worktree_sha256 &&
      observation.worktree_sha256 &&
      baselineObservation.worktree_sha256 !== observation.worktree_sha256,
    );
    if (signatureChanged || indexChanged || worktreeChanged) {
      addEvent(eventMap, { path: observation.path, old_path: observation.old_path, change: observation.change, source: "worktree", evidence: "verified" });
    } else {
      preExisting.push({
        category: "pre-existing",
        evidence: baselineObservation.fingerprint_limited ? "uncertain" : "verified",
        path: observation.path,
        change: observation.change,
        explanation: baselineObservation.fingerprint_limited
          ? "The path existed at Baseline and was excluded from content fingerprinting."
          : "The tracked path matches its safe Baseline fingerprint and status.",
      });
    }
  }

  for (const baselineObservation of baseline.pre_existing) {
    if (currentMap.has(comparableScopePath(baselineObservation.path))) continue;
    addEvent(eventMap, {
      path: baselineObservation.path,
      change: baselineObservation.kind === "untracked" ? "removed-untracked-path" : "pre-existing-state-removed",
      source: "worktree",
      evidence: "verified",
    });
  }

  const findings = emptyFindings();
  findings.pre_existing = preExisting.sort((a, b) => a.path.localeCompare(b.path));
  for (const event of [...eventMap.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const classification = classifyByRules(event.path, baseline, active.amendments);
    const finding = {
      category: classification.category,
      evidence: event.evidence ?? "verified",
      path: event.path,
      change: event.changes ?? event.change,
      sources: event.sources,
      rule: classification.rule,
      old_path: event.old_path ?? null,
      destination: event.destination ?? null,
    };
    findings[categoryKey(classification.category)].push(finding);
  }

  return {
    state: compatibility.state,
    baseline_critical: compatibility.changes,
    findings,
    limitations: [...new Set(limitations)],
    current,
  };
}

function emptyFindings() {
  return { pre_existing: [], in_scope: [], out_of_scope: [], approved_amendment: [], late_approved: [], uncertain: [] };
}

function categoryKey(category) {
  return category.replaceAll("-", "_");
}

function healthFromComparison(comparison) {
  if (comparison.state === "stale") return "stale";
  if (comparison.state === "unavailable") return "unavailable";
  if (comparison.state === "incomplete") return "attention";
  const findings = comparison.findings;
  return findings.out_of_scope.length || findings.late_approved.length || findings.uncertain.length ? "attention" : "clean";
}

function recommendedStatusAction(comparison) {
  if (["stale", "unavailable", "incomplete"].includes(comparison.state)) return "Create a new Lock before relying on this result.";
  if (comparison.findings.out_of_scope.length) return `Review ${codeSpan(comparison.findings.out_of_scope[0].path)} before committing.`;
  if (comparison.findings.late_approved.length) return `Review ${codeSpan(comparison.findings.late_approved[0].path)} before closing ScopeLock.`;
  return "Continue the task.";
}

function joinPlainList(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function pathList(findings, max = 3) {
  return joinPlainList(findings.slice(0, max).map((finding) => codeSpan(finding.path)));
}

function unexpectedChangeLine(findings) {
  if (findings.length === 1) return `1 unexpected file changed: ${codeSpan(findings[0].path)}.`;
  if (findings.length <= 3) return `${findings.length} unexpected files changed: ${pathList(findings)}.`;
  return `${findings.length} unexpected files changed, including ${pathList(findings)}.`;
}

function expectedChangeLine(findings, tense) {
  if (findings.length === 0) return null;
  if (findings.length === 1) return `1 task file ${tense === "past" ? "was" : "is"} within scope.`;
  return `${findings.length} task files ${tense === "past" ? "were" : "are"} within scope.`;
}

function preExistingLine(findings) {
  if (findings.length === 0) return null;
  if (findings.length === 1) return `${codeSpan(findings[0].path)} was already changed before this task.`;
  if (findings.length <= 3) return `${pathList(findings)} were already changed before this task.`;
  return `${findings.length} files were already changed before this task.`;
}

function lateApprovedLine(findings) {
  if (findings.length === 1) return `${codeSpan(findings[0].path)} was approved only after ScopeLock detected it.`;
  return `${findings.length} files were approved only after ScopeLock detected them.`;
}

function uncertainLine(findings) {
  if (findings.length === 1) return `ScopeLock could not confidently classify ${codeSpan(findings[0].path)}.`;
  return `ScopeLock could not confidently classify ${findings.length} files.`;
}

function statusChecksLine(validationEvidence) {
  if (validationEvidence.length === 0) return null;
  if (validationEvidence.some((item) => item.result === "failed")) return "The last recorded checks failed.";
  if (validationEvidence.some((item) => item.result === "unknown")) return "The required checks could not be confirmed.";
  if (validationEvidence.some((item) => item.required && item.result === "not_run")) return "Required checks have not run yet.";
  if (validationEvidence.every((item) => item.result === "passed")) return "The last recorded checks passed.";
  return "The required checks are incomplete.";
}

function verifyChecksLine(validationEvidence) {
  if (validationEvidence.length === 0) return null;
  if (validationEvidence.some((item) => item.result === "failed")) return "Checks failed.";
  if (validationEvidence.some((item) => item.result === "unknown")) return "Checks could not be confirmed.";
  if (validationEvidence.some((item) => item.required && item.result === "not_run")) return "Required checks did not run.";
  if (validationEvidence.every((item) => item.result === "passed")) return "Checks passed.";
  return "Checks are incomplete.";
}

function scopeLines(comparison, tense) {
  const findings = comparison.findings;
  const expected = [...findings.in_scope, ...findings.approved_amendment];
  const lines = [];
  if (["stale", "unavailable", "incomplete"].includes(comparison.state)) {
    lines.push("The repository no longer has enough trustworthy evidence for a complete scope check.");
  } else if (findings.out_of_scope.length) {
    lines.push(unexpectedChangeLine(findings.out_of_scope));
    const expectedLine = expectedChangeLine(expected, tense);
    if (expectedLine) lines.push(expectedLine);
  } else if (findings.late_approved.length) {
    lines.push(lateApprovedLine(findings.late_approved));
    const expectedLine = expectedChangeLine(expected, tense);
    if (expectedLine) lines.push(expectedLine);
  } else if (findings.uncertain.length) {
    lines.push(uncertainLine(findings.uncertain));
    const expectedLine = expectedChangeLine(expected, tense);
    if (expectedLine) lines.push(expectedLine);
  } else if (expected.length) {
    const expectedLine = expectedChangeLine(expected, tense);
    lines.push(tense === "past"
      ? expectedLine.replace(" within scope.", " inside the approved task.")
      : expectedLine.replace(" within scope.", " inside the approved task."));
  } else {
    lines.push("No unexpected changes were found.");
  }
  const existingLine = preExistingLine(findings.pre_existing);
  if (existingLine) lines.push(existingLine);
  return lines;
}

function statusSummary(comparison, validationEvidence, nextAction) {
  const headline = ["stale", "unavailable", "incomplete"].includes(comparison.state)
    ? "Scope check is incomplete."
    : healthFromComparison(comparison) === "attention"
      ? "Scope needs attention."
      : "Scope looks good.";
  const lines = scopeLines(comparison, "present");
  const checksLine = statusChecksLine(validationEvidence);
  if (checksLine) lines.push(checksLine);
  if (comparison.findings.out_of_scope.length || comparison.findings.late_approved.length) {
    lines.push("ScopeLock only reports changes; it does not block them.");
  }
  return { headline, lines, next_action: nextAction };
}

async function inspectCommand(projectRoot) {
  const capture = await captureRepository(projectRoot);
  if (!capture.supported) {
    return { schema: "scopelock/inspect/v1", result: "unsupported", repository_kind: "non-git", storage_written: false, reason: "ScopeLock MVP requires a Git worktree." };
  }
  return {
    schema: "scopelock/inspect/v1",
    result: capture.concurrent ? "incomplete" : "ok",
    repository: publicRepository(capture.repository),
    existing_changes: capture.observations.map(publicObservation),
    limitations: capture.limitations,
    storage_written: false,
  };
}

function publicRepository(repository) {
  return {
    kind: "git",
    git_root_relationship: repository.git_root_relationship,
    branch_state: repository.branch_state,
    branch: repository.branch,
    head: repository.head,
    object_format: repository.object_format,
    shallow: repository.shallow,
  };
}

function publicObservation(observation) {
  return {
    path: observation.path,
    old_path: observation.old_path,
    kind: observation.kind,
    status: observation.status,
    change: observation.change,
    staged: observation.staged,
    worktree: observation.worktree,
    submodule: observation.submodule,
  };
}

async function activateCommand(projectRoot, input) {
  rejectUnknownKeys(input, [
    "objective",
    "allowed",
    "forbidden",
    "constraints",
    "definition_of_done",
    "validation_requirements",
    "scope_source",
    "whole_project_explicit",
  ]);
  const objective = safeUserString(input.objective, "objective");
  const rawAllowed = uniqueStrings(input.allowed, "allowed", { allowEmpty: false });
  const rawForbidden = uniqueStrings(input.forbidden ?? [], "forbidden");
  const constraints = uniqueStrings(input.constraints ?? [], "constraints").map((item) => sanitizeText(item));
  const definitionOfDone = uniqueStrings(input.definition_of_done ?? [], "definition_of_done").map((item) => sanitizeText(item));
  const validationRequirements = uniqueStrings(input.validation_requirements ?? [], "validation_requirements").map(validateStoredCommand);
  const scopeSource = input.scope_source;
  if (!['explicit', 'inferred'].includes(scopeSource)) throw new ScopeLockError("invalid-input", "scope_source must be explicit or inferred.");
  const wholeProjectExplicit = input.whole_project_explicit === true;
  const allowed = await normalizeRules(projectRoot, rawAllowed, { wholeProjectExplicit });
  const forbidden = await normalizeRules(projectRoot, rawForbidden, { wholeProjectExplicit: false });

  if (scopeSource === "inferred") {
    return {
      schema: "scopelock/activate/v1",
      result: "confirmation_required",
      proposal: { objective, allowed, forbidden, constraints, definition_of_done: definitionOfDone, validation_requirements: validationRequirements },
      storage_written: false,
    };
  }

  let capture = await captureRepository(projectRoot, new Set());
  if (!capture.supported) {
    return { schema: "scopelock/activate/v1", result: "unsupported", repository_kind: "non-git", storage_written: false, reason: "ScopeLock MVP requires a Git worktree." };
  }
  if (capture.concurrent) throw new ScopeLockError("concurrent-repository-change", "The repository changed repeatedly during Baseline capture; no Lock was activated.");
  const baselineFingerprintPaths = new Set(
    capture.observations
      .filter((item) => item.kind === "tracked" && !isSensitivePath(item.path))
      .map((item) => item.path),
  );
  if (baselineFingerprintPaths.size > 0) {
    capture = await captureRepository(projectRoot, baselineFingerprintPaths);
    if (capture.concurrent) throw new ScopeLockError("concurrent-repository-change", "The repository changed repeatedly during fingerprint capture; no Lock was activated.");
  }

  let storagePath;
  let expectedPointerDigest = null;
  try {
    storagePath = await ensureStorage(projectRoot, { create: false });
    const activePath = path.join(storagePath, "active.json");
    let existing = null;
    try {
      await access(activePath);
      const active = await loadActive(projectRoot, { requireActive: false });
      existing = active.pointer;
      expectedPointerDigest = active.pointerDigest;
    } catch (error) {
      if (error instanceof ScopeLockError) throw error;
    }
    if (existing?.state === "active") throw new ScopeLockError("active-lock-exists", "An active Lock already exists and will not be overwritten.");
  } catch (error) {
    if (error.code !== "no-storage") throw error;
  }
  storagePath = await ensureStorage(projectRoot, { create: true });
  const locksPath = await ensureChildDirectory(storagePath, "locks");
  const lockId = await allocateId(locksPath);
  const lockPath = path.join(locksPath, lockId);
  await mkdir(lockPath);
  const amendmentsPath = await ensureChildDirectory(lockPath, "amendments");
  const reportsPath = await ensureChildDirectory(lockPath, "reports");
  void amendmentsPath;
  void reportsPath;
  const createdAt = nowIso();

  const preExisting = [];
  const sensitiveExclusions = [];
  for (const observation of capture.observations) {
    const stored = { ...publicObservation(observation), index_oid: observation.index_oid ?? null };
    if (observation.kind === "tracked") {
      if (isSensitivePath(observation.path)) {
        stored.fingerprint_limited = "sensitive-path";
        sensitiveExclusions.push(observation.path);
      } else {
        const worktreeDigest = observation.worktree_sha256 ?? await hashTrackedFile(projectRoot, observation.path);
        if (worktreeDigest) stored.worktree_sha256 = worktreeDigest;
        else stored.fingerprint_limited = "content-unavailable";
      }
    } else if (observation.kind === "untracked") {
      stored.fingerprint_limited = "untracked-content-not-read";
    }
    preExisting.push(stored);
  }

  const baseline = {
    schema: "scopelock/snapshot/v1",
    version: 1,
    lock_id: lockId,
    captured_at: createdAt,
    project: { root: ".", git_root_relationship: capture.repository.git_root_relationship },
    repository_kind: "git",
    repository: publicRepository(capture.repository),
    index_fingerprint: capture.index_fingerprint,
    worktree_fingerprint: capture.worktree_fingerprint,
    capture_token: capture.capture_token,
    scope: {
      objective,
      allowed,
      forbidden,
      constraints,
      definition_of_done: definitionOfDone,
      validation_requirements: validationRequirements,
    },
    pre_existing: preExisting,
    sensitive_path_hash_exclusions: [...new Set(sensitiveExclusions)],
    comparison_limitations: [...new Set([
      ...capture.limitations,
      ...(capture.retried ? ["baseline-capture-retried-after-concurrent-change"] : []),
      ...(capture.repository.git_root_relationship !== "same-as-project" ? ["changes-outside-selected-project-are-not-compared"] : []),
      ...(preExisting.some((item) => item.kind === "untracked") ? ["pre-existing-untracked-content-is-not-inspected"] : []),
    ])],
  };
  const contract = buildContract({ lockId, createdAt, objective, allowed, forbidden, constraints, definitionOfDone, validationRequirements, baseline });
  const baselineJson = `${JSON.stringify(baseline, null, 2)}\n`;
  const contractPath = path.join(lockPath, "contract.md");
  const baselinePath = path.join(lockPath, "baseline.json");
  await writeExclusive(contractPath, contract);
  await writeExclusive(baselinePath, baselineJson);
  const pointer = {
    schema: "scopelock/active/v1",
    active_lock_id: lockId,
    lock_path: `locks/${lockId}`,
    updated_at: createdAt,
    state: "active",
    contract_sha256: sha256(contract),
    baseline_sha256: sha256(baselineJson),
    amendments: [],
  };
  await writeActivePointer(storagePath, pointer, { expectedDigest: expectedPointerDigest });
  return {
    schema: "scopelock/activate/v1",
    result: "activated",
    lock_id: lockId,
    contract_path: `${STORAGE_NAME}/locks/${lockId}/contract.md`,
    baseline: { repository: baseline.repository, pre_existing_paths: preExisting.length },
    limitations: baseline.comparison_limitations,
    warning: "ScopeLock detects and warns; it is not a sandbox and does not block every write.",
  };
}

function validateStoredCommand(command) {
  const value = sanitizeText(command, MAX_COMMAND_LENGTH);
  if (value.length > MAX_COMMAND_LENGTH || value.includes("\0")) throw new ScopeLockError("invalid-validation-command", "A validation command is oversized or unsafe.");
  if (value.includes("[REDACTED]")) {
    throw new ScopeLockError("secret-like-validation-command", "Validation commands cannot contain inline secret or credential values. Reference an existing environment variable instead.");
  }
  return value;
}

async function statusCommand(projectRoot) {
  let active;
  try {
    active = await loadActive(projectRoot);
  } catch (error) {
    if (error instanceof ScopeLockError) {
      const nextAction = "Review the local ScopeLock files before creating a new Lock.";
      return {
        schema: "scopelock/status/v1",
        result: "unavailable",
        health: "unavailable",
        error: { code: error.code, message: error.message },
        summary: {
          headline: "Scope check is unavailable.",
          lines: ["ScopeLock could not read a trustworthy task boundary."],
          next_action: nextAction,
        },
        storage_written: false,
        recommended_next_action: nextAction,
      };
    }
    throw error;
  }
  let comparison;
  try {
    comparison = await compareRepository(projectRoot, active);
  } catch (error) {
    if (error instanceof ScopeLockError) {
      const nextAction = "Resolve the repository inspection issue and run Status again.";
      return {
        schema: "scopelock/status/v1",
        result: "unavailable",
        health: "unavailable",
        error: { code: error.code, message: error.message },
        summary: {
          headline: "Scope check is unavailable.",
          lines: ["ScopeLock could not inspect the repository safely."],
          next_action: nextAction,
        },
        storage_written: false,
        recommended_next_action: nextAction,
      };
    }
    throw error;
  }
  const validationEvidence = active.pointer.latest_report?.validation_evidence
    ?? active.baseline.scope.validation_requirements.map((command) => ({ command, required: true, result: "not_run", exit_status: null }));
  const recommendedNextAction = recommendedStatusAction(comparison);
  return {
    schema: "scopelock/status/v1",
    result: comparison.state === "comparable" ? "ok" : comparison.state,
    lock: {
      id: active.pointer.active_lock_id,
      objective: active.baseline.scope.objective,
      contract_path: `${STORAGE_NAME}/${active.pointer.lock_path}/contract.md`,
    },
    repository: comparison.current ? publicRepository(comparison.current.repository) : null,
    health: healthFromComparison(comparison),
    baseline_critical: comparison.baseline_critical.map((item) => ({ evidence: "verified", condition: item })),
    findings: comparison.findings,
    validation_requirements: active.baseline.scope.validation_requirements,
    validation_evidence: validationEvidence,
    limitations: comparison.limitations,
    summary: statusSummary(comparison, validationEvidence, recommendedNextAction),
    storage_written: false,
    recommended_next_action: recommendedNextAction,
  };
}

async function contextCommand(projectRoot) {
  let active;
  try {
    active = await loadActive(projectRoot, { requireActive: false });
  } catch (error) {
    if (error instanceof ScopeLockError && error.code === "no-storage") {
      return {
        schema: "scopelock/context/v1",
        result: "inactive",
        state: "none",
      };
    }
    if (error instanceof ScopeLockError) {
      return {
        schema: "scopelock/context/v1",
        result: "unavailable",
        state: "unknown",
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }

  if (active.pointer.state !== "active") {
    return {
      schema: "scopelock/context/v1",
      result: "inactive",
      state: active.pointer.state,
      lock_id: active.pointer.active_lock_id,
    };
  }

  const effectiveAllowed = [];
  const seen = new Set();
  for (const rule of [
    ...active.baseline.scope.allowed,
    ...active.amendments.flatMap((amendment) => amendment.added_allowed),
  ]) {
    const key = `${comparableScopePath(rule.path)}\0${rule.match}`;
    if (seen.has(key)) continue;
    seen.add(key);
    effectiveAllowed.push(rule);
  }

  return {
    schema: "scopelock/context/v1",
    result: "active",
    state: "active",
    lock_id: active.pointer.active_lock_id,
    objective: active.baseline.scope.objective,
    allowed: active.baseline.scope.allowed,
    effective_allowed: effectiveAllowed,
    forbidden: active.baseline.scope.forbidden,
    constraints: active.baseline.scope.constraints,
    definition_of_done: active.baseline.scope.definition_of_done,
    validation_requirements: active.baseline.scope.validation_requirements,
    latest_report: active.pointer.latest_report
      ? {
          created_at: active.pointer.latest_report.created_at,
          outcome: active.pointer.latest_report.outcome,
        }
      : null,
  };
}

async function amendCommand(projectRoot, input) {
  rejectUnknownKeys(input, ["add_allowed", "reason", "whole_project_explicit"]);
  const active = await loadActive(projectRoot);
  const rawAdded = uniqueStrings(input.add_allowed, "add_allowed", { allowEmpty: false });
  const reason = safeUserString(input.reason, "reason");
  const addedAllowed = await normalizeRules(projectRoot, rawAdded, { wholeProjectExplicit: input.whole_project_explicit === true });
  const existingRules = [...active.baseline.scope.allowed, ...active.amendments.flatMap((item) => item.added_allowed)];
  const trulyNew = addedAllowed.filter((candidate) => !existingRules.some((rule) => comparableScopePath(rule.path) === comparableScopePath(candidate.path) && rule.match === candidate.match));
  if (trulyNew.length === 0) throw new ScopeLockError("no-scope-expansion", "The amendment does not add any new allowed scope.");

  const before = await compareRepository(projectRoot, active);
  if (["stale", "unavailable", "incomplete"].includes(before.state)) {
    throw new ScopeLockError("baseline-not-comparable", "The active Baseline is not comparable, so scope cannot be amended safely.");
  }
  const knownFindings = before.findings.out_of_scope
    .filter((finding) => trulyNew.some((rule) => ruleMatches(rule, finding.path)))
    .map((finding) => finding.path);
  const amendmentsPath = path.join(active.lockPath, "amendments");
  const amendmentId = await allocateFileId(amendmentsPath, ".md");
  const createdAt = nowIso();
  const markdown = buildAmendment({
    schema: "scopelock/amendment/v1",
    amendment_id: amendmentId,
    lock_id: active.pointer.active_lock_id,
    created_at: createdAt,
    reason,
    added_allowed: trulyNew,
    known_findings_before: knownFindings,
  });
  const relativePath = `amendments/${amendmentId}.md`;
  await writeExclusive(path.join(active.lockPath, ...relativePath.split("/")), markdown);
  const pointer = {
    ...active.pointer,
    updated_at: createdAt,
    amendments: [...(active.pointer.amendments ?? []), { path: relativePath, sha256: sha256(markdown) }],
  };
  await writeActivePointer(active.storagePath, pointer, { expectedDigest: active.pointerDigest });
  return {
    schema: "scopelock/amend/v1",
    result: "amended",
    lock_id: pointer.active_lock_id,
    amendment_path: `${STORAGE_NAME}/${pointer.lock_path}/${relativePath}`,
    added_allowed: trulyNew,
    late_approved_paths: knownFindings,
    warning: knownFindings.length ? "Previously observed findings remain late-approved and prevent a clean pass." : null,
  };
}

function sanitizedCommandSummary(output, projectRoot) {
  let text = sanitizeText(output, 1200);
  text = text.replace(/\b([A-Z_][A-Z0-9_]{1,})=("[^"]*"|'[^']*'|[^\s]+)/g, "$1=[REDACTED_VALUE]");
  text = text.split(projectRoot).join("<project>");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-5);
  return lines.join(" | ").slice(0, 600);
}

async function runValidationCommand(projectRoot, command) {
  return await new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd: projectRoot,
      env: process.env,
      shell: true,
      windowsHide: true,
    });
    const chunks = [];
    let size = 0;
    let timedOut = false;
    const collect = (chunk) => {
      if (size >= 64 * 1024) return;
      const limited = chunk.subarray(0, 64 * 1024 - size);
      chunks.push(limited);
      size += limited.length;
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, VALIDATION_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ command, result: "unknown", exit_status: null, duration_ms: Date.now() - started, summary: "The authorized command could not be started." });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const captured = Buffer.concat(chunks).toString("utf8");
      resolve({
        command,
        result: timedOut ? "unknown" : code === 0 ? "passed" : "failed",
        exit_status: Number.isInteger(code) ? code : null,
        duration_ms: Date.now() - started,
        summary: timedOut ? "The authorized command timed out." : sanitizedCommandSummary(captured, projectRoot) || `Exited with status ${code ?? "unknown"}.`,
      });
    });
  });
}

function verificationOutcome(comparison, validationEvidence) {
  if (["stale", "unavailable", "incomplete"].includes(comparison.state)) return "incomplete";
  if (comparison.findings.out_of_scope.length || validationEvidence.some((item) => item.result === "failed")) return "fail";
  if (validationEvidence.some((item) => item.required && ["not_run", "unknown"].includes(item.result))) return "incomplete";
  if (comparison.findings.late_approved.length || comparison.findings.uncertain.length) return "warning";
  return "pass";
}

function recommendedVerifyAction(outcome, comparison) {
  if (outcome === "pass") return "Close ScopeLock when you are finished.";
  if (outcome === "fail" && comparison.findings.out_of_scope.length) return `Review ${codeSpan(comparison.findings.out_of_scope[0].path)} before committing.`;
  if (outcome === "fail") return "Fix the failed checks before closing ScopeLock.";
  if (outcome === "warning") return "Review the warning before closing ScopeLock.";
  return "Resolve the missing evidence and run Verify again.";
}

function verifySummary(outcome, comparison, validationEvidence, nextAction) {
  const headline = {
    pass: "Scope check passed.",
    warning: "Scope check has a warning.",
    fail: "Scope check failed.",
    incomplete: "Scope check is incomplete.",
  }[outcome];
  const lines = scopeLines(comparison, "past");
  const checksLine = verifyChecksLine(validationEvidence);
  if (checksLine) {
    const canCombine = comparison.findings.out_of_scope.length > 0
      && ["Checks passed.", "Required checks did not run."].includes(checksLine);
    if (canCombine) {
      const scopeLine = lines.shift();
      lines.unshift(`${checksLine.slice(0, -1)}, ${checksLine === "Checks passed." ? "but" : "and"} ${scopeLine[0].toLowerCase()}${scopeLine.slice(1)}`);
    } else {
      lines.unshift(checksLine);
    }
  }
  if (comparison.findings.out_of_scope.length || comparison.findings.late_approved.length) {
    lines.push("ScopeLock only reports changes; it does not block them.");
  }
  return { headline, lines, next_action: nextAction };
}

function reportFindingLines(findings) {
  if (!findings.length) return "- [verified] None.";
  return findings.map((finding) => `- [${finding.evidence}] ${codeSpan(finding.path)}: ${Array.isArray(finding.change) ? finding.change.join(", ") : finding.change}.`).join("\n");
}

function buildReport({ reportId, createdAt, active, comparison, validationEvidence, outcome, recommendedNextAction, repositoryChangedDuringValidation, summary }) {
  const f = comparison.findings;
  const validationLines = validationEvidence.length
    ? validationEvidence.map((item) => `- [verified] ${codeSpan(item.command)}: ${item.result}; exit ${item.exit_status ?? "unknown"}. ${sanitizeText(item.summary, 600)}`).join("\n")
    : "- [verified] No validation was required or authorized.";
  const summaryLines = summary.lines.join("\n\n");
  return `---\nformat: "scopelock/report/v1"\nversion: 1\nreport_id: ${yamlString(reportId)}\nlock_id: ${yamlString(active.pointer.active_lock_id)}\ncreated_at: ${yamlString(createdAt)}\noutcome: ${yamlString(outcome)}\n---\n\n# ScopeLock Verification Report\n\n## Quick summary\n\n**${summary.headline}**\n\n${summaryLines}\n\n**Next:** ${summary.next_action}\n\n## Outcome\n\n- [verified] ${outcome}\n- [verified] ScopeLock detects and warns; it is not a sandbox.\n\n## Lock summary\n\n- [inferred] ${sanitizeText(active.baseline.scope.objective)}\n\n## Repository comparison\n\n- [verified] Comparison state: ${comparison.state}.\n- [verified] Repository changed during authorized validation: ${repositoryChangedDuringValidation}.\n${markdownLines(comparison.baseline_critical, "verified")}\n\n## Pre-existing findings\n\n${reportFindingLines(f.pre_existing)}\n\n## In-scope findings\n\n${reportFindingLines(f.in_scope)}\n\n## Out-of-scope findings\n\n${reportFindingLines(f.out_of_scope)}\n\n## Amendments and late approvals\n\n${reportFindingLines([...f.approved_amendment, ...f.late_approved])}\n\n## Uncertain findings\n\n${reportFindingLines(f.uncertain)}\n\n## Validation evidence\n\n${validationLines}\n\n## Limitations\n\n${markdownLines(comparison.limitations, "uncertain")}\n\n## Recommended next action\n\n- [inferred] ${sanitizeText(recommendedNextAction)}\n`;
}

async function verifyCommand(projectRoot, input) {
  rejectUnknownKeys(input, ["authorized_commands"]);
  let active;
  try {
    active = await loadActive(projectRoot);
  } catch (error) {
    if (error instanceof ScopeLockError) {
      const nextAction = "Review the local ScopeLock files before creating a new Lock.";
      return {
        schema: "scopelock/verify/v1",
        result: "incomplete",
        outcome: "incomplete",
        report_written: false,
        error: { code: error.code, message: error.message },
        summary: {
          headline: "Scope check is incomplete.",
          lines: ["ScopeLock could not read a trustworthy task boundary."],
          next_action: nextAction,
        },
        recommended_next_action: nextAction,
      };
    }
    throw error;
  }
  const rawCommands = uniqueStrings(input.authorized_commands ?? [], "authorized_commands", { max: 20 });
  const commands = rawCommands.map(validateStoredCommand);
  const before = await compareRepository(projectRoot, active);
  const executed = [];
  for (const command of commands) executed.push(await runValidationCommand(projectRoot, command));
  const comparison = commands.length ? await compareRepository(projectRoot, active) : before;
  const repositoryChangedDuringValidation = commands.length
    ? before.current?.capture_token !== comparison.current?.capture_token
    : false;
  const executedMap = new Map(executed.map((item) => [item.command, item]));
  const required = active.baseline.scope.validation_requirements;
  const validationEvidence = required.map((command) => ({
    command,
    required: true,
    ...(executedMap.get(command) ?? { result: "not_run", exit_status: null, duration_ms: null, summary: "Required validation was not explicitly authorized and was not run." }),
  }));
  for (const item of executed) {
    if (!required.includes(item.command)) validationEvidence.push({ ...item, required: false });
  }
  const outcome = verificationOutcome(comparison, validationEvidence);
  const recommendedNextAction = recommendedVerifyAction(outcome, comparison);
  const summary = verifySummary(outcome, comparison, validationEvidence, recommendedNextAction);
  const reportsPath = path.join(active.lockPath, "reports");
  const reportId = await allocateFileId(reportsPath, ".md");
  const createdAt = nowIso();
  const report = buildReport({ reportId, createdAt, active, comparison, validationEvidence, outcome, recommendedNextAction, repositoryChangedDuringValidation, summary });
  const reportPath = path.join(reportsPath, `${reportId}.md`);
  await writeExclusive(reportPath, report);
  const relativeReportPath = `reports/${reportId}.md`;
  await writeActivePointer(active.storagePath, {
    ...active.pointer,
    updated_at: createdAt,
    latest_report: {
      path: relativeReportPath,
      sha256: sha256(report),
      created_at: createdAt,
      outcome,
      validation_evidence: validationEvidence,
    },
  }, { expectedDigest: active.pointerDigest });
  return {
    schema: "scopelock/verify/v1",
    result: "reported",
    outcome,
    report_written: true,
    report_path: `${STORAGE_NAME}/${active.pointer.lock_path}/${relativeReportPath}`,
    repository_comparison: { state: comparison.state, baseline_critical: comparison.baseline_critical, changed_during_validation: repositoryChangedDuringValidation },
    findings: comparison.findings,
    validation_evidence: validationEvidence,
    limitations: comparison.limitations,
    summary,
    lock_state: "active",
    recommended_next_action: recommendedNextAction,
  };
}

async function closeCommand(projectRoot, state) {
  if (!['closed', 'abandoned'].includes(state)) throw new ScopeLockError("invalid-state", "Close state must be closed or abandoned.");
  const active = await loadActive(projectRoot);
  const pointer = { ...active.pointer, updated_at: nowIso(), state };
  await writeActivePointer(active.storagePath, pointer, { expectedDigest: active.pointerDigest });
  return {
    schema: "scopelock/close/v1",
    result: state,
    lock_id: pointer.active_lock_id,
    retained_path: `${STORAGE_NAME}/${pointer.lock_path}`,
  };
}

async function dispatch(command, options) {
  const projectRoot = await resolveProjectRoot(options.projectRoot);
  switch (command) {
    case "inspect":
      return await inspectCommand(projectRoot);
    case "activate":
      return await activateCommand(projectRoot, await readStdinJson());
    case "status":
      return await statusCommand(projectRoot);
    case "context":
      return await contextCommand(projectRoot);
    case "amend":
      return await amendCommand(projectRoot, await readStdinJson());
    case "verify":
      return await verifyCommand(projectRoot, await readStdinJson({ optional: true }));
    case "close":
      return await closeCommand(projectRoot, options.state);
    case "help":
      return {
        schema: "scopelock/help/v1",
        commands: ["inspect", "activate", "status", "context", "amend", "verify", "close"],
        input: "activate, amend, and verify read one JSON object from standard input",
      };
    default:
      throw new ScopeLockError("unknown-command", "The requested ScopeLock command is not supported.");
  }
}

export {
  ScopeLockError,
  categoryKey,
  isSensitivePath,
  normalizeRuleSyntax,
  parseNameStatus,
  parsePorcelainV2,
  ruleMatches,
  sanitizeText,
  stableJson,
};

async function main() {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    const response = await dispatch(command, options);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const safe = error instanceof ScopeLockError
      ? error
      : new ScopeLockError("internal-error", "ScopeLock encountered an unexpected local error.");
    process.stdout.write(`${JSON.stringify({ schema: "scopelock/error/v1", error: { code: safe.code, message: safe.message, ...(safe.details ? { details: safe.details } : {}) } })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
