#!/usr/bin/env node

/**
 * PNPM Migration TUI Tool v6
 * Requires: npm i inquirer execa ora chalk cli-progress fuzzy
 */

import inquirer from 'inquirer';
import { execa } from 'execa';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import cliProgress from 'cli-progress';
import fuzzy from 'fuzzy';
import os from 'node:os';

// --- Cache & Backup Paths ---
const CACHE_FILE = path.join(os.homedir(), '.pnpm-migration-cache.json');
const BACKUP_ROOT = path.join(os.homedir(), 'pnpm-migration-backups');

// --- Helper: sleep ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Cache load/save ---
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return { roots: [] };
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return { roots: [] };
  }
}
function saveCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Fuzzy prompt ---
async function fuzzyPrompt(message, choices) {
  const answer = await inquirer.prompt([
    {
      type: 'autocomplete',
      name: 'selection',
      message,
      source: (_answersSoFar, input = '') => {
        return Promise.resolve(
          fuzzy.filter(input, choices).map((el) => el.original),
        );
      },
    },
  ]);
  return answer.selection;
}

// --- Recursive project finder ---
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
      if (file.name === 'package.json') results.add(dir);
    }
  }
  await walk(root);
  return Array.from(results);
}

// --- Backup a project ---
function backupProject(dir) {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const projectName = path.basename(dir);
  const backupDir = path.join(BACKUP_ROOT, `${timestamp}_${projectName}`);
  fs.mkdirSync(backupDir, { recursive: true });

  ['package.json', 'package-lock.json'].forEach((file) => {
    const src = path.join(dir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, file));
    }
  });

  return backupDir;
}

// --- Process a single project ---
async function processProject(dir, options) {
  const spinner = ora(`Processing ${dir}`).start();
  let backupDir = null;
  try {
    if (options.dryRun) {
      spinner.info(`[DRY RUN] Would process: ${dir}`);
      return { ok: true };
    }

    if (options.backup) {
      backupDir = backupProject(dir);
    }

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

    // Retry logic
    let attempt = 0;
    const maxAttempts = 2;
    while (attempt < maxAttempts) {
      try {
        await execa('pnpm', ['install', '--frozen-lockfile=false'], {
          cwd: dir,
          stdio: 'ignore',
        });
        break;
      } catch (err) {
        attempt++;
        if (attempt >= maxAttempts) throw err;
      }
    }

    if (options.approveBuilds) {
      await execa('pnpm', ['approve-builds', '--all'], { cwd: dir });
    }

    if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
      fs.unlinkSync(path.join(dir, 'package-lock.json'));
    }

    const backupMsg = backupDir ? ' (backup: ' + backupDir + ')' : '';
    spinner.succeed('Done: ' + dir + backupMsg);

    return { ok: true, backup: backupDir };
  } catch (err) {
    spinner.fail(`Failed: ${dir}`);
    return { ok: false, error: err.message, backup: backupDir };
  }
}

// --- Run queue with progress ---
async function runQueue(projects, options) {
  const results = [];
  let index = 0;
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

// --- CLI Logic ---
console.clear();
console.log(chalk.cyan('\n🚀 PNPM Migration TUI v6\n'));

// Load previous roots
const cache = loadCache();
const popularRoots = [
  path.join(os.homedir(), 'Documents/Projects'),
  path.join(os.homedir(), 'Documents/BACodesandbox'),
];
const rootChoices = [
  ...cache.roots,
  ...popularRoots.filter((r) => !cache.roots.includes(r)),
];

// Root folder selection
const root = await fuzzyPrompt('Select root directory:', rootChoices);
cache.roots = [root, ...cache.roots.filter((r) => r !== root)].slice(0, 10);
saveCache(cache);

const answers = await inquirer.prompt([
  { type: 'confirm', name: 'dryRun', message: 'Dry run?', default: true },
  { type: 'number', name: 'jobs', message: 'Parallel jobs:', default: 4 },
  {
    type: 'confirm',
    name: 'cleanNodeModules',
    message: 'Delete ALL node_modules?',
    default: true,
  },
  {
    type: 'confirm',
    name: 'approveBuilds',
    message: 'Auto approve pnpm builds?',
    default: true,
  },
  {
    type: 'confirm',
    name: 'backup',
    message: 'Backup package files before migration?',
    default: true,
  },
]);

console.log(chalk.gray('\n🔍 Scanning projects...\n'));
let projects = await findProjects(root);
console.log(chalk.green(`Found ${projects.length} projects\n`));

// Optional: show fuzzy list to select which projects to migrate
if (projects.length > 20) {
  const confirmList = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'showList',
      message: 'Show projects to select?',
      default: false,
    },
  ]);
  if (confirmList.showList) {
    const selected = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'chosenProjects',
        message: 'Select projects to migrate:',
        choices: projects,
        pageSize: 15,
      },
    ]);
    projects = selected.chosenProjects;
  }
}

const confirm = await inquirer.prompt([
  { type: 'confirm', name: 'go', message: 'Start migration?', default: true },
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
  failed.forEach((f) =>
    console.log('-', f.dir, f.backup ? `(backup: ${f.backup})` : ''),
  );
}

console.log(`\nBackups stored in: ${BACKUP_ROOT}`);
console.log('\n🎉 Migration complete!\n');
