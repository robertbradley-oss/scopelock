# Phase 5: Real-user test

Date: 2026-07-16 (America/New_York)

## Outcome

The Phase 5 implementation and installed-plugin retest are complete on Windows.

The first real-user runs showed that ScopeLock's evidence was technically correct but too detailed to understand quickly. The tester's direction was that it needed to be "almost overly simplified." Status and Verify were changed to lead with a short, deterministic plain-language summary while retaining full local evidence. That revised behavior was then packaged, installed under a cache-busted local version, and successfully exercised from a fresh Codex task.

The retest proved that the installed plugin can preserve a pre-existing dirty path, separate in-scope work from unrelated drift, run only an explicitly approved validation command, and fail Verify when checks pass but out-of-scope drift remains. The default presentation clearly stated that ScopeLock reports changes and does not block them.

This is Windows evidence only. True Linux and macOS execution remains unverified, matching the accepted `0.1.0` release limitation.

## Tester feedback

The following statements are direct user feedback from the initial real-user runs:

- After the first detailed report and usability questions: "to be hinest, idk LOL".
- After a second, plainer explanation: "its starting to".
- On the product assessment: "yea i agree. it needs to be almost overly simpliefied".

Interpretation:

- The original presentation did not earn the criterion that a stranger could understand the report without raw Git inspection.
- Simpler wording improved comprehension and led directly to the revised default presentation.
- The retest establishes that the presentation now behaves as designed, but it does not turn the user's limited statements into a stronger claim that the workflow saves time or is never annoying.

## Resulting usability change

- Added deterministic `summary` objects to Status and Verify helper responses.
- Default summaries contain one plain-language headline, a few short sentences, and one next action.
- Out-of-scope summaries explicitly say ScopeLock reports changes but does not block them.
- Lock IDs, evidence taxonomy, raw JSON, schema names, detailed classifications, and report paths are hidden by default.
- Detailed Lock metadata, validation records, and immutable evidence remain available on request.
- Immutable reports now start with `Quick summary` and retain complete detailed evidence below it.
- Updated the Status and Verify skill instructions and deterministic demo to use the simplified default.

## Package and installation

- Cache-busted test version: `0.1.0+codex.20260717010217`.
- Local marketplace: `scopelock-phase5-local`.
- Isolated package directory: `dist/scopelock-marketplace-0.1.0+codex.20260717010217`.
- Installed plugin: `scopelock@scopelock-phase5-local`.
- Installed cache: `C:\Users\robby\.codex\plugins\cache\scopelock-phase5-local\scopelock\0.1.0+codex.20260717010217`.
- During the candidate retest, the public marketplace checkout remained clean at release commit `d3e71c7abcb815222f2dd1bde71dfb94bbea8665`.
- The public `scopelock@scopelock` installation was removed during candidate testing to make pickup unambiguous; its marketplace remained configured.

The release builder now accepts a validated `--marketplace-name` option so an isolated local test marketplace can coexist with the canonical public marketplace.

## Public release

The successful candidate became ScopeLock `0.1.1`, a patch release containing the simplified Status and Verify experience plus the isolated-marketplace release-builder option. The canonical marketplace, annotated `v0.1.1` tag, GitHub release, asset digest, and installed public plugin were verified as part of publication. No Linux or macOS runtime evidence was added.

## Fresh-task pickup evidence

Two independent fresh-process checks passed:

1. A fresh copied-CLI Codex process exposed exactly one ScopeLock package, all three installed skills, and manifest version `0.1.0+codex.20260717010217` from the new installed cache.
2. A newly created Codex app task independently exposed the same single cache-busted package and all three skills before making any repository changes.

An earlier app task launched during installation turnover surfaced a stale `0.1.0` startup catalog. That attempt was invalidated and is not used as evidence. The later clean task is the authoritative app pickup result.

## Installed-plugin workflow

The authoritative app task created a disposable repository at:

`C:\Users\robby\Documents\Codex\2026-07-16\scopelock-phase-5-app-pickup\work\auth-demo-installed-phase5`

It then:

- committed the clean fixture at `ea1952f`;
- edited `README.md` before the Lock;
- locked work to `src/auth/` and `tests/auth/`;
- added `src/auth/emailsMatch.js` and `tests/auth/emailsMatch.test.js` after the Lock;
- deliberately changed `config/prod.json` outside scope;
- ran Status from the installed plugin;
- ran exactly the separately authorized `node --test` command during Verify;
- observed passing tests and a failing overall Verify result because `config/prod.json` remained outside scope;
- left the Lock active and the disposable evidence intact.

Representative default Status output:

> **Scope needs attention.**
>
> 1 unexpected file changed: `config/prod.json`.
> 2 task files are within scope.
> `README.md` was already changed before this task.
> Required checks have not run yet.
> ScopeLock only reports changes; it does not block them.
>
> **Next:** Review `config/prod.json` before committing.

Representative default Verify output:

> **Scope check failed.**
>
> Checks passed, but 1 unexpected file changed: `config/prod.json`.
> 2 task files were within scope.
> `README.md` was already changed before this task.
> ScopeLock only reports changes; it does not block them.
>
> **Next:** Review `config/prod.json` before committing.
>
> Detailed evidence was saved locally.

The task's assessment confirmed that the simplified output hid Lock IDs, evidence taxonomy, raw JSON, schema names, and the report path by default while still explaining that checks passed and config drift caused failure.

## Validation

- `npm.cmd run check`: passed.
- `npm.cmd test`: 33 tests, 32 passed, 0 failed, 1 expected POSIX-only skip on Windows.
- New summary round-trip test: passed.
- Official plugin validator: passed for source, staged package, and installed cache.
- Official skill validator: passed for all three skills in the staged package and installed cache.
- `npm.cmd run demo`: passed with the simplified Status and Verify presentation.
- Fresh copied-CLI pickup and full workflow: passed.
- Fresh Codex app pickup and full workflow: passed.

## Observations and remaining limits

- The app task's first interactive stdin attempt did not deliver EOF under the Windows terminal. It canceled the waiting process and successfully retried with a non-interactive stdin stream. This did not alter the ScopeLock result, but it is a Windows agent-execution wrinkle worth retaining.
- The technical retest is successful. Broader claims about long-term annoyance, adoption, or time saved still require observation across normal work rather than this scripted fixture.
- No Linux or macOS runtime evidence was created.
