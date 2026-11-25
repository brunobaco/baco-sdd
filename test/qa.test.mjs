import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { readQa, appendEvidence } from '../skills/baco-sdd/scripts/lib/qa.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';

const FIX_PATH = new URL('./fixtures/cenarios-qa-spec-exemplo.md', import.meta.url);
const FIX = readFileSync(FIX_PATH, 'utf8');
const tmpFile = (content) => {
  const p = join(makeTempDirSync('baco-qa-'), 'qa.md');
  writeFileSync(p, content);
  return p;
};
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

// E2E round C: a plan gave one scenario two test files and only the first was read.
test('readQa reads every backticked path of the Automação line', () => {
  const md = '# QA\n\n### CT-001 | dois arquivos\n\n- **Contratos:** CA-001\n- **Automação:** automatizado, camada `regra` (`tests/a.test.ts` e `tests/b.test.ts`; também `e2e/fluxo.spec.ts`)\n\n### CT-002 | um\n\n- **Contratos:** CA-001\n- **Automação:** automatizado (`tests/c.test.ts`)\n\n### CT-003 | manual\n\n- **Contratos:** RN-001\n- **Automação:** manual\n';
  const by = Object.fromEntries(readQa(tmpFile(md)).scenarios.map((s) => [s.id, s]));
  assert.deepEqual(by['CT-001'].testRefs, ['tests/a.test.ts', 'tests/b.test.ts', 'e2e/fluxo.spec.ts']);
  assert.equal(by['CT-001'].testRef, 'tests/a.test.ts');
  assert.deepEqual(by['CT-002'].testRefs, ['tests/c.test.ts']);
  assert.deepEqual(by['CT-003'].testRefs, []);
});

test('readQa marks a specialist scenario: `manual, especialista` with an optional kind', () => {
  const md = [
    '# QA', '',
    '### CT-001 | sem tipo', '', '- **Contratos:** CA-001', '- **Automação:** manual, especialista', '',
    '### CT-002 | com tipo', '', '- **Contratos:** CA-001', '- **Automação:** manual, Especialista: leitor de tela', '',
    '### CT-003 | manual comum', '', '- **Contratos:** CA-001', '- **Automação:** manual', '',
    '### CT-004 | automatizado não é especialista', '', '- **Contratos:** CA-001', '- **Automação:** automatizado (`tests/especialista.test.ts`)', '',
    '### CT-005 | tipo entre crases', '', '- **Contratos:** CA-001', '- **Automação:** manual, especialista: `contraste de cor`', '',
  ].join('\n');
  const file = tmpFile(md);
  const read = (specialist) => Object.fromEntries(readQa(file, { specialist }).scenarios.map((s) => [s.id, s]));
  // Two kinds configured: the kind must be one of them (folded); a marker without a kind is ordinary.
  let by = read(['Leitor de tela', 'contraste de cor']);
  assert.deepEqual([by['CT-001'].automation, by['CT-001'].specialist, by['CT-001'].specialistKind], ['manual', false, null]);
  assert.deepEqual([by['CT-002'].automation, by['CT-002'].specialist, by['CT-002'].specialistKind], ['manual', true, 'Leitor de tela']);
  assert.deepEqual([by['CT-003'].specialist, by['CT-003'].specialistKind], [false, null]);
  assert.deepEqual([by['CT-004'].specialist, by['CT-004'].specialistKind], [false, null]);
  assert.equal(by['CT-005'].specialistKind, 'contraste de cor');
  // One kind configured: a marker without a kind means that one; another kind is ordinary manual.
  by = read(['leitor de tela']);
  assert.deepEqual([by['CT-001'].specialist, by['CT-001'].specialistKind], [true, 'leitor de tela']);
  assert.equal(by['CT-002'].specialist, true);
  assert.deepEqual([by['CT-005'].specialist, by['CT-005'].specialistKind], [false, null]);
  // No kind configured (the default): nothing is a specialist scenario.
  for (const s of readQa(file).scenarios) assert.equal(s.specialist, false, s.id);
});

test('readQa: the specialist marker counts only at the start of the Automação value, with a known kind', () => {
  const md = [
    '# QA', '',
    '### CT-001 | no meio', '', '- **Contratos:** CA-001', '- **Automação:** manual, depois especialista: leitor de tela', '',
    '### CT-002 | outra palavra', '', '- **Contratos:** CA-001', '- **Automação:** manual, especialista em segurança', '',
    '### CT-003 | tipo com acento e caixa', '', '- **Contratos:** CA-001', '- **Automação:** **Manual, Especialista: LEITOR DE TÉLA** (navegador)', '',
    '### CT-004 | tipo desconhecido', '', '- **Contratos:** CA-001', '- **Automação:** manual, especialista: teste de segurança', '',
    '### CT-005 | não manual', '', '- **Contratos:** CA-001', '- **Automação:** pendente, especialista: leitor de tela', '',
  ].join('\n');
  const by = Object.fromEntries(readQa(tmpFile(md), { specialist: ['leitor de tela'] }).scenarios.map((s) => [s.id, s]));
  assert.deepEqual(Object.values(by).map((s) => s.specialist), [false, false, true, false, false]);
  assert.equal(by['CT-003'].specialistKind, 'leitor de tela');
  assert.equal(by['CT-004'].automation, 'manual', 'an unknown kind is an ordinary manual scenario');
});

test('readQa keeps a backticked test path with spaces; a layer label is still not a path', () => {
  const md = '# QA\n\n### CT-001 | x\n\n- **Contratos:** CA-001\n- **Automação:** automatizado, camada `regra` (`tests/order flow.test.ts`, `tests/other.test.ts`, `navegador`)\n';
  const [s] = readQa(tmpFile(md)).scenarios;
  assert.deepEqual(s.testRefs, ['tests/order flow.test.ts', 'tests/other.test.ts']);
  assert.equal(s.testRef, 'tests/order flow.test.ts');
});

test('readQa parses scenarios, contracts, automation and evidence', () => {
  const qa = readQa(FIX_PATH);
  assert.equal(qa.specVersion, '1.2');
  assert.equal(qa.scenarios.length, 4);
  const by = Object.fromEntries(qa.scenarios.map((s) => [s.id, s]));
  assert.ok(by['CT-EMP-003'].contracts.includes('CA-EMP-002'));
  assert.ok(by['CT-EMP-003'].contracts.includes('CA-EMP-003'));
  assert.equal(by['CT-EMP-001'].testRef, 'tests/e2e/empresa.spec.ts');
  assert.equal(by['CT-EMP-001'].automation, 'automatizado');
  assert.equal(by['CT-EMP-001'].title, 'Criar Empresa íntegra');
  assert.equal(by['CT-EMP-002'].automation, 'manual');
  assert.equal(by['CT-EMP-003'].automation, 'pendente');
  assert.equal(by['CT-EMP-004'].automation, null);
  assert.equal(by['CT-EMP-004'].testRef, null);
  const { line, ...ev } = qa.evidence[0];
  assert.ok(line > 0);
  assert.deepEqual(ev, { ct: 'CT-EMP-003', result: 'aprovado', date: '2026-10-28', where: 'homologação', delivery: 'ENT-001' });
});

test('appendEvidence appends a row and leaves other bytes untouched', () => {
  const out = appendEvidence(FIX, { ct: 'CT-EMP-001', result: 'reprovado', date: '2026-10-29', where: 'local', delivery: 'ENT-002' });
  assert.ok(out.startsWith(FIX.trimEnd()));
  const qa = readQa(tmpFile(out));
  assert.equal(qa.evidence.length, 2);
  assert.equal(qa.evidence[1].result, 'reprovado');
});

test('appendEvidence creates the section when absent, and inserts a table under a table-less heading', () => {
  const none = FIX.slice(0, FIX.indexOf('## 8.'));
  const a = appendEvidence(none, { ct: 'CT-EMP-001', result: 'aprovado', date: '2026-10-28', where: 'x', delivery: 'ENT-001' });
  assert.ok(a.includes('## Evidências de execução'));
  assert.equal(readQa(tmpFile(a)).evidence.length, 1);

  const bare = none + '## 8. Evidências de execução\n\n| Item | Situação |\n|---|---|\n| Testes executados | Nenhum |\n';
  const b = appendEvidence(bare, { ct: 'CT-EMP-001', result: 'aprovado', date: '2026-10-28', where: 'x', delivery: 'ENT-001' });
  assert.ok(b.includes('| Testes executados | Nenhum |'));
  assert.equal(readQa(tmpFile(b)).evidence.length, 1);
});

test('CLI qa-evidence records evidence and rejects unknown CT with 64', async () => {
  const dir = await makeRepo({ 'docs/qa/qa.md': FIX });
  const run = async (...a) => { const c = capture(); const code = await main([...a, '--cwd', dir], c.io); return code; };
  const base = ['qa-evidence', 'docs/qa/qa.md', '--result', 'aprovado', '--where', 'local', '--delivery', 'ENT-002'];
  assert.equal(await run(...base, '--ct', 'CT-EMP-001'), 0);
  assert.equal(readQa(join(dir, 'docs/qa/qa.md')).evidence.length, 2);
  assert.equal(await run(...base, '--ct', 'CT-EMP-999'), 64);
  assert.equal(readQa(join(dir, 'docs/qa/qa.md')).evidence.length, 2);
  const c = capture();
  await main([...base, '--ct', 'CT-EMP-002', '--json', '--cwd', dir], c.io);
  assert.deepEqual(JSON.parse(c.out.stdout), { ct: 'CT-EMP-002', result: 'aprovado' });
});

test('M4: appendEvidence appends to the LAST evidence table, so the new row is the latest by document order', () => {
  const two = `${FIX.trimEnd()}\n\n## Evidências antigas (outra rodada)\n\n| CT | Resultado | Data | Onde | Entrega |\n|---|---|---|---|---|\n| CT-EMP-001 | aprovado | 2026-10-27 | x | ENT-001 |\n\n## Fim\n`;
  const out = appendEvidence(two, { ct: 'CT-EMP-001', result: 'reprovado', date: '2026-10-29', where: 'local', delivery: 'ENT-002' });
  const qa = readQa(tmpFile(out));
  const rows = qa.evidence.filter((e) => e.ct === 'CT-EMP-001');
  const last = rows.reduce((a, r) => (r.line > a.line ? r : a));
  assert.equal(last.result, 'reprovado');
  assert.ok(out.indexOf('| CT-EMP-001 | reprovado |') > out.indexOf('Evidências antigas'));
  assert.ok(out.indexOf('| CT-EMP-001 | reprovado |') < out.indexOf('## Fim'));
});

test('M3: qa-evidence default date is the LOCAL date, not UTC', async () => {
  const { localDate } = await import('../skills/baco-sdd/scripts/commands/qa-evidence.mjs');
  const prev = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    // 2026-01-02 01:30 UTC is still 2026-01-01 22:30 in São Paulo.
    assert.equal(localDate(new Date(Date.UTC(2026, 0, 2, 1, 30))), '2026-01-01');
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});
