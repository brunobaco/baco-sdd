import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { cleanupCommandsHash, cleanupCommandsStatus } from '../skills/baco-sdd/scripts/commands/cleanup-branches.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';

const run = async (args) => {
  const out = { stdout: '', stderr: '' };
  const code = await main(args, { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } });
  return { code, out };
};
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const HASH_FILE = (dir) => join(dir, '.baco', 'logs', 'cleanup-commands.sha256');
const repoWith = (commands) => makeRepo({
  'a.md': 'x',
  '.baco/config.yaml': commands.length ? `cleanup:\n  commands:\n${commands.map((c) => `    - ${c}`).join('\n')}\n` : 'gates:\n  spec_approval: true\n',
});

test('cleanupCommandsHash: canonical form is the trimmed commands, in order, joined by a newline, SHA-256 hex', () => {
  assert.equal(cleanupCommandsHash(['npm run db:clean', 'docker image prune -f']), sha('npm run db:clean\ndocker image prune -f'));
  assert.equal(cleanupCommandsHash(['  npm run db:clean ', '\tdocker image prune -f  ']), cleanupCommandsHash(['npm run db:clean', 'docker image prune -f']));
  assert.notEqual(cleanupCommandsHash(['b', 'a']), cleanupCommandsHash(['a', 'b']), 'order matters');
  assert.notEqual(cleanupCommandsHash(['a b']), cleanupCommandsHash(['a', 'b']), 'one command is not two');
  assert.equal(cleanupCommandsHash([]), null, 'no commands, no hash');
  assert.equal(cleanupCommandsHash(['', '   ']), null, 'blank entries do not count');
});

test('cleanupCommandsStatus: none, unconfirmed, confirmed, changed', async () => {
  const none = await repoWith([]);
  assert.equal(cleanupCommandsStatus(none, []).status, 'none');
  const dir = await repoWith(['npm run db:clean']);
  assert.equal(cleanupCommandsStatus(dir, ['npm run db:clean']).status, 'unconfirmed');
  const { code } = await run(['cleanup-branches', '--confirm-commands', '--cwd', dir]);
  assert.equal(code, 0);
  assert.equal(cleanupCommandsStatus(dir, ['npm run db:clean']).status, 'confirmed');
  assert.equal(cleanupCommandsStatus(dir, [' npm run db:clean ']).status, 'confirmed', 'same canonical form');
  assert.equal(cleanupCommandsStatus(dir, ['npm run db:clean', 'rm -rf data']).status, 'changed');
});

test('--confirm-commands writes the canonical hash and does nothing else', async () => {
  const dir = await repoWith(['npm run db:clean', 'docker image prune -f']);
  const r = await run(['cleanup-branches', '--confirm-commands', '--json', '--cwd', dir]);
  assert.equal(r.code, 0, r.out.stdout + r.out.stderr);
  const expected = sha('npm run db:clean\ndocker image prune -f');
  assert.equal(readFileSync(HASH_FILE(dir), 'utf8'), `${expected}\n`);
  const data = JSON.parse(r.out.stdout);
  assert.equal(data.confirmed, true);
  assert.equal(data.hash, expected);
  assert.deepEqual(data.commands, ['npm run db:clean', 'docker image prune -f']);
  assert.equal(data.apply, undefined, 'no branch cleanup ran');
});

test('--confirm-commands with no cleanup.commands writes nothing', async () => {
  const dir = await repoWith([]);
  const r = await run(['cleanup-branches', '--confirm-commands', '--json', '--cwd', dir]);
  assert.equal(r.code, 0, r.out.stdout + r.out.stderr);
  assert.equal(existsSync(HASH_FILE(dir)), false);
  assert.equal(JSON.parse(r.out.stdout).confirmed, false);
});

test('dry run reports the commands as unconfirmed, then confirmed, then changed after a config edit', async () => {
  const dir = await repoWith(['npm run db:clean']);
  const first = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', dir])).out.stdout);
  assert.equal(first.cleanupCommands.status, 'unconfirmed');
  assert.deepEqual(first.cleanupCommands.commands, ['npm run db:clean']);
  assert.equal(first.cleanupCommands.recorded, null);
  const text = (await run(['cleanup-branches', '--cwd', dir])).out.stdout;
  assert.match(text, /npm run db:clean/);
  assert.match(text, /--confirm-commands/);

  await run(['cleanup-branches', '--confirm-commands', '--cwd', dir]);
  const second = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', dir])).out.stdout);
  assert.equal(second.cleanupCommands.status, 'confirmed');

  writeFileSync(join(dir, '.baco', 'config.yaml'), 'cleanup:\n  commands:\n    - npm run db:clean\n    - rm -rf tmp-data\n');
  const third = JSON.parse((await run(['cleanup-branches', '--json', '--cwd', dir])).out.stdout);
  assert.equal(third.cleanupCommands.status, 'changed');
  assert.equal(third.cleanupCommands.recorded, second.cleanupCommands.hash);
  assert.notEqual(third.cleanupCommands.hash, third.cleanupCommands.recorded);
});

test('--apply also carries the commands status and keeps the hash file', async () => {
  const dir = await repoWith(['npm run db:clean']);
  await run(['cleanup-branches', '--confirm-commands', '--cwd', dir]);
  const r = await run(['cleanup-branches', '--apply', '--json', '--cwd', dir]);
  assert.equal(r.code, 0, r.out.stdout + r.out.stderr);
  assert.equal(JSON.parse(r.out.stdout).cleanupCommands.status, 'confirmed');
  assert.equal(existsSync(HASH_FILE(dir)), true);
});

test('no cleanup.commands: status none and no extra message in the dry run', async () => {
  const dir = await repoWith([]);
  const r = await run(['cleanup-branches', '--json', '--cwd', dir]);
  assert.equal(JSON.parse(r.out.stdout).cleanupCommands.status, 'none');
});
