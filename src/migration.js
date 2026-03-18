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
  formatError,
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

async function findNodeModulesDirs(projectDir, logger) {
  const toDelete = [];
  const queue = [projectDir];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (error) {
      logger.warn(`Unable to scan ${current} for node_modules cleanup: ${formatError(error)}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.name.startsWith('node_modules')) {
        toDelete.push(fullPath);
        continue;
      }

      if (entry.name.startsWith('.')) {
        continue;
      }

      queue.push(fullPath);
    }
  }

  return toDelete;
}

async function deleteNodeModulesDirs(projectDir, root, options) {
  const { logger, dryRun } = options;
  const dirs = await findNodeModulesDirs(projectDir, logger);
  const deletions = [];

  for (const dir of dirs) {
    const deletion = await safeDeletePath(dir, {
      allowedRoot: root,
      dryRun,
      logger,
    });
    deletions.push({ path: dir, ...deletion });
  }

  return deletions;
}

async function runPnpmInstallWithRetry(projectDir, logger) {
  await withRetries(
    async (attempt) => {
      logger.step(`pnpm install attempt ${attempt + 1} in ${projectDir}`);
      await execa('pnpm', ['install', '--frozen-lockfile=false'], {
        cwd: projectDir,
        stdio: 'pipe',
      });
    },
    {
      retries: 2,
      label: `pnpm install (${projectDir})`,
      onRetry: ({ attempt, maxRetries, error }) => {
        logger.warn(
          `Install failed for ${projectDir}; retry ${attempt}/${maxRetries}. (${formatError(error)})`,
        );
      },
    },
  );
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
    steps: [],
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
      logger.step(`DRY RUN: Would migrate ${normalizedProject}`);
      return result;
    }

    if (backup) {
      result.backupDir = await backupProjectFiles(normalizedProject);
      result.steps.push('backup');
    }

    if (deleteNodeModules) {
      result.deletions = await deleteNodeModulesDirs(normalizedProject, root, {
        logger,
        dryRun,
      });
      result.steps.push('delete-node-modules');
    }

    if (fs.existsSync(lockfilePath)) {
      logger.step(`pnpm import in ${normalizedProject}`);
      await execa('pnpm', ['import'], { cwd: normalizedProject, stdio: 'pipe' });
      result.steps.push('pnpm-import');
    }

    await runPnpmInstallWithRetry(normalizedProject, logger);
    result.steps.push('pnpm-install');

    if (autoApproveBuilds) {
      logger.step(`pnpm approve-builds --all in ${normalizedProject}`);
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
      error: formatError(error),
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
      progress.increment();

      if (result.status === 'failed') {
        logger.error(`Failed: ${result.project}`);
      } else if (result.status === 'skipped') {
        logger.warn(`Skipped (dry run): ${result.project}`);
      } else {
        logger.success(`Done: ${result.project}`);
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  progress.stop();

  return results;
}
