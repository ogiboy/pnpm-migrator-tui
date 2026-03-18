/**
 * utils.js
 * Shared utilities for path handling, safe file deletion, retrying commands,
 * and CLI argument parsing used across the pnpm-migrate modules.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith(`~${path.sep}`) || inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export function normalizePath(inputPath) {
  const expanded = expandHome(inputPath);
  return path.resolve(path.normalize(expanded));
}

export async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await fs.promises.mkdir(targetPath, { recursive: true });
}

export function isSubPath(rootPath, candidatePath) {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedCandidate = normalizePath(candidatePath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function safeDeletePath(targetPath, options) {
  const { allowedRoot, dryRun = false, logger = null } = options;
  const normalizedTarget = normalizePath(targetPath);

  if (!isSubPath(allowedRoot, normalizedTarget)) {
    const reason = `Blocked deletion outside allowed root: ${normalizedTarget}`;
    if (logger) {
      logger.warn(reason);
    }
    return { ok: false, reason };
  }

  if (dryRun) {
    if (logger) {
      logger.step(`DRY RUN: Would delete ${normalizedTarget}`);
    }
    return { ok: true, dryRun: true };
  }

  await fs.promises.rm(normalizedTarget, { recursive: true, force: true, maxRetries: 2 });
  if (logger) {
    logger.step(`Deleted ${normalizedTarget}`);
  }
  return { ok: true };
}

export async function withRetries(task, options = {}) {
  const {
    retries = 0,
    delayMs = 1200,
    label = 'task',
    onRetry = () => {},
  } = options;

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw lastError;
      }

      onRetry({ attempt: attempt + 1, maxRetries: retries, label, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw lastError;
}

export function getBackupRoot() {
  return path.join(os.homedir(), 'pnpm-migration-backups');
}

export function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function parseCliArgs(argv) {
  const options = {
    help: false,
    dryRun: undefined,
    parallel: undefined,
    deleteNodeModules: undefined,
    backup: undefined,
    autoApproveBuilds: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--parallel') {
      options.parallel = toPositiveInteger(argv[i + 1], undefined);
      i += 1;
    } else if (arg === '--delete-node-modules') {
      options.deleteNodeModules = true;
    } else if (arg === '--backup') {
      options.backup = true;
    } else if (arg === '--auto-approve-builds') {
      options.autoApproveBuilds = true;
    } else if (arg === '--root') {
      options.root = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

export function formatError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return JSON.stringify(error);
}
