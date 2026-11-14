import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readText, fold, headings, tables, findDefinitions, findAllDefinitions,
} from '../skills/baco-sdd/scripts/lib/markdown.mjs';

const EXEMPLO = new URL('./fixtures/spec-exemplo.md', import.meta.url).pathname;
const TEMPLATE = new URL('./fixtures/spec-template.md', import.meta.url).pathname;

test('fixture really has CRLF bytes', () => {
  assert.ok(readFileSync(EXEMPLO).includes('\r\n'));
});

test('readText converts CRLF and strips BOM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baco-md-'));
  const p = join(dir, 'a.md');
  writeFileSync(p, '﻿a\r\nb\r\n');
  assert.equal(readText(p), 'a\nb\n');
});

test('fold lowercases and removes diacritics', () => {
  assert.equal(fold('Critérios de Aceite'), 'criterios de aceite');
  assert.equal(fold('Histórico'), 'historico');
});

test('headings report level, title and 1-based line; skip code fences', () => {
  const md = '# A\n\n## 10. Critérios de aceite\n```\n# not a heading\n```\n### Sub ##\n';
  assert.deepEqual(headings(md), [
    { level: 1, title: 'A', line: 1 },
    { level: 2, title: '10. Critérios de aceite', line: 3 },
    { level: 3, title: 'Sub', line: 7 },
  ]);
});

test('tables: headers, rows, cleaned cells, separator not a row', () => {
  const md = readText(EXEMPLO);
  const ts = tables(md);
  const ca = ts.find((t) => t.headers.join('|') === 'ID|Dado|Quando|Então');
  assert.ok(ca);
  assert.equal(ca.rows.length, 3);
  assert.equal(ca.rows[0].cells[0], 'CA-EMP-001');
  assert.equal(ca.rows[1].cells[1], 'Identidade com vínculo Ativo');
  const meta = ts.find((t) => t.headers[0] === 'Campo');
  assert.deepEqual(meta.rows[0].cells, ['Código', 'EMP']);
  assert.deepEqual(meta.rows[1].cells, ['Versão', '1.2']);
  const hist = ts.find((t) => t.headers[0] === 'Versão');
  assert.deepEqual(hist.rows.map((r) => r.cells[0]), ['1.0', '1.1', '1.2']);
  for (const t of ts) for (const r of t.rows) assert.ok(!/^[-: ]+$/.test(r.cells[0]));
  assert.equal(md.split('\n')[ca.line - 1].startsWith('| ID'), true);
});

test('tables: escaped pipe stays inside the cell', () => {
  const [t] = tables('| A | B |\n|---|---|\n| x \\| y | z |\n');
  assert.deepEqual(t.rows[0].cells, ['x | y', 'z']);
});

test('CRLF fixture: all 8 IDs defined, no CR anywhere', () => {
  const defs = findDefinitions(readText(EXEMPLO));
  const ids = defs.map((d) => d.id);
  for (const id of [
    'RF-EMP-001', 'RF-EMP-002', 'RF-EMP-003', 'RN-EMP-001', 'RN-EMP-002',
    'CA-EMP-001', 'CA-EMP-002', 'CA-EMP-003',
  ]) assert.ok(ids.includes(id), id);
  assert.ok(ids.includes('RNF-EMP-001'));
  for (const d of defs) assert.ok(!/[\r]/.test(d.text + d.title + d.id));
  const ca1 = defs.find((d) => d.id === 'CA-EMP-001');
  assert.equal(ca1.kind, 'CA');
  assert.match(ca1.text, /Identidade livre e dados válidos/);
  assert.match(ca1.text, /Confirma a criação/);
  assert.match(ca1.text, /Empresa criada atomicamente/);
  const rf1 = defs.find((d) => d.id === 'RF-EMP-001');
  assert.equal(rf1.title, 'Criar Empresa');
  assert.match(rf1.text, /Continuação indentada/);
  assert.doesNotMatch(rf1.text, /RF-EMP-002/);
});

test('references in prose and in QA tables are not definitions', () => {
  const defs = findAllDefinitions(readText(EXEMPLO));
  assert.equal(defs.filter((d) => d.id === 'RF-EMP-001').length, 1);
  assert.equal(defs.filter((d) => d.id === 'RN-EMP-001').length, 1);
  assert.equal(findDefinitions('texto conforme RF-EMP-002 aqui\n').length, 0);
  assert.equal(findDefinitions('- RF-EMP-002 deve ser observado\n').length, 0);
});

test('template fixture: heading-form definitions with Dado/Quando/Então', () => {
  const defs = findDefinitions(readText(TEMPLATE));
  assert.deepEqual(defs.map((d) => d.id), ['RF-001', 'RF-002', 'CA-001', 'CA-002']);
  const ca1 = defs.find((d) => d.id === 'CA-001');
  assert.match(ca1.text, /Dado/);
  assert.match(ca1.text, /Quando/);
  assert.match(ca1.text, /Então/);
  assert.doesNotMatch(ca1.text, /sem nome/);
  assert.equal(ca1.title, 'Cadastro válido');
  const rf2 = defs.find((d) => d.id === 'RF-002');
  assert.match(rf2.text, /ver RF-001/);
});

test('heading block stops at next heading of same or higher level', () => {
  const md = '## RF-001 | A\ncorpo\n### sub\nmais\n## Outro\nfora\n';
  const [d] = findDefinitions(md);
  assert.equal(d.text, 'RF-001 | A corpo ### sub mais');
});

test('first definition wins; findAllDefinitions reports duplicates', () => {
  const md = '- **RF-001 | A:** um\n- **RF-001 | B:** dois\n';
  assert.equal(findDefinitions(md).length, 1);
  assert.equal(findDefinitions(md)[0].title, 'A');
  assert.equal(findAllDefinitions(md).length, 2);
});

test('definition forms: bold heading, plain bullet, star bullet, code fences ignored', () => {
  const md = [
    '### **RF-010** | T1', 'x',
    '* RF-011: texto', '- **RN-012**: texto',
    '```', '- **RF-099 | no:** fence', '```',
  ].join('\n');
  assert.deepEqual(findAllDefinitions(md).map((d) => d.id), ['RF-010', 'RF-011', 'RN-012']);
});

test('multi-definition: table row text is cells joined', () => {
  const md = '| ID | Dado |\n|---|---|\n| **CA-001** | algo |\n';
  const [d] = findDefinitions(md);
  assert.equal(d.text, 'CA-001 | algo');
  assert.equal(d.line, 3);
});

test('fold strips only combining marks, keeping ^ and backticks', () => {
  assert.equal(fold('a^b `EMP` ação'), 'a^b `emp` acao');
});
