import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import {
  readCatalog, updateRow, parseImplemented, formatImplemented, CatalogError, IMPLEMENTED_COL, VALIDATED_COL,
} from '../skills/baco-sdd/scripts/lib/catalog.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

const FIX = readFileSync(new URL('./fixtures/catalogo-de-specs.md', import.meta.url), 'utf8');
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const tableStart = FIX.indexOf('| Código');
const tableEnd = FIX.indexOf('\n\n## Transição');

test('readCatalog finds the table, rows and cleaned cells', () => {
  const c = readCatalog(FIX);
  assert.deepEqual(c.rows.map((r) => r.code), ['IDC', 'ASE', 'EMP']);
  assert.equal(c.rows[1].cells['Versão'], '2.0');
  assert.equal(c.rows[1].cells['Implementação'], 'não verificada');
});

test('updateRow adds both columns after Validação, fills — elsewhere, leaves the rest byte-identical', () => {
  const out = updateRow(FIX, 'ASE', { [IMPLEMENTED_COL]: '2.0 @ abc1234 (ENT-002)', Implementação: 'implementada' });
  assert.equal(out.slice(0, tableStart), FIX.slice(0, tableStart));
  assert.equal(out.slice(out.indexOf('\n\n## Transição')), FIX.slice(tableEnd));
  const c = readCatalog(out);
  assert.deepEqual(c.headers.slice(4, 8), ['Implementação', 'Validação', IMPLEMENTED_COL, VALIDATED_COL]);
  const by = Object.fromEntries(c.rows.map((r) => [r.code, r.cells]));
  assert.equal(by.ASE[IMPLEMENTED_COL], '2.0 @ abc1234 (ENT-002)');
  assert.equal(by.ASE['Implementação'], 'implementada');
  assert.equal(by.ASE[VALIDATED_COL], '—');
  assert.equal(by.IDC[IMPLEMENTED_COL], '—');
  assert.equal(by.IDC[VALIDATED_COL], '—');
  // untouched cells keep their raw text (backticks and links)
  assert.ok(out.includes('| `IDC` | [Identidade e Cadastro](specs/spec-identidade-cadastro.md) | `1.5` | `Aprovada` | `não verificada` | `não verificada` | — | — | Ana Souza'));
});

test('updateRow second call only changes the target cells; CRLF preserved; unknown code throws', () => {
  const once = updateRow(FIX, 'ASE', { [IMPLEMENTED_COL]: '2.0 @ abc1234 (ENT-002)' });
  const twice = updateRow(once, 'EMP', { [VALIDATED_COL]: '1.2' });
  assert.equal(readCatalog(twice).rows[1].cells[IMPLEMENTED_COL], '2.0 @ abc1234 (ENT-002)');
  assert.equal(readCatalog(twice).rows[2].cells[VALIDATED_COL], '1.2');
  const crlf = updateRow(FIX.replace(/\n/g, '\r\n'), 'ASE', { Validação: 'validada' });
  assert.ok(!/[^\r]\n/.test(crlf));
  assert.throws(() => updateRow(FIX, 'ZZZ', {}), CatalogError);
});

test('parse/format implemented', () => {
  assert.deepEqual(parseImplemented('2.0 @ abc1234 (ENT-002)'), { version: '2.0', sha: 'abc1234', delivery: 'ENT-002' });
  assert.equal(parseImplemented('—'), null);
  assert.equal(parseImplemented(undefined), null);
  assert.equal(formatImplemented({ version: '2.1', sha: 'abc1234def', delivery: 'ENT-003' }), '2.1 @ abc1234 (ENT-003)');
});

test('catalog get: a spec name or file name resolves to its code when unambiguous; otherwise the message lists the codes', async () => {
  const dir = await makeRepo({ 'docs/catalogo-de-specs.md': FIX });
  for (const typed of ['Identidade e Cadastro', 'identidade-cadastro', 'spec-identidade-cadastro.md', 'idc']) {
    const r = capture();
    assert.equal(await main(['catalog', 'get', typed, '--json', '--cwd', dir], r.io), 0, typed);
    assert.equal(JSON.parse(r.out.stdout)['Versão'], '1.5');
  }
  const r = capture();
  assert.equal(await main(['catalog', 'get', 'inexistente', '--cwd', dir], r.io), 64);
  assert.match(r.out.stderr, /baco catalog get IDC/);
  assert.match(r.out.stderr, /IDC, ASE, EMP/);
});

test('catalog CLI: get, set, invalid states exit 64', async () => {
  const dir = await makeRepo({ 'docs/catalogo-de-specs.md': FIX });
  let r = capture();
  assert.equal(await main(['catalog', 'get', 'ASE', '--json', '--cwd', dir], r.io), 0);
  assert.equal(JSON.parse(r.out.stdout)['Versão'], '2.0');
  r = capture();
  assert.equal(await main(['catalog', 'set', 'ASE', '--impl-state', 'pronto', '--cwd', dir], r.io), 64);
  assert.equal(await main(['catalog', 'set', 'ASE', '--validation', 'ok', '--cwd', dir], capture().io), 64);
  assert.equal(await main(['catalog', 'set', 'ASE', '--implemented', '2.0@nothex', '--cwd', dir], capture().io), 64);
  assert.equal(await main(['catalog', 'set', 'ZZZ', '--impl-state', 'implementada', '--cwd', dir], capture().io), 64);
  r = capture();
  assert.equal(await main(['catalog', 'set', 'ASE', '--implemented', '2.0@abc1234def@ENT-002', '--impl-state', 'implementada', '--json', '--cwd', dir], r.io), 0);
  const d = JSON.parse(r.out.stdout);
  assert.equal(d[IMPLEMENTED_COL], '2.0 @ abc1234 (ENT-002)');
  assert.equal(d['Implementação'], 'implementada');
  assert.equal(readCatalog(readFileSync(join(dir, 'docs/catalogo-de-specs.md'), 'utf8')).rows[0].cells[IMPLEMENTED_COL], '—');
});

// 0.1.1 (atrito 8): all criteria proven, external review waived.
test('catalog set --validation accepts "validada sem revisão externa" (exact text); the old states still work', async () => {
  const dir = await makeRepo({ 'docs/catalogo-de-specs.md': FIX });
  const r = capture();
  assert.equal(await main(['catalog', 'set', 'ASE', '--validation', 'validada sem revisão externa', '--json', '--cwd', dir], r.io), 0);
  assert.equal(JSON.parse(r.out.stdout)['Validação'], 'validada sem revisão externa');
  for (const s of ['pendente', 'parcialmente validada', 'validada', 'não conforme']) {
    assert.equal(await main(['catalog', 'set', 'ASE', '--validation', s, '--cwd', dir], capture().io), 0, s);
  }
  for (const s of ['validada, sem revisão externa', 'validada sem revisao externa', 'Validada sem revisão externa']) {
    const c = capture();
    assert.equal(await main(['catalog', 'set', 'ASE', '--validation', s, '--cwd', dir], c.io), 64, s);
    assert.match(c.out.stderr, /validada sem revisão externa/);
  }
});

const SPEC = (version, cas) => `# Spec X

| Campo | Valor |
|---|---|
| Código | X |
| Versão | ${version} |

## Requisitos

### RF-001 | Cadastro
O sistema cadastra.

## Critérios de aceite

${cas.map(([id, t]) => `### ${id} | Critério\n${t}\n`).join('\n')}
## Histórico

| Versão | Data | Alteração |
|---|---|---|
| ${version} | 2026-01-01 | x |
`;
const P = 'docs/specs/spec-x.md';
const CAT = (impl) => `| Código | Spec | Versão | Implementação | Validação | Versão implementada |\n|---|---|---|---|---|---|\n| \`X\` | x | 1.0 | implementada | pendente | ${impl} |\n`;

test('spec-diff --base auto uses the implemented sha; matches the explicit-sha result', async () => {
  const dir = await makeRepo({ [P]: SPEC('1.0', [['CA-001', 'Dado a, quando b, então c.'], ['CA-002', 'Dado d, quando e, então f.']]) });
  const base = commit(dir, {}, 'base');
  commit(dir, { [P]: SPEC('1.1', [['CA-001', 'Dado a, quando b, então CHANGED.'], ['CA-003', 'Dado g, quando h, então i.']]) }, 'v1.1');
  writeFileSync(join(dir, 'docs/catalogo-de-specs.md'), CAT(`1.0 @ ${base.slice(0, 7)} (ENT-001)`));
  const a = capture();
  assert.equal(await main(['spec-diff', P, '--base', 'auto', '--json', '--cwd', dir], a.io), 0);
  const e = capture();
  assert.equal(await main(['spec-diff', P, '--base', base, '--json', '--cwd', dir], e.io), 0);
  const da = JSON.parse(a.out.stdout);
  const de = JSON.parse(e.out.stdout);
  assert.deepEqual([da.added, da.modified, da.removed], [de.added, de.modified, de.removed]);
  assert.deepEqual([da.added, da.modified, da.removed], [['CA-003'], ['CA-001'], ['CA-002']]);
  assert.equal(da.base.ref, 'auto');
  assert.equal(da.base.sha, base);
});

test('spec-diff --base auto: no implemented version, no catalog, or no row means all added', async () => {
  const dir = await makeRepo({ [P]: SPEC('1.0', [['CA-001', 'Dado a, quando b, então c.']]) });
  for (const catalog of [null, CAT('—'), CAT('—').replace('`X`', '`OTHER`')]) {
    if (catalog !== null) writeFileSync(join(dir, 'docs/catalogo-de-specs.md'), catalog);
    const r = capture();
    assert.equal(await main(['spec-diff', P, '--base', 'auto', '--json', '--cwd', dir], r.io), 0);
    const d = JSON.parse(r.out.stdout);
    assert.deepEqual(d.added, ['RF-001', 'CA-001']);
    assert.equal(d.base.ref, 'auto');
    assert.equal(d.base.sha, null);
  }
});

test('spec-diff --base auto: unresolvable implemented sha exits 65', async () => {
  const dir = await makeRepo({ [P]: SPEC('1.0', [['CA-001', 'Dado a, quando b, então c.']]) });
  writeFileSync(join(dir, 'docs/catalogo-de-specs.md'), CAT('1.0 @ deadbee (ENT-001)'));
  assert.equal(await main(['spec-diff', P, '--base', 'auto', '--cwd', dir], capture().io), 65);
});

test('M8: "não verificada" is an allowed implementation state', async () => {
  const dir = await makeRepo({ 'docs/catalogo-de-specs.md': FIX });
  const r = capture();
  assert.equal(await main(['catalog', 'set', 'ASE', '--impl-state', 'não verificada', '--json', '--cwd', dir], r.io), 0);
  assert.equal(JSON.parse(r.out.stdout)['Implementação'], 'não verificada');
});
