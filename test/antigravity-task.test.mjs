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

// Sandboxes: protegida (default, as above), rede (the same hook, plus npm, npx and node) and livre (no
// write hook, a closed command list). Every mode returns the call's arguments without the prompt.
const settingsOf = (task) => JSON.parse(readFileSync(join(task, '.agents', 'baco-construcao.json'), 'utf8'));
const extraRules = (task) => settingsOf(task).permissions.allow.filter((r) => !READ.permissions.allow.includes(r)).map(regexOf);
const allows = (res, cmd) => res.some((re) => re.test(cmd));

test('antigravity-task: default sandbox protegida, and the call arguments in data', async () => {
  const { repo } = await project();
  const { data } = await run(repo, '.worktrees/T-001');
  assert.equal(data.sandbox, 'protegida');
  assert.deepEqual(data.callArgs, ['--settings', '.agents/baco-construcao.json', '--model', '<model>', '--mode', 'accept-edits', '--print-timeout', '0', '--output-format', 'json']);
  const named = await run(repo, '.worktrees/T-001', '--model', 'gemini-4-neon-high');
  assert.equal(named.data.callArgs[3], 'gemini-4-neon-high');
  assert.ok(!named.data.callArgs.includes('--dangerously-skip-permissions'));
  const explicit = await run(repo, '.worktrees/T-001', '--sandbox', 'protegida');
  assert.equal(explicit.data.sandbox, 'protegida');
});

test('antigravity-task --sandbox rede: the write hook stays, and npm, npx and node are allowed with plain arguments', async () => {
  const { repo, task } = await project();
  const { code, data } = await run(repo, '.worktrees/T-001', '--sandbox', 'rede');
  assert.equal(code, 0);
  assert.equal(data.sandbox, 'rede');
  assert.ok(existsSync(join(task, '.agents', 'hooks.json')), 'write hook written');
  const s = settingsOf(task);
  assert.equal(s.toolPermission, 'request-review');
  assert.equal(s.agentMode, '');
  for (const d of ['read_url(*)', 'execute_url(*)', 'download_url(*)']) assert.ok(s.permissions.deny.includes(d), d);
  const res = extraRules(task);
  assert.equal(res.length, 4, 'run-tests plus npm, npx and node');
  for (const ok of ['npm install', 'npm ci', 'npm install -D vitest@2.1.0', 'npx playwright test --project chromium', 'node server.js', 'node -e "console.log(1)"', `node ${BACO} run-tests --layer e2e`]) {
    assert.ok(allows(res, ok), ok);
  }
  for (const bad of ['npm test; rm -rf x', 'npm test > x', 'npm test | tee x', 'npm test && git push', 'node $(id)', 'sudo npm install', 'git commit -m x', 'rm -rf x', 'curl http://x']) {
    assert.ok(!allows(res, bad), bad);
  }
  assert.equal(git(task, 'status', '--porcelain', '--untracked-files=all'), '', 'nothing new for git');
});

test('antigravity-task --sandbox livre: no write hook (a BACO one is removed), only the closed command list', async () => {
  const { repo, task } = await project();
  await run(repo, '.worktrees/T-001');
  assert.ok(existsSync(join(task, '.agents', 'hooks.json')));
  const { code, data } = await run(repo, '.worktrees/T-001', '--sandbox', 'livre');
  assert.equal(code, 0);
  assert.equal(data.sandbox, 'livre');
  assert.equal(data.hooks, null);
  assert.ok(!existsSync(join(task, '.agents', 'hooks.json')), 'the BACO hook is gone');
  assert.ok(existsSync(join(task, '.agents', 'baco-construcao.json')));
  assert.equal(data.callArgs[1], '.agents/baco-construcao.json');
  const s = settingsOf(task);
  assert.equal(s.toolPermission, 'request-review');
  for (const d of ['read_url(*)', 'execute_url(*)', 'download_url(*)']) assert.ok(s.permissions.deny.includes(d), d);
  const res = [...READ.permissions.allow.map(regexOf), ...extraRules(task)];
  for (const ok of ['git status', 'git diff --stat', 'git log --oneline', 'git show HEAD', 'git grep -n foo', 'ls -la', 'grep -rn x src', 'cat a.js', 'head -5 a.js', 'tail -n 3 a.js', 'wc -l a.js', 'find . -name "*.js"', 'find src -type f', 'npm install', 'npx vitest run', 'node a.js', `node ${BACO} run-tests`]) {
    assert.ok(allows(res, ok), ok);
  }
  for (const bad of ['find . -delete', 'find . -exec rm {} +', 'find . -execdir rm {} +', 'find . -fprint x', 'find . -ok rm {} +', 'git grep -O vim foo', 'git grep --open-files-in-pager=vim x', 'git commit -m x', 'git push', 'rm -rf x', 'sudo true', 'gh pr list', 'npm test > x', 'mkdir x', 'cp a b']) {
    assert.ok(!allows(res, bad), bad);
  }
  assert.equal(git(task, 'status', '--porcelain', '--untracked-files=all'), '', 'nothing new for git');
  assert.equal((await run(repo, '.worktrees/T-001', '--clean')).code, 0);
  assert.ok(!existsSync(join(task, '.agents')));
});

test('antigravity-task --sandbox livre: a project hook it did not write is still refused and left untouched', async () => {
  const { repo, task } = await project();
  mkdirSync(join(task, '.agents'));
  writeFileSync(join(task, '.agents', 'hooks.json'), '{"time":{}}');
  assert.equal((await run(repo, '.worktrees/T-001', '--sandbox', 'livre')).code, 1);
  assert.equal(readFileSync(join(task, '.agents', 'hooks.json'), 'utf8'), '{"time":{}}');
});

test('antigravity-task: an unknown sandbox is a usage error and writes nothing', async () => {
  const { repo, task } = await project();
  for (const bad of [['--sandbox', 'aberta'], ['--sandbox']]) {
    assert.equal((await run(repo, '.worktrees/T-001', ...bad)).code, 64, bad.join(' '));
  }
  assert.ok(!existsSync(join(task, '.agents')));
});
