import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { resetGitBinary, gitBinaries } from '../skills/baco-sdd/scripts/lib/git.mjs';
import { messages, t } from '../skills/baco-sdd/scripts/lib/messages.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

// plan-freshness and guard-tests when the version control tool does not answer, or the folder is
// not a repo: always exit 65 with a localized message, never 0 and never a stack trace.
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const sandbox = makeTempDirSync('baco-nogit-');
const saved = { PATH: process.env.PATH, BACO_GIT: process.env.BACO_GIT, ceiling: process.env.GIT_CEILING_DIRECTORIES, fallbacks: [...gitBinaries.fallbacks] };

beforeEach(() => { resetGitBinary(); delete process.env.BACO_GIT; gitBinaries.fallbacks = []; });
afterEach(() => {
  process.env.PATH = saved.PATH;
  if (saved.BACO_GIT === undefined) delete process.env.BACO_GIT; else process.env.BACO_GIT = saved.BACO_GIT;
  if (saved.ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = saved.ceiling;
  gitBinaries.fallbacks = saved.fallbacks;
  resetGitBinary();
});

// Puts a fake binary named `git` first in PATH.
function fakeOnPath(body) {
  const dir = makeTempDirSync('bin-', null, sandbox);
  writeFileSync(join(dir, 'git'), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, 'git'), 0o755);
  process.env.PATH = `${dir}:${saved.PATH}`;
}
const noGitAtAll = () => { process.env.PATH = makeTempDirSync('empty-', null, sandbox); };

const PLAN = '# Plano\n\n**Specs:** docs/specs/spec-x.md@1.0\n**Base:** main\n';
const files = { 'docs/entregas/ENT-001-a/plano.md': PLAN, 'docs/specs/spec-x.md': '# Spec\n' };
const COMMANDS = [
  ['plan-freshness', (dir) => ['plan-freshness', 'ENT-001', '--cwd', dir]],
  ['guard-tests', (dir) => ['guard-tests', '--base', 'HEAD', '--cwd', dir]],
];
const SHIM = 'echo "xcrun: error: invalid active developer path" >&2\nexit 72';

for (const [name, argv] of COMMANDS) {
  test(`${name}: git not installed exits 65 with "did not respond", no stack trace`, async () => {
    const dir = await makeRepo(files);
    noGitAtAll();
    const c = capture();
    assert.equal(await main(argv(dir), c.io), 65);
    assert.ok(c.out.stderr.includes('não respondeu'), c.out.stderr);
    assert.ok(c.out.stderr.includes('BACO_GIT'));
    assert.doesNotMatch(c.out.stderr, /\n\s+at |Error:/);
    assert.equal(c.out.stdout, '');
  });

  test(`${name}: xcrun shim with no working fallback exits 65 with "did not respond"`, async () => {
    const dir = await makeRepo(files);
    fakeOnPath(SHIM);
    const c = capture();
    assert.equal(await main(argv(dir), c.io), 65);
    assert.ok(c.out.stderr.includes('não respondeu'), c.out.stderr);
    assert.ok(c.out.stderr.includes('xcrun: error'));
    assert.doesNotMatch(c.out.stderr, /\n\s+at /);
  });

  test(`${name}: --json adds error.key env.git_unavailable and still exits 65`, async () => {
    const dir = await makeRepo(files);
    noGitAtAll();
    const c = capture();
    assert.equal(await main([...argv(dir), '--json'], c.io), 65);
    assert.equal(JSON.parse(c.out.stdout).error.key, 'env.git_unavailable');
  });

  test(`${name}: a folder that is not a repo exits 65 with the not-a-repo message`, async () => {
    const dir = realpathSync(makeTempDirSync('baco-norepo-'));
    process.env.GIT_CEILING_DIRECTORIES = dirname(dir);
    const c = capture();
    assert.equal(await main(argv(dir), c.io), 65);
    assert.ok(c.out.stderr.includes(t('pt-BR', 'env.not_git_repo')), c.out.stderr);
    assert.ok(!c.out.stderr.includes('não respondeu'));
  });
}

test('guard-tests: git that answers repoRoot but dies afterwards is still "did not respond", not "bad revision"', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  commit(dir, { 'b.md': 'y' }, 'second');
  fakeOnPath(`case "$*" in *show-toplevel*) exec '${REAL_GIT}' "$@";; esac\n${SHIM}`);
  const c = capture();
  assert.equal(await main(['guard-tests', '--base', 'HEAD~1', '--cwd', dir], c.io), 65);
  assert.ok(c.out.stderr.includes('não respondeu'), c.out.stderr);
});

test('the message exists in pt-BR and en, and says version control did not respond', () => {
  assert.ok(messages['pt-BR']['env.git_unavailable'].includes('não respondeu'));
  assert.ok(messages.en['env.git_unavailable'].includes('did not respond'));
  assert.ok(t('en', 'env.git_unavailable', { message: 'boom' }).includes('boom'));
});
