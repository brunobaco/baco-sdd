import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';

const fx = (n) => new URL(`./fixtures/${n}`, import.meta.url).pathname;
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

test('validate-spec on the broken spec exits 1 and --json has findings', async () => {
  const { io, out } = capture();
  const code = await main(['validate-spec', fx('spec-broken.md'), '--json', '--cwd', dirname(fx('x'))], io);
  assert.equal(code, 1);
  const data = JSON.parse(out.stdout);
  assert.ok(data.findings.length > 0);
  assert.equal(data.code, 'EMP');
  assert.equal(data.version, '1.3');
});

test('validate-spec resolves the path relative to --cwd and exits 0 on a good spec', async () => {
  const { io, out } = capture();
  const code = await main(['validate-spec', 'spec-exemplo.md', '--json', '--cwd', dirname(fx('x'))], io);
  assert.equal(code, 0);
  const data = JSON.parse(out.stdout);
  assert.deepEqual(data.counts, { RF: 3, RN: 2, RNF: 1, INV: 0, CA: 3 });
});

test('validate-spec without a path exits 64; missing file exits 65', async () => {
  let c = capture();
  assert.equal(await main(['validate-spec', '--cwd', dirname(fx('x'))], c.io), 64);
  c = capture();
  assert.equal(await main(['validate-spec', 'nope.md', '--cwd', dirname(fx('x'))], c.io), 65);
});

test('validate-spec prints human findings in pt-BR', async () => {
  const { io, out } = capture();
  await main(['validate-spec', fx('spec-broken.md'), '--cwd', dirname(fx('x'))], io);
  assert.match(out.stdout, /RF-EMP-002/);
});

test('validate-spec on the CRLF CRLF fixture has no errors', async () => {
  const { io, out } = capture();
  assert.equal(await main(['validate-spec', fx('spec-exemplo.md'), '--json'], io), 0);
  assert.equal(JSON.parse(out.stdout).findings.filter((f) => f.level === 'error').length, 0);
});

test('validate-spec --json lists retired IDs and exits 1 on a spec read as empty', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'baco-vs-'));
  const md = (body) => `# Spec\n\n| Campo | Valor |\n|---|---|\n| Código | XYZ |\n| Versão | 1.0 |\n\n## Critérios de aceite\n\n${body}\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.0 | 2026-01-01 | x |\n`;
  writeFileSync(join(dir, 'a.md'), md('- **CA-XYZ-001 | A:** Dado a, quando b, então c.\n\n### Disposição\n\n| ID | Situação |\n|---|---|\n| CA-XYZ-002 | obsoleto |'));
  writeFileSync(join(dir, 'b.md'), md('**CA-XYZ-001 | A.** Dado a, quando b, então c.'));
  let c = capture();
  assert.equal(await main(['validate-spec', 'a.md', '--json', '--cwd', dir], c.io), 0);
  const a = JSON.parse(c.out.stdout);
  assert.deepEqual(a.retired, ['CA-XYZ-002']);
  assert.equal(a.counts.CA, 1);
  c = capture();
  assert.equal(await main(['validate-spec', 'b.md', '--cwd', dir], c.io), 1);
  assert.match(c.out.stdout, /CA-XYZ-001/);
  assert.match(c.out.stdout, /nenhuma definição/i);
});

test('validate-spec shows next-free findings in pt-BR and exposes nextFree in --json', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'baco-nf-'));
  writeFileSync(join(dir, 's.md'), '# Spec\n\n| Campo | Valor |\n|---|---|\n| Código | XYZ |\n| Versão | 1.0 |\n| Próximos números livres | RF-XYZ-002, CA-XYZ-001 |\n\n## Critérios de aceite\n\n- **RF-XYZ-002 | A:** faz a.\n- **CA-XYZ-001 | B:** Dado a, quando b, então c.\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.0 | 2026-01-01 | x |\n');
  let c = capture();
  assert.equal(await main(['validate-spec', 's.md', '--json', '--cwd', dir], c.io), 0);
  const d = JSON.parse(c.out.stdout);
  assert.deepEqual(d.nextFree, { line: 7, declared: { RF: 'RF-XYZ-002', CA: 'CA-XYZ-001' }, minimum: { RF: 'RF-XYZ-003', CA: 'CA-XYZ-002' } });
  assert.deepEqual(d.findings.map((f) => f.code), ['NEXT_FREE_STALE', 'NEXT_FREE_STALE']);
  c = capture();
  await main(['validate-spec', 's.md', '--cwd', dir], c.io);
  assert.match(c.out.stdout, /RF-XYZ-002.*RF-XYZ-003/);
  assert.match(c.out.stdout, /Próximos números livres/);
});
