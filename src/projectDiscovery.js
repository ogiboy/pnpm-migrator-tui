/**
 * projectDiscovery.js
 * Recursively scans a root directory for Node.js projects, treating folders
 * containing package.json as migratable projects while skipping hidden folders
 * and node_modules.
 */

import fs from 'node:fs';
import path from 'node:path';

import { formatError, normalizePath } from './utils.js';

const SKIP_DIRS = new Set(['node_modules']);

function hasPackageJson(entries) {
  return entries.some((entry) => entry.name === 'package.json' && entry.isFile());
}

function shouldSkipDirectory(entryName) {
  return entryName.startsWith('.') || SKIP_DIRS.has(entryName);
}

function collectChildDirectories(current, entries) {
  const children = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (shouldSkipDirectory(entry.name)) {
      continue;
    }

    children.push(path.join(current, entry.name));
  }
  return children;
}

async function readDirectoryEntries(current, logger) {
  try {
    return await fs.promises.readdir(current, { withFileTypes: true });
  } catch (error) {
    logger.warn(`Skipping unreadable directory ${current}: ${formatError(error)}`);
    return null;
  }
}

export async function discoverProjects(root, logger) {
  const projects = new Set();
  const queue = [normalizePath(root)];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await readDirectoryEntries(current, logger);
    if (!entries) {
      continue;
    }

    if (hasPackageJson(entries)) {
      projects.add(current);
    }

    queue.push(...collectChildDirectories(current, entries));
  }

  return [...projects].sort((a, b) => a.localeCompare(b));
}
