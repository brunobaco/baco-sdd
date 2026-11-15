import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { appendCost, writeMeasured, summarizeMeasured } from '../skills/baco-sdd/scripts/commands/cost.mjs';
import { encodeProjectDir, measureUsage, insideRoot } from '../skills/baco-sdd/scripts/lib/usage.mjs';
import { parseTime } from '../skills/baco-sdd/scripts/commands/cost.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

// Every transcript below is fictitious and hand-made: the shape of the lines follows the session
// files of Claude Code and Codex, the ids, models and numbers are invented.

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const call = async (dir, ...argv) => {
  const { out, io } = capture();
  const code = await main([...argv, '--cwd', dir], io);
  return { code, ...out };
};
const ENT = 'docs/entregas/ENT-001-a';

const put = (path, lines) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
};
const tmp = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'baco-usage-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

const claudeLine = ({ id, model = 'modelo-forte', ts = '2026-03-10T12:00:00.000Z', input = 0, cw = 0, cr = 0, out = 0, side = false, req }) => ({
  type: 'assistant', isSidechain: side, timestamp: ts, requestId: req ?? `req-${id}`, sessionId: 'sessao-ficticia',
  message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'texto qualquer' }],
    usage: { input_tokens: input, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out } },
});

// Claude Code: the conductor session s1 (one response written on two lines, one synthetic, one
// outside the window, one broken line), its subagent, and a second conductor session s2.
function claudeFixture(base) {
  const proj = join(base, 'claude');
  put(join(proj, 's1.jsonl'), [
    { type: 'user', timestamp: '2026-03-10T11:59:00.000Z', message: { role: 'user', content: 'pedido' } },
    claudeLine({ id: 'msg-1', input: 10, cw: 100, cr: 1000, out: 5 }),
    claudeLine({ id: 'msg-1', input: 10, cw: 100, cr: 1000, out: 5 }),
    claudeLine({ id: 'msg-2', input: 2, cw: 50, cr: 2000, out: 20, ts: '2026-03-10T13:00:00.000Z' }),
    claudeLine({ id: 'msg-syn', model: '<synthetic>' }),
    claudeLine({ id: 'msg-old', input: 999, ts: '2026-03-09T08:00:00.000Z' }),
    '{linha quebrada',
  ]);
  put(join(proj, 's1', 'subagents', 'agent-x1.jsonl'), [
    claudeLine({ id: 'msg-4', model: 'modelo-medio', input: 3, cw: 10, cr: 100, out: 7, side: true }),
    claudeLine({ id: 'msg-4', model: 'modelo-medio', input: 3, cw: 10, cr: 100, out: 7, side: true }),
  ]);
  writeFileSync(join(proj, 's1', 'subagents', 'agent-x1.meta.json'), JSON.stringify({ agentType: 'baco:implementer-standard' }));
  put(join(proj, 's2.jsonl'), [claudeLine({ id: 'msg-5', input: 1, cw: 0, cr: 400, out: 9, ts: '2026-03-10T14:00:00.000Z' })]);
  return proj;
}

const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output });

// Codex: an exec session in the project (records with response ids, one repeated), an older
// interactive session with only token_count events (one repeated), and a session elsewhere.
function codexFixture(base, root) {
  const sessions = join(base, 'codex');
  const day = join(sessions, '2026', '03', '10');
  put(join(day, 'rollout-2026-03-10T12-00-00-aaaa.jsonl'), [
    { timestamp: '2026-03-10T12:00:00.000Z', type: 'session_meta', payload: { id: 'aaaa', cwd: root, source: 'exec' } },
    { timestamp: '2026-03-10T12:00:01.000Z', type: 'turn_context', payload: { model: 'modelo-codex' } },
    { timestamp: '2026-03-10T12:00:02.000Z', type: 'token_usage_record', payload: { response_id: 'resp-1', usage: usage(1000, 800, 50) } },
    { timestamp: '2026-03-10T12:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(1000, 800, 50), last_token_usage: usage(1000, 800, 50) } } },
    { timestamp: '2026-03-10T12:00:03.000Z', type: 'token_usage_record', payload: { response_id: 'resp-1', usage: usage(1000, 800, 50) } },
    { timestamp: '2026-03-10T12:00:04.000Z', type: 'token_usage_record', payload: { response_id: 'resp-2', usage: usage(3000, 2500, 70) } },
  ]);
  put(join(day, 'rollout-2026-03-10T12-30-00-bbbb.jsonl'), [
    { timestamp: '2026-03-10T12:30:00.000Z', type: 'session_meta', payload: { id: 'bbbb', cwd: join(root, 'sub'), source: 'vscode' } },
    { timestamp: '2026-03-10T12:30:01.000Z', type: 'turn_context', payload: { model: 'modelo-codex' } },
    { timestamp: '2026-03-10T12:30:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: null } },
    { timestamp: '2026-03-10T12:30:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(100, 0, 10), last_token_usage: usage(100, 0, 10) } } },
    { timestamp: '2026-03-10T12:30:04.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(100, 0, 10), last_token_usage: usage(100, 0, 10) } } },
    { timestamp: '2026-03-10T12:30:05.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(300, 150, 30), last_token_usage: usage(200, 150, 20) } } },
  ]);
  put(join(day, 'rollout-2026-03-10T12-40-00-cccc.jsonl'), [
    { timestamp: '2026-03-10T12:40:00.000Z', type: 'session_meta', payload: { id: 'cccc', cwd: '/outro/projeto', source: 'exec' } },
    { timestamp: '2026-03-10T12:40:02.000Z', type: 'token_usage_record', payload: { response_id: 'resp-9', usage: usage(5000, 0, 5) } },
  ]);
  return sessions;
}

const WINDOW = ['--since', '2026-03-10T00:00:00Z', '--until', '2026-03-11T00:00:00Z'];

test('measure: counts each response once, splits conductor and subagents, per harness and model', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# p\n' });
  const claude = claudeFixture(base);
  const codex = codexFixture(base, dir);
  const r = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', claude, '--codex-dir', codex, '--json');
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  const row = (h, m, w) => d.rows.find((x) => x.harness === h && x.model === m && x.who === w);
  // Conductor in Claude Code: msg-1 once, msg-2, msg-5 (s2); synthetic and old ones left out.
  const cc = row('claude-code', 'modelo-forte', 'condutor');
  assert.deepEqual({ ...cc }, { harness: 'claude-code', model: 'modelo-forte', who: 'condutor', responses: 3, input: 13, cacheRead: 3400, cacheWrite: 150, output: 34, total: 3597, maxContext: 2052 });
  const sub = row('claude-code', 'modelo-medio', 'baco:implementer-standard');
  assert.equal(sub.responses, 1);
  assert.equal(sub.total, 120);
  assert.equal(sub.maxContext, null);
  // Codex exec: resp-1 once and resp-2; input without the cached part.
  const ex = row('codex', 'modelo-codex', 'exec');
  assert.deepEqual([ex.responses, ex.input, ex.cacheRead, ex.output, ex.total], [2, 700, 3300, 120, 4120]);
  // A Codex session that is neither a role nor the conductor's harness is "avulsa", not a conductor;
  // the repeated token_count is skipped.
  assert.equal(row('codex', 'modelo-codex', 'condutor'), undefined);
  const ci = row('codex', 'modelo-codex', 'avulsa');
  assert.deepEqual([ci.responses, ci.input, ci.cacheRead, ci.output, ci.total, ci.maxContext], [2, 150, 150, 30, 330, null]);
  assert.ok(!d.rows.some((x) => x.total === 5005), 'session of another folder left out');
  assert.equal(d.total.total, 3597 + 120 + 4120 + 330);
  assert.equal(d.conductor.total, 3597);
  assert.equal(d.conductor.maxContext, 2052);
  assert.equal(d.subagents.total, 120 + 4120 + 330);
  assert.equal(d.conductorShare, Math.round((3597 / d.total.total) * 1000) / 1000);
  // Groups: the conductor's harness, its subagents, and each other harness on its own.
  assert.equal(d.conductorHarness, 'claude-code');
  const g = (kind, harness) => d.groups.find((x) => x.kind === kind && x.harness === harness);
  assert.deepEqual([g('conductor', 'claude-code').total, g('subagents', 'claude-code').total, g('harness', 'codex').total], [3597, 120, 4450]);
  assert.equal(d.groups.length, 3);
  assert.equal(d.byHarness.codex.total, 4450);
  assert.equal(d.byModel['modelo-medio'].total, 120);
  assert.equal(d.skippedLines, 1);
  assert.deepEqual([d.sources.claude.conductorFiles, d.sources.claude.subagentFiles, d.sources.codex.sessions], [2, 1, 2]);
  const h = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', claude, '--codex-dir', codex);
  assert.match(h.stdout, /\| claude-code \| modelo-forte \| condutor \| 3 \|/);
  assert.match(h.stdout, /Condutor: 3597 tokens/);
  assert.match(h.stdout, /\| Condutor \(Claude\) \| 3 \| 3597 \|/);
  assert.match(h.stdout, /\| Subagentes \(Claude\) \| 1 \| 120 \|/);
  assert.match(h.stdout, /\| Codex \| 4 \| 4450 \|/);
  assert.match(h.stdout, /1 linha/);
  // The closing line separates Claude subagents from Codex instead of summing them.
  assert.match(h.stdout, /Subagentes \(Claude\): 120 tokens\. Codex: 4450 tokens\./);
  assert.equal(d.subagents.total, 120 + 4120 + 330);
});

test('measure: a Codex main session counts as the conductor only when Codex is the conductor harness', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const codex = codexFixture(base, dir);
  const none = join(base, 'sem-claude');
  mkdirSync(none);
  const r = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', none, '--codex-dir', codex, '--conductor-harness', 'codex', '--json');
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.conductorHarness, 'codex');
  assert.deepEqual(d.rows.map((x) => x.who).sort(), ['condutor', 'exec']);
  assert.equal(d.conductor.total, 330);
  assert.equal(d.groups.find((x) => x.kind === 'conductor').harness, 'codex');
  assert.equal(d.groups.find((x) => x.kind === 'subagents').total, 4120);
});

// A conductor conversation that hands off to a new one: both overlap at the start of the window.
test('measure: the largest context of the window comes from the conversation that owns the window, per session', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const proj = join(base, 'claude');
  const old = [];
  for (let i = 0; i < 8; i++) old.push(claudeLine({ id: `old-${i}`, cr: 900000, ts: `2026-03-09T1${i}:00:00.000Z` }));
  old.push(claudeLine({ id: 'old-in-1', cr: 800000, ts: '2026-03-10T00:05:00.000Z' }));
  old.push(claudeLine({ id: 'old-in-2', cr: 810000, ts: '2026-03-10T00:10:00.000Z' }));
  put(join(proj, 'velha.jsonl'), old);
  put(join(proj, 'nova.jsonl'), [1, 2, 3, 4].map((i) => claudeLine({ id: `new-${i}`, cr: 100000 * i, ts: `2026-03-10T0${i}:00:00.000Z` })));
  const r = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', proj, '--no-codex', '--json');
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  // Tokens of both conversations in the window are real spend and stay in the total.
  assert.equal(d.conductor.total, 800000 + 810000 + 100000 + 200000 + 300000 + 400000);
  // The stage's largest context ignores the conversation that was ending.
  assert.equal(d.conductor.maxContext, 400000);
  assert.equal(d.rows.find((x) => x.who === 'condutor').maxContext, 400000);
  assert.deepEqual(d.sessions, [], 'sessions stays the list of chosen session ids');
  assert.equal(d.conductorSessions.length, 2);
  const [a, b] = d.conductorSessions;
  assert.deepEqual([a.label, a.responses, a.totalResponses, a.owner, a.maxContext], ['condutor-1', 2, 10, false, 810000]);
  assert.deepEqual([b.label, b.responses, b.totalResponses, b.owner, b.maxContext], ['condutor-2', 4, 4, true, 400000]);
  assert.ok(!JSON.stringify(d.conductorSessions).includes('velha') && !JSON.stringify(d.conductorSessions).includes('nova'), 'no session id leaves');
  const h = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', proj, '--no-codex');
  assert.match(h.stdout, /condutor-1 .*2 de 10/);
  assert.match(h.stdout, /maior contexto numa resposta: 400000 tokens/);
});

test('measure: with no session mostly inside the window, the one with the most responses inside gives the context', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const proj = join(base, 'claude');
  put(join(proj, 'a.jsonl'), [claudeLine({ id: 'a1', cr: 500, ts: '2026-03-10T01:00:00.000Z' }), claudeLine({ id: 'a2', ts: '2026-03-09T01:00:00.000Z' }), claudeLine({ id: 'a3', ts: '2026-03-09T02:00:00.000Z' })]);
  put(join(proj, 'b.jsonl'), [1, 2].map((i) => claudeLine({ id: `b${i}`, cr: 700, ts: `2026-03-10T0${i}:00:00.000Z` })).concat([3, 4, 5, 6].map((i) => claudeLine({ id: `b${i}`, ts: `2026-03-09T0${i}:00:00.000Z` }))));
  const d = JSON.parse((await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', proj, '--no-codex', '--json')).stdout);
  assert.equal(d.conductorSessions.filter((s) => s.owner).length, 1);
  assert.equal(d.conductor.maxContext, 700);
});

test('measure: --session keeps only the named sessions, Claude or Codex', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const claude = claudeFixture(base);
  const codex = codexFixture(base, dir);
  const r = await call(dir, 'cost', 'measure', '--session', 's2', '--session', 'aaaa', '--claude-dir', claude, '--codex-dir', codex, '--json');
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.conductor.total, 410);
  assert.equal(d.subagents.total, 4120);
  assert.deepEqual(d.rows.map((x) => x.who).sort(), ['condutor', 'exec']);
  // Review: the chosen ids keep their field; the per-session breakdown has its own.
  assert.deepEqual(d.sessions, ['s2', 'aaaa']);
  assert.ok(Array.isArray(d.conductorSessions) && d.conductorSessions.every((s) => typeof s === 'object' && s.label));
});

test('measure: without a window or sessions, and outside a delivery, it asks for them', async (t) => {
  const dir = await makeRepo({});
  const r = await call(dir, 'cost', 'measure', '--claude-dir', tmp(t));
  assert.equal(r.code, 64);
  assert.match(r.stderr, /--since/);
  assert.equal((await call(dir, 'cost', 'measure', '--since', 'ontem', '--claude-dir', tmp(t))).code, 64);
  const missing = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', join(tmp(t), 'nada'), '--no-codex');
  assert.equal(missing.code, 65);
  assert.match(missing.stderr, /nada/);
  const none = await call(dir, 'cost', 'measure', ...WINDOW, '--claude-dir', tmp(t), '--no-codex');
  assert.equal(none.code, 1);
  assert.match(none.stdout, /Nenhuma resposta/);
});

test('measure: default folders come from CLAUDE_CONFIG_DIR and CODEX_HOME and the project path', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const claudeHome = join(base, 'home-claude');
  const proj = join(claudeHome, 'projects', encodeProjectDir(dir));
  put(join(proj, 'sx.jsonl'), [claudeLine({ id: 'msg-a', input: 1, out: 1 })]);
  const codexHome = join(base, 'home-codex');
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  const old = { c: process.env.CLAUDE_CONFIG_DIR, x: process.env.CODEX_HOME };
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  process.env.CODEX_HOME = codexHome;
  t.after(() => {
    for (const [k, v] of [['CLAUDE_CONFIG_DIR', old.c], ['CODEX_HOME', old.x]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  assert.equal(encodeProjectDir('/a/b.c/d_e'), '-a-b-c-d-e');
  const d = JSON.parse((await call(dir, 'cost', 'measure', ...WINDOW, '--json')).stdout);
  assert.equal(d.total.total, 2);
  assert.equal(d.sources.codex.sessions, 0);
});

test('measure ENT --write: window from the plan start, section replaced on a new run, ledger rows still go above it', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({ [`${ENT}/plano.md`]: '# Plano\n\n**Specs:** docs/specs/s.md@1.0\n**Base:** abc1234\n**Início:** 2026-03-10 00:00\n' });
  const claude = claudeFixture(base);
  const w = await call(dir, 'cost', 'measure', 'ENT-001', '--until', '2026-03-11T00:00:00Z', '--claude-dir', claude, '--no-codex', '--write');
  assert.equal(w.code, 0, w.stderr);
  const file = join(dir, ENT, 'custo.md');
  let md = readFileSync(file, 'utf8');
  assert.match(md, /^# Custo \| ENT-001\n/);
  assert.match(md, /## Medido nas transcrições/);
  assert.match(md, /\| entrega \| 2026-03-10 00:00 a \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| claude-code \| modelo-forte \| condutor \| 3 \| 13 \| 3400 \| 150 \| 34 \| 3597 \| 2052 \|/);
  assert.ok(!/s1|s2|msg-|texto qualquer|sessao-ficticia/.test(md), 'no transcript content or ids in the file');
  // A cost row added later goes into the ledger table, above the measured section.
  assert.equal((await call(dir, 'cost', 'add', 'ENT-001', '--phase', '6', '--agent', 'impl', '--model', 'm', '--effort', 'e', '--harness', 'codex')).code, 0);
  md = readFileSync(file, 'utf8');
  assert.ok(md.indexOf('| 6 | impl |') < md.indexOf('## Medido'), 'ledger row above the measured section');
  // Measuring again replaces the rows of the same stage.
  assert.equal((await call(dir, 'cost', 'measure', 'ENT-001', '--until', '2026-03-11T00:00:00Z', '--claude-dir', claude, '--no-codex', '--write')).code, 0);
  md = readFileSync(file, 'utf8');
  assert.equal(md.match(/\| entrega \|/g).length, 2);
  const s = JSON.parse((await call(dir, 'cost', 'summary', 'ENT-001', '--json')).stdout);
  assert.equal(s.total.runs, 1);
  assert.equal(s.measured.total.total, 3717);
  assert.equal(s.measured.conductor.total, 3597);
  assert.equal(s.measured.conductor.maxContext, 2052);
  const h = await call(dir, 'cost', 'summary', 'ENT-001');
  assert.match(h.stdout, /Medido nas transcrições: 3717 tokens/);
});

test('measure ENT without the plan start line: the window starts at the first commit of the delivery folder', async (t) => {
  const dir = await makeRepo({});
  commit(dir, { [`${ENT}/plano.md`]: '# p\n' }, 'plan');
  const r = await call(dir, 'cost', 'measure', 'ENT-001', '--claude-dir', tmp(t), '--no-codex', '--json');
  assert.equal(r.code, 1);
  const d = JSON.parse(r.stdout);
  assert.ok(Date.parse(d.since) <= Date.now() && Date.parse(d.since) > Date.now() - 600000, d.since);
});

test('measure --write without a delivery: project file, label required, rows kept per stage', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const claude = claudeFixture(base);
  const args = ['cost', 'measure', ...WINDOW, '--claude-dir', claude, '--no-codex', '--write'];
  assert.equal((await call(dir, ...args)).code, 64);
  assert.equal((await call(dir, ...args, '--label', 'fase 2, spec de pedidos 1.0')).code, 0);
  assert.equal((await call(dir, ...args, '--label', 'fase 3')).code, 0);
  const md = readFileSync(join(dir, 'docs', 'custo-projeto.md'), 'utf8');
  assert.match(md, /^# Custo do projeto\n/);
  assert.match(md, /\| fase 2, spec de pedidos 1\.0 \|/);
  assert.match(md, /\| fase 3 \|/);
  const s = JSON.parse((await call(dir, 'cost', 'summary', '--project', '--json')).stdout);
  assert.equal(s.measured.byLabel['fase 3'].total, 3717);
  assert.equal(s.measured.total.total, 2 * 3717);
});

test('summary with no delivery: the whole project, stages outside the deliveries plus each delivery', async (t) => {
  const dir = await makeRepo({});
  const args = ['cost', 'measure', ...WINDOW, '--claude-dir', claudeFixture(tmp(t)), '--no-codex', '--write', '--label', 'fase 3'];
  assert.equal((await call(dir, ...args)).code, 0);
  const rows = [{ harness: 'claude-code', model: 'm', who: 'condutor', responses: 2, input: 1, cacheRead: 2, cacheWrite: 3, output: 4, total: 100, maxContext: 60 },
    { harness: 'codex', model: 'x', who: 'exec', responses: 1, input: 30, cacheRead: 0, cacheWrite: 0, output: 0, total: 300, maxContext: null }];
  const ledger = appendCost(null, { ent: 'ENT-001', timestamp: 't', phase: '6', agent: 'a', model: 'm', effort: 'e' });
  put(join(dir, ENT, 'custo.md'), [writeMeasured(ledger, { label: 'entrega', window: 'a a b', rows })]);
  const r = await call(dir, 'cost', 'summary');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\| fase 3 \|/);
  assert.match(r.stdout, /\| ENT-001 \| 3 \| 400 \| 100 \|/);
  const s = JSON.parse((await call(dir, 'cost', 'summary', '--json')).stdout);
  assert.equal(s.measured.total.total, 3717 + 400);
  assert.deepEqual(Object.keys(s.bySource), ['fase 3', 'ENT-001']);
});

test('writeMeasured and summarizeMeasured on text; appendCost keeps a ledger written before them', () => {
  const ledger = appendCost(null, { ent: 'ENT-001', timestamp: 't', phase: '6', agent: 'a', model: 'm', effort: 'e' });
  const rows = [{ harness: 'claude-code', model: 'm', who: 'condutor', responses: 1, input: 1, cacheRead: 2, cacheWrite: 3, output: 4, total: 10, maxContext: 6 },
    { harness: 'codex', model: 'x', who: 'exec', responses: 1, input: 30, cacheRead: 0, cacheWrite: 0, output: 0, total: 30, maxContext: null }];
  const md = writeMeasured(ledger, { label: 'entrega', window: 'a a b', rows });
  assert.ok(md.startsWith(ledger));
  const s = summarizeMeasured(md);
  assert.equal(s.total.total, 40);
  assert.equal(s.conductorShare, 0.25);
  assert.equal(s.byHarness.codex.total, 30);
  assert.equal(summarizeMeasured(ledger), null);
  const again = appendCost(md, { ent: 'ENT-001', timestamp: 't2', phase: '7', agent: 'b', model: 'm', effort: 'e' });
  assert.ok(again.indexOf('| t2 |') < again.indexOf('## Medido'));
});

// Review: older measurements wrote interactive Codex sessions as `condutor` too; each keeps its harness.
test('summarizeMeasured on a table written before avulsa: each conductor row keeps its harness group', () => {
  const md = [
    '# Custo | ENT-001', '', '## Medido nas transcrições', '',
    '| Etapa | Janela | Harness | Modelo | Quem | Respostas | Entrada | Cache lido | Cache gravado | Saída | Total | Maior contexto |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    '| entrega | a a b | claude-code | m | condutor | 1 | 100 | 0 | 0 | 0 | 100 | 90 |',
    '| entrega | a a b | codex | x | condutor | 2 | 200 | 0 | 0 | 0 | 200 | 150 |',
    '| entrega | a a b | claude-code | m | baco:task-reviewer | 1 | 40 | 0 | 0 | 0 | 40 | - |',
    '',
  ].join('\n');
  const s = summarizeMeasured(md);
  const g = s.groups.map((x) => [x.kind, x.harness, x.total, x.maxContext ?? null]);
  assert.deepEqual(g, [['conductor', 'claude-code', 100, 90], ['conductor', 'codex', 200, 150], ['subagents', 'claude-code', 40, null]]);
  assert.equal(s.conductor.total, 300);
  assert.equal(s.total.total, 340);
});

const SINCE = Date.parse('2026-03-10T00:00:00Z');
const UNTIL = Date.parse('2026-03-11T00:00:00Z');
const codexSession = (base, cwd, lines) => {
  const dir = join(base, 'codex');
  put(join(dir, '2026', '03', '10', 'rollout-2026-03-10T12-00-00-dddd.jsonl'), [
    { timestamp: '2026-03-10T12:00:00.000Z', type: 'session_meta', payload: { id: 'dddd', cwd, source: 'vscode' } },
    { timestamp: '2026-03-10T12:00:01.000Z', type: 'turn_context', payload: { model: 'modelo-codex' } },
    ...lines,
  ]);
  return dir;
};
const tc = (ts, total, last) => ({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } });
const rec = (ts, id, u) => ({ timestamp: ts, type: 'token_usage_record', payload: { response_id: id, usage: u } });

test('usage: a response written again with updated usage counts its largest numbers, once', (t) => {
  const base = tmp(t);
  const proj = join(base, 'claude');
  put(join(proj, 's1.jsonl'), [
    claudeLine({ id: 'msg-1', input: 100, out: 1 }),
    claudeLine({ id: 'msg-1', input: 100, out: 50 }),
    claudeLine({ id: 'msg-1', input: 100, out: 7 }),
  ]);
  const codex = codexSession(base, '/proj', [
    rec('2026-03-10T12:00:02.000Z', 'resp-1', usage(1000, 0, 10)),
    rec('2026-03-10T12:00:03.000Z', 'resp-1', usage(1000, 0, 30)),
  ]);
  const d = measureUsage({ claudeDirs: [proj], codexDir: codex, since: SINCE, until: UNTIL, sessions: null, roots: ['/proj'] });
  assert.equal(d.byHarness['claude-code'].total, 150);
  assert.equal(d.byHarness['claude-code'].responses, 1);
  assert.equal(d.byHarness.codex.total, 1030);
  assert.equal(d.byHarness.codex.responses, 1);
});

test('usage: a Codex file with older token_count events and newer records counts both parts, each response once', (t) => {
  for (const twinBefore of [false, true]) {
    const base = tmp(t);
    const lines = [tc('2026-03-10T12:00:02.000Z', usage(100, 0, 10), usage(100, 0, 10))];
    const twin = tc('2026-03-10T12:00:05.000Z', usage(300, 0, 30), usage(200, 0, 20));
    if (twinBefore) lines.push(twin);
    lines.push(rec('2026-03-10T12:00:05.000Z', 'resp-2', usage(200, 0, 20)));
    if (!twinBefore) lines.push(twin);
    lines.push(rec('2026-03-10T12:00:06.000Z', 'resp-3', usage(400, 0, 40)), tc('2026-03-10T12:00:06.000Z', usage(700, 0, 70), usage(400, 0, 40)));
    const d = measureUsage({ claudeDirs: [], codexDir: codexSession(base, '/proj', lines), since: SINCE, until: UNTIL, sessions: null, roots: ['/proj'] });
    assert.deepEqual([d.total.responses, d.total.total], [3, 110 + 220 + 440], `twin before: ${twinBefore}`);
  }
});

test('usage: mixed Codex file, equal usage is not the same response across a new turn; a repeated legacy event is not counted twice', (t) => {
  const turn = { timestamp: '2026-03-10T12:00:03.000Z', type: 'turn_context', payload: { model: 'modelo-codex' } };
  const distinct = measureUsage({ claudeDirs: [], codexDir: codexSession(tmp(t), '/proj', [
    tc('2026-03-10T12:00:02.000Z', usage(100, 0, 10), usage(100, 0, 10)), turn,
    rec('2026-03-10T12:00:04.000Z', 'resp-2', usage(100, 0, 10)),
  ]), since: SINCE, until: UNTIL, sessions: null, roots: ['/proj'] });
  assert.deepEqual([distinct.total.responses, distinct.total.total], [2, 220]);
  const repeated = measureUsage({ claudeDirs: [], codexDir: codexSession(tmp(t), '/proj', [
    tc('2026-03-10T12:00:02.000Z', usage(100, 0, 10), usage(100, 0, 10)),
    tc('2026-03-10T12:00:05.000Z', usage(300, 0, 30), usage(200, 0, 20)),
    tc('2026-03-10T12:00:05.000Z', usage(300, 0, 30), usage(200, 0, 20)),
    rec('2026-03-10T12:00:05.000Z', 'resp-2', usage(200, 0, 20)),
  ]), since: SINCE, until: UNTIL, sessions: null, roots: ['/proj'] });
  assert.deepEqual([repeated.total.responses, repeated.total.total], [2, 330]);
});

test('usage: Codex sessions inside the project, Windows or POSIX paths, with directory boundaries', (t) => {
  assert.equal(insideRoot('C:\\repo\\sub', 'C:\\repo'), true);
  assert.equal(insideRoot('C:\\repo\\sub', 'C:/repo'), true);
  assert.equal(insideRoot('c:\\Repo', 'C:\\repo\\'), true);
  assert.equal(insideRoot('C:\\repo2', 'C:\\repo'), false);
  assert.equal(insideRoot('C:\\repo-x\\a', 'C:/repo'), false);
  assert.equal(insideRoot('D:\\repo\\sub', 'C:\\repo'), false);
  assert.equal(insideRoot('/a/b', '/a'), true);
  assert.equal(insideRoot('/a/b', '/a/'), true);
  assert.equal(insideRoot('/ab', '/a'), false);
  assert.equal(insideRoot('/A/b', '/a'), false);
  const base = tmp(t);
  const codex = codexSession(base, 'C:\\repo\\sub', [rec('2026-03-10T12:00:02.000Z', 'resp-1', usage(10, 0, 1))]);
  assert.equal(measureUsage({ claudeDirs: [], codexDir: codex, since: SINCE, until: UNTIL, sessions: null, roots: ['C:/repo'] }).total.total, 11);
  assert.equal(measureUsage({ claudeDirs: [], codexDir: codex, since: SINCE, until: UNTIL, sessions: null, roots: ['C:/re'] }).total.total, 0);
});

test('measure: without --until the window ends now, and data.until says so', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({});
  const proj = join(base, 'claude');
  put(join(proj, 's1.jsonl'), [claudeLine({ id: 'msg-1', input: 1, out: 1 }), claudeLine({ id: 'msg-2', input: 500, ts: '2099-01-01T00:00:00.000Z' })]);
  const before = Date.now();
  const d = JSON.parse((await call(dir, 'cost', 'measure', '--since', '2026-03-10T00:00:00Z', '--claude-dir', proj, '--no-codex', '--json')).stdout);
  assert.equal(d.total.total, 2);
  assert.ok(Date.parse(d.until) >= before - 1000 && Date.parse(d.until) <= Date.now() + 1000, d.until);
});

test('parseTime: rejects dates and times that do not exist', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-03-10 24:00', '2026-03-10 12:60', '2026-03-10 12:00:60', '2026-02-30T10:00Z', '2026-03-10T24:00Z', '2026-03-10T12:60:00+00:00', '2026-03-10T12:00+24:00']) {
    assert.equal(parseTime(bad), null, bad);
  }
  assert.equal(parseTime('2026-03-10T23:59:59Z'), Date.parse('2026-03-10T23:59:59Z'));
  assert.equal(parseTime('2026-03-10T12:00-03:00'), Date.parse('2026-03-10T15:00:00Z'));
  assert.equal(parseTime('2028-02-29 23:59'), new Date(2028, 1, 29, 23, 59).getTime());
});

test('measure: transcripts of removed worktrees are still found (recorded folders and .worktrees/<TASK>)', async (t) => {
  const base = tmp(t);
  const dir = await makeRepo({ '.gitignore': '.baco/logs/\n.worktrees/\n' });
  const gitc = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  const ext = join(tmp(t), 'wt-ext');
  gitc('worktree', 'add', '-q', '-b', 'baco/ENT-001-T-001', ext);
  const claudeHome = join(base, 'home-claude');
  put(join(claudeHome, 'projects', encodeProjectDir(ext), 'sa.jsonl'), [claudeLine({ id: 'msg-ext', input: 5, out: 5 })]);
  const old = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
  t.after(() => { if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old; });
  const measured = async () => JSON.parse((await call(dir, 'cost', 'measure', ...WINDOW, '--no-codex', '--json')).stdout).total.total;
  assert.equal(await measured(), 10);
  assert.equal(gitc('status', '--porcelain'), '', 'the record of the folders is git-ignored');
  // A task worktree under .worktrees/ never measured while it existed.
  const inner = join(dir, '.worktrees', 'T-002');
  gitc('worktree', 'add', '-q', '-b', 'baco/ENT-001-T-002', inner);
  put(join(claudeHome, 'projects', encodeProjectDir(inner), 'sb.jsonl'), [claudeLine({ id: 'msg-in', input: 7, out: 7 })]);
  gitc('worktree', 'remove', ext);
  gitc('worktree', 'remove', inner);
  assert.equal(await measured(), 24);
});
