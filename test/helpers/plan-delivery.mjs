// A delivery ready for acceptance (plan, specs, QA, trace, verdict, battery stamp and a fake gh),
// used by the plan approval tests. `approve` records the portrait with `baco approve-plan` and commits it.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeRepo, commit } from './tmprepo.mjs';
import { makeTempDirSync } from './tmpdir.mjs';
import { main } from '../../skills/baco-sdd/scripts/baco.mjs';

export const capture = () => {
  let stdout = '';
  let stderr = '';
  return {
    out: () => ({ stdout, stderr }),
    io: { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } },
  };
};

export const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

export const SPEC = '# Spec A\n\n| Campo | Valor |\n|---|---|\n| Versão | 1.0 |\n\n- **CA-001:** Ok.\n- **CA-002:** Futuro.\n';
export const QA = [
  '# QA', '',
  '### CT-001 | Ok', '- **Contratos:** CA-001', '- **Automação:** automatizado', '',
  '### CT-002 | Futuro', '- **Contratos:** CA-002', '- **Automação:** manual', '',
].join('\n');
export const PLAN = [
  '# Plano | ENT-001 `fatia`', '',
  '**Specs:** docs/specs/spec-a.md@1.0', '',
  '## Cobertura', '',
  '| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |',
  '|---|---|---|---|',
  '| `CA-001` | `T-001` | `CT-001` | `regra` |',
  '| `CA-002` | `fora desta entrega` | `CT-002` | `-` |',
].join('\n');
export const OLD_PROGRESS = '# Progresso\n\n## Esperando a pessoa\n\n| Item | Situação |\n|---|---|\n';
// progresso.md of the 1.11 template: `## Retomada` with `Execução autônoma` and `Conversa condutora`.
export const NEW_PROGRESS = [
  '# Progresso', '',
  '## Retomada', '',
  '- **Situação:** `rodando`',
  '- **Execução autônoma:** `sim`',
  '- **Conversa condutora:** `não informado`', '',
  '## Esperando a pessoa', '',
  '| Item | Situação |', '|---|---|', '',
].join('\n');

export const DELIVERY = 'docs/entregas/ENT-001-fatia';
export const JUNIT = '<testsuite><testcase classname="a" name="[CT-001] ok"/></testsuite>\n';

export async function setupDelivery(t, {
  spec = SPEC,
  qa = QA,
  plan = PLAN,
  progress = OLD_PROGRESS,
  extraSpecs = {},
  approve = false,
  approveBy = 'Ana',
  extraConfig = '',
  junit = JUNIT,
} = {}) {
  const repo = await makeRepo({
    '.gitignore': '.baco/junit/\n.baco/logs/\n',
    '.baco/config.yaml': [
      'branches:', '  main: main', '  integration: develop',
      'manual_pending:', '  main: block', '  other: block',
      'delivery:', '  target: integration', '  integration_merge: auto',
      extraConfig, '',
    ].join('\n'),
    'docs/specs/spec-a.md': spec,
    'docs/qa/cenarios-qa-spec-a.md': qa,
    ...extraSpecs,
    'src/a.js': 'export const a = 1;\n',
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'checkout', '-q', '-b', 'develop');
  git(repo, 'checkout', '-q', '-b', 'baco/ENT-001');
  commit(repo, {
    'src/a.js': 'export const a = 2;\n',
    [`${DELIVERY}/plano.md`]: plan,
    [`${DELIVERY}/progresso.md`]: progress,
  }, 'plan and work');

  if (approve) {
    const ca = capture();
    const code = await main(['approve-plan', 'ENT-001', '--by', approveBy, '--cwd', repo], ca.io);
    assert.equal(code, 0, ca.out().stderr + ca.out().stdout);
    git(repo, 'add', `${DELIVERY}/aprovacao-plano.md`);
    git(repo, 'commit', '-q', '-m', 'approve plan');
  }

  mkdirSync(join(repo, '.baco/junit'), { recursive: true });
  writeFileSync(join(repo, '.baco/junit/a.xml'), junit);
  const traces = [];
  const specPaths = ['docs/specs/spec-a.md', ...Object.keys(extraSpecs).filter((p) => p.startsWith('docs/specs/'))];
  for (const specPath of specPaths) {
    const name = specPath.replace(/^docs\/specs\/(.*)\.md$/, '$1');
    const qaPath = `docs/qa/cenarios-qa-${name}.md`;
    const out = join(repo, DELIVERY, 'revisao', `trace-${name}.json`);
    const ct = capture();
    const tc = await main(['trace', '--spec', specPath, '--qa', qaPath, '--delivery', 'ENT-001', '--out', out, '--json', '--cwd', repo], ct.io);
    assert.equal(tc, 0, ct.out().stderr + ct.out().stdout);
    traces.push(out);
  }

  const head = git(repo, 'rev-parse', 'HEAD');
  const verdict = `# Veredito\n\n<!-- baco:parsed ${JSON.stringify({ verdict: 'aprovado', reviewedHead: head, source: 'agent', findings: [] })} -->\n`;
  const files = { [`${DELIVERY}/revisao/veredito-01.md`]: verdict };
  for (const p of traces) files[p.slice(repo.length + 1)] = readFileSync(p, 'utf8');
  commit(repo, files, 'review artifacts');
  const tip = git(repo, 'rev-parse', 'HEAD');
  mkdirSync(join(repo, '.baco/logs'), { recursive: true });
  writeFileSync(join(repo, '.baco/logs/bateria-completa.json'), JSON.stringify({
    head: tip, dirty: false, seconds: 5, layers: [{ layer: 'unit', exit: 0, failures: [] }],
  }));

  const logDir = makeTempDirSync('baco-plan-gh-', t);
  const bin = join(logDir, 'gh');
  writeFileSync(bin, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    headRefOid: ${JSON.stringify(tip)}, baseRefName: 'develop', state: 'OPEN',
    statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  }));
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'merge') process.exit(0);
process.exit(1);
`);
  chmodSync(bin, 0o755);
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });
  return { repo, traces, dir: join(repo, DELIVERY) };
}

// acceptance-report on the delivery: { code, data }.
export async function acceptance(repo, traces) {
  const c = capture();
  const args = ['acceptance-report', 'ENT-001', '--target', 'develop', '--json', '--cwd', repo];
  for (const p of traces) args.push('--trace', p);
  const code = await main(args, c.io);
  return { code, data: JSON.parse(c.out().stdout), out: c.out() };
}

// merge-check on the delivery (with a PR, without --apply): { code, data, acceptance condition }.
export async function mergeCheck(repo) {
  const c = capture();
  const code = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--json', '--cwd', repo], c.io);
  const data = JSON.parse(c.out().stdout);
  return { code, data, acceptanceCondition: data.conditions.find((x) => x.key === 'acceptance') };
}
