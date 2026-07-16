# Stress-Test Summary

## Strongest parts

- The product promise is narrow and understandable.
- Warning-only language matches current Codex hook behavior.
- Git-only scope avoids presenting weak provenance as trustworthy.
- Dirty repositories are supported without requiring commit, stash, or cleanup.
- Immutable contracts, Baselines, amendments, and reports preserve history.
- Exact files and directory prefixes keep path matching explainable.
- The plugin remains useful without hooks.
- Secret-safe evidence rules are stricter than the minimum needed for convenience.

## Risks that remain

### False assurance

Users may still interpret the word Lock as a sandbox. Product copy, onboarding, and reports must repeat that ScopeLock detects and warns but does not provide operating-system enforcement.

### Concurrent writers

ScopeLock can prove that state changed, but not who changed it. Same-file changes from Codex, the user, an IDE, or another process remain an attribution limitation.

### Sensitive-path classification

Filename-based exclusions cannot identify every secret-bearing tracked file. The helper should use conservative rules and allow project-specific exclusions without inspecting contents.

### Hook overhead

Repeated post-tool comparisons may be too slow in large repositories. Phase 3 must measure overhead and keep hooks optional.

### History complexity

Shallow clones, submodules, nested repositories, rebases, resets, and replaced branches require incomplete or stale outcomes rather than guessed comparisons.

## Decisions made during the stress test

- No strict blocking option.
- No reading or hashing untracked contents.
- Git-only MVP.
- No wildcard path grammar.
- Expansion-only amendments.
- Safe fingerprints for already-modified tracked files.
- Verify does not close a Lock.
- Late approval prevents a clean pass.
- Validation requirements do not authorize execution.
- Ancestor-preserving commits remain comparable.
- Dirty repositories are supported.
- Explicit complete scope can activate directly.
- Inferred material scope requires approval.
- Every Lock requires an objective and allowed path.
- Forbidden rules override allowed parents.
- Hooks are optional and advisory.
- No networked runtime components.

## Deferred decisions

- Wildcard path rules.
- Non-Git provenance.
- Pause-after-finding hook behavior.
- Custom project-specific sensitive-path configuration.
- Support for narrowing an active Lock.

## Next best action

Approve Phase 1, then scaffold the skill-only Phase 2 prototype without hooks.
