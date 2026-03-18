# pnpm-migrate

`pnpm-migrate` is a cross-platform CLI/TUI tool that helps you migrate multiple Node.js projects from `npm` lockfiles to `pnpm` safely and quickly.

It keeps the workflow interactive and user-friendly, while adding guardrails for destructive operations.

## What It Does

- Scans a root directory recursively for Node.js projects (`package.json`).
- Lets you choose migration options interactively (or via CLI flags).
- Optionally backs up package files before changes.
- Optionally deletes `node_modules*` folders safely.
- Runs `pnpm import` when `package-lock.json` exists.
- Runs `pnpm install --frozen-lockfile=false` with retries.
- Optionally runs `pnpm approve-builds --all`.
- Removes `package-lock.json` after successful migration.
- Shows real-time progress and prints a final summary.

## Features

- Recursive project discovery.
- Dry-run mode (`--dry-run`) for safe previews.
- Parallel processing (`--parallel <N>`) for faster migration.
- Optional `node_modules*` cleanup with explicit confirmation.
- Optional backup to a central backup directory.
- Optional automatic build approval.
- Retry logic for install failures (up to 2 retries per project).
- Interactive project selection when many projects are found.
- Root directory cache for faster repeated runs.
- Fuzzy root selection (autocomplete) when available, with automatic fallback.
- Environment checks for Node.js, PNPM, and Corepack.
- End-of-run trace log for troubleshooting/auditing.

## Requirements

- Node.js `>= 20`
- PNPM available in `PATH` (tool can help bootstrap using Corepack when possible)

## Installation

### Option 1: Clone and link locally (recommended for development)

```bash
git clone https://github.com/ogiboy/pnpm-migrator-tui.git
cd pnpm-migrator-tui
npm install
npm link
```

Then run:

```bash
pnpm-migrate
```

### Option 2: Global install (if published)

```bash
npm install -g <package-name>
```

## CLI Options

```bash
pnpm-migrate [options]
```

| Option                  | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `--dry-run`             | Preview actions without changing files.                         |
| `--parallel <N>`        | Number of projects to migrate concurrently.                     |
| `--delete-node-modules` | Delete `node_modules*` directories before install.              |
| `--backup`              | Backup `package.json` and `package-lock.json` before migration. |
| `--auto-approve-builds` | Run `pnpm approve-builds --all` after install.                  |
| `--root <path>`         | Set scan root path without root selection prompt.               |
| `-h`, `--help`          | Show CLI help.                                                  |

If an option is not provided, `pnpm-migrate` asks interactively.

## Step-by-Step Workflow

1. Start the tool with `pnpm-migrate`.
2. Environment check runs:
   - Validates Node.js version.
   - Checks PNPM/Corepack availability.
   - Offers safe install/update actions when needed.
3. Select root directory:
   - Fuzzy autocomplete is preferred if available.
   - If unavailable or install fails, tool falls back to manual path input.
4. Choose migration options:
   - Dry-run, parallel jobs, delete `node_modules`, backup, approve builds.
5. Confirm destructive action (if cleanup is enabled).
6. Tool scans for projects recursively under selected root.
7. If many projects are found, optionally choose a subset from a checkbox list.
8. Confirm and start migration.
9. Watch real-time progress bar and per-project results.
10. Review summary (success, failed, skipped) and trace log path.

## Example CLI Session

```text
$ pnpm-migrate

PNPM Migration TUI

Environment Check
Node.js: v22.14.0
PNPM: 10.2.1
Corepack: 0.31.0

Select root directory: ~/Documents/Projects
Dry run? No
Parallel jobs: 4
Delete ALL node_modules* directories? Yes
Auto approve pnpm builds? Yes
Backup package files before migration? Yes
This will delete node_modules* directories from selected projects. Continue? Yes

Scanning Projects
Found 27 project(s)
Show projects to select? Yes
Select projects to migrate: [api-service, web-app, admin-panel]
Start migration? Yes

Progress |████████████████████████████| 100% || 3/3 projects

Migration Summary
Success: 3
Skipped: 0
Failed: 0

Trace log written to ~/.pnpm-migration-last-run.json
```

## Migration Steps Per Project

For each selected project, `pnpm-migrate` performs:

1. Optional backup of:
   - `package.json`
   - `package-lock.json`
2. Optional deletion of `node_modules*` directories.
3. `pnpm import` (if `package-lock.json` exists).
4. `pnpm install --frozen-lockfile=false` (with retries).
5. Optional `pnpm approve-builds --all`.
6. Remove `package-lock.json` after successful migration.

## Module Architecture

- `src/envCheck.js`
  - Environment checks (Node.js, PNPM, Corepack) and safe bootstrap/update prompts.
- `src/rootSelection.js`
  - Root selection prompt, cache loading/saving, fuzzy autocomplete integration, fallback input.
- `src/projectDiscovery.js`
  - Recursive discovery of project directories containing `package.json`.
- `src/migration.js`
  - Per-project migration execution, retries, cleanup, backup, and parallel worker orchestration.
- `src/logging.js`
  - User-facing logs, progress bar, summaries, and trace-log writing.
- `src/utils.js`
  - Shared helpers for path normalization, OS checks, safe deletion, retries, and CLI arg parsing.
- `src/qualityCheck.js`
  - Self-quality validation of execution order, path safety, and migration result consistency.
- `pnpm-migration-tui.js`
  - Main CLI entrypoint that coordinates the full workflow.

## Safety Notes and Best Practices

- Destructive cleanup is never silent:
  - `node_modules*` deletion requires explicit user confirmation.
- Path safety is enforced:
  - Deletion is blocked if target path is outside the selected root.
- Root validation is strict:
  - Selected root must exist.
- Fallback behavior is robust:
  - If autocomplete plugin is unavailable or fails to install, manual input prompt is used.
- Dry-run first for large migrations:
  - Use `--dry-run` to preview operations before real changes.
- Keep backups enabled on first run:
  - Strongly recommended when migrating many repositories.

## Backup, Cache, and Logs

- Backup directory:
  - `~/pnpm-migration-backups`
- Root cache file:
  - `~/.pnpm-migration-cache.json`
- Last run trace log:
  - `~/.pnpm-migration-last-run.json`

## Cross-Platform Notes

- Supports macOS, Linux, and Windows.
- Destructive operations are done through Node.js filesystem APIs with root-boundary checks.
- The tool avoids unsafe shell-dependent deletion behavior.

## Troubleshooting

- No projects found:
  - Verify root path and that target folders contain `package.json`.
- PNPM not found:
  - Accept the guided Corepack/npm install prompt, or install PNPM manually.
- Autocomplete not available:
  - Continue with manual root path input; functionality is unchanged.
- Permission issues:
  - Re-run in a shell with appropriate permissions for selected project directories.
