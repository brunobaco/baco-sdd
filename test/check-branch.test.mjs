import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { t } from '../skills/baco-sdd/scripts/lib/messages.mjs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

test('check-branch on main exits 1 with protected data (json on stdout)', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  const { io, out } = capture();
  assert.equal(await main(['check-branch', '--json', '--cwd', dir], io), 1);
  assert.deepEqual(JSON.parse(out.stdout), { branch: 'main', protected: true });
});

test('check-branch on a delivery branch exits 0', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  execFileSync('git', ['checkout', '-q', '-b', 'baco/ENT-001'], { cwd: dir });
  const { io, out } = capture();
  assert.equal(await main(['check-branch', '--cwd', dir], io), 0);
  assert.ok(out.stdout.includes('baco/ENT-001'));
});

test('check-branch resolves the root from a subdirectory', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  mkdirSync(join(dir, 'deep/er'), { recursive: true });
  const { io } = capture();
  assert.equal(await main(['check-branch', '--json', '--cwd', join(dir, 'deep/er')], io), 1);
});

test('outside a git repo exits 65 with a localized stderr message (existing dir, ceiling set)', async () => {
  // M1: an EXISTING directory outside any repo; GIT_CEILING_DIRECTORIES stops git from walking up
  // into a repo that may contain the temp dir.
  const dir = realpathSync(makeTempDirSync('baco-norepo-'));
  const prev = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = dirname(dir);
  try {
    const { io, out } = capture();
    assert.equal(await main(['check-branch', '--cwd', dir], io), 65);
    assert.ok(out.stderr.includes(t('pt-BR', 'env.not_git_repo')));
    assert.equal(out.stdout, '');
  } finally {
    if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prev;
  }
});

test('config error exits 65 with line', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'branches: [unclosed\n' });
  const { io, out } = capture();
  assert.equal(await main(['check-branch', '--cwd', dir], io), 65);
  assert.ok(out.stderr.length > 0);
});

test('I4: check-branch always protects branches.main and branches.integration', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'branches:\n  main: trunk\n  integration: dev\n  protected: []\n' });
  for (const b of ['trunk', 'dev']) {
    execFileSync('git', ['checkout', '-q', '-b', b], { cwd: dir });
    const { io, out } = capture();
    assert.equal(await main(['check-branch', '--json', '--cwd', dir], io), 1, b);
    assert.deepEqual(JSON.parse(out.stdout), { branch: b, protected: true });
  }
});
