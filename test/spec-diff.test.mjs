import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { diffSpecs } from '../skills/baco-sdd/scripts/commands/spec-diff.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

const SPEC = (version, rf, cas) => `# Spec X

| Campo | Valor |
|---|---|
| Código | X |
| Versão | ${version} |

## Requisitos

### RF-001 | Cadastro
${rf}

## Critérios de aceite

${cas.map(([id, t]) => `### ${id} | Critério\n${t}\n`).join('\n')}
## Histórico

| Versão | Data | Alteração |
|---|---|---|
| ${version} | 2026-01-01 | x |
`;
const P = 'docs/specs/spec-x.md';
const V1 = SPEC('1.0', 'O sistema cadastra.', [['CA-001', 'Dado a, quando b, então c.'], ['CA-002', 'Dado d, quando e, então f.']]);

test('spec-diff lists added/modified/removed by ID', async () => {
  const dir = await makeRepo({ [P]: V1 });
  const base = commit(dir, {}, 'base');
  commit(dir, { [P]: SPEC('1.1', 'O sistema cadastra.', [['CA-001', 'Dado a, quando b, então CHANGED.'], ['CA-003', 'Dado g, quando h, então i.']]) }, 'v1.1');
  const { io, out } = capture();
  assert.equal(await main(['spec-diff', P, '--base', base, '--json', '--cwd', dir], io), 0);
  const d = JSON.parse(out.stdout);
  assert.deepEqual([d.added, d.modified, d.removed], [['CA-003'], ['CA-001'], ['CA-002']]);
  assert.equal(d.base.version, '1.0');
  assert.equal(d.head.version, '1.1');
  assert.equal(d.base.sha, base);
});

test('whitespace-only reformatting is not a modification', async () => {
  const dir = await makeRepo({ [P]: V1 });
  const base = commit(dir, {}, 'base');
  commit(dir, { [P]: V1.replace('O sistema cadastra.', 'O  sistema\n  cadastra.  ') }, 'fmt');
  const { io, out } = capture();
  assert.equal(await main(['spec-diff', P, '--base', base, '--json', '--cwd', dir], io), 0);
  assert.deepEqual(JSON.parse(out.stdout).modified, []);
});

test('spec absent at base: everything added, no throw', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  const base = commit(dir, {}, 'base');
  commit(dir, { [P]: V1 }, 'add spec');
  const { io, out } = capture();
  assert.equal(await main(['spec-diff', P, '--base', base, '--json', '--cwd', dir], io), 0);
  const d = JSON.parse(out.stdout);
  assert.deepEqual(d.added, ['RF-001', 'CA-001', 'CA-002']);
  assert.equal(d.base.sha, null);
  assert.equal(d.base.version, null);
});

test('mistyped --base exits 65, never "all added"', async () => {
  const dir = await makeRepo({ [P]: V1 });
  const { io, out } = capture();
  assert.equal(await main(['spec-diff', P, '--base', 'no-such-ref', '--cwd', dir], io), 65);
  assert.ok(out.stderr.length > 0);
});

test('missing --base or path exits 64; works from a subdirectory', async () => {
  const dir = await makeRepo({ [P]: V1 });
  assert.equal(await main(['spec-diff', P, '--cwd', dir], capture().io), 64);
  assert.equal(await main(['spec-diff', '--base', 'HEAD', '--cwd', dir], capture().io), 64);
  const { io, out } = capture();
  assert.equal(await main(['spec-diff', 'specs/spec-x.md', '--base', 'HEAD', '--json', '--cwd', join(dir, 'docs')], io), 0);
  assert.deepEqual(JSON.parse(out.stdout).added, []);
});

test('human output is localized', async () => {
  const dir = await makeRepo({ [P]: V1 });
  const { io, out } = capture();
  await main(['spec-diff', P, '--base', 'HEAD', '--cwd', dir], io);
  assert.ok(out.stdout.includes('Nenhuma mudança'));
});

test('diffSpecs: null base means all added; sorted by kind then number', () => {
  const r = diffSpecs(null, V1);
  assert.deepEqual(r.added, ['RF-001', 'CA-001', 'CA-002']);
  assert.equal(r.unchanged, 0);
});

test('spec outside the repo exits 65, never "all added"', async () => {
  const dir = await makeRepo({ [P]: V1 });
  const other = await makeRepo({ 'x.md': V1 });
  for (const arg of [join(other, 'x.md'), '../' + other.split('/').pop() + '/x.md']) {
    const { io, out } = capture();
    assert.equal(await main(['spec-diff', arg, '--base', 'HEAD', '--json', '--cwd', dir], io), 65);
    assert.ok(out.stderr === '' || !out.stdout.includes('"added"'));
  }
});

test('missing spec file exits 65', async () => {
  const dir = await makeRepo({ [P]: V1 });
  assert.equal(await main(['spec-diff', 'docs/specs/nope.md', '--base', 'HEAD', '--cwd', dir], capture().io), 65);
});

// Reading a table differently (heading renamed) is not a removal when the row text did not change.
const NOTES = (heading, row) => `# Spec XYZ

| Campo | Valor |
|---|---|
| Código | XYZ |
| Versão | 1.0 |

## Critérios de aceite

- **CA-XYZ-001 | A:** Dado a, quando b, então c.

### ${heading}

| Item | Nota |
|---|---|
${row}

## Histórico

| Versão | Data | Alteração |
|---|---|---|
| 1.0 | 2026-01-01 | x |
`;
const SX = 'docs/specs/spec-xyz.md';
const runDiff = async (dir, base) => {
  const { io, out } = capture();
  assert.equal(await main(['spec-diff', SX, '--base', base, '--json', '--cwd', dir], io), 0);
  return JSON.parse(out.stdout);
};

test('reclassified: same row text read as reference instead of definition is not removed', async () => {
  const dir = await makeRepo({ [SX]: NOTES('Notas', '| CA-XYZ-009 | nota |') });
  const base = commit(dir, {}, 'base');
  commit(dir, { [SX]: NOTES('Matriz de notas', '| CA-XYZ-009 | nota |') }, 'rename');
  const d = await runDiff(dir, base);
  assert.deepEqual([d.added, d.modified, d.removed, d.reclassified], [[], [], [], ['CA-XYZ-009']]);
});

test('reclassified: the other direction is not an addition either', async () => {
  const dir = await makeRepo({ [SX]: NOTES('Matriz de notas', '| CA-XYZ-009 | nota |') });
  const base = commit(dir, {}, 'base');
  commit(dir, { [SX]: NOTES('Notas', '| CA-XYZ-009 | nota |') }, 'rename');
  const d = await runDiff(dir, base);
  assert.deepEqual([d.added, d.removed, d.reclassified], [[], [], ['CA-XYZ-009']]);
});

test('reclassified: a text change on top of the reclassification is still a removal', async () => {
  const dir = await makeRepo({ [SX]: NOTES('Notas', '| CA-XYZ-009 | nota |') });
  const base = commit(dir, {}, 'base');
  commit(dir, { [SX]: NOTES('Matriz de notas', '| CA-XYZ-009 | outra nota |') }, 'rename+edit');
  const d = await runDiff(dir, base);
  assert.deepEqual([d.removed, d.reclassified], [['CA-XYZ-009'], []]);
});

test('retired table renamed to a matrix: nothing removed, nothing reclassified', async () => {
  const table = '| `CA-XYZ-002` | `obsoleto` |\n| `RF-XYZ-002` | `obsoleto` para V1 |';
  const t = (h) => NOTES(h, table).replace('| Item | Nota |', '| ID histórico | Situação |');
  const dir = await makeRepo({ [SX]: t('Disposição dos identificadores históricos') });
  const base = commit(dir, {}, 'base');
  commit(dir, { [SX]: t('Matriz de disposição dos identificadores históricos') }, 'rename');
  const d = await runDiff(dir, base);
  assert.deepEqual([d.added, d.modified, d.removed, d.reclassified], [[], [], [], []]);
});

test('reclassified IDs are shown in the human output', async () => {
  const dir = await makeRepo({ [SX]: NOTES('Notas', '| CA-XYZ-009 | nota |') });
  const base = commit(dir, {}, 'base');
  commit(dir, { [SX]: NOTES('Matriz de notas', '| CA-XYZ-009 | nota |') }, 'rename');
  const { io, out } = capture();
  await main(['spec-diff', SX, '--base', base, '--cwd', dir], io);
  assert.match(out.stdout, /CA-XYZ-009/);
  assert.match(out.stdout, /0 removido/);
});

test('diffSpecs reports reclassified too', () => {
  const r = diffSpecs(NOTES('Notas', '| CA-XYZ-009 | nota |'), NOTES('Matriz', '| CA-XYZ-009 | nota |'));
  assert.deepEqual([r.removed, r.reclassified], [[], ['CA-XYZ-009']]);
});
