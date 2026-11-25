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

test('readPlanScope reads only 1.11.0 "fora desta entrega" markers and ignores legacy wording', () => {
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
    '| `CA-004` | `não construída` | `CT-004` | `-` |',
    '| `CA-005` | `out of scope` | `CT-005` | `-` |',
  ].join('\n');
  const scope = readPlanScope(plan);
  assert.deepEqual([...scope.outOfScope].sort(), ['CA-002', 'CA-010', 'CA-011', 'CA-012', 'CA-020']);
  assert.deepEqual([...readPlanOutOfScope(plan)].sort(), ['CA-002', 'CA-010', 'CA-011', 'CA-012', 'CA-020']);
  assert.equal(scope.outOfScope.has('CA-003'), false);
  assert.equal(scope.outOfScope.has('CA-004'), false);
  assert.equal(scope.outOfScope.has('CA-005'), false);
  assert.equal(scope.outOfScope.has('CA-099'), false);
  assert.deepEqual(scope.contradictions, []);
});

test('readPlanScope flags contradiction when a CA is both out of scope and assigned to a real task in Cobertura', () => {
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
  ].join('\n');
  const scope = readPlanScope(plan);
  assert.deepEqual(scope.contradictions, ['CA-002', 'CA-003']);
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

test('trace exits 1 when plano.md has a scope contradiction', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'branches:\n  main: main\n  integration: develop\n',
    'docs/specs/spec-a.md': '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Um.\n- **CA-002:** Dois.\n',
    'docs/qa/cenarios-qa-spec-a.md': '# QA\n\n### CT-001 | Ok\n- **Contratos:** CA-001\n- **Automação:** automatizado\n\n### CT-002 | Dois\n- **Contratos:** CA-002\n- **Automação:** manual\n',
    'docs/entregas/ENT-001-fatia/plano.md': '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n**Fora desta entrega:** CA-002\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `T-002` | `CT-002` | `regra` |\n',
    '.baco/junit/a.xml': '<testsuite><testcase classname="a" name="[CT-001] ok"/></testsuite>\n',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = capture();
  const code = await main([
    'trace', '--spec', 'docs/specs/spec-a.md', '--qa', 'docs/qa/cenarios-qa-spec-a.md',
    '--delivery', 'ENT-001', '--json', '--cwd', dir,
  ], c.io);
  assert.equal(code, 1);
  const parsed = JSON.parse(c.out().stdout);
  assert.deepEqual(parsed.scopeContradictions, ['CA-002']);

  // approve-plan also refuses a contradictory plan
  const c2 = capture();
  const code2 = await main(['approve-plan', 'ENT-001', '--by', 'Ana', '--json', '--cwd', dir], c2.io);
  assert.equal(code2, 1);
});

async function setupOutOfScopeDelivery(t, { planText, approve = false } = {}) {
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
      '',
    ].join('\n'),
    'docs/specs/spec-a.md': '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Ok.\n- **CA-002:** Futuro.\n- **CA-003:** Outro futuro.\n',
    'docs/qa/cenarios-qa-spec-a.md': [
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
    ].join('\n'),
    'src/a.js': 'export const a = 1;\n',
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'checkout', '-q', '-b', 'develop');
  git(repo, 'checkout', '-q', '-b', 'baco/ENT-001');
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
  commit(repo, {
    'src/a.js': 'export const a = 2;\n',
    'docs/entregas/ENT-001-fatia/plano.md': planText ?? defaultPlan,
    'docs/entregas/ENT-001-fatia/progresso.md': '# Progresso\n\n## Esperando a pessoa\n\n| Item | Situação |\n|---|---|\n',
  }, 'plan and work');

  if (approve) {
    const ca = capture();
    const code = await main(['approve-plan', 'ENT-001', '--by', 'Ana', '--json', '--cwd', repo], ca.io);
    assert.equal(code, 0, ca.out().stderr + ca.out().stdout);
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
  return { repo, bin, callsFile, traceOut };
}

test('unapproved out_of_scope blocks acceptance-report and merge-check --apply as human gate', async (t) => {
  const { repo, bin, callsFile, traceOut } = await setupOutOfScopeDelivery(t, { approve: false });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const c1 = capture();
  const code1 = await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c1.io);
  assert.equal(code1, 2, c1.out().stdout);
  const d1 = JSON.parse(c1.out().stdout);
  assert.equal(d1.allowed, false);
  assert.ok(d1.blockers.includes('merge.out_of_scope_unapproved'));

  const c2 = capture();
  const code2 = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c2.io);
  assert.equal(code2, 2);
  const d2 = JSON.parse(c2.out().stdout);
  assert.equal(d2.merged, false);
  const calls = readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.some((a) => a[0] === 'pr' && a[1] === 'merge'), false);
});

test('approved out_of_scope passes acceptance-report and merge-check --apply, and blocks if changed later', async (t) => {
  const { repo, bin, callsFile, traceOut } = await setupOutOfScopeDelivery(t, { approve: true });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const approval = readPlanApproval(join(repo, 'docs/entregas/ENT-001-fatia'));
  assert.ok(approval);
  assert.equal(approval.by, 'Ana');
  assert.deepEqual(approval.outOfScope, ['CA-002', 'CA-003']);
  assert.match(approval.planSha256, /^[0-9a-f]{64}$/);

  const c1 = capture();
  const code1 = await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c1.io);
  assert.equal(code1, 0, c1.out().stdout + c1.out().stderr);
  assert.equal(JSON.parse(c1.out().stdout).allowed, true);

  const c2 = capture();
  const code2 = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c2.io);
  assert.equal(code2, 0, c2.out().stdout + c2.out().stderr);
  assert.equal(JSON.parse(c2.out().stdout).merged, true);

  // Now sneak CA-001 into Fora desta entrega (or remove CA-003 from it) without re-approving the plan
  writeFileSync(
    join(repo, 'docs/entregas/ENT-001-fatia/plano.md'),
    '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n**Fora desta entrega:** CA-002\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `fora desta entrega` | `CT-002` | `-` |\n',
  );
  // Re-run trace so CA-003 is no longer out_of_scope (or add a new CA-004 to Fora desta entrega)
  writeFileSync(
    join(repo, 'docs/entregas/ENT-001-fatia/plano.md'),
    '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n**Fora desta entrega:** CA-002, CA-003, CA-004\n\n## Cobertura\n\n| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |\n|---|---|---|---|\n| `CA-001` | `T-001` | `CT-001` | `regra` |\n| `CA-002` | `fora desta entrega` | `CT-002` | `-` |\n| `CA-003` | `fora desta entrega` | `CT-003` | `-` |\n',
  );
  const c3 = capture();
  const code3 = await main(['acceptance-report', 'ENT-001', '--target', 'develop', '--trace', traceOut, '--json', '--cwd', repo], c3.io);
  assert.equal(code3, 2, c3.out().stdout);
  const d3 = JSON.parse(c3.out().stdout);
  assert.equal(d3.allowed, false);
  assert.ok(d3.blockers.includes('merge.out_of_scope_changed'));

  // And merge-check blocks as well
  const beforeMergeCount = readFileSync(callsFile, 'utf8').trim().split('\n').filter((l) => l.includes('"merge"')).length;
  const c4 = capture();
  const code4 = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c4.io);
  assert.equal(code4, 2);
  assert.equal(JSON.parse(c4.out().stdout).merged, false);
  const afterMergeCount = readFileSync(callsFile, 'utf8').trim().split('\n').filter((l) => l.includes('"merge"')).length;
  assert.equal(afterMergeCount, beforeMergeCount);
});
