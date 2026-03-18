/**
 * envCheck.js
 * Validates Node.js/PNPM/Corepack availability and performs safe, user-confirmed
 * install or update steps when required.
 */

import inquirer from 'inquirer';
import { execa } from 'execa';

import { formatError } from './utils.js';

const MIN_NODE_MAJOR = 20;
const MIN_RECOMMENDED_PNPM_MAJOR = 8;

async function getCommandVersion(command, args = ['--version']) {
  try {
    const { stdout } = await execa(command, args, { stdio: 'pipe' });
    return stdout.trim();
  } catch {
    return null;
  }
}

function parseMajor(versionText) {
  if (!versionText) {
    return null;
  }

  const cleaned = versionText.replace(/^v/i, '');
  const major = Number.parseInt(cleaned.split('.')[0], 10);
  return Number.isNaN(major) ? null : major;
}

async function confirmAction(message, defaultValue = true) {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'go',
      message,
      default: defaultValue,
    },
  ]);

  return answer.go;
}

function assertSupportedNode(nodeVersion) {
  const nodeMajor = parseMajor(nodeVersion);
  if (nodeMajor === null || nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(
      `Node.js ${MIN_NODE_MAJOR}+ is required. Current version: ${nodeVersion}`,
    );
  }
}

async function installPnpmWithCorepack() {
  await execa('corepack', ['enable'], { stdio: 'inherit' });
  await execa('corepack', ['prepare', 'pnpm@latest', '--activate'], {
    stdio: 'inherit',
  });
}

async function installPnpmWithNpm() {
  await execa('npm', ['install', '-g', 'pnpm@latest'], { stdio: 'inherit' });
}

async function maybeInstallPnpm({ pnpmVersion, corepackVersion, npmVersion, logger, actions }) {
  if (pnpmVersion) {
    return pnpmVersion;
  }

  logger.warn('PNPM was not found in PATH.');

  if (corepackVersion) {
    const shouldInstall = await confirmAction(
      'PNPM not found. Enable Corepack and activate latest PNPM now?',
      true,
    );
    if (shouldInstall) {
      await installPnpmWithCorepack();
      actions.push('Installed PNPM with Corepack.');
    }
  } else if (npmVersion) {
    const shouldInstall = await confirmAction(
      'Corepack is unavailable. Install PNPM globally with npm now?',
      false,
    );
    if (shouldInstall) {
      await installPnpmWithNpm();
      actions.push('Installed PNPM globally with npm.');
    }
  }

  const refreshed = await getCommandVersion('pnpm');
  if (!refreshed) {
    throw new Error(
      'PNPM is required but could not be installed automatically. Install PNPM and re-run.',
    );
  }

  return refreshed;
}

async function maybeUpdateLegacyPnpm({ corepackVersion, pnpmVersion, actions }) {
  if (!corepackVersion) {
    return pnpmVersion;
  }

  const pnpmMajor = parseMajor(pnpmVersion);
  const needsUpdate =
    pnpmMajor !== null && pnpmMajor < MIN_RECOMMENDED_PNPM_MAJOR;
  if (!needsUpdate) {
    return pnpmVersion;
  }

  const shouldUpdate = await confirmAction(
    `Detected PNPM ${pnpmVersion}. Update to latest via Corepack?`,
    true,
  );
  if (!shouldUpdate) {
    return pnpmVersion;
  }

  await execa('corepack', ['prepare', 'pnpm@latest', '--activate'], {
    stdio: 'inherit',
  });
  actions.push('Updated PNPM via Corepack.');
  return getCommandVersion('pnpm');
}

async function collectEnvironmentVersions() {
  return {
    nodeVersion: process.version,
    corepackVersion: await getCommandVersion('corepack'),
    pnpmVersion: await getCommandVersion('pnpm'),
    npmVersion: await getCommandVersion('npm'),
  };
}

export async function runEnvironmentChecks(logger) {
  const versions = await collectEnvironmentVersions();
  const actions = [];

  assertSupportedNode(versions.nodeVersion);

  let pnpmVersion = await maybeInstallPnpm({
    pnpmVersion: versions.pnpmVersion,
    corepackVersion: versions.corepackVersion,
    npmVersion: versions.npmVersion,
    logger,
    actions,
  });

  pnpmVersion = await maybeUpdateLegacyPnpm({
    corepackVersion: versions.corepackVersion,
    pnpmVersion,
    actions,
  });

  return {
    nodeVersion: versions.nodeVersion,
    pnpmVersion,
    corepackVersion: versions.corepackVersion,
    actions,
  };
}

export function getEnvironmentErrorMessage(error) {
  return `Environment check failed: ${formatError(error)}`;
}
