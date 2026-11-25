import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, commit } from './helpers/tmprepo.mjs';
import { readQa } from '../skills/baco-sdd/scripts/lib/qa.mjs';
import { readPlanOutOfScope } from '../skills/baco-sdd/scripts/lib/delivery.mjs';
import { traceCoverage } from '../skills/baco-sdd/scripts/commands/trace.mjs';
import { mergeDecision, pendingItems, outOfScopeItems, renderAcceptance } from '../skills/baco-sdd/scripts/commands/acceptance-report.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';

const capture = () => {
  let stdout = '';
  let stderr = '';
  return {
    out: () => ({ stdout, stderr }),
    io: { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } },
  };
};

test('readQa parses "fora desta entrega" and "out of scope" automation states', async (t) => {
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
      '### CT-003 | English marker',
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
  assert.equal(qa.scenarios[2].automation, 'out_of_scope');
  assert.equal(qa.scenarios[3].automation, 'manual');
});

test('readPlanOutOfScope reads header line and Cobertura table rows marked out of scope', () => {
  const plan = [
    '# Plano | ENT-002 `recorte`',
    '',
    '**Specs:** docs/specs/spec-x.md@1.0',
    '**Fora desta entrega:** CA-010-012, CA-020',
    '',
    '## Cobertura',
    '',
    '| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |',
    '|---|---|---|---|',
    '| `CA-001` | `T-001` | `CT-001` | `regra` |',
    '| `CA-002` | `fora desta entrega` | `CT-002` | `-` |',
    '| `CA-003` | `fora do plano (próxima entrega)` | `CT-003` | `-` |',
  ].join('\n');
  const set = readPlanOutOfScope(plan);
  assert.deepEqual([...set].sort(), ['CA-002', 'CA-003', 'CA-010', 'CA-011', 'CA-012', 'CA-020']);
});

test('traceCoverage marks out_of_scope CAs via QA or plan cutout, never as manual_pending, and still fails on failed tests', () => {
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
      { id: 'CT-002', contracts: ['CA-002'], automation: 'out_of_scope', testRefs: [] },
      { id: 'CT-003', contracts: ['CA-003'], automation: 'manual', testRefs: [] },
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
});

test('mergeDecision and renderAcceptance exclude out_of_scope from manual_pending and list it in its own section', () => {
  const tr = {
    cas: [
      { ca: 'CA-001', status: 'proven', scenarios: [{ id: 'CT-001', via: 'qa', automation: 'automatizado', result: 'passed', evidence: null }] },
      { ca: 'CA-002', status: 'out_of_scope', scenarios: [{ id: 'CT-002', via: 'qa', automation: 'out_of_scope', result: 'out_of_scope', evidence: null }] },
      { ca: 'CA-003', status: 'out_of_scope', scenarios: [] },
    ],
    otherScenarios: [
      { id: 'CT-099', contracts: ['RN-001'], automation: 'out_of_scope', result: 'out_of_scope', evidence: null },
    ],
    orphanTests: [],
  };
  assert.deepEqual(pendingItems(tr), { manual: [], auto: [], specialist: [] });
  assert.deepEqual(outOfScopeItems(tr), { cas: ['CA-002', 'CA-003'], scenarios: ['CT-099'] });

  const verdict = { verdict: 'aprovado', findings: [] };
  const decision = mergeDecision({ trace: tr, verdict, rule: 'block' });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.blockers, []);

  const md = renderAcceptance({ entId: 'ENT-002', target: 'main', trace: tr, verdict, decision, lang: 'pt-BR' });
  assert.match(md, /## Fora desta entrega/);
  assert.match(md, /CA-002/);
  assert.match(md, /CA-003/);
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

test('CLI trace --delivery uses plano.md out-of-scope cutout so merge-check does not block on main-rule manual_pending', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\nmanual_pending:\n  main: block\n  other: block\n',
    'docs/specs/spec-a.md': '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Construído.\n- **CA-002:** Não construído ainda.\n',
    'docs/qa/cenarios-qa-spec-a.md': '# QA\n\n### CT-001 | Ok\n- **Contratos:** CA-001\n- **Automação:** automatizado\n\n### CT-002 | Futuro\n- **Contratos:** CA-002\n- **Automação:** manual\n',
    'docs/entregas/ENT-001-fatia/plano.md': '# Plano | ENT-001 `fatia`\n\n**Specs:** docs/specs/spec-a.md@1.0\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `fora desta entrega` | `CT-002` | `-` |\n',
    '.baco/junit/a.xml': '<testsuite><testcase classname="a" name="[CT-001] ok"/></testsuite>\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const traceOut = join(dir, 'docs/entregas/ENT-001-fatia/revisao/trace-a.json');
  const c = capture();
  const code = await main([
    'trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md',
    '--delivery', 'ENT-001', '--out', traceOut, '--json', '--cwd', dir,
  ], c.io);
  assert.equal(code, 0, c.out().stderr);
  const parsed = JSON.parse(c.out().stdout);
  assert.equal(parsed.cas.find((x) => x.ca === 'CA-001').status, 'proven');
  assert.equal(parsed.cas.find((x) => x.ca === 'CA-002').status, 'out_of_scope');
  assert.equal(parsed.summary.out_of_scope, 1);
  assert.equal(parsed.summary.pending, 0);
});
