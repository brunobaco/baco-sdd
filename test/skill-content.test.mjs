import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, relative, basename } from 'node:path';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../skills/baco-sdd/scripts/baco.mjs';
import { readCatalog, IMPLEMENTED_COL, VALIDATED_COL } from '../skills/baco-sdd/scripts/lib/catalog.mjs';
import { readSpec, validateSpec } from '../skills/baco-sdd/scripts/lib/spec.mjs';
import { readQa, appendEvidence } from '../skills/baco-sdd/scripts/lib/qa.mjs';
import { readPlanHeader } from '../skills/baco-sdd/scripts/lib/delivery.mjs';
import { parseYamlSubset, resolveConfig, DEFAULTS } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { fold } from '../skills/baco-sdd/scripts/lib/markdown.mjs';
import { diffSpecs } from '../skills/baco-sdd/scripts/commands/spec-diff.mjs';
import { SKILL_ROOT, SOURCE_NAME_RE, listFiles, frontmatter, mdLinks, bacoMentions, read } from './helpers/content.mjs';

const SKILLS_DIR = dirname(SKILL_ROOT);
const rel = (p) => relative(SKILL_ROOT, p);
const inScripts = (p) => rel(p).split('/')[0] === 'scripts';
const mdFiles = () => listFiles(SKILL_ROOT, '.md');
const lineCount = (s) => s.replace(/\n$/, '').split('\n').length;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf)$/i;

test('helpers: source-name regex', () => {
  for (const s of ['BACO-Spec', 'baco-spec', 'Baco Spec', 'baco_spec']) assert.ok(SOURCE_NAME_RE.test(s), s);
  assert.ok(!SOURCE_NAME_RE.test('baco spec-diff'));
});

test('helpers: frontmatter', () => {
  const md = '---\nname: x\ndescription: >-\n  first part\n  second part\nquoted: "a: b"\nmetadata:\n  version: "0.1.0"\n---\n# Body\n';
  const { data, body } = frontmatter(md);
  assert.equal(data.name, 'x');
  assert.equal(data.description, 'first part second part');
  assert.equal(data.quoted, 'a: b');
  assert.equal(data['metadata.version'], '0.1.0');
  assert.equal(body, '# Body\n');
});

test('helpers: mdLinks and bacoMentions', () => {
  const md = '[a](references/x.md) [b](https://e.com) [c](#anc) `baco trace --x` and baco spec-diff';
  assert.deepEqual(mdLinks(md), ['references/x.md']);
  assert.deepEqual(bacoMentions(md), ['trace', 'spec-diff']);
});

test('no source-method name under skills/', () => {
  const files = listFiles(SKILLS_DIR).filter((p) => !BINARY.test(p) && rel(p).split('/')[0] !== 'scripts');
  for (const f of files) assert.ok(!SOURCE_NAME_RE.test(read(f)), `source name found in ${relative(SKILLS_DIR, f)}`);
});

test('every baco command mentioned exists', () => {
  for (const f of mdFiles().filter((p) => rel(p) !== 'scripts/README.md')) {
    for (const cmd of bacoMentions(read(f))) assert.ok(COMMANDS.includes(cmd), `${rel(f)}: unknown command "baco ${cmd}"`);
  }
});

test('relative links resolve', () => {
  for (const f of mdFiles().filter((p) => !inScripts(p))) {
    for (const t of mdLinks(read(f))) {
      const target = t.split('#')[0];
      assert.ok(existsSync(join(dirname(f), target)), `${rel(f)}: broken link ${t}`);
    }
  }
});

test('size caps', () => {
  const skill = join(SKILL_ROOT, 'SKILL.md');
  if (existsSync(skill)) {
    const { data, body } = frontmatter(read(skill));
    assert.ok(lineCount(body) <= 200, `SKILL.md body ${lineCount(body)} lines > 200`);
    assert.ok((data.description ?? '').length <= 1024, 'description > 1024 chars');
  }
  for (const f of listFiles(join(SKILL_ROOT, 'references'), '.md')) {
    const n = lineCount(read(f));
    const isRole = rel(f).startsWith('references/roles/');
    const cap = isRole ? 120 : 300;
    assert.ok(n <= cap, `${rel(f)}: ${n} lines > ${cap}`);
  }
});

test('role file headers', () => {
  for (const f of listFiles(join(SKILL_ROOT, 'references', 'roles'), '.md')) {
    const lines = read(f).split('\n');
    const head = lines.slice(0, 8);
    assert.ok(lines[0].startsWith('# Role: '), `${rel(f)}: first line must start with "# Role: "`);
    for (const re of [/^- Phase: /, /^- Level: (leve|medio|forte|per-task)$/, /^- Effort: (baixo|medio|alto|per-task)$/, /^- Tools: /]) {
      assert.ok(head.some((l) => re.test(l)), `${rel(f)}: missing header ${re} in first 8 lines`);
    }
  }
});

test('16 roles present', () => {
  const expected = ['acceptance-validator', 'architect', 'ci-triage', 'cold-reader', 'devils-advocate', 'final-reviewer', 'implementer', 'locator', 'planner', 'pr-reviewer', 'publisher', 'reconciler', 'simplifier', 'spec-auditor', 'task-reviewer', 'writer'];
  const found = listFiles(join(SKILL_ROOT, 'references', 'roles'), '.md').map((f) => basename(f, '.md')).sort();
  assert.deepEqual(found, expected);
});

const TEMPLATES = join(SKILL_ROOT, 'templates', 'pt-BR');

test('catalog template parses', () => {
  const { headers } = readCatalog(read(join(TEMPLATES, 'catalogo-de-specs.md')));
  assert.ok(headers.length > 0, 'catalog table not found in template');
  assert.ok(headers.includes(IMPLEMENTED_COL), `missing column ${IMPLEMENTED_COL}`);
  assert.ok(headers.includes(VALIDATED_COL), `missing column ${VALIDATED_COL}`);
});

test('templates have no English stop-words', () => {
  const FOLDED = [/\bthe\b/, /\bshould\b/, /\bmust\b/];
  const RAW = [/\bTODO\b/, /\bTBD\b/];
  for (const f of listFiles(TEMPLATES, '.md').filter((p) => basename(p) !== 'prompt-revisor.md')) {
    const raw = read(f);
    const text = fold(raw);
    for (const re of FOLDED) assert.ok(!re.test(text), `${rel(f)}: English stop-word ${re}`);
    for (const re of RAW) assert.ok(!re.test(raw), `${rel(f)}: English stop-word ${re}`);
  }
});

test('project documentation templates exist', () => {
  for (const f of ['docs-README.md', 'visao-do-produto.md', 'planejamento-do-produto.md', 'catalogo-de-specs.md', 'governanca-README.md', 'anotacoes-futuras.md']) {
    assert.ok(existsSync(join(TEMPLATES, f)), `missing template ${f}`);
  }
});

test('catalog template carries the three state lists and an example row', () => {
  const md = read(join(TEMPLATES, 'catalogo-de-specs.md'));
  for (const v of ['Rascunho', 'Em descoberta', 'Em revisão', 'Aprovada', 'Substituída', 'não verificada', 'não iniciada', 'em implementação', 'implementada', 'pendente', 'parcialmente validada', 'validada', 'não conforme']) {
    assert.ok(md.includes(`- \`${v}\``), `state "${v}" missing`);
  }
  assert.equal(readCatalog(md).rows.length, 1);
});

test('spec templates validate', () => {
  for (const f of ['spec.md', 'spec-minima.md']) {
    const path = join(TEMPLATES, f);
    assert.ok(existsSync(path), `missing template ${f}`);
    const errors = validateSpec(path).filter((x) => x.level === 'error');
    assert.deepEqual(errors, [], `${f}: ${JSON.stringify(errors)}`);
    const spec = readSpec(path);
    assert.equal(spec.code, 'XYZ', `${f}: code`);
    assert.equal(spec.version, '0.1', `${f}: version`);
    assert.equal(spec.history.at(-1).version, '0.1', `${f}: history version`);
    const ids = spec.definitions.map((d) => d.id);
    for (const id of ['RF-XYZ-001', 'CA-XYZ-001']) assert.ok(ids.includes(id), `${f}: ${id} not defined`);
  }
});

test('spec templates carry the guidance rules in HTML comments', () => {
  for (const f of ['spec.md', 'spec-minima.md']) {
    const md = read(join(TEMPLATES, f));
    const comments = [...md.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => fold(m[1])).join(' ');
    for (const phrase of ['omita secoes sem conteudo', 'nunca invente versao, data, aprovador, fontes', 'preserve a convencao de ids do projeto']) {
      assert.ok(comments.includes(phrase), `${f}: guidance "${phrase}" missing from comments`);
    }
  }
});

test('spec and QA templates carry the next free numbers line', () => {
  for (const f of ['spec.md', 'spec-minima.md', 'cenarios-qa.md']) {
    const md = read(join(TEMPLATES, f));
    assert.ok(/^\| Próximos números livres \|/m.test(md), `${f}: "Próximos números livres" metadata row missing`);
  }
});

test('full spec template has a Título column in the acceptance table', () => {
  const md = read(join(TEMPLATES, 'spec.md'));
  assert.ok(md.includes('| ID | Título | Dado | Quando | Então |'), 'spec.md: Título column missing');
  const ca = readSpec(join(TEMPLATES, 'spec.md')).definitions.find((d) => d.id === 'CA-XYZ-001');
  assert.ok(ca, 'spec.md: CA-XYZ-001 not read with the Título column');
});

test('QA template carries the Situação do QA line', () => {
  const md = read(join(TEMPLATES, 'cenarios-qa.md'));
  assert.ok(/^\| Situação do QA \|/m.test(md), 'cenarios-qa.md: "Situação do QA" metadata row missing');
});

test('qa template parses', () => {
  const src = join(TEMPLATES, 'cenarios-qa.md');
  assert.ok(existsSync(src), 'missing template cenarios-qa.md');
  const qa = readQa(src);
  assert.equal(qa.scenarios.length, 2);
  const [one, two] = qa.scenarios;
  assert.equal(one.id, 'CT-XYZ-001');
  assert.equal(one.automation, 'automatizado');
  assert.equal(one.testRef, 'tests/<caminho>.test.ts');
  assert.equal(two.id, 'CT-XYZ-002');
  assert.equal(two.automation, 'manual');
  for (const s of qa.scenarios) assert.ok(s.contracts.includes('CA-XYZ-001'), `${s.id}: contracts ${JSON.stringify(s.contracts)}`);
  assert.equal(qa.evidence.length, 0);

  const md = appendEvidence(read(src), { ct: 'CT-XYZ-002', result: 'aprovado', date: '2026-10-28', where: 'staging', delivery: 'ENT-001' });
  const dir = mkdtempSync(join(tmpdir(), 'baco-qa-'));
  try {
    const copy = join(dir, 'qa.md');
    writeFileSync(copy, md);
    const again = readQa(copy);
    assert.equal(again.evidence.length, 1);
    assert.equal(again.evidence[0].ct, 'CT-XYZ-002');
    assert.equal(again.scenarios.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan template header parses', () => {
  const src = join(TEMPLATES, 'plano.md');
  assert.ok(existsSync(src), 'missing template plano.md');
  const header = readPlanHeader(read(src));
  assert.equal(header.specs.length, 1);
  assert.equal(header.specs[0].path, 'docs/specs/spec-<nome>.md');
  assert.equal(header.specs[0].version, '<versão>');
  assert.equal(header.baseRef, '<sha do commit>');
});

test('delivery templates carry their fields', () => {
  for (const f of ['arquitetura.md', 'adr.md', 'tarefa.md', 'progresso.md']) assert.ok(existsSync(join(TEMPLATES, f)), `missing template ${f}`);
  const plan = read(join(TEMPLATES, 'plano.md'));
  for (const h of ['Restrições globais', 'Foco de revisão', 'Entregas e tarefas', 'Faixas paralelas', 'Varredura de conflitos', 'Cobertura', 'Reconciliação']) {
    assert.ok(plan.includes(`## ${h}`), `plano.md: section "${h}" missing`);
  }
  const task = read(join(TEMPLATES, 'tarefa.md'));
  assert.ok(task.startsWith('# <TASK-ID> | <título>'));
  for (const f of ['Entrega', 'CAs', 'Resultado esperado', 'Critério de pronto', 'Interfaces', 'Classe', 'Nível/esforço', 'Testes da tarefa', 'baco/ENT-NNN-<TASK-ID>', 'Dependências']) {
    assert.ok(task.includes(f), `tarefa.md: "${f}" missing`);
  }
  assert.ok(read(join(TEMPLATES, 'progresso.md')).includes('## Decisões registradas'));
});

test('config template is valid', () => {
  const src = join(TEMPLATES, 'config.yaml');
  assert.ok(existsSync(src), 'missing template config.yaml');
  const resolved = resolveConfig(parseYamlSubset(read(src)));
  assert.deepEqual(resolved.warnings, []);
  assert.deepEqual(resolved.gates, DEFAULTS.gates);
  assert.deepEqual(resolved.manual_pending, DEFAULTS.manual_pending);
  assert.equal(resolved.tests.unit, 'npx vitest run --reporter=junit --outputFile=.baco/junit/unit.xml');
  assert.equal(resolved.tests.e2e_web, 'PLAYWRIGHT_JUNIT_OUTPUT_FILE=.baco/junit/e2e-web.xml npx playwright test --reporter=junit');
  assert.deepEqual(resolved.tracker, ['files']);
  assert.deepEqual(resolved.tests.patterns, DEFAULTS.tests.patterns);
  assert.equal(resolved.tests_quick.e2e_web, 'PLAYWRIGHT_JUNIT_OUTPUT_FILE=.baco/junit/e2e-web.xml npx playwright test --project=chromium --reporter=junit');
  assert.equal(resolved.tests.queue, undefined);
  assert.equal(resolved.app, null);
});

test('ci template mentions junit', () => {
  const src = join(TEMPLATES, 'ci-github-actions.yml');
  assert.ok(existsSync(src), 'missing template ci-github-actions.yml');
  const yml = read(src);
  assert.ok(yml.includes('.baco/junit'));
  assert.ok(yml.includes('upload-artifact'));
});

test('gates reference lists mandatory gates', () => {
  const src = join(SKILL_ROOT, 'references', 'gates.md');
  assert.ok(existsSync(src), 'missing references/gates.md');
  const md = read(src);
  for (const g of ['spec_approval', 'irreversible_action', 'merge_main']) assert.ok(md.includes(g), `gates.md: ${g} missing`);
  assert.ok(md.includes('never counts as approval'), 'gates.md: "never counts as approval" missing');
});

test('spec-model preserves convention rule', () => {
  const src = join(SKILL_ROOT, 'references', 'spec-model.md');
  assert.ok(existsSync(src), 'missing references/spec-model.md');
  const md = read(src);
  for (const p of ['existing ID convention', 'Never renumber']) assert.ok(md.includes(p), `spec-model.md: "${p}" missing`);
});

test('spec-change uses spec-diff', () => {
  const src = join(SKILL_ROOT, 'references', 'spec-change.md');
  assert.ok(existsSync(src), 'missing references/spec-change.md');
  const md = read(src);
  for (const p of ['baco spec-diff', 'baco plan-freshness']) assert.ok(md.includes(p), `spec-change.md: "${p}" missing`);
});

test('architecture reference covers proof and mobile', () => {
  const src = join(SKILL_ROOT, 'references', 'architecture.md');
  assert.ok(existsSync(src), 'missing references/architecture.md');
  const md = read(src);
  for (const p of ['ENT-001', 'devils-advocate', 'JUnit', 'Maestro']) assert.ok(md.includes(p), `architecture.md: "${p}" missing`);
});

test('planning covers delivery and engine', () => {
  const src = join(SKILL_ROOT, 'references', 'planning.md');
  assert.ok(existsSync(src), 'missing references/planning.md');
  const md = read(src);
  for (const p of ['1 delivery = 1 plan = 1 PR', 'plano.md', 'baco spec-diff', 'baco plan-freshness', 'git rev-parse']) assert.ok(md.includes(p), `planning.md: "${p}" missing`);
});

test('publication covers adapters', () => {
  const src = join(SKILL_ROOT, 'references', 'task-publication.md');
  assert.ok(existsSync(src), 'missing references/task-publication.md');
  const md = read(src);
  for (const p of ['gh issue create', 'source of truth']) assert.ok(md.includes(p), `task-publication.md: "${p}" missing`);
});

test('phase 6-9 references use the engine', () => {
  const mentions = new Set();
  for (const f of ['implementation.md', 'review.md', 'delivery.md', 'reconciliation.md']) {
    const src = join(SKILL_ROOT, 'references', f);
    assert.ok(existsSync(src), `missing references/${f}`);
    for (const cmd of bacoMentions(read(src))) mentions.add(cmd);
  }
  for (const c of ['check-branch', 'guard-tests', 'cost', 'trace', 'build-handoff', 'import-verdict', 'acceptance-report', 'qa-evidence', 'cleanup-branches', 'catalog']) {
    assert.ok(mentions.has(c), `phase 6-9 references: "baco ${c}" missing`);
  }
});

test('implementation uses branch convention', () => {
  const src = join(SKILL_ROOT, 'references', 'implementation.md');
  assert.ok(existsSync(src), 'missing references/implementation.md');
  assert.ok(read(src).includes('baco/ENT-NNN-<TASK-ID>'), 'implementation.md: task branch convention missing');
});

const REFERENCES = ['common-process', 'gates', 'configure', 'project-bootstrap', 'spec-model', 'spec-change', 'review-protocol', 'architecture', 'planning', 'task-publication', 'implementation', 'review', 'delivery', 'reconciliation'];
const skillMd = () => {
  const src = join(SKILL_ROOT, 'SKILL.md');
  assert.ok(existsSync(src), 'missing SKILL.md');
  return frontmatter(read(src));
};

test('SKILL.md frontmatter', () => {
  const { data } = skillMd();
  const plugin = JSON.parse(read(join(SKILL_ROOT, '..', '..', '.claude-plugin', 'plugin.json')));
  assert.equal(data.name, 'baco-sdd');
  assert.equal(data['metadata.version'], plugin.version, 'metadata.version differs from plugin.json');
  for (const p of ['criar spec', 'planejar implementação', 'relatório de aceite', '.baco/', 'CA mudou', 'atualizar teste do CA', 'continuar entrega', 'executar ENT-', 'aprovar spec', 'gate']) assert.ok((data.description ?? '').includes(p), `description: "${p}" missing`);
});

test('SKILL.md routes every phase', () => {
  const links = new Set(mdLinks(skillMd().body).map((t) => t.split('#')[0]));
  for (const r of REFERENCES) assert.ok(links.has(`references/${r}.md`), `SKILL.md: no link to references/${r}.md`);
});

test('SKILL.md has startup fallback', () => {
  const { body } = skillMd();
  for (const p of ['.baco/config.yaml', 'defaults', 'offer phase 0 once, without blocking', 'without blocking the requested phase']) assert.ok(body.includes(p), `SKILL.md: "${p}" missing`);
});

test('every baco flag mentioned exists in the command usage', async () => {
  const usages = {};
  for (const cmd of COMMANDS) usages[cmd] = (await import(`../skills/baco-sdd/scripts/commands/${cmd}.mjs`)).usage;
  for (const f of mdFiles().filter((p) => !inScripts(p))) {
    for (const [, cmd, rest] of read(f).matchAll(/\bbaco ([a-z][a-z-]+)([^`\n]*)/g)) {
      if (!usages[cmd]) continue;
      for (const [flag] of rest.matchAll(/--[a-z][a-z-]*/g)) assert.ok(usages[cmd].includes(`${flag} `) || usages[cmd].includes(`${flag}]`) || usages[cmd].includes(`${flag})`) || usages[cmd].includes(`${flag}=`), `${rel(f)}: "baco ${cmd}" has no flag ${flag}`);
    }
  }
});

test('no orphan references', () => {
  const sources = [join(SKILL_ROOT, 'SKILL.md'), ...listFiles(join(SKILL_ROOT, 'references'), '.md')].filter((p) => existsSync(p));
  const targets = (s) => mdLinks(read(s)).map((t) => join(dirname(s), t.split('#')[0]));
  for (const f of listFiles(join(SKILL_ROOT, 'references'), '.md')) {
    assert.ok(sources.some((s) => s !== f && targets(s).includes(f)), `orphan reference: ${rel(f)}`);
  }
});

// Plan 2.1: ideas from the video.
const ref = (name) => read(join(SKILL_ROOT, 'references', name));
const ENTRY_LABELS = ['O quê', 'Para quem', 'Por quê', 'Fica de fora', 'Como saber se deu certo'];
const ID_RE = /\b(?:RF|RN|RNF|INV|CA|CT|P)-(?:[A-Z]{2,6}-)?\d{3}\b/;
const entryBlock = (md) => {
  const start = md.indexOf('## Porta de entrada');
  if (start < 0) return null;
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end < 0 ? undefined : end);
};

test('spec templates open with the entry block', () => {
  for (const f of ['spec.md', 'spec-minima.md']) {
    const md = read(join(TEMPLATES, f));
    const block = entryBlock(md);
    assert.ok(block, `${f}: "## Porta de entrada" missing`);
    assert.ok(md.indexOf('## Porta de entrada') < md.indexOf('## 1.') || !md.includes('## 1.'), `${f}: block must come before section 1`);
    let at = -1;
    for (const label of ENTRY_LABELS) {
      const i = block.indexOf(`- **${label}:**`);
      assert.ok(i > at, `${f}: bullet "${label}" missing or out of order`);
      at = i;
    }
    const bullets = block.split('\n').filter((l) => /^- \*\*/.test(l));
    assert.equal(bullets.length, 5, `${f}: block must have exactly 5 bullets`);
    const visible = block.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!ID_RE.test(visible), `${f}: block must not contain requirement IDs`);
    assert.ok(fold(block).includes('a definir'), `${f}: metric placeholder must offer "a definir"`);
    assert.ok(fold(block).includes('este bloco nao cria requisito'), `${f}: rule comment missing`);
  }
});

test('spec-model defines the entry block and the longevity test', () => {
  const md = ref('spec-model.md');
  for (const p of ['## Entry block', 'never creates a requirement', '`a definir`', 'Longevity test']) assert.ok(md.includes(p), `spec-model.md: "${p}" missing`);
  assert.ok(ref('common-process.md').includes('entry block'), 'common-process.md: neighbour rule missing');
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('adding the entry block to an existing spec changes no contract ID', () => {
  const base = read(join(FIXTURES, 'spec-exemplo.md'));
  const block = [
    '## Porta de entrada', '',
    '- **O quê:** criar e administrar empresas.',
    '- **Para quem:** pessoa autenticada que abre uma empresa.',
    '- **Por quê:** cada cliente precisa de dados isolados.',
    '- **Fica de fora:** cobrança e convites.',
    '- **Como saber se deu certo:** a definir.', '',
  ].join('\n');
  const head = base
    .replace('## 1. Controle documental', `${block}\n## 1. Controle documental`)
    .replace('| Versão | `1.2` |', '| Versão | `1.3` |')
    .replace('| 1.2 | Ana Souza | 2026-10-20 | Aprovação |', '| 1.2 | Ana Souza | 2026-10-20 | Aprovação |\n| 1.3 | Teste | 2026-10-28 | Porta de entrada adicionada, sem mudança de contrato. |');
  assert.ok(head.includes('| 1.3 | Teste'), 'history row not added');
  const d = diffSpecs(base, head);
  assert.deepEqual([d.added, d.modified, d.removed], [[], [], []]);
  const dir = mkdtempSync(join(tmpdir(), 'baco-block-'));
  try {
    const tmp = join(dir, 'spec.md');
    writeFileSync(tmp, head);
    assert.deepEqual(validateSpec(tmp).filter((x) => x.level === 'error'), []);
    assert.equal(readSpec(tmp).version, '1.3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spec-change covers the entry block on existing specs', () => {
  const md = ref('spec-change.md');
  for (const p of ['## 5. Add the entry block to an existing spec', 'Porta de entrada adicionada, sem mudança de contrato.', 'additive only', 'only when the user asks', 'batch', 'baco spec-diff', 'baco plan-freshness', 'spec_approval', '`a definir`']) {
    assert.ok(md.includes(p), `spec-change.md: "${p}" missing`);
  }
  assert.ok(fold(read(join(SKILL_ROOT, 'SKILL.md'))).includes('porta de entrada'), 'SKILL.md: mode hint missing');
});

test('plan template carries the delivery level and still parses', () => {
  const md = read(join(TEMPLATES, 'plano.md'));
  assert.ok(md.includes('**Nível:** <leve, normal ou completo>'), 'plano.md: level line missing');
  assert.ok(md.indexOf('**Nível:**') > md.indexOf('**Entrega:**'), 'plano.md: level goes after Entrega');
  const header = readPlanHeader(md);
  assert.equal(header.specs.length, 1);
  assert.equal(header.baseRef, '<sha do commit>');
});

test('planning defines the three delivery levels', () => {
  const md = ref('planning.md');
  for (const p of ['## 1A. Delivery level', '`leve`', '`normal`', '`completo`', 'any one signal', 'all of', 'take the higher level', 'never-off gates']) {
    assert.ok(md.includes(p), `planning.md: "${p}" missing`);
  }
  assert.ok(ref('roles/planner.md').includes('Nível'), 'planner.md: level missing');
  assert.ok(read(join(SKILL_ROOT, 'SKILL.md')).includes('Delivery level'), 'SKILL.md: core rule missing');
});

test('risky deliveries carry rollback and alarm, echoed in the acceptance', () => {
  const plan = read(join(TEMPLATES, 'plano.md'));
  for (const p of ['## Se der errado', '- **Como voltar atrás:**', '- **Como vamos saber que quebrou:**']) assert.ok(plan.includes(p), `plano.md: "${p}" missing`);
  assert.ok(plan.indexOf('## Se der errado') < plan.indexOf('## Reconciliação'), 'plano.md: section goes before Reconciliação');
  const planning = ref('planning.md');
  for (const p of ['Se der errado', '`completo`', '`arriscada`']) assert.ok(planning.includes(p), `planning.md: "${p}" missing`);
  for (const f of ['delivery.md', 'roles/writer.md']) assert.ok(ref(f).includes('Se der errado'), `${f}: echo missing`);
});

test('architecture weighs the factors before proposing', () => {
  const md = ref('architecture.md');
  for (const p of ['`Peso`', '`alto`', '`médio`', '`baixo`', 'confirm the weights', 'pode seguir']) assert.ok(md.includes(p), `architecture.md: "${p}" missing`);
  assert.ok(md.indexOf('confirm the weights') < md.indexOf('## Mode Suggest'), 'weights must be confirmed in step 1, before Suggest');
});

test('ADR template records the decisive criterion and consequences', () => {
  const md = read(join(TEMPLATES, 'adr.md'));
  const order = ['## Por quê', '## Critério que decidiu', '## Custo de reverter', '## Custo mensal estimado'];
  assert.ok(!md.includes('## Consequências'), 'adr.md: Consequências was removed (overlaps Custo de reverter)');
  assert.ok(md.includes('o que fica mais difícil depois'), 'adr.md: Custo de reverter must cover what gets harder');
  let at = -1;
  for (const h of order) { const i = md.indexOf(h); assert.ok(i > at, `adr.md: "${h}" missing or out of order`); at = i; }
});

test('devils-advocate checks straw-man options and keep-as-is', () => {
  const md = ref('roles/devils-advocate.md');
  for (const p of ['straw-man', 'keep as is']) assert.ok(md.includes(p), `devils-advocate.md: "${p}" missing`);
});

test('technical-only changes have their own path', () => {
  const md = ref('architecture.md');
  const i = md.indexOf('## Technical change without behavior change');
  assert.ok(i > 0, 'architecture.md: section missing');
  const sec = md.slice(i, md.indexOf('\n## ', i + 1));
  for (const p of ['keep as is', 'no spec changes', 'baco trace', 'baco acceptance-report', 'nothing implemented', 'no delivery', '`normal`', '`completo`']) {
    assert.ok(sec.includes(p), `technical change: "${p}" missing`);
  }
  assert.ok(ref('reconciliation.md').includes('technical-only'), 'reconciliation.md: rule missing');
  assert.ok(fold(read(join(SKILL_ROOT, 'SKILL.md'))).includes('mudanca so tecnica'), 'SKILL.md: mode hint missing');
});

test('transcripts are sources, never loaded whole', () => {
  assert.ok(ref('project-bootstrap.md').includes('fontes/'), 'project-bootstrap.md: fontes/ missing');
  assert.ok(read(join(TEMPLATES, 'docs-README.md')).includes('`fontes/`'), 'docs-README.md: fontes/ missing');
  const md = ref('common-process.md');
  for (const p of ['transcript', 'never a contract', 'never load a whole transcript', 'cite']) assert.ok(md.includes(p), `common-process.md: "${p}" missing`);
});

test('final review: technical-only path keys on real catalog data and manual evidence', () => {
  const md = ref('architecture.md');
  const i = md.indexOf('## Technical change without behavior change');
  const sec = md.slice(i, md.indexOf('\n## ', i + 1));
  assert.ok(!sec.includes('não implementada'), 'uses a catalog state that does not exist');
  for (const p of ['`Versão implementada`', '`implementada`', 'baco qa-evidence', 'block']) assert.ok(sec.includes(p), `technical change: "${p}" missing`);
});

test('final review: entry block keeps the QA version in step', () => {
  const md = ref('spec-change.md');
  const sec = md.slice(md.indexOf('## 5. Add the entry block'));
  for (const p of ['`Versão da spec`', '`Situação do QA`']) assert.ok(sec.includes(p), `spec-change.md §5: "${p}" missing`);
});

test('plan 2.1 pending: entry block rules complete', () => {
  const change = ref('spec-change.md');
  for (const p of ['cited by a plan not yet delivered', 'same version', 'sem porta de entrada, por escolha', 'never offer it again']) assert.ok(change.includes(p), `spec-change.md: "${p}" missing`);
  assert.ok(/review the entry block/i.test(change.slice(0, change.indexOf('## 2.'))), 'spec-change.md §1: entry-block review step missing');
  assert.ok(ref('roles/spec-auditor.md').includes('Porta de entrada'), 'spec-auditor.md: block check missing');
  assert.ok(ref('spec-model.md').includes('never looks like a requirement'), 'spec-model.md: no-IDs reason');
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  assert.ok(skill.includes('offer section 5 of spec-change.md'), 'SKILL.md: hint must offer, not route');
  const plan = read(join(TEMPLATES, 'plano.md'));
  for (const p of ['uma spec só', 'nenhuma tarefa arriscada', 'migração que apaga dados']) assert.ok(plan.includes(p), `plano.md comment: "${p}" missing`);
  const arch = ref('architecture.md');
  for (const p of ['replaces factor questions the documents already answer', 'In Validate too']) assert.ok(arch.includes(p), `architecture.md: "${p}" missing`);
});

test('core names the Claude Code agents conditionally', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['In Claude Code with the `baco` plugin', '`baco:<role>`', '`baco:implementer-<class>`', 'pass both the model and the effort in every call', '(references/ambientes.md)']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
  assert.ok(!skill.includes('the effort stays the agent'), 'SKILL.md: Claude Code takes the effort per call');
  const impl = ref('implementation.md');
  for (const p of ['baco:implementer-', 'models.<class>']) assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
});

test('simplification: no extra ceremony from the video ideas', () => {
  const planning = ref('planning.md');
  assert.ok(!planning.includes('Concorda?'), 'planning.md: level must not be a separate question');
  assert.ok(planning.includes('no separate question'), 'planning.md: level approved with the plan');
  for (const f of ['architecture.md', 'roles/architect.md']) assert.ok(!ref(f).includes('Consequências'), `${f}: Consequências removed`);
  const sec = ref('spec-change.md').slice(ref('spec-change.md').indexOf('## 5.'));
  assert.ok(!sec.includes('Vira uma nova versão da spec, que você aprova.'), 'spec-change §5: touch case must not create a version');
});

test('core reports only engine commands actually run', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['Report only engine commands you actually ran', 'não rodado']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
});

test('communication pattern ties the engine report to commands actually executed', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  const pattern = skill.slice(skill.indexOf('### Communication pattern'), skill.indexOf('## Startup checks'));
  for (const p of ['**Motor:**', 'one row per `baco` command you executed', '**Não rodado:**', 'never from the phase checklist', 'never group']) {
    assert.ok(pattern.includes(p), `Communication pattern: "${p}" missing`);
  }
});

test('ambientes.md: level table matches every role header, translations and warnings present', () => {
  const amb = ref('ambientes.md');
  const level = { opus: 'forte', sonnet: 'medio', haiku: 'leve' };
  const effort = { high: 'alto', medium: 'medio', low: 'baixo' };
  const rows = Object.fromEntries([...amb.matchAll(/^\| ([a-z-]+) \| ([^|]+) \| ([^|]+) \|$/gm)].map(([, r, l, e]) => [r, [l.trim(), e.trim()]]));
  for (const f of listFiles(join(SKILL_ROOT, 'references', 'roles'), '.md')) {
    const name = basename(f, '.md');
    const head = read(f).split('\n').slice(0, 8);
    const lvl = head.map((l) => /^- Level: (\S+)$/.exec(l)).find(Boolean)?.[1];
    const eff = head.map((l) => /^- Effort: (\S+)$/.exec(l)).find(Boolean)?.[1];
    if (lvl === 'per-task') continue;
    assert.deepEqual(rows[name], [lvl, eff], `ambientes.md: row for ${name}`);
  }
  for (const p of ['`opus`', '`sonnet`', '`haiku`', 'Pass both the model and the effort in every call', '`model_reasoning_effort`', 'agents.default_subagent_model', '~/.codex/config.toml', '.codex/agents/*.toml', 'baco cost add', 'never goes into versioned files', 'not independent', 'fresh session']) {
    assert.ok(amb.includes(p), `ambientes.md: "${p}" missing`);
  }
});

test('SKILL.md: startup ignore check, plain-words communication, autonomy, waiver and edit-tool rules', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['`.worktrees/`', '`.baco/local.env`', '`.gitignore`', '.git/info/exclude', 'Never ask a non-developer to run a technical command', 'a guard doing its job', 'from the clock (`date`)', 'Autonomous from phase 6', '`baco waive-review`', 'internal independent review is never waived', 'never by shell redirection', 'project scripts that carry their own guard']) {
    assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
  }
  assert.ok(/\| 2 \|[^\n]*simplifier/.test(skill) && /\| 7 \|[^\n]*simplifier/.test(skill), 'SKILL.md: simplifier in phases 2 and 7');
});

test('phases 6 and 7: autonomous run, resume, tests per task, review modes and waiver', () => {
  const impl = ref('implementation.md');
  for (const p of ['## 1A. Before the run', 'waits for the human check before it is merged', 'decidido pelo agente, conferir no fim', '`## Pendências`', 'baco run-tests --layer <layer> --quick --', '--ca <the task\'s CAs>', 'baco run-tests --smoke', 'baco run-tests --all --quick', '## 10. Long runs', 'parado por cota', '## 11. End-of-run summary', 'never by shell redirection']) {
    assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
  }
  assert.ok(!impl.includes('is never started automatically'), 'implementation.md: a human stop must not block the whole run');
  const gates = ref('gates.md');
  assert.ok(gates.includes('waits for the human check before it is merged') && gates.includes('without a recorded waiver'), 'gates.md: non-blocking stop and waiver');
  const review = ref('review.md');
  for (const p of ['baco run-tests --all', 'simplifier', '--mode <pacote|repositorio>', 'baco waive-review ENT-NNN --by', 'never waived', 'without a recorded waiver']) assert.ok(review.includes(p), `review.md: "${p}" missing`);
  assert.ok(!review.includes('does include them'), 'review.md: the packet no longer carries the reports');
  const prog = read(join(TEMPLATES, 'progresso.md'));
  for (const p of ['## Retomada', '**Situação:**', '**Próximo passo:**', '## Esperando a pessoa']) assert.ok(prog.includes(p), `progresso.md: "${p}" missing`);
  assert.ok(prog.indexOf('## Retomada') < prog.indexOf('## Pendências'), 'progresso.md: Retomada comes first');
  assert.ok(ref('roles/task-reviewer.md').includes('baco run-tests'), 'task-reviewer runs the task tests');
});

test('resume without a BACO routine: no file of the plugin or the skill mentions the resume routine', () => {
  const root = join(SKILL_ROOT, '..', '..');
  const files = [...listFiles(SKILL_ROOT, '.md'), ...listFiles(join(root, 'commands'), '.md'), ...listFiles(join(root, 'agents'), '.md'), join(root, 'README.md')];
  for (const f of files) {
    const s = read(f);
    for (const bad of ['rotinas/baco-retomar', 'Tentativas da rotina', 'Rotina criada em', 'Rotina da Ratoeira', '[avisar]']) assert.ok(!s.includes(bad), `${f}: "${bad}" must be gone`);
  }
  const impl = ref('implementation.md');
  for (const p of ['parado por cota', 'Dono da execução', 'more than 6 hours', 'One conductor at a time', '"continuar" after the window renews', 'another account or another agent']) assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
});

test('Retomada carries the addresses of the tasks in progress, and git wins', () => {
  const prog = read(join(TEMPLATES, 'progresso.md'));
  assert.ok(prog.includes('### Tarefas em andamento'), 'progresso.md: table heading');
  assert.ok(prog.includes('| Tarefa | Ramo | Pasta de trabalho | Relatório | Último commit | Etapa e rodada |'), 'progresso.md: table columns');
  assert.ok(prog.indexOf('### Tarefas em andamento') < prog.indexOf('## Registro das tarefas'), 'progresso.md: table inside Retomada');
  const impl = ref('implementation.md');
  for (const p of ['`Tarefas em andamento`', 'git wins and you correct the table', 'add the task\'s row to `Tarefas em andamento`']) assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
});

test('lean reading: by section, diff stat first, one file per command; what proves is read in full; test logs ignored', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['Read lean, never lose content', '`git diff --stat`', 'Never read several files in one command', 'whatever proves something is read in full', 'the text of a criterion, the test that proves it, and the output of a test that failed', '`.baco/logs/`']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
  assert.ok(ref('configure.md').includes('Add `.baco/junit/`, `.baco/logs/` and `.baco/local.env` to `.gitignore`'), 'configure.md: logs folder ignored');
  assert.ok(ref('implementation.md').includes('If `.baco/junit/` or `.baco/logs/` is not in `.gitignore`'), 'implementation.md: logs folder ignored');
  assert.ok(ref('roles/implementer.md').includes('read its output in that log in full'), 'implementer reads a failing output in full');
});

test('briefs pass paths and IDs instead of copied text; the diff still goes as a diff', () => {
  assert.ok(read(join(SKILL_ROOT, 'SKILL.md')).includes('pass it by path and ID'), 'SKILL.md: brief by path and ID');
  assert.ok(ref('implementation.md').includes('Its brief gives paths and IDs, never copied text'), 'implementation.md: implementer brief');
  assert.ok(!ref('implementation.md').includes('the approved spec text of its CAs; the QA scenarios'), 'implementation.md: no copied spec text');
  assert.ok(ref('review.md').includes('the brief gives paths and IDs, never copied text') && ref('review.md').includes('handed over as a diff'), 'review.md: final-reviewer brief');
  for (const f of listFiles(join(SKILL_ROOT, 'references', 'roles'), '.md')) {
    if (basename(f) === 'cold-reader.md') continue;
    assert.ok(read(f).includes('- How inputs arrive: the conductor names files by path and items by ID'), `${basename(f)}: inputs by path and ID`);
  }
});

test('review roles write only their own report and return verdict, counts and path; the conductor checks git status', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  assert.ok(!skill.includes('a read-only role cannot write'), 'SKILL.md: old inline-detail rule gone');
  for (const p of ['writes only its own report, at the one path you name in the brief', 'the count of findings per severity and the path', 'in every folder the role worked in: before dispatching it, note the output', 'becomes a finding against that review', '`.baco/logs/revisoes/`']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
  for (const r of ['cold-reader', 'spec-auditor', 'simplifier', 'devils-advocate', 'task-reviewer', 'final-reviewer', 'acceptance-validator', 'ci-triage', 'pr-reviewer']) {
    const s = ref(`roles/${r}.md`);
    assert.ok(/^- Tools: report$/m.test(s), `${r}: Tools: report`);
    assert.ok(s.includes('Do not create, edit or delete any file except your report') || s.includes('Do not create, edit or delete any file except your report,'), `${r}: write limited to the report`);
    assert.ok(s.includes('Write the report to the path the conductor named') && s.includes('the report path'), `${r}: returns the path`);
  }
  const impl = ref('implementation.md');
  assert.ok(impl.includes('revisao/<TASK-ID>-revisao-NN.md') && impl.includes('Then run `git status` in the task\'s folder'), 'implementation.md: task review report and check');
  assert.ok(ref('roles/implementer.md').includes('the path of the review report'), 'implementer reads the findings in the report');
  assert.ok(ref('review.md').includes('revisao/revisao-final-NN.md'), 'review.md: final review report path');
});

test('conversation size: threshold, asking, auto switch in construction, title sequence, short request', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['## Conversation size', '`context.handoff_at`', 'default 400000', 'again every further 100000 tokens', 'Never stop a step halfway', 'ask whether to continue in a new conversation', '`context.auto_handoff` is true', '"Spec XYZ Desenvolvimento 02", then "03"', 'Outside the Ratoeira you cannot open or name a conversation', 'by search, never whole', 'Human stops', 'even below the threshold']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
  const impl = ref('implementation.md');
  for (const p of ['**Conversation size.**', '`context.auto_handoff` on, in the Ratoeira.** Do not ask and do not dispatch a new task', '`context.auto_handoff` on, outside the Ratoeira.**', 'keep going with the run in this conversation, dispatching tasks as usual', '`context.auto_handoff` off or missing.** Finish the task you are running', 'Keep going with the run while you wait', '`parado para conversa nova`', '`Trocas de conversa`', 'Conversa anterior: <identificador>', 'Never stop a run only to wait for a person to paste it', 'switches to a new conversation']) assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
  // The hook only points to the rule; it never prescribes stopping by itself.
  const hook = read(join(SKILL_ROOT, '..', '..', 'hooks', 'context-size.mjs'));
  assert.ok(hook.includes('Conversation size') && !/and stop\b/.test(hook), 'hook note points to the rule, without "stop"');
  const conf = ref('configure.md');
  for (const p of ['**8. Conversation size**', 'a partir de 400 mil tokens de contexto, sugiro continuar numa conversa nova', 'posso trocar para uma conversa nova sem te perguntar']) assert.ok(conf.includes(p), `configure.md: "${p}" missing`);
  const prog = read(join(TEMPLATES, 'progresso.md'));
  for (const p of ['**Trocas de conversa:**', 'parado para conversa nova']) assert.ok(prog.includes(p), `progresso.md: "${p}" missing`);
});

test('roles run as subagents whenever the host has them; inline only without subagents', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  assert.ok(!skill.includes('Run a role inline by default'), 'SKILL.md: inline is no longer the default');
  for (const p of ['When the host offers subagents, every role runs as a subagent, always', 'never run inline in your session', 'only when the host has no subagents, run a role inline']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
});

test('review fixes: resume guards, execution rules, waiver entry, tests-settings scope', () => {
  const impl = ref('implementation.md');
  for (const p of ['Dono da execução', 'more than 6 hours', 'One conductor at a time']) assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
  assert.ok(!impl.includes('mais de 3 horas') && !impl.includes('more than 3 hours'), 'implementation.md: the stale threshold is 6 hours');
  assert.ok(impl.includes('`tests_quick` or `app.smoke`, `.baco/local.env`'), 'implementation.md: never-edit list');
  const prog = read(join(TEMPLATES, 'progresso.md'));
  for (const p of ['**Dono da execução:**', 'mais de 6 horas']) assert.ok(prog.includes(p), `progresso.md: "${p}" missing`);
  const conf = ref('configure.md');
  for (const p of ['git worktree add', 'git worktree list', '`permissions.ask`','git checkout <m>*', 'git push *:<i>*', 'Bash(node *baco.mjs waive-review*)', 'Bash(node *baco.mjs import-verdict*)', 'Bash(node *baco.mjs import-pr-verdict ENT-*)', 'Bash(opencode run*)', 'Bash(codex exec *--dangerously-bypass-approvals-and-sandbox*)', 'Bash(codex exec *sandbox_*)', 'Bash(codex exec *workspace-write*)', 'Bash(gh pr merge*)', 'Bash(gh pr create --draft --base * --head baco/*)', 'Bash(codex exec * -s read-only *)', 'deny, then ask, then allow', '<projeto>-revisao-ENT-NNN-rNN', 'a cópia para o revisor, ao lado do projeto', 'onde fica o que já foi aprovado']) assert.ok(conf.includes(p), `configure.md: "${p}" missing`);
  assert.ok(conf.includes('\n\n### Machine settings: `.baco/local.env`'), 'configure.md: heading on its own line');
  const waiver = 'a current waiver recorded by the human (`baco waive-review`)';
  assert.ok(read(join(SKILL_ROOT, 'SKILL.md')).includes(waiver), 'SKILL.md: row 8 accepts the waiver');
  assert.ok(ref('delivery.md').includes('a current waiver recorded by the human exists (`baco waive-review`'), 'delivery.md: entry accepts the waiver');
  assert.ok(ref('delivery.md').includes('`baco run-tests --all`'), 'delivery.md: local mode uses run-tests');
  assert.ok(ref('gates.md').includes('`tests_quick` section or `app.smoke`'), 'gates.md: CONFIG_TESTS_CHANGED scope');
  assert.ok(ref('roles/implementer.md').includes('`.baco/local.env`'), 'implementer never edits local.env');
  const rev = read(join(TEMPLATES, 'prompt-revisor-repositorio.md'));
  assert.ok(!rev.includes('ver o histórico') && rev.includes('mudancas.diff') && rev.includes('npm ci'), 'repo reviewer prompt: no history, installs inside the copy');
});

test('0.1.1 instruction fixes are present in the skill text', () => {
  const ref = (n) => read(join(SKILL_ROOT, 'references', n));
  const conf = ref('configure.md');
  for (const p of ['### When a write is blocked', '### Records outside the delivery folder', '`provenance.ignore`', 'Never try to get around the block yourself', 'another AI of the Ratoeira']) assert.ok(conf.includes(p), `configure.md: "${p}" missing`);
  const impl = ref('implementation.md');
  for (const p of ['When a write is blocked', 'one at a time', 'test queue', 'publicar-ratoeira', '`provenance.ignore`']) assert.ok(impl.includes(p), `implementation.md: "${p}" missing`);
  assert.ok(ref('spec-change.md').includes('re-read the WHOLE spec'), 'spec-change.md: whole-spec reread');
  assert.ok(ref('reconciliation.md').includes('validada sem revisão externa') && ref('reconciliation.md').includes('merge commit of the delivery on the integration branch'), 'reconciliation.md: waiver state and tag sha');
  assert.ok(read(join(SKILL_ROOT, 'references', 'roles', 'reconciler.md')).includes('validada sem revisão externa'), 'reconciler.md');
  assert.ok(read(join(SKILL_ROOT, 'templates', 'pt-BR', 'catalogo-de-specs.md')).includes('- `validada sem revisão externa`'), 'catalog template state');
  assert.ok(ref('delivery.md').includes("keeps the writer's text") && !ref('delivery.md').includes('overwrites the slot'), 'delivery.md: writer text');
  const task = read(join(SKILL_ROOT, 'templates', 'pt-BR', 'tarefa.md'));
  assert.ok(task.includes('| Faixa |') && task.includes('| Arquivos prováveis |'), 'tarefa.md: lane and files');
  assert.ok(ref('architecture.md').includes('### Preview for the owner'), 'architecture.md: preview');
});

test('config questions for harnesses and PR review, and the offer for keys an older config lacks', () => {
  const conf = ref('configure.md');
  for (const p of ['**9. AI tools** (`harnesses`)', '**10. Review of the delivery\'s PR**', '`review.pr.reviewer`', '`review.pr.auto_fix`', 'implementers: on', 'implementers: off', '## Existing config without the new keys', 'offer once, before building', 'ask only the questions of the missing keys']) assert.ok(conf.includes(p), `configure.md: "${p}" missing`);
  // Every import-verdict is asked; only import-pr-verdict (no file, latest round) is allowed.
  assert.ok(!conf.includes('import-verdict * -)') && !conf.includes('import-verdict ENT-* *'), 'configure.md: the import-verdict ask is never narrowed, nor allowed with a file');
  assert.ok(!conf.includes('Bash(opencode run * --agent plan *)'), 'configure.md: OpenCode is asked, not allowed');
  for (const p of ['`before_pr`', 'rascunho, sem perguntar', 'marcar esse rascunho como pronto']) assert.ok(conf.includes(p), `configure.md: "${p}" missing`);
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['`harnesses`', '`review.pr`', 'offer once to ask only the new questions before building']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
});

test('the plan decides harness, model and effort per task and role; the conductor follows it', () => {
  const plan = read(join(TEMPLATES, 'plano.md'));
  assert.ok(plan.includes('| Nível/esforço | Harness e modelo | Faixa |'), 'plano.md: task harness column');
  assert.ok(plan.includes('| Papel | O que faz | Nível | Harness | Modelo e esforço |'), 'plano.md: agents harness column');
  assert.ok(read(join(TEMPLATES, 'tarefa.md')).includes('| Harness e modelo |'), 'tarefa.md: harness field');
  const planning = ref('planning.md');
  for (const p of ['| Harness and model |', 'the conductor only follows the table', '`review.pr.reviewer`', 'less independent']) assert.ok(planning.includes(p), `planning.md: "${p}" missing`);
  assert.ok(ref('roles/planner.md').includes('`harnesses`'), 'planner reads harnesses');
  assert.ok(ref('implementation.md').includes('never pick another harness or model at run time'), 'implementation follows the plan');
  const amb = ref('ambientes.md');
  assert.ok(!/codex exec [^`]*--ephemeral/.test(amb),'ambientes.md: a Codex call must keep its session, or cost measure cannot read it');
  assert.ok(amb.includes('No `--ephemeral`'), 'ambientes.md: says why the Codex session is kept');
  for (const p of ['## 5. Harnesses of the project', 'decided in the plan, never at run time', 'only read-only roles', '`implementers: on`', 'codex exec -m <model> -c model_reasoning_effort=<high|medium|low> -s read-only', '-o <answer file>', 'opencode run -m <provider/model>', '--harness', '## 8. Running a role in a fresh session', 'The pr-reviewer never runs in this conversation']) assert.ok(amb.includes(p), `ambientes.md: "${p}" missing`);
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  for (const p of ['git status --porcelain --ignored --untracked-files=all -- .baco .worktrees', 'the pr-reviewer never runs inline']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
});

test('PR review: draft PR or local diff, agent verdict straight from its file, person verdict confirmed, ready to test, merge stays human', () => {
  const review = ref('review.md');
  assert.ok(!review.includes('baco import-verdict ENT-NNN <resposta.md>'), 'review.md: the agent answer goes through import-pr-verdict');
  for (const p of ['gh pr create --draft', 'local diff of the delivery branch', 'baco build-handoff ENT-NNN --mode pr', 'baco import-pr-verdict ENT-NNN', 'without the person', 'never runs inline in your session', 'only with the person\'s confirmation', 'falls back to `pessoa`', '**Person reviewer**', 'The person states the verdict line', 'never choose or change a severity', 'an instruction, not an enforced isolation', 'only after they confirm that exact text', 'Never edit, complete, summarize or write an agent\'s', 'less independent', '`review.pr.auto_fix` on', 'Always ask the human first, whatever `auto_fix` says', 'which checks only the corrections', 'ready to test']) assert.ok(review.includes(p), `review.md: "${p}" missing`);
  const delivery = ref('delivery.md');
  for (const p of ['**Ready to test.**', 'gh pr ready <number>', '"pode juntar"', 'Preview for the owner']) assert.ok(delivery.includes(p), `delivery.md: "${p}" missing`);
  const gates = ref('gates.md');
  assert.ok(gates.includes('the draft opened for the review in phase 7 is not a request to merge'), 'gates.md: before_pr on the ready PR');
  assert.ok(gates.includes('an agent\'s verdict imported without the person included'), 'gates.md: agent verdict is an input');
  const impl = ref('implementation.md');
  assert.ok(impl.includes('until the delivery is ready for the person to test'), 'implementation.md: run ends ready to test');
  assert.ok(!impl.includes('external review question'), 'implementation.md: old stop point gone');
});

test('harness check before the plan; the conductor commits for an implementer on another harness', () => {
  const amb = ref('ambientes.md');
  for (const p of ['**Check before relying on it.**', '.baco/logs/harnesses.md', 'never retry with the sandbox off', '**Implementer on another harness: you commit.**', '`.git/worktrees/<name>`', 'Implementado por: <harness>, <model>, <effort>']) assert.ok(amb.includes(p), `ambientes.md: "${p}" missing`);
  assert.ok(ref('configure.md').includes('Check before relying on it'), 'configure.md: checks each tool');
  assert.ok(ref('planning.md').includes('only in a mode whose check passed'), 'planning.md: only checked harnesses');
  const impl = ref('implementation.md');
  assert.ok(impl.includes('**Other harnesses.**') && impl.includes('That implementer does not commit'), 'implementation.md: re-check and commit rule');
  assert.ok(ref('roles/implementer.md').includes('do not commit and do not run `baco check-branch` or `baco guard-tests`'), 'implementer: no commit on another harness');
});

test('cost is measured from the transcripts, for deliveries and for stages outside them', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  const M = 'baco cost measure ENT-NNN --conductor-harness <harness> --write';
  for (const p of [M, 'docs/custo-projeto.md']) assert.ok(skill.includes(p), `SKILL.md: "${p}" missing`);
  assert.ok(ref('delivery.md').includes(M), 'delivery.md: measure before the report');
  assert.ok(ref('reconciliation.md').includes(M), 'reconciliation.md: measure again');
  assert.ok(ref('common-process.md').includes('baco cost measure --since'), 'common-process.md: stage cost');
  assert.ok(read(join(TEMPLATES, 'plano.md')).includes('**Início:**'), 'plano.md: start line');
});

test('clean install proven in the skeleton task; reviewers never judge a command by reading', () => {
  for (const f of ['planning.md', 'implementation.md', 'architecture.md']) assert.ok(ref(f).includes('Skeleton task'), `${f}: skeleton task`);
  assert.ok(ref('review-protocol.md').includes('**Claims about commands.**'), 'review-protocol.md: shared rule');
  for (const r of ['task-reviewer', 'final-reviewer', 'pr-reviewer']) assert.ok(ref(`roles/${r}.md`).includes('from reading alone'), `${r}: run or mark not verified`);
  assert.ok(read(join(TEMPLATES, 'prompt-revisor-pr.md')).includes('não foi verificado'), 'PR prompt: not verified');
});

// Review: without the flag the engine assumes a Claude Code conductor; a Codex conductor became `avulsa`.
test('every instruction that measures cost names the conductor harness', () => {
  const files = { 'SKILL.md': read(join(SKILL_ROOT, 'SKILL.md')) };
  for (const f of ['reconciliation.md', 'common-process.md', 'implementation.md', 'delivery.md']) files[f] = ref(f);
  let seen = 0;
  for (const [name, text] of Object.entries(files)) {
    for (const m of text.matchAll(/`baco cost measure[^`]*`/g)) {
      seen++;
      if (/--session|--write|--since|ENT-NNN/.test(m[0])) assert.ok(m[0].includes('--conductor-harness <'), `${name}: ${m[0]}`);
    }
  }
  assert.ok(seen >= 5, `measure instructions found: ${seen}`);
  assert.ok(files['SKILL.md'].includes('`--conductor-harness`'), 'SKILL.md: says what the flag is for');
});

// E2E round C: the validator read only titles; the simplifier called "safe" a cut that reopened a defect.
test('acceptance validator reads test bodies and reports what it read and ran; simplifier code cuts need a covering test', () => {
  const v = ref('roles/acceptance-validator.md');
  for (const p of ['read its body', 'Never judge from the title alone', '.worktrees/copia-validador-NN', '`Lido:`', '`Rodado:`', 'cannot be `confirmado`']) assert.ok(v.includes(p), `acceptance-validator: "${p}" missing`);
  assert.ok(ref('delivery.md').includes('names no test read'), 'delivery.md: incomplete validator report is sent back');
  const s = ref('roles/simplifier.md');
  for (const p of ['`precisa de teste`', '`muda comportamento`', 'existing tests prove the behavior stays the same', '`Coberto por:', 'a fix added to close a review finding']) assert.ok(s.includes(p), `simplifier: "${p}" missing`);
  const r = ref('review.md');
  for (const p of ['only through an INT task with a test', 'first writes the test of the current behavior', 'never applied in the run', 'without naming a covering test is treated as `precisa de teste`']) assert.ok(r.includes(p), `review.md: "${p}" missing`);
});
