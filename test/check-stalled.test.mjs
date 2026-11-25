import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmprepo.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { parseRetomada } from '../skills/baco-sdd/scripts/commands/check-stalled.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

const prog = ({ situacao = 'rodando', autonoma = 'sim', conversa = '/portal/?chat=claude:abc', proximo = 'continuar T-002' } = {}) => `# Progresso | ENT-001 \`app\`

## Retomada

- **Atualizado em:** \`2026-11-25 10:00\`
- **Situação:** \`${situacao}\`
- **Execução autônoma:** \`${autonoma}\`
- **Conversa condutora:** \`${conversa}\`
- **Próximo passo:** ${proximo}
`;

test('parseRetomada extracts status, autonomous flag, conductor conversation and next step', () => {
  const r = parseRetomada(prog());
  assert.equal(r.status, 'rodando');
  assert.equal(r.autonomous, true);
  assert.equal(r.conductor, '/portal/?chat=claude:abc');
  assert.equal(r.nextStep, 'continuar T-002');

  const off = parseRetomada(prog({ autonoma: 'não', conversa: '<endereço>', situacao: 'parado por pergunta' }));
  assert.equal(off.status, 'parado por pergunta');
  assert.equal(off.autonomous, false);
  assert.equal(off.conductor, null);
});

test('check-stalled exits 2 when autonomous running delivery is idle past threshold, and 0 when recent or not autonomous or paused', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'language: pt-BR\n',
    'docs/entregas/ENT-001-app/plano.md': '# Plano\n',
    'docs/entregas/ENT-001-app/progresso.md': prog(),
    'docs/entregas/ENT-002-pausada/plano.md': '# Plano\n',
    'docs/entregas/ENT-002-pausada/progresso.md': prog({ situacao: 'parado por pergunta' }),
    'docs/entregas/ENT-003-manual/plano.md': '# Plano\n',
    'docs/entregas/ENT-003-manual/progresso.md': prog({ autonoma: 'não' }),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const p1 = join(dir, 'docs/entregas/ENT-001-app/progresso.md');
  const p2 = join(dir, 'docs/entregas/ENT-002-pausada/progresso.md');
  const p3 = join(dir, 'docs/entregas/ENT-003-manual/progresso.md');
  const old = new Date(Date.now() - 45 * 60 * 1000);
  utimesSync(p1, old, old);
  utimesSync(p2, old, old);
  utimesSync(p3, old, old);

  // Scanning all deliveries: only ENT-001 is autonomous + rodando + idle >= 20 min
  const c1 = capture();
  const code1 = await main(['check-stalled', '--minutes', '20', '--json', '--cwd', dir], c1.io);
  assert.equal(code1, 2, c1.out.stderr);
  const d1 = JSON.parse(c1.out.stdout);
  assert.equal(d1.stalled, true);
  assert.equal(d1.deliveries.length, 1);
  assert.equal(d1.deliveries[0].delivery, 'ENT-001');
  assert.equal(d1.deliveries[0].conductor, '/portal/?chat=claude:abc');
  assert.ok(d1.deliveries[0].idleMinutes >= 44);

  // Checking paused ENT-002 directly -> exit 0
  const c2 = capture();
  assert.equal(await main(['check-stalled', 'ENT-002', '--minutes', '20', '--json', '--cwd', dir], c2.io), 0);
  assert.equal(JSON.parse(c2.out.stdout).stalled, false);

  // Checking non-autonomous ENT-003 directly -> exit 0
  const c3 = capture();
  assert.equal(await main(['check-stalled', 'ENT-003', '--minutes', '20', '--json', '--cwd', dir], c3.io), 0);
  assert.equal(JSON.parse(c3.out.stdout).stalled, false);

  // Freshly updated ENT-001 -> exit 0
  const now = new Date();
  utimesSync(p1, now, now);
  const c4 = capture();
  assert.equal(await main(['check-stalled', 'ENT-001', '--minutes', '20', '--json', '--cwd', dir], c4.io), 0);
  assert.equal(JSON.parse(c4.out.stdout).stalled, false);

  // Invalid --minutes -> exit 64
  const c5 = capture();
  assert.equal(await main(['check-stalled', '--minutes', '0', '--cwd', dir], c5.io), 64);
});

test('check-stalled recognizes "Situação: rodando (T-03)" variants as running', async (t) => {
  const dir = await makeRepo({
    '.baco/config.yaml': 'language: pt-BR\n',
    'docs/entregas/ENT-004-nota/plano.md': '# Plano\n',
    'docs/entregas/ENT-004-nota/progresso.md': prog({ situacao: 'rodando (T-03)' }),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, 'docs/entregas/ENT-004-nota/progresso.md');
  const old = new Date(Date.now() - 35 * 60 * 1000);
  utimesSync(p, old, old);

  const c = capture();
  const code = await main(['check-stalled', '--minutes', '20', '--json', '--cwd', dir], c.io);
  assert.equal(code, 2, c.out.stderr);
  const d = JSON.parse(c.out.stdout);
  assert.equal(d.stalled, true);
  assert.equal(d.deliveries.length, 1);
  assert.equal(d.deliveries[0].delivery, 'ENT-004');
});
