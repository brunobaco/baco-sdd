import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { readSpec, validateSpec } from '../skills/baco-sdd/scripts/lib/spec.mjs';

const fx = (n) => new URL(`./fixtures/${n}`, import.meta.url).pathname;
const tmp = (content) => {
  const p = join(makeTempDirSync('baco-spec-'), 's.md');
  writeFileSync(p, content);
  return p;
};
const codes = (p) => validateSpec(p).map((f) => f.code);

test('readSpec reads code, version and history from the example spec', () => {
  const s = readSpec(fx('spec-exemplo.md'));
  assert.equal(s.code, 'EMP');
  assert.equal(s.version, '1.2');
  assert.equal(s.history.length, 3);
  assert.equal(s.history[2].version, '1.2');
  assert.equal(s.history[0].author, 'Ana Souza');
});

test('readSpec reads bullet history and null code from the template', () => {
  const s = readSpec(fx('spec-template.md'));
  assert.equal(s.code, null);
  assert.equal(s.version, null);
  assert.deepEqual(s.history.map((h) => h.version), ['1.0', '1.1']);
});

test('readSpec reads a bullet Versão/recorte with bold and backticks', () => {
  const s = readSpec(tmp('- **Versão/recorte:** `2.0`\n'));
  assert.equal(s.version, '2.0');
});

test('Example and template specs have no errors', () => {
  assert.deepEqual(validateSpec(fx('spec-exemplo.md')).filter((f) => f.level === 'error'), []);
  assert.deepEqual(validateSpec(fx('spec-template.md')).filter((f) => f.level === 'error'), []);
});

test('broken spec reports the expected findings', () => {
  const fs = validateSpec(fx('spec-broken.md'));
  const c = fs.map((f) => f.code);
  for (const k of ['DUPLICATE_ID', 'CA_MISSING_GWT', 'VERSION_MISMATCH', 'MIXED_CAPABILITY_CODE', 'DANGLING_REF', 'MISSING_ACCEPTANCE_SECTION']) {
    assert.ok(c.includes(k), k);
  }
  assert.equal(fs.find((f) => f.code === 'DUPLICATE_ID').id, 'RF-EMP-002');
  assert.equal(fs.find((f) => f.code === 'CA_MISSING_GWT').id, 'CA-EMP-002');
  assert.equal(fs.find((f) => f.code === 'DANGLING_REF').id, 'RF-EMP-009');
});

test('missing acceptance section and missing history are reported', () => {
  const c = codes(tmp('# S\n\n- **RF-001 | A:** algo.\n'));
  assert.ok(c.includes('MISSING_ACCEPTANCE_SECTION'));
  assert.ok(c.includes('NO_HISTORY'));
});

test('CA table rows take Dado/Quando/Então from the headers', () => {
  const md = '## Critérios de aceite\n\n| ID | Dado | Quando | Então |\n|---|---|---|---|\n| CA-001 | a | b | c |\n\n## Histórico\n\n- 1.0 | 2026-01-01 | x\n';
  assert.ok(!codes(tmp(md)).includes('CA_MISSING_GWT'));
});

test('R4: an ID as first cell of a traceability table is not a duplicate', () => {
  const md = '## Critérios de aceite\n\n- **RF-001 | A:** algo.\n\n## Rastreabilidade\n\n| Origem | Verificação |\n|---|---|\n| RF-001 | CT-001 |\n\n## Histórico\n\n- 1.0 | 2026-01-01 | x\n';
  const c = codes(tmp(md));
  assert.ok(!c.includes('DUPLICATE_ID'));
});

test('R4: a row in an ID table duplicating a bullet is a duplicate', () => {
  const md = '## Critérios de aceite\n\n- **RF-001 | A:** algo.\n\n| ID | Nome |\n|---|---|\n| RF-001 | A |\n';
  assert.ok(codes(tmp(md)).includes('DUPLICATE_ID'));
});

test('R4 orphan: a row in a non-ID table still defines an ID defined nowhere else', async () => {
  const md = '## Critérios de aceite\n\n| Critério | Cenário | Resultado |\n|---|---|---|\n| CA-EMP-001 | falta tudo | ok |\n\n## Histórico\n\n- 1.0 | 2026-01-01 | x\n';
  const p = tmp(md);
  assert.equal(readSpec(p).definitions.filter((d) => d.kind === 'CA').length, 1);
  assert.ok(validateSpec(p).some((f) => f.code === 'CA_MISSING_GWT' && f.id === 'CA-EMP-001'));
});

test('R5: history table with Descrição column triggers VERSION_MISMATCH', () => {
  const md = '| Campo | Valor |\n|---|---|\n| Versão | 1.3 |\n\n## Critérios de aceite\n\n## Aprovação e histórico\n\n| Versão | Responsável | Data | Descrição |\n|---|---|---|---|\n| 1.0 | A | 2026-01-01 | Criação |\n| 1.2 | A | 2026-01-02 | Ajuste |\n';
  const p = tmp(md);
  assert.equal(readSpec(p).history.length, 2);
  assert.ok(codes(p).includes('VERSION_MISMATCH'));
  assert.ok(!codes(p).includes('NO_HISTORY'));
});

test('R5 fallback: table under a histórico heading with Versão header only', () => {
  const md = '## Histórico\n\n| Versão | Quem |\n|---|---|\n| 1.0 | A |\n';
  assert.equal(readSpec(tmp(md)).history.length, 1);
});

test('R6: traceability-only ID is a dangling ref, never a definition', () => {
  const md = '## Critérios de aceite\n\n- **CA-EMP-001 | A:** dado x, quando y, então z.\n\n## Rastreabilidade\n\n| CA-EMP-009 | CT-009 |\n|---|---|\n';
  const md2 = '## Critérios de aceite\n\n- **CA-EMP-001 | A:** dado x, quando y, então z.\n\n## Rastreabilidade\n\n| Item | Teste |\n|---|---|\n| CA-EMP-009 | CT-EMP-009 |\n';
  for (const m of [md2, md]) {
    const p = tmp('| Código | EMP |\n|---|---|\n' + m + '\n## Histórico\n\n- 1.0 | 2026-01-01 | x\n');
    const f = validateSpec(p);
    assert.ok(!readSpec(p).definitions.some((d) => d.id === 'CA-EMP-009') || m === md);
    if (m === md2) {
      assert.ok(!readSpec(p).definitions.some((d) => d.id === 'CA-EMP-009'));
      assert.ok(!f.some((x) => x.code === 'CA_MISSING_GWT'));
      assert.equal(f.filter((x) => x.code === 'DANGLING_REF' && x.id === 'CA-EMP-009').length, 1);
    }
  }
});

test('R6: headers origem/verificacao also mark a trace table', () => {
  const p = tmp('## Critérios de aceite\n\n## Cobertura\n\n| Origem | Verificação |\n|---|---|\n| CA-009 | CT-009 |\n');
  assert.equal(readSpec(p).definitions.length, 0);
});

const caSpec = (body) => `# Spec\n\n| Campo | Valor |\n|---|---|\n| Código / domínio | \`IDC\` / Identidade e Cadastro |\n| Versão | 1.0 |\n\n## Critérios de aceite\n\n### CA-IDC-001 | t\n\n${body}\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.0 | 2026-01-01 | x |\n`;
const gwt = (body) => validateSpec(tmp(caSpec(body))).filter((f) => f.code === 'CA_MISSING_GWT');

test('GWT check accepts Dada and Dadas (feminine/plural)', () => {
  assert.equal(gwt('Dada tentativa vencida, quando acessada, então expira.').length, 0);
  assert.equal(gwt('Dadas solicitações, quando processadas, então limita.').length, 0);
  assert.equal(gwt('Dado X, quando Y, então Z.').length, 0);
});

test('GWT check still flags a criterion with no então', () => {
  assert.equal(gwt('Dado um código, quando solicitado, é impedido.').length, 1);
});

test('readSpec reads the code from a "Código / domínio" row', () => {
  assert.equal(readSpec(tmp(caSpec('Dado a, quando b, então c.'))).code, 'IDC');
});

// Retired IDs: rows that record a retired ID are not definitions, and the ID stays reserved.
const xyz = (body) => `# Spec XYZ\n\n| Campo | Valor |\n|---|---|\n| Código | XYZ |\n| Versão | 1.1 |\n\n## Critérios de aceite\n\n- **CA-XYZ-001 | Ativo:** Dado a, quando b, então c.\n- **RF-XYZ-003 | Novo:** o sistema faz y.\n\n${body}\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.1 | 2026-01-01 | x |\n`;
const RETIRED_TABLE = '| ID histórico da 1.0 | Situação na 1.1 | Destino e consequência |\n|---|---|---|\n| `RF-XYZ-002` | `obsoleto` | Substituído por `RF-XYZ-003` |\n| `CA-XYZ-002` | `obsoleto` para V1 | Sem critério sucessor |\n| `CA-XYZ-006` | `revogado` | Fora do recorte |';

test('retired IDs: a disposition table never becomes a definition', () => {
  const p = tmp(xyz(`### 9.2 Disposição dos identificadores históricos da 1.0\n\n${RETIRED_TABLE}`));
  const s = readSpec(p);
  assert.deepEqual(s.definitions.map((d) => d.id), ['CA-XYZ-001', 'RF-XYZ-003']);
  assert.deepEqual(s.retired.map((d) => d.id), ['RF-XYZ-002', 'CA-XYZ-002', 'CA-XYZ-006']);
  assert.deepEqual(validateSpec(p), []);
});

test('retired IDs: the status column decides, whatever the heading says', () => {
  for (const h of ['### Notas', '### Matriz de disposição dos identificadores', '### Rastreabilidade']) {
    const p = tmp(xyz(`${h}\n\n${RETIRED_TABLE}`));
    assert.deepEqual(readSpec(p).retired.map((d) => d.id), ['RF-XYZ-002', 'CA-XYZ-002', 'CA-XYZ-006'], h);
    assert.deepEqual(validateSpec(p), [], h);
  }
});

test('retired IDs: English and other Portuguese retirement words count', () => {
  const words = ['substituído por RF-XYZ-003', 'retirada', 'descontinuado', 'aposentado', 'removido', 'superseded', 'deprecated', 'withdrawn', 'retired', 'obsolete', 'revoked'];
  const rows = words.map((w, i) => `| RF-XYZ-${String(100 + i)} | ${w} |`).join('\n');
  const p = tmp(xyz(`### Notas\n\n| Item | Status |\n|---|---|\n${rows}`));
  assert.equal(readSpec(p).retired.length, words.length);
  assert.ok(!readSpec(p).definitions.some((d) => d.id.startsWith('RF-XYZ-1')));
});

test('retired IDs: a status column in an ID table retires the row, the others stay definitions', () => {
  const p = tmp(xyz('### Requisitos\n\n| ID | Requisito | Situação |\n|---|---|---|\n| RF-XYZ-010 | faz x | vigente |\n| RF-XYZ-011 | fazia y | obsoleto |'));
  const s = readSpec(p);
  assert.ok(s.definitions.some((d) => d.id === 'RF-XYZ-010'));
  assert.ok(!s.definitions.some((d) => d.id === 'RF-XYZ-011'));
  assert.deepEqual(s.retired.map((d) => d.id), ['RF-XYZ-011']);
});

test('retired IDs: a Given/When/Then cell starting with a retirement word does not retire the CA', () => {
  const p = tmp(xyz('### Mais critérios\n\n| ID | Dado | Quando | Então |\n|---|---|---|---|\n| CA-XYZ-010 | item na lista | a pessoa apaga | removido da lista |'));
  assert.ok(readSpec(p).definitions.some((d) => d.id === 'CA-XYZ-010'));
  assert.deepEqual(readSpec(p).retired, []);
});

test('retired IDs: a table under a history heading without status is a reference, not a definition', () => {
  const p = tmp(xyz('### Histórico de identificadores\n\n| Item | Nota |\n|---|---|\n| CA-XYZ-007 | era o teste da barra lateral |'));
  assert.ok(!readSpec(p).definitions.some((d) => d.id === 'CA-XYZ-007'));
  assert.ok(!codes(p).includes('CA_MISSING_GWT'));
});

test('retired IDs: a retired ID that is defined again is an error', () => {
  const p = tmp(xyz(`### Disposição\n\n${RETIRED_TABLE}\n\n### Reuso\n\n- **CA-XYZ-002 | Reaproveitado:** Dado a, quando b, então c.`));
  const f = validateSpec(p).filter((x) => x.code === 'RETIRED_ID_REDEFINED');
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'CA-XYZ-002');
  assert.equal(f[0].level, 'error');
});

test('retired IDs: a partial supersession is neither retired nor a definition', () => {
  const p = tmp(xyz('### Disposição\n\n| Item | Situação |\n|---|---|\n| RF-XYZ-003 | substituído parcialmente |\n| CA-XYZ-009 | substituído em parte |'));
  const s = readSpec(p);
  assert.deepEqual(s.retired, []);
  assert.ok(!s.definitions.some((d) => d.id === 'CA-XYZ-009'));
  const c = codes(p);
  assert.ok(!c.includes('RETIRED_ID_REDEFINED') && !c.includes('DUPLICATE_ID') && !c.includes('CA_MISSING_GWT'));
});

test('retired IDs: a reference to a retired ID is not dangling', () => {
  const p = tmp(xyz(`### Disposição\n\n${RETIRED_TABLE}\n\n### Nota\n\n- **RF-XYZ-004 | Sucessor:** substitui RF-XYZ-002.`));
  assert.ok(!codes(p).includes('DANGLING_REF'));
});

// Definitions in shapes the engine does not read are reported, never silently dropped.
test('bold paragraph items: NO_DEFINITIONS error and one UNRECOGNIZED_DEFINITION per item', () => {
  const md = '# Spec\n\n| Campo | Valor |\n|---|---|\n| Código | XYZ |\n| Versão | 1.0 |\n\n## Requisitos\n\n**RF-XYZ-024 | Resolver conflitos.** O sistema deve impedir x.\n\n**RF-XYZ-025 | Outro.** O sistema faz y.\n\n## Critérios de aceite\n\n**CA-XYZ-001 | Conflito:** Dado a, quando b, então c.\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.0 | 2026-01-01 | x |\n';
  const f = validateSpec(tmp(md));
  const nd = f.filter((x) => x.code === 'NO_DEFINITIONS');
  assert.equal(nd.length, 1);
  assert.equal(nd[0].level, 'error');
  assert.equal(nd[0].line, 10);
  const un = f.filter((x) => x.code === 'UNRECOGNIZED_DEFINITION');
  assert.deepEqual(un.map((x) => [x.line, x.id, x.level]), [[10, 'RF-XYZ-024', 'warning'], [12, 'RF-XYZ-025', 'warning'], [16, 'CA-XYZ-001', 'warning']]);
});

test('unrecognized shapes next to recognized ones: warning only', () => {
  const p = tmp(xyz('### Mais\n\n1. **RF-XYZ-030 | Numerado:** faz z.\n\n### RF-XYZ-031 Título sem separador\n\nTexto.\n\n- **RF-XYZ-032** — Travessão depois do ID'));
  const f = validateSpec(p);
  assert.ok(!f.some((x) => x.code === 'NO_DEFINITIONS'));
  assert.deepEqual(f.filter((x) => x.code === 'UNRECOGNIZED_DEFINITION').map((x) => x.id), ['RF-XYZ-030', 'RF-XYZ-031', 'RF-XYZ-032']);
  assert.ok(f.every((x) => x.level === 'warning'));
});

test('prose that only mentions an ID is not an unrecognized definition', () => {
  const p = tmp(xyz('### Notas\n\n**CA-XYZ-001** foi revisado com a área.\n\nO critério CA-XYZ-001: ver acima.\n\n```\nRF-XYZ-099 | exemplo em bloco de código\n```'));
  assert.deepEqual(validateSpec(p), []);
});

test('a spec with no IDs at all has no NO_DEFINITIONS', () => {
  assert.ok(!codes(tmp('# Rascunho\n\n## Critérios de aceite\n\nAinda sem itens.\n')).includes('NO_DEFINITIONS'));
});

test('example and template fixtures get none of the new findings', () => {
  for (const f of ['spec-exemplo.md', 'spec-template.md']) {
    const c = codes(fx(f));
    for (const k of ['NO_DEFINITIONS', 'UNRECOGNIZED_DEFINITION', 'RETIRED_ID_REDEFINED']) assert.ok(!c.includes(k), `${f} ${k}`);
  }
});

// CA title inside the ID cell.
const gwtTable = (rows) => xyz(`### Mais critérios\n\n| ID | Dado | Quando | Então |\n|---|---|---|---|\n${rows}`);

test('CA with a title in the ID cell is read, with or without a dash', () => {
  const p = tmp(gwtTable('| **CA-XYZ-010** Título simples | a | b | c |\n| **CA-XYZ-011** — Com travessão | a | b | c |\n| CA-XYZ-012: Com dois-pontos | a | b | c |\n| **CA-XYZ-013 – Tudo em negrito** | a | b | c |'));
  const defs = readSpec(p).definitions.filter((d) => /CA-XYZ-01\d/.test(d.id));
  assert.deepEqual(defs.map((d) => [d.id, d.title]), [['CA-XYZ-010', 'Título simples'], ['CA-XYZ-011', 'Com travessão'], ['CA-XYZ-012', 'Com dois-pontos'], ['CA-XYZ-013', 'Tudo em negrito']]);
  assert.deepEqual(validateSpec(p), []);
});

test('the extra Título column keeps working', () => {
  const p = tmp(xyz('### Mais critérios\n\n| ID | Título | Dado | Quando | Então |\n|---|---|---|---|---|\n| **CA-XYZ-020** | Título | a | b | c |'));
  assert.ok(readSpec(p).definitions.some((d) => d.id === 'CA-XYZ-020'));
  assert.deepEqual(validateSpec(p), []);
});

test('a titled ID cell outside a definition table is a reference, never a fallback definition', () => {
  const p = tmp(xyz('### Notas\n\n| Item | Nota |\n|---|---|\n| **CA-XYZ-040** ver QA | ok |\n| RF-XYZ-041/042 | ok |'));
  const ids = readSpec(p).definitions.map((d) => d.id);
  assert.ok(!ids.includes('CA-XYZ-040') && !ids.includes('RF-XYZ-041'));
  assert.ok(!codes(p).includes('CA_MISSING_GWT'));
});

test('an ID cell the engine still cannot read in a definition table is reported', () => {
  const p = tmp(gwtTable('| **CA-XYZ-050**Colado | a | b | c |'));
  const un = validateSpec(p).filter((x) => x.code === 'UNRECOGNIZED_DEFINITION');
  assert.deepEqual(un.map((x) => x.id), ['CA-XYZ-050']);
});

// "Próximos números livres": per series, the highest number ever used plus one.
const nf = (line, body = '') => `# Spec XYZ\n\n| Campo | Valor |\n|---|---|\n| Código | XYZ |\n| Versão | 1.0 |\n${line === null ? '' : `| Próximos números livres | ${line} |\n`}\n## Requisitos\n\n- **RF-XYZ-001 | A:** faz a.\n- **RF-XYZ-015 | B:** faz b.\n- **RN-XYZ-020 | C:** regra c.\n\n## Critérios de aceite\n\n- **CA-XYZ-041 | D:** Dado a, quando b, então c.\n${body}\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.0 | 2026-01-01 | x |\n`;
const nfFindings = (md) => validateSpec(tmp(md)).filter((f) => f.code.startsWith('NEXT_FREE'));

test('next free: an up-to-date line gives no finding and is exposed with the computed minimum', () => {
  const p = tmp(nf('RF-XYZ-016, RNF-XYZ-004, RN-XYZ-021, INV-XYZ-002, CA-XYZ-042, P-XYZ-003, CT-XYZ-050'));
  assert.deepEqual(validateSpec(p), []);
  const n = readSpec(p).nextFree;
  assert.equal(n.line, 7);
  assert.equal(n.declared.RF, 'RF-XYZ-016');
  assert.equal(n.declared.CT, 'CT-XYZ-050');
  assert.deepEqual(n.minimum, { RF: 'RF-XYZ-016', RN: 'RN-XYZ-021', CA: 'CA-XYZ-042' });
});

test('next free: a line ahead of use is fine (numbers used in earlier versions)', () => {
  assert.deepEqual(nfFindings(nf('RF-XYZ-030, RN-XYZ-099, CA-XYZ-100')), []);
});

test('next free: a used number equal to or above the line is NEXT_FREE_STALE, one per series', () => {
  const f = nfFindings(nf('RF-XYZ-015, RN-XYZ-010, CA-XYZ-042'));
  assert.deepEqual(f.map((x) => [x.code, x.level, x.line, x.series, x.max, x.declared, x.minimum]), [
    ['NEXT_FREE_STALE', 'warning', 7, 'RF', 'RF-XYZ-015', 'RF-XYZ-015', 'RF-XYZ-016'],
    ['NEXT_FREE_STALE', 'warning', 7, 'RN', 'RN-XYZ-020', 'RN-XYZ-010', 'RN-XYZ-021'],
  ]);
});

test('next free: retired IDs count as used', () => {
  const body = '\n### Disposição\n\n| ID | Situação |\n|---|---|\n| CA-XYZ-050 | obsoleto |\n';
  const f = nfFindings(nf('RF-XYZ-016, RN-XYZ-021, CA-XYZ-042', body));
  assert.deepEqual(f.map((x) => [x.code, x.series, x.max]), [['NEXT_FREE_STALE', 'CA', 'CA-XYZ-050']]);
});

test('next free: a series the spec uses but the line lacks is NEXT_FREE_MISSING_SERIES', () => {
  const f = nfFindings(nf('RF-XYZ-016, CA-XYZ-042'));
  assert.deepEqual(f.map((x) => [x.code, x.level, x.series, x.minimum]), [['NEXT_FREE_MISSING_SERIES', 'warning', 'RN', 'RN-XYZ-021']]);
});

test('next free: a value that is not a valid ID of the spec is NEXT_FREE_INVALID', () => {
  const f = nfFindings(nf('RF-XYZ-016, RN-XYZ-21, CA-ABC-042, CA-XYZ-042, RF-XYZ-017, talvez'));
  assert.deepEqual(f.filter((x) => x.code === 'NEXT_FREE_INVALID').map((x) => [x.level, x.value]), [
    ['warning', 'RN-XYZ-21'], ['warning', 'CA-ABC-042'], ['warning', 'RF-XYZ-017'], ['warning', 'talvez'],
  ]);
});

test('next free: project series the engine does not know (DEC, RIS) are accepted and not checked', () => {
  assert.deepEqual(nfFindings(nf('RF-XYZ-016, RN-XYZ-021, CA-XYZ-042, DEC-XYZ-011, RIS-XYZ-005')), []);
});

test('next free: backticks, bold and semicolons in the cell are accepted', () => {
  assert.deepEqual(nfFindings(nf('`RF-XYZ-016; RN-XYZ-021`; **CA-XYZ-042**')), []);
});

test('next free: the bullet form of the metadata is read too', () => {
  const md = nf(null).replace('## Requisitos', '- **Próximos números livres:** RF-XYZ-010, RN-XYZ-021, CA-XYZ-042\n\n## Requisitos');
  const f = nfFindings(md);
  assert.deepEqual(f.map((x) => [x.code, x.series]), [['NEXT_FREE_STALE', 'RF']]);
});

test('next free: no line, no finding; the minimum is still computed', () => {
  const p = tmp(nf(null));
  assert.deepEqual(nfFindings(nf(null)), []);
  const n = readSpec(p).nextFree;
  assert.equal(n.line, null);
  assert.equal(n.declared, null);
  assert.deepEqual(n.minimum, { RF: 'RF-XYZ-016', RN: 'RN-XYZ-021', CA: 'CA-XYZ-042' });
});

test('next free: the line alone does not make a draft spec NO_DEFINITIONS', () => {
  const md = '# Spec\n\n| Campo | Valor |\n|---|---|\n| Código | XYZ |\n| Próximos números livres | RF-XYZ-001, CA-XYZ-001 |\n\n## Critérios de aceite\n\nAinda sem itens.\n';
  assert.ok(!codes(tmp(md)).includes('NO_DEFINITIONS'));
});
