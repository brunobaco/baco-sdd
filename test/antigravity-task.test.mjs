import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmprepo.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';

// `baco antigravity-task` prepares a task folder for an Antigravity implementer: the hook that keeps
// its file writes inside the folder and the per-task permission rules, both in `.agents/` (where
// Antigravity loads a workspace's hooks), hidden from git; `--clean` takes them out.
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const BACO = join(SKILL_ROOT, 'scripts', 'baco.mjs');
const READ = JSON.parse(readFileSync(join(SKILL_ROOT, 'templates', 'antigravity', 'leitura.json'), 'utf8'));

async function project() {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', '.gitignore': '.worktrees/\n', 'src/a.js': 'x\n' });
  temps.push(repo);
  git(repo, 'worktree', 'add', '-q', '-b', 'baco/ENT-001-T-001', '.worktrees/T-001');
  return { repo, task: realpathSync(join(repo, '.worktrees', 'T-001')) };
}
const run = async (cwd, ...args) => {
  let stdout = '';
  const io = { stdout: { write: (s) => { stdout += s; } }, stderr: { write: () => {} } };
  const code = await main(['antigravity-task', ...args, '--json', '--cwd', cwd], io);
  return { code, data: stdout ? JSON.parse(stdout) : null };
};
const regexOf = (rule) => new RegExp(/^command\(regex:(.*)\)$/s.exec(rule)[1], 's');

test('antigravity-task: writes the hook and the task rules in .agents/, hidden from git', async () => {
  const { repo, task } = await project();
  const { code, data } = await run(repo, '.worktrees/T-001');
  assert.equal(code, 0);
  assert.equal(data.folder, task);
  assert.equal(data.settingsArg, '.agents/baco-construcao.json');
  const hooks = JSON.parse(readFileSync(join(task, '.agents', 'hooks.json'), 'utf8'));
  const group = hooks['baco-tarefa'].PreToolUse[0];
  assert.equal(group.matcher, '*');
  const cmd = group.hooks[0].command;
  assert.ok(cmd.includes(join(SKILL_ROOT, 'scripts', 'antigravity-guard.mjs')), cmd);
  assert.ok(cmd.includes(`--root "${task}"`), cmd);
  assert.equal(git(task, 'status', '--porcelain', '--untracked-files=all'), '', 'nothing new for git');
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('antigravity-task: the rules pin the approval mode, deny the web, and allow reading plus BACO\'s test runner only', async () => {
  const { repo, task } = await project();
  await run(repo, '.worktrees/T-001');
  const s = JSON.parse(readFileSync(join(task, '.agents', 'baco-construcao.json'), 'utf8'));
  assert.equal(s.toolPermission, 'request-review');
  assert.equal(s.agentMode, '');
  for (const d of ['read_url(*)', 'execute_url(*)', 'download_url(*)']) assert.ok(s.permissions.deny.includes(d), d);
  for (const r of READ.permissions.allow) assert.ok(s.permissions.allow.includes(r), r);
  const extra = s.permissions.allow.filter((r) => !READ.permissions.allow.includes(r));
  assert.equal(extra.length, 1, 'one rule beyond reading');
  const re = regexOf(extra[0]);
  assert.ok(re.test(`node ${BACO} run-tests --layer unit --quick -- test/a.test.js`));
  assert.ok(re.test(`node ${BACO} run-tests`));
  for (const bad of [`node ${BACO} run-tests; rm -rf x`, `node ${BACO} run-tests > x`, `node ${BACO} cost add x`, 'node -e "1"', `node ${BACO} run-tests $(id)`, 'npm install x']) {
    assert.ok(!re.test(bad), bad);
  }
});

test('antigravity-task: running it again keeps one entry of each in git\'s exclude list', async () => {
  const { repo, task } = await project();
  await run(repo, '.worktrees/T-001');
  await run(repo, '.worktrees/T-001');
  const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n');
  assert.equal(exclude.filter((l) => l === '/.agents/hooks.json').length, 1);
  assert.equal(exclude.filter((l) => l === '/.agents/baco-construcao.json').length, 1);
  assert.ok(existsSync(join(task, '.agents', 'hooks.json')));
});

test('antigravity-task --clean: removes both files and the empty folder', async () => {
  const { repo, task } = await project();
  await run(repo, '.worktrees/T-001');
  const { code } = await run(repo, '.worktrees/T-001', '--clean');
  assert.equal(code, 0);
  assert.ok(!existsSync(join(task, '.agents')));
  assert.equal((await run(repo, '.worktrees/T-001', '--clean')).code, 0, 'nothing to clean is fine');
});

test('antigravity-task: refuses a project hook it did not write, the main folder and a protected branch', async () => {
  const { repo, task } = await project();
  mkdirSync(join(task, '.agents'));
  writeFileSync(join(task, '.agents', 'hooks.json'), '{"time":{}}');
  const foreign = await run(repo, '.worktrees/T-001');
  assert.equal(foreign.code, 1);
  assert.equal(readFileSync(join(task, '.agents', 'hooks.json'), 'utf8'), '{"time":{}}', 'left untouched');
  assert.equal((await run(repo, '.worktrees/T-001', '--clean')).code, 1, '--clean does not remove it either');

  const main = await run(repo, '.');
  assert.equal(main.code, 1, 'the main folder is on main, a protected branch');
  assert.ok(!existsSync(join(repo, '.agents')));
  const notGit = await run(repo, 'src');
  assert.equal(notGit.code, 1, 'not the top of a git folder');
});

test('antigravity-task: a fresh scratch folder with no commit yet (the write check) works', async () => {
  const { repo } = await project();
  const scratch = join(repo, '.baco', 'logs', 'harness-check', 'antigravity-escrita');
  mkdirSync(scratch, { recursive: true });
  git(scratch, 'init', '-q', '-b', 'baco/verificacao');
  const { code, data } = await run(repo, '.baco/logs/harness-check/antigravity-escrita');
  assert.equal(code, 0);
  assert.equal(data.branch, 'baco/verificacao');
  const other = mkdirSync(join(repo, 'outra'), { recursive: true }) ?? join(repo, 'outra');
  git(other, 'init', '-q', '-b', 'main');
  assert.equal((await run(repo, 'outra')).code, 1, 'an unborn main is still protected');
});

test('antigravity-task: usage without a folder', async () => {
  const { repo } = await project();
  assert.equal((await run(repo)).code, 64);
});
