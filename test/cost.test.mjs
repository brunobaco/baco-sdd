import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { appendCost, agentRuns } from '../skills/baco-sdd/scripts/commands/cost.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const ENT = 'docs/entregas/ENT-001-a';
const call = async (dir, ...argv) => {
  const { out, io } = capture();
  const code = await main([...argv, '--cwd', dir], io);
  return { code, ...out };
};
const base = ['--agent', 'impl', '--effort', 'medium'];

test('add x4 then summary aggregates by phase/model and counts unknown tokens', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# p\n' });
  const add = (...a) => call(dir, 'cost', 'add', 'ENT-001', ...base, ...a);
  assert.equal((await add('--phase', '6', '--model', 'sonnet', '--turns', '3', '--tokens', '1000', '--seconds', '60')).code, 0);
  assert.equal((await add('--phase', '6', '--model', 'sonnet', '--tokens', '500', '--note', 'a | b')).code, 0);
  assert.equal((await add('--phase', '7', '--model', 'opus', '--tokens', '200')).code, 0);
  assert.equal((await add('--phase', '7', '--model', 'sonnet', '--tokens', '—')).code, 0);
  const md = readFileSync(join(dir, ENT, 'custo.md'), 'utf8');
  assert.match(md, /^# Custo \| ENT-001\n/);
  assert.match(md, /\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| 6 \| impl \| sonnet \| medium \| 3 \| 1000 \| 60 \|  \|/);
  assert.match(md, /a \\\| b/);
  const r = await call(dir, 'cost', 'summary', 'ENT-001', '--json');
  const s = JSON.parse(r.stdout);
  assert.equal(s.byPhase['6'].runs, 2);
  assert.equal(s.byPhase['6'].tokens, 1500);
  assert.equal(s.byPhase['6'].turns, 3);
  assert.equal(s.byModel.opus.runs, 1);
  assert.equal(s.total.runs, 4);
  assert.equal(s.total.tokensUnknownRuns, 1);
  const h = await call(dir, 'cost', 'summary', 'ENT-001');
  assert.match(h.stdout, /\| Fase \|/);
  assert.match(h.stdout, /\| Modelo \|/);
  assert.match(h.stdout, /1 execução/);
});

test('appendCost keeps existing bytes and uses injected timestamp', () => {
  const first = appendCost(null, { ent: 'ENT-001', timestamp: '2026-01-01 10:00', phase: '1', agent: 'a', model: 'm', effort: 'e' });
  assert.match(first, /\| 2026-01-01 10:00 \| 1 \| a \| m \| e \| — \| — \| — \|  \|/);
  const second = appendCost(first, { ent: 'ENT-001', timestamp: '2026-01-01 10:01', phase: '2', agent: 'a', model: 'm', effort: 'e' });
  assert.ok(second.startsWith(first));
});

test('usage errors exit 64', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# p\n' });
  assert.equal((await call(dir, 'cost', 'add', 'ENT-001', ...base, '--model', 'x')).code, 64);
  for (const bad of ['-1', '1.5', 'abc']) {
    assert.equal((await call(dir, 'cost', 'add', 'ENT-001', ...base, '--phase', '6', '--model', 'x', '--turns', bad)).code, 64, bad);
  }
  assert.equal((await call(dir, 'cost', 'add', 'nope', ...base, '--phase', '6', '--model', 'x')).code, 64);
  assert.equal((await call(dir, 'cost', 'add', 'ENT-009', ...base, '--phase', '6', '--model', 'x')).code, 65);
  assert.equal((await call(dir, 'cost', 'summary', 'ENT-001')).code, 65);
});

test('--harness: a new ledger gets a Harness column; old calls still work and leave it unknown', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# p\n' });
  const add = (...a) => call(dir, 'cost', 'add', 'ENT-001', ...base, '--phase', '7', ...a);
  assert.equal((await add('--model', 'modelo-x', '--harness', 'codex', '--tokens', '10')).code, 0);
  assert.equal((await add('--model', 'opus')).code, 0);
  const md = readFileSync(join(dir, ENT, 'custo.md'), 'utf8');
  assert.match(md, /\| Data\/hora \| Fase \| Agente \| Modelo \| Esforço \| Turnos \| Tokens \| Segundos \| Nota \| Harness \|/);
  assert.match(md, /\| 7 \| impl \| modelo-x \| medium \| — \| 10 \| — \|  \| codex \|/);
  assert.match(md, /\| 7 \| impl \| opus \| medium \| — \| — \| — \|  \| — \|/);
  const s = JSON.parse((await call(dir, 'cost', 'summary', 'ENT-001', '--json')).stdout);
  assert.equal(s.total.runs, 2);
  assert.equal(s.byHarness.codex.runs, 1);
  assert.equal(s.byHarness['—'].runs, 1);
  assert.equal((await add('--model', 'x', '--harness', '')).code, 64);
});

test('--harness on a ledger written before the column: the row keeps 9 cells and the harness goes into the note', async () => {
  const old = appendCost(null, { ent: 'ENT-001', timestamp: '2026-01-01 10:00', phase: '6', agent: 'a', model: 'm', effort: 'e' })
    .replace(' | Harness |', ' |').replace('|---|---|---|---|---|---|---|---|---|---|', '|---|---|---|---|---|---|---|---|---|').replace(/ \| — \|\n$/, ' |\n');
  assert.match(old, /\| Nota \|\n/);
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# p\n', [`${ENT}/custo.md`]: old });
  assert.equal((await call(dir, 'cost', 'add', 'ENT-001', ...base, '--phase', '7', '--model', 'x', '--harness', 'codex', '--note', 'PR')).code, 0);
  const md = readFileSync(join(dir, ENT, 'custo.md'), 'utf8');
  assert.ok(md.startsWith(old));
  const last = md.trim().split('\n').at(-1);
  assert.equal(last.split(' | ').length, 9);
  assert.match(last, /\| harness: codex; PR \|$/);
});

test('agentRuns tells harnesses apart when the ledger has them', () => {
  let md = appendCost(null, { ent: 'ENT-001', timestamp: 't', phase: '7', agent: 'pr-reviewer', model: 'm', effort: 'high', harness: 'codex' });
  md = appendCost(md, { ent: 'ENT-001', timestamp: 't', phase: '7', agent: 'pr-reviewer', model: 'm', effort: 'high', harness: 'opencode' });
  md = appendCost(md, { ent: 'ENT-001', timestamp: 't', phase: '6', agent: 'impl', model: 'opus', effort: 'medium' });
  assert.deepEqual(agentRuns(md), [
    { agent: 'pr-reviewer', model: 'm', effort: 'high', harness: 'codex', runs: 1 },
    { agent: 'pr-reviewer', model: 'm', effort: 'high', harness: 'opencode', runs: 1 },
    { agent: 'impl', model: 'opus', effort: 'medium', harness: null, runs: 1 },
  ]);
});

test('add says so when it creates custo.md, and only then', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# p\n' });
  const first = await call(dir, 'cost', 'add', 'ENT-001', ...base, '--phase', '6', '--model', 'x');
  assert.equal(first.code, 0);
  assert.match(first.stdout, /Arquivo .*custo\.md criado\./);
  const second = await call(dir, 'cost', 'add', 'ENT-001', ...base, '--phase', '6', '--model', 'x');
  assert.doesNotMatch(second.stdout, /criado/);
  const json = JSON.parse((await call(dir, 'cost', 'add', 'ENT-001', ...base, '--phase', '7', '--model', 'x', '--json')).stdout);
  assert.equal(json.created, undefined);
});
