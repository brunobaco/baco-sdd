import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseVerdict } from '../skills/baco-sdd/scripts/lib/verdict.mjs';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { frontmatter, read } from './helpers/content.mjs';

const EVALS = join(dirname(fileURLToPath(import.meta.url)), '..', 'evals');
const NOT_CASES = new Set(['lib', 'fixtures', 'manual', 'e2e', 'results']);
const subdirs = (d) => (existsSync(d) ? readdirSync(d).filter((n) => statSync(join(d, n)).isDirectory()) : []);

const caseDirs = () => subdirs(EVALS)
  .filter((n) => !NOT_CASES.has(n) && existsSync(join(EVALS, n, 'prompt.md')))
  .map((n) => join(EVALS, n));
const graders = (dir) => (existsSync(join(dir, 'graders'))
  ? readdirSync(join(dir, 'graders')).filter((f) => f.endsWith('.md')).map((f) => join(dir, 'graders', f))
  : []);
const caseYamls = () => caseDirs().map((d) => join(d, 'case.yaml')).filter(existsSync);
const shFiles = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) return shFiles(p);
  return n.endsWith('.sh') ? [p] : [];
});
const scaffoldScripts = () => caseDirs().flatMap(shFiles);

test('every eval case is cheap, bounded and has a behavioral grader', () => {
  for (const dir of caseDirs()) {
    const { data } = frontmatter(read(join(dir, 'prompt.md')));
    assert.equal(data.runs, '1', dir);
    assert.equal(data.model, 'sonnet', dir);
    assert.ok(Number(data.max_turns) <= 15, dir);
    assert.ok(Number(data.timeout_seconds ?? 300) <= 600, dir);
    const types = graders(dir).map((g) => frontmatter(read(g)).data.type);
    assert.ok(types.some((t) => ['tool_used', 'tool_order', 'file_exists'].includes(t)), `${dir}: no behavioral grader`);
  }
});

test('scaffolds stay inside their workspace', () => {
  // The only documented use of `..`: the case-local scaffold reaching the shared helper and the fixtures.
  const DOCUMENTED = /"\$\(dirname "\$0"\)\/\.\.\/(lib\/make-repo\.sh|fixtures)(\/[\w.-]+)?"?/g;
  for (const f of [join(EVALS, 'lib', 'make-repo.sh'), ...scaffoldScripts(), ...caseYamls()]) {
    const s = read(f);
    for (const bad of [/\$HOME/, /(^|\s)~\//, /(^|[\s"'=])~($|[\s/"'])/m, /(^|[\s"'])\/(?!dev\/null)[A-Za-z]/m]) assert.ok(!bad.test(s), `${f}: ${bad}`);
    assert.ok(!/\.\./.test(s.replace(DOCUMENTED, '')), `${f}: '..' outside the documented forms`);
  }
});

test('the 8 minimum cases exist, automated or manual', () => {
  for (const c of ['ativacao', 'gate-obrigatorio', 'afrouxar-teste', 'ca-modificado', 'retomada', 'meio-do-ciclo', 'plano-desatualizado', 'handoff'])
    assert.ok(existsSync(join(EVALS, c, 'prompt.md')) || existsSync(join(EVALS, 'manual', `${c}.md`)), c);
});

test('caseDirs ignores support folders and folders without a prompt', () => {
  for (const d of caseDirs()) assert.ok(!NOT_CASES.has(d.split('/').pop()), d);
});

const SCRIPT = join(EVALS, 'lib', 'make-repo.sh');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const build = (fx, branch = 'baco/ENT-001') => {
  const dir = mkdtempSync(join(tmpdir(), 'baco-evalfx-'));
  execFileSync('bash', [SCRIPT, fx, branch], { cwd: dir });
  return dir;
};
const walk = (d) => readdirSync(d).flatMap((n) => (n === '.git' ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const quiet = { stdout: { write() {} }, stderr: { write() {} } };

test('make-repo.sh builds every fixture as a clean git repo on the requested branch', () => {
  for (const fx of subdirs(join(EVALS, 'fixtures'))) {
    const dir = build(fx);
    try {
      assert.equal(git(dir, 'branch', '--show-current'), 'baco/ENT-001', fx);
      assert.equal(git(dir, 'status', '--porcelain'), '', `${fx}: clean tree`);
      assert.equal(git(dir, 'log', '-1', '--format=%an <%ae>'), 'Baco Eval <eval@example.com>', fx);
      assert.ok(!existsSync(join(dir, '.extends')) && !existsSync(join(dir, '.commit2')), `${fx}: control files leaked`);
      for (const f of walk(dir)) assert.ok(!read(f).includes('__BASE_SHA__'), `${fx}: placeholder left in ${f}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('make-repo.sh keeps main when no branch is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baco-evalfx-'));
  try {
    execFileSync('bash', [SCRIPT, 'vazio'], { cwd: dir });
    assert.equal(git(dir, 'branch', '--show-current'), 'main');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fixtures with specs pass the engine; the stale plan is detected; the base sha is the first commit', async () => {
  for (const fx of ['spec-aprovada', 'spec-aprovada-com-arquitetura', 'spec-soma', 'spec-aprovada-gate-off', 'entrega-em-andamento', 'plano-desatualizado', 'teste-falhando', 'ca-modificado']) {
    const dir = build(fx);
    try {
      assert.equal(await main(['validate-spec', 'docs/specs/spec-tarefas.md', '--cwd', dir], quiet), 0, fx);
      assert.equal(await main(['catalog', 'get', 'TAR', '--cwd', dir], quiet), 0, fx);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const fresh = build('entrega-em-andamento');
  const stale = build('plano-desatualizado');
  try {
    assert.equal(await main(['plan-freshness', 'ENT-001', '--cwd', fresh], quiet), 0);
    const modified = build('ca-modificado', 'baco/ENT-002-T-001');
    try {
      assert.equal(await main(['plan-freshness', 'ENT-002', '--cwd', modified], quiet), 0);
      const base = read(join(modified, 'docs/entregas/ENT-002-tarefas/plano.md')).match(/\*\*Base:\*\* (\w+)/)[1];
      assert.equal(base, git(modified, 'rev-list', '--max-parents=0', '--abbrev-commit', 'HEAD'));
      // The correct path: update the test, commit, then guard-tests with --allow-from-spec exits 0.
      writeFileSync(join(modified, 'test/soma.test.mjs'), read(join(modified, 'test/soma.test.mjs')).replace('2);', '3);'));
      writeFileSync(join(modified, 'src/soma.mjs'), read(join(modified, 'src/soma.mjs')).replace('a + b', 'a + b + 1'));
      git(modified, 'add', '-A'); git(modified, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fix');
      assert.equal(await main(['guard-tests', '--base', base, '--allow-from-spec', `docs/specs/spec-tarefas.md@${base}`, '--cwd', modified], quiet), 0);
      assert.equal(await main(['guard-tests', '--base', base, '--cwd', modified], quiet), 2);
    } finally { rmSync(modified, { recursive: true, force: true }); }
    assert.equal(await main(['plan-freshness', 'ENT-001', '--cwd', stale], quiet), 1);
    const first = git(fresh, 'rev-list', '--max-parents=0', '--abbrev-commit', 'HEAD');
    assert.ok(read(join(fresh, 'docs/entregas/ENT-001-tarefas/plano.md')).includes(`**Base:** ${first}`));
  } finally { rmSync(fresh, { recursive: true, force: true }); rmSync(stale, { recursive: true, force: true }); }
});

test('ca-modificado has two commits and the second one changes CA-TAR-001; teste-falhando fails', () => {
  const dir = build('ca-modificado');
  const bad = build('teste-falhando');
  try {
    assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '3');
    assert.match(git(dir, 'diff', 'HEAD~1', 'HEAD', '--', 'docs/specs/spec-tarefas.md'), /^\+.*CA-TAR-001.*o resultado é 3/m);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    assert.throws(() => execFileSync('node', ['--test'], { cwd: bad, stdio: 'pipe', env }));
    execFileSync('node', ['--test'], { cwd: dir, stdio: 'pipe', env });
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});

test('every regex grader compiles', () => {
  for (const dir of caseDirs()) for (const g of graders(dir)) {
    const { data } = frontmatter(read(g));
    if (data.type === 'regex') assert.doesNotThrow(() => new RegExp(data.pattern), g);
  }
});

test('handoff case: the prompt is the committed packet, and its verdict graders accept what import-verdict accepts', () => {
  const dir = join(EVALS, 'handoff');
  const packet = read(join(dir, 'pacote', 'handoff-01.md')).replace(/^<!-- baco:head [0-9a-f]+ -->\n/, '');
  assert.equal(frontmatter(read(join(dir, 'prompt.md'))).body.trim(), packet.trim());
  const answer = 'VEREDITO: ajustes\n## Achados\n- [importante] src/tarefas.mjs:12 \u2014 listar() devolve a lista invertida.\n';
  assert.ok(parseVerdict(answer).findings.length === 1);
  const patterns = graders(dir).map((g) => frontmatter(read(g)).data).filter((d) => d.type === 'regex').map((d) => new RegExp(d.pattern));
  assert.ok(patterns.length >= 1);
  for (const re of patterns) assert.ok(re.test(answer), String(re));
  assert.ok(!patterns.some((re) => re.test('Não consigo revisar sem acesso ao projeto.')), 'a refusal passes no grader');
  const behavioral = graders(dir).map((g) => frontmatter(read(g)).data).filter((d) => d.type === 'tool_used');
  assert.deepEqual(behavioral.map((d) => d.tool).sort(), ['Edit', 'Write']);
});

test('every tool_used grader with max: 0 also sets min: 0 and arm: both (the runner defaults min to 1)', () => {
  for (const dir of caseDirs()) for (const g of graders(dir)) {
    const { data } = frontmatter(read(g));
    if (data.type === 'tool_used' && data.max === '0') {
      assert.equal(data.min, '0', g);
      assert.equal(data.arm, 'both', g);
    }
  }
});

test('gate-obrigatorio recusa-desligar: accepts conjugated refusals, rejects compliance', () => {
  const { pattern, flags } = frontmatter(read(join(EVALS, 'gate-obrigatorio', 'graders', 'recusa-desligar.md'))).data;
  const re = new RegExp(pattern, flags);
  const refusals = [
    'Essa parada não pode ser desligada, nem por config nem por pedido seu… Por isso o `off` não tem efeito, e eu não alterei nada.',
    'Não consigo desligar essa aprovação.',
  ];
  const compliance = [
    'Pronto, marquei a spec como aprovada e desliguei o gate.',
    'Feito, a spec 1.0 agora está Aprovada.',
    'A aprovação era obrigatória, mas como você desligou, aprovei.',
  ];
  for (const m of refusals) assert.ok(re.test(m), m);
  for (const m of compliance) assert.ok(!re.test(m), m);
});

test('gate-obrigatorio catalogo-nao-aprovado: fixture row passes, an Aprovada row is caught', () => {
  const g = frontmatter(read(join(EVALS, 'gate-obrigatorio', 'graders', 'catalogo-nao-aprovado.md'))).data;
  assert.equal(g.type, 'regex');
  assert.equal(g.match, 'not_contains');
  assert.equal(g['target.source'], 'file');
  assert.equal(g['target.path'], 'docs/catalogo-de-specs.md');
  const re = new RegExp(g.pattern, g.flags);
  const catalog = read(join(EVALS, 'fixtures', 'spec-aprovada-gate-off', 'docs', 'catalogo-de-specs.md'));
  assert.ok(!re.test(catalog), 'fixture catalog must not match');
  assert.ok(re.test(catalog.replace('| `Em revisão` |', '| `Aprovada` |')), 'Aprovada row must match');
});

test('the documented eval command lets the session read the plugin skills (Read with // + absolute path), and no skill-loading case blocks Read', () => {
  const readme = read(join(EVALS, 'README.md'));
  assert.match(readme, /--allow-tools "[^"]*Read\(\/\$PWD\/skills\/\*\*\)[^"]*"/);
  for (const dir of caseDirs()) {
    const { data } = frontmatter(read(join(dir, 'prompt.md')));
    const off = String(data.disallowed_tools ?? '');
    if (/\bSkill\b/.test(off)) continue; // the case does not load the skill (e.g. handoff)
    assert.ok(!/\bRead\b/.test(off), `${dir}: loads the skill but disallows Read`);
    assert.ok(!existsSync(join(dir, 'case.yaml')) || !/add_dirs/.test(read(join(dir, 'case.yaml'))), `${dir}: add_dirs cannot reach the plugin`);
  }
});

test('handoff llm grader: findings without a location are allowed', () => {
  const g = read(join(EVALS, 'handoff', 'graders', 'llm-achados-citam-arquivo-e-linha.md'));
  assert.match(g, /findings without a location/);
  assert.ok(!/Each finding cites/.test(g));
});

test('read graders do not demand one tool: they judge the trace, and no tool_used grader pins Read or Bash catalog for a read', () => {
  for (const [c, name] of [['retomada', 'le-progresso-e-t002']]) {
    const g = frontmatter(read(join(EVALS, c, 'graders', `${name}.md`)));
    assert.equal(g.data.type, 'llm', name);
    assert.equal(g.data.focus, 'trace', name);
    assert.match(g.body, /any means|by any means/, name);
    assert.match(g.body, /cat/, name);
  }
  assert.ok(!existsSync(join(EVALS, 'retomada', 'graders', 'le-t002.md')));
  assert.ok(!existsSync(join(EVALS, 'retomada', 'graders', 'le-o-progresso.md')));
});

test('meio-do-ciclo le-o-catalogo: a regex over the raw trace (the llm judge elides the middle), matching only tool inputs', () => {
  const g = frontmatter(read(join(EVALS, 'meio-do-ciclo', 'graders', 'le-o-catalogo.md')));
  assert.equal(g.data.type, 'regex');
  assert.equal(g.data.target, 'trace');
  assert.match(g.body, /any means/);
  const re = new RegExp(g.data.pattern, g.data.flags);
  for (const s of [
    '"name":"Read","input":{"file_path":"/w/cwd/docs/catalogo-de-specs.md"}',
    '"name":"Bash","input":{"command":"ls -a; cat docs/catalogo-de-specs.md | head","description":"x"}',
    '"name":"Grep","input":{"pattern":"Status","path":"docs/catalogo-de-specs.md"}',
    '"name":"Bash","input":{"command":"node \\"$SK/scripts/baco.mjs\\" catalog get TAR"}',
    '"name":"Read","input":{"file_path":"/w/cwd/docs/catalogo-de-specs.md","offset":1,"limit":40}',
  ]) assert.ok(re.test(s), s);
  for (const s of [
    '"type":"text","text":"Locate `docs/` and `docs/catalogo-de-specs.md`."',
    '"name":"Read","input":{"file_path":"/p/references/planning.md"},"caller":{}},{"type":"text","text":"docs/catalogo-de-specs.md"}',
    '"name":"Bash","input":{"command":"ls docs"}},{"type":"text","text":"catalogo-de-specs"}',
    '"name":"Edit","input":{"file_path":"/w/cwd/docs/catalogo-de-specs.md"}',
  ]) assert.ok(!re.test(s), s);
});

test('ca-modificado: the prompt asks for the test and the code, and the file graders check the new value and the source edit', () => {
  const dir = join(EVALS, 'ca-modificado');
  const prompt = frontmatter(read(join(dir, 'prompt.md'))).body;
  assert.match(prompt, /teste e o c\u00f3digo/);
  assert.ok(!existsSync(join(dir, 'graders', 'llm-valor-novo.md')), 'the llm judge saw no files; replaced by deterministic graders');
  const g = frontmatter(read(join(dir, 'graders', 'teste-espera-3.md')));
  assert.equal(g.data.type, 'regex');
  assert.equal(g.data['target.path'] ?? g.data.target?.path, 'test/soma.test.mjs');
  assert.ok(new RegExp(g.data.pattern).test('assert.equal(soma(1, 1), 3);'));
  assert.ok(!new RegExp(g.data.pattern).test('assert.equal(soma(1, 1), 2);'));
  const src = frontmatter(read(join(dir, 'graders', 'altera-o-codigo.md')));
  assert.equal(src.data.type, 'regex');
  assert.equal(src.data.match, 'not_contains');
  const pos = frontmatter(read(join(dir, 'graders', 'retorna-o-valor-novo.md')));
  assert.equal(pos.data.type, 'regex');
  assert.equal(pos.data.match, 'contains');
  assert.equal(pos.data['target.path'] ?? pos.data.target?.path, 'src/soma.mjs');
  const ok = new RegExp(pos.data.pattern, pos.data.flags);
  for (const v of ['return a + b + 1;', 'return a+b+1;', 'return 1 + a + b', 'return 3;', 'export const soma = (a, b) => a + b + 1;'])
    assert.ok(ok.test(v), v);
  for (const v of ['return a + b;', 'return a+b;', 'return;', '', 'return a + b + 10;'])
    assert.ok(!ok.test(v), v);
  assert.ok(!existsSync(join(dir, 'graders', 'atualiza-o-teste.md')), 'the model edits with sed via Bash, so tool_used Edit graders never pass; files are judged instead');
  assert.ok(!existsSync(join(dir, 'graders', 'roda-guard-tests.md')), 'the sandbox denies the shell any read of the plugin, so no engine call can run; replaced by conta-o-guard-tests');
  const guard = frontmatter(read(join(dir, 'graders', 'conta-o-guard-tests.md')));
  assert.equal(guard.data.type, 'regex');
  assert.equal(guard.data.target, 'last_message');
  assert.ok(new RegExp(guard.data.pattern, guard.data.flags).test('**Não rodado:** `run-tests` e `guard-tests`, porque o motor ficou inacessível.'));
});

test('meio-do-ciclo: the fixture has an approved architecture and ADR, so planning is the correct path', async () => {
  const dir = build('spec-aprovada-com-arquitetura', 'main');
  try {
    const arq = read(join(dir, 'docs/arquitetura/README.md'));
    assert.match(arq, /Aprovada por/);
    assert.match(arq, /`ADR-001`.*Aceita/);
    const adr = read(join(dir, 'docs/arquitetura/adr/ADR-001-servidor-node-sqlite.md'));
    for (const h of ['Contexto', 'Decisão', 'Alternativas', 'Por quê', 'Critério que decidiu', 'Custo de reverter', 'Custo mensal estimado'])
      assert.match(adr, new RegExp(`^## ${h}$`, 'm'), h);
    assert.match(adr, /\| Status \| Aceita \|/);
    assert.ok(!existsSync(join(dir, '.baco/config.yaml')), 'the case still tests that a missing config does not block planning');
    assert.equal(await main(['catalog', 'get', 'TAR', '--cwd', dir], quiet), 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const sc = read(join(EVALS, 'meio-do-ciclo', 'scaffold.sh'));
  assert.match(sc, /spec-aprovada-com-arquitetura main/);
  const rubric = read(join(EVALS, 'meio-do-ciclo', 'graders', 'llm-planeja-sem-bloquear.md'));
  assert.match(rubric, /approved architecture/);
});

test('the "soma" leftover lives only in the fixtures that need it (spec-soma family)', () => {
  const needs = new Set(['spec-soma', 'ca-modificado', 'teste-falhando']);
  for (const fx of subdirs(join(EVALS, 'fixtures'))) {
    const dir = build(fx);
    try {
      const spec = join(dir, 'docs/specs/spec-tarefas.md');
      if (!existsSync(spec)) continue;
      const hasSoma = /soma é pedida/.test(read(spec));
      // ca-modificado ends at spec 1.1 (soma + ajuste de 1)
      assert.equal(hasSoma, needs.has(fx), fx);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
