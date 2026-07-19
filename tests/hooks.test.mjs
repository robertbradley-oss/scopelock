import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPath,
  extractPatchPaths,
  looksLikeCompletion,
} from "../scripts/scopelock-hook.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CORE = path.join(ROOT, "scripts", "scopelock.mjs");
const HOOK = path.join(ROOT, "scripts", "scopelock-hook.mjs");
const TEMP_PREFIX = path.join(tmpdir(), "scopelock-hook-test-");

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
}

async function write(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createRepo() {
  const root = await mkdtemp(TEMP_PREFIX);
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "ScopeLock Hook Tests"]);
  git(root, ["config", "user.email", "scopelock-hooks@example.invalid"]);
  await write(root, "src/auth/login.js", "export const login = true;\n");
  await write(root, "config/prod.json", "{\"mode\":\"prod\"}\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "baseline"]);
  return root;
}

function runCore(cwd, command, input) {
  const result = spawnSync(process.execPath, [CORE, command, "--project-root", "."], {
    cwd,
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout.trim());
}

function activate(cwd) {
  return runCore(cwd, "activate", {
    objective: "Update the authentication flow",
    allowed: ["src/auth/"],
    forbidden: ["src/auth/secrets/"],
    constraints: ["Keep public behavior stable"],
    definition_of_done: ["The change is verified"],
    validation_requirements: [],
    scope_source: "explicit",
    whole_project_explicit: false,
  });
}

function runHook(cwd, input) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify({
      session_id: "session-test",
      transcript_path: null,
      cwd,
      model: "test-model",
      permission_mode: "default",
      ...input,
    }),
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PLUGIN_ROOT: ROOT },
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]);
}

function assertAdvisoryOnly(output) {
  const source = JSON.stringify(output);
  assert.ok(!source.includes('"continue":false'));
  assert.equal(Object.hasOwn(output, "decision"), false);
  assert.equal(output.hookSpecificOutput?.permissionDecision, undefined);
}

async function cleanup(root) {
  if (!root) return;
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temp = await realpath(tmpdir());
  assert.ok(resolved.startsWith(temp + path.sep), `refusing to remove ${resolved}`);
  await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}

test("hook config uses default discovery and cross-platform advisory commands", async () => {
  const config = JSON.parse(await readFile(path.join(ROOT, "hooks", "hooks.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  const hookSource = await readFile(HOOK, "utf8");
  assert.equal(Object.hasOwn(manifest, "hooks"), false);
  assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
  assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
  assert.doesNotMatch(hookSource, /node:(?:http|https|net|tls)|\bfetch\s*\(|telemetry|analytics/i);
  assert.deepEqual(Object.keys(config.hooks), ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]);
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        assert.equal(handler.type, "command");
        assert.match(handler.command, /\$PLUGIN_ROOT\/scripts\/scopelock-hook\.mjs/);
        assert.match(handler.commandWindows, /%PLUGIN_ROOT%\\scripts\\scopelock-hook\.mjs/);
        assert.ok(handler.timeout <= 12);
      }
    }
  }
  for (const relative of ["hooks/hooks.json", "scripts/scopelock-hook.mjs", "PHASE-3.md", "docs/architecture-and-hooks.md", "docs/phased-implementation-plan.md", "references/protocol.md"]) {
    assert.ok(!(await readFile(path.join(ROOT, ...relative.split("/")), "utf8")).includes("\u2014"), `${relative} contains an em dash`);
  }
});

test("patch path extraction and classification are conservative", () => {
  const projectRoot = path.resolve("fixture");
  const paths = extractPatchPaths(
    "*** Begin Patch\n*** Update File: src/auth/login.js\n*** Add File: config/new.json\n*** End Patch",
    projectRoot,
  );
  assert.deepEqual(paths, ["src/auth/login.js", "config/new.json"]);
  const context = {
    reserved_sideband: {
      schema: "scopelock/reserved-sideband/v1",
      classification: "reserved-sideband",
      rules: [
        { path: ".agentreceipt/", match: "directory" },
        { path: ".codex-handoff/", match: "directory" },
        { path: ".codex-scope/", match: "directory" },
      ],
    },
    effective_allowed: [{ path: "src/auth/", match: "directory" }],
    forbidden: [{ path: "src/auth/secrets/", match: "directory" }],
  };
  assert.equal(classifyPath(context, ".agentreceipt/receipt.json").category, "reserved-sideband");
  assert.equal(classifyPath(context, ".codex-handoff/latest.md").category, "reserved-sideband");
  assert.equal(classifyPath(context, ".codex-scope/active.json").category, "reserved-sideband");
  assert.equal(classifyPath(context, "src/auth/login.js").category, "in-scope");
  assert.equal(classifyPath(context, "src/auth/secrets/key.js").category, "out-of-scope");
  assert.equal(classifyPath(context, "config/new.json").category, "out-of-scope");
  assert.equal(looksLikeCompletion("Implementation is complete and ready for review."), true);
  assert.equal(looksLikeCompletion("I am still investigating."), false);
});

test("hooks are silent when no active Lock exists", async () => {
  let root;
  try {
    root = await createRepo();
    assert.deepEqual(runHook(root, { hook_event_name: "SessionStart", source: "startup" }), {});
    assert.deepEqual(runHook(root, { hook_event_name: "Stop", turn_id: "turn-1", stop_hook_active: false, last_assistant_message: "Done." }), {});
  } finally {
    await cleanup(root);
  }
});

test("SessionStart reinforces active scope without claiming enforcement", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const output = runHook(root, { hook_event_name: "SessionStart", source: "startup" });
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(output.hookSpecificOutput.additionalContext, /Update the authentication flow/);
    assert.match(output.hookSpecificOutput.additionalContext, /advisory only/);
    assertAdvisoryOnly(output);
  } finally {
    await cleanup(root);
  }
});

test("PreToolUse warns only for proven direct apply_patch paths and never blocks", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const outside = runHook(root, {
      hook_event_name: "PreToolUse",
      turn_id: "turn-1",
      tool_name: "apply_patch",
      tool_use_id: "tool-1",
      tool_input: { command: "*** Begin Patch\n*** Update File: config/prod.json\n*** End Patch" },
    });
    assert.equal(outside.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.match(outside.hookSpecificOutput.additionalContext, /config\/prod\.json/);
    assert.match(outside.hookSpecificOutput.additionalContext, /not blocked/);
    assertAdvisoryOnly(outside);

    const inside = runHook(root, {
      hook_event_name: "PreToolUse",
      turn_id: "turn-2",
      tool_name: "apply_patch",
      tool_use_id: "tool-2",
      tool_input: { command: "*** Begin Patch\n*** Update File: src/auth/login.js\n*** End Patch" },
    });
    assert.deepEqual(inside, {});

    for (const reservedPath of [
      ".agentreceipt/receipt.json",
      ".codex-handoff/latest.md",
      ".codex-scope/tool-owned.json",
    ]) {
      const reserved = runHook(root, {
        hook_event_name: "PreToolUse",
        turn_id: `turn-reserved-${reservedPath}`,
        tool_name: "apply_patch",
        tool_use_id: `tool-reserved-${reservedPath}`,
        tool_input: { command: `*** Begin Patch\n*** Add File: ${reservedPath}\n+{}\n*** End Patch` },
      });
      assert.deepEqual(reserved, {}, reservedPath);
    }

    const shell = runHook(root, {
      hook_event_name: "PreToolUse",
      turn_id: "turn-3",
      tool_name: "Bash",
      tool_use_id: "tool-3",
      tool_input: { command: "echo text > config/prod.json" },
    });
    assert.deepEqual(shell, {}, "arbitrary shell text must not be parsed as path proof");
  } finally {
    await cleanup(root);
  }
});

test("PostToolUse reports completed out-of-scope drift without halting", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    await write(root, "config/generated.txt", "generated\n");
    const output = runHook(root, {
      hook_event_name: "PostToolUse",
      turn_id: "turn-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "build" },
      tool_response: { exit_code: 0 },
    });
    assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(output.hookSpecificOutput.additionalContext, /config\/generated\.txt/);
    assert.match(output.hookSpecificOutput.additionalContext, /did not undo or halt/);
    assertAdvisoryOnly(output);
  } finally {
    await cleanup(root);
  }
});

test("Stop adds a completion reminder but never creates a continuation loop", async () => {
  let root;
  try {
    root = await createRepo();
    activate(root);
    const output = runHook(root, {
      hook_event_name: "Stop",
      turn_id: "turn-1",
      stop_hook_active: false,
      last_assistant_message: "The implementation is complete and ready for review.",
    });
    assert.match(output.systemMessage, /\$scopelock/);
    assertAdvisoryOnly(output);
    assert.equal(Object.hasOwn(output, "continue"), false);

    const ongoing = runHook(root, {
      hook_event_name: "Stop",
      turn_id: "turn-2",
      stop_hook_active: true,
      last_assistant_message: "I am still investigating the failing fixture.",
    });
    assert.deepEqual(ongoing, {});
  } finally {
    await cleanup(root);
  }
});
