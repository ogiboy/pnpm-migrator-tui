/**
 * migration.js
 * Executes per-project migration steps with safety checks:
 * backup, node_modules cleanup, pnpm import/install, approve builds, and
 * lockfile cleanup.
 */

import fs from 'node:fs';
import path from 'node:path';

import { execa } from 'execa';

import {
  ensureDir,
  getBackupRoot,
  isSubPath,
  normalizePath,
  safeDeletePath,
  withRetries,
} from './utils.js';
import { createProgressTracker } from './logging.js';

async function backupProjectFiles(projectDir) {
  const backupRoot = getBackupRoot();
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const projectName = path.basename(projectDir);
  const backupDir = path.join(backupRoot, `${timestamp}_${projectName}`);

  await ensureDir(backupDir);

  for (const fileName of ['package.json', 'package-lock.json']) {
    const src = path.join(projectDir, fileName);
    if (fs.existsSync(src)) {
      const dest = path.join(backupDir, fileName);
      await fs.promises.copyFile(src, dest);
    }
  }

  return backupDir;
}

async function findNodeModulesTargets(projectDir) {
  const toDelete = [];
  const warnings = [];
  const queue = [projectDir];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Unable to scan ${current} for node_modules cleanup.`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.name.startsWith('node_modules')) {
        toDelete.push(fullPath);
        continue;
      }

      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name.startsWith('.')) {
        continue;
      }

      queue.push(fullPath);
    }
  }

  return { toDelete, warnings };
}

async function deleteNodeModulesDirs(projectDir, root, options) {
  const { dryRun } = options;
  const { toDelete, warnings } = await findNodeModulesTargets(projectDir);
  const deletions = [];

  for (const dir of toDelete) {
    const deletion = await safeDeletePath(dir, {
      allowedRoot: root,
      dryRun,
      logger: null,
    });
    deletions.push({ path: dir, ...deletion });
  }

  return { deletions, warnings };
}

function getFirstMeaningfulLine(text) {
  if (!text) {
    return '';
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || '';
}

function summarizeError(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
  const shortMessage =
    typeof error?.shortMessage === 'string' ? error.shortMessage : '';
  const message = typeof error?.message === 'string' ? error.message : 'Unknown error';
  const combined = `${stderr}\n${shortMessage}\n${message}`;

  if (combined.includes('ENOTDIR')) {
    return 'Path conflict (ENOTDIR): a folder was expected but a file exists in the path.';
  }

  if (combined.includes('EACCES') || combined.includes('EPERM')) {
    return 'Permission error: check read/write permissions for this project directory.';
  }

  if (combined.includes('ERR_PNPM_')) {
    return getFirstMeaningfulLine(stderr) || getFirstMeaningfulLine(shortMessage) || message;
  }

  return getFirstMeaningfulLine(shortMessage) || getFirstMeaningfulLine(stderr) || message;
}

function captureErrorDetails(error) {
  const parts = [];
  if (typeof error?.shortMessage === 'string' && error.shortMessage.trim()) {
    parts.push(error.shortMessage.trim());
  }
  if (typeof error?.stderr === 'string' && error.stderr.trim()) {
    parts.push(error.stderr.trim());
  }
  if (typeof error?.stdout === 'string' && error.stdout.trim()) {
    parts.push(error.stdout.trim());
  }
  if (parts.length === 0 && typeof error?.message === 'string') {
    parts.push(error.message);
  }
  return parts.join('\n\n');
}

async function runPnpmInstallWithRetry(projectDir) {
  let attempts = 0;

  await withRetries(
    async () => {
      attempts += 1;
      await execa('pnpm', ['install', '--frozen-lockfile=false'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
    },
    {
      retries: 2,
      label: `pnpm install (${projectDir})`,
      onRetry: () => {},
    },
  );

  return attempts;
}

export async function migrateProject(projectDir, options) {
  const {
    dryRun,
    backup,
    deleteNodeModules,
    autoApproveBuilds,
    root,
    logger,
  } = options;

  const normalizedProject = normalizePath(projectDir);
  const lockfilePath = path.join(normalizedProject, 'package-lock.json');
  const result = {
    project: normalizedProject,
    status: 'success',
    error: null,
    backupDir: null,
    deletions: [],
    warnings: [],
    steps: [],
    installAttempts: 0,
    errorDetails: null,
  };

  if (!isSubPath(root, normalizedProject)) {
    return {
      ...result,
      status: 'failed',
      error: 'Project path is outside selected root.',
    };
  }

  try {
    if (dryRun) {
      result.status = 'skipped';
      result.steps.push('dry-run');
      logger.debug(`DRY RUN: Would migrate ${normalizedProject}`);
      return result;
    }

    if (backup) {
      result.backupDir = await backupProjectFiles(normalizedProject);
      result.steps.push('backup');
    }

    if (deleteNodeModules) {
      const cleanupResult = await deleteNodeModulesDirs(normalizedProject, root, {
        dryRun,
      });
      result.deletions = cleanupResult.deletions;
      result.warnings.push(...cleanupResult.warnings);
      result.steps.push('delete-node-modules');
    }

    if (fs.existsSync(lockfilePath)) {
      await execa('pnpm', ['import'], { cwd: normalizedProject, stdio: 'pipe' });
      result.steps.push('pnpm-import');
    }

    result.installAttempts = await runPnpmInstallWithRetry(normalizedProject);
    result.steps.push('pnpm-install');

    if (autoApproveBuilds) {
      await execa('pnpm', ['approve-builds', '--all'], {
        cwd: normalizedProject,
        stdio: 'pipe',
      });
      result.steps.push('pnpm-approve-builds');
    }

    if (fs.existsSync(lockfilePath)) {
      const inRoot = isSubPath(root, lockfilePath);
      if (!inRoot) {
        throw new Error(`Refusing to delete lockfile outside root: ${lockfilePath}`);
      }
      await fs.promises.unlink(lockfilePath);
      result.steps.push('delete-package-lock');
    }

    return result;
  } catch (error) {
    return {
      ...result,
      status: 'failed',
      error: summarizeError(error),
      errorDetails: captureErrorDetails(error),
    };
  }
}

export async function runMigrations(projects, options) {
  const logger = options.logger;
  const results = [];
  const progress = createProgressTracker(projects.length);
  const queue = [...projects];
  const workerCount = Math.max(1, options.parallel);

  async function worker() {
    while (queue.length > 0) {
      const project = queue.shift();
      if (!project) {
        return;
      }

      const result = await migrateProject(project, options);
      results.push(result);
      progress.increment(result.status);
      logger.debug(`[${result.status}] ${result.project}`);
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  progress.stop();

  return results;
}
