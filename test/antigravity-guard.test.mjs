import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_ROOT } from './helpers/content.mjs';

// The hook BACO puts in an Antigravity implementer's task folder. Checked live with CLI 1.5.10: in
// non-interactive mode the file tools write anywhere the person can, with or without
// `accept-edits` and whatever `write_file(<folder>)` rule is set, so this hook is what keeps the
// implementer's file writes inside the task folder. A denial does not end the run.
const GUARD = join(SKILL_ROOT, 'scripts', 'antigravity-guard.mjs');
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'baco-guard-'))); temps.push(d); return d; };

const call = (root, name, args, cwd = root) => {
  const input = JSON.stringify({ hookEventName: 'PreToolUse', conversationId: 'c1', cwd, toolCall: { id: 'x', name, args } });
  const r = spawnSync(process.execPath, [GUARD, '--root', root], { input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('guard: file writes inside the task folder are allowed, by absolute or relative path', () => {
  const root = tmp();
  assert.deepEqual(call(root, 'write_file', { Path: join(root, 'src/a.js'), Content: 'x' }), { decision: 'allow' });
  assert.deepEqual(call(root, 'edit_file', { Path: 'src/a.js', Target: 'a', Replacement: 'b' }), { decision: 'allow' });
  assert.deepEqual(call(root, 'write_file', { Path: join(root, 'docs/entregas/ENT-001-x/relatorios/T-001.md'), Content: 'x' }), { decision: 'allow' });
});

test('guard: a write outside the task folder is denied with the reason the model reads', () => {
  const root = tmp();
  for (const [name, args] of [
    ['write_file', { Path: join(root, '..', 'fora.txt'), Content: 'x' }],
    ['edit_file', { Path: '../../src/soma.js', Target: 'a', Replacement: 'b' }],
    ['write_file', { Path: '/etc/hosts', Content: 'x' }],
    ['replace_file_content', { TargetFile: join(root, '..', 'x.js') }],
  ]) {
    const a = call(root, name, args);
    assert.equal(a.decision, 'deny', `${name} ${JSON.stringify(args)}`);
    assert.match(a.reason, /fora da pasta da tarefa/i);
  }
});

test('guard: the hook, its rules and git data stay out of reach, even inside the folder', () => {
  const root = tmp();
  for (const p of ['.agents/hooks.json', '.agents/baco-construcao.json', '.agents/novo.json', '.git', '.git/config']) {
    assert.equal(call(root, 'write_file', { Path: join(root, p), Content: '{}' }).decision, 'deny', p);
  }
});

test('guard: a symbolic link inside the folder that points outside does not let a write out', () => {
  const root = tmp();
  const outside = tmp();
  symlinkSync(outside, join(root, 'atalho'));
  assert.equal(call(root, 'write_file', { Path: join(root, 'atalho', 'x.txt'), Content: 'x' }).decision, 'deny');
  mkdirSync(join(root, 'src'));
  assert.equal(call(root, 'write_file', { Path: join(root, 'src', 'novo', 'y.txt'), Content: 'x' }).decision, 'allow', 'a new folder inside is fine');
});

test('guard: read tools pass; any other tool pointing outside is denied, including a command run elsewhere', () => {
  const root = tmp();
  assert.deepEqual(call(root, 'read_file', { AbsolutePath: '/etc/hostname' }), { decision: 'allow' });
  assert.deepEqual(call(root, 'run_command', { CommandLine: 'npm test', WaitMsBeforeAsync: 5000 }), { decision: 'allow' });
  assert.equal(call(root, 'run_command', { CommandLine: 'npm test', Cwd: join(root, '..') }).decision, 'deny');
  assert.deepEqual(call(root, 'run_command', { CommandLine: 'npm test', Cwd: root }), { decision: 'allow' }, 'a command run in the folder itself');
  assert.equal(call(root, 'nova_ferramenta', { DirectoryPath: '/tmp' }).decision, 'deny');
  assert.deepEqual(call(root, 'nova_ferramenta', { Texto: 'qualquer' }), { decision: 'allow' });
});

test('guard: unreadable input or a missing root is denied, never allowed', () => {
  const root = tmp();
  const garbage = spawnSync(process.execPath, [GUARD, '--root', root], { input: 'not json', encoding: 'utf8' });
  assert.equal(JSON.parse(garbage.stdout).decision, 'deny');
  const noRoot = spawnSync(process.execPath, [GUARD], { input: '{}', encoding: 'utf8' });
  assert.equal(JSON.parse(noRoot.stdout).decision, 'deny');
});
