# Risk and Adversarial Test Matrix

## Prioritized risks

| ID | Risk | Priority | Required mitigation |
|---|---|---:|---|
| R1 | Users believe ScopeLock is a hard sandbox | High | Use warning-only language everywhere and state hook limitations |
| R2 | Path traversal, symlink, junction, or reparse escape | High | Resolve storage and target boundaries, reject escape, test Windows paths |
| R3 | Arbitrary shell commands modify files without reliable pre-detection | High | Never claim prevention, detect afterward, classify timing limits |
| R4 | Branch changes or incompatible history invalidate the Baseline | High | Permit ancestor-preserving commits, mark divergent history stale |
| R5 | Secret contents are read or stored for attribution | High | Never read untracked content, exclude sensitive paths from fingerprinting, sanitize output |
| R6 | Malicious repository text steers the agent or helper | High | Treat repository content as data, avoid executing project scripts during Lock and Status |
| R7 | Time-of-check and time-of-use race | High | Compare before and after writes, detect concurrent change, avoid absolute claims |
| R8 | Another editor or agent changes the same path | Medium | Report change timing and authorship as uncertain |
| R9 | Scope amendment hides an earlier finding | Medium | Keep immutable amendment timestamps and classify late approval |
| R10 | Case and separator differences cause incorrect matching | Medium | Canonical separators, Windows case folding, platform limitations |
| R11 | Nested repositories or submodules blur the project boundary | Medium | Record root relationship and treat nested boundaries explicitly |
| R12 | Large repositories make every-tool comparisons slow | Medium | Bounded status snapshots, fingerprints, optional post-tool checks |
| R13 | Hook is disabled, untrusted, or unavailable | Medium | Keep all core workflows hook-independent |
| R14 | ScopeLock's own files appear as project drift | Low | Exclude `.codex-scope/` from findings without editing `.gitignore` |
| R15 | Verification claims tests passed without evidence | High | Fixed result enum and captured exit evidence only |
| R16 | Repository-controlled Git environment or config executes code or redirects evidence | High | Strip control variables, disable side effects, reject local clean/process filters |
| R17 | Concurrent pointer writers silently lose an update | High | Serialize writers and compare the originally read pointer digest |
| R18 | Coordinated storage tampering bypasses digest-only checks | High | Validate every stored schema, identity, path, rule, and evidence field |
| R19 | Very large tracked files cause unbounded hashing | Medium | Cap tracked-file hashing and report uncertain evidence |

## Adversarial scenarios

| Scenario | Baseline | Action after Lock | Expected result |
|---|---|---|---|
| Clean in-scope edit | Clean Git tree | Modify `src/auth/login.ts` allowed by `src/auth/` | Verified in-scope |
| Clean out-of-scope edit | Clean Git tree | Modify `config/prod.json` | Verified out-of-scope |
| Pre-existing in-scope edit | Allowed tracked file already modified | No later change | Pre-existing only |
| Pre-existing out-of-scope edit | Outside-scope tracked file already modified | No later change | Pre-existing only, no new finding |
| Pre-existing file changes again | Allowed tracked file already modified | Modify it again | Verified post-Lock change if a safe fingerprint exists |
| Pre-existing outside file changes again | Outside-scope tracked file already modified | Modify it again | Verified out-of-scope finding if a safe fingerprint exists |
| Pre-existing sensitive file | Tracked sensitive path already modified | Modify it again | Uncertain with sensitive-path limitation |
| Pre-existing untracked file | Untracked file exists | Change its contents | Uncertain because content is never read or hashed |
| New untracked file | Clean path at Baseline | Create file in allowed directory | Verified in-scope path creation |
| New generated file outside scope | Clean path at Baseline | Build tool creates cache or lockfile | Out-of-scope until explicitly amended |
| Deleted file | Tracked file exists | Delete allowed file | In-scope deletion |
| Rename across boundary | File starts inside allowed directory | Rename into forbidden directory | Out-of-scope destination and relevant source finding |
| Forbidden overlap | `src/` allowed, `src/secrets/` forbidden | Modify `src/secrets/key.ts` | Forbidden wins |
| Branch switch | Active Lock on `main` | Switch to feature branch | Stale Lock, Verification incomplete |
| Compatible new commit | Active Lock at HEAD A | Commit on the same branch so A remains an ancestor | Valid comparison from A through current state |
| Rewritten history | Active Lock at HEAD A | Reset or rebase so A is no longer an ancestor | Stale Lock |
| Concurrent user edit | Codex and user edit separate files | Status runs afterward | Findings reported without authorship claim |
| Concurrent same-file edit | Codex and user edit same file | Status runs afterward | Changed path verified, authorship uncertain |
| Shell-created path | Bash creates an out-of-scope file | Post-tool check runs | Finding after the write, no prevention claim |
| Storage symlink escape | `.codex-scope` points outside root | Activate Lock | Abort without writing |
| Allowed path symlink escape | Allowed path resolves outside root | Propose or compare | Reject or mark unsafe |
| Windows mixed case | Rule uses `SRC/Auth/`, path is `src/auth/` | Compare on Windows | Match case-insensitively |
| macOS case-insensitive volume | Case differs | Compare without volume proof | Apply documented platform behavior and surface limitation |
| Nested Git repository | Project contains another `.git` | Change nested repo | Report boundary limitation or treat nested repo as separate |
| Submodule change | Gitlink or submodule content changes | Status runs | Report structured submodule limitation |
| Non-Git project | No Git metadata | Attempt to create a Lock | Unsupported result and no Lock activation |
| Empty allowed scope | Objective exists but no allowed path | Attempt to activate | Reject proposal |
| Inferred repository-wide scope | User gives a vague task | ScopeLock considers `.` | Require explicit approval and never infer `.` silently |
| Corrupt active pointer | Invalid JSON | Run Status | Unavailable, no repair |
| Missing Baseline | Contract exists without snapshot | Run Verify | Incomplete, no guess |
| Late amendment | Finding observed before rule is added | Approve path later | `late-approved`, history preserved, outcome no better than warning |
| Attempted tightening | Active Lock allows `src/` | User tries to remove `src/legacy/` | Refuse amendment and require a new Lock |
| Validation not run | Required command listed | Run Verify without approval | `not run`, never passed |
| Validation fails | User approves command | Exit nonzero | Failed result and non-passing outcome |

## Required fixture families

Phase 2 tests should include:

- Clean Git fixture
- Dirty Git fixture
- Rename and deletion fixture
- Sensitive-path fixture
- Untracked fixture
- Branch and HEAD drift fixture
- Nested repository and submodule fixture
- Non-Git rejection fixture
- Windows path normalization fixture
- Corrupt storage fixture
- Concurrent-change simulation
- Hostile Git environment and repository-local filter fixture
- Fsmonitor non-execution fixture
- Coordinated Baseline and pointer tamper fixture
- Concurrent pointer writer and stale lock fixtures
- Large repository and oversized tracked-file fixtures
- POSIX invalid-byte-path fixture

## Phase gates

Phase 2 cannot finish until Lock, Status, and Verify pass the core fixture matrix.

Phase 3 cannot finish until hooks prove they:

- Do not claim a blocked edit when it was only warned.
- Do not create infinite Stop loops.
- Remain optional.
- Do not automatically halt work after a finding in the initial hook release.
- Use Windows command overrides correctly.
- Add acceptable overhead.

Phase 4 cannot begin until privacy, security, and limitation wording match actual behavior.

Phase 3.5 Windows evidence is complete. Phase 4 remains gated on a true Linux or macOS run of the full suite.
