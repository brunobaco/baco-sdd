import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as g from '../skills/baco-sdd/scripts/lib/git.mjs';
import { makeRepo as makeRepoRaw } from './helpers/tmprepo.mjs';

// macOS: /usr/bin/git is an xcrun shim that exits 72 inside a sandbox. The tests use fake
// binaries: a shim on a temp PATH, and fallbacks that count their calls and run the real git.
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const sandbox = mkdtempSync(join(tmpdir(), 'baco-fakegit-'));
// The sandbox and every temp repo made here are removed when the file ends.
const temps = [sandbox];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const makeRepo = async (files) => { const d = await makeRepoRaw(files); temps.push(d); return d; };

function script(name, body) {
  const file = join(sandbox, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
const counter = (name) => join(sandbox, `${name}.count`);
const calls = (name) => (existsSync(counter(name)) ? readFileSync(counter(name), 'utf8').split('\n').filter(Boolean).length : 0);
// A working binary that counts its calls.
const working = (name) => script(name, `echo x >> '${counter(name)}'\nexec '${REAL_GIT}' "$@"`);

const saved = { PATH: process.env.PATH, BACO_GIT: process.env.BACO_GIT, fallbacks: [...g.gitBinaries.fallbacks] };

// Puts a failing shim first in PATH, counting its calls.
function shimOnPath(body = 'echo "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools)" >&2\nexit 72') {
  const dir = mkdtempSync(join(sandbox, 'bin-'));
  writeFileSync(join(dir, 'git'), `#!/bin/sh\necho x >> '${counter('shim')}'\n${body}\n`);
  chmodSync(join(dir, 'git'), 0o755);
  process.env.PATH = `${dir}:${saved.PATH}`;
}

beforeEach(() => {
  g.resetGitBinary();
  delete process.env.BACO_GIT;
  rmSync(counter('shim'), { force: true });
  g.gitBinaries.fallbacks = [];
});
afterEach(() => {
  process.env.PATH = saved.PATH;
  if (saved.BACO_GIT === undefined) delete process.env.BACO_GIT; else process.env.BACO_GIT = saved.BACO_GIT;
  g.gitBinaries.fallbacks = [...saved.fallbacks];
  g.resetGitBinary();
});

test('shim failing with exit 72: retries with the first existing fallback and remembers it', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g.gitBinaries.fallbacks = ['/nonexistent/git', working('fb1')];
  shimOnPath();
  assert.equal(g.currentBranch(dir), 'main');
  assert.equal(calls('shim'), 1);
  assert.equal(calls('fb1'), 1);
  assert.ok(g.repoRoot(dir));
  assert.equal(calls('shim'), 1, 'the shim is not tried again');
  assert.equal(calls('fb1'), 2);
});

test('stderr "xcrun: error" is enough, whatever the exit code', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g.gitBinaries.fallbacks = [working('fb2')];
  shimOnPath('echo "xcrun: error: cannot run" >&2\nexit 1');
  assert.equal(g.currentBranch(dir), 'main');
  assert.equal(calls('fb2'), 1);
});

test('an ordinary failure is not retried', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g.gitBinaries.fallbacks = [working('fb3')];
  shimOnPath('echo "fatal: bad revision" >&2\nexit 128');
  assert.throws(() => g.revParse('nope', dir), (e) => e instanceof g.GitError && !(e instanceof g.GitUnavailableError));
  assert.equal(calls('fb3'), 0);
});

test('BACO_GIT is used first when set', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  process.env.BACO_GIT = working('chosen');
  shimOnPath();
  assert.equal(g.currentBranch(dir), 'main');
  assert.equal(calls('chosen'), 1);
  assert.equal(calls('shim'), 0);
});

test('BACO_GIT pointing to nothing is skipped', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  process.env.BACO_GIT = '/nonexistent/git';
  assert.equal(g.currentBranch(dir), 'main');
});

test('diffQuiet and isAncestor also use the fallback', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g.gitBinaries.fallbacks = [working('fb4')];
  shimOnPath();
  assert.equal(g.diffQuiet('HEAD', 'HEAD', ['a.md'], dir), true);
  assert.equal(g.isAncestor('HEAD', 'HEAD', dir), true);
  assert.equal(calls('shim'), 1);
});

test('no working binary: GitUnavailableError carrying the shim message', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g.gitBinaries.fallbacks = [script('fb5', 'echo "xcrun: error: still broken" >&2\nexit 72')];
  shimOnPath();
  assert.throws(() => g.currentBranch(dir), (e) => e instanceof g.GitUnavailableError && /xcrun: error/.test(e.message));
  assert.throws(() => g.repoRoot(dir), g.GitUnavailableError);
});

test('tool not installed at all: repoRoot throws GitUnavailableError, but a missing folder is just null', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  process.env.PATH = mkdtempSync(join(sandbox, 'empty-'));
  assert.throws(() => g.repoRoot(dir), g.GitUnavailableError);
  assert.equal(g.repoRoot(join(dir, 'does-not-exist')), null);
});
