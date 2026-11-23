import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { mergeDecision, renderAcceptance, openItems, extractWriterText, pendingItems } from '../skills/baco-sdd/scripts/commands/acceptance-report.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';
import { execFileSync } from 'node:child_process';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const ENT = 'docs/entregas/ENT-001-a';
const sc = (id, result, automation = 'automatizado', via = 'qa') => ({ id, via, automation, result });
const ca = (id, status, scenarios) => ({ ca: id, status, scenarios });
const trace = (cas) => ({ cas, orphanTests: [], summary: {} });
const provenTrace = () => trace([ca('CA-001', 'proven', [sc('CT-001', 'passed')]), ca('CA-002', 'proven', [sc('CT-002', 'manual_ok', 'manual')])]);
const manualTrace = () => trace([ca('CA-001', 'proven', [sc('CT-001', 'passed')]), ca('CA-EMP-003', 'pending', [sc('CT-EMP-003', 'manual_pending', 'manual')])]);
const ok = { verdict: 'aprovado', findings: [] };

test('invalid rule values fail safe to block', () => {
  for (const rule of ['blok', undefined, null, 5, {}, 'BLOCK']) {
    const d = mergeDecision({ trace: manualTrace(), verdict: ok, rule });
    assert.equal(d.allowed, false, String(rule));
    assert.deepEqual(d.blockers, ['merge.manual_pending']);
  }
});

test('all proven + aprovado is allowed', () => {
  assert.deepEqual(mergeDecision({ trace: provenTrace(), verdict: ok, rule: 'block' }), { allowed: true, blockers: [], warnings: [] });
});

test('manual pending: block on main, warn on develop, ignore silently', () => {
  const b = mergeDecision({ trace: manualTrace(), verdict: ok, rule: 'block' });
  assert.equal(b.allowed, false);
  assert.deepEqual(b.blockers, ['merge.manual_pending']);
  const w = mergeDecision({ trace: manualTrace(), verdict: ok, rule: 'warn' });
  assert.equal(w.allowed, true);
  assert.deepEqual(w.warnings, ['merge.manual_pending']);
  assert.deepEqual(mergeDecision({ trace: manualTrace(), verdict: ok, rule: 'ignore' }), { allowed: true, blockers: [], warnings: [] });
});

test('not_run is treated like manual pending per rule; failed/uncovered always block', () => {
  const t = trace([ca('CA-001', 'pending', [sc('CT-001', 'not_run')])]);
  assert.deepEqual(mergeDecision({ trace: t, verdict: ok, rule: 'block' }).blockers, ['merge.not_run']);
  assert.equal(mergeDecision({ trace: t, verdict: ok, rule: 'warn' }).allowed, true);
  const f = trace([ca('CA-001', 'failed', [sc('CT-001', 'failed')]), ca('CA-002', 'uncovered', [])]);
  const d = mergeDecision({ trace: f, verdict: ok, rule: 'ignore' });
  assert.equal(d.allowed, false);
  assert.deepEqual(d.blockers, ['merge.failed', 'merge.uncovered']);
});

test('verdict missing or not aprovado blocks on any rule', () => {
  for (const rule of ['block', 'warn', 'ignore']) {
    const a = mergeDecision({ trace: provenTrace(), verdict: { verdict: 'ajustes', findings: [] }, rule });
    assert.equal(a.allowed, false);
    assert.deepEqual(a.blockers, ['merge.verdict_not_approved']);
    const m = mergeDecision({ trace: provenTrace(), verdict: null, rule });
    assert.equal(m.allowed, false);
    assert.deepEqual(m.blockers, ['merge.no_verdict']);
  }
});

test('a pending criterion never merges silently (no empty or unknown traces either)', () => {
  const odd = trace([ca('CA-001', 'pending', [sc('CT-001', 'skipped')])]);
  assert.equal(mergeDecision({ trace: odd, verdict: ok, rule: 'block' }).allowed, false);
  assert.equal(mergeDecision({ trace: odd, verdict: ok, rule: 'warn' }).warnings.length, 1);
  assert.equal(mergeDecision({ trace: trace([]), verdict: ok, rule: 'ignore' }).allowed, false);
  assert.equal(mergeDecision({ trace: trace([ca('CA-001', 'weird', [])]), verdict: ok, rule: 'ignore' }).allowed, false);
});

test('render: failed mark, manual checklist, plain language', () => {
  const t = trace([ca('CA-001', 'failed', [sc('CT-001', 'failed')]), ca('CA-002', 'uncovered', []), ca('CA-EMP-003', 'pending', [sc('CT-EMP-003', 'manual_pending', 'manual')])]);
  const decision = mergeDecision({ trace: t, verdict: { verdict: 'ajustes', findings: [{ severity: 'crítico', location: null, text: 'x' }] }, rule: 'block' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t, verdict: { verdict: 'ajustes', findings: [{ severity: 'crítico', location: null, text: 'x' }] }, decision, lang: 'pt-BR' });
  assert.match(md, /❌/);
  assert.match(md, /sem teste/);
  assert.match(md, /- \[ \] CT-EMP-003/);
  assert.match(md, /não pode integrar ainda/i);
  assert.match(md, /<!-- preencher: redator -->/);
  for (const h of ['Resumo para decisão', 'Critérios de aceite', 'Testes manuais', 'Revisão externa', 'Riscos e pendências', 'O que muda para o usuário']) assert.match(md, new RegExp(`## ${h}`));
  assert.match(md, /ajustes/);
  assert.match(md, /críticos: 1/);
  assert.doesNotMatch(md, /trace|JUnit/i);
});

test('render: titles from qa, warn lists pending, no verdict wording', () => {
  const decision = mergeDecision({ trace: manualTrace(), verdict: null, rule: 'warn' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'develop', trace: manualTrace(), verdict: null, decision, lang: 'pt-BR', titles: new Map([['CT-EMP-003', 'Cadastrar empresa']]) });
  assert.match(md, /- \[ \] CT-EMP-003: Cadastrar empresa/);
  assert.match(md, /Ainda não houve revisão externa/);
  const ok2 = mergeDecision({ trace: manualTrace(), verdict: ok, rule: 'warn' });
  const md2 = renderAcceptance({ entId: 'ENT-001', target: 'develop', trace: manualTrace(), verdict: ok, decision: ok2, lang: 'pt-BR' });
  assert.match(md2, /pode integrar/i);
  assert.doesNotMatch(md2, /não pode integrar/i);
  assert.match(md2, /CT-EMP-003/);
});

// 1.10.0: specialist scenarios never count as manual pending; they warn, never block, in their own section.
const specialistSc = (id, kind) => ({ ...sc(id, 'manual_pending', 'manual'), specialist: true, ...(kind ? { specialistKind: kind } : {}) });
const specialistTrace = () => ({
  ...trace([ca('CA-001', 'proven', [sc('CT-001', 'passed')]), ca('CA-002', 'pending', [specialistSc('CT-002', 'leitor de tela')])]),
  otherScenarios: [{ ...specialistSc('CT-009'), contracts: ['RN-001'] }],
});

const KINDS = ['Leitor de tela'];
test('specialist scenarios: never merge.manual_pending, only the non-blocking warning merge.specialist_pending, on any rule', () => {
  for (const rule of ['block', 'warn', 'ignore', 'blok']) {
    const d = mergeDecision({ trace: specialistTrace(), verdict: ok, rule, specialist: KINDS });
    assert.deepEqual(d, { allowed: true, blockers: [], warnings: ['merge.specialist_pending'] }, rule);
  }
  const mixed = trace([ca('CA-001', 'pending', [specialistSc('CT-002'), sc('CT-003', 'manual_pending', 'manual')])]);
  assert.deepEqual(mergeDecision({ trace: mixed, verdict: ok, rule: 'block', specialist: KINDS }).blockers, ['merge.manual_pending']);
  assert.deepEqual(mergeDecision({ trace: mixed, verdict: ok, rule: 'block', specialist: KINDS }).warnings, ['merge.specialist_pending']);
  // A specialist scenario that was run counts like any other result.
  const run = trace([ca('CA-001', 'proven', [{ ...specialistSc('CT-002'), result: 'manual_ok' }])]);
  assert.deepEqual(mergeDecision({ trace: run, verdict: ok, rule: 'block', specialist: KINDS }), { allowed: true, blockers: [], warnings: [] });
});

test('specialist flags of a trace count only for a configured kind; otherwise an ordinary manual scenario', () => {
  const ids = (t0, kinds) => pendingItems(t0, kinds);
  // No kind configured (default): the flags do not count.
  assert.deepEqual(ids(specialistTrace()), { manual: ['CT-002', 'CT-009'], auto: [], specialist: [] });
  assert.deepEqual(mergeDecision({ trace: specialistTrace(), verdict: ok, rule: 'block' }).blockers, ['merge.manual_pending']);
  // Another kind: CT-002 is ordinary; CT-009 (no kind) means the only configured kind.
  assert.deepEqual(ids(specialistTrace(), ['contraste de cor']), { manual: ['CT-002'], auto: [], specialist: [{ id: 'CT-009', kind: 'contraste de cor' }] });
  // Two kinds: a flag without a kind is ordinary; the kind is matched folded (case and accents).
  assert.deepEqual(ids(specialistTrace(), ['LEITOR DE TÉLA', 'contraste de cor']), { manual: ['CT-009'], auto: [], specialist: [{ id: 'CT-002', kind: 'LEITOR DE TÉLA' }] });
});

test('render: specialist scenarios get their own section, out of the manual checklist, the summary and the risks', () => {
  const t0 = specialistTrace();
  const d = mergeDecision({ trace: t0, verdict: ok, rule: 'warn', specialist: KINDS });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t0, verdict: ok, decision: d, lang: 'pt-BR', titles: new Map([['CT-002', 'Ler o formulário em voz alta']]), specialist: KINDS });
  assert.match(md, /## Fica com QA especialista\n\n[^\n]*\n\n- CT-002: Ler o formulário em voz alta \(Leitor de tela\)\n- CT-009 \(Leitor de tela\)\n/);
  assert.match(md, /\| CA-002 \| ⏳/, 'the CA of a specialist scenario stays pending');
  assert.match(md, /Nenhum teste manual pendente/);
  assert.doesNotMatch(md, /- \[ \] CT-002/);
  const risks = md.slice(md.indexOf('## Riscos'), md.indexOf('## Agentes'));
  assert.doesNotMatch(risks, /CT-002|CT-009/);
  const summary = md.slice(md.indexOf('## Resumo'), md.indexOf('## Critérios'));
  assert.doesNotMatch(summary, /CT-002|CT-009/);
  const none = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: provenTrace(), verdict: ok, decision: mergeDecision({ trace: provenTrace(), verdict: ok, rule: 'block' }), lang: 'en' });
  assert.doesNotMatch(none, /specialist/i);
  const en = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t0, verdict: ok, decision: d, lang: 'en', specialist: KINDS });
  assert.match(en, /## Left for specialist QA/);
});

test('command: a specialist scenario on main exits 0 with the merge.specialist_pending warning naming it', async () => {
  const tr = stamp(specialistTrace());
  const dir = await setup({ '.baco/config.yaml': 'qa:\n  specialist: [leitor de tela]\n', 'trace-spec.json': JSON.stringify(tr), [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  const c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-spec.json', '--cwd', dir, '--json'], c.io), 0);
  assert.deepEqual(JSON.parse(c.out.stdout).warnings, ['merge.specialist_pending']);
  const text = capture();
  await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-spec.json', '--cwd', dir], text.io);
  assert.match(text.out.stdout + text.out.stderr, /QA especialista.*CT-002, CT-009/s);
  // Without the kind in the config, the same flags are ordinary manual scenarios: main is blocked.
  const plain = await setup({ 'trace-spec.json': JSON.stringify(tr), [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  const p = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-spec.json', '--cwd', plain, '--json'], p.io), 2);
  assert.deepEqual(JSON.parse(p.out.stdout).blockers, ['merge.manual_pending']);
});

// Traces and verdicts carry provenance (R19): they must name the current HEAD and this delivery.
// '@HEAD@' is replaced by the repo HEAD after the initial commit (files are rewritten in place,
// which leaves HEAD unchanged).
const PLAN_SPEC = 'docs/specs/x.md';
const stamp = (tr, extra = {}) => ({ head: '@HEAD@', spec: { path: PLAN_SPEC, version: '1.0' }, delivery: 'ENT-001', ...tr, ...extra });
const setup = async (extra = {}) => {
  const files = {
    [`${ENT}/plano.md`]: `# Plano\n\n**Specs:** ${PLAN_SPEC}@1.0\n`,
    'trace-manual.json': JSON.stringify(stamp(manualTrace())),
    'trace-ok.json': JSON.stringify(stamp(provenTrace())),
    'trace-bad.json': '{nope',
    'qa.md': '# QA\n\n### CT-EMP-003 | Cadastrar empresa\n\n- **Contratos:** CA-EMP-003\n- **Automação:** manual\n',
    ...extra,
  };
  const dir = await makeRepo(files);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  for (const [rel, content] of Object.entries(files)) {
    if (typeof content === 'string' && content.includes('@HEAD@')) writeFileSync(join(dir, rel), content.replaceAll('@HEAD@', head));
  }
  return dir;
};
const verdictFile = (v, reviewedHead = '@HEAD@') => `VEREDITO: ${v}\n\n<!-- baco:parsed ${JSON.stringify({ verdict: v, findings: [], handoff: 'handoff-01.md', reviewedHead }).replace(/--/g, '-\\u002d')} -->\n`;

test('command: exit 2 on main with manual pending, 0 on develop; writes aceite.md', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('ajustes'), [`${ENT}/revisao/veredito-02.md`]: verdictFile('aprovado') });
  let c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-manual.json', '--qa', 'qa.md', '--cwd', dir], c.io), 2);
  const md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  assert.match(md, /- \[ \] CT-EMP-003: Cadastrar empresa/);
  assert.match(md, /não pode integrar ainda/i);
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-manual.json', '--cwd', dir, '--json'], c.io), 0);
  const data = JSON.parse(c.out.stdout);
  assert.equal(data.allowed, true);
  assert.deepEqual(data.warnings, ['merge.manual_pending']);
});

test('command: last verdict by highest NN wins; all proven approved is 0', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-02.md`]: verdictFile('aprovado'), [`${ENT}/revisao/veredito-10.md`]: verdictFile('bloqueio') });
  const c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-ok.json', '--cwd', dir], c.io), 2);
  const dir2 = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-ok.json', '--cwd', dir2], capture().io), 0);
});

test('command: missing trace 65, bad trace 65, usage 64, unknown delivery 65', async () => {
  const dir = await setup();
  let c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'nope.json', '--cwd', dir], c.io), 65);
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-bad.json', '--cwd', dir], c.io), 65);
  assert.match(c.out.stderr, /inválido/);
  assert.equal(await main(['acceptance-report', 'ENT-001', '--cwd', dir], capture().io), 64);
  assert.equal(await main(['acceptance-report', 'ENT-009', '--target', 'main', '--trace', 'trace-ok.json', '--cwd', dir], capture().io), 65);
});

test('command: prototype-named target warns by default; config ignore allows pending only', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  let c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'constructor', '--trace', 'trace-manual.json', '--cwd', dir, '--json'], c.io), 0);
  assert.deepEqual(JSON.parse(c.out.stdout).warnings, ['merge.manual_pending']);
  const dir2 = await setup({ '.baco/config.yaml': 'manual_pending:\n  main: ignore\n', [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-manual.json', '--cwd', dir2, '--json'], c.io), 0);
  assert.deepEqual(JSON.parse(c.out.stdout), { allowed: true, blockers: [], warnings: [] });
  const dir3 = await setup({ '.baco/config.yaml': 'manual_pending:\n  main: ignore\n', [`${ENT}/revisao/veredito-01.md`]: verdictFile('ajustes') });
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-manual.json', '--cwd', dir3], capture().io), 2);
});

test('command: non-object CA entry is bad_trace 65 with localized message', async () => {
  const dir = await setup({ 'trace-null.json': '{"cas":[null]}', 'trace-str.json': '{"cas":["x"]}' });
  for (const f of ['trace-null.json', 'trace-str.json', 'trace-bad.json']) {
    const c = capture();
    assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', f, '--cwd', dir], c.io), 65);
    assert.match(c.out.stderr, /inválido/);
    assert.doesNotMatch(c.out.stderr, /\bcas\b|JSON|Unexpected|position/);
  }
});

// Review: a malformed otherScenarios was silently dropped and the decision allowed.
test('command: a malformed otherScenarios is bad_trace 65; a trace without the field is still read', async () => {
  const bad = (v) => JSON.stringify(stamp({ ...provenTrace(), otherScenarios: v }));
  const dir = await setup({
    'o-str.json': bad('malformed'), 'o-null.json': bad([null]), 'o-prim.json': bad([3]), 'o-obj.json': bad({ id: 'CT-1' }), 'o-noid.json': bad([{ result: 'passed' }]),
    [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'),
  });
  for (const f of ['o-str.json', 'o-null.json', 'o-prim.json', 'o-obj.json', 'o-noid.json']) {
    const c = capture();
    assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', f, '--cwd', dir], c.io), 65, f);
    assert.match(c.out.stderr, /inválido/, f);
  }
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).code, 0);
});

test('render: plain-language wording (no broken plurals, verdict glossed, no repeated blockers)', () => {
  const t = trace([ca('CA-001', 'failed', [sc('CT-001', 'failed')]), ca('CA-002', 'proven', [sc('CT-002', 'passed')])]);
  const v = { verdict: 'ajustes', findings: [{ severity: 'crítico', location: null, text: 'x' }, { severity: 'sugestão', location: null, text: 'y' }] };
  const d = mergeDecision({ trace: t, verdict: v, rule: 'block' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t, verdict: v, decision: d, lang: 'pt-BR' });
  assert.match(md, /provados: 1 · falharam: 1 · pendentes: 0 · sem teste: 0/);
  assert.match(md, /pediu ajustes/);
  assert.match(md, /críticos: 1 · importantes: 0 · sugestões: 1/);
  assert.doesNotMatch(md, /\(s\)|\(ões\)/);
  const risks = md.split('## Riscos e pendências')[1].split('## O que muda')[0];
  assert.doesNotMatch(risks, /falharam|Impede a integração/);
  const md2 = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t, verdict: { verdict: 'bloqueio', findings: [] }, decision: d, lang: 'pt-BR' });
  assert.match(md2, /bloqueou/);
  assert.match(renderAcceptance({ entId: 'ENT-001', target: 'main', trace: provenTrace(), verdict: ok, decision: mergeDecision({ trace: provenTrace(), verdict: ok, rule: 'block' }), lang: 'pt-BR' }), /aprovou/);
});

// I8 (R19): provenance blockers.
const json = async (dir, ...args) => {
  const c = capture();
  const code = await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--cwd', dir, '--json', ...args], c.io);
  return { code, data: JSON.parse(c.out.stdout || '{}'), out: c.out };
};

test('I8: a trace from another HEAD blocks with merge.stale_trace (exit 2)', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'), 'trace-old.json': JSON.stringify(stamp(provenTrace(), { head: 'f'.repeat(40) })) });
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).code, 0);
  const r = await json(dir, '--trace', 'trace-old.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.stale_trace']);
  const nohead = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'), 't.json': JSON.stringify({ ...provenTrace(), spec: { path: PLAN_SPEC }, delivery: 'ENT-001' }) });
  assert.deepEqual((await json(nohead, '--trace', 't.json')).data.blockers, ['merge.stale_trace']);
});

test('I8: a trace of another delivery (or none) blocks with merge.trace_other_delivery', async () => {
  const dir = await setup({
    [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'),
    'other.json': JSON.stringify(stamp(provenTrace(), { delivery: 'ENT-002' })),
    'null.json': JSON.stringify(stamp(provenTrace(), { delivery: null })),
  });
  for (const f of ['other.json', 'null.json']) {
    const r = await json(dir, '--trace', f);
    assert.equal(r.code, 2, f);
    assert.deepEqual(r.data.blockers, ['merge.trace_other_delivery'], f);
  }
});

test('I8: a verdict that reviewed another head blocks with merge.stale_verdict', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado', 'e'.repeat(40)) });
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.stale_verdict']);
  const old = await setup({ [`${ENT}/revisao/veredito-01.md`]: 'VEREDITO: aprovado\n\n<!-- baco:parsed {"verdict":"aprovado","findings":[]} -->\n' });
  assert.deepEqual((await json(old, '--trace', 'trace-ok.json')).data.blockers, ['merge.stale_verdict']);
});

test('I8: committing after trace and review makes both stale', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  commit(dir, { 'late.txt': 'x' }, 'late change');
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.stale_trace', 'merge.stale_verdict']);
});

test('I8: the Prova column shows where/date/delivery of manual evidence', () => {
  const ev = { date: '2026-10-28', where: 'homologação', delivery: 'ENT-001' };
  const t = trace([ca('CA-002', 'proven', [{ ...sc('CT-002', 'manual_ok', 'manual'), evidence: ev }])]);
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t, verdict: ok, decision: mergeDecision({ trace: t, verdict: ok, rule: 'block' }), lang: 'pt-BR' });
  assert.match(md, /CT-002: aprovado \(teste manual em homologação, 2026-10-28, ENT-001\)/);
});

// I9: several traces, plan coverage and exit codes (R18).
test('I9: repeated --trace merges cas; the worse status wins for the same CA', async () => {
  const dir = await setup({
    [`${ENT}/plano.md`]: `# Plano\n\n**Specs:** ${PLAN_SPEC}@1.0, docs/specs/y.md@2.0\n`,
    [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'),
    'y-ok.json': JSON.stringify(stamp(trace([ca('CA-Y-001', 'proven', [sc('CT-Y-001', 'passed')])]), { spec: { path: 'docs/specs/y.md', version: '2.0' } })),
    'y-fail.json': JSON.stringify(stamp(trace([ca('CA-001', 'failed', [sc('CT-001', 'failed')])]), { spec: { path: 'docs/specs/y.md', version: '2.0' } })),
  });
  const both = await json(dir, '--trace', 'trace-ok.json', '--trace', 'y-ok.json');
  assert.equal(both.code, 0);
  assert.deepEqual(both.data.blockers, []);
  const md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  assert.match(md, /CA-Y-001/);
  assert.match(md, /CA-001/);
  const worse = await json(dir, '--trace', 'trace-ok.json', '--trace', 'y-fail.json');
  assert.equal(worse.code, 1);
  assert.deepEqual(worse.data.blockers, ['merge.failed']);
  assert.match(readFileSync(join(dir, ENT, 'aceite.md'), 'utf8'), /\| CA-001 \| ❌ falhou/);
});

test('I9: a plan spec without a trace blocks with merge.spec_not_traced', async () => {
  const dir = await setup({
    [`${ENT}/plano.md`]: `# Plano\n\n**Specs:** ${PLAN_SPEC}@1.0, ./docs/specs/y.md@2.0\n`,
    [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'),
  });
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.spec_not_traced']);
  assert.deepEqual(r.data.specsNotTraced, ['./docs/specs/y.md']);
  const c = capture();
  await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-ok.json', '--cwd', dir], c.io);
  assert.match(c.out.stdout, /docs\/specs\/y\.md/);
});

test('I9: a plan with no specs blocks with merge.no_plan_specs', async () => {
  const dir = await setup({ [`${ENT}/plano.md`]: '# Plano\n\n**Base:** main\n', [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.no_plan_specs']);
});

test('I9 (R18): verification-failure blockers exit 1, other blockers exit 2', async () => {
  const dir = await setup({
    [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'),
    'unc.json': JSON.stringify(stamp(trace([ca('CA-001', 'uncovered', [])]))),
    'empty.json': JSON.stringify(stamp(trace([]))),
    'unc-old.json': JSON.stringify(stamp(trace([ca('CA-001', 'uncovered', [])]), { head: 'f'.repeat(40) })),
  });
  assert.equal((await json(dir, '--trace', 'unc.json')).code, 1);
  assert.equal((await json(dir, '--trace', 'empty.json')).code, 1);
  const mixed = await json(dir, '--trace', 'unc-old.json');
  assert.equal(mixed.code, 1);
  assert.deepEqual(mixed.data.blockers, ['merge.uncovered', 'merge.stale_trace']);
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-manual.json', '--cwd', dir], capture().io), 2);
});

test('M5: risk finding location is localized (no hard-coded " em ")', () => {
  const v = { verdict: 'ajustes', findings: [{ severity: 'crítico', location: 'a.ts:1', text: 'x' }] };
  const d = mergeDecision({ trace: provenTrace(), verdict: v, rule: 'block' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: provenTrace(), verdict: v, decision: d, lang: 'en' });
  assert.match(md, /Review finding \(crítico\) at a\.ts:1: x/);
});

// R26: commits touching only delivery artifacts do not make trace/verdict stale.
test('R26: committing only delivery artifacts after trace and review is not stale; a code change is', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  // Commit only delivery artifacts (git add -A would also commit the rewritten trace files at the root).
  writeFileSync(join(dir, ENT, 'aceite.md'), '# aceite\n');
  const gitc = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  gitc('add', `${ENT}/aceite.md`, `${ENT}/revisao/veredito-01.md`);
  gitc('commit', '-q', '-m', 'artifacts only');
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 0, JSON.stringify(r.data));
  assert.deepEqual(r.data.blockers, []);
  commit(dir, { 'src/x.js': 'code\n' }, 'code change');
  const r2 = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r2.code, 2);
  assert.deepEqual(r2.data.blockers, ['merge.stale_trace', 'merge.stale_verdict']);
});

// 0.1.1 (atrito 1): provenance.ignore paths are left out of the R26 diff, for trace, verdict and waiver.
test('R26 + provenance.ignore: a commit touching only ignored paths keeps trace, verdict and waiver current', async () => {
  const config = 'provenance:\n  ignore: [docs/registro-da-rodada.md, "logs/**"]\n';
  const gitc = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  // Verdict + trace.
  const dir = await setup({ '.baco/config.yaml': config, [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  writeFileSync(join(dir, 'docs/registro-da-rodada.md'), '# registro\n');
  mkdirSync(join(dir, 'logs/a'), { recursive: true });
  writeFileSync(join(dir, 'logs/a/run.log'), 'x\n');
  gitc(dir, 'add', 'docs/registro-da-rodada.md', 'logs');
  gitc(dir, 'commit', '-q', '-m', 'run log only');
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 0, JSON.stringify(r.data));
  assert.deepEqual(r.data.blockers, []);
  // A path that is not ignored still makes them stale.
  writeFileSync(join(dir, 'docs/outro.md'), 'x\n');
  gitc(dir, 'add', 'docs/outro.md');
  gitc(dir, 'commit', '-q', '-m', 'other doc');
  assert.deepEqual((await json(dir, '--trace', 'trace-ok.json')).data.blockers, ['merge.stale_trace', 'merge.stale_verdict']);
  // Waiver.
  const w = await setup({ '.baco/config.yaml': config });
  assert.equal(await main(['waive-review', 'ENT-001', '--by', 'Ana', '--reason', 'protótipo', '--cwd', w], capture().io), 0);
  writeFileSync(join(w, 'docs/registro-da-rodada.md'), '# registro\n');
  gitc(w, 'add', 'docs/registro-da-rodada.md', `${ENT}/revisao/dispensa-revisao-externa.md`);
  gitc(w, 'commit', '-q', '-m', 'waiver and run log');
  const rw = await json(w, '--trace', 'trace-ok.json');
  assert.equal(rw.code, 0, JSON.stringify(rw.data));
  assert.deepEqual(rw.data.warnings, ['merge.review_waived']);
  commit(w, { 'src/x.js': 'code\n' }, 'code change');
  assert.deepEqual((await json(w, '--trace', 'trace-ok.json')).data.blockers, ['merge.no_verdict', 'merge.waiver_stale', 'merge.stale_trace']);
});

// 0.1.1 review: only entries present in the config at the recorded head AND in the current one count.
test('R26 + provenance.ignore: an entry added after the trace does not keep it current', async () => {
  const gitc = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  // The config is changed without being committed: .baco/config.yaml is then not in the diff.
  mkdirSync(join(dir, '.baco'), { recursive: true });
  writeFileSync(join(dir, '.baco/config.yaml'), 'provenance:\n  ignore: ["logs/**"]\n');
  mkdirSync(join(dir, 'logs'), { recursive: true });
  writeFileSync(join(dir, 'logs/run.log'), 'x\n');
  gitc(dir, 'add', 'logs');
  gitc(dir, 'commit', '-q', '-m', 'log under an entry the recorded head did not have');
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.stale_trace', 'merge.stale_verdict']);
});

test('R26 + provenance.ignore: a git error caused by an entry is a config error naming provenance.ignore', async () => {
  // A NUL byte passes the config check but git cannot take it.
  const config = 'provenance:\n  ignore: ["logs/a\u0000b"]\n';
  const dir = await setup({ '.baco/config.yaml': config, [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  commit(dir, { 'docs/x.md': 'x\n' }, 'later commit');
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 65);
  assert.equal(r.data.error.key, 'acceptance.provenance_ignore_failed');
  assert.match(r.out.stderr, /provenance\.ignore/);
  // freshnessCheck itself: an error only with the ignore entries is the config's fault.
  const { GitError } = await import('../skills/baco-sdd/scripts/lib/git.mjs');
  const { freshnessCheck, ProvenanceIgnoreError } = await import('../skills/baco-sdd/scripts/commands/acceptance-report.mjs');
  const cfg = { docs_root: 'docs', provenance: { ignore: ['logs/**'] } };
  const gitStub = (failPlain) => ({
    isAncestor: () => true,
    showFile: () => 'provenance:\n  ignore: [logs/**]\n',
    diffQuiet: (a, b, specs) => { if (failPlain || specs.some((s) => s.includes('logs'))) throw new GitError('bad pathspec', []); return true; },
  });
  const check = freshnessCheck({ head: 'b'.repeat(40), root: '/r', config: cfg, git: gitStub(false) });
  assert.throws(() => check('a'.repeat(40)), (e) => e instanceof ProvenanceIgnoreError && /bad pathspec/.test(e.message));
  // When git fails without the entries too, the head is just not current.
  assert.equal(freshnessCheck({ head: 'b'.repeat(40), root: '/r', config: cfg, git: gitStub(true) })('a'.repeat(40)), false);
});

test('R26: without provenance.ignore, a commit to a docs file outside entregas makes trace and verdict stale', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  writeFileSync(join(dir, 'docs/registro-da-rodada.md'), '# registro\n');
  execFileSync('git', ['add', 'docs/registro-da-rodada.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'run log'], { cwd: dir });
  assert.deepEqual((await json(dir, '--trace', 'trace-ok.json')).data.blockers, ['merge.stale_trace', 'merge.stale_verdict']);
});

test('R26: a recorded head that is not an ancestor of HEAD is stale', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado', '0'.repeat(40)) });
  assert.deepEqual((await json(dir, '--trace', 'trace-ok.json')).data.blockers, ['merge.stale_verdict']);
});

// Plan 4: review waiver, open items from progresso.md, agents from custo.md, filtered traces.
test('P4: a current waiver replaces merge.no_verdict by the warning merge.review_waived; a stale one does not', () => {
  const w = { head: 'a'.repeat(40), by: 'Ana', date: '2026-11-02 10:00', reason: 'protótipo' };
  assert.deepEqual(mergeDecision({ trace: provenTrace(), verdict: null, rule: 'block', waiver: { ...w, current: true } }), { allowed: true, blockers: [], warnings: ['merge.review_waived'] });
  assert.deepEqual(mergeDecision({ trace: provenTrace(), verdict: null, rule: 'block', waiver: { ...w, current: false } }).blockers, ['merge.no_verdict', 'merge.waiver_stale']);
  // A verdict, once imported, wins over any waiver.
  assert.deepEqual(mergeDecision({ trace: provenTrace(), verdict: { verdict: 'ajustes', findings: [] }, rule: 'block', waiver: { ...w, current: true } }).blockers, ['merge.verdict_not_approved']);
});

test('P4: command with a waiver (only delivery commits since): exit 0, warning, honest review text', async () => {
  const dir = await setup();
  assert.equal(await main(['waive-review', 'ENT-001', '--by', 'Ana Souza', '--reason', 'protótipo interno.', '--cwd', dir], capture().io), 0);
  // Committing the waiver itself touches only docs/entregas/** (R26): still current.
  execFileSync('git', ['add', `${ENT}/revisao/dispensa-revisao-externa.md`], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'waiver'], { cwd: dir });
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 0, JSON.stringify(r.data));
  assert.deepEqual(r.data.blockers, []);
  assert.deepEqual(r.data.warnings, ['merge.review_waived']);
  const md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  const date = /\*\*Data:\*\* (.+)/.exec(readFileSync(join(dir, ENT, 'revisao/dispensa-revisao-externa.md'), 'utf8'))[1];
  assert.ok(md.includes(`Sem revisão externa, por decisão de Ana Souza em ${date}: protótipo interno.`), md);
  assert.doesNotMatch(md, /Ficam pendentes/);
  assert.doesNotMatch(md, /Ainda não houve revisão externa/);
  const c = capture();
  await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-ok.json', '--cwd', dir], c.io);
  assert.match(c.out.stdout, /Ana Souza/);
});

test('P4: a stale waiver keeps merge.no_verdict and says why', async () => {
  const stale = `<!-- baco:head ${'f'.repeat(40)} -->\n# Dispensa\n\n<!-- baco:waiver {"by":"Ana","date":"2026-11-01 09:00","reason":"x"} -->\n`;
  const dir = await setup({ [`${ENT}/revisao/dispensa-revisao-externa.md`]: stale });
  const r = await json(dir, '--trace', 'trace-ok.json');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.blockers, ['merge.no_verdict', 'merge.waiver_stale']);
  const md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  assert.match(md, /Ainda não houve revisão externa/);
  assert.match(md, /dispensa[^.]*2026-11-01 09:00[^.]*outra versão do código/i);
  // With a verdict, the waiver is ignored.
  const v = await setup({ [`${ENT}/revisao/dispensa-revisao-externa.md`]: stale, [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  assert.deepEqual((await json(v, '--trace', 'trace-ok.json')).data, { allowed: true, blockers: [], warnings: [] });
});

const PROGRESSO = `# Progresso | ENT-001

## Registro das tarefas

| Data/hora | Tarefa | Estado | Commits | Nota |
|---|---|---|---|---|
| 2026-11-01 10:00 | T-001 | FEITO | abc | resolvida |

## Pendências

| ID | Pendência | Impacto | Responsável | Destino | Situação |
|---|---|---|---|---|---|
| P-01 | Limite de upload não definido | arquivos grandes falham | Ana | ENT-002 | aberta |
| P-02 | Texto do e-mail | baixo | Bia | esta entrega | Resolvida |
| P-03 | Log sem rotação | disco enche | Caio | backlog | |

## Decisões registradas

| ID | Pendência | Impacto | Responsável | Destino | Situação |
|---|---|---|---|---|---|
| X-09 | fora da seção | - | - | - | aberta |
`;

test('P4: openItems reads the Pendências table and keeps every row not resolvida', () => {
  assert.deepEqual(openItems(PROGRESSO), [
    { id: 'P-01', item: 'Limite de upload não definido', impact: 'arquivos grandes falham', dest: 'ENT-002' },
    { id: 'P-03', item: 'Log sem rotação', impact: 'disco enche', dest: 'backlog' },
  ]);
  const marked = PROGRESSO.replace('| esta entrega | Resolvida |', '| esta entrega | **`Resolvida.`** |').replace('| backlog | |', '| backlog | *resolvida* |');
  assert.deepEqual(openItems(marked).map((x) => x.id), ['P-01']);
  // A closing note after the word still closes the item; a different word that merely begins alike does not.
  const noted = PROGRESSO.replace('| esta entrega | Resolvida |', '| esta entrega | resolvida (2026-11-13 17:36, Chromium 156 passou) |').replace('| backlog | |', '| backlog | resolvidamente |');
  assert.deepEqual(openItems(noted).map((x) => x.id), ['P-01', 'P-03']);
  assert.deepEqual(openItems(PROGRESSO.replace('| esta entrega | Resolvida |', '| esta entrega | **Resolvida:** feito |')).map((x) => x.id), ['P-01', 'P-03']);
  assert.deepEqual(openItems('# Progresso\n\n## Pendências\n\nNenhuma.\n'), []);
  assert.deepEqual(openItems('# Progresso\n'), []);
  assert.deepEqual(openItems(''), []);
  const tpl = readFileSync(new URL('../skills/baco-sdd/templates/pt-BR/progresso.md', import.meta.url), 'utf8');
  assert.ok(tpl.indexOf('## Pendências') > 0 && tpl.indexOf('## Pendências') < tpl.indexOf('## Decisões registradas'));
  assert.match(tpl, /\| ID \| Pendência \| Impacto \| Responsável \| Destino \| Situação \|\n\|---\|---\|---\|---\|---\|---\|\n/);
  assert.deepEqual(openItems(tpl), []);
});

test('P4: open items of progresso.md become risks; none without the file or the section', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'), [`${ENT}/progresso.md`]: PROGRESSO });
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).code, 0);
  const risks = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8').split('## Riscos e pendências')[1].split('\n## ')[0];
  assert.match(risks, /- Pendência P-01: Limite de upload não definido \(impacto: arquivos grandes falham; destino: ENT-002\)\./);
  assert.match(risks, /- Pendência P-03: Log sem rotação \(impacto: disco enche; destino: backlog\)\./);
  assert.doesNotMatch(risks, /P-02|X-09|Nenhum risco/);
  for (const extra of [{}, { [`${ENT}/progresso.md`]: '# Progresso\n\n## Registro das tarefas\n' }]) {
    const d = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'), ...extra });
    assert.equal((await json(d, '--trace', 'trace-ok.json')).code, 0);
    assert.match(readFileSync(join(d, ENT, 'aceite.md'), 'utf8'), /Nenhum risco ou pendência registrado/);
  }
});

test('P4: the report lists which agents ran, from custo.md', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).code, 0);
  let md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  assert.match(md, /## Agentes\n\nOs agentes que trabalharam nesta entrega não foram registrados\./);
  const add = (agent, model, effort) => main(['cost', 'add', 'ENT-001', '--phase', '6', '--agent', agent, '--model', model, '--effort', effort, '--cwd', dir], capture().io);
  for (const a of [['task-reviewer', 'sonnet', 'high'], ['implementer', 'opus', 'medium'], ['task-reviewer', 'sonnet', 'high'], ['task-reviewer', 'opus', 'high']]) assert.equal(await add(...a), 0);
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).code, 0);
  md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  const agents = md.split('## Agentes\n\n')[1].split('\n\n')[0];
  assert.equal(agents, '- task-reviewer: sonnet, high (2 execuções)\n- implementer: opus, medium (1 execução)\n- task-reviewer: opus, high (1 execução)');
  assert.ok(md.indexOf('## Agentes') < md.indexOf('## O que muda para o usuário'));
});

test('the agents list names the harness when custo.md records it', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  const add = (...extra) => main(['cost', 'add', 'ENT-001', '--phase', '7', '--agent', 'pr-reviewer', '--model', 'modelo-x', '--effort', 'high', ...extra, '--cwd', dir], capture().io);
  assert.equal(await add('--harness', 'codex'), 0);
  assert.equal(await add(), 0);
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).code, 0);
  const md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  const agents = md.split('## Agentes\n\n')[1].split('\n\n')[0];
  assert.equal(agents, '- pr-reviewer: modelo-x no codex, high (1 execução)\n- pr-reviewer: modelo-x, high (1 execução)');
});

test('P4: a filtered (per-task) trace is refused with exit 65', async () => {
  const dir = await setup({
    [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado'),
    'filtered.json': JSON.stringify(stamp(provenTrace(), { filter: { cas: ['CA-001'] } })),
    'unfiltered.json': JSON.stringify(stamp(provenTrace(), { filter: null })),
  });
  const c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-ok.json', '--trace', 'filtered.json', '--cwd', dir], c.io), 65);
  assert.match(c.out.stderr, /filtered\.json/);
  assert.match(c.out.stderr, /aceite/);
  assert.ok(!existsSync(join(dir, ENT, 'aceite.md')));
  assert.equal((await json(dir, '--trace', 'unfiltered.json')).code, 0);
});

// 0.1.1 (atrito 11): re-running the report keeps what the writer wrote in its slot.
const OPEN = '<!-- preencher: redator -->';
const CLOSE = '<!-- fim: redator -->';
const WRITER = 'Agora a equipe cadastra empresas sem repetir o CNPJ.\n\n**Se der errado:** voltamos à versão anterior em 10 minutos; nada se perde.';

test('writer slot: the report closes the slot; extractWriterText reads it in every shape', () => {
  const d = mergeDecision({ trace: provenTrace(), verdict: ok, rule: 'block' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: provenTrace(), verdict: ok, decision: d });
  assert.ok(md.endsWith(`## O que muda para o usuário\n\n${OPEN}\n${CLOSE}\n`), md);
  assert.equal(extractWriterText(md), null);
  const kept = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: provenTrace(), verdict: ok, decision: d, writerText: WRITER });
  assert.ok(kept.endsWith(`## O que muda para o usuário\n\n${OPEN}\n${WRITER}\n${CLOSE}\n`), kept);
  assert.equal(extractWriterText(kept), WRITER);
  // Old reports (no closing marker), the marker replaced by the text, text after the closing marker, en heading.
  const head = '# Aceite\n\n## Agentes\n\n- x\n\n## O que muda para o usuário\n\n';
  assert.equal(extractWriterText(`${head}${OPEN}\n\n${WRITER}\n`), WRITER);
  assert.equal(extractWriterText(`${head}${WRITER}\n`), WRITER);
  assert.equal(extractWriterText(`${head}${OPEN}\n${CLOSE}\n\n${WRITER}\n`), WRITER);
  assert.equal(extractWriterText(`# Acceptance\n\n## What changes for the user\n\n${OPEN}\nNew text.\n`), 'New text.');
  // Nothing identifiable: unfilled slot, or no slot heading.
  assert.equal(extractWriterText(`${head}${OPEN}\n`), null);
  assert.equal(extractWriterText(`# Aceite\n\n${WRITER}\n`), null);
});

test('command: re-running the report keeps the writer text and says so', async () => {
  const dir = await setup({ [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).data.writerKept, undefined);
  const file = join(dir, ENT, 'aceite.md');
  // The writer replaces the opening marker with its text (old habit) and adds "Se der errado".
  writeFileSync(file, readFileSync(file, 'utf8').replace(OPEN, WRITER));
  const c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-ok.json', '--cwd', dir], c.io), 0);
  assert.match(c.out.stdout, /texto do redator[^\n]*mantido/i);
  const md = readFileSync(file, 'utf8');
  assert.ok(md.endsWith(`${OPEN}\n${WRITER}\n${CLOSE}\n`), md);
  assert.equal(md.split(WRITER).length, 2); // kept once, not duplicated
  assert.equal((await json(dir, '--trace', 'trace-ok.json')).data.writerKept, true);
  // A report written before 0.1.1 (no closing marker) whose writer kept the marker: kept too.
  writeFileSync(file, `# Aceite antigo\n\n## O que muda para o usuário\n\n${OPEN}\n\nTexto antigo do redator.\n`);
  await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-ok.json', '--cwd', dir], capture().io);
  assert.ok(readFileSync(file, 'utf8').endsWith(`${OPEN}\nTexto antigo do redator.\n${CLOSE}\n`));
  // Nothing identifiable: behaves as before (empty slot, no message).
  writeFileSync(file, '# Aceite sem a seção do redator\n\nAlgo solto.\n');
  const e = capture();
  await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'trace-ok.json', '--cwd', dir], e.io);
  assert.doesNotMatch(e.out.stdout, /redator/);
  assert.ok(readFileSync(file, 'utf8').endsWith(`${OPEN}\n${CLOSE}\n`));
});

// E2E round C: a manual scenario linked only to a rule (RN) said "Nenhum teste manual pendente".
const other = (id, result, automation = 'manual', contracts = ['RN-001']) => ({ id, contracts, automation, tests: [], result, evidence: null });
const withOthers = (others, base = provenTrace()) => ({ ...base, otherScenarios: others });

test('scenarios without a CA follow the manual_pending rule when pending and block as failed when rejected', () => {
  const pend = withOthers([other('CT-009', 'manual_pending'), other('CT-010', 'not_run', 'automatizado')]);
  assert.deepEqual(mergeDecision({ trace: pend, verdict: ok, rule: 'block' }).blockers, ['merge.manual_pending', 'merge.not_run']);
  const w = mergeDecision({ trace: pend, verdict: ok, rule: 'warn' });
  assert.equal(w.allowed, true);
  assert.deepEqual(w.warnings, ['merge.manual_pending', 'merge.not_run']);
  for (const result of ['manual_fail', 'failed']) {
    const d = mergeDecision({ trace: withOthers([other('CT-009', result)]), verdict: ok, rule: 'ignore' });
    assert.deepEqual(d.blockers, ['merge.scenario_failed'], result);
  }
  assert.deepEqual(mergeDecision({ trace: withOthers([other('CT-009', 'manual_ok')]), verdict: ok, rule: 'block' }), { allowed: true, blockers: [], warnings: [] });
});

test('render: scenarios without a CA get their own table and enter the manual checklist', () => {
  const t = withOthers([other('CT-009', 'manual_pending'), other('CT-010', 'passed', 'automatizado', ['RF-001'])]);
  const decision = mergeDecision({ trace: t, verdict: ok, rule: 'block' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: t, verdict: ok, decision, lang: 'pt-BR', titles: new Map([['CT-009', 'Isolamento']]) });
  assert.match(md, /## Cenários ligados só a regras ou requisitos/);
  assert.match(md, /\| CT-009 \| RN-001 \| aguardando execução \(teste manual\) \|/);
  assert.match(md, /\| CT-010 \| RF-001 \| passou \(teste automático\) \|/);
  assert.match(md, /- \[ \] CT-009: Isolamento/);
  assert.doesNotMatch(md, /Nenhum teste manual pendente/);
  const plain = renderAcceptance({ entId: 'ENT-001', target: 'main', trace: provenTrace(), verdict: ok, decision: mergeDecision({ trace: provenTrace(), verdict: ok, rule: 'block' }), lang: 'pt-BR' });
  assert.doesNotMatch(plain, /regras ou requisitos/);
});

// Review: a rejected automated rule-only scenario without JUnit was "not run", allowed under warn.
test('trace + acceptance: a rejected automated rule-only scenario without JUnit blocks as a verification failure', async () => {
  const spec = readFileSync(new URL('./fixtures/spec-exemplo.md', import.meta.url), 'utf8');
  const qa = '# QA\n\n### CT-EMP-001 | todos\n- **Contratos:** CA-EMP-001, CA-EMP-002, CA-EMP-003.\n- **Automação:** automatizado (`t/a.test.js`)\n\n### CT-EMP-009 | regra\n- **Contratos:** RN-EMP-001.\n- **Automação:** automatizado (`t/rn.test.js`)\n\n## Evidências de execução\n\n| CT | Resultado | Data | Onde | Entrega |\n|---|---|---|---|---|\n| CT-EMP-009 | reprovado | 2026-11-13 | homologação | ENT-001 |\n';
  const dir = await setup({ [PLAN_SPEC]: spec, 'docs/qa/cenarios-qa-spec-x.md': qa, '.baco/junit/a.xml': '<testsuite><testcase name="[CT-EMP-001] ok"/></testsuite>', [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  const out = `${ENT}/revisao/trace-spec-x.json`;
  const tr = await main(['trace', '--spec', PLAN_SPEC, '--qa', 'docs/qa/cenarios-qa-spec-x.md', '--delivery', 'ENT-001', '--out', out, '--cwd', dir], capture().io);
  assert.equal(tr, 1);
  const d = await json(dir, '--trace', out);
  assert.equal(d.code, 1);
  assert.equal(d.data.allowed, false);
  assert.ok(d.data.blockers.includes('merge.scenario_failed'), JSON.stringify(d.data));
  assert.ok(!d.data.warnings.includes('merge.not_run'));
});

test('command: a pending rule-only manual scenario blocks main (exit 2) and warns on develop; traces merge it once', async () => {
  const tr = JSON.stringify(stamp(withOthers([other('CT-009', 'manual_pending')])));
  const dir = await setup({ 'trace-rn.json': tr, 'trace-rn2.json': tr, [`${ENT}/revisao/veredito-01.md`]: verdictFile('aprovado') });
  const c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'trace-rn.json', '--cwd', dir], c.io), 2);
  assert.match(c.out.stdout, /testes manuais ainda não executados/);
  const d = await json(dir, '--trace', 'trace-rn.json', '--trace', 'trace-rn2.json');
  assert.equal(d.code, 0);
  assert.deepEqual(d.data.warnings, ['merge.manual_pending']);
  const md = readFileSync(join(dir, ENT, 'aceite.md'), 'utf8');
  assert.equal(md.split('- [ ] CT-009').length, 2);
});
