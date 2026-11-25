import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { deliveryDir, readPlanHeader, nextNumber, DeliveryError } from '../skills/baco-sdd/scripts/lib/delivery.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const spec = (v) => `# Spec X\n\n| Campo | Valor |\n|---|---|\n| Código | XX |\n| Versão | ${v} |\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| ${v} | 2026-01-01 | x |\n`;
const plan = (specs) => `# Plano\n\n**Specs:** ${specs}\n**Base:** main\n`;
const cfg = { docs_root: 'docs' };

test('stale when planned version differs from spec version', async () => {
  const dir = await makeRepo({
    'docs/specs/spec-x.md': spec('1.1'),
    'docs/entregas/ENT-003-ase-2-1/plano.md': plan('docs/specs/spec-x.md@1.0'),
  });
  const { io, out } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-003', '--json', '--cwd', dir], io), 1);
  assert.deepEqual(JSON.parse(out.stdout), { stale: [{ path: 'docs/specs/spec-x.md', planned: '1.0', current: '1.1' }] });
});

test('equal versions exit 0; accepts a plan path', async () => {
  const dir = await makeRepo({
    'docs/specs/spec-x.md': spec('1.0'),
    'docs/entregas/ENT-003-a/plano.md': plan('docs/specs/spec-x.md@1.0.'),
  });
  const { io } = capture();
  assert.equal(await main(['plan-freshness', 'docs/entregas/ENT-003-a/plano.md', '--cwd', dir], io), 0);
});

test('missing spec file counts as stale with current null', async () => {
  const dir = await makeRepo({ 'docs/entregas/ENT-001-a/plano.md': plan('docs/specs/gone.md@1.0') });
  const { io, out } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-001', '--json', '--cwd', dir], io), 1);
  assert.equal(JSON.parse(out.stdout).stale[0].current, null);
});

test('errors: not found 65, ambiguous 65, bad id 64, missing plan 65', async () => {
  const dir = await makeRepo({ 'docs/entregas/ENT-002-a/x.md': 'x', 'docs/entregas/ENT-002-b/x.md': 'x', 'docs/entregas/ENT-004-a/x.md': 'x' });
  for (const [arg, code] of [['ENT-009', 65], ['ENT-002', 65], ['foo', 64], ['ENT-4', 64], ['ENT-004', 65]]) {
    const { io } = capture();
    assert.equal(await main(['plan-freshness', arg, '--cwd', dir], io), code, arg);
  }
});

test('deliveryDir resolves and throws typed errors', async () => {
  const dir = await makeRepo({ 'docs/entregas/ENT-003-ase-2-1/plano.md': 'x', 'docs/entregas/ENT-005-a/p.md': 'x', 'docs/entregas/ENT-005-b/p.md': 'x' });
  assert.equal(deliveryDir(dir, cfg, 'ENT-003'), join(dir, 'docs/entregas/ENT-003-ase-2-1'));
  assert.throws(() => deliveryDir(dir, cfg, 'ENT-009'), (e) => e instanceof DeliveryError && e.code === 'NOT_FOUND');
  assert.throws(() => deliveryDir(dir, cfg, 'ENT-005'), (e) => e.code === 'AMBIGUOUS');
});

test('readPlanHeader is lenient', () => {
  const h = readPlanHeader('**specs :**  a/b.md@2.0 ,  c.md@1.5 .\n**BASE:** `abc123`\n');
  assert.deepEqual(h, { specs: [{ path: 'a/b.md', version: '2.0' }, { path: 'c.md', version: '1.5' }], baseRef: 'abc123' });
  assert.deepEqual(readPlanHeader('# nada\r\n'), { specs: [], baseRef: null });
  assert.equal(readPlanHeader('**Especificações:** x').specs.length, 0);
});

test('nextNumber', () => {
  const d = makeTempDirSync('baco-n-');
  assert.equal(nextNumber(d, 'handoff'), '01');
  for (const f of ['handoff-01.md', 'handoff-02.md', 'handoff-x.md', 'veredito-07.md', 'handoff-03.txt']) writeFileSync(join(d, f), '');
  assert.equal(nextNumber(d, 'handoff'), '03');
  assert.equal(nextNumber(join(d, 'nope'), 'FIX'), '01');
  mkdirSync(join(d, 'sub'));
});

test('spec listed without version is stale with planned null', async () => {
  const dir = await makeRepo({
    'docs/specs/spec-x.md': spec('1.0'),
    'docs/entregas/ENT-006-a/plano.md': plan('docs/specs/spec-x.md, docs/specs/spec-y.md@'),
  });
  const { io, out } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-006', '--json', '--cwd', dir], io), 1);
  const stale = JSON.parse(out.stdout).stale;
  assert.equal(stale.length, 2);
  assert.equal(stale[0].planned, null);
  assert.equal(stale[0].current, '1.0');
  assert.deepEqual(readPlanHeader('**Specs:** a.md').specs, [{ path: 'a.md', version: null }]);
});

test('1.10 vs 1.1 is stale', async () => {
  const dir = await makeRepo({
    'docs/specs/spec-x.md': spec('1.10'),
    'docs/entregas/ENT-007-a/plano.md': plan('docs/specs/spec-x.md@1.1'),
  });
  const { io } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-007', '--cwd', dir], io), 1);
});

test('nextNumber passes 09 to 10 and 10 to 11', () => {
  const d = makeTempDirSync('baco-n-');
  for (const f of ['handoff-09.md', 'handoff-10.md']) writeFileSync(join(d, f), '');
  assert.equal(nextNumber(d, 'handoff'), '11');
});

test('I5: a plan with no parsed specs fails with freshness.no_specs', async () => {
  const dir = await makeRepo({ 'docs/entregas/ENT-008-a/plano.md': '# Plano\n\n**Especificações:** docs/specs/x.md@1.0\n**Base:** main\n' });
  const { io, out } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-008', '--cwd', dir], io), 1);
  assert.match(out.stdout, /nenhuma spec/i);
  const j = capture();
  assert.equal(await main(['plan-freshness', 'ENT-008', '--json', '--cwd', dir], j.io), 1);
  assert.deepEqual(JSON.parse(j.out.stdout), { stale: [], noSpecs: true });
});

test('I5: a null planned version is rendered as -, never null', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec('1.0'), 'docs/entregas/ENT-006-a/plano.md': plan('docs/specs/spec-x.md') });
  const { io, out } = capture();
  assert.equal(await main(['plan-freshness', 'ENT-006', '--cwd', dir], io), 1);
  assert.doesNotMatch(out.stdout, /null/);
  assert.match(out.stdout, /planejada -,/);
});
