import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { boardItems } from '../skills/baco-sdd/scripts/commands/board.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

// 1.2.0: the GitHub Project board mirrors the delivery's files, one way. The engine reads the task
// files and progresso.md and says which issue goes to which Status option; it never calls gh.
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const run = async (dir, ...args) => {
  const c = capture();
  const code = await main(['board', ...args, '--cwd', dir], c.io);
  return { code, ...c.out, data: args.includes('--json') ? JSON.parse(c.out.stdout) : null };
};

const CONFIG = `tracker: [files, github]
github:
  project:
    owner: acme
    number: 7
`;
const URL = (n) => `https://github.com/acme/app/issues/${n}`;
const task = (id, issue) => `# ${id} | Algo\n\n| Campo | Valor |\n|---|---|\n| Entrega | \`ENT-001\` |\n| Branch | \`baco/ENT-001-${id}\` |\n${issue ? `| Issue | ${issue} |\n` : ''}`;
const progress = ({ parent = URL(1), situacao = '`<rodando, parado por cota>`', andamento = [], registro = [] } = {}) => `# Progresso | ENT-001 \`app\`

${parent ? `- **Issue mãe:** ${parent}\n` : ''}
## Retomada

- **Atualizado em:** \`2026-11-16 10:00\`
- **Situação:** ${situacao}

### Tarefas em andamento

| Tarefa | Ramo | Pasta de trabalho | Relatório | Último commit | Etapa e rodada |
|---|---|---|---|---|---|
${andamento.map(([id, etapa]) => `| \`${id}\` | \`baco/ENT-001-${id}\` | \`.worktrees/${id}\` | \`r.md\` | \`abc1234\` | ${etapa} |`).join('\n')}

## Registro das tarefas

| Data/hora | Tarefa | Estado (FEITO, FEITO_COM_RESSALVAS, PRECISA_CONTEXTO ou BLOQUEADO) | Commits | Nota |
|---|---|---|---|---|
${registro.map(([id, estado]) => `| 2026-11-16 11:00 | \`${id}\` | \`${estado}\` | \`abc\` | nota |`).join('\n')}

## Pendências

| ID | Pendência | Impacto | Responsável | Destino | Situação |
|---|---|---|---|---|---|
`;
const DIR = 'docs/entregas/ENT-001-app';
async function repo({ config = CONFIG, prog = progress(), tasks = { 'T-001': URL(2), 'T-002': URL(3), 'T-003': URL(4) }, extra = {} } = {}) {
  const files = { '.baco/config.yaml': config, [`${DIR}/plano.md`]: '# Plano\n', [`${DIR}/progresso.md`]: prog, ...extra };
  for (const [id, issue] of Object.entries(tasks)) files[`${DIR}/tarefas/${id}.md`] = task(id, issue);
  return makeRepo(files);
}
const statusOf = (data) => Object.fromEntries(data.items.map((i) => [i.task ?? 'mãe', i.status]));

test('board: without github.project there is nothing to mirror (exit 0)', async () => {
  const dir = await repo({ config: 'tracker: [files, github]\n' });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(r.code, 0);
  assert.equal(r.data.configured, false);
  assert.deepEqual(r.data.changes, []);
});

test('board: a project without the github tracker is not mirrored either', async () => {
  const dir = await repo({ config: 'tracker: [files]\ngithub:\n  project: {owner: acme, number: 7}\n' });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(r.code, 0);
  assert.equal(r.data.configured, false);
});

test('board: just published, every issue goes to Backlog', async () => {
  const dir = await repo();
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(r.code, 0);
  assert.equal(r.data.configured, true);
  assert.deepEqual(r.data.project, { owner: 'acme', number: 7, field: 'Status' });
  assert.deepEqual(statusOf(r.data), { 'mãe': 'Backlog', 'T-001': 'Backlog', 'T-002': 'Backlog', 'T-003': 'Backlog' });
  assert.equal(r.data.changes.length, 4);
});

test('board: each task event maps to its column; the parent is in progress once phase 6 starts', async () => {
  const dir = await repo({
    prog: progress({
      situacao: '`rodando`',
      andamento: [['T-002', 'construção, rodada 1'], ['T-003', 'revisão, rodada 2']],
      registro: [['T-001', 'FEITO']],
    }),
  });
  const r = await run(dir, 'ENT-001', '--json');
  assert.deepEqual(statusOf(r.data), { 'mãe': 'In progress', 'T-001': 'Done', 'T-002': 'In progress', 'T-003': 'In review' });
  assert.deepEqual(r.data.items.map((i) => i.state), ['started', 'merged', 'started', 'review']);
});

test('board: fix round is back in progress, a human check waits in review, a blocked task stays in progress', async () => {
  const dir = await repo({
    prog: progress({
      situacao: '`parado por bloqueio`',
      andamento: [['T-001', 'correção, rodada 1'], ['T-002', 'esperando a pessoa']],
      registro: [['T-002', 'FEITO'], ['T-003', 'BLOQUEADO']],
    }),
  });
  const r = await run(dir, 'ENT-001', '--json');
  assert.deepEqual(statusOf(r.data), { 'mãe': 'In progress', 'T-001': 'In progress', 'T-002': 'In review', 'T-003': 'In progress' });
});

test('board: the last log row of a task wins', async () => {
  const dir = await repo({ prog: progress({ situacao: '`rodando`', registro: [['T-001', 'PRECISA_CONTEXTO'], ['T-001', 'FEITO_COM_RESSALVAS']] }) });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(statusOf(r.data)['T-001'], 'Done');
});

test('board: a task that started shows the parent in progress even before Retomada is filled', async () => {
  const dir = await repo({ prog: progress({ andamento: [['T-001', 'construção']] }) });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(statusOf(r.data)['mãe'], 'In progress');
});

test('board: the parent is Done only when the delivery branch is merged into the integration branch', async () => {
  const dir = await repo({ prog: progress({ situacao: '`fim`', registro: [['T-001', 'FEITO'], ['T-002', 'FEITO'], ['T-003', 'FEITO']] }) });
  git(dir, 'branch', 'develop');
  git(dir, 'switch', '-q', '-c', 'baco/ENT-001');
  commit(dir, { 'src/a.js': 'x\n' }, 'feat: a');
  let r = await run(dir, 'ENT-001', '--json');
  assert.equal(statusOf(r.data)['mãe'], 'In progress');
  git(dir, 'switch', '-q', 'develop');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'baco/ENT-001');
  r = await run(dir, 'ENT-001', '--json');
  assert.equal(statusOf(r.data)['mãe'], 'Done');
});

test('board: after cleanup the delivery tag still proves the merge, and every task is Done', async () => {
  const dir = await repo({ prog: progress({ situacao: '`fim`', andamento: [['T-003', 'revisão']] }) });
  git(dir, 'branch', 'develop');
  git(dir, 'switch', '-q', '-c', 'baco/ENT-001');
  commit(dir, { 'src/a.js': 'x\n' }, 'feat: a');
  git(dir, 'switch', '-q', 'develop');
  git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'baco/ENT-001');
  git(dir, 'tag', 'entrega/ENT-001', 'baco/ENT-001');
  git(dir, 'branch', '-D', 'baco/ENT-001');
  const r = await run(dir, 'ENT-001', '--json');
  assert.deepEqual(statusOf(r.data), { 'mãe': 'Done', 'T-001': 'Done', 'T-002': 'Done', 'T-003': 'Done' });
});

test('board: configured column names and field replace the defaults', async () => {
  const config = `${CONFIG}    field: Etapa\n    status: {published: A fazer, started: Fazendo, review: Revisando, merged: Feito}\n`;
  const dir = await repo({ config, prog: progress({ situacao: '`rodando`', andamento: [['T-001', 'revisão']] }) });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(r.data.project.field, 'Etapa');
  assert.deepEqual(statusOf(r.data), { 'mãe': 'Fazendo', 'T-001': 'Revisando', 'T-002': 'A fazer', 'T-003': 'A fazer' });
});

test('board: tasks without an issue and a missing parent are reported, fix tasks are ignored', async () => {
  const dir = await repo({
    prog: progress({ parent: null }),
    tasks: { 'T-001': URL(2), 'T-002': null },
    extra: { [`${DIR}/tarefas/FIX-01.md`]: '# FIX-01\n' },
  });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(r.code, 0);
  assert.deepEqual(r.data.missing, ['T-002']);
  assert.equal(r.data.parentMissing, true);
  assert.deepEqual(r.data.items.map((i) => i.task), ['T-001']);
});

test('board: issue URLs in angle brackets, backticks or a markdown link are read', async () => {
  const dir = await repo({ tasks: { 'T-001': `<${URL(2)}>`, 'T-002': `\`${URL(3)}\``, 'T-003': `[#4](${URL(4)})` } });
  const r = await run(dir, 'ENT-001', '--json');
  assert.deepEqual(r.data.items.slice(1).map((i) => i.url), [URL(2), URL(3), URL(4)]);
});

test('board: --applied records what was set, and only real changes are listed afterwards', async () => {
  const dir = await repo();
  let r = await run(dir, 'ENT-001', '--json', '--applied', `${URL(1)}=Backlog`, '--applied', `${URL(2)}=Backlog`);
  assert.equal(r.code, 0);
  assert.deepEqual(r.data.changes.map((c) => c.url), [URL(3), URL(4)]);
  const record = join(dir, '.baco/logs/quadro-ENT-001.json');
  assert.ok(existsSync(record));
  assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')).applied, { [URL(1)]: 'Backlog', [URL(2)]: 'Backlog' });
  // T-001 starts: only it changes.
  commit(dir, { [`${DIR}/progresso.md`]: progress({ andamento: [['T-001', 'construção']] }) }, 'progress');
  r = await run(dir, 'ENT-001', '--json');
  assert.deepEqual(r.data.changes.map((c) => [c.task ?? 'mãe', c.status]), [['mãe', 'In progress'], ['T-001', 'In progress'], ['T-002', 'Backlog'], ['T-003', 'Backlog']]);
  // --all lists everything, recorded or not.
  r = await run(dir, 'ENT-001', '--json', '--applied', `${URL(3)}=Backlog`, '--applied', `${URL(4)}=Backlog`);
  assert.equal(r.data.changes.length, 2);
  r = await run(dir, 'ENT-001', '--json', '--all');
  assert.equal(r.data.changes.length, 4);
});

test('board: --applied with an unknown issue or column is a usage error and records nothing', async () => {
  const dir = await repo();
  let r = await run(dir, 'ENT-001', '--applied', `${URL(99)}=Backlog`);
  assert.equal(r.code, 64);
  r = await run(dir, 'ENT-001', '--applied', `${URL(2)}=Talvez`);
  assert.equal(r.code, 64);
  r = await run(dir, 'ENT-001', '--applied', 'sem-igual');
  assert.equal(r.code, 64);
  assert.equal(existsSync(join(dir, '.baco/logs/quadro-ENT-001.json')), false);
});

test('board: a broken record file is read as empty, never fatal', async () => {
  const dir = await repo({ extra: { '.baco/logs/quadro-ENT-001.json': '{not json' } });
  const r = await run(dir, 'ENT-001', '--json');
  assert.equal(r.code, 0);
  assert.equal(r.data.changes.length, 4);
});

test('board: the human text gives the exact gh command for each change', async () => {
  const dir = await repo({ prog: progress({ andamento: [['T-001', 'revisão']] }) });
  const r = await run(dir, 'ENT-001');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /gh project item-edit 7 --owner acme --url https:\/\/github\.com\/acme\/app\/issues\/2 --field "Status" --value "In review"/);
});

test('board: usage errors and a missing delivery', async () => {
  const dir = await repo();
  assert.equal((await run(dir)).code, 64);
  assert.equal((await run(dir, 'ENT-1')).code, 64);
  assert.equal((await run(dir, 'ENT-009')).code, 65);
});

test('boardItems: pure mapping from the parsed files', () => {
  const items = boardItems({
    parentUrl: URL(1), tasks: [{ id: 'T-001', url: URL(2) }], started: false, merged: false,
    andamento: new Map(), registro: new Map(),
    status: { published: 'B', started: 'P', review: 'R', merged: 'D' },
  });
  assert.deepEqual(items.map((i) => [i.kind, i.state, i.status]), [['parent', 'published', 'B'], ['task', 'published', 'B']]);
});
