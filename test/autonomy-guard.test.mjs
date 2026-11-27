import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmprepo.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';

// autonomy-guard: while a delivery runs autonomously, the conversation recorded as its conductor
// may not ask a blocking question (AskUserQuestion) nor end its turn; any other conversation, a
// subagent, or a delivery that is not running is left alone.

const REPO = join(SKILL_ROOT, '..', '..');
const HOOK = join(REPO, 'hooks', 'autonomy-guard.mjs');
const temps = [];
const track = (d) => { temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => track(mkdtempSync(join(tmpdir(), 'baco-auto-')));

const CONDUCTOR = '8e82e283-4420-4b7a-a812-36c40c824f9b';
const OTHER = '7151cf53-4f52-4d64-bd8f-caf08a6f0176';
const PROGRESS = 'docs/entregas/ENT-004-exemplo/progresso.md';

const progress = (status, { autonomous = 'sim', conductor = `/portal/?chat=claude%3A${CONDUCTOR}&de=pessoa%40example.com` } = {}) => [
  '# Progresso | ENT-004 `exemplo`', '', '## Retomada', '',
  '- **Atualizado em:** 2026-11-27 11:45',
  `- **Situação:** ${status}`,
  `- **Execução autônoma:** ${autonomous}`,
  `- **Conversa condutora:** ${conductor} (OBT - Construção ENT-004 04)`,
  '- **Próximo passo:** conferir a INT-02', '', '## Instruções da pessoa', '',
].join('\n');

const repoWith = async (status, opts) => track(await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', [PROGRESS]: progress(status, opts) }));

const run = (input, stateDir) => spawnSync(process.execPath, [HOOK], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
  env: { ...process.env, TMPDIR: stateDir, HOME: stateDir },
});
const ask = (cwd, session = CONDUCTOR, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: session, cwd, tool_name: 'AskUserQuestion', tool_input: { questions: [] }, ...extra });
const stop = (cwd, session = CONDUCTOR, extra = {}) => ({ hook_event_name: 'Stop', session_id: session, cwd, stop_hook_active: false, ...extra });
const json = (r) => (r.stdout ? JSON.parse(r.stdout) : null);

test('hooks.json registers autonomy-guard for AskUserQuestion and for Stop', () => {
  const hooks = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const cmd = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/autonomy-guard.mjs"';
  const pre = hooks.PreToolUse.find((e) => e.matcher === 'AskUserQuestion');
  assert.ok(pre, 'a PreToolUse entry for AskUserQuestion');
  assert.equal(pre.hooks[0].command, cmd);
  assert.ok(pre.hooks[0].timeout <= 10);
  assert.ok(Array.isArray(hooks.Stop) && hooks.Stop.some((e) => e.hooks.some((h) => h.command === cmd && h.timeout <= 10)));
});

test('conductor of a running autonomous delivery: AskUserQuestion is denied with the decide-and-go-on rule', async () => {
  const repo = await repoWith('rodando');
  const r = run(ask(repo), tmp());
  assert.equal(r.status, 0);
  const out = json(r).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /ENT-004/);
  assert.match(out.permissionDecisionReason, /decidido pelo agente, conferir no fim/);
  assert.match(out.permissionDecisionReason, /Esperando a pessoa/);
});

test('another conversation in the same project may ask', async () => {
  const repo = await repoWith('rodando');
  assert.equal(run(ask(repo, OTHER), tmp()).stdout, '');
});

test('a delivery that is not running, or not autonomous, does not block the question', async () => {
  for (const [status, autonomous] of [['pronta para testar', 'sim'], ['parado para conversa nova', 'sim'], ['rodando', 'não']]) {
    const repo = await repoWith(status, { autonomous });
    assert.equal(run(ask(repo), tmp()).stdout, '', `${status} / ${autonomous}`);
  }
});

test('conductor of a running delivery: Stop is blocked and told how to end legitimately', async () => {
  const repo = await repoWith('rodando');
  const r = run(stop(repo), tmp());
  assert.equal(r.status, 0);
  const out = json(r);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /ENT-004/);
  assert.match(out.reason, /segundo plano/);
  assert.match(out.reason, /parado para conversa nova/);
  assert.match(out.reason, /parado pela pessoa/);
});

test('Stop is allowed once the conductor changed the situation, and for any other conversation', async () => {
  const repo = await repoWith('rodando');
  assert.equal(run(stop(repo, OTHER), tmp()).stdout, '');
  writeFileSync(join(repo, PROGRESS), progress('parado para conversa nova'));
  assert.equal(run(stop(repo), tmp()).stdout, '');
});

test('Stop gives up after three blocks in a row without progresso.md changing, and starts over when it changes', async () => {
  const repo = await repoWith('rodando');
  const state = tmp();
  const file = join(repo, PROGRESS);
  utimesSync(file, new Date(1000000), new Date(1000000));
  assert.equal(json(run(stop(repo), state)).decision, 'block');
  for (let i = 0; i < 2; i++) assert.equal(json(run(stop(repo, CONDUCTOR, { stop_hook_active: true }), state)).decision, 'block');
  assert.equal(run(stop(repo, CONDUCTOR, { stop_hook_active: true }), state).stdout, '', 'the fourth stop in a row goes through');
  utimesSync(file, new Date(2000000), new Date(2000000));
  assert.equal(json(run(stop(repo, CONDUCTOR, { stop_hook_active: true }), state)).decision, 'block', 'progress made: blocks again');
});

test('inside a subagent the hook stays silent', async () => {
  const repo = await repoWith('rodando');
  assert.equal(run(ask(repo, CONDUCTOR, { agent_id: 'a1' }), tmp()).stdout, '');
});

test('from a task worktree, the main checkout progresso.md decides', async () => {
  const repo = await repoWith('rodando');
  const wt = join(repo, '.worktrees', 'ENT-004-T-001');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'baco/ENT-004-T-001', wt], { cwd: repo });
  // The task branch carries an old copy of progresso.md; the conductor writes the main checkout.
  writeFileSync(join(wt, PROGRESS), progress('pronta para testar'));
  assert.equal(json(run(ask(wt), tmp())).hookSpecificOutput.permissionDecision, 'deny');
});

test('outside a BACO project, or with garbage input, the hook allows and exits 0', () => {
  const plain = tmp();
  for (const input of [ask(plain), stop(plain), 'não é json', '']) {
    const r = run(input, tmp());
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});
