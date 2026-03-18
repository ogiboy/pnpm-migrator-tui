#!/usr/bin/env node

/**
 * pnpm-migration-tui.js
 * Entrypoint for the modular pnpm-migrate CLI/TUI workflow.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';

import {
  runEnvironmentChecks,
  getEnvironmentErrorMessage,
} from './src/envCheck.js';
import { selectRootDirectory } from './src/rootSelection.js';
import { discoverProjects } from './src/projectDiscovery.js';
import { runMigrations } from './src/migration.js';
import {
  createLogger,
  logDiscoveryResult,
  logEnvironment,
  printSummary,
  writeTraceLog,
} from './src/logging.js';
import { runSelfQualityCheck } from './src/qualityCheck.js';
import { formatError, parseCliArgs, toPositiveInteger } from './src/utils.js';

function printHelp() {
  console.log(`
pnpm-migrate - migrate npm lockfile projects to pnpm

Usage:
  pnpm-migrate [options]

Options:
  --dry-run                  Preview without changing files.
  --parallel <N>             Number of concurrent project migrations.
  --delete-node-modules      Delete node_modules* directories in each project.
  --backup                   Backup package files before migration.
  --auto-approve-builds      Run pnpm approve-builds --all after install.
  --root <path>              Set scan root without prompting.
  -h, --help                 Show this help message.
`);
}

async function promptRuntimeOptions(cliOptions) {
  const questions = [];
  const resolved = {};

  if (typeof cliOptions.dryRun === 'boolean') {
    resolved.dryRun = cliOptions.dryRun;
  } else {
    questions.push({
      type: 'confirm',
      name: 'dryRun',
      message: 'Dry run?',
      default: true,
    });
  }

  if (typeof cliOptions.parallel === 'number') {
    resolved.parallel = toPositiveInteger(cliOptions.parallel, 4);
  } else {
    questions.push({
      type: 'number',
      name: 'parallel',
      message: 'Parallel jobs:',
      default: 4,
      validate: (value) => {
        const parsed = Number.parseInt(String(value), 10);
        return parsed > 0 || 'Parallel jobs must be a positive number.';
      },
      filter: (value) => Number.parseInt(String(value), 10),
    });
  }

  if (typeof cliOptions.deleteNodeModules === 'boolean') {
    resolved.deleteNodeModules = cliOptions.deleteNodeModules;
  } else {
    questions.push({
      type: 'confirm',
      name: 'deleteNodeModules',
      message: 'Delete ALL node_modules* directories?',
      default: true,
    });
  }

  if (typeof cliOptions.autoApproveBuilds === 'boolean') {
    resolved.autoApproveBuilds = cliOptions.autoApproveBuilds;
  } else {
    questions.push({
      type: 'confirm',
      name: 'autoApproveBuilds',
      message: 'Auto approve pnpm builds?',
      default: true,
    });
  }

  if (typeof cliOptions.backup === 'boolean') {
    resolved.backup = cliOptions.backup;
  } else {
    questions.push({
      type: 'confirm',
      name: 'backup',
      message: 'Backup package files before migration?',
      default: true,
    });
  }

  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};
  return { ...resolved, ...answers };
}

async function confirmDestructiveActions(options) {
  if (!options.deleteNodeModules || options.dryRun) {
    return true;
  }

  const confirmation = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'ok',
      message:
        'This will delete node_modules* directories from selected projects. Continue?',
      default: false,
    },
  ]);

  return confirmation.ok;
}

async function maybeSelectProjects(projects) {
  if (projects.length <= 20) {
    return projects;
  }

  const showPrompt = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'showList',
      message: 'Show projects to select?',
      default: false,
    },
  ]);

  if (!showPrompt.showList) {
    return projects;
  }

  const selected = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'chosenProjects',
      message: 'Select projects to migrate:',
      choices: projects,
      pageSize: 15,
    },
  ]);

  return selected.chosenProjects;
}

async function run() {
  console.clear();
  console.log(chalk.cyan('\nPNPM Migration TUI\n'));

  const logger = createLogger();
  const executedSteps = [];
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    printHelp();
    return;
  }

  let env;
  let root;
  let projects = [];
  let options;
  let results = [];

  try {
    env = await runEnvironmentChecks(logger);
    executedSteps.push('env-check');
    logEnvironment(logger, env);

    root = await selectRootDirectory(logger, cliOptions.root);
    executedSteps.push('root-selection');

    options = await promptRuntimeOptions(cliOptions);
    const destructiveConfirmed = await confirmDestructiveActions(options);
    if (!destructiveConfirmed) {
      logger.warn('Destructive action was not confirmed. Cancelling run.');
      return;
    }

    logger.section('Scanning Projects');
    projects = await discoverProjects(root, logger);
    executedSteps.push('project-discovery');
    logDiscoveryResult(logger, root, projects);

    if (projects.length === 0) {
      logger.warn(
        'No Node.js projects found under selected root. Try a different path and run again.',
      );
      return;
    }

    projects = await maybeSelectProjects(projects);
    if (projects.length === 0) {
      logger.warn('No projects selected. Nothing to migrate.');
      return;
    }

    const confirmStart = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'go',
        message: 'Start migration?',
        default: true,
      },
    ]);

    if (!confirmStart.go) {
      logger.warn('Migration cancelled by user.');
      return;
    }

    logger.section('Migration Running');
    logger.step('Processing projects... only progress is shown until completion.');

    results = await runMigrations(projects, {
      ...options,
      root,
      logger,
    });
    executedSteps.push('migration');

    logger.success('Migration phase completed.');

    const summary = printSummary(logger, results);
    executedSteps.push('summary');

    runSelfQualityCheck(
      {
        env,
        root,
        projects,
        options,
        executedSteps,
        migrationResults: results,
      },
      logger,
    );

    const tracePath = await writeTraceLog(logger, {
      root,
      options,
      summary,
      executedSteps,
      failures: results
        .filter((entry) => entry.status === 'failed')
        .map((entry) => ({
          project: entry.project,
          error: entry.error,
          errorDetails: entry.errorDetails,
        })),
    });
    logger.step(`Trace log written to ${tracePath}`);
  } catch (error) {
    if (env) {
      logger.error(`Migration run failed: ${formatError(error)}`);
    } else {
      logger.error(getEnvironmentErrorMessage(error));
    }
    process.exitCode = 1;
  }
}

await run();
