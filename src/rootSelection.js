/**
 * rootSelection.js
 * Handles root directory prompts, fuzzy-selection with optional autocomplete,
 * cache persistence, and robust fallback behavior.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import inquirer from 'inquirer';
import { execa } from 'execa';
import fuzzy from 'fuzzy';

import { formatError, normalizePath, pathExists } from './utils.js';

const CACHE_FILE = path.join(os.homedir(), '.pnpm-migration-cache.json');
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPTIONAL_PREFIX = path.join(os.tmpdir(), 'pnpm-migrate-optional-deps');
const require = createRequire(import.meta.url);

function loadRootCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return { roots: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!Array.isArray(parsed.roots)) {
      return { roots: [] };
    }
    return parsed;
  } catch {
    return { roots: [] };
  }
}

function saveRootCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function buildDefaultRoots() {
  return [
    process.cwd(),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Documents', 'Projects'),
  ];
}

async function resolveAutocompletePrompt(logger) {
  try {
    const localResolved = require.resolve('inquirer-autocomplete-prompt');
    const mod = await import(localResolved);
    return mod.default || mod;
  } catch {
    logger.warn('Optional dependency "inquirer-autocomplete-prompt" is missing.');
  }

  logger.step('Trying to auto-install inquirer-autocomplete-prompt...');

  try {
    await fs.promises.mkdir(OPTIONAL_PREFIX, { recursive: true });
    const optionalPkgJson = path.join(OPTIONAL_PREFIX, 'package.json');
    if (!fs.existsSync(optionalPkgJson)) {
      await fs.promises.writeFile(
        optionalPkgJson,
        JSON.stringify({ name: 'pnpm-migrate-optional-deps', private: true }, null, 2),
        'utf8',
      );
    }

    const npmCacheDir = path.join(OPTIONAL_PREFIX, '.npm-cache');
    await fs.promises.mkdir(npmCacheDir, { recursive: true });

    await execa(
      'npm',
      [
        'install',
        '--prefix',
        OPTIONAL_PREFIX,
        '--no-save',
        '--no-audit',
        '--no-fund',
        '--legacy-peer-deps',
        '--cache',
        npmCacheDir,
        'inquirer-autocomplete-prompt@latest',
      ],
      { cwd: TOOL_ROOT, stdio: 'ignore' },
    );

    const resolvedAfterInstall = require.resolve('inquirer-autocomplete-prompt', {
      paths: [OPTIONAL_PREFIX, TOOL_ROOT],
    });
    const mod = await import(resolvedAfterInstall);
    logger.success('Autocomplete prompt installed successfully.');
    return mod.default || mod;
  } catch (error) {
    logger.warn(
      `Autocomplete plugin install failed, using input fallback. (${formatError(error)})`,
    );
    return null;
  }
}

async function promptWithAutocomplete(choices) {
  const answer = await inquirer.prompt([
    {
      type: 'autocomplete',
      name: 'root',
      message: 'Select root directory:',
      source: (_answersSoFar, input = '') =>
        Promise.resolve(fuzzy.filter(input, choices).map((entry) => entry.original)),
    },
  ]);

  return answer.root;
}

async function promptWithInput(defaultRoot) {
  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'root',
      message: 'Root directory to scan:',
      default: defaultRoot,
      filter: (value) => normalizePath(value),
      validate: async (value) => {
        const normalized = normalizePath(value);
        const exists = await pathExists(normalized);
        if (!exists) {
          return `Path does not exist: ${normalized}`;
        }
        return true;
      },
    },
  ]);

  return answer.root;
}

export async function selectRootDirectory(logger, cliRoot) {
  if (cliRoot) {
    const normalized = normalizePath(cliRoot);
    const exists = await pathExists(normalized);
    if (!exists) {
      throw new Error(`Provided root does not exist: ${normalized}`);
    }
    return normalized;
  }

  const cache = loadRootCache();
  const candidates = [...cache.roots, ...buildDefaultRoots()]
    .map((entry) => normalizePath(entry))
    .filter((entry, index, arr) => arr.indexOf(entry) === index);

  const existingCandidates = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      existingCandidates.push(candidate);
    }
  }

  let selectedRoot = null;
  const autocompletePrompt = await resolveAutocompletePrompt(logger);
  if (autocompletePrompt && existingCandidates.length > 0) {
    try {
      inquirer.registerPrompt('autocomplete', autocompletePrompt);
      selectedRoot = await promptWithAutocomplete(existingCandidates);
    } catch (error) {
      logger.warn(
        `Autocomplete prompt registration failed, using input fallback. (${formatError(error)})`,
      );
    }
  }

  if (!selectedRoot) {
    if (existingCandidates.length === 0) {
      logger.warn('No cached roots found. Falling back to manual root input.');
    }
    const defaultRoot = existingCandidates[0] || normalizePath(process.cwd());
    selectedRoot = await promptWithInput(defaultRoot);
  }

  const normalizedSelection = normalizePath(selectedRoot);
  const exists = await pathExists(normalizedSelection);
  if (!exists) {
    throw new Error(`Selected root does not exist: ${normalizedSelection}`);
  }

  const updatedRoots = [
    normalizedSelection,
    ...cache.roots
      .map((entry) => normalizePath(entry))
      .filter((entry) => entry !== normalizedSelection),
  ].slice(0, 10);

  saveRootCache({ roots: updatedRoots });
  return normalizedSelection;
}
