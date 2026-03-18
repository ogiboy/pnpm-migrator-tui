/**
 * logging.js
 * Centralizes user-facing logs, progress rendering, and migration summaries.
 */

import chalk from 'chalk';
import cliProgress from 'cli-progress';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

export function createLogger() {
  const trace = [];

  const write = (level, message) => {
    trace.push({ time: nowIso(), level, message });
  };

  return {
    trace,
    info(message) {
      write('info', message);
      console.log(chalk.cyan(message));
    },
    success(message) {
      write('success', message);
      console.log(chalk.green(message));
    },
    warn(message) {
      write('warn', message);
      console.log(chalk.yellow(message));
    },
    error(message) {
      write('error', message);
      console.error(chalk.red(message));
    },
    step(message) {
      write('step', message);
      console.log(chalk.gray(message));
    },
    plain(message) {
      write('plain', message);
      console.log(message);
    },
    section(title) {
      write('section', title);
      console.log(chalk.bold.cyan(`\n${title}`));
    },
  };
}

export function createProgressTracker(total) {
  const bar = new cliProgress.SingleBar(
    {
      format: `Progress |${chalk.cyan('{bar}')}| {percentage}% || {value}/{total} projects`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: true,
      stopOnComplete: true,
    },
    cliProgress.Presets.shades_classic,
  );

  bar.start(total, 0);

  return {
    increment() {
      bar.increment();
    },
    stop() {
      bar.stop();
    },
  };
}

export function logEnvironment(logger, env) {
  logger.section('Environment Check');
  logger.step(`Node.js: ${env.nodeVersion}`);
  logger.step(`PNPM: ${env.pnpmVersion || 'Not found'}`);
  logger.step(`Corepack: ${env.corepackVersion || 'Not found'}`);

  if (env.actions.length > 0) {
    for (const action of env.actions) {
      logger.step(`Action: ${action}`);
    }
  }
}

export function logDiscoveryResult(logger, root, projects) {
  logger.section('Project Discovery');
  logger.step(`Root: ${root}`);
  logger.success(`Found ${projects.length} project(s).`);
}

export function printSummary(logger, results) {
  const success = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');

  logger.section('Migration Summary');
  logger.success(`Success: ${success.length}`);
  logger.warn(`Skipped: ${skipped.length}`);

  if (failed.length > 0) {
    logger.error(`Failed: ${failed.length}`);
    for (const entry of failed) {
      logger.error(`- ${entry.project}: ${entry.error}`);
    }
  } else {
    logger.success('Failed: 0');
  }

  if (success.length > 0) {
    logger.plain('\nCompleted projects:');
    for (const entry of success) {
      logger.plain(`- ${entry.project}`);
    }
  }

  return {
    success: success.length,
    failed: failed.length,
    skipped: skipped.length,
  };
}

export async function writeTraceLog(logger, runMeta = {}) {
  const logPath = path.join(os.homedir(), '.pnpm-migration-last-run.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    runMeta,
    trace: logger.trace,
  };

  await fs.promises.writeFile(logPath, JSON.stringify(payload, null, 2), 'utf8');
  return logPath;
}
