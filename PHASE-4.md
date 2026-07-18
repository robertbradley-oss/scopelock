# Phase 4 Package and Polish

Date: 2026-07-16

Status: Complete. The public GitHub repository and `v0.1.0` release were created on 2026-07-16.

## Owner decision

The project owner could not run Linux or macOS and explicitly authorized Phase 4 with that verification gap accepted as a known risk. Windows remains the only fully executed platform for `0.1.0`. Git Bash confirms the POSIX hook command and quoting but not true POSIX filesystem, signal, or process behavior.

## Delivered

- Public `README.md`
- `docs/installation.md`
- `PRIVACY.md`
- `SECURITY.md`
- `LICENSE`
- `CHANGELOG.md`
- Generated square icon, horizontal logo, and social preview under `assets/`
- Generated 14-second MP4 demo under `assets/scopelock-demo.mp4`
- Example authentication project under `examples/auth-demo/`
- Dependency-free end-to-end demo at `demo/run-demo.mjs`
- Reproducible demo-video renderer at `demo/render-video.py`
- Submission-ready marketplace copy at `marketplace/listing.md`
- Canonical marketplace release builder at `scripts/build-release.mjs`
- Reproducible forward-slash ZIP builder at `scripts/build-release-archive.py`
- Manifest presentation metadata for brand color, icon, and logo

## Brand direction

The icon shows a visible cyan task boundary, connected changes inside it, and an amber outlier beyond it. Padlocks, shields, keyholes, and security-badge imagery were deliberately excluded so the brand does not imply hard enforcement.

The three raster assets were generated with the built-in image-generation workflow and copied into the project. The logo and social preview use the icon as their visual reference.

## Demo result

`npm run demo` creates a temporary Git project and proves the intended product story:

- Lock activates with no pre-existing changes.
- `src/auth/login.js` is reported in scope.
- `config/prod.json` is reported out of scope.
- `node --test` passes with exit status 0.
- Verify still reports `fail` because the scope finding remains.
- ScopeLock does not claim the out-of-scope write was blocked.

The temporary project is deleted safely unless the caller supplies `--keep`.

## Validation evidence

- `npm run check`: passed.
- `npm test`: 32 tests total, 31 passed, 0 failed, 1 POSIX-only fixture skipped on Windows.
- Official plugin validator: passed.
- Official skill validator: passed for all three skills.
- `npm run demo`: passed.
- `npm run build:release`: passed.
- Demo video frame review: passed across title, Lock, Status, Verify, and closing scenes.
- Runtime remains dependency-free. Video rendering used workspace-local developer tooling only.

## Release package

The release builder stages a Git-backed marketplace at:

```text
dist/scopelock-marketplace-0.1.0/
```

The stage contains:

```text
.agents/plugins/marketplace.json
plugins/scopelock/.codex-plugin/plugin.json
plugins/scopelock/skills/
plugins/scopelock/hooks/
plugins/scopelock/scripts/
plugins/scopelock/assets/
```

The stage is the canonical source for the public repository `robertbradley-oss/scopelock` and marketplace installation as `scopelock@scopelock`.

## Publication record

- The project owner explicitly approved public exposure.
- GitHub CLI authentication for `robertbradley-oss` was verified before publication.
- Live repository, homepage, and privacy URLs are present in the plugin manifest.
- The canonical marketplace stage was committed and published to the public repository.
- Tag and GitHub release `v0.1.0` include the validated release archive and social preview.

Phase 5 real-user testing has not started.
