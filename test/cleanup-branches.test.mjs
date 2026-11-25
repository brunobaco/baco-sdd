import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { planCleanup } from '../skills/baco-sdd/scripts/commands/cleanup-branches.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

const g = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const run = async (args) => {
  const out = { stdout: '', stderr: '' };
  const code = await main(args, { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } });
  return { code, out };
};
const branchesOf = (dir) => g(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');

const base = { protectedList: ['main', 'develop'], integration: 'develop', current: 'develop' };
const merged = (set) => (b, t) => set.has(`${b}>${t}`);

test('planCleanup: merged task is a candidate, unmerged is not', () => {
  const r = planCleanup({ ...base, branches: ['main', 'develop', 'baco/ENT-001', 'baco/ENT-001-T01', 'baco/ENT-001-T02'], worktrees: [{ path: '/r', branch: 'develop' }],
    isMergedInto: merged(new Set(['baco/ENT-001-T01>baco/ENT-001'])) });
  assert.deepEqual(r.map((c) => c.branch), ['baco/ENT-001-T01']);
  assert.equal(r[0].reason, 'task_merged');
  assert.equal(r[0].target, 'baco/ENT-001');
});

test('planCleanup: main, current and non-baco branches are never candidates', () => {
  const r = planCleanup({ ...base, current: 'baco/ENT-002', branches: ['main', 'develop', 'feature/x', 'baco/ENT-002'], worktrees: [], isMergedInto: () => true });
  assert.deepEqual(r, []);
});

test('planCleanup: delivery needs integration; task falls back only to delivery', () => {
  const noInt = planCleanup({ ...base, integration: null, branches: ['main', 'baco/ENT-001', 'baco/ENT-001-T01'], worktrees: [], isMergedInto: () => true });
  assert.deepEqual(noInt.map((c) => c.branch), ['baco/ENT-001-T01']);
  const noDelivery = planCleanup({ ...base, branches: ['main', 'develop', 'baco/ENT-001-T01'], worktrees: [], isMergedInto: () => true });
  assert.equal(noDelivery[0].target, 'develop');
});

test('planCleanup: normalizes refs/heads names and skips branch checked out in the main worktree', () => {
  const r = planCleanup({ ...base, current: 'develop', branches: ['develop', 'baco/ENT-001-T01', 'baco/ENT-001-T02', 'baco/ENT-001'],
    worktrees: [{ path: '/r', branch: 'refs/heads/baco/ENT-001-T01' }, { path: '/w2', branch: 'refs/heads/baco/ENT-001-T02' }], isMergedInto: () => true });
  assert.deepEqual(r.map((c) => [c.branch, c.worktree]), [['baco/ENT-001-T02', '/w2'], ['baco/ENT-001', null]]);
});

test('planCleanup: promotion branch is removed once merged into main or integration, never before', () => {
  const input = { ...base, mainBranch: 'main', branches: ['main', 'develop', 'baco/ENT-001-PROMO'], worktrees: [] };
  assert.deepEqual(planCleanup({ ...input, isMergedInto: () => false }), []);
  const viaMain = planCleanup({ ...input, isMergedInto: merged(new Set(['baco/ENT-001-PROMO>main'])) });
  assert.deepEqual(viaMain.map((c) => [c.branch, c.reason, c.target]), [['baco/ENT-001-PROMO', 'promo_merged', 'main']]);
  const viaInt = planCleanup({ ...input, isMergedInto: merged(new Set(['baco/ENT-001-PROMO>develop'])) });
  assert.equal(viaInt[0].target, 'develop');
});

test('planCleanup: merged docs/* branches are removed; unmerged, current, and empty (same tip as target) are kept', () => {
  const input = { ...base, mainBranch: 'main', branches: ['main', 'develop', 'docs/spec-a', 'docs/spec-b', 'docs/spec-c'], worktrees: [],
    isMergedInto: (b) => b !== 'docs/spec-b', tipOf: (b) => (['docs/spec-c', 'develop', 'main'].includes(b) ? 'same' : `sha-${b}`) };
  const r = planCleanup(input);
  assert.deepEqual(r.map((c) => [c.branch, c.reason]), [['docs/spec-a', 'docs_merged']]);
  assert.deepEqual(planCleanup({ ...input, current: 'docs/spec-a' }), []);
});

test('planCleanup: promotion and docs branches are removed before the delivery branch', () => {
  const r = planCleanup({ ...base, mainBranch: 'main', branches: ['develop', 'baco/ENT-001', 'baco/ENT-001-PROMO', 'docs/x', 'baco/ENT-001-T01'], worktrees: [], isMergedInto: () => true });
  assert.equal(r[r.length - 1].branch, 'baco/ENT-001');
  assert.ok(r.some((c) => c.branch === 'baco/ENT-001-PROMO' && c.reason === 'promo_merged'));
});

test('planCleanup: configured main and integration branches are never candidates, even when named like docs/* or a promotion', () => {
  for (const [mainBranch, integration] of [['docs/live', 'develop'], ['main', 'docs/integra'], ['baco/ENT-001-PROMO', 'develop'], ['main', 'baco/ENT-002-PROMO']]) {
    const r = planCleanup({ protectedList: [], current: 'other', mainBranch, integration, branches: [mainBranch, integration, 'other', 'docs/x'], worktrees: [],
      isMergedInto: () => true, tipOf: (b) => `sha-${b}` });
    assert.deepEqual(r.map((c) => c.branch), ['docs/x'], `${mainBranch} / ${integration}`);
  }
});

test('applyCleanup: refuses a protected branch even when it is in the plan', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g(dir, 'branch', 'develop');
  g(dir, 'branch', 'docs/live');
  commit(dir, { 'b.md': 'b' }, 'ahead');
  g(dir, 'branch', '-f', 'develop', 'main');
  const sha = g(dir, 'rev-parse', 'docs/live');
  const res = applyCleanup([{ branch: 'docs/live', sha, worktree: null, reason: 'docs_merged', target: 'develop' }], { root: dir, protectedList: ['docs/live'] });
  assert.equal(res.failed[0].step, 'protected');
  assert.equal(res.done.length, 0);
  assert.ok(branchesOf(dir).includes('docs/live'));
});

test('cleanup-branches --apply keeps a custom main named docs/* that is behind integration', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'branches:\n  main: docs/live\n  integration: develop\n  protected: []\n' });
  g(dir, 'branch', 'docs/live');
  g(dir, 'checkout', '-q', '-b', 'develop');
  commit(dir, { 'b.md': 'b' }, 'ahead');
  g(dir, 'checkout', '-q', 'main');
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 0);
  assert.deepEqual(JSON.parse(res.out.stdout).candidates, []);
  assert.ok(branchesOf(dir).includes('docs/live'));
});

async function fixture() {
  const dir = await makeRepo({ 'a.md': 'x' });
  g(dir, 'branch', 'develop');
  g(dir, 'checkout', '-q', 'develop');
  g(dir, 'checkout', '-q', '-b', 'baco/ENT-001');
  g(dir, 'checkout', '-q', '-b', 'baco/ENT-001-T01');
  commit(dir, { 't1.md': '1' }, 't1');
  g(dir, 'checkout', '-q', 'baco/ENT-001');
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge t1', 'baco/ENT-001-T01');
  g(dir, 'checkout', '-q', '-b', 'baco/ENT-001-T02');
  commit(dir, { 't2.md': '2' }, 't2');
  g(dir, 'checkout', '-q', 'develop');
  const wt = join(makeTempDirSync('baco-wt-'), 'wt1');
  g(dir, 'worktree', 'add', '-q', wt, 'baco/ENT-001-T01');
  return { dir, wt };
}

async function deliveryFixture() {
  const dir = await makeRepo({ 'a.md': 'x' });
  g(dir, 'branch', 'develop');
  g(dir, 'checkout', '-q', 'develop');
  g(dir, 'checkout', '-q', '-b', 'baco/ENT-002');
  commit(dir, { 'd.md': 'd' }, 'delivery');
  g(dir, 'checkout', '-q', 'develop');
  return dir;
}

test('dry run lists only T01; --apply removes worktree and branch; T02 remains', async () => {
  const { dir, wt } = await fixture();
  const dry = await run(['cleanup-branches', '--json', '--cwd', dir]);
  assert.equal(dry.code, 0);
  assert.deepEqual(JSON.parse(dry.out.stdout).candidates.map((c) => c.branch), ['baco/ENT-001-T01']);
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 0);
  assert.equal(existsSync(wt), false);
  const bs = branchesOf(dir);
  assert.ok(!bs.includes('baco/ENT-001-T01'));
  assert.ok(bs.includes('baco/ENT-001-T02'));
  assert.ok(bs.includes('baco/ENT-001'));
});

test('after merging ENT-001 into develop, --apply deletes it and tags entrega/ENT-001', async () => {
  const { dir } = await fixture();
  await run(['cleanup-branches', '--apply', '--cwd', dir]);
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge ent', 'baco/ENT-001');
  const mergeCommit = g(dir, 'rev-parse', 'develop');
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 0);
  assert.ok(!branchesOf(dir).includes('baco/ENT-001'));
  // 0.1.1: the tag marks the merge into the integration branch, not the delivery tip.
  assert.equal(g(dir, 'rev-parse', 'entrega/ENT-001^{commit}'), mergeCommit);
});

test('unmerged delivery is kept; once merged into develop, --apply deletes it and tags entrega/ENT-002', async () => {
  const dir = await deliveryFixture();
  const first = await run(['cleanup-branches', '--apply', '--cwd', dir]);
  assert.equal(first.code, 0);
  assert.ok(branchesOf(dir).includes('baco/ENT-002'));
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge ent', 'baco/ENT-002');
  const mergeCommit = g(dir, 'rev-parse', 'develop');
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 0);
  assert.ok(!branchesOf(dir).includes('baco/ENT-002'));
  assert.equal(g(dir, 'rev-parse', 'entrega/ENT-002^{commit}'), mergeCommit);
});

// 0.1.1 (atrito 13): the delivery tag goes on the merge commit that brought the delivery tip in.
test('tag: the first merge on develop whose second parent has the delivery tip, not later commits or older merges', async () => {
  const dir = await deliveryFixture();
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge ent (first, older tip)', 'baco/ENT-002');
  g(dir, 'checkout', '-q', 'baco/ENT-002');
  commit(dir, { 'd2.md': 'd2' }, 'fix after first merge');
  g(dir, 'checkout', '-q', 'develop');
  commit(dir, { 'other.md': 'o' }, 'unrelated work on develop');
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge ent (second, final tip)', 'baco/ENT-002');
  const finalMerge = g(dir, 'rev-parse', 'develop');
  commit(dir, { 'later.md': 'l' }, 'later work on develop');
  const data = JSON.parse((await run(['cleanup-branches', '--apply', '--json', '--cwd', dir])).out.stdout);
  assert.deepEqual(data.warnings, []);
  assert.equal(g(dir, 'rev-parse', 'entrega/ENT-002^{commit}'), finalMerge);
  assert.equal(data.done[0].tag, 'entrega/ENT-002');
  assert.equal(data.done[0].tag_commit, finalMerge);
});

test('tag: a merge of a branch that contains the delivery tip counts (second parent has it as ancestor)', async () => {
  const dir = await deliveryFixture();
  g(dir, 'checkout', '-q', '-b', 'release', 'develop');
  g(dir, 'merge', '-q', '--no-ff', '-m', 'ent into release', 'baco/ENT-002');
  commit(dir, { 'r.md': 'r' }, 'release note');
  g(dir, 'checkout', '-q', 'develop');
  g(dir, 'merge', '-q', '--no-ff', '-m', 'release into develop', 'release');
  const merge = g(dir, 'rev-parse', 'develop');
  await run(['cleanup-branches', '--apply', '--cwd', dir]);
  assert.equal(g(dir, 'rev-parse', 'entrega/ENT-002^{commit}'), merge);
});

test('tag: with no merge commit (fast-forward), the tag falls back to the tip with a warning', async () => {
  const dir = await deliveryFixture();
  const tip = g(dir, 'rev-parse', 'baco/ENT-002');
  g(dir, 'merge', '-q', '--ff-only', 'baco/ENT-002');
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 0);
  const data = JSON.parse(res.out.stdout);
  assert.equal(g(dir, 'rev-parse', 'entrega/ENT-002^{commit}'), tip);
  assert.deepEqual(data.warnings.map((w) => w.key), ['cleanup.tag_at_tip']);
  const human = await deliveryFixture();
  g(human, 'merge', '-q', '--ff-only', 'baco/ENT-002');
  const h = await run(['cleanup-branches', '--apply', '--cwd', human]);
  assert.match(h.out.stdout + h.out.stderr, /entrega\/ENT-002[^\n]*ponta/);
});

test('existing tag elsewhere is not moved: warning, branch still deleted', async () => {
  const dir = await deliveryFixture();
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge ent', 'baco/ENT-002');
  const other = g(dir, 'rev-parse', 'main');
  g(dir, 'tag', 'entrega/ENT-002', other);
  const data = JSON.parse((await run(['cleanup-branches', '--apply', '--json', '--cwd', dir])).out.stdout);
  assert.equal(data.warnings.length, 1);
  assert.equal(g(dir, 'rev-parse', 'entrega/ENT-002^{commit}'), other);
  assert.ok(!branchesOf(dir).includes('baco/ENT-002'));
});

test('branch checked out in the main worktree is skipped as checked_out', async () => {
  const dir = await deliveryFixture();
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge ent', 'baco/ENT-002');
  g(dir, 'checkout', '-q', 'baco/ENT-002');
  g(dir, 'branch', '-f', 'develop', 'baco/ENT-002');
  const data = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', dir])).out.stdout);
  assert.equal(data.candidates.length, 0);
});

test('--remote deletes the remote branch on a local bare origin; failures go to data.failed', async () => {
  const { dir } = await fixture();
  const bare = makeTempDirSync('baco-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'push', '-q', 'origin', 'baco/ENT-001-T01');
  const ok = await run(['cleanup-branches', '--apply', '--remote', '--json', '--cwd', dir]);
  assert.equal(ok.code, 0);
  assert.equal(g(dir, 'ls-remote', '--heads', 'origin', 'baco/ENT-001-T01'), '');
  g(dir, 'checkout', '-q', 'baco/ENT-001-T02');
  commit(dir, { 'z': 'z' }, 'z');
  g(dir, 'checkout', '-q', 'baco/ENT-001');
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge t2', 'baco/ENT-001-T02');
  g(dir, 'checkout', '-q', 'develop');
  const bad = await run(['cleanup-branches', '--apply', '--remote', '--remote-name', 'nope', '--json', '--cwd', dir]);
  assert.equal(bad.code, 1);
  const data = JSON.parse(bad.out.stdout);
  assert.equal(data.failed[0].step, 'remote');
  assert.ok(!branchesOf(dir).includes('baco/ENT-001-T02'));
});

import { evaluateCleanup, applyCleanup } from '../skills/baco-sdd/scripts/commands/cleanup-branches.mjs';
import { localBranches, worktrees, isAncestor, revParse } from '../skills/baco-sdd/scripts/lib/git.mjs';

const planFor = (dir) => evaluateCleanup({
  branches: localBranches(dir), worktrees: worktrees(dir), current: g(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
  protectedList: ['main', 'develop'], integration: 'develop',
  isMergedInto: (b, t) => isAncestor(`refs/heads/${b}`, `refs/heads/${t}`, dir),
  tipOf: (b) => revParse(`refs/heads/${b}`, dir),
});

test('regression: branch advanced after planning is not deleted (changed_since_plan)', async () => {
  const { dir, wt } = await fixture();
  const { candidates } = planFor(dir);
  assert.equal(candidates.length, 1);
  g(wt, 'commit', '-q', '--allow-empty', '-m', 'late unmerged work');
  const res = applyCleanup(candidates, { root: dir });
  assert.equal(res.failed[0].step, 'changed_since_plan');
  assert.equal(res.done.length, 0);
  assert.ok(branchesOf(dir).includes('baco/ENT-001-T01'));
  assert.ok(existsSync(wt));
});

test('task branch merged then given a new commit is not a candidate', async () => {
  const { dir, wt } = await fixture();
  g(wt, 'commit', '-q', '--allow-empty', '-m', 'more');
  const dry = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', dir])).out.stdout);
  assert.deepEqual(dry.candidates, []);
});

test('dirty worktree: worktree and branch kept, failed step worktree, exit 1', async () => {
  const { dir, wt } = await fixture();
  writeFileSync(join(wt, 'dirty.txt'), 'x');
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 1);
  assert.equal(JSON.parse(res.out.stdout).failed[0].step, 'worktree');
  assert.ok(existsSync(wt));
  assert.ok(branchesOf(dir).includes('baco/ENT-001-T01'));
});

test('--apply never touches current, protected or non-baco branches', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  g(dir, 'branch', 'develop');
  g(dir, 'branch', 'feature/x');
  g(dir, 'checkout', '-q', '-b', 'baco/ENT-009');
  const res = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(res.code, 0);
  assert.deepEqual(branchesOf(dir).sort(), ['baco/ENT-009', 'develop', 'feature/x', 'main']);
});

test('remote failure is reported in failed only, not in done', async () => {
  const { dir } = await fixture();
  const res = await run(['cleanup-branches', '--apply', '--remote', '--remote-name', 'nope', '--json', '--cwd', dir]);
  const data = JSON.parse(res.out.stdout);
  assert.equal(data.failed[0].local_deleted, true);
  assert.equal(data.done.length, 0);
});

// C1: a remote branch that holds commits the local tip does not have must never be deleted.
async function remoteAheadFixture() {
  const { dir } = await fixture();
  const bare = makeTempDirSync('baco-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'push', '-q', 'origin', 'baco/ENT-001-T01');
  const other = join(makeTempDirSync('baco-clone-'), 'c');
  execFileSync('git', ['clone', '-q', '-b', 'baco/ENT-001-T01', bare, other]);
  g(other, 'config', 'user.name', 'Other');
  g(other, 'config', 'user.email', 'o@example.com');
  const pushed = commit(other, { 'late.md': 'late' }, 'unmerged work from another clone');
  g(other, 'push', '-q', 'origin', 'baco/ENT-001-T01');
  return { dir, bare, pushed };
}

test('C1: --apply --remote keeps a remote branch that is ahead (remote_ahead), exit 1', async () => {
  const { dir, bare, pushed } = await remoteAheadFixture();
  const res = await run(['cleanup-branches', '--apply', '--remote', '--json', '--cwd', dir]);
  assert.equal(res.code, 1);
  const data = JSON.parse(res.out.stdout);
  assert.equal(data.failed[0].branch, 'baco/ENT-001-T01');
  assert.equal(data.failed[0].step, 'remote_ahead');
  assert.equal(data.done.length, 0);
  assert.equal(g(bare, 'rev-parse', 'refs/heads/baco/ENT-001-T01'), pushed);
});

test('C1: dry run with --remote says when a remote deletion would happen', async () => {
  const { dir } = await fixture();
  const bare = makeTempDirSync('baco-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'push', '-q', 'origin', 'baco/ENT-001-T01');
  const json = JSON.parse((await run(['cleanup-branches', '--remote', '--json', '--cwd', dir])).out.stdout);
  assert.equal(json.candidates[0].remote_action, 'delete');
  const txt = await run(['cleanup-branches', '--remote', '--cwd', dir]);
  assert.match(txt.out.stdout, /origin/);
  assert.match(txt.out.stdout, /remot/i);
  assert.equal(g(dir, 'ls-remote', '--heads', 'origin', 'baco/ENT-001-T01') !== '', true);
  const ahead = await remoteAheadFixture();
  const d2 = JSON.parse((await run(['cleanup-branches', '--remote', '--json', '--cwd', ahead.dir])).out.stdout);
  assert.equal(d2.candidates[0].remote_action, 'keep_ahead');
  const none = await fixture();
  const d3 = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', none.dir])).out.stdout);
  assert.equal(d3.candidates[0].remote_action, undefined);
});

test('M5: cleanup reason tokens are localized', async () => {
  const { dir } = await fixture();
  const txt = await run(['cleanup-branches', '--cwd', dir]);
  assert.doesNotMatch(txt.out.stdout, /task_merged/);
  assert.match(txt.out.stdout, /tarefa/i);
});

test('cleanup-branches detects and removes orphan folders in .worktrees/ and closed delivery logs in .baco/logs/', async () => {
  const { mkdirSync } = await import('node:fs');
  const dir = await makeRepo({ '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\n' });
  g(dir, 'checkout', '-q', '-b', 'develop');
  g(dir, 'checkout', '-q', '-b', 'baco/ENT-001');
  commit(dir, { 'a.txt': 'ok\n' }, 'ent work');
  g(dir, 'checkout', '-q', 'develop');
  g(dir, 'merge', '-q', '--no-ff', 'baco/ENT-001', '-m', 'merge ENT-001');

  // Orphan folder in .worktrees/ and logs for ENT-001 + shared log that must stay
  mkdirSync(join(dir, '.worktrees', 'T-999-orphan'), { recursive: true });
  writeFileSync(join(dir, '.worktrees', 'T-999-orphan', 'leftover.txt'), 'x');
  mkdirSync(join(dir, '.baco', 'logs', 'pr-ENT-001-r01'), { recursive: true });
  writeFileSync(join(dir, '.baco', 'logs', 'quadro-ENT-001.json'), '{}');
  writeFileSync(join(dir, '.baco', 'logs', 'harnesses.md'), 'keep\n');
  writeFileSync(join(dir, '.baco', 'logs', 'quadro-ENT-002.json'), '{}');

  const dry = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', dir])).out.stdout);
  assert.deepEqual(dry.orphanWorktrees, ['.worktrees/T-999-orphan']);
  assert.deepEqual(dry.deliveryLogs, ['.baco/logs/pr-ENT-001-r01', '.baco/logs/quadro-ENT-001.json']);
  assert.equal(existsSync(join(dir, '.worktrees', 'T-999-orphan')), true);

  const applied = JSON.parse((await run(['cleanup-branches', '--apply', '--json', '--cwd', dir])).out.stdout);
  assert.deepEqual(applied.removedWorktrees, ['.worktrees/T-999-orphan']);
  assert.deepEqual(applied.removedLogs, ['.baco/logs/pr-ENT-001-r01', '.baco/logs/quadro-ENT-001.json']);
  assert.equal(existsSync(join(dir, '.worktrees', 'T-999-orphan')), false);
  assert.equal(existsSync(join(dir, '.baco', 'logs', 'quadro-ENT-001.json')), false);
  assert.equal(existsSync(join(dir, '.baco', 'logs', 'pr-ENT-001-r01')), false);
  assert.equal(existsSync(join(dir, '.baco', 'logs', 'harnesses.md')), true, 'shared log must stay');
  assert.equal(existsSync(join(dir, '.baco', 'logs', 'quadro-ENT-002.json')), true, 'other delivery log must stay');
});
