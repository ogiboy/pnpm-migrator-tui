#!/usr/bin/env node

/**
 * PNPM Migration TUI Tool v2
 * Requires: npm i inquirer execa ora chalk cli-progress
 */

import inquirer from 'inquirer';
import { execa } from 'execa';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import cliProgress from 'cli-progress';

// Recursive project finder
async function findProjects(root) {
  const results = new Set();

  async function walk(dir) {
    const files = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const file of files) {
      const full = path.join(dir, file.name);
      if (file.isDirectory()) {
        if (file.name.startsWith('.') || file.name === 'node_modules') continue;
        await walk(full);
      }
      if (file.name === 'package.json') {
        results.add(dir);
      }
    }
  }

  await walk(root);
  return Array.from(results);
}

// Process a single project safely (cwd param)
async function processProject(dir, options) {
  const spinner = ora(`Processing ${dir}`).start();
  try {
    if (options.dryRun) {
      spinner.info(`[DRY RUN] Would process: ${dir}`);
      return { ok: true };
    }

    // Clean node_modules
    if (options.cleanNodeModules) {
      await execa(
        'bash',
        ['-c', "find . -type d -name 'node_modules*' -prune -exec rm -rf {} +"],
        { cwd: dir },
      );
    }

    if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
      await execa('pnpm', ['import'], { cwd: dir });
    }

    await execa('pnpm', ['install', '--frozen-lockfile=false'], {
      cwd: dir,
      stdio: 'ignore',
    });

    if (options.approveBuilds) {
      await execa('pnpm', ['approve-builds', '--all'], { cwd: dir });
    }

    if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
      fs.unlinkSync(path.join(dir, 'package-lock.json'));
    }

    spinner.succeed(`Done: ${dir}`);
    return { ok: true };
  } catch (err) {
    spinner.fail(`Failed: ${dir}`);
    return { ok: false, error: err.message };
  }
}

// Run queue with parallel workers
async function runQueue(projects, options) {
  const results = [];
  let index = 0;

  // Progress bar
  const progress = new cliProgress.SingleBar({
    format:
      'Progress |' +
      chalk.cyan('{bar}') +
      '| {percentage}% || {value}/{total} projects',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  progress.start(projects.length, 0);

  async function worker() {
    while (index < projects.length) {
      const current = projects[index++];
      const res = await processProject(current, options);
      results.push({ dir: current, ...res });
      progress.increment();
    }
  }

  const workers = Array.from({ length: options.jobs }, () => worker());
  await Promise.all(workers);
  progress.stop();

  return results;
}

// --- CLI logic ---
console.clear();
console.log(chalk.cyan('\n🚀 PNPM Migration TUI\n'));

const answers = await inquirer.prompt([
  {
    type: 'input',
    name: 'root',
    message: 'Root directory:',
    default: process.cwd(),
  },
  {
    type: 'confirm',
    name: 'dryRun',
    message: 'Dry run?',
    default: true,
  },
  {
    type: 'number',
    name: 'jobs',
    message: 'Parallel jobs:',
    default: 4,
  },
  {
    type: 'confirm',
    name: 'cleanNodeModules',
    message: 'Delete ALL node_modules (recommended for messy folders)?',
    default: true,
  },
  {
    type: 'confirm',
    name: 'approveBuilds',
    message: 'Auto approve pnpm builds?',
    default: true,
  },
]);

console.log(chalk.gray('\n🔍 Scanning projects...\n'));
const projects = await findProjects(answers.root);
console.log(chalk.green(`Found ${projects.length} projects\n`));

const confirm = await inquirer.prompt([
  {
    type: 'confirm',
    name: 'go',
    message: 'Start migration?',
    default: true,
  },
]);

if (!confirm.go) {
  console.log('Cancelled.');
  process.exit(0);
}

const results = await runQueue(projects, answers);
const failed = results.filter((r) => !r.ok);

console.log('\n----------------------------------');
console.log(chalk.green(`✅ Success: ${results.length - failed.length}`));
console.log(chalk.red(`❌ Failed: ${failed.length}`));

if (failed.length) {
  console.log('\nFailed projects:');
  failed.forEach((f) => console.log('-', f.dir));
}

console.log('\n🎉 Done!\n');
