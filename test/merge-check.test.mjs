import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};

const ENT = 'docs/entregas/ENT-001-a';
const CONFIG = 'branches:\n  main: main\n  integration: develop\ndelivery:\n  integration_merge: auto\nmanual_pending:\n  main: block\n  integration: block\n';
const PROGRESS = (waiting = '', decisions = '') => `# Progresso | ENT-001\n\n## Esperando a pessoa\n\n| Item | Tipo | O que a pessoa precisa decidir ou fazer | Desde | Situação |\n|---|---|---|---|---|\n${waiting}\n## Pendências\n\n| ID | Pendência | Impacto | Responsável | Destino | Situação |\n|---|---|---|---|---|---|\n\n## Decisões registradas\n\n${decisions}\n`;
const verdictMd = (verdict, reviewedHead, source) => `# Veredito\n\n<!-- baco:parsed ${JSON.stringify({ verdict, reviewedHead, findings: [], ...(source ? { source } : {}) })} -->\n`;
const sc = (id, result, extra = {}) => ({ id, via: 'qa', automation: result === 'passed' ? 'automatizado' : 'manual', result, ...extra });
const traceJson = (head, scenarios = [sc('CT-001', 'passed')], over = {}) => JSON.stringify({
  delivery: 'ENT-001', head, spec: { path: 'docs/specs/a.md' }, cas: [{ ca: 'CA-001', status: scenarios.every((s) => s.result === 'passed') ? 'proven' : 'pending', scenarios }], orphanTests: [], summary: {}, ...over,
});
const PLAN = '# Plano\n\n**Specs:** `docs/specs/a.md@1.0`\n';
const GH = `#!/bin/sh
d="$(dirname "$0")"
echo "$*" >> "$d/calls.log"
if [ "$1" = pr ]; then cat "$d/pr.json"; exit 0; fi
sha=$(printf '%s' "$2" | sed -n 's#.*/commits/\\([0-9a-f]*\\)/check-runs.*#\\1#p')
if [ -f "$d/checks-$sha.json" ]; then cat "$d/checks-$sha.json"; else echo '{"total_count":0,"check_runs":[]}'; fi
`;
const run = (name, status = 'COMPLETED', conclusion = 'SUCCESS') => ({ __typename: 'CheckRun', name, status, conclusion });

// A delivery branch baco/ENT-001 made from develop, with one code commit, an approved verdict and a
// trace on it, a passing battery stamp on its tip, and a fake gh whose PR is green on that tip.
async function setup({ config = CONFIG, files = {}, progress = PROGRESS() } = {}) {
  const dir = await makeRepo({ '.baco/config.yaml': config, '.gitignore': '.baco/logs/\n', 'src/app.js': 'a\n', 'README.md': 'leia\n', ...files });
  temps.push(dir);
  git(dir, 'branch', 'develop');
  git(dir, 'checkout', '-q', '-b', 'baco/ENT-001');
  const code = commit(dir, { 'src/app.js': 'b\n' }, 'feat: code');
  const tip = commit(dir, {
    [`${ENT}/plano.md`]: PLAN, ...(progress === null ? {} : { [`${ENT}/progresso.md`]: progress }),
    [`${ENT}/revisao/trace-spec-a.json`]: traceJson(code), [`${ENT}/revisao/veredito-01.md`]: verdictMd('aprovado', code),
  }, 'docs: records');
  const ghDir = mkdtempSync(join(tmpdir(), 'baco-gh-'));
  temps.push(ghDir);
  const gh = join(ghDir, 'gh');
  writeFileSync(gh, GH);
  chmodSync(gh, 0o755);
  const env = {
    dir, code, tip, gh, ghDir,
    stamp: (over = {}) => {
      mkdirSync(join(dir, '.baco/logs'), { recursive: true });
      writeFileSync(join(dir, '.baco/logs/bateria-completa.json'), JSON.stringify({
        at: '2026-11-20T10:00:00.000Z', head: git(dir, 'rev-parse', 'HEAD'), branch: 'baco/ENT-001', dirty: false, seconds: 12, passed: true,
        layers: [{ layer: 'unit', exit: 0, seconds: 12, failures: [] }], reruns: [], ...over,
      }));
    },
    pr: (headRefOid, rollup = [run('testes')], over = {}) => writeFileSync(join(ghDir, 'pr.json'), JSON.stringify({ headRefOid, statusCheckRollup: rollup, baseRefName: 'develop', state: 'OPEN', ...over })),
    checks: (sha, list) => writeFileSync(join(ghDir, `checks-${sha}.json`), JSON.stringify({ total_count: list.length, check_runs: list })),
  };
  env.stamp();
  env.pr(tip);
  return env;
}

async function check(env, args = [], { gh = env.gh, target = 'develop' } = {}) {
  const saved = process.env.BACO_GH;
  process.env.BACO_GH = gh;
  try {
    const { io, out } = capture();
    const code = await main(['merge-check', 'ENT-001', '--target', target, '--pr', '7', '--cwd', env.dir, '--json', ...args], io);
    const data = JSON.parse(out.stdout);
    const cond = (key) => data.conditions?.find((c) => c.key === key);
    return { code, data, cond, out };
  } finally {
    if (saved === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = saved;
  }
}

test('clean delivery: every condition ok, exit 0, data shape', async () => {
  const env = await setup();
  const r = await check(env);
  assert.equal(r.code, 0, JSON.stringify(r.data, null, 2));
  assert.equal(r.data.ok, true);
  assert.equal(r.data.delivery, 'ENT-001');
  assert.equal(r.data.target, 'develop');
  assert.equal(r.data.branch, 'baco/ENT-001');
  assert.equal(r.data.tip, env.tip);
  assert.deepEqual(r.data.conditions.map((c) => c.key), ['battery', 'verdict', 'manual', 'acceptance', 'waiting', 'ci', 'policy']);
  for (const c of r.data.conditions) assert.equal(typeof c.detail, 'string');
  assert.deepEqual(r.data.warnings, []);
  assert.equal(r.data.batterySeconds, 12);
  assert.equal(r.data.ciTimeoutMinutes, null);
});

test('human output lists every condition; pt-BR, exit 2 names what needs the person', async () => {
  const env = await setup();
  const { io, out } = capture();
  const saved = process.env.BACO_GH;
  process.env.BACO_GH = env.gh;
  let code;
  try { code = await main(['merge-check', 'ENT-001', '--target', 'main', '--pr', '7', '--cwd', env.dir], io); } finally {
    if (saved === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = saved;
  }
  assert.equal(code, 2);
  assert.match(out.stdout, /precisa da pessoa para entrar em main/);
  assert.match(out.stdout, /NÃO: política: a junção na principal sempre pede a pessoa/);
  assert.match(out.stdout, /ok: bateria completa:/);
});

test('policy: main never ok; integration with ask, or another branch, needs the person', async () => {
  const env = await setup();
  git(env.dir, 'branch', 'main-copy', 'main');
  const main = await check(env, [], { target: 'main' });
  assert.equal(main.code, 2);
  assert.equal(main.cond('policy').ok, false);
  assert.match(main.cond('policy').detail, /sempre pede a pessoa/);
  const other = await check(env, [], { target: 'main-copy' });
  assert.equal(other.cond('policy').ok, false);
  const ask = await setup({ config: CONFIG.replace('integration_merge: auto', 'integration_merge: ask') });
  const r = await check(ask);
  assert.equal(r.code, 2);
  assert.equal(r.cond('policy').ok, false);
  assert.match(r.cond('policy').detail, /ask/);
  const none = await setup({ config: CONFIG.replace('delivery:\n  integration_merge: auto\n', '') });
  assert.equal((await check(none)).cond('policy').ok, false, 'default is ask');
});

test('battery: missing, unreadable or dirty stamp is not ok', async () => {
  const env = await setup();
  rmSync(join(env.dir, '.baco/logs/bateria-completa.json'));
  let r = await check(env);
  assert.equal(r.code, 2);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /run-tests --all/);
  writeFileSync(join(env.dir, '.baco/logs/bateria-completa.json'), '{nope');
  assert.equal((await check(env)).cond('battery').ok, false);
  env.stamp({ dirty: true });
  r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /não gravadas/);
  env.stamp({ head: 'f'.repeat(40) });
  assert.equal((await check(env)).cond('battery').ok, false);
});

test('battery: a code commit after the stamp is not ok; Markdown under docs_root and delivery records are not code', async () => {
  const env = await setup();
  commit(env.dir, { 'docs/qa/a.md': '# QA\n', 'docs/specs/a.md': '# Spec\n', [`${ENT}/revisao/trace-spec-b.json`]: '{}' }, 'docs: qa evidence');
  let r = await check(env);
  assert.equal(r.cond('battery').ok, true, r.cond('battery').detail);
  // Markdown outside docs_root (a README, a prompt read by the code) is code.
  commit(env.dir, { 'README.md': 'novo\n' }, 'docs: readme');
  r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /mudou depois da bateria/);
  const other = await setup();
  commit(other.dir, { 'src/app.js': 'c\n' }, 'fix: code');
  assert.equal((await check(other)).cond('battery').ok, false);
});

test('battery: with an origin, the target is fetched first; a failed fetch is not ok; no origin, no fetch', async () => {
  const env = await setup();
  const bare = mkdtempSync(join(tmpdir(), 'baco-origin-'));
  temps.push(bare);
  git(bare, 'init', '-q', '--bare');
  git(env.dir, 'remote', 'add', 'origin', bare);
  git(env.dir, 'push', '-q', 'origin', 'develop', 'baco/ENT-001');
  let r = await check(env);
  assert.equal(r.cond('battery').ok, true, r.cond('battery').detail);
  // Someone else pushes to develop on GitHub: only a fetch can see it.
  const other = mkdtempSync(join(tmpdir(), 'baco-clone-'));
  temps.push(other);
  git(other, 'clone', '-q', '-b', 'develop', bare, '.');
  git(other, '-c', 'user.name=Outra', '-c', 'user.email=outra@example.com', 'commit', '-q', '--allow-empty', '-m', 'remote work');
  git(other, 'push', '-q', 'origin', 'develop');
  assert.equal(git(env.dir, 'rev-parse', '--verify', '-q', 'refs/remotes/origin/develop'), git(env.dir, 'rev-parse', 'develop'), 'not fetched yet');
  r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /origin\/develop recebeu commits/);
  // An origin that cannot be reached.
  git(env.dir, 'remote', 'set-url', 'origin', join(bare, 'sumiu'));
  r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /não consegui conferir a linha de destino no GitHub/);
});

test('battery: the target moved (local or origin) is not ok', async () => {
  const env = await setup();
  git(env.dir, 'checkout', '-q', 'develop');
  commit(env.dir, { 'other.js': 'x\n' }, 'feat: other');
  git(env.dir, 'checkout', '-q', 'baco/ENT-001');
  let r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /develop recebeu commits/);
  git(env.dir, 'branch', '-f', 'develop', 'main');
  assert.equal((await check(env)).cond('battery').ok, true);
  // origin/develop has a commit the delivery branch lacks (fetched, not merged).
  const orphan = git(env.dir, 'commit-tree', 'main^{tree}', '-p', 'main', '-m', 'remote only');
  git(env.dir, 'update-ref', 'refs/remotes/origin/develop', orphan);
  r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /origin\/develop recebeu commits/);
  assert.equal((await check(env, [], { target: 'nope' })).cond('battery').ok, false);
});

test('battery: a failed test is flaky only when a later re-run shows that same test name passing', async () => {
  const env = await setup();
  const LOGIN = '[CT-001] login';
  const SAIR = '[CT-002] saída';
  const failed = { passed: false, layers: [{ layer: 'unit', exit: 0, seconds: 3, failures: [] }, { layer: 'e2e', exit: 1, seconds: 9, failures: [{ name: LOGIN, file: 'e2e/login.spec.ts' }, { name: SAIR, file: 'e2e/sair.spec.ts' }] }] };
  const rerun = (passed, failedNames, over = {}) => ({ at: 'x', layer: 'e2e', args: ['e2e/login.spec.ts', 'e2e/sair.spec.ts'], exit: failedNames.length ? 1 : 0, passed, failed: failedNames, ...over });
  env.stamp(failed);
  let r = await check(env);
  assert.equal(r.cond('battery').ok, false);
  assert.match(r.cond('battery').detail, /\[CT-001\] login/);
  env.stamp({ ...failed, reruns: [rerun([LOGIN], []), rerun([], [SAIR])] });
  r = await check(env);
  assert.equal(r.cond('battery').ok, false, 'a re-run where the test failed again does not count');
  assert.match(r.cond('battery').detail, /saída/);
  assert.doesNotMatch(r.cond('battery').detail, /login/);
  // Both names passed (in one re-run or in two): flaky, listed as pending items.
  env.stamp({ ...failed, reruns: [rerun([LOGIN], []), rerun([SAIR, '[CT-009] outro'], [])] });
  r = await check(env);
  assert.equal(r.cond('battery').ok, true, r.cond('battery').detail);
  assert.match(r.cond('battery').detail, /falha instável/);
  assert.deepEqual(r.data.flaky.map((f) => f.name), [LOGIN, SAIR]);
  // The same name passing and failing in one re-run (two browsers) is not proof.
  env.stamp({ ...failed, reruns: [rerun([LOGIN, SAIR], [SAIR])] });
  assert.match((await check(env)).cond('battery').detail, /saída/);
  // A re-run of another layer, one that selected no test, or one recorded before the names (args only).
  env.stamp({ ...failed, reruns: [rerun([LOGIN, SAIR], [], { layer: 'unit' })] });
  assert.equal((await check(env)).cond('battery').ok, false, 'a re-run of another layer does not count');
  env.stamp({ ...failed, reruns: [rerun([], [])] });
  assert.equal((await check(env)).cond('battery').ok, false, 'a re-run that selected no test counts for nothing');
  env.stamp({ ...failed, reruns: [{ at: 'x', layer: 'e2e', args: ['e2e/login.spec.ts', 'e2e/sair.spec.ts'], exit: 0 }] });
  assert.equal((await check(env)).cond('battery').ok, false, 'a re-run without test names counts for nothing');
  env.stamp({ passed: false, layers: [{ layer: 'e2e', exit: null, seconds: 0, failures: [] }], reruns: [rerun(['a'], [])] });
  assert.equal((await check(env)).cond('battery').ok, false, 'a layer with no failure listed cannot be proven by a re-run');
});

test('verdict: a code commit after aprovado is not ok; another verdict needs the exit-3 decision for that verdict', async () => {
  const env = await setup();
  commit(env.dir, { 'src/app.js': 'c\n' }, 'fix');
  let r = await check(env);
  assert.equal(r.cond('verdict').ok, false);
  assert.match(r.cond('verdict').detail, /mudou depois do veredito/);

  const adj = await setup();
  commit(adj.dir, { [`${ENT}/revisao/veredito-02.md`]: verdictMd('ajustes', adj.code) }, 'docs: verdict 2');
  r = await check(adj);
  assert.equal(r.cond('verdict').ok, false);
  assert.match(r.cond('verdict').detail, /veredito-02\.md\) é ajustes/);
  commit(adj.dir, { [`${ENT}/progresso.md`]: PROGRESS('', '- 2026-11-20 | saída 3 no veredito-01: seguir mesmo assim, decidido pela pessoa\n') }, 'docs: old decision');
  assert.equal((await check(adj)).cond('verdict').ok, false, 'a decision about another verdict does not count');
  commit(adj.dir, { [`${ENT}/progresso.md`]: PROGRESS('', '- 2026-11-21 | Saída 3 (veredito-02, rodada 2): seguir mesmo assim com os pontos abertos; decidido pela pessoa\n') }, 'docs: decision');
  // Under integration_merge auto, the merge after an exit-3 choice is decided with the person.
  r = await check(adj);
  assert.equal(r.cond('verdict').ok, false, r.cond('verdict').detail);
  assert.equal(r.cond('verdict').reason, 'exit3_auto');
  assert.match(r.cond('verdict').detail, /saída 3.*com a pessoa, bloqueio por bloqueio/);
  // Under ask, the decision is recorded and readable (the policy asks the person anyway).
  const ask = await setup({ config: CONFIG.replace('integration_merge: auto', 'integration_merge: ask') });
  commit(ask.dir, { [`${ENT}/revisao/veredito-02.md`]: verdictMd('ajustes', ask.code), [`${ENT}/progresso.md`]: PROGRESS('', '- 2026-11-21 | saída 3 no veredito-02: seguir; decidido pela pessoa\n') }, 'docs: verdict 2');
  r = await check(ask);
  assert.equal(r.cond('verdict').ok, true, r.cond('verdict').detail);
  assert.match(r.cond('verdict').detail, /saída 3/);
});

test('verdict: with review.pr.reviewer ambos, only an aprovado given by the person is ok', async () => {
  const AMBOS = `${CONFIG}review:\n  pr:\n    reviewer: ambos\n`;
  const env = await setup({ config: AMBOS });
  let r = await check(env);
  assert.equal(r.cond('verdict').ok, false, 'no source recorded: unknown, not the person');
  assert.equal(r.cond('verdict').reason, 'needs_person');
  commit(env.dir, { [`${ENT}/revisao/veredito-01.md`]: verdictMd('aprovado', env.code, 'agent') }, 'docs: agent verdict');
  r = await check(env);
  assert.equal(r.cond('verdict').ok, false);
  assert.match(r.cond('verdict').detail, /falta o veredito da pessoa/);
  commit(env.dir, { [`${ENT}/revisao/veredito-02.md`]: verdictMd('aprovado', env.code, 'person') }, 'docs: person verdict');
  r = await check(env);
  assert.equal(r.cond('verdict').ok, true, r.cond('verdict').detail);
  // The default reviewer (agente) does not look at the source.
  const agent = await setup();
  assert.equal((await check(agent)).cond('verdict').ok, true);
});

test('verdict: a current waiver with no verdict is ok; a stale one or nothing is not', async () => {
  const env = await setup();
  const waiver = (head) => `<!-- baco:head ${head} -->\n# Dispensa\n\n<!-- baco:waiver ${JSON.stringify({ by: 'Pessoa', date: '2026-11-20 10:00', reason: 'urgente' })} -->\n`;
  commit(env.dir, { [`${ENT}/revisao/veredito-01.md`]: null, [`${ENT}/revisao/dispensa-revisao-externa.md`]: waiver(env.code) }, 'docs: waiver');
  let r = await check(env);
  assert.equal(r.cond('verdict').ok, true, r.cond('verdict').detail);
  assert.match(r.cond('verdict').detail, /dispensada por Pessoa/);
  commit(env.dir, { [`${ENT}/revisao/dispensa-revisao-externa.md`]: waiver(git(env.dir, 'rev-parse', 'main')) }, 'docs: old waiver');
  assert.equal((await check(env)).cond('verdict').ok, false);
  commit(env.dir, { [`${ENT}/revisao/dispensa-revisao-externa.md`]: null }, 'docs: no waiver');
  r = await check(env);
  assert.equal(r.cond('verdict').ok, false);
  assert.match(r.cond('verdict').detail, /sem veredito/);
});

test('manual: pending manual or not-run scenario under block is not ok; specialist never counts; warn rule is ok', async () => {
  const env = await setup({ config: `${CONFIG}qa:\n  specialist: [leitor de tela]\n` });
  commit(env.dir, { [`${ENT}/revisao/trace-spec-a.json`]: traceJson(env.code, [sc('CT-001', 'passed'), sc('CT-002', 'manual_pending')]) }, 'docs: trace');
  let r = await check(env);
  assert.equal(r.cond('manual').ok, false);
  assert.match(r.cond('manual').detail, /CT-002/);
  commit(env.dir, { [`${ENT}/revisao/trace-spec-a.json`]: traceJson(env.code, [sc('CT-001', 'passed'), sc('CT-003', 'manual_pending', { specialist: true, specialistKind: 'leitor de tela' })]) }, 'docs: trace');
  r = await check(env);
  assert.equal(r.cond('manual').ok, true, r.cond('manual').detail);
  commit(env.dir, { [`${ENT}/revisao/trace-spec-a.json`]: null }, 'docs: no trace');
  r = await check(env);
  assert.equal(r.cond('manual').ok, false);
  assert.match(r.cond('manual').detail, /nenhum resultado/);

  const warn = await setup({ config: CONFIG.replace('  integration: block\n', '  integration: warn\n') });
  commit(warn.dir, { [`${ENT}/revisao/trace-spec-a.json`]: traceJson(warn.code, [sc('CT-002', 'manual_pending')]) }, 'docs: trace');
  r = await check(warn);
  assert.equal(r.cond('manual').ok, true);
  assert.match(r.cond('manual').detail, /warn/);
});

test('manual: a specialist flag counts only for a kind of qa.specialist', async () => {
  const kinds = await setup({ config: `${CONFIG}qa:\n  specialist: [leitor de tela]\n` });
  const t3 = traceJson(kinds.code, [sc('CT-001', 'passed'), sc('CT-003', 'manual_pending', { specialist: true, specialistKind: 'Leitor de Tela' })]);
  commit(kinds.dir, { [`${ENT}/revisao/trace-spec-a.json`]: t3 }, 'docs: trace');
  assert.equal((await check(kinds)).cond('manual').ok, true);
  const other = await setup({ config: `${CONFIG}qa:\n  specialist: [contraste de cor, outro]\n` });
  commit(other.dir, { [`${ENT}/revisao/trace-spec-a.json`]: t3.replaceAll(kinds.code, other.code) }, 'docs: trace');
  const r = await check(other);
  assert.equal(r.cond('manual').ok, false);
  assert.match(r.cond('manual').detail, /CT-003/);
});

test('manual: under a block rule the traces must be fresh', async () => {
  const env = await setup();
  commit(env.dir, { [`${ENT}/revisao/trace-spec-a.json`]: traceJson(git(env.dir, 'rev-parse', 'main')) }, 'docs: old trace');
  let r = await check(env);
  assert.equal(r.cond('manual').ok, false);
  assert.equal(r.cond('manual').reason, 'stale_trace');
  assert.match(r.cond('manual').detail, /trace-spec-a\.json/);
  const warn = await setup({ config: CONFIG.replace('  integration: block\n', '  integration: warn\n') });
  commit(warn.dir, { [`${ENT}/revisao/trace-spec-a.json`]: traceJson(git(warn.dir, 'rev-parse', 'main')) }, 'docs: old trace');
  r = await check(warn);
  assert.equal(r.cond('manual').ok, true, 'not checked under warn');
});

test('acceptance: what acceptance-report checks, at the delivery tip for that target', async () => {
  const env = await setup();
  let r = await check(env);
  assert.equal(r.cond('acceptance').ok, true, r.cond('acceptance').detail);
  const bad = async (files, pattern, opts = {}) => {
    const e = await setup(opts);
    commit(e.dir, typeof files === 'function' ? files(e) : files, 'docs: change');
    const res = await check(e);
    assert.equal(res.cond('acceptance').ok, false, JSON.stringify(res.cond('acceptance')));
    if (pattern) assert.match(res.cond('acceptance').detail, pattern);
    return res;
  };
  // Uncovered or failed criterion.
  await bad((e) => ({ [`${ENT}/revisao/trace-spec-a.json`]: JSON.stringify({ ...JSON.parse(traceJson(e.code)), cas: [{ ca: 'CA-001', status: 'uncovered', scenarios: [] }] }) }), /sem nenhum teste/);
  await bad((e) => ({ [`${ENT}/revisao/trace-spec-a.json`]: traceJson(e.code, [sc('CT-001', 'failed')], { cas: [{ ca: 'CA-001', status: 'failed', scenarios: [sc('CT-001', 'failed')] }] }) }));
  // Stale trace (older code), trace of another delivery, a plan spec without a trace.
  await bad((e) => ({ [`${ENT}/revisao/trace-spec-a.json`]: traceJson(git(e.dir, 'rev-parse', 'main')) }), null, { config: CONFIG.replace('  integration: block\n', '  integration: warn\n') });
  await bad((e) => ({ [`${ENT}/revisao/trace-spec-a.json`]: traceJson(e.code, undefined, { delivery: 'ENT-002' }) }), /ENT-001/);
  await bad({ [`${ENT}/plano.md`]: '# Plano\n\n**Specs:** `docs/specs/a.md@1.0`, `docs/specs/b.md@1.0`\n' }, /docs\/specs\/b\.md/);
  // A not-run test is never ok here, even when the rule only warns; a pending manual one under warn is.
  const warnCfg = { config: CONFIG.replace('  integration: block\n', '  integration: warn\n') };
  await bad((e) => ({ [`${ENT}/revisao/trace-spec-a.json`]: traceJson(e.code, [sc('CT-001', 'passed'), sc('CT-004', 'not_run', { automation: 'automatizado' })]) }), /não rod/i, warnCfg);
  const manualWarn = await setup(warnCfg);
  commit(manualWarn.dir, { [`${ENT}/revisao/trace-spec-a.json`]: traceJson(manualWarn.code, [sc('CT-001', 'passed'), sc('CT-002', 'manual_pending')]) }, 'docs: trace');
  r = await check(manualWarn);
  assert.equal(r.cond('acceptance').ok, true, r.cond('acceptance').detail);
  // No trace at all.
  await bad({ [`${ENT}/revisao/trace-spec-a.json`]: null }, /trace-\*\.json/);
});

test('waiting: an open row of "Esperando a pessoa" is not ok; resolved rows are ok', async () => {
  const env = await setup({ progress: PROGRESS('| T-002 | conferir | ver a tela de login | 2026-11-20 | esperando |\n| T-001 | conferir | ver a busca | 2026-11-20 | resolvido |\n') });
  let r = await check(env);
  assert.equal(r.cond('waiting').ok, false);
  assert.match(r.cond('waiting').detail, /T-002/);
  assert.doesNotMatch(r.cond('waiting').detail, /T-001/);
  commit(env.dir, { [`${ENT}/progresso.md`]: PROGRESS('| T-002 | conferir | ver a tela de login | 2026-11-20 | **resolvido** (ok) |\n') }, 'docs: resolved');
  r = await check(env);
  assert.equal(r.cond('waiting').ok, true, r.cond('waiting').detail);
  // The template's placeholder row alone is not an item.
  commit(env.dir, { [`${ENT}/progresso.md`]: PROGRESS('| `<T-002>` | `<tipo>` | `<o que a pessoa precisa decidir ou fazer>` | `<AAAA-MM-DD HH:MM>` | `<esperando ou resolvido>` |\n') }, 'docs: placeholder');
  r = await check(env);
  assert.equal(r.cond('waiting').ok, true, r.cond('waiting').detail);
});

test('waiting: fails closed: no progresso.md, or a section that is not a readable table with Situação', async () => {
  const none = await setup({ progress: null });
  let r = await check(none);
  assert.equal(r.cond('waiting').ok, false);
  assert.equal(r.cond('waiting').reason, 'no_progress');
  const section = (body) => `# Progresso | ENT-001\n\n## Esperando a pessoa\n\n${body}\n## Pendências\n\nnada\n`;
  for (const [body, why] of [
    ['- T-002: ver a tela de login\n', 'a list instead of a table'],
    ['| Item | O que fazer |\n|---|---|\n| T-002 | ver |\n', 'a table without Situação'],
    ['Falta a pessoa ver a tela de login.\n\n| Item | Tipo | O que | Desde | Situação |\n|---|---|---|---|---|\n', 'text besides the table'],
  ]) {
    const env = await setup({ progress: section(body) });
    r = await check(env);
    assert.equal(r.cond('waiting').ok, false, why);
    assert.equal(r.cond('waiting').reason, 'unreadable', why);
  }
  // An empty section, or one with only the empty table of the template, is ok.
  for (const body of ['', '| Item | Tipo | O que a pessoa precisa decidir ou fazer | Desde | Situação |\n|---|---|---|---|---|\n']) {
    const env = await setup({ progress: section(body) });
    assert.equal((await check(env)).cond('waiting').ok, true, body);
  }
});

test('ci: without --pr, with gh missing or failing, on another head, running or failed checks: not ok, never a crash', async () => {
  const env = await setup();
  const saved = process.env.BACO_GH;
  process.env.BACO_GH = env.gh;
  const { io, out } = capture();
  const code = await main(['merge-check', 'ENT-001', '--target', 'develop', '--cwd', env.dir, '--json'], io);
  if (saved === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = saved;
  assert.equal(code, 2);
  const noPr = JSON.parse(out.stdout).conditions.find((c) => c.key === 'ci');
  assert.equal(noPr.ok, false);
  assert.match(noPr.detail, /CI não conferido/);

  let r = await check(env, [], { gh: join(env.ghDir, 'missing') });
  assert.equal(r.code, 2);
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /CI não conferido/);
  const failing = join(env.ghDir, 'gh-fail');
  writeFileSync(failing, '#!/bin/sh\necho "not logged in" >&2\nexit 4\n');
  chmodSync(failing, 0o755);
  r = await check(env, [], { gh: failing });
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /not logged in/);

  env.pr(env.code);
  r = await check(env);
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /envie o ramo/);
  env.pr(env.tip, [run('testes'), run('e2e', 'IN_PROGRESS', null)]);
  r = await check(env);
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /CI ainda rodando: e2e/);
  env.pr(env.tip, [run('testes', 'COMPLETED', 'FAILURE'), { __typename: 'StatusContext', context: 'deploy', state: 'SUCCESS' }]);
  r = await check(env);
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /CI falhou: testes/);
  env.pr(env.tip, [run('testes'), run('opcional', 'COMPLETED', 'SKIPPED'), { __typename: 'StatusContext', context: 'deploy', state: 'SUCCESS' }]);
  r = await check(env);
  assert.equal(r.cond('ci').ok, true, r.cond('ci').detail);
  writeFileSync(join(env.ghDir, 'pr.json'), 'not json');
  assert.equal((await check(env)).cond('ci').ok, false);
});

test('ci: the PR must target the merge target and be open; base and state are requested from gh', async () => {
  const env = await setup();
  env.pr(env.tip, [run('testes')], { baseRefName: 'main' });
  let r = await check(env);
  assert.equal(r.cond('ci').ok, false);
  assert.equal(r.cond('ci').reason, 'wrong_base');
  assert.match(r.cond('ci').detail, /PR #7 aponta para main.*develop/);
  for (const state of ['MERGED', 'CLOSED']) {
    env.pr(env.tip, [run('testes')], { state });
    r = await check(env);
    assert.equal(r.cond('ci').ok, false, state);
    assert.equal(r.cond('ci').reason, 'not_open');
    assert.match(r.cond('ci').detail, new RegExp(state));
  }
  env.pr(env.tip, [run('testes')], { baseRefName: undefined });
  assert.equal((await check(env)).cond('ci').reason, 'gh_failed', 'a missing base is not trusted');
  env.pr(env.tip);
  assert.equal((await check(env)).cond('ci').ok, true);
  assert.match(readFileSync(join(env.ghDir, 'calls.log'), 'utf8'), /pr view 7 --json headRefOid,statusCheckRollup,baseRefName,state/);
});

test('ci: a tip with no checks is ok when every commit since the last green one touches only Markdown', async () => {
  const env = await setup();
  // The records commit (env.tip) has a JSON trace: it is not Markdown-only, so CI must have run on it.
  env.checks(env.tip, [{ name: 'testes', status: 'completed', conclusion: 'success' }]);
  const md1 = commit(env.dir, { 'docs/qa/a.md': '# QA\n' }, 'docs: qa');
  const md2 = commit(env.dir, { [`${ENT}/aceite.md`]: '# Aceite\n' }, 'docs: aceite');
  env.pr(md2, []);
  let r = await check(env);
  assert.equal(r.cond('ci').ok, true, r.cond('ci').detail);
  assert.match(r.cond('ci').detail, new RegExp(env.tip.slice(0, 7)));
  env.checks(env.tip, [{ name: 'testes', status: 'in_progress', conclusion: null }]);
  r = await check(env);
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /ainda rodando/);
  env.checks(env.tip, []);
  r = await check(env);
  assert.equal(r.cond('ci').ok, false, 'no green commit before the Markdown ones');
  assert.match(r.cond('ci').detail, new RegExp(`${env.tip.slice(0, 7)}.*muda código`));
  assert.ok(md1);
  assert.match(readFileSync(join(env.ghDir, 'calls.log'), 'utf8'), /api repos\/\{owner\}\/\{repo\}\/commits\/[0-9a-f]+\/check-runs\?per_page=100/);
  const code = commit(env.dir, { 'src/app.js': 'z\n' }, 'fix');
  env.pr(code, []);
  r = await check(env);
  assert.equal(r.cond('ci').ok, false);
  assert.match(r.cond('ci').detail, /muda código/);
});

test('warning battery.ci_timeout_near with ci_full merge above 70% of the largest timeout-minutes; data always has both numbers', async () => {
  const wf = { '.github/workflows/ci.yml': 'jobs:\n  rapido:\n    timeout-minutes: 5\n  completo:\n    timeout-minutes: 10\n', '.github/workflows/outro.yaml': 'jobs:\n  x:\n    timeout-minutes: 3\n' };
  const env = await setup({ files: wf });
  env.stamp({ seconds: 500 });
  let r = await check(env);
  assert.equal(r.code, 0, 'a warning never blocks');
  assert.deepEqual(r.data.warnings, ['battery.ci_timeout_near']);
  assert.equal(r.data.batterySeconds, 500);
  assert.equal(r.data.ciTimeoutMinutes, 10);
  env.stamp({ seconds: 400 });
  assert.deepEqual((await check(env)).data.warnings, []);
  const manual = await setup({ files: wf, config: `${CONFIG}test_runs:\n  ci_full: manual\n` });
  manual.stamp({ seconds: 500 });
  r = await check(manual);
  assert.deepEqual(r.data.warnings, []);
  assert.equal(r.data.ciTimeoutMinutes, 10);
});

test('usage 64; delivery or branch not found 65', async () => {
  const env = await setup();
  const call = async (argv) => { const { io } = capture(); return main([...argv, '--cwd', env.dir], io); };
  assert.equal(await call(['merge-check', 'ENT-001']), 64);
  assert.equal(await call(['merge-check', 'ENT-1', '--target', 'develop']), 64);
  assert.equal(await call(['merge-check', 'ENT-001', '--target', 'develop', '--pr', 'abc']), 64);
  assert.equal(await call(['merge-check', 'ENT-001', '--target', 'develop', '--pr']), 64);
  assert.equal(await call(['merge-check', 'ENT-002', '--target', 'develop']), 65);
  git(env.dir, 'checkout', '-q', '-b', 'outro');
  git(env.dir, 'branch', '-D', 'baco/ENT-001');
  const { io, out } = capture();
  assert.equal(await main(['merge-check', 'ENT-001', '--target', 'develop', '--cwd', env.dir], io), 65);
  assert.match(out.stderr, /baco\/ENT-001 não existe/);
});
