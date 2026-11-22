import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'baco-answer-')); temps.push(d); return d; };

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

// The envelope `antigravity -p ... --output-format json` prints (Antigravity CLI 1.5).
const envelope = (over = {}) => ({
  conversation_id: 'c0e2f011-df7a-400f-aca8-bc9b084b3bcc',
  status: 'SUCCESS',
  response: '## Veredito\n\nAPROVADO\n',
  duration_seconds: 16.79,
  num_turns: 2,
  usage: { input_tokens: 15216, output_tokens: 96, thinking_tokens: 10, cache_read_tokens: 17645, total_tokens: 15312 },
  ...over,
});

const run = async (dir, obj, extra = []) => {
  const json = join(dir, 'resposta.json');
  if (obj !== undefined) writeFileSync(json, typeof obj === 'string' ? obj : JSON.stringify(obj));
  const out = join(dir, 'resposta.md');
  const c = capture();
  const code = await main(['harness-answer', json, '--out', out, '--json', '--cwd', dir, ...extra], c.io);
  return { code, out, data: c.out.stdout ? JSON.parse(c.out.stdout) : null, stderr: c.out.stderr };
};

test('harness-answer writes the response verbatim and reports tokens, turns and seconds', async () => {
  const dir = tmp();
  const { code, out, data } = await run(dir, envelope());
  assert.equal(code, 0);
  assert.equal(readFileSync(out, 'utf8'), '## Veredito\n\nAPROVADO\n');
  assert.equal(data.outcome, 'written');
  assert.equal(data.out, out);
  assert.equal(data.conversation, 'c0e2f011-df7a-400f-aca8-bc9b084b3bcc');
  assert.equal(data.tokens, 15312);
  assert.deepEqual(data.usage, { input: 15216, output: 96, thinking: 10, cacheRead: 17645, total: 15312 });
  assert.equal(data.turns, 2);
  assert.equal(data.seconds, 17);
  assert.deepEqual(data.denied, []);
});

test('harness-answer: an action denied before any answer means resume, and nothing is written', async () => {
  const dir = tmp();
  const { code, out, data } = await run(dir, envelope({ response: '', denied_actions: [{ action: 'command', display_name: 'Bash' }] }));
  assert.equal(code, 1);
  assert.equal(data.outcome, 'denied');
  assert.deepEqual(data.denied, ['command']);
  assert.equal(data.conversation, 'c0e2f011-df7a-400f-aca8-bc9b084b3bcc');
  assert.equal(existsSync(out), false);
});

test('harness-answer: a denied action with an answer still writes it, and lists the denial', async () => {
  const dir = tmp();
  const { code, out, data } = await run(dir, envelope({ denied_actions: [{ action: 'read_file', display_name: 'ReadFile' }] }));
  assert.equal(code, 0);
  assert.equal(data.outcome, 'written');
  assert.deepEqual(data.denied, ['read_file']);
  assert.ok(existsSync(out));
});

test('harness-answer: a status other than SUCCESS fails without writing', async () => {
  const dir = tmp();
  for (const status of ['ERROR', 'CANCELED', 'INTERRUPTED', 'WAITING']) {
    const { code, out, data } = await run(dir, envelope({ status, error: 'quota exhausted' }));
    assert.equal(code, 1, status);
    assert.equal(data.outcome, 'failed');
    assert.equal(data.status, status);
    assert.equal(data.error, 'quota exhausted');
    assert.equal(existsSync(out), false);
  }
});

test('harness-answer: an empty answer with no denial fails without writing', async () => {
  const dir = tmp();
  for (const response of ['', '   \n', undefined]) {
    const { code, out, data } = await run(dir, envelope({ response }));
    assert.equal(code, 1);
    assert.equal(data.outcome, 'empty');
    assert.equal(existsSync(out), false);
  }
});

test('harness-answer: missing usage fields count as null, not as zero', async () => {
  const dir = tmp();
  const { code, data } = await run(dir, envelope({ usage: undefined, num_turns: undefined, duration_seconds: undefined }));
  assert.equal(code, 0);
  assert.equal(data.tokens, null);
  assert.equal(data.usage, null);
  assert.equal(data.turns, null);
  assert.equal(data.seconds, null);
});

test('harness-answer: a file that is not the JSON envelope is an environment error', async () => {
  const dir = tmp();
  for (const bad of ['not json', '[]', '"x"', JSON.stringify({ response: 'x' })]) {
    const { code } = await run(dir, bad);
    assert.equal(code, 65, bad);
  }
  const missing = await run(dir, undefined);
  assert.equal(missing.code, 65);
});

test('harness-answer: with stderr mixed in (a background run), the last JSON line is the envelope', async () => {
  const dir = tmp();
  const mixed = [
    'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.',
    JSON.stringify(envelope({ response: 'velha' })),
    'I1120 18:19:03.424608       1 session.go:87] Print mode',
    JSON.stringify(envelope()),
    '',
  ].join('\n');
  const { code, out, data } = await run(dir, mixed);
  assert.equal(code, 0);
  assert.equal(readFileSync(out, 'utf8'), '## Veredito\n\nAPROVADO\n');
  assert.equal(data.outcome, 'written');
  const noise = await run(dir, 'log line\n{"not": "the envelope"}\n');
  assert.equal(noise.code, 65);
});

test('harness-answer: usage errors', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a.json'), JSON.stringify(envelope()));
  const cases = [
    ['harness-answer'],
    ['harness-answer', join(dir, 'a.json')],
    ['harness-answer', join(dir, 'a.json'), '--out'],
    ['harness-answer', join(dir, 'a.json'), '--out', join(dir, 'a.json')],
    ['harness-answer', join(dir, 'a.json'), join(dir, 'b.json'), '--out', join(dir, 'r.md')],
  ];
  for (const argv of cases) {
    const c = capture();
    assert.equal(await main([...argv, '--cwd', dir], c.io), 64, argv.join(' '));
  }
});

test('harness-answer works outside a git repository', async () => {
  const dir = tmp();
  assert.equal(existsSync(join(dir, '.git')), false);
  const { code } = await run(dir, envelope());
  assert.equal(code, 0);
});

test('harness-answer: human messages name the outcome', async () => {
  const dir = tmp();
  const json = join(dir, 'r.json');
  writeFileSync(json, JSON.stringify(envelope({ response: '', denied_actions: [{ action: 'command' }] })));
  const c = capture();
  assert.equal(await main(['harness-answer', json, '--out', join(dir, 'r.md'), '--cwd', dir], c.io), 1);
  assert.match(c.out.stdout, /negad/);
  assert.match(c.out.stdout, /c0e2f011-df7a-400f-aca8-bc9b084b3bcc/);
  writeFileSync(json, JSON.stringify(envelope()));
  const ok = capture();
  assert.equal(await main(['harness-answer', json, '--out', join(dir, 'r.md'), '--cwd', dir], ok.io), 0);
  assert.match(ok.out.stdout, /15312/);
});

// Antigravity reports the usage of the whole conversation so far: a resume (`--conversation`)
// prints the first call's numbers plus its own. The engine keeps one record per call in the
// project's git-ignored `.baco/logs/uso-ferramentas.jsonl` and reports only what this call added.
const LEDGER = join('.baco', 'logs', 'uso-ferramentas.jsonl');
const ledgerOf = (root) => readFileSync(join(root, LEDGER), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('harness-answer records each call in the project ledger and reports only what a resume added', async () => {
  const dir = await makeRepo({ '.gitignore': '.baco/logs/\n' });
  const first = await run(dir, envelope(), ['--harness', 'antigravity-claude', '--model', 'claude-opus-5-5-high', '--agent', 'pr-reviewer']);
  assert.equal(first.code, 0);
  assert.equal(first.data.tokens, 15312);
  assert.equal(first.data.recorded, true);
  const resumed = envelope({ num_turns: 3, duration_seconds: 40.2, usage: { input_tokens: 30000, output_tokens: 150, thinking_tokens: 25, cache_read_tokens: 20000, total_tokens: 30150 } });
  const second = await run(dir, resumed, ['--harness', 'antigravity-claude', '--model', 'claude-opus-5-5-high', '--agent', 'pr-reviewer']);
  assert.equal(second.code, 0);
  assert.equal(second.data.tokens, 30150 - 15312);
  assert.deepEqual(second.data.usage, { input: 30000 - 15216, output: 150 - 96, thinking: 25 - 10, cacheRead: 20000 - 17645, total: 30150 - 15312 });
  assert.equal(second.data.cumulative.total, 30150);
  assert.equal(second.data.turns, 1);
  assert.equal(second.data.seconds, null, 'the tool counts seconds since the conversation began, idle time included');
  const rows = ledgerOf(dir);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['agent', 'at', 'cacheRead', 'conversation', 'harness', 'input', 'model', 'output', 'thinking', 'total', 'turns'].sort());
  assert.equal(rows[1].harness, 'antigravity-claude');
  assert.equal(rows[1].model, 'claude-opus-5-5-high');
  assert.equal(rows[1].agent, 'pr-reviewer');
  assert.equal(rows[1].total, 30150, 'the ledger keeps the running total; the measurement takes the differences');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', '.baco'], { cwd: dir, encoding: 'utf8' }), '', 'the ledger is git-ignored');
});

test('harness-answer from a task worktree records in the main checkout; a failed call with usage is recorded too', async () => {
  const dir = await makeRepo({ '.gitignore': '.baco/logs/\n.worktrees/\n' });
  const task = join(dir, '.worktrees', 'T-001');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'baco/ENT-001-T-001', task], { cwd: dir });
  const r = await run(task, envelope({ status: 'ERROR', response: '', error: 'quota' }), ['--model', 'gemini-4-neon-high']);
  assert.equal(r.code, 1);
  assert.equal(r.data.recorded, true);
  const [row] = ledgerOf(dir);
  assert.equal(row.harness, 'antigravity', 'the harness defaults to antigravity');
  assert.equal(row.agent, null);
  assert.equal(existsSync(join(task, LEDGER)), false);
});

test('harness-answer records nothing outside a repo, without usage, or when git does not ignore the ledger', async () => {
  const plain = tmp();
  assert.equal((await run(plain, envelope())).data.recorded, false);
  const dir = await makeRepo({});
  const r = await run(dir, envelope());
  assert.equal(r.code, 0);
  assert.equal(r.data.recorded, false);
  assert.equal(existsSync(join(dir, LEDGER)), false);
  assert.match(r.stderr + JSON.stringify(r.data), /uso-ferramentas|\.baco\/logs/);
  const ignored = await makeRepo({ '.gitignore': '.baco/logs/\n' });
  const { usage: _u, ...noUsage } = envelope();
  assert.equal((await run(ignored, noUsage)).data.recorded, false);
});
