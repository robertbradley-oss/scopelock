# Privacy

ScopeLock is local-first and does not include an account, hosted service, API key, telemetry client, analytics client, database, or built-in network request.

## Data ScopeLock reads

- Git branch, HEAD, index, status, ancestry, and changed-path metadata
- Tracked file contents only when a safe one-way fingerprint is needed for an already-modified, ordinary file
- Project-local ScopeLock records under `.codex-scope/`
- Codex hook event metadata when the optional hooks are trusted and enabled

ScopeLock never reads or hashes untracked file contents. It excludes likely sensitive tracked paths and tracked files larger than 64 MiB from content fingerprinting.

## Data ScopeLock stores

ScopeLock stores human-readable project evidence under `.codex-scope/`:

- the active pointer;
- Lock contracts;
- Baseline snapshots;
- scope amendments;
- verification reports.

These files may contain project-relative paths, Git object IDs, SHA-256 fingerprints, validation command text, exit status, bounded sanitized output summaries, and evidence labels. They do not intentionally contain complete environment variables or untracked file contents.

## Data transmission

ScopeLock itself does not transmit project data.

An explicitly authorized validation command is an ordinary local shell command and is outside this guarantee. It may access the network or external services according to its own behavior. Review the exact command before authorizing it.

Git may use user-managed global or system configuration. ScopeLock disables lazy object fetching and rejects repository-local executable clean/process filters, but user-trusted global or system Git filter programs remain part of the trusted local environment.

## Retention and deletion

ScopeLock records remain in the project until the user removes them. Closing or abandoning a Lock preserves its evidence. Removing the plugin does not remove `.codex-scope/` directories.

Review ScopeLock records before committing or sharing them. Pattern-based sensitive-path detection and output sanitization cannot recognize every secret.
