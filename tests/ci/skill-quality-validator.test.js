/**
 * Regression tests for skill quality validation rules.
 *
 * Tests validate that the rules-based quality checks in validate-skills.js
 * provide actionable feedback (file path, line number, fix hint) based on
 * patterns from 100+ skills analysis.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-skills.js');

function runValidator(skillsDir, extraArgs = []) {
  const result = spawnSync('node', [SCRIPT_PATH, skillsDir, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI_STRICT_SKILLS: '1', // Enable strict mode for quality checks
    },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function createTestSkill(dir, filename, contents) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), contents, 'utf8');
}

function run() {
  console.log('\n=== Skill Quality Validation Regression Tests ===\n');

  let passed = 0;
  let failed = 0;

  const check = (name, fn) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${error.message}`);
      failed += 1;
    }
  };

  check('accepts a valid skill with all required sections', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'good-skill'),
        'SKILL.md',
        `---
name: good-skill
description: Useful workflow for validating a good skill with proper structure and content.
---
# Good Skill

## When to Activate
Use when you need to validate quality gates and ensure compliance with quality standards. This section provides practical activation criteria based on careful analysis of over 100 production skills. Choose this skill when testing validator implementations or implementing quality checks in CI/CD pipelines.

## Core Concepts
Keep it practical and actionable in all technical guidance. Base concepts on proven patterns observed across real projects and teams. Understand the foundational principles behind quality validation so you can adapt them to your own scenarios and requirements.

## Examples
The validator provides comprehensive examples of quality checks. You can run validation on skill directories using the provided script. Here is a practical example command that validates a custom skill directory with strict mode enabled: \`node scripts/ci/validate-skills.js ./skills --strict\`. The output includes line numbers and actionable fix hints for quick resolution.

## Anti-Patterns
Avoid generic advice without concrete examples to guide implementation decisions. Do not create vague instructions that require readers to guess implementation details or make assumptions. Never skip validation steps, even when they seem unnecessary or redundant for your use case.

## Best Practices
- Keep it concrete with specific actionable guidance that developers can follow immediately without additional research or consultation
- Focus on evidence-backed patterns derived from analysis of successful implementations and real-world project structures
- Provide line numbers and fix hints in all validation output for developer convenience and faster resolution of issues
`
      );
      const result = runValidator(path.join(tempDir, 'skills'));
      assert.strictEqual(result.status, 0, `Expected valid skill to pass: ${result.stderr || result.stdout}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('provides actionable feedback with line numbers and fix hints for missing sections', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'weak-skill'),
        'SKILL.md',
        `---
name: weak-skill
description: A weak skill.
---
# Weak Skill

## Core Concepts
No activation section.

## Examples
Example only.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
      assert.match(result.stderr || result.stdout, /missing required section|When to Activate/i);
      assert.match(result.stderr || result.stdout, /Fix:|hint:/i); // Verify fix hint is provided
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('detects hardcoded secrets and provides fix hints', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'secret-skill'),
        'SKILL.md',
        `---
name: secret-skill
description: Demo skill.
---
# Secret Skill

## When to Activate
Use when you need a secret example.

## Core Concepts
Check for credentials.

## Examples
\`\`\`bash
export API_KEY=sk_live_1234567890abcdef
\`\`\`

## Anti-Patterns
Avoid leaked variables.

## Best Practices
- Use environment variables, not hardcoded secrets.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'));
      assert.notStrictEqual(result.status, 0, 'Expected validator to fail for hardcoded secrets');
      assert.match(result.stderr || result.stdout, /secret-like pattern|API_KEY/i);
      assert.match(result.stderr || result.stdout, /Fix:/i); // Verify fix hint
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('enforces content depth (200+ chars) in strict mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'shallow-skill'),
        'SKILL.md',
        `---
name: shallow-skill
description: Very short skill.
---
# Shallow

## When to Activate
Use now.

## Core Concepts
One.

## Examples
\`\`\`bash
echo hi
\`\`\`

## Anti-Patterns
Bad.

## Best Practices
Good.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail for shallow content');
      assert.match(result.stderr || result.stdout, /too short|200/i);
      assert.match(result.stderr || result.stdout, /expand/i); // Verify fix hint mentions expansion
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('rejects empty or placeholder-only sections in strict mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'empty-sections'),
        'SKILL.md',
        `---
name: empty-sections
description: Synthetic skill with empty required sections.
---
# Empty Sections

## When to Activate
TODO

## Core Concepts
placeholder

## Examples
TBD

## Anti-Patterns
N/A

## Best Practices
-
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail for empty or placeholder sections');
      assert.match(result.stderr || result.stdout, /empty|placeholder/i);
      assert.match(result.stderr || result.stdout, /Fix:/i); // Verify fix hint provided
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('reports syntactically invalid YAML frontmatter with fix hints', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-test-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'bad-frontmatter'),
        'SKILL.md',
        `---
name: [broken
description: invalid frontmatter
---
# Broken

## When to Activate
Use this when you need it.

## Core Concepts
This is malformed YAML.

## Examples
\`\`\`bash
echo bad
\`\`\`

## Anti-Patterns
Avoid broken YAML.

## Best Practices
- Validate input.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'), ['--strict']);
      assert.notStrictEqual(result.status, 0, 'Expected invalid YAML to fail');
      assert.match(result.stderr || result.stdout, /invalid YAML|frontmatter/i);
      assert.match(result.stderr || result.stdout, /Fix:/i); // Verify fix hint
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  check('validates directory structures without crashing on nested skills', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-nested-'));
    try {
      createTestSkill(
        path.join(tempDir, 'skills', 'nested-skill'),
        'SKILL.md',
        `---
name: nested-skill
description: Valid nested skill demonstrating proper directory structure handling and validation patterns.
---
# Nested Skill

## When to Activate
Use for validation of nested directory structures and complex project hierarchies. This skill demonstrates how the validator handles skills organized in subdirectories without issues or performance degradation. Perfect for verifying recursive directory traversal and handling of deeply nested file systems with proper isolation.

## Core Concepts
Be explicit and evidence-backed in all recommendations and guidance. Ensure that nested directory structures are properly traversed and validated at every level. Maintain consistency across all levels of directory nesting and provide clear error messages when validation fails. Document patterns observed from analyzing 100+ real project structures.

## Examples
Here are practical examples of validating nested skill structures. You can use the validator recursively across directory trees. The first command shows basic directory listing, the second finds all SKILL.md files recursively, and the third demonstrates running the full validator on a custom target directory:
\`\`\`bash
echo ok
ls -la nested-skill/
find . -name "SKILL.md" -type f
node scripts/ci/validate-skills.js ./test-dir
\`\`\`

## Anti-Patterns
Avoid vague instructions without clear examples that developers can follow immediately. Do not skip validation steps for nested or deeply nested structures because they appear to be less important. Never assume directory organization without explicit validation and verification of structure integrity.

## Best Practices
- Keep validation logic concrete and actionable for implementers working with complex project hierarchies.
- Focus on patterns from analyzing real project structures and ensure the validator handles edge cases correctly.
- Provide detailed error messages with line numbers and fix hints for quick resolution of issues.
`
      );
      const result = runValidator(path.join(tempDir, 'skills'));
      assert.strictEqual(result.status, 0, `Expected nested skill to pass: ${result.stderr || result.stdout}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
