import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, commit } from './helpers/tmprepo.mjs';
import { readQa } from '../skills/baco-sdd/scripts/lib/qa.mjs';
import { readPlanOutOfScope, readPlanScope } from '../skills/baco-sdd/scripts/lib/delivery.mjs';
import { readPlanApproval } from '../skills/baco-sdd/scripts/lib/plan-approval.mjs';
import { traceCoverage } from '../skills/baco-sdd/scripts/commands/trace.mjs';
import { mergeDecision, pendingItems, outOfScopeItems, renderAcceptance, planScopeBlockers } from '../skills/baco-sdd/scripts/commands/acceptance-report.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';

const capture = () => {
  let stdout = '';
  let stderr = '';
  return {
    out: () => ({ stdout, stderr }),
    io: { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } },
  };
};

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

test('readQa parses only "fora desta entrega" as out_of_scope (not legacy/English phrases)', async (t) => {
  const dir = await makeRepo({
    'qa.md': [
      '# Cenários',
      '',
      '### CT-001 | Construído',
      '- **Contratos:** CA-001',
      '- **Automação:** automatizado (`tests/a.test.mjs`)',
      '',
      '### CT-002 | Não construído',
      '- **Contratos:** CA-002',
      '- **Automação:** fora desta entrega (função prevista na próxima fase)',
      '',
      '### CT-003 | Frase antiga não reconhecida',
      '- **Contratos:** CA-003',
      '- **Automação:** out of scope: not built yet',
      '',
      '### CT-004 | Manual de verdade',
      '- **Contratos:** CA-004',
      '- **Automação:** manual',
    ].join('\n'),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const qa = readQa(join(dir, 'qa.md'));
  assert.equal(qa.scenarios[0].automation, 'automatizado');
  assert.equal(qa.scenarios[1].automation, 'out_of_scope');
  assert.equal(qa.scenarios[2].automation, null);
  assert.equal(qa.scenarios[3].automation, 'manual');
});

test('readPlanScope accepts only T-NNN as real tasks, only "fora desta entrega" as out of scope, and warns on free text', () => {
  const plan = [
    '# Plano | ENT-002 `recorte`',
    '',
    '**Specs:** docs/specs/spec-x.md@1.0',
    '**Fora desta entrega:** CA-010-012, CA-020',
    '**Out of scope:** CA-099',
    '',
    '## Cobertura',
    '',
    '| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |',
    '|---|---|---|---|',
    '| `CA-001` | `T-001` | `CT-001` | `regra` |',
    '| `CA-002` | `fora desta entrega` | `CT-002` | `-` |',
    '| `CA-003` | `fora do plano (próxima entrega)` | `CT-003` | `-` |',
    '| `CA-004` | `nenhuma` | `CT-004` | `-` |',
    '| `CA-005` | `próxima entrega` | `CT-005` | `-` |',
    '| `CA-006` | `-` | `CT-006` | `-` |',
  ].join('\n');
  const scope = readPlanScope(plan);
  assert.deepEqual([...scope.outOfScope].sort(), ['CA-002', 'CA-010', 'CA-011', 'CA-012', 'CA-020']);
  assert.deepEqual([...readPlanOutOfScope(plan)].sort(), ['CA-002', 'CA-010', 'CA-011', 'CA-012', 'CA-020']);
  assert.deepEqual([...scope.coveredByTask].sort(), ['CA-001']);
  assert.equal(scope.coveredByTask.has('CA-003'), false, 'free text is not a real task');
  assert.equal(scope.coveredByTask.has('CA-004'), false, 'nenhuma is not a real task');
  assert.equal(scope.coveredByTask.has('CA-005'), false, 'próxima entrega is not a real task');
  assert.equal(scope.outOfScope.has('CA-003'), false);
  assert.equal(scope.outOfScope.has('CA-099'), false);
  assert.deepEqual(scope.contradictions, []);
  assert.deepEqual(scope.unrecognizedTasks.map((u) => u.cas), [['CA-003'], ['CA-004'], ['CA-005']]);
});

test('readPlanScope flags contradiction only when out-of-scope CA also has a T-NNN task in Cobertura', () => {
  const plan = [
    '# Plano | ENT-002 `recorte`',
    '',
    '**Specs:** docs/specs/spec-x.md@1.0',
    '**Fora desta entrega:** CA-002',
    '',
    '## Cobertura',
    '',
    '| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |',
    '|---|---|---|---|',
    '| `CA-001` | `T-001` | `CT-001` | `regra` |',
    '| `CA-002` | `T-002` | `CT-002` | `regra` |',
    '| `CA-003` | `T-003` | `CT-003` | `regra` |',
    '| `CA-003` | `fora desta entrega` | `CT-003` | `-` |',
    '| `CA-004` | `próxima entrega` | `CT-004` | `-` |',
  ].join('\n');
  const scope = readPlanScope(plan);
  assert.deepEqual(scope.contradictions, ['CA-002', 'CA-003']);
  assert.deepEqual(scope.unrecognizedTasks.map((u) => u.cas), [['CA-004']]);
});

test('traceCoverage handles mixed scenarios on one CA (in-scope passed + out_of_scope scenario => CA proven)', () => {
  const spec = {
    definitions: [
      { id: 'CA-001', kind: 'CA' },
      { id: 'CA-002', kind: 'CA' },
      { id: 'CA-003', kind: 'CA' },
      { id: 'CA-004', kind: 'CA' },
      { id: 'RN-001', kind: 'RN' },
    ],
  };
  const qa = {
    scenarios: [
      { id: 'CT-001', contracts: ['CA-001'], automation: 'automatizado', testRefs: [] },
      { id: 'CT-003', contracts: ['CA-001'], automation: 'out_of_scope', testRefs: [] },
      { id: 'CT-002', contracts: ['CA-002'], automation: 'out_of_scope', testRefs: [] },
      { id: 'CT-006', contracts: ['CA-003'], automation: 'manual', testRefs: [] },
      { id: 'CT-004', contracts: ['CA-004'], automation: 'out_of_scope', testRefs: [] },
      { id: 'CT-005', contracts: ['RN-001'], automation: 'out_of_scope', testRefs: [] },
    ],
    evidence: [],
  };
  const cases = [
    { name: '[CT-001] ok', status: 'passed' },
    { name: '[CT-004] unexpected failure', status: 'failed' },
  ];
  const r = traceCoverage({ spec, qa, cases, outOfScope: new Set(['CA-003']) });
  assert.equal(r.cas.find((c) => c.ca === 'CA-001').status, 'proven');
  assert.equal(r.cas.find((c) => c.ca === 'CA-002').status, 'out_of_scope');
  assert.equal(r.cas.find((c) => c.ca === 'CA-003').status, 'out_of_scope');
  assert.equal(r.cas.find((c) => c.ca === 'CA-003').scenarios[0].result, 'out_of_scope');
  assert.equal(r.cas.find((c) => c.ca === 'CA-004').status, 'failed');
  assert.equal(r.otherScenarios[0].result, 'out_of_scope');
  assert.deepEqual(r.summary, { proven: 1, failed: 1, pending: 0, uncovered: 0, out_of_scope: 2 });
  assert.deepEqual(outOfScopeItems(r), { cas: ['CA-002', 'CA-003'], scenarios: ['CT-003', 'CT-005'] });
});

test('mergeDecision and renderAcceptance exclude out_of_scope from manual_pending and list it in its own section', () => {
  const tr = {
    cas: [
      {
        ca: 'CA-001',
        status: 'proven',
        scenarios: [
          { id: 'CT-001', via: 'qa', automation: 'automatizado', result: 'passed', evidence: null },
          { id: 'CT-010', via: 'qa', automation: 'out_of_scope', result: 'out_of_scope', evidence: null },
        ],
      },
      { ca: 'CA-002', status: 'out_of_scope', scenarios: [{ id: 'CT-002', via: 'qa', automation: 'out_of_scope', result: 'out_of_scope', evidence: null }] },
      { ca: 'CA-003', status: 'out_of_scope', scenarios: [] },
    ],
    otherScenarios: [
      { id: 'CT-099', contracts: ['RN-001'], automation: 'out_of_scope', result: 'out_of_scope', evidence: null },
    ],
    orphanTests: [],
  };
  assert.deepEqual(pendingItems(tr), { manual: [], auto: [], specialist: [] });
  assert.deepEqual(outOfScopeItems(tr), { cas: ['CA-002', 'CA-003'], scenarios: ['CT-010', 'CT-099'] });

  const verdict = { verdict: 'aprovado', findings: [] };
  const decision = mergeDecision({ trace: tr, verdict, rule: 'block' });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.blockers, []);

  const md = renderAcceptance({ entId: 'ENT-002', target: 'main', trace: tr, verdict, decision, lang: 'pt-BR' });
  assert.match(md, /## Fora desta entrega/);
  assert.match(md, /CA-002/);
  assert.match(md, /CA-003/);
  assert.match(md, /CT-010/);
  assert.match(md, /CT-099/);
  assert.match(md, /Nenhum teste manual pendente\./);
  const criteriaSection = md.slice(md.indexOf('## Critérios de aceite'), md.indexOf('## Testes manuais'));
  assert.match(criteriaSection, /CA-001/);
  assert.doesNotMatch(criteriaSection, /CA-002/);
});

test('mergeDecision still blocks with merge.no_criteria when every CA is out_of_scope', () => {
  const tr = {
    cas: [{ ca: 'CA-001', status: 'out_of_scope', scenarios: [] }],
    otherScenarios: [],
    orphanTests: [],
  };
  const decision = mergeDecision({ trace: tr, verdict: { verdict: 'aprovado', findings: [] }, rule: 'block' });
  assert.equal(decision.allowed, false);
  assert.ok(decision.blockers.includes('merge.no_criteria'));
});

test('trace exits 1 on contradiction and warns on unrecognized free-text markers in Cobertura', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\n',
    'docs/specs/spec-a.md': '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Um.\n- **CA-002:** Dois.\n- **CA-003:** Três.\n',
    'docs/qa/cenarios-qa-spec-a.md': '# QA\n\n### CT-001 | Ok\n- **Contratos:** CA-001\n- **Automação:** automatizado\n\n### CT-002 | Dois\n- **Contratos:** CA-002\n- **Automação:** manual\n\n### CT-003 | Três\n- **Contratos:** CA-003\n- **Automação:** manual\n',
    'docs/entregas/ENT-001-fatia/plano.md': '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n**Fora desta entrega:** CA-002\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `T-002` | `CT-002` | `regra` |\n| `CA-003` | `próxima entrega` | `CT-003` | `-` |\n',
    '.baco/junit/a.xml': '<testsuite><testcase classname="a" name="[CT-001] ok"/></testsuite>\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = capture();
  const code = await main([
    'trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md',
    '--delivery', 'ENT-001', '--cwd', dir,
  ], c.io);
  assert.equal(code, 1);
  assert.match(c.out().stdout, /fora desta entrega/);
  assert.match(c.out().stdout, /próxima entrega/);

  const c2 = capture();
  const code2 = await main(['approve-plan', 'ENT-001', '--by', 'Ana', '--json', '--cwd', dir], c2.io);
  assert.equal(code2, 1);
});

// A criterion marked out of this delivery whose function already exists (a passing test or an
// approved manual run) is a contradiction: the mark would hide a built function from the person.
const BUILT_PLAN = '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `fora desta entrega` | `CT-002` | `-` |\n';
async function builtRepo(t, { junit = '', evidence = '', plan = BUILT_PLAN } = {}) {
  const dir = await makeRepo({
    '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\n',
    'docs/specs/spec-a.md': '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Ok.\n- **CA-002:** Já existe.\n',
    'docs/qa/cenarios-qa-spec-a.md': [
      '# QA', '',
      '### CT-001 | Ok', '- **Contratos:** CA-001', '- **Automação:** automatizado', '',
      '### CT-002 | Já existe', '- **Contratos:** CA-002', '- **Automação:** fora desta entrega', '',
      evidence,
    ].join('\n'),
    'docs/entregas/ENT-001-fatia/plano.md': plan,
    '.baco/junit/a.xml': `<testsuite><testcase classname="a" name="[CT-001] ok"/>${junit}</testsuite>\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = capture();
  const code = await main([
    'trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md',
    '--delivery', 'ENT-001', '--json', '--cwd', dir,
  ], c.io);
  return { dir, code, data: JSON.parse(c.out().stdout) };
}

test('built function marked out of scope: a passing test makes trace fail and blocks the merge as a contradiction', async (t) => {
  const { dir, code, data } = await builtRepo(t, { junit: '<testcase classname="a" name="[CT-002] existe"/>' });
  assert.equal(code, 1);
  assert.deepEqual(data.builtOutOfScope, ['CA-002']);
  const planText = readFileSync(join(dir, 'docs/entregas/ENT-001-fatia/plano.md'), 'utf8');
  const check = planScopeBlockers({ root: dir, planText, config: {}, trace: data, approval: null });
  assert.ok(check.blockers.includes('merge.out_of_scope_built'), check.blockers.join(', '));
  assert.deepEqual(check.built, ['CA-002']);
  // the message names the proof, so the person sees why
  assert.equal(check.params['merge.out_of_scope_built'].ids, 'CA-002 (CT-002)');
});

test('built function marked only in QA (every scenario out of scope) with a direct test: trace and acceptance agree', async (t) => {
  const plan = BUILT_PLAN.replace('| `CA-002` | `fora desta entrega` | `CT-002` | `-` |\n', '');
  const { dir, code, data } = await builtRepo(t, { plan, junit: '<testcase classname="a" name="[CA-002] existe"/>' });
  assert.equal(code, 1);
  assert.deepEqual(data.builtOutOfScope, ['CA-002']);
  const check = planScopeBlockers({ root: dir, planText: plan, config: {}, trace: data, approval: null });
  assert.deepEqual(check.built, ['CA-002']);
});

test('regressão in the Tarefa column: a function built earlier is neither unmarked nor an unrecognized marker', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\n',
    'docs/specs/spec-a.md': '# Spec A\n\n- **Versão:** 1.0\n\n- **CA-001:** Ok.\n- **CA-002:** Antiga.\n',
    'docs/qa/cenarios-qa-spec-a.md': '# QA\n\n### CT-001 | Ok\n- **Contratos:** CA-001\n- **Automação:** automatizado\n',
    'docs/entregas/ENT-001-fatia/plano.md': '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `regressão` | `-` | `-` |\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = capture();
  assert.equal(await main(['plan-freshness', 'ENT-001', '--json', '--cwd', dir], f.io), 0, f.out().stderr);
  assert.equal(JSON.parse(f.out().stdout).unmarked, undefined);
  const scope = readPlanScope(readFileSync(join(dir, 'docs/entregas/ENT-001-fatia/plano.md'), 'utf8'));
  assert.deepEqual(scope.unrecognizedTasks, []);
});

test('acceptance summary leaves out the not-yet-built part when there is none', () => {
  const spec = { definitions: [{ kind: 'CA', id: 'CA-001' }] };
  const qa = { evidence: [], scenarios: [{ id: 'CT-001', contracts: ['CA-001'], testRefs: [], automation: 'automatizado' }] };
  const trace = traceCoverage({ spec, qa, cases: [{ name: '[CT-001] ok', status: 'passed' }] });
  const decision = mergeDecision({ trace, verdict: { verdict: 'aprovado' }, rule: 'block' });
  const md = renderAcceptance({ entId: 'ENT-001', target: 'develop', trace, verdict: { verdict: 'aprovado' }, decision });
  assert.ok(md.includes('1 critério provado, 0 testes manuais por fazer.'), md.slice(0, 600));
  assert.ok(!md.includes('ainda não construída'));
});

test('built function marked out of scope: an approved manual run of this delivery is a contradiction too', async (t) => {
  const evidence = '## Evidências de execução\n\n| CT | Resultado | Data | Onde | Entrega |\n|---|---|---|---|---|\n| CT-002 | aprovado | 2026-11-20 | homologação | ENT-001 |\n';
  const { code, data } = await builtRepo(t, { evidence });
  assert.equal(code, 1);
  assert.deepEqual(data.builtOutOfScope, ['CA-002']);
});

const otherDeliveryEvidence = '## Evidências de execução\n\n| CT | Resultado | Data | Onde | Entrega |\n|---|---|---|---|---|\n| CT-002 | aprovado | 2026-11-20 | homologação | ENT-002 |\n';
async function traceText(dir) {
  const c = capture();
  const code = await main([
    'trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md',
    '--delivery', 'ENT-001', '--cwd', dir,
  ], c.io);
  return { code, stdout: c.out().stdout };
}

test('trace warns, without failing, when an out-of-scope scenario has an approved manual run of another delivery', async (t) => {
  const { dir, code, data } = await builtRepo(t, { evidence: otherDeliveryEvidence });
  assert.equal(code, 0);
  assert.equal(data.builtOutOfScope, undefined);
  const { code: textCode, stdout } = await traceText(dir);
  assert.equal(textCode, 0);
  assert.match(stdout, /CT-002/);
  assert.match(stdout, /ENT-002/);
  assert.match(stdout, /outra entrega/);
});

test('trace gives no other-delivery warning when the evidence is rejected, or without --delivery', async (t) => {
  const rejected = otherDeliveryEvidence.replace('aprovado', 'reprovado');
  const { dir } = await builtRepo(t, { evidence: rejected });
  assert.doesNotMatch((await traceText(dir)).stdout, /outra entrega/);
  const { dir: dir2 } = await builtRepo(t, { evidence: otherDeliveryEvidence });
  const c = capture();
  await main(['trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md', '--cwd', dir2], c.io);
  assert.doesNotMatch(c.out().stdout, /outra entrega/);
});

test('out of scope without proof stays a plain out-of-scope criterion (no contradiction)', async (t) => {
  const { code, data } = await builtRepo(t);
  assert.equal(code, 0);
  assert.equal(data.builtOutOfScope, undefined);
  assert.equal(data.cas.find((c) => c.ca === 'CA-002').status, 'out_of_scope');
});

test('approve-plan warns about criteria of the plan specs with neither a task nor the out-of-scope mark', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\n',
    'docs/specs/spec-a.md': '# Spec A\n\n- **Versão:** 1.0\n\n- **CA-001:** Ok.\n- **CA-002:** Fora.\n- **CA-003:** Sem marca.\n- **CA-004:** Sem marca.\n',
    'docs/qa/cenarios-qa-spec-a.md': '# QA\n\n### CT-001 | Ok\n- **Contratos:** CA-001\n- **Automação:** automatizado\n',
    'docs/entregas/ENT-001-fatia/plano.md': '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n**Fora desta entrega:** CA-002\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Before the plan is presented: plan-freshness already warns, without failing.
  const f = capture();
  assert.equal(await main(['plan-freshness', 'ENT-001', '--json', '--cwd', dir], f.io), 0, f.out().stderr);
  assert.deepEqual(JSON.parse(f.out().stdout).unmarked, ['CA-003', 'CA-004']);
  const c = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Ana', '--json', '--cwd', dir], c.io), 0, c.out().stderr);
  assert.deepEqual(JSON.parse(c.out().stdout).unmarked, ['CA-003', 'CA-004']);
  const c2 = capture();
  await main(['approve-plan', 'ENT-001', '--by', 'Ana', '--replace', '--cwd', dir], c2.io);
  assert.match(c2.out().stdout + c2.out().stderr, /CA-003, CA-004/);
});

test('acceptance summary in plain words: proven, not yet built and manual tests to do (63 scenarios: 57 future, 6 manual of which 1 is for a specialist)', () => {
  const ids = Array.from({ length: 63 }, (_, i) => String(i + 1).padStart(3, '0'));
  const spec = { definitions: ids.map((n) => ({ kind: 'CA', id: `CA-${n}` })) };
  const qa = {
    evidence: [],
    scenarios: ids.map((n, i) => ({
      id: `CT-${n}`, contracts: [`CA-${n}`], testRefs: [],
      automation: i < 57 ? 'out_of_scope' : 'manual',
      ...(i === 62 ? { specialist: true, specialistKind: 'leitor de tela' } : {}),
    })),
  };
  const trace = traceCoverage({ spec, qa });
  const kinds = ['leitor de tela'];
  assert.equal(pendingItems(trace, kinds).manual.length, 5);
  const decision = mergeDecision({ trace, verdict: { verdict: 'aprovado' }, rule: 'block', specialist: kinds });
  assert.deepEqual(decision.blockers, ['merge.manual_pending']);
  const md = renderAcceptance({ entId: 'ENT-003', target: 'main', trace, verdict: { verdict: 'aprovado' }, decision, specialist: kinds });
  assert.ok(md.includes('0 critérios provados, 57 critérios de funções ainda não construídas, 5 testes manuais por fazer.'), md.slice(0, 800));
});

async function setupOutOfScopeDelivery(t, { specText, qaText, planText, approve = false, approveBy = 'Ana', extraConfig = '' } = {}) {
  const defaultSpec = '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Ok.\n- **CA-002:** Futuro.\n- **CA-003:** Outro futuro.\n';
  const defaultQa = [
    '# QA',
    '',
    '### CT-001 | Ok',
    '- **Contratos:** CA-001',
    '- **Automação:** automatizado',
    '',
    '### CT-002 | Futuro',
    '- **Contratos:** CA-002',
    '- **Automação:** manual',
    '',
    '### CT-003 | Outro',
    '- **Contratos:** CA-003',
    '- **Automação:** manual',
  ].join('\n');
  const defaultPlan = [
    '# Plano | ENT-001 `fatia`',
    '',
    '**Specs:** docs/specs/spec-a.md@1.0',
    '**Fora desta entrega:** CA-002',
    '',
    '## Cobertura',
    '',
    '| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |',
    '|---|---|---|---|',
    '| `CA-001` | `T-001` | `CT-001` | `regra` |',
    '| `CA-002` | `fora desta entrega` | `CT-002` | `-` |',
    '| `CA-003` | `fora desta entrega` | `CT-003` | `-` |',
  ].join('\n');

  const repo = await makeRepo({
    '.gitignore': '.baco/junit/\n.baco/logs/\n',
    '.baco/config.yaml': [
      'branches:',
      '  main: main',
      '  integration: develop',
      'manual_pending:',
      '  main: block',
      '  other: block',
      'delivery:',
      '  target: integration',
      '  integration_merge: auto',
      extraConfig,
      '',
    ].join('\n'),
    'docs/specs/spec-a.md': specText ?? defaultSpec,
    'docs/qa/cenarios-qa-spec-a.md': qaText ?? defaultQa,
    'src/a.js': 'export const a = 1;\n',
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'checkout', '-q', '-b', 'develop');
  git(repo, 'checkout', '-q', '-b', 'baco/ENT-001');
  commit(repo, {
    'src/a.js': 'export const a = 2;\n',
    'docs/entregas/ENT-001-fatia/plano.md': planText ?? defaultPlan,
    'docs/entregas/ENT-001-fatia/progresso.md': '# Progresso\n\n## Esperando a pessoa\n\n| Item | Situação |\n|---|---|\n',
  }, 'plan and work');

  let approveOutput = '';
  if (approve) {
    const ca = capture();
    const args = ['approve-plan', 'ENT-001', '--by', approveBy, '--cwd', repo];
    const code = await main(args, ca.io);
    assert.equal(code, 0, ca.out().stderr + ca.out().stdout);
    approveOutput = ca.out().stdout;
    git(repo, 'add', 'docs/entregas/ENT-001-fatia/aprovacao-plano.md');
    git(repo, 'commit', '-q', '-m', 'approve plan');
  }

  mkdirSync(join(repo, '.baco/junit'), { recursive: true });
  writeFileSync(join(repo, '.baco/junit/a.xml'), '<testsuite><testcase classname="a" name="[CT-001] ok"/></testsuite>\n');
  const traceOut = join(repo, 'docs/entregas/ENT-001-fatia/revisao/trace-a.json');
  const ct = capture();
  const tc = await main([
    'trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md',
    '--delivery', 'ENT-001', '--out', traceOut, '--json', '--cwd', repo,
  ], ct.io);
  assert.equal(tc, 0, ct.out().stderr + ct.out().stdout);

  const head = git(repo, 'rev-parse', 'HEAD');
  const verdict = `# Veredito\n\n<!-- baco:parsed ${JSON.stringify({ verdict: 'aprovado', reviewedHead: head, source: 'agent', findings: [] })} -->\n`;
  commit(repo, {
    'docs/entregas/ENT-001-fatia/revisao/trace-a.json': readFileSync(traceOut, 'utf8'),
    'docs/entregas/ENT-001-fatia/revisao/veredito-01.md': verdict,
  }, 'review artifacts');
  const deliveryTip = git(repo, 'rev-parse', 'HEAD');
  mkdirSync(join(repo, '.baco/logs'), { recursive: true });
  writeFileSync(join(repo, '.baco/logs/bateria-completa.json'), JSON.stringify({
    head: deliveryTip,
    dirty: false,
    seconds: 5,
    layers: [{ layer: 'unit', exit: 0, failures: [] }],
  }));

  const logDir = mkdtempSync(join(tmpdir(), 'baco-oos-gh-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));
  const callsFile = join(logDir, 'calls.log');
  const bin = join(logDir, 'gh');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    headRefOid: ${JSON.stringify(deliveryTip)},
    baseRefName: 'develop',
    state: 'OPEN',
    statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  }));
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
process.exit(1);
`);
  chmodSync(bin, 0o755);
  return { repo, bin, callsFile, traceOut, approveOutput };
}

test('E: mixed scenarios on CA-001 (CT-001 passed, CT-003 fora desta entrega, T-001 in Cobertura) approves and merges cleanly', async (t) => {
  const { repo, bin, traceOut, approveOutput } = await setupOutOfScopeDelivery(t, {
    specText: '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Fluxo principal.\n',
    qaText: [
      '# QA',
      '',
      '### CT-001 | Caminho principal',
      '- **Contratos:** CA-001',
      '- **Automação:** automatizado',
      '',
      '### CT-003 | Caso futuro',
      '- **Contratos:** CA-001',
      '- **Automação:** fora desta entrega',
    ].join('\n'),
    planText: [
      '# Plano | ENT-001 `fatia`',
      '',
      '**Specs:** docs/specs/spec-a.md@1.0',
      '',
      '## Cobertura',
      '',
      '| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |',
      '|---|---|---|---|',
      '| `CA-001` | `T-001` | `CT-001` | `regra` |',
    ].join('\n'),
    approve: true,
  });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  // G: approve_plan.written counts both CAs and scenarios
  assert.match(approveOutput, /0 critério\(s\) e 1 cenário\(s\)/);

  const approval = readPlanApproval(join(repo, 'docs/entregas/ENT-001-fatia'));
  assert.equal(approval.gate, 'on');
  assert.equal('planSha256' in approval, false, 'planSha256 must be removed');
  assert.deepEqual(approval.specs, ['docs/specs/spec-a.md@1.0']);
  assert.deepEqual(approval.universeCas, ['docs/specs/spec-a.md#CA-001']);
  assert.deepEqual(approval.universeScenarios, ['docs/specs/spec-a.md#CT-001', 'docs/specs/spec-a.md#CT-003']);
  assert.deepEqual(approval.outOfScope, []);
  assert.deepEqual(approval.outOfScopeScenarios, ['CT-003']);

  const c1 = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c1.io), 0, c1.out().stdout);
  assert.equal(JSON.parse(c1.out().stdout).allowed, true);

  const c2 = capture();
  assert.equal(await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c2.io), 0, c2.out().stdout);
  assert.equal(JSON.parse(c2.out().stdout).merged, true);
});

test('B: approve-plan refuses to overwrite existing portrait without --replace, and overwrites with --replace', async (t) => {
  const { repo } = await setupOutOfScopeDelivery(t, { approve: true });

  const c1 = capture();
  const code1 = await main(['approve-plan', 'ENT-001', '--by', 'Outro', '--json', '--cwd', repo], c1.io);
  assert.equal(code1, 2);

  const c2 = capture();
  const code2 = await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--replace', '--json', '--cwd', repo], c2.io);
  assert.equal(code2, 0, c2.out().stderr + c2.out().stdout);
  const approval = readPlanApproval(join(repo, 'docs/entregas/ENT-001-fatia'));
  assert.equal(approval.by, 'Bia');
  assert.equal(approval.gate, 'on');
});

test('C: approve-plan with empty --by records gate off; blocks when out-of-scope is non-empty and passes when empty', async (t) => {
  const { repo, bin, callsFile, traceOut } = await setupOutOfScopeDelivery(t, {
    approve: true,
    approveBy: '',
    extraConfig: 'gates:\n  plan: off',
  });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const approval = readPlanApproval(join(repo, 'docs/entregas/ENT-001-fatia'));
  assert.equal(approval.gate, 'off');
  assert.equal(approval.by, '');

  const c1 = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c1.io), 2);
  assert.ok(JSON.parse(c1.out().stdout).blockers.includes('merge.out_of_scope_gate_off'));

  const c2 = capture();
  assert.equal(await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c2.io), 2);
  assert.equal(JSON.parse(c2.out().stdout).merged, false);
  const calls = readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.some((a) => a[0] === 'pr' && a[1] === 'merge'), false);

  // When gate is off AND nothing is out of scope, merge is allowed
  const clean = await setupOutOfScopeDelivery(t, {
    specText: '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Ok.\n',
    qaText: '# QA\n\n### CT-001 | Ok\n- **Contratos:** CA-001\n- **Automação:** automatizado\n',
    planText: '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n',
    approve: true,
    approveBy: '',
    extraConfig: 'gates:\n  plan: off',
  });
  process.env.BACO_GH = clean.bin;
  const c3 = capture();
  assert.equal(await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', clean.repo], c3.io), 0, c3.out().stdout);
  assert.equal(JSON.parse(c3.out().stdout).merged, true);
});

test('C: with gates.plan off, a first approve-plan ignores --by and records gate off; only --replace with a name records the person', async (t) => {
  const { repo, bin, traceOut } = await setupOutOfScopeDelivery(t, { extraConfig: 'gates:\n  plan: off' });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });
  const dir = join(repo, 'docs/entregas/ENT-001-fatia');

  const c1 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Pessoa', '--json', '--cwd', repo], c1.io), 0, c1.out().stderr + c1.out().stdout);
  let approval = readPlanApproval(dir);
  assert.equal(approval.gate, 'off');
  assert.equal(approval.by, '');

  const c2 = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c2.io), 2);
  assert.ok(JSON.parse(c2.out().stdout).blockers.includes('merge.out_of_scope_gate_off'));

  const c3 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Pessoa', '--replace', '--json', '--cwd', repo], c3.io), 0, c3.out().stderr + c3.out().stdout);
  approval = readPlanApproval(dir);
  assert.equal(approval.gate, 'on');
  assert.equal(approval.by, 'Pessoa');
});

test('A: prose change in plano.md passes; spec change, shrunk universe or changed out-of-scope blocks as human gate', async (t) => {
  const { repo, bin, traceOut } = await setupOutOfScopeDelivery(t, { approve: true });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const planPath = join(repo, 'docs/entregas/ENT-001-fatia/plano.md');
  const origPlan = readFileSync(planPath, 'utf8');
  const specPath = join(repo, 'docs/specs/spec-a.md');
  const origSpec = readFileSync(specPath, 'utf8');

  // 1. Prose-only edit to plano.md -> still passes!
  writeFileSync(planPath, `${origPlan}\nNota adicional sem mudar recorte.\n`);
  let c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c.io), 0, c.out().stdout);

  // 2. Spec version changed in plano.md -> merge.plan_specs_changed (exit 2)
  writeFileSync(planPath, origPlan.replace('spec-a.md@1.0', 'spec-a.md@1.1'));
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c.io), 2);
  assert.ok(JSON.parse(c.out().stdout).blockers.includes('merge.plan_specs_changed'));
  writeFileSync(planPath, origPlan);

  // 3. Universe shrank (CA-003 deleted from spec) -> merge.plan_universe_shrank (exit 2)
  writeFileSync(specPath, origSpec.replace('- **CA-003:** Outro futuro.\n', ''));
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c.io), 2);
  assert.ok(JSON.parse(c.out().stdout).blockers.includes('merge.plan_universe_shrank'));
  writeFileSync(specPath, origSpec);

  // 4. Out-of-scope set changed -> merge.out_of_scope_changed (exit 2)
  writeFileSync(planPath, origPlan.replace('**Fora desta entrega:** CA-002', '**Fora desta entrega:** CA-002, CA-004'));
  c = capture();
  assert.equal(await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c.io), 2);
  assert.ok(JSON.parse(c.out().stdout).blockers.includes('merge.out_of_scope_changed'));
});

test('unapproved out_of_scope blocks acceptance-report and merge-check --apply as human gate', async (t) => {
  const { repo, bin, callsFile, traceOut } = await setupOutOfScopeDelivery(t, { approve: false });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const c1 = capture();
  const code1 = await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c1.io);
  assert.equal(code1, 2, c1.out().stdout);
  assert.ok(JSON.parse(c1.out().stdout).blockers.includes('merge.out_of_scope_unapproved'));

  const c2 = capture();
  const code2 = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c2.io);
  assert.equal(code2, 2);
  assert.equal(JSON.parse(c2.out().stdout).merged, false);
  const calls = readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.some((a) => a[0] === 'pr' && a[1] === 'merge'), false);
});
