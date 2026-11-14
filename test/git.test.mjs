import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as g from '../skills/baco-sdd/scripts/lib/git.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

test('showFile returns null for a missing path', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  assert.equal(g.showFile('HEAD', 'missing.md', dir), null);
  assert.equal(g.showFile('HEAD', 'a.md', dir), 'x');
});

test('diffNames reports modifications, adds, deletes and renames', async () => {
  const dir = await makeRepo({ 'a.md': 'one\n', 'b.md': 'bbb\nbbb\nbbb\n', 'c.md': 'ccc\nccc\nccc\n' });
  const sha1 = g.revParse('HEAD', dir);
  const sha2 = commit(dir, { 'a.md': 'two\n' }, 'm');
  assert.deepEqual(g.diffNames(sha1, sha2, dir), [{ status: 'M', path: 'a.md' }]);
  const sha3 = commit(dir, { 'n.md': 'new', 'b.md': null }, 'ad');
  assert.deepEqual(g.diffNames(sha2, sha3, dir), [{ status: 'D', path: 'b.md' }, { status: 'A', path: 'n.md' }]);
  execFileSync('git', ['mv', 'c.md', 'd.md'], { cwd: dir });
  const sha4 = commit(dir, {}, 'mv');
  assert.deepEqual(g.diffNames(sha3, sha4, dir), [{ status: 'R', path: 'd.md', oldPath: 'c.md' }]);
});

test('repoRoot, currentBranch, branches, ancestry, patch, worktrees', async () => {
  const dir = await makeRepo({ 'a.md': 'one\n' });
  mkdirSync(join(dir, 'sub'));
  assert.ok(g.repoRoot(join(dir, 'sub')).endsWith(dir.split('/').pop()));
  assert.equal(g.repoRoot(join(dir, 'nope')), null);
  const sha1 = g.revParse('HEAD', dir);
  execFileSync('git', ['checkout', '-q', '-b', 'baco/ENT-001'], { cwd: dir });
  assert.equal(g.currentBranch(dir), 'baco/ENT-001');
  const sha2 = commit(dir, { 'a.md': 'two\n' }, 'm');
  assert.deepEqual(g.localBranches(dir).sort(), ['baco/ENT-001', 'main']);
  assert.equal(g.isAncestor(sha1, sha2, dir), true);
  assert.equal(g.isAncestor(sha2, sha1, dir), false);
  assert.match(g.diffPatch(sha1, sha2, ['a.md'], dir), /\+two/);
  const wts = g.worktrees(dir);
  assert.equal(wts.length, 1);
  assert.equal(wts[0].branch, 'baco/ENT-001');
  assert.throws(() => g.git(['bogus-cmd'], dir), g.GitError);
});

test('showFile throws GitError on an invalid ref; refExists reports validity', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  assert.throws(() => g.showFile('nonexistent-ref', 'a.md', dir), g.GitError);
  assert.equal(g.showFile('HEAD', 'missing.md', dir), null);
  assert.equal(g.refExists('HEAD', dir), true);
  assert.equal(g.refExists('nonexistent-ref', dir), false);
});

test('diffPatch ignores user color/ext-diff/textconv config', async () => {
  const dir = await makeRepo({ 'a.md': 'one\n' });
  execFileSync('git', ['config', 'color.ui', 'always'], { cwd: dir });
  execFileSync('git', ['config', 'diff.noprefix', 'true'], { cwd: dir });
  const sha1 = g.revParse('HEAD', dir);
  const sha2 = commit(dir, { 'a.md': 'two\n' }, 'm');
  const patch = g.diffPatch(sha1, sha2, ['a.md'], dir);
  assert.ok(!patch.includes('\u001b'));
  assert.match(patch, /^diff --git a\/a\.md b\/a\.md$/m);
  assert.match(patch, /^\+two$/m);
});
