import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, main, COMMANDS, exitQuietlyOnEpipe } from '../skills/baco-sdd/scripts/baco.mjs';
import { t } from '../skills/baco-sdd/scripts/lib/messages.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      stdout: { write: (s) => { out.stdout += s; } },
      stderr: { write: (s) => { out.stderr += s; } },
    },
  };
};

test('parseArgs handles booleans, repeated flags and --x=y', () => {
  assert.deepEqual(
    parseArgs(['trace', '--json', '--junit', 'a.xml', '--junit', 'b.xml', '--cwd=/x']),
    { _: ['trace'], flags: { json: true, junit: ['a.xml', 'b.xml'], cwd: '/x' } },
  );
});

test('parseArgs: everything after a bare -- is passthrough, not flags', () => {
  assert.deepEqual(
    parseArgs(['run-tests', '--layer', 'e2e', '--', '--grep', 'x y', '--', 'a.spec.ts']),
    { _: ['run-tests'], flags: { layer: 'e2e' }, passthrough: ['--grep', 'x y', '--', 'a.spec.ts'] },
  );
  assert.deepEqual(parseArgs(['x', '--']), { _: ['x'], flags: {}, passthrough: [] });
});

test('unknown command exits 64', async () => {
  const { io, out } = capture();
  assert.equal(await main(['nope'], io), 64);
  assert.ok(out.stderr.includes(t('pt-BR', 'cli.unknown_command', { name: 'nope' })));
});

test('--help lists every command with its summary and exits 0', async () => {
  const { io, out } = capture();
  assert.equal(await main(['--help'], io), 0);
  assert.equal(COMMANDS.length, 17);
  assert.ok(COMMANDS.includes('import-pr-verdict'));
  assert.ok(COMMANDS.includes('waive-review'));
  assert.ok(COMMANDS.includes('run-tests'));
  assert.ok(COMMANDS.includes('queue-status'));
  for (const name of COMMANDS) {
    assert.ok(out.stdout.includes(name), name);
    assert.notEqual(t('pt-BR', `cmd.${name}.summary`), `cmd.${name}.summary`, name);
  }
});

test('every listed command has a module (no placeholders left)', async () => {
  const { existsSync } = await import('node:fs');
  for (const name of COMMANDS) {
    assert.ok(existsSync(new URL(`../skills/baco-sdd/scripts/commands/${name}.mjs`, import.meta.url)), name);
  }
});

test('t interpolates, falls back and returns unknown key', () => {
  assert.equal(t('pt-BR', 'cli.unknown_command', { name: 'x' }).includes('x'), true);
  assert.equal(t('en', 'no.such.key'), 'no.such.key');
});

test('makeRepo and commit helpers', async () => {
  const dir = await makeRepo({ 'a/b.txt': 'hi' });
  assert.equal(readFileSync(join(dir, 'a/b.txt'), 'utf8'), 'hi');
  const sha = commit(dir, { 'a/b.txt': null, 'c.txt': 'x' }, 'second');
  assert.match(sha, /^[0-9a-f]{40}$/);
});

test('M7: test helper isolates git from user/system config', async () => {
  await import('./helpers/tmprepo.mjs');
  assert.equal(process.env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(process.env.GIT_CONFIG_NOSYSTEM, '1');
});

test('M7: handoff test does not use import.meta.dirname (Node 20.0-20.10 lacks it)', () => {
  const src = readFileSync(new URL('./handoff.test.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /import\.meta\.dirname/);
});

test('M6: DeliveryError -> 65 is mapped once, in the dispatcher', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../skills/baco-sdd/scripts/commands/', import.meta.url);
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /DeliveryError/, f);
  const repo = await makeRepo({ 'docs/entregas/ENT-002-a/x.md': 'x', 'docs/entregas/ENT-002-b/x.md': 'x' });
  const cases = [
    ['plan-freshness', 'ENT-009'], ['build-handoff', 'ENT-009'], ['import-verdict', 'ENT-009', 'v.md'],
    ['acceptance-report', 'ENT-009', '--target', 'main', '--trace', 't.json'], ['cost', 'summary', 'ENT-009'],
  ];
  for (const args of cases) {
    const { io, out } = capture();
    assert.equal(await main([...args, '--cwd', repo], io), 65, args[0]);
    assert.ok(out.stderr.includes(t('pt-BR', 'delivery.not_found', { id: 'ENT-009' })), args[0]);
  }
  const { io, out } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-002', '--cwd', repo], io), 65);
  assert.ok(out.stderr.includes(t('pt-BR', 'delivery.ambiguous', { id: 'ENT-002' })));
});

test('I11: --json still prints localized error messages to stderr and adds error {key, params}', async () => {
  const repo = await makeRepo({ 'docs/entregas/ENT-001-a/plano.md': '# P\n', 'bad.json': '{nope' });
  let c = capture();
  assert.equal(await main(['guard-tests', '--json', '--cwd', repo], c.io), 64);
  assert.match(c.out.stderr, /Uso: baco guard-tests/);
  assert.equal(JSON.parse(c.out.stdout).error.key, 'cli.usage');
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'bad.json', '--json', '--cwd', repo], c.io), 65);
  assert.match(c.out.stderr, /inválido/);
  const data = JSON.parse(c.out.stdout);
  assert.equal(data.error.key, 'acceptance.bad_trace');
  assert.equal(data.error.params.path, 'bad.json');
  // Thrown environment errors (e.g. unknown delivery) get the same treatment.
  c = capture();
  assert.equal(await main(['cost', 'summary', 'ENT-009', '--json', '--cwd', repo], c.io), 65);
  assert.ok(c.out.stderr.includes(t('pt-BR', 'delivery.not_found', { id: 'ENT-009' })));
  assert.deepEqual(JSON.parse(c.out.stdout), { error: { key: 'delivery.not_found', params: { id: 'ENT-009' } } });
  // Success keeps the data shape (no error key).
  c = capture();
  assert.equal(await main(['plan-freshness', 'ENT-001', '--json', '--cwd', repo], c.io), 1);
  assert.equal('error' in JSON.parse(c.out.stdout), false);
});

test('exitQuietlyOnEpipe: EPIPE exits 0, any other stream error is rethrown', () => {
  const stream = new EventEmitter();
  const exits = [];
  exitQuietlyOnEpipe(stream, (code) => exits.push(code));
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  assert.deepEqual(exits, [0]);
  assert.throws(() => stream.emit('error', Object.assign(new Error('boom'), { code: 'EIO' })), /boom/);
  assert.deepEqual(exits, [0]);
});

test('the CLI leaves quietly when its reader closes the pipe early (baco ... | head -1)', async () => {
  const cli = fileURLToPath(new URL('../skills/baco-sdd/scripts/baco.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy(); // the reader is gone before the child writes
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((res) => child.on('close', res));
  assert.equal(stderr, '');
  assert.equal(code, 0);
});
