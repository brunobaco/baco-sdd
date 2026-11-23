import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { traceCoverage } from '../skills/baco-sdd/scripts/commands/trace.mjs';
import { readSpec } from '../skills/baco-sdd/scripts/lib/spec.mjs';
import { readQa } from '../skills/baco-sdd/scripts/lib/qa.mjs';
import { parseJUnit } from '../skills/baco-sdd/scripts/lib/junit.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';
import { execFileSync } from 'node:child_process';

const fx = (n) => new URL(`./fixtures/${n}`, import.meta.url);
const SPEC = readFileSync(fx('spec-exemplo.md'), 'utf8');
const QA = readFileSync(fx('cenarios-qa-spec-exemplo.md'), 'utf8');
const XML = readFileSync(fx('junit-vitest.xml'), 'utf8');
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

async function repo(extra = {}) {
  const dir = await makeRepo({ 'spec.md': SPEC, 'qa.md': QA, '.baco/junit/a.xml': XML, ...extra });
  return dir;
}
async function cli(dir, ...args) {
  const { out, io } = capture();
  const code = await main(['trace', '--cwd', dir, ...args], io);
  return { code, ...out };
}
test('trace with the spec as a loose argument exits 64 and shows the --spec/--qa form', async () => {
  const dir = await repo();
  const r = await cli(dir, 'spec.md');
  assert.equal(r.code, 64);
  assert.match(r.stderr, /--spec <spec\.md> --qa <qa\.md>/);
});
const byCa = (r) => Object.fromEntries(r.cas.map((c) => [c.ca, c]));
const compute = async (qaText, xml = XML) => {
  const dir = await repo({ 'qa.md': qaText });
  return traceCoverage({ spec: readSpec(join(dir, 'spec.md')), qa: readQa(join(dir, 'qa.md')), cases: parseJUnit(xml) });
};
// Fixture QA without the manual-pending (CT-002) and skipped (CT-004) scenarios.
const QA_CLEAN = QA.replace(/### CT-EMP-002[\s\S]*?(?=### CT-EMP-003)/, '').replace(/### CT-EMP-004[\s\S]*?(?=## 8)/, '');

test('CA-EMP-001 is proven when its scenario passed in JUnit', async () => {
  const r = byCa(await compute(QA_CLEAN));
  assert.equal(r['CA-EMP-001'].status, 'proven');
  assert.deepEqual(r['CA-EMP-001'].scenarios.map((s) => [s.id, s.via, s.result]), [['CT-EMP-001', 'qa', 'passed']]);
});

test('CA-EMP-002 fails: direct-tagged test failed despite passing manual evidence', async () => {
  const r = byCa(await compute(QA));
  assert.equal(r['CA-EMP-002'].status, 'failed');
  const s = r['CA-EMP-002'].scenarios;
  assert.ok(s.some((x) => x.id === 'CT-EMP-003' && x.result === 'manual_ok'));
  assert.ok(s.some((x) => x.via === 'direct' && x.result === 'failed'));
});

test('CA-EMP-003 is proven via manual evidence plus passing direct test', async () => {
  const r = await compute(QA);
  assert.equal(byCa(r)['CA-EMP-003'].status, 'proven');
  assert.deepEqual(r.summary, { proven: 1, failed: 1, pending: 1, uncovered: 0 });
});

test('removing evidence makes CA-EMP-003 pending with manual_pending', async () => {
  const noEv = QA.replace(/\| CT-EMP-003 \| aprovado.*\n/, '');
  const r = byCa(await compute(noEv, '<testsuite/>'));
  assert.equal(r['CA-EMP-003'].status, 'pending');
  assert.equal(r['CA-EMP-003'].scenarios[0].result, 'manual_pending');
});

test('automated scenario without JUnit case is not_run (pending)', async () => {
  const r = byCa(await compute(QA_CLEAN, '<testsuite/>'));
  assert.equal(r['CA-EMP-001'].status, 'pending');
  assert.equal(r['CA-EMP-001'].scenarios[0].result, 'not_run');
});

test('R7: scenario with no automation uses a JUnit result when present, else manual_pending', async () => {
  const r = byCa(await compute(QA));
  const s = r['CA-EMP-001'].scenarios.find((x) => x.id === 'CT-EMP-004');
  assert.equal(s.result, 'skipped');
  assert.equal(r['CA-EMP-001'].status, 'pending');
  const r2 = byCa(await compute(QA, '<testsuite/>'));
  assert.equal(r2['CA-EMP-001'].scenarios.find((x) => x.id === 'CT-EMP-004').result, 'manual_pending');
});

test('aggregation: failed beats skipped beats passed; last evidence row wins', async () => {
  const tc = (n, body = '') => `<testcase name="${n}" classname="c">${body}</testcase>`;
  const xml = `<testsuite>${tc('[CT-EMP-001] a')}${tc('[CT-EMP-001] b', '<skipped/>')}${tc('[CT-EMP-001] c', '<error message="x"/>')}</testsuite>`;
  let r = byCa(await compute(QA_CLEAN, xml));
  assert.equal(r['CA-EMP-001'].scenarios[0].result, 'failed');
  r = byCa(await compute(QA_CLEAN, `<testsuite>${tc('[CT-EMP-001] a')}${tc('[CT-EMP-001] b', '<skipped/>')}</testsuite>`));
  assert.equal(r['CA-EMP-001'].scenarios[0].result, 'skipped');
  const twice = QA.replace(/(\| CT-EMP-003 \| aprovado.*\n)/, '$1| CT-EMP-003 | reprovado | 2026-10-29 | homologação | ENT-002 |\n');
  r = byCa(await compute(twice, '<testsuite/>'));
  assert.equal(r['CA-EMP-003'].status, 'failed');
  assert.equal(r['CA-EMP-003'].scenarios[0].result, 'manual_fail');
});

test('orphan tests: bracket ids unknown to spec and QA', async () => {
  const xml = XML.replace('</testsuite>', '<testcase classname="c" name="[CT-EMP-099] x"/><testcase classname="c" name="sem id"/></testsuite>');
  const r = await compute(QA, xml);
  assert.deepEqual(r.orphanTests, ['[CT-EMP-099] x']);
});

test('CA with no scenario and no test is uncovered', async () => {
  const dir = await repo({ 'spec.md': SPEC.replace('**CA-EMP-003**', '**CA-EMP-009**') });
  const r = traceCoverage({ spec: readSpec(join(dir, 'spec.md')), qa: readQa(join(dir, 'qa.md')), cases: [] });
  assert.equal(byCa(r)['CA-EMP-009'].status, 'uncovered');
  assert.equal(r.summary.uncovered, 1);
});

test('CLI: default junit dir, exit 1 on failed, --out writes JSON', async () => {
  const dir = await repo();
  const r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--out', 'out/trace.json');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /CA-EMP-002/);
  const data = JSON.parse(readFileSync(join(dir, 'out/trace.json'), 'utf8'));
  assert.equal(data.summary.failed, 1);
});

test('CLI: exit 1 on uncovered CA; --json prints data', async () => {
  const dir = await repo({ 'spec.md': SPEC.replace('**CA-EMP-003**', '**CA-EMP-009**') });
  const r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--json');
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).summary.uncovered, 1);
});

test('CLI: missing junit dir is not an error; explicit --junit (repeatable) is used; exit 0 when clean', async () => {
  const dir = await repo({ '.baco/junit/a.xml': null, 'qa.md': QA_CLEAN });
  assert.equal(existsSync(join(dir, '.baco/junit')), false);
  let r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--json');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).summary.uncovered, 0);
  mkdirSync(join(dir, 'x'));
  writeFileSync(join(dir, 'x/1.xml'), '<testsuite><testcase name="[CT-EMP-001] a" classname="c"/></testsuite>');
  writeFileSync(join(dir, 'x/2.xml'), '<testsuite><testcase name="[CA-EMP-002] b" classname="c"/></testsuite>');
  r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--junit', 'x/1.xml', '--junit', 'x/2.xml', '--json');
  const s = JSON.parse(r.stdout).summary;
  assert.equal(s.proven, 3);
  assert.equal(r.code, 0);
});

test('CLI: missing --spec/--qa is a usage error', async () => {
  const dir = await repo();
  assert.equal((await cli(dir, '--spec', 'spec.md')).code, 64);
});

test('R9: failed manual evidence is not masked by a passing JUnit case (worse outcome wins)', async () => {
  const qa = QA_CLEAN.replace('**Automacao:** pendente', '**Automação:** manual')
    .replace(/(\| CT-EMP-003 \| )aprovado/, '$1reprovado');
  const xml = '<testsuite><testcase name="[CT-EMP-003] ok" classname="c"/></testsuite>';
  let r = byCa(await compute(qa, xml));
  assert.equal(r['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003').result, 'manual_fail');
  assert.equal(r['CA-EMP-003'].status, 'failed');
  // JUnit failed + manual approved -> failed; JUnit passed + manual approved -> passed
  const bad = '<testsuite><testcase name="[CT-EMP-003] x" classname="c"><failure message="m"/></testcase></testsuite>';
  r = byCa(await compute(QA_CLEAN, bad));
  assert.equal(r['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003').result, 'failed');
  r = byCa(await compute(QA_CLEAN, xml));
  assert.equal(r['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003').result, 'passed');
});

// I8 (R19): provenance in the trace JSON.
test('I8: trace JSON carries head, spec {path, version}, delivery and per-scenario evidence', async () => {
  const dir = await repo({ 'docs/specs/spec-emp.md': SPEC, 'spec.md': null });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const r = await cli(join(dir, 'docs'), '--spec', 'specs/spec-emp.md', '--qa', '../qa.md', '--json');
  const data = JSON.parse(r.stdout);
  assert.equal(data.head, head);
  assert.deepEqual(data.spec, { path: 'docs/specs/spec-emp.md', version: '1.2' });
  assert.equal(data.delivery, null);
  const ct3 = byCa(data)['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003');
  assert.deepEqual(ct3.evidence, { date: '2026-10-28', where: 'homologação', delivery: 'ENT-001' });
  const direct = byCa(data)['CA-EMP-003'].scenarios.find((s) => s.via === 'direct');
  assert.equal(direct.evidence, null);
});

test('I8: --delivery counts only that delivery\'s evidence rows; others leave the scenario manual_pending', async () => {
  const dir = await repo({ '.baco/junit/a.xml': null });
  let data = JSON.parse((await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--delivery', 'ENT-002', '--json')).stdout);
  assert.equal(data.delivery, 'ENT-002');
  let ct3 = byCa(data)['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003');
  assert.equal(ct3.result, 'manual_pending');
  assert.equal(ct3.evidence, null);
  data = JSON.parse((await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--delivery', 'ENT-001', '--json')).stdout);
  ct3 = byCa(data)['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003');
  assert.equal(ct3.result, 'manual_ok');
  assert.equal(ct3.evidence.delivery, 'ENT-001');
  assert.equal((await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--delivery', 'ENT-1')).code, 64);
  assert.equal((await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--delivery')).code, 64);
});

test('M4: the last evidence row by document order wins across several evidence tables', async () => {
  const two = `${QA_CLEAN}\n## Mais evidências\n\n| CT | Resultado | Data | Onde | Entrega |\n|---|---|---|---|---|\n| CT-EMP-003 | reprovado | 2026-10-30 | prod | ENT-001 |\n`;
  const r = byCa(await compute(two, '<testsuite/>'));
  assert.equal(r['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003').result, 'manual_fail');
});

test('M5: trace text output localizes status and result tokens', async () => {
  const dir = await repo();
  const r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md');
  assert.doesNotMatch(r.stdout, /\b(proven|failed|pending|uncovered|manual_ok|manual_pending|not_run)\b/);
  assert.match(r.stdout, /CA-EMP-002: falhou/);
});

// --ca: restrict the result and the exit code to some criteria (end-of-task check).
test('--ca restricts cas, summary and exit code; comma list and repeated flag; filter recorded', async () => {
  const dir = await repo();
  let r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--json');
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).filter, null);
  r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', 'CA-EMP-001', '--json');
  let data = JSON.parse(r.stdout);
  assert.equal(r.code, 0);
  assert.deepEqual(data.cas.map((c) => c.ca), ['CA-EMP-001']);
  assert.deepEqual(data.summary, { proven: 0, failed: 0, pending: 1, uncovered: 0 });
  assert.deepEqual(data.filter, ['CA-EMP-001']);
  r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', 'CA-EMP-001,CA-EMP-002', '--json');
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout).filter, ['CA-EMP-001', 'CA-EMP-002']);
  r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', 'CA-EMP-003', '--ca', 'CA-EMP-001', '--out', 'out/t.json');
  data = JSON.parse(readFileSync(join(dir, 'out/t.json'), 'utf8'));
  assert.deepEqual(data.cas.map((c) => c.ca), ['CA-EMP-001', 'CA-EMP-003']);
  assert.deepEqual(data.filter, ['CA-EMP-001', 'CA-EMP-003']);
  assert.match(r.stdout, /CA-EMP-001/);
  assert.doesNotMatch(r.stdout, /CA-EMP-002/);
});

test('--ca with an id that is not a CA of the spec, or empty, exits 64', async () => {
  const dir = await repo();
  for (const v of ['CA-EMP-099', 'RF-EMP-001', 'CA-EMP-001,', '--json']) {
    const r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', v);
    assert.equal(r.code, 64, v);
  }
  const r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', 'CA-EMP-099');
  assert.match(r.stderr, /CA-EMP-099/);
});

test('a filtered trace is refused as input of acceptance-report and build-handoff (65)', async () => {
  const dir = await repo({ 'docs/entregas/ENT-001-a/plano.md': '**Specs:** spec.md@1.2\n**Base:** HEAD\n' });
  await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', 'CA-EMP-001', '--delivery', 'ENT-001', '--out', 'docs/entregas/ENT-001-a/trace.json');
  const c = capture();
  const code = await main(['acceptance-report', 'ENT-001', '--target', 'main', '--trace', 'docs/entregas/ENT-001-a/trace.json', '--cwd', dir], c.io);
  assert.equal(code, 65);
  assert.match(c.out.stderr, /--ca/);
  const h = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--trace', 'docs/entregas/ENT-001-a/trace.json', '--cwd', dir], h.io), 65);
});

// 0.1.1 (atrito 7): with --delivery, IDs of the other specs of the delivery are not orphans.
const miniSpec = (code) => `# Spec ${code}\n\n- **Código:** ${code}\n- **Versão:** 1.0\n\n## Histórico\n\n- 1.0: criação\n\n## Critérios de aceite\n\n### CA-${code}-001 | um\n\nDado x, Quando y, Então z.\n\n### CA-${code}-002 | dois\n\nDado x, Quando w, Então k.\n`;
const miniQa = (code) => `# QA ${code}\n\n### CT-${code}-001 | cenário\n\n- **Contratos:** CA-${code}-001\n- **Automação:** automatizado\n`;
const TWO_SPECS = {
  'docs/specs/spec-aaa.md': miniSpec('AAA'),
  'docs/qa/cenarios-qa-spec-aaa.md': miniQa('AAA'),
  'docs/specs/spec-bbb.md': miniSpec('BBB'),
  'docs/qa/cenarios-qa-spec-bbb.md': miniQa('BBB'),
  'docs/entregas/ENT-001-a/plano.md': '# Plano\n\n**Specs:** docs/specs/spec-aaa.md@1.0, docs/specs/spec-bbb.md@1.0\n**Base:** HEAD\n',
  '.baco/junit/a.xml': '<testsuite>'
    + '<testcase classname="c" name="[CT-AAA-001] a"/>'
    + '<testcase classname="c" name="[CT-BBB-001] b cenário"/>'
    + '<testcase classname="c" name="[CA-BBB-002] b critério"/>'
    + '<testcase classname="c" name="[CT-ZZZ-009] desconhecido"/>'
    + '</testsuite>',
};

test('--delivery: tests tagged with IDs of another spec of the delivery are not orphans; truly unknown ones are', async () => {
  const dir = await makeRepo(TWO_SPECS);
  const args = ['--spec', 'docs/specs/spec-aaa.md', '--qa', 'docs/qa/cenarios-qa-spec-aaa.md', '--json'];
  const withDelivery = JSON.parse((await cli(dir, ...args, '--delivery', 'ENT-001')).stdout);
  assert.deepEqual(withDelivery.orphanTests, ['[CT-ZZZ-009] desconhecido']);
  // Without --delivery (or with a delivery that has no folder) nothing changes: the other spec's tests stay orphans.
  const without = JSON.parse((await cli(dir, ...args)).stdout);
  assert.deepEqual(without.orphanTests, ['[CT-BBB-001] b cenário', '[CA-BBB-002] b critério', '[CT-ZZZ-009] desconhecido']);
  const otherEnt = JSON.parse((await cli(dir, ...args, '--delivery', 'ENT-002')).stdout);
  assert.equal(otherEnt.orphanTests.length, 3);
});

test('acceptance-report lists as unknown only the tests unknown to every spec of the delivery', async () => {
  const dir = await makeRepo(TWO_SPECS);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  // Traces made without the fix (or without --delivery) still carry the other spec's tests as orphans.
  const old = (code, cas) => ({
    head, spec: { path: `docs/specs/spec-${code.toLowerCase()}.md`, version: '1.0' }, delivery: 'ENT-001', filter: null,
    cas, orphanTests: [`[CT-${code === 'AAA' ? 'BBB' : 'AAA'}-001] outro`, '[CT-ZZZ-009] desconhecido'], summary: {},
  });
  const ok = (id) => ({ ca: id, status: 'proven', scenarios: [{ id, via: 'direct', automation: 'automatizado', result: 'passed', evidence: null }] });
  writeFileSync(join(dir, 'ta.json'), JSON.stringify(old('AAA', [ok('CA-AAA-001')])));
  writeFileSync(join(dir, 'tb.json'), JSON.stringify(old('BBB', [ok('CA-BBB-001')])));
  await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', 'ta.json', '--trace', 'tb.json', '--cwd', dir], capture().io);
  const md = readFileSync(join(dir, 'docs/entregas/ENT-001-a/aceite.md'), 'utf8');
  assert.match(md, /identificação desconhecida[^\n]*\[CT-ZZZ-009\] desconhecido/);
  assert.doesNotMatch(md, /outro/);
});

// E2E round C: every test file named for a scenario is carried to the trace.
test('a QA scenario carries every test file of its Automação line in the trace', async () => {
  const two = QA_CLEAN.replace('(`tests/e2e/empresa.spec.ts`)', '(`tests/e2e/empresa.spec.ts`, `tests/unit/empresa.test.ts`)');
  const r = byCa(await compute(two));
  assert.deepEqual(r['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').tests, ['tests/e2e/empresa.spec.ts', 'tests/unit/empresa.test.ts']);
  assert.deepEqual(r['CA-EMP-003'].scenarios.find((s) => s.id === 'CT-EMP-003').tests, []);
});

// E2E round C: a manual scenario linked only to a rule (RN) never showed up in the trace or acceptance.
const RN_ONLY = '\n### CT-EMP-005 | Isolamento entre tenants\n- **Contratos:** RN-EMP-001.\n- **Automação:** manual\n\n### CT-EMP-006 | Vínculo único\n- **Contratos:** RN-EMP-002.\n- **Automação:** automatizado (`tests/rn.test.ts`)\n\n';
const withRn = (qa) => qa.replace('## 8. Evidências', `${RN_ONLY}## 8. Evidências`);

test('scenarios linked to no CA of the spec are listed with their result in otherScenarios', async () => {
  const r = await compute(withRn(QA_CLEAN));
  assert.deepEqual(r.otherScenarios.map((s) => [s.id, s.automation, s.result, s.contracts]), [
    ['CT-EMP-005', 'manual', 'manual_pending', ['RN-EMP-001']],
    ['CT-EMP-006', 'automatizado', 'not_run', ['RN-EMP-002']],
  ]);
  assert.deepEqual(r.otherScenarios[1].tests, ['tests/rn.test.ts']);
  const ev = withRn(QA_CLEAN) + '| CT-EMP-005 | reprovado | 2026-11-13 | homologação | ENT-001 |\n';
  const failed = await compute(ev, XML + '');
  assert.equal(failed.otherScenarios[0].result, 'manual_fail');
  assert.deepEqual(failed.otherScenarios[0].evidence, { date: '2026-11-13', where: 'homologação', delivery: 'ENT-001' });
});

// 1.10.0: a specialist scenario keeps manual_pending but is flagged, with or without a CA.
test('a specialist scenario keeps manual_pending and is flagged specialist, with its kind; others carry no flag', async () => {
  const qa = withRn(QA).replace('- **AUTOMAÇÃO:** manual\n', '- **AUTOMAÇÃO:** manual, especialista: leitor de tela\n')
    .replace('- **Automação:** manual\n\n### CT-EMP-006', '- **Automação:** manual, especialista\n\n### CT-EMP-006');
  const r = await compute(qa);
  const s2 = byCa(r)['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-002');
  assert.deepEqual([s2.result, s2.specialist, s2.specialistKind], ['manual_pending', true, 'leitor de tela']);
  const s5 = r.otherScenarios.find((s) => s.id === 'CT-EMP-005');
  assert.deepEqual([s5.result, s5.specialist, 'specialistKind' in s5], ['manual_pending', true, false]);
  const s1 = byCa(r)['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001');
  assert.equal('specialist' in s1, false);
  assert.equal(byCa(r)['CA-EMP-001'].status, 'pending');
});

// Review: a rejected automated scenario without a JUnit match must not read as "not run".
test('a rejected evidence row fails an automated scenario that has no JUnit match, with or without a CA', async () => {
  const rej = withRn(QA_CLEAN) + '| CT-EMP-006 | reprovado | 2026-11-13 | homologação | ENT-001 |\n| CT-EMP-001 | reprovado | 2026-11-13 | homologação | ENT-001 |\n';
  const r = await compute(rej, '<testsuite/>');
  assert.equal(r.otherScenarios.find((s) => s.id === 'CT-EMP-006').result, 'manual_fail');
  assert.equal(byCa(r)['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').result, 'manual_fail');
  assert.equal(byCa(r)['CA-EMP-001'].status, 'failed');
  // An approved row does not stand in for an automated test that did not run.
  const ok = await compute(withRn(QA_CLEAN) + '| CT-EMP-006 | aprovado | 2026-11-13 | homologação | ENT-001 |\n', '<testsuite/>');
  assert.equal(ok.otherScenarios.find((s) => s.id === 'CT-EMP-006').result, 'not_run');
});

// E2E round D: two CAs whose "Então" is what the person sees were proven only by rule tests tagged
// with the browser scenario's ID. A scenario that declares its layer in the Automação line is proven
// only by a test of that layer: a browser scenario by a case from a file declared for `navegador`.
const layered = (layer, extra = '') => QA_CLEAN.replace(
  '- **Automação:** automatizado (`tests/e2e/empresa.spec.ts`)',
  `- **Automação:** automatizado, camada \`${layer}\` (\`tests/e2e/empresa.spec.ts\`)${extra}`,
);
const junitOf = (...cases) => `<testsuites><testsuite>${cases.map(([name, classname, failed]) => `<testcase name="${name}" classname="${classname}">${failed ? '<failure message="x"/>' : ''}</testcase>`).join('')}<testcase name="[CA-EMP-003] c" classname="test"/></testsuite></testsuites>`;

test('the layer of a scenario is read from its Automação line', async () => {
  const dir = await repo({ 'qa.md': layered('navegador').replace('- **Automacao:** pendente', '- **Automacao:** automatizado, camada Regra (`tests/unit/x.test.ts`)') });
  const qa = readQa(join(dir, 'qa.md'));
  assert.equal(qa.scenarios.find((s) => s.id === 'CT-EMP-001').layer, 'navegador');
  assert.equal(qa.scenarios.find((s) => s.id === 'CT-EMP-003').layer, 'regra');
  assert.deepEqual(qa.scenarios.find((s) => s.id === 'CT-EMP-001').testRefs, ['tests/e2e/empresa.spec.ts']);
  assert.equal(readQa(join(await repo(), 'qa.md')).scenarios.find((s) => s.id === 'CT-EMP-001').layer, null, 'no layer word: null');
});

test('a browser scenario passed only by a test outside its browser files is layer_mismatch and fails the CA', async () => {
  const r = byCa(await compute(layered('navegador'), junitOf(['[CT-EMP-001] regra', 'tests/unit/empresa.test.ts'])));
  const sc = r['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001');
  assert.equal(sc.result, 'layer_mismatch');
  assert.equal(sc.layer, 'navegador');
  assert.equal(r['CA-EMP-001'].status, 'failed');
  // A runner that names no file (node:test) cannot prove a browser scenario either.
  assert.equal(byCa(await compute(layered('navegador'), junitOf(['[CT-EMP-001] regra', 'test'])))['CA-EMP-001'].status, 'failed');
  // A failing case from the wrong file is still a failure, not a layer question.
  const failing = byCa(await compute(layered('navegador'), junitOf(['[CT-EMP-001] regra', 'tests/unit/empresa.test.ts', true])));
  assert.equal(failing['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').result, 'failed');
});

test('a browser scenario is proven by a case from its declared file, also with a path relative to the test folder', async () => {
  for (const classname of ['tests/e2e/empresa.spec.ts', 'empresa.spec.ts', './tests/e2e/empresa.spec.ts']) {
    const r = byCa(await compute(layered('navegador'), junitOf(['grupo › [CT-EMP-001] tela', classname], ['[CT-EMP-001] regra', 'tests/unit/empresa.test.ts'])));
    assert.equal(r['CA-EMP-001'].status, 'proven', classname);
  }
});

test('a rule scenario fails the layer check only when its test is known to be a browser test; no layer, no check', async () => {
  // CT-EMP-003 is a browser scenario of the same QA, so its file is a browser file.
  const qa = layered('regra').replace('- **Automacao:** pendente', '- **Automacao:** automatizado, camada `navegador` (`tests/e2e/outro.spec.ts`)');
  const inBrowser = byCa(await compute(qa, junitOf(['[CT-EMP-001] x', 'tests/e2e/outro.spec.ts'])));
  assert.equal(inBrowser['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').result, 'layer_mismatch');
  assert.equal(byCa(await compute(qa, junitOf(['[CT-EMP-001] x', 'test'])))['CA-EMP-001'].status, 'proven', 'no file named: benefit of the doubt');
  assert.equal(byCa(await compute(qa, junitOf(['[CT-EMP-001] x', 'tests/unit/a.test.ts'])))['CA-EMP-001'].status, 'proven');
  // Without a layer word the old behavior stays: any passing case with the ID proves the scenario.
  assert.equal(byCa(await compute(QA_CLEAN, junitOf(['[CT-EMP-001] regra', 'tests/unit/empresa.test.ts'])))['CA-EMP-001'].status, 'proven');
});

// PR review: a declared browser layer with no browser file declared, or a file name shared by both
// layers, must not prove the browser scenario.
test('a navegador scenario with no browser path declared is never proven by a rule test', async () => {
  const qa = QA_CLEAN.replace('- **Automação:** automatizado (`tests/e2e/empresa.spec.ts`)', '- **Automação:** automatizado, camada `navegador`');
  const r = byCa(await compute(qa, junitOf(['[CT-EMP-001] regra', 'tests/unit/a.test.ts'])));
  assert.equal(r['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').result, 'layer_mismatch');
  assert.equal(r['CA-EMP-001'].status, 'failed');
});

test('a short file name declared for both layers proves neither as a browser test', async () => {
  const qa = layered('navegador').replace('- **Automacao:** pendente', '- **Automacao:** automatizado, camada `regra` (`tests/unit/empresa.spec.ts`)');
  const short = byCa(await compute(qa, junitOf(['[CT-EMP-001] x', 'empresa.spec.ts'])));
  assert.equal(short['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').result, 'layer_mismatch', 'ambiguous: not browser proof');
  const full = byCa(await compute(qa, junitOf(['[CT-EMP-001] x', 'tests/e2e/empresa.spec.ts'])));
  assert.equal(full['CA-EMP-001'].status, 'proven', 'the full path is unambiguous');
  const rule = byCa(await compute(qa, junitOf(['[CT-EMP-001] x', 'tests/unit/empresa.spec.ts'])));
  assert.equal(rule['CA-EMP-001'].scenarios.find((s) => s.id === 'CT-EMP-001').result, 'layer_mismatch');
});

test('trace CLI: a layer mismatch exits 1 and names the cause', async () => {
  const dir = await repo({ 'qa.md': layered('navegador'), '.baco/junit/a.xml': junitOf(['[CT-EMP-001] regra', 'tests/unit/empresa.test.ts']) });
  const r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /CT-EMP-001=passou só fora da camada declarada/);
});

test('trace CLI: pending rule scenarios are listed; a failed one exits 1; --ca leaves them out', async () => {
  const green = '<testsuite><testcase name="[CT-EMP-001] a"/><testcase name="[CA-EMP-002] b"/><testcase name="[CA-EMP-003] c"/></testsuite>';
  const dir = await repo({ 'qa.md': withRn(QA_CLEAN), '.baco/junit/a.xml': green });
  let r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--json');
  let data = JSON.parse(r.stdout);
  assert.deepEqual(data.otherScenarios.map((s) => s.id), ['CT-EMP-005', 'CT-EMP-006']);
  const text = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md');
  assert.match(text.stdout, /sem critério de aceite[^\n]*CT-EMP-005=aguardando execução[^\n]*CT-EMP-006=ainda não rodou/);
  const before = r.code;
  writeFileSync(join(dir, 'qa.md'), withRn(QA_CLEAN) + '| CT-EMP-005 | reprovado | 2026-11-13 | homologação | ENT-001 |\n');
  r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--json');
  assert.equal(before, 0);
  assert.equal(r.code, 1);
  r = await cli(dir, '--spec', 'spec.md', '--qa', 'qa.md', '--ca', 'CA-EMP-001', '--json');
  data = JSON.parse(r.stdout);
  assert.deepEqual(data.otherScenarios, []);
});
