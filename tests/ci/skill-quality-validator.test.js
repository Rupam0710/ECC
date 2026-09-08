/**
 * Tests for the skill quality validator.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-skill-quality.js');

function runValidator(files, extraArgs = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-quality-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const filePath = path.join(tempDir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents, 'utf8');
    }

    const result = spawnSync('node', [SCRIPT_PATH, ...extraArgs], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_SKILLS_DIR: tempDir,
      },
    });

    return {
      status: result.status ?? 1,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function run() {
  console.log('\n=== Testing skill quality validation ===\n');

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

  check('accepts a valid skill', () => {
    const result = runValidator({
      'skills/good-skill/SKILL.md': `---
name: good-skill
description: Useful workflow for validating a good skill.
---
# Good Skill

## When to Activate
Use when you need a good example.

## Core Concepts
Keep it practical.

## Examples
\`\`\`bash
node scripts/validate-skill-quality.js
\`\`\`

## Anti-Patterns
Avoid generic advice.

## Best Practices
- Keep it concrete.
`,
    });
    assert.strictEqual(result.status, 0, `${result.stderr || result.stdout}`);
  });

  check('reports missing activation section', () => {
    const result = runValidator({
      'skills/weak-skill/SKILL.md': `---
name: weak-skill
description: A weak skill.
---
# Weak Skill

## Core Concepts
No activation section.

## Examples
Example only.
`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr || result.stdout, /When to Activate/i);
  });

  check('rejects hardcoded secrets in examples', () => {
    const result = runValidator({
      'skills/secret-skill/SKILL.md': `---
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
export API_KEY=sk_live_1234567890
\`\`\`

## Anti-Patterns
Avoid leaked variables.

## Best Practices
- Avoid secrets.
`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr || result.stdout, /secret|token|API_KEY/i);
  });

  check('supports --strict mode for missing anti-patterns', () => {
    const result = runValidator({
      'skills/no-anti-patterns/SKILL.md': `---
name: no-anti-patterns
description: A basic skill.
---
# No Anti-Patterns

## When to Activate
Use when the task is simple.

## Core Concepts
Keep it simple.

## Examples
\`\`\`bash
echo hello
\`\`\`

## Best Practices
- Keep it simple.
`,
    }, ['--strict']);
    assert.notStrictEqual(result.status, 0, 'Expected strict mode to fail');
    assert.match(result.stderr || result.stdout, /Anti-Patterns/i);
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
