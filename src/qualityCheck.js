/**
 * qualityCheck.js
 * Performs internal self-checks for environment validity, path safety, and
 * expected module execution order to keep runs predictable and auditable.
 */

import { isSubPath } from './utils.js';

const EXPECTED_ORDER = [
  'env-check',
  'root-selection',
  'project-discovery',
  'migration',
  'summary',
];

function checkExecutionOrder(executedSteps) {
  const problems = [];
  let lastIndex = -1;

  for (const expected of EXPECTED_ORDER) {
    const index = executedSteps.indexOf(expected);
    if (index === -1) {
      problems.push(`Missing pipeline step: ${expected}`);
      continue;
    }

    if (index < lastIndex) {
      problems.push(`Out-of-order step detected: ${expected}`);
    }

    lastIndex = index;
  }

  return problems;
}

function checkBaseContext(context) {
  const findings = [];

  if (!context.env?.nodeVersion || !context.env?.pnpmVersion) {
    findings.push('Environment details are incomplete.');
  }

  if (!context.root) {
    findings.push('Selected root is missing.');
  }

  if (!Array.isArray(context.projects)) {
    findings.push('Project discovery result is not an array.');
  }

  if (
    !context.options ||
    typeof context.options.parallel !== 'number' ||
    context.options.parallel < 1
  ) {
    findings.push('Parallel option is invalid.');
  }

  return findings;
}

function checkProjectsWithinRoot(root, projects) {
  const findings = [];
  for (const project of projects) {
    if (!isSubPath(root, project)) {
      findings.push(`Project outside selected root: ${project}`);
    }
  }
  return findings;
}

function checkMigrationResultCount(projects, migrationResults) {
  if (migrationResults.length === 0) {
    return [];
  }

  if (migrationResults.length === projects.length) {
    return [];
  }

  return [
    `Migration results count mismatch. expected=${projects.length} actual=${migrationResults.length}`,
  ];
}

function checkDuplicateResults(migrationResults) {
  const findings = [];
  const seenProjects = new Set();

  for (const result of migrationResults) {
    if (seenProjects.has(result.project)) {
      findings.push(`Duplicate migration result detected for ${result.project}`);
      continue;
    }
    seenProjects.add(result.project);
  }

  return findings;
}

function checkBlockedDeletions(migrationResults) {
  const findings = [];
  for (const result of migrationResults) {
    for (const deletion of result.deletions || []) {
      if (!deletion.ok) {
        findings.push(`Blocked or failed deletion: ${deletion.path}`);
      }
    }
  }
  return findings;
}

export function runSelfQualityCheck(context, logger) {
  const {
    root,
    projects,
    executedSteps,
    migrationResults = [],
  } = context;
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safeExecutedSteps = executedSteps || [];

  const findings = [
    ...checkBaseContext(context),
    ...checkProjectsWithinRoot(root, safeProjects),
    ...checkMigrationResultCount(safeProjects, migrationResults),
    ...checkDuplicateResults(migrationResults),
    ...checkBlockedDeletions(migrationResults),
    ...checkExecutionOrder(safeExecutedSteps),
  ];

  if (findings.length === 0) {
    logger.success('Self-quality check passed.');
    return { ok: true, findings: [] };
  }

  logger.warn('Self-quality check reported issues:');
  for (const finding of findings) {
    logger.warn(`- ${finding}`);
  }

  return { ok: false, findings };
}
