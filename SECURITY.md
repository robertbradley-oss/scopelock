# Security Policy

## Supported release

The initial supported release line is `0.1.x`.

## Reporting a vulnerability

Use a private GitHub security advisory in the public ScopeLock repository. Do not include real credentials, proprietary source, or secret-bearing repository contents in an issue or demonstration.

## Security boundary

ScopeLock is an evidence and workflow tool, not a sandbox, access-control system, or write barrier. It runs with the local user's permissions and cannot prevent arbitrary writes from tools, shells, editors, or other processes.

The formal threat model is in [scopelock-threat-model.md](scopelock-threat-model.md). The Phase 3.5 secure-coding review is in [security_best_practices_report.md](security_best_practices_report.md).
