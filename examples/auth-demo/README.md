# ScopeLock Auth Demo

This small project is the source fixture for `npm run demo`.

The demo copies it to a temporary directory, initializes a Git repository, locks the task to `src/auth/` and `tests/auth/`, makes one allowed change and one change to `config/prod.json`, then runs Status and Verify.

Do not run the example in place if you want an isolated Git Baseline. Use the bundled demo script or copy this directory outside the ScopeLock repository first.
