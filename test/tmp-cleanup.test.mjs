import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDirSync } from './helpers/tmpdir.mjs';

const TEST_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));

// Fixed folders intentionally kept across runs in the OS temp dir.
const ALLOWED_FIXED = (name) => name === 'baco-queue' || name === 'baco-npm-cache' || name.startsWith('baco-context-size-');

test('every test file that calls mkdtemp cleans it up or uses helpers/tmpdir.mjs', () => {
  const offenders = [];
  for (const file of readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.mjs')).sort()) {
    const src = readFileSync(join(TEST_DIR, file), 'utf8');
    if (!/\bmkdtemp(?:Sync)?\b/.test(src)) continue;
    const cleans = /\brmSync\b|\brm\(/.test(src) || /helpers\/tmpdir\.mjs/.test(src);
    if (!cleans) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `test files creating temp dirs without cleanup: ${offenders.join(', ')}`);
});

test('helpers/tmpdir removes temporary folders even when a process exits with an error', (t) => {
  const isolated = makeTempDirSync('baco-errcheck-', t);
  const helperPath = join(TEST_DIR, 'helpers', 'tmpdir.mjs');
  const r = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { makeTempDirSync } from ${JSON.stringify(helperPath)};
     const d = makeTempDirSync('baco-boom-');
     console.log(d);
     process.exit(1);`,
  ], { env: { ...process.env, TMPDIR: isolated }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  const created = r.stdout.trim();
  assert.ok(created.startsWith(isolated), `expected temp dir inside ${isolated}, got ${created}`);
  assert.equal(existsSync(created), false, 'temp dir must be deleted on error exit');
});

test('representative test files leave zero new baco-* folders in an isolated TMPDIR', (t) => {
  const isolated = makeTempDirSync('baco-suite-tmp-', t);
  const sample = [
    'test/config.test.mjs',
    'test/markdown.test.mjs',
    'test/qa.test.mjs',
    'test/spec.test.mjs',
    'test/validate-spec.test.mjs',
    'test/plan-freshness.test.mjs',
  ].map((f) => join(TEST_DIR, '..', f));
  const r = spawnSync(process.execPath, ['--test', ...sample], {
    env: { ...process.env, TMPDIR: isolated },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const leftover = readdirSync(isolated).filter((n) => n.startsWith('baco-') && !ALLOWED_FIXED(n));
  assert.deepEqual(leftover, [], `leftover baco-* temp dirs: ${leftover.join(', ')}`);
  rmSync(isolated, { recursive: true, force: true });
});
