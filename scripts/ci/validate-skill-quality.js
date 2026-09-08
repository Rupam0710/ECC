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

const DEFAULT_SKILLS_DIR = path.join(__dirname, '../../skills');
const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT_SKILLS === '1';

const REQUIRED_SECTIONS = [
  'When to Activate',
  'Core Concepts',
  'Examples',
  'Anti-Patterns',
  'Best Practices',
];

const SECRET_PATTERNS = [
  /(?:api[_-]?key|token|secret|passwd|password|access[_-]?key)[\s:=\"']+[A-Za-z0-9_\-]{8,}/i,
  /sk_(?:live|test)_[A-Za-z0-9]+/i,
  /ghp_[A-Za-z0-9]{20,}/i,
  /xox[baprs]-[A-Za-z0-9-]+/i,
];

function logError(message) {
  console.error(`ERROR: ${message}`);
}

function logWarning(message) {
  console.warn(`WARN: ${message}`);
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function parseFrontmatter(content) {
  const cleaned = content.replace(/^\uFEFF/, '');
  const match = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  const body = match[1];
  const result = {};
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }

  return result;
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

function getSkillFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

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

  walk(rootDir);
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
  } else {
    if (!frontmatter.name) {
      logError(`${relativePath} is missing a name field`);
      ok = false;
    }
    if (!frontmatter.description) {
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

  const badSecrets = scanSecrets(contents);
  if (badSecrets.length > 0) {
    logError(`${relativePath} contains secret-like patterns: ${badSecrets.slice(0, 3).join(', ')}`);
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
  const skillsDir = process.env.ECC_SKILLS_DIR || DEFAULT_SKILLS_DIR;
  const files = getSkillFiles(skillsDir);

  if (files.length === 0) {
    console.log(`No skill files found under ${skillsDir}`);
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

  console.log(`Validated ${files.length} skill file(s) successfully.`);
}

main();
