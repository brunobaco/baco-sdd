import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { parseVerdict, VerdictError } from '../skills/baco-sdd/scripts/commands/import-verdict.mjs';
import { hasScopeSection } from '../skills/baco-sdd/scripts/lib/verdict.mjs';
import { renderHandoff } from '../skills/baco-sdd/scripts/commands/build-handoff.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const read = (p) => readFileSync(p, 'utf8');
const ENT = 'docs/entregas/ENT-001-a';
const spec = `# Spec X\n\n| Campo | Valor |\n|---|---|\n| Código | XX |\n| Versão | 1.0 |\n\n## Histórico\n\n| Versão | Data | Alteração |\n|---|---|---|\n| 1.0 | 2026-01-01 | x |\n\n## Requisitos\n\n- **RF-001 | Criar:** criar coisa.\n\n## Critérios de aceite\n\n- **CA-001 | Cria:** a coisa é criada.\n`;
const plan = (base = '**Base:** main\n') => `# Plano\n\n**Specs:** docs/specs/spec-x.md@1.0\n${base}`;

test('parseVerdict reads ajustes with 3 findings', () => {
  const v = parseVerdict(read(fx('veredito-ajustes.md')));
  assert.equal(v.verdict, 'ajustes');
  assert.equal(v.findings.length, 3);
  assert.deepEqual(v.findings[0], { severity: 'crítico', location: 'src/a.ts:42', text: 'o saldo é sobrescrito sem validar o proprietário' });
  assert.deepEqual(v.findings[1], { severity: 'importante', location: 'src/b.ts:10', text: 'falta teste para o caso de empresa duplicada' });
  assert.deepEqual(v.findings[2], { severity: 'sugestão', location: null, text: 'extrair a mensagem de erro para uma constante' });
});

test('parseVerdict: no location without dash, en dash, unknown verdict, malformed finding', () => {
  assert.equal(parseVerdict('veredito: Aprovado\n## Achados\n- [sugestão] só texto\n').findings[0].location, null);
  assert.equal(parseVerdict('VEREDITO: bloqueio\n## Achados\n- [Crítico] a.ts:1 – x\n').findings[0].location, 'a.ts:1');
  assert.throws(() => parseVerdict(read(fx('veredito-invalido.md'))), VerdictError);
  assert.throws(() => parseVerdict('VEREDITO: talvez\n'), VerdictError);
  assert.throws(() => parseVerdict('VEREDITO: ajustes\n## Achados\n- [grave] a.ts:1 — x\n'), VerdictError);
  assert.throws(() => parseVerdict('VEREDITO: ajustes\n## Achados\n- [crítico]\n'), VerdictError);
  assert.deepEqual(parseVerdict('VEREDITO: aprovado\n- [x] fora dos achados\n').findings, []);
});

test('import-verdict writes veredito and FIX tasks; 4th ajustes import exits 3', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan() });
  const { io, out } = capture();
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--json', '--cwd', dir], io), 0);
  assert.deepEqual(JSON.parse(out.stdout), { verdict: 'ajustes', round: 1, fixes: ['FIX-01.md', 'FIX-02.md'] });
  const v = read(join(dir, ENT, 'revisao/veredito-01.md'));
  assert.match(v, /<!-- baco:parsed \{.*\} -->\s*$/);
  const fix = read(join(dir, ENT, 'tarefas/FIX-01.md'));
  assert.ok(fix.startsWith('# FIX-01 | o saldo é sobrescrito sem validar o proprietário\n- **Origem:** veredito-01, achado 1\n- **Gravidade:** crítico\n- **Local:** src/a.ts:42\n- **Descrição:** o saldo é sobrescrito sem validar o proprietário\n'));
  // The same fields as any task: class from the severity, branch, lane, likely file and tests.
  for (const re of [/\| Entrega \| `ENT-001` \|/, /\| Classe \| `arriscada` \|/, /\| Nível\/esforço \| `forte\/medio` \|/, /\| Faixa \| `FIX` \|/,
    /\| Arquivos prováveis \| `src\/a\.ts` \|/, /\| Branch \| `baco\/ENT-001-FIX-01` \|/, /\| Parada humana \| `não` \|/, /## Testes da tarefa\n\n- a escrever: teste que falha antes da correção/]) assert.match(fix, re);
  assert.match(read(join(dir, ENT, 'tarefas/FIX-02.md')), /\| Classe \| `padrão` \|/);
  assert.ok(existsSync(join(dir, ENT, 'tarefas/FIX-02.md')));
  assert.ok(!existsSync(join(dir, ENT, 'tarefas/FIX-03.md')));
  for (let i = 2; i <= 3; i++) assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  const c = capture();
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], c.io), 3);
  assert.ok(existsSync(join(dir, ENT, 'revisao/veredito-04.md')));
});

test('import-verdict: aprovado on a late round is fine; invalid exits 1 and writes nothing', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan() });
  const { io, out } = capture();
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-invalido.md'), '--cwd', dir], io), 1);
  assert.match(out.stdout, /inválido/i);
  assert.ok(!existsSync(join(dir, ENT, 'revisao')));
});

test('build-handoff: six sections in order; after a verdict the next handoff is a delta since the answered head', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n'), 'a.txt': 'a\n' });
  commit(dir, { 'b.txt': 'first-change\n' }, 'first');
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--json', '--cwd', dir], io), 0);
  assert.deepEqual(Object.keys(JSON.parse(out.stdout)), ['file', 'round', 'mode', 'dest']);
  const h1 = read(join(dir, ENT, 'revisao/handoff-01.md'));
  assert.match(h1.split('\n')[0], /^<!-- baco:head [0-9a-f]{40} -->$/);
  const heads = ['Como usar', 'Prompt do revisor', 'Especificação', 'Decisões de arquitetura', 'Resultado dos testes', 'Diff'].map((h) => h1.indexOf(`\n## ${h}\n`));
  assert.ok(heads.every((i) => i > 0), String(heads));
  assert.deepEqual([...heads].sort((x, y) => x - y), heads);
  assert.match(h1, /CA-001 \| Cria/);
  assert.match(h1, /Nenhum resultado de teste fornecido/);
  assert.match(h1, /VEREDITO: aprovado \| ajustes \| bloqueio/);
  assert.doesNotMatch(h1, /^# .*delta/m);

  // R21: the delta base is the head of the handoff answered by the latest imported verdict.
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  commit(dir, { 'c.txt': 'second-change\n' }, 'second');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  const h2 = read(join(dir, ENT, 'revisao/handoff-02.md'));
  assert.match(h2, /^# .*delta/m);
  const diff2 = h2.slice(h2.indexOf('\n## Diff\n'));
  assert.match(diff2, /second-change/);
  assert.doesNotMatch(diff2, /first-change/);
});

test('build-handoff: no base exits 64; trace and adr are included', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('') });
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], io), 64);
  assert.match(out.stderr, /Base/);

  writeFileSync(join(dir, ENT, 'plano.md'), plan('**Base:** HEAD\n'));
  writeFileSync(join(dir, 'adr.md'), '# ADR-001 | Escolha\nUsar X.\n');
  writeFileSync(join(dir, 'trace.json'), JSON.stringify({
    cas: [{ ca: 'CA-001', status: 'failed', scenarios: [{ id: 'CT-001', via: 'qa', automation: 'automatizado', result: 'failed' }] }],
    orphanTests: [], summary: { proven: 0, failed: 1, pending: 0, uncovered: 0 },
  }));
  commit(dir, { 'x.txt': 'x\n' }, 'x');
  assert.equal(await main(['build-handoff', 'ENT-001', '--trace', 'trace.json', '--adr', 'adr.md', '--cwd', dir], capture().io), 0);
  const h = read(join(dir, ENT, 'revisao/handoff-01.md'));
  assert.match(h, /ADR-001 \| Escolha/);
  assert.match(h, /\| CA-001 \| falhou \| CT-001=falhou \|/);
  assert.doesNotMatch(h, /Nenhum resultado de teste/);
});

test('build-handoff: repeated --trace merges the criteria of every spec', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  const proven = (ca) => JSON.stringify({ cas: [{ ca, status: 'proven', scenarios: [] }], orphanTests: [], summary: { proven: 1, failed: 0, pending: 0, uncovered: 0 } });
  writeFileSync(join(dir, 't1.json'), proven('CA-001'));
  writeFileSync(join(dir, 't2.json'), proven('CA-002'));
  commit(dir, { 'x.txt': 'x\n' }, 'x');
  assert.equal(await main(['build-handoff', 'ENT-001', '--trace', 't1.json', '--trace', 't2.json', '--cwd', dir], capture().io), 0);
  const h = read(join(dir, ENT, 'revisao/handoff-01.md'));
  assert.match(h, /\| CA-001 \|/);
  assert.match(h, /\| CA-002 \|/);
  assert.match(h, /\| provados \| 2 \|/);
  assert.doesNotMatch(h, /Nenhum resultado de teste/);
});

test('renderHandoff uses a longer fence when the diff contains backticks', () => {
  const md = renderHandoff({ entId: 'ENT-001', specs: [], diff: '+```\n', trace: null, adrs: [], reviewerPrompt: 'p', sinceRef: null });
  assert.match(md, /````diff\n\+```\n````\n/);
});

test('parseVerdict handles decorated answers without dropping findings', () => {
  const variants = [
    'VEREDITO: ajustes\n## Achados:\n- [crítico] a.ts:1 — x\n',
    'VEREDITO: ajustes\n**Achados**\n- [crítico] a.ts:1 — x\n',
    'VEREDITO: ajustes\nAchados:\n- [crítico] a.ts:1 — x\n',
    'VEREDITO: ajustes\n## Achados\n* [crítico] a.ts:1 — x\n',
    'VEREDITO: ajustes\n## Achados\n1. [crítico] a.ts:1 — x\n',
    'VEREDITO: ajustes\n## Achados\n2) [crítico] a.ts:1 — x\n',
    'VEREDITO: ajustes\n## Achados\n- **[crítico]** `a.ts:1` — x\n',
    '## VEREDITO: ajustes\n## Achados\n- [crítico] a.ts:1 — x\n',
    '**VEREDITO:** ajustes\n## Achados\n- [crítico] a.ts:1 — x\n',
  ];
  for (const md of variants) {
    const v = parseVerdict(md);
    assert.equal(v.verdict, 'ajustes', md);
    assert.deepEqual(v.findings, [{ severity: 'crítico', location: 'a.ts:1', text: 'x' }], md);
  }
});

test('parseVerdict: unparsable severity line in Achados fails; ajustes without findings fails; hyphen text is not a location', () => {
  assert.throws(() => parseVerdict('VEREDITO: ajustes\n## Achados\nVeja [crítico] a.ts:1 x\n'), VerdictError);
  assert.throws(() => parseVerdict('VEREDITO: ajustes\n## Achados\n'), (e) => e instanceof VerdictError && e.reason.key === 'verdict.reason.no_findings');
  assert.throws(() => parseVerdict('VEREDITO: bloqueio\n'), VerdictError);
  assert.equal(parseVerdict('VEREDITO: aprovado\n').findings.length, 0);
  assert.deepEqual(parseVerdict('VEREDITO: ajustes\n## Achados\n- [sugestão] extrair - a constante\n').findings[0], { severity: 'sugestão', location: null, text: 'extrair - a constante' });
});

test('verdict reasons are localized with a hint', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan() });
  const { io, out } = capture();
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-invalido.md'), '--cwd', dir], io), 1);
  assert.match(out.stdout, /Não encontrei a linha VEREDITO/);
  assert.match(out.stdout, /Peça ao revisor/);
});

test('handoff includes per-CA table and failing JUnit cases; prompt/footer rules', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  writeFileSync(join(dir, 'trace.json'), JSON.stringify({
    cas: [{ ca: 'CA-001', status: 'failed', scenarios: [{ id: 'CT-001', via: 'qa', automation: 'automatizado', result: 'failed' }] }],
    orphanTests: [], summary: { proven: 0, failed: 1, pending: 0, uncovered: 0 },
  }));
  const long = 'x'.repeat(800);
  writeFileSync(join(dir, 'r.xml'), `<testsuite><testcase classname="Suite" name="CA-001 cria"><failure message="${long}"/></testcase><testcase classname="Suite" name="ok"/></testsuite>`);
  commit(dir, { 'x.txt': 'x\n' }, 'x');
  assert.equal(await main(['build-handoff', 'ENT-001', '--trace', 'trace.json', '--junit', 'r.xml', '--cwd', dir], capture().io), 0);
  const h = read(join(dir, ENT, 'revisao/handoff-01.md'));
  assert.match(h, /\| CA-001 \| falhou \| CT-001=falhou \|/);
  assert.match(h, /Suite › CA-001 cria/);
  assert.ok(h.includes('x'.repeat(500)) && !h.includes('x'.repeat(501)));
  assert.doesNotMatch(h, /Suite › ok/);
  assert.match(h, /Responda em texto simples/);
  assert.match(h, /Para quem enviou este arquivo/);
  assert.ok(h.trimEnd().endsWith('Responda agora somente no formato obrigatório acima.'));
});

test('suffixed Achados headings still collect findings', () => {
  for (const h of ['## Achados (1)', 'Achados (1):', '**Achados (1)**', '## Achados: 1']) {
    const v = parseVerdict(`VEREDITO: ajustes\n${h}\n- [importante] a.ts:1 — x\n`);
    assert.equal(v.findings.length, 1, h);
  }
});

test('aprovado with critico/importante is contradictory; with only sugestao is fine', () => {
  for (const sev of ['crítico', 'importante']) {
    assert.throws(() => parseVerdict(`VEREDITO: aprovado\n## Achados (1)\n- [${sev}] a.ts:1 — x\n`),
      (e) => e instanceof VerdictError && e.reason.key === 'verdict.reason.contradictory');
  }
  assert.equal(parseVerdict('VEREDITO: aprovado\n## Achados\n- [sugestão] — x\n').findings.length, 1);
});

test('I6: severity-labelled bullets without brackets are malformed, never a clean aprovado', () => {
  const bad = [
    '- crítico: a.ts:1 — x',
    '- **Crítico** a.ts:1 — x',
    '1. (crítico) a.ts:1 — x',
    '- Importante: falta teste',
    '* _Sugestão_ — nome',
    '- **Bloqueante:** quebra o build',
    '2) BLOQUEIO a.ts:1',
  ];
  for (const line of bad) {
    for (const v of ['aprovado', 'ajustes']) {
      assert.throws(() => parseVerdict(`VEREDITO: ${v}\n## Achados\n${line}\n`),
        (e) => e instanceof VerdictError && e.reason.key === 'verdict.reason.malformed_finding', `${v}: ${line}`);
    }
  }
  // Ordinary prose bullets are still ignored.
  assert.deepEqual(parseVerdict('VEREDITO: aprovado\n## Achados\n- nenhum achado relevante\n- Criticamente, nada a apontar\n').findings, []);
});

test('I7: two build-handoff runs with no verdict in between are both full', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec });
  const base = commit(dir, { [`${ENT}/plano.md`]: plan('**Base:** BASE\n') }, 'plan');
  commit(dir, { [`${ENT}/plano.md`]: plan(`**Base:** ${base}\n`), 'b.txt': 'first-change\n' }, 'first');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  commit(dir, { 'c.txt': 'second-change\n' }, 'second');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  const h2 = read(join(dir, ENT, 'revisao/handoff-02.md'));
  assert.doesNotMatch(h2, /^# .*delta/m);
  const diff2 = h2.slice(h2.indexOf('\n## Diff\n'));
  assert.match(diff2, /first-change/);
  assert.match(diff2, /second-change/);
});

test('I7: import-verdict records the answered handoff and its head; numbers sort numerically', async () => {
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(40);
  const dir = await makeRepo({
    [`${ENT}/plano.md`]: plan(),
    [`${ENT}/revisao/handoff-99.md`]: `<!-- baco:head ${shaA} -->\n# h99\n`,
    [`${ENT}/revisao/handoff-100.md`]: `<!-- baco:head ${shaB} -->\n# h100\n`,
  });
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  const footer = JSON.parse(/<!-- baco:parsed (.*) -->\s*$/.exec(read(join(dir, ENT, 'revisao/veredito-01.md')))[1]);
  assert.equal(footer.handoff, 'handoff-100.md');
  assert.equal(footer.reviewedHead, shaB);
  assert.equal(footer.verdict, 'ajustes');
});

test('I7: a verdict imported with no handoff records null; the next handoff is full from the plan Base', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  const footer = JSON.parse(/<!-- baco:parsed (.*) -->\s*$/.exec(read(join(dir, ENT, 'revisao/veredito-01.md')))[1]);
  assert.equal(footer.handoff, null);
  assert.equal(footer.reviewedHead, null);
  commit(dir, { 'b.txt': 'change\n' }, 'c');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  assert.doesNotMatch(read(join(dir, ENT, 'revisao/handoff-01.md')), /^# .*delta/m);
});

test('M2: a malformed --trace exits 65 with handoff.bad_trace (localized, no raw JSON error)', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n'), 'bad.json': '{nope', 'shape.json': '{"cas":[null]}' });
  for (const f of ['bad.json', 'shape.json']) {
    const { io, out } = capture();
    assert.equal(await main(['build-handoff', 'ENT-001', '--trace', f, '--cwd', dir], io), 65, f);
    assert.match(out.stderr, /inválido/);
    assert.doesNotMatch(out.stderr, /JSON|Unexpected|position/);
    assert.ok(!existsSync(join(dir, ENT, 'revisao/handoff-01.md')));
  }
});

test('M5: handoff CA table header and tokens are localized', () => {
  const trace = { cas: [{ ca: 'CA-001', status: 'pending', scenarios: [{ id: 'CT-001', result: 'manual_pending' }] }], summary: {} };
  const en = renderHandoff({ entId: 'ENT-001', specs: [], diff: '', trace, adrs: [], reviewerPrompt: 'p', lang: 'en' });
  assert.match(en, /\| CA \| Status \| Scenarios \|/);
  assert.match(en, /\| CA-001 \| pending \| CT-001=awaiting execution \|/);
  const pt = renderHandoff({ entId: 'ENT-001', specs: [], diff: '', trace, adrs: [], reviewerPrompt: 'p', lang: 'pt-BR' });
  assert.match(pt, /\| CA \| Situação \| Cenários \|/);
  assert.match(pt, /\| CA-001 \| pendente \| CT-001=aguardando execução \|/);
});

// Plan 4: slimmer packets, two review modes.
const diffPart = (h) => h.slice(h.indexOf('\n## Diff\n'));
const headOf = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

test('P4: the handoff diff never carries docs/entregas/** (full and delta); code does', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec });
  commit(dir, { [`${ENT}/plano.md`]: plan(`**Base:** ${headOf(dir)}\n`), 'src/a.js': 'code-change-1\n', [`${ENT}/progresso.md`]: 'relato-do-implementador\n' }, 'one');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  const h1 = diffPart(read(join(dir, ENT, 'revisao/handoff-01.md')));
  assert.match(h1, /code-change-1/);
  assert.doesNotMatch(h1, /relato-do-implementador|docs\/entregas/);
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  commit(dir, { 'src/a.js': 'code-change-2\n', [`${ENT}/progresso.md`]: 'outro-relato\n' }, 'two');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  const h2 = diffPart(read(join(dir, ENT, 'revisao/handoff-02.md')));
  assert.match(h2, /code-change-2/);
  assert.doesNotMatch(h2, /outro-relato|docs\/entregas|veredito|handoff-01/);
});

test('P4: the excluded folder follows docs_root', async () => {
  const E = 'documentos/entregas/ENT-001-a';
  const dir = await makeRepo({ '.baco/config.yaml': 'docs_root: documentos\n', 'docs/specs/spec-x.md': spec });
  commit(dir, { [`${E}/plano.md`]: plan(`**Base:** ${headOf(dir)}\n`), 'src/a.js': 'code\n', [`${E}/progresso.md`]: 'relato\n', 'docs/entregas/x.md': 'not-a-delivery\n' }, 'one');
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  const h = diffPart(read(join(dir, E, 'revisao/handoff-01.md')));
  assert.doesNotMatch(h, /relato/);
  assert.match(h, /not-a-delivery/);
});

test('P4: a delta round repeats a spec or ADR only when it changed since the reviewed head', async () => {
  const spec2 = spec.replace('a coisa é criada.', 'a coisa é criada e listada.');
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n'), 'adr-1.md': '# ADR-001 | Um\n', 'adr-2.md': '# ADR-002 | Dois\n' });
  commit(dir, { 'src/a.js': 'a\n' }, 'one');
  const adrs = ['--adr', 'adr-1.md', '--adr', 'adr-2.md'];
  assert.equal(await main(['build-handoff', 'ENT-001', ...adrs, '--cwd', dir], capture().io), 0);
  const h1 = read(join(dir, ENT, 'revisao/handoff-01.md'));
  assert.match(h1, /CA-001 \| Cria/);
  assert.match(h1, /ADR-001 \| Um/);
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  commit(dir, { 'src/a.js': 'b\n' }, 'two');
  assert.equal(await main(['build-handoff', 'ENT-001', ...adrs, '--cwd', dir], capture().io), 0);
  const h2 = read(join(dir, ENT, 'revisao/handoff-02.md'));
  assert.doesNotMatch(h2, /CA-001 \| Cria/);
  assert.match(h2, /### docs\/specs\/spec-x\.md@1\.0\n\nSem mudanças desde a rodada 1\./);
  assert.match(h2, /### adr-1\.md\n\nSem mudanças desde a rodada 1\./);
  assert.doesNotMatch(h2, /ADR-001 \| Um|ADR-002 \| Dois/);

  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  commit(dir, { 'docs/specs/spec-x.md': spec2, 'adr-2.md': '# ADR-002 | Dois revisto\n' }, 'three');
  assert.equal(await main(['build-handoff', 'ENT-001', ...adrs, '--cwd', dir], capture().io), 0);
  const h3 = read(join(dir, ENT, 'revisao/handoff-03.md'));
  assert.match(h3, /CA-001 \| Cria:\*\* a coisa é criada e listada/);
  assert.match(h3, /ADR-002 \| Dois revisto/);
  assert.match(h3, /### adr-1\.md\n\nSem mudanças desde a rodada 2\./);
});

// Removes the given folders when the test ends (the export tests leave copies next to the repo).
const cleanup = (t, ...dirs) => t.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('P4: --mode is validated; --dest needs repositorio; data carries mode and dest', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  cleanup(t, dir);
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'zip', '--cwd', dir], capture().io), 64);
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', '--cwd', dir], capture().io), 64);
  assert.equal(await main(['build-handoff', 'ENT-001', '--dest', '/tmp/x', '--cwd', dir], capture().io), 64);
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'repositorio', '--dest', '--cwd', dir], capture().io), 64);
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pacote', '--json', '--cwd', dir], io), 0);
  assert.deepEqual(JSON.parse(out.stdout), { file: join(dir, ENT, 'revisao/handoff-01.md'), round: 1, mode: 'pacote', dest: null });
});

test('P4: --mode repositorio exports HEAD without docs/entregas next to the repo, with REVISAO.md and mudancas.diff', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, 'adr.md': '# ADR-001 | Escolha\n' });
  cleanup(t, dir, ...['r01', 'r02'].map((r) => join(dirname(dir), `${basename(dir)}-revisao-ENT-001-${r}`)));
  const base = commit(dir, { [`${ENT}/plano.md`]: plan('**Base:** BASE\n') }, 'plan');
  commit(dir, { [`${ENT}/plano.md`]: plan(`**Base:** ${base}\n`), 'src/a.js': 'code-change\n', [`${ENT}/progresso.md`]: 'relato\n' }, 'work');
  writeFileSync(join(dir, 'trace.json'), JSON.stringify({ cas: [{ ca: 'CA-001', status: 'proven', scenarios: [] }], summary: { proven: 1, failed: 0, pending: 0, uncovered: 0 } }));
  writeFileSync(join(dir, 'uncommitted.txt'), 'nope\n');
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'repositorio', '--trace', 'trace.json', '--adr', 'adr.md', '--json', '--cwd', dir], io), 0, out.stderr);
  const data = JSON.parse(out.stdout);
  const dest = join(dirname(dir), `${basename(dir)}-revisao-ENT-001-r01`);
  assert.deepEqual(data, { file: join(dir, ENT, 'revisao/handoff-01.md'), round: 1, mode: 'repositorio', dest });
  // The copy: tracked files at HEAD, no delivery folder, no untracked files, no .git.
  assert.equal(read(join(dest, 'src/a.js')), 'code-change\n');
  assert.ok(existsSync(join(dest, 'docs/specs/spec-x.md')));
  assert.ok(!existsSync(join(dest, 'docs/entregas')));
  assert.ok(!existsSync(join(dest, 'uncommitted.txt')));
  assert.ok(!existsSync(join(dest, '.git')));
  const diff = read(join(dest, 'mudancas.diff'));
  assert.match(diff, /code-change/);
  assert.doesNotMatch(diff, /docs\/entregas|relato/);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const rev = read(join(dest, 'REVISAO.md'));
  for (const s of ['ENT-001', head, base, 'docs/specs/spec-x.md', 'adr.md', 'mudancas.diff', '| provados | 1 |', 'VEREDITO: aprovado | ajustes | bloqueio', '- [crítico]']) assert.ok(rev.includes(s), s);
  assert.match(rev, /^# Revisão externa: ENT-001, rodada 1$/m);
  assert.match(rev, /rodar os testes/i);
  assert.doesNotMatch(rev, /sem ferramentas|não tem acesso/i);
  // In the repo: a short handoff with the head line, the mode and the export path, not the diff.
  const h = read(data.file);
  assert.equal(h.split('\n')[0], `<!-- baco:head ${head} -->`);
  assert.ok(h.includes(dest));
  assert.match(h, /repositório/);
  assert.doesNotMatch(h, /code-change|## Diff/);
  // The verdict loop is unchanged: the next handoff is a delta since this head.
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  commit(dir, { 'src/b.js': 'second\n' }, 'fix');
  const c2 = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'repositorio', '--json', '--cwd', dir], c2.io), 0, c2.out.stderr);
  const d2 = JSON.parse(c2.out.stdout);
  assert.equal(d2.dest, join(dirname(dir), `${basename(dir)}-revisao-ENT-001-r02`));
  const diff2 = read(join(d2.dest, 'mudancas.diff'));
  assert.match(diff2, /second/);
  assert.doesNotMatch(diff2, /code-change/);
  const rev2 = read(join(d2.dest, 'REVISAO.md'));
  assert.match(rev2, /docs\/specs\/spec-x\.md.*sem mudanças desde a rodada 1/);
  assert.match(rev2, /^# Revisão externa: ENT-001, rodada 2 \(só o que mudou desde a rodada 1\)$/m);
});

test('P4: --mode repositorio refuses a dest inside the repo or a non-empty dest; nothing is written', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  cleanup(t, dir);
  commit(dir, { 'src/a.js': 'x\n' }, 'x');
  for (const dest of [dir, join(dir, 'out'), 'sub/out']) {
    const { io, out } = capture();
    assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'repositorio', '--dest', dest, '--cwd', dir], io), 64, dest);
    assert.match(out.stderr, /dentro do repositório/);
  }
  const busy = mkdtempSync(join(tmpdir(), 'baco-dest-'));
  cleanup(t, busy);
  writeFileSync(join(busy, 'x.txt'), 'x');
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'repositorio', '--dest', busy, '--cwd', dir], io), 64);
  assert.match(out.stderr, /não está vazia/);
  assert.ok(!existsSync(join(dir, ENT, 'revisao/handoff-01.md')));
  // An empty existing folder outside the repo is fine.
  const empty = mkdtempSync(join(tmpdir(), 'baco-dest-'));
  cleanup(t, empty);
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'repositorio', '--dest', empty, '--cwd', dir], capture().io), 0);
  assert.equal(read(join(empty, 'src/a.js')), 'x\n');
});

test('P4: reviewer prompts allow tools, forbid edits and keep the verdict contract', () => {
  const T = (n) => read(fileURLToPath(new URL(`../skills/baco-sdd/templates/pt-BR/${n}`, import.meta.url)));
  for (const n of ['prompt-revisor.md', 'prompt-revisor-repositorio.md', 'prompt-revisor-pr.md']) {
    const p = T(n);
    assert.doesNotMatch(p, /sem ferramentas|não tem acesso[^.]*ferramentas|não rode|não execute/i, n);
    assert.match(p, /não (altere|edite|mude)/i, n);
    assert.match(p, /VEREDITO: aprovado \| ajustes \| bloqueio/, n);
    assert.match(p, /## Achados\n- \[crítico\] caminho\/arquivo\.ts:42 - descrição/, n);
    assert.match(p, /Responda em texto simples/, n);
  }
  assert.match(T('prompt-revisor-repositorio.md'), /rode os testes/i);
  const pr = T('prompt-revisor-pr.md');
  assert.match(pr, /não abra[^.\n]*docs\/entregas\//i);
  // The one file the PR reviewer may create is the answer file named in the request.
  assert.match(pr, /único arquivo que você pode criar é o arquivo de resposta/i);
  assert.doesNotMatch(pr, /não crie/i);
  assert.match(pr, /não abra a pasta `\.baco\/logs\/`/i);
  assert.match(pr, /não use o `gh`/i);
  assert.match(pr, /rodadas anteriores/i);
});

// Mode pr: the review of the delivery's pull request, in place, by an agent or a person.
test('--mode pr writes the request, the diff and the answer path under .baco/logs, never the delivery folder', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, 'docs/qa/cenarios-qa-spec-x.md': '# QA\n', 'adr.md': '# ADR-001 | Escolha\n', '.gitignore': '.baco/logs/\n' });
  cleanup(t, dir);
  const base = commit(dir, { [`${ENT}/plano.md`]: plan('**Base:** BASE\n') }, 'plan');
  commit(dir, { [`${ENT}/plano.md`]: plan(`**Base:** ${base}\n`), 'src/a.js': 'code-change\n', [`${ENT}/progresso.md`]: 'relato\n' }, 'work');
  writeFileSync(join(dir, 'trace.json'), JSON.stringify({ cas: [{ ca: 'CA-001', status: 'proven', scenarios: [] }], summary: { proven: 1, failed: 0, pending: 0, uncovered: 0 } }));
  const { io, out } = capture();
  const args = ['build-handoff', 'ENT-001', '--mode', 'pr', '--pr', 'https://github.com/org/repo/pull/12', '--qa', 'docs/qa/cenarios-qa-spec-x.md', '--adr', 'adr.md', '--trace', 'trace.json', '--json', '--cwd', dir];
  assert.equal(await main(args, io), 0, out.stderr);
  const data = JSON.parse(out.stdout);
  const dest = join(dir, '.baco/logs/revisao-pr/ENT-001-r01');
  assert.deepEqual(data, { file: join(dir, ENT, 'revisao/handoff-01.md'), round: 1, mode: 'pr', dest, request: join(dest, 'pedido.md'), answer: join(dest, 'resposta.md') });
  assert.ok(!existsSync(data.answer), 'the answer is written by the reviewer, never by the engine');
  const diff = read(join(dest, 'mudancas.diff'));
  assert.match(diff, /code-change/);
  assert.doesNotMatch(diff, /docs\/entregas|relato/);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const req = read(data.request);
  for (const s of ['ENT-001', head, base, 'docs/specs/spec-x.md', 'docs/qa/cenarios-qa-spec-x.md', 'adr.md', '`.baco/logs/revisao-pr/ENT-001-r01/mudancas.diff`', '`.baco/logs/revisao-pr/ENT-001-r01/resposta.md`', '| provados | 1 |', 'VEREDITO: aprovado | ajustes | bloqueio', '- [crítico]', 'docs/entregas/']) assert.ok(req.includes(s), s);
  assert.match(req, /^# Revisão do PR: ENT-001, rodada 1$/m);
  assert.match(req, /não abra[^.\n]*docs\/entregas\//i);
  assert.doesNotMatch(req, /code-change/);
  // The request never points to the PR: `gh pr diff/view` would show docs/entregas/.
  assert.ok(!req.includes('https://github.com/org/repo/pull/12'), 'no PR URL in the request');
  assert.ok(!req.includes(dir), 'no absolute path in the request');
  // In the repo: the short record with the head line, the PR and both paths relative to the root, never the diff.
  const h = read(data.file);
  assert.equal(h.split('\n')[0], `<!-- baco:head ${head} -->`);
  assert.ok(h.includes('.baco/logs/revisao-pr/ENT-001-r01/pedido.md') && h.includes('.baco/logs/revisao-pr/ENT-001-r01/resposta.md') && h.includes('https://github.com/org/repo/pull/12'));
  assert.ok(!h.includes(dir), 'no absolute path in the committed handoff');
  assert.doesNotMatch(h, /code-change|## Diff/);
  // The reviewer's answer file goes straight to import-verdict; the next round is a delta.
  writeFileSync(data.answer, read(fx('veredito-ajustes.md')));
  assert.equal(await main(['import-verdict', 'ENT-001', data.answer, '--cwd', dir], capture().io), 0);
  commit(dir, { 'src/b.js': 'second\n' }, 'fix');
  const c2 = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pr', '--json', '--cwd', dir], c2.io), 0, c2.out.stderr);
  const d2 = JSON.parse(c2.out.stdout);
  assert.equal(d2.dest, join(dir, '.baco/logs/revisao-pr/ENT-001-r02'));
  const diff2 = read(join(d2.dest, 'mudancas.diff'));
  assert.match(diff2, /second/);
  assert.doesNotMatch(diff2, /code-change/);
  const req2 = read(d2.request);
  assert.match(req2, /docs\/specs\/spec-x\.md.*sem mudanças desde a rodada 1/);
  assert.match(req2, /^# Revisão do PR: ENT-001, rodada 2 \(só o que mudou desde a rodada 1\)$/m);
  assert.doesNotMatch(req2, /github\.com|pull\/12/);
  assert.match(read(d2.file), /sem PR no GitHub|diferença local/i);
});

test('--mode pr: --pr and --qa only with mode pr; --dest is refused', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  cleanup(t, dir);
  for (const extra of [['--pr', '12'], ['--qa', 'q.md'], ['--mode', 'repositorio', '--pr', '12'], ['--mode', 'pr', '--dest', '/tmp/x'], ['--mode', 'pr', '--pr']]) {
    assert.equal(await main(['build-handoff', 'ENT-001', ...extra, '--cwd', dir], capture().io), 64, extra.join(' '));
  }
});

test('--mode pr: a round folder left by an interrupted run (no handoff-NN.md) is reused; a stale answer there is older than the new request', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n'), '.gitignore': '.baco/logs/\n' });
  cleanup(t, dir);
  commit(dir, { 'src/a.js': 'x\n' }, 'x');
  const busy = join(dir, '.baco/logs/revisao-pr/ENT-001-r01');
  execFileSync('mkdir', ['-p', busy]);
  writeFileSync(join(busy, 'pedido.md'), 'old\n');
  writeFileSync(join(busy, 'resposta.md'), 'VEREDITO: aprovado\n## Achados\n');
  execFileSync('touch', ['-d', '2020-01-01', join(busy, 'resposta.md')]);
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pr', '--json', '--cwd', dir], io), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).dest, busy);
  assert.match(read(join(busy, 'pedido.md')), /^# Revisão do PR: ENT-001, rodada 1$/m);
  assert.ok(existsSync(join(dir, ENT, 'revisao/handoff-01.md')));
  // The answer left there answered an old request: import-pr-verdict refuses it.
  commit(dir, {}, 'handoff');
  const c = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], c.io), 65);
  assert.match(c.out.stderr, /mais antiga que o pedido/);
});

test('--mode pr warns when .baco/logs/ is not git-ignored', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  cleanup(t, dir);
  commit(dir, { 'src/a.js': 'x\n' }, 'x');
  const { io, out } = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pr', '--cwd', dir], io), 0);
  assert.match(out.stderr + out.stdout, /\.baco\/logs\/[^\n]*\.gitignore/);
  writeFileSync(join(dir, '.gitignore'), '.baco/logs/\n');
  const c = capture();
  commit(dir, { '.gitignore': '.baco/logs/\n' }, 'ignore');
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pr', '--cwd', dir], c.io), 0);
  assert.doesNotMatch(c.out.stderr + c.out.stdout, /\.gitignore/);
});

// import-pr-verdict: the automatic import of the agent reviewer's answer, latest pr round only.
const SCOPE = '## O que foi conferido\nLi as mudanças e os critérios da spec.\n';

test('import-pr-verdict refuses an answer without a filled "O que foi conferido" section', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, '.gitignore': '.baco/logs/\n', [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  cleanup(t, dir);
  commit(dir, { 'src/a.js': 'a\n' }, 'work');
  const r1 = await prRound(dir, 1);
  for (const body of ['VEREDITO: aprovado\n## Achados\n', 'VEREDITO: aprovado\n## O que foi conferido\n\n## Achados\n', 'VEREDITO: aprovado\n## Achados\n## O que foi conferido\n']) {
    writeFileSync(r1.answer, body);
    const c = capture();
    assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], c.io), 1, body);
    assert.match(c.out.stdout + c.out.stderr, /O que foi conferido/);
    assert.ok(!existsSync(join(dir, ENT, 'revisao/veredito-01.md')));
  }
  writeFileSync(r1.answer, 'VEREDITO: aprovado\n## O que foi conferido\nLi o diff.\n## Achados\n');
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], capture().io), 0);
  // import-verdict (a person's file) keeps its older format, with no scope section.
  assert.equal(hasScopeSection('VEREDITO: aprovado\n## Achados\n'), false);
  // PR review: punctuation on the heading is not content.
  for (const empty of ['## O que foi conferido?\n## Achados\n', '## O que foi conferido:\n\n', '**O que foi conferido?** -\nVEREDITO: aprovado\n', '## O que foi conferido\n-\n---\n## Achados\n']) {
    assert.equal(hasScopeSection(empty), false, empty);
  }
  assert.equal(hasScopeSection('## O que foi conferido?\nRodei os testes.\n'), true);
  assert.equal(hasScopeSection('O que foi conferido: o diff e os testes.\n'), true);
});
async function prRound(dir, n) {
  const c = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pr', '--json', '--cwd', dir], c.io), 0, c.out.stderr);
  commit(dir, {}, `handoff ${n}`);
  return JSON.parse(c.out.stdout);
}

test('import-pr-verdict imports the answer of the latest committed pr round, with the same rules as import-verdict', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, '.gitignore': '.baco/logs/\n' });
  cleanup(t, dir);
  const base = commit(dir, { [`${ENT}/plano.md`]: plan('**Base:** BASE\n') }, 'plan');
  commit(dir, { [`${ENT}/plano.md`]: plan(`**Base:** ${base}\n`), 'src/a.js': 'a\n' }, 'work');
  const r1 = await prRound(dir, 1);
  writeFileSync(r1.answer, read(fx('veredito-ajustes.md')).replace('## Achados', `${SCOPE}## Achados`));
  const { io, out } = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--json', '--cwd', dir], io), 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), { verdict: 'ajustes', round: 1, fixes: ['FIX-01.md', 'FIX-02.md'], answer: '.baco/logs/revisao-pr/ENT-001-r01/resposta.md' });
  const v = read(join(dir, ENT, 'revisao/veredito-01.md'));
  assert.match(v, /"handoff":"handoff-01\.md"/);
  // The footer says who gave the verdict: the agent reviewer here, the person with import-verdict.
  assert.equal(JSON.parse(/<!-- baco:parsed (.*) -->\s*$/.exec(v)[1]).source, 'agent');
  assert.equal(await main(['import-verdict', 'ENT-001', fx('veredito-ajustes.md'), '--cwd', dir], capture().io), 0);
  const byPerson = read(join(dir, ENT, 'revisao/veredito-02.md'));
  assert.equal(JSON.parse(/<!-- baco:parsed (.*) -->\s*$/.exec(byPerson)[1]).source, 'person');
  rmSync(join(dir, ENT, 'revisao/veredito-02.md'));
  for (const f of ['FIX-03.md', 'FIX-04.md']) rmSync(join(dir, ENT, 'tarefas', f));
  // The same round cannot be imported twice.
  const again = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], again.io), 64);
  assert.match(again.out.stderr, /já foi importada/);
  assert.ok(!existsSync(join(dir, ENT, 'revisao/veredito-02.md')));
  // Round 2: the round 1 answer (even an aprovado) is never taken for it.
  commit(dir, { 'src/b.js': 'b\n' }, 'fix');
  writeFileSync(r1.answer, `VEREDITO: aprovado\n${SCOPE}## Achados\n`);
  const r2 = await prRound(dir, 2);
  const miss = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], miss.io), 65);
  assert.match(miss.out.stderr, /ENT-001-r02\/resposta\.md/);
  assert.ok(!existsSync(join(dir, ENT, 'revisao/veredito-02.md')));
  writeFileSync(r2.answer, `VEREDITO: aprovado\n${SCOPE}## Achados\n`);
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], capture().io), 0);
  assert.match(read(join(dir, ENT, 'revisao/veredito-02.md')), /"verdict":"aprovado".*"handoff":"handoff-02\.md"/);
});

test('import-pr-verdict refuses an uncommitted latest handoff, a round that is not a pr round, extra arguments and an invalid answer', async (t) => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': spec, '.gitignore': '.baco/logs/\n', [`${ENT}/plano.md`]: plan('**Base:** HEAD\n') });
  cleanup(t, dir);
  commit(dir, { 'src/a.js': 'a\n' }, 'work');
  const none = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], none.io), 64, 'no handoff yet');
  assert.equal(await main(['import-pr-verdict', 'ENT-001', 'outro.md', '--cwd', dir], capture().io), 64, 'no file argument');
  const c = capture();
  assert.equal(await main(['build-handoff', 'ENT-001', '--mode', 'pr', '--json', '--cwd', dir], c.io), 0);
  const r1 = JSON.parse(c.out.stdout);
  writeFileSync(r1.answer, `VEREDITO: aprovado\n${SCOPE}## Achados\n`);
  const unc = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], unc.io), 64);
  assert.match(unc.out.stderr, /handoff-01\.md[^\n]*commit/);
  commit(dir, {}, 'handoff 1');
  writeFileSync(r1.answer, 'VEREDITO: talvez\n');
  const bad = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], bad.io), 1);
  assert.ok(!existsSync(join(dir, ENT, 'revisao/veredito-01.md')));
  // A pacote round after it: there is no pr answer for the latest round.
  assert.equal(await main(['build-handoff', 'ENT-001', '--cwd', dir], capture().io), 0);
  commit(dir, {}, 'handoff 2');
  const pac = capture();
  assert.equal(await main(['import-pr-verdict', 'ENT-001', '--cwd', dir], pac.io), 65);
  assert.match(pac.out.stderr, /ENT-001-r02\/resposta\.md/);
});
