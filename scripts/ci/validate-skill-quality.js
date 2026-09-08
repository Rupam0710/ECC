#!/usr/bin/env node
/**
 * Validate the quality of curated skill files.
 *
 * Checks for the minimum structure and safety bar expected by ECC before a
 * contribution is merged, without overblocking contributors during initial
 * onboarding.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT_SKILLS === '1';

function parseFrontmatter(content) {
  const cleaned = content.replace(/^\uFEFF/, '');
  const match = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { __invalid: true };
    }
    return parsed;
  } catch {
    return { __invalid: true };
  }
}

const REQUIRED_SECTIONS = [
  'When to Activate',
  'Core Concepts',
  'Examples',
  'Anti-Patterns',
  'Best Practices',
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|passwd|password|access[_-]?key)[\s:="']+[A-Za-z0-9_-]{8,}/i,
  /sk_(?:live|test)_[A-Za-z0-9]+/i,
  /ghp_[A-Za-z0-9]{20,}/i,
  /xox[baprs]-[A-Za-z0-9-]+/i,
];

function logInfo(message) {
  console.info(message);
}

function logError(message) {
  console.error(`ERROR: ${message}`);
}

function logWarning(message) {
  console.warn(`WARN: ${message}`);
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function extractSectionBody(markdown, sectionTitle) {
  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionPattern = REQUIRED_SECTIONS.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = markdown.match(new RegExp(String.raw`^##?\s*${escapedTitle}\s*\n+([\s\S]*?)(?=^##?\s*(?:${sectionPattern})\s*$|$)`, 'm'));
  return match ? match[1].trim() : '';
}

function findMissingSections(markdown) {
  const missing = [];
  for (const section of REQUIRED_SECTIONS) {
    const heading = new RegExp(`^##?\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
    if (!heading.test(markdown)) {
      missing.push(section);
    }
  }
  return missing;
}

function findEmptySections(markdown) {
  const empty = [];
  for (const section of REQUIRED_SECTIONS) {
    const body = extractSectionBody(markdown, section);
    const normalized = body.replace(/[`*_~>#\-\s]/g, '').toLowerCase();
    if (!normalized || ['todo', 'tbd', 'n/a', 'na', 'placeholder'].includes(normalized)) {
      const heading = new RegExp(`^##?\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
      if (heading.test(markdown)) {
        empty.push(section);
      }
    }
  }
  return empty;
}

function scanSecrets(markdown) {
  const matches = [];
  for (const pattern of SECRET_PATTERNS) {
    const result = markdown.match(pattern);
    if (result) {
      matches.push(result[0]);
    }
  }
  return matches;
}

function getSkillFiles(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return [];

  const targetStat = fs.statSync(targetPath);
  if (targetStat.isFile()) {
    return path.basename(targetPath) === 'SKILL.md' ? [targetPath] : [];
  }

  if (!targetStat.isDirectory()) return [];

  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(fullPath);
      }
    }
  }

  walk(targetPath);
  return files.sort();
}

function validateSkillFile(skillFile) {
  const relativePath = path.relative(process.cwd(), skillFile) || skillFile;
  const contents = readFileSafe(skillFile);
  if (!contents) {
    logError(`${relativePath} could not be read`);
    return false;
  }

  const frontmatter = parseFrontmatter(contents);
  let ok = true;

  if (!frontmatter) {
    logError(`${relativePath} is missing YAML frontmatter`);
    ok = false;
  } else if (frontmatter.__invalid) {
    logError(`${relativePath} has invalid YAML frontmatter`);
    ok = false;
  } else {
    if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
      logError(`${relativePath} is missing a name field`);
      ok = false;
    }
    if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
      logError(`${relativePath} is missing a description field`);
      ok = false;
    }

    const dirName = path.basename(path.dirname(skillFile));
    if (frontmatter.name && frontmatter.name !== dirName) {
      logError(`${relativePath} has name "${frontmatter.name}" but directory is "${dirName}"`);
      ok = false;
    }
  }

  const missingSections = findMissingSections(contents);
  if (missingSections.length > 0) {
    const missingText = missingSections.join(', ');
    logError(`${relativePath} is missing required sections: ${missingText}`);
    ok = false;
  }

  if (STRICT) {
    const emptySections = findEmptySections(contents);
    if (emptySections.length > 0) {
      const emptyText = emptySections.join(', ');
      logError(`${relativePath} has empty or placeholder-only required sections: ${emptyText}`);
      ok = false;
    }
  }

  const badSecrets = scanSecrets(contents);
  if (badSecrets.length > 0) {
    logError(`${relativePath} contains ${badSecrets.length} secret-like pattern(s)`);
    ok = false;
  }

  const trimmed = contents.trim();
  if (trimmed.length < 200) {
    const message = `${relativePath} is very short and may not provide enough guidance`;
    if (STRICT) {
      logError(message);
    } else {
      logWarning(message);
    }
    ok = ok && !STRICT;
  }

  return ok;
}

function main() {
  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const explicitTarget = cliArgs[0] || process.env.ECC_SKILLS_DIR || 'skills';
  const targetPath = path.resolve(process.cwd(), explicitTarget);

  if (!fs.existsSync(targetPath)) {
    logError(`Target does not exist: ${targetPath}`);
    process.exit(1);
  }

  const files = getSkillFiles(targetPath);

  if (fs.statSync(targetPath).isFile()) {
    if (path.basename(targetPath) !== 'SKILL.md') {
      logError(`Unsupported target file: ${targetPath}. Provide a SKILL.md file.`);
      process.exit(1);
    }
  }

  if (files.length === 0) {
    logInfo(`No skill files found under ${targetPath}`);
    process.exit(0);
  }

  let hasErrors = false;
  for (const file of files) {
    const isValid = validateSkillFile(file);
    if (!isValid) hasErrors = true;
  }

  if (hasErrors) {
    process.exit(1);
  }

  logInfo(`Validated ${files.length} skill file(s) successfully.`);
}

main();
