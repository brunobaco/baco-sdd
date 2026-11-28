import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, commit } from './helpers/tmprepo.mjs';
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
  for (const [status, autonomous] of [['fim', 'sim'], ['parado para conversa nova', 'sim'], ['rodando', 'não']]) {
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
  // The situations named are the ones of the progresso.md template.
  for (const s of ['parado para conversa nova', 'fim', 'parado por pergunta', 'parado a pedido']) assert.match(out.reason, new RegExp(`"${s}"`));
});

test('Stop is allowed once the conductor changed the situation, and for any other conversation', async () => {
  const repo = await repoWith('rodando');
  assert.equal(run(stop(repo, OTHER), tmp()).stdout, '');
  writeFileSync(join(repo, PROGRESS), progress('parado para conversa nova'));
  assert.equal(run(stop(repo), tmp()).stdout, '');
});

test('Stop gives up after three blocks without a new commit; touching progresso.md is not progress, a commit is', async () => {
  const repo = await repoWith('rodando');
  execFileSync('git', ['branch', 'baco/ENT-004'], { cwd: repo });
  const state = tmp();
  const file = join(repo, PROGRESS);
  assert.equal(json(run(stop(repo), state)).decision, 'block');
  for (let i = 0; i < 2; i++) {
    utimesSync(file, new Date(1000000 * (i + 2)), new Date(1000000 * (i + 2)));
    assert.equal(json(run(stop(repo, CONDUCTOR, { stop_hook_active: true }), state)).decision, 'block');
  }
  utimesSync(file, new Date(9000000), new Date(9000000));
  assert.equal(run(stop(repo, CONDUCTOR, { stop_hook_active: true }), state).stdout, '', 'the fourth stop goes through even with progresso.md touched');
  commit(repo, { 'src/x.js': 'x\n' }, 'ENT-004 T-001: construção');
  execFileSync('git', ['branch', '-f', 'baco/ENT-004-T-001'], { cwd: repo });
  assert.equal(json(run(stop(repo, CONDUCTOR, { stop_hook_active: true }), state)).decision, 'block', 'a new commit on a delivery branch: blocks again');
});

test('Stop gives up after ten blocks in one hour, even with commits in between', async () => {
  const repo = await repoWith('rodando');
  const state = tmp();
  const file = join(state, `baco-context-size-${process.getuid()}`, `${CONDUCTOR}-autonomy-stop.json`);
  mkdirSync(join(state, `baco-context-size-${process.getuid()}`), { recursive: true });
  const now = Date.now();
  writeFileSync(file, JSON.stringify({ key: 'outro', blocks: 0, times: Array.from({ length: 10 }, (_, i) => now - i * 60000) }));
  assert.equal(run(stop(repo), state).stdout, '');
  writeFileSync(file, JSON.stringify({ key: 'outro', blocks: 0, times: Array.from({ length: 10 }, (_, i) => now - 3600000 - i * 60000) }));
  assert.equal(json(run(stop(repo), state)).decision, 'block', 'blocks older than an hour do not count');
});

test('only the first conversation named in "Conversa condutora" is the conductor', async () => {
  const repo = await repoWith('rodando', { conductor: `/portal/?chat=claude%3A${OTHER}&de=x (antes: /portal/?chat=claude%3A${CONDUCTOR}&de=x)` });
  assert.equal(run(stop(repo), tmp()).stdout, '', 'the old conductor ends freely');
  assert.equal(json(run(stop(repo, OTHER), tmp())).decision, 'block');
});

test('a BACO project in a subfolder of a larger repository is found, also from a worktree', async () => {
  const repo = track(await makeRepo({ 'app/.baco/config.yaml': 'language: pt-BR\n', 'app/src/a.js': '', [`app/${PROGRESS}`]: progress('rodando') }));
  assert.equal(json(run(ask(join(repo, 'app')), tmp())).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(json(run(ask(join(repo, 'app', 'src')), tmp())).hookSpecificOutput.permissionDecision, 'deny', 'from a folder below the project');
  const wt = join(repo, 'wt');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'baco/ENT-004-T-002', wt], { cwd: repo });
  writeFileSync(join(wt, 'app', PROGRESS), progress('fim'));
  assert.equal(json(run(ask(join(wt, 'app')), tmp())).hookSpecificOutput.permissionDecision, 'deny');
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

// Antigravity CLI (checked live on 1.5.15): PreToolUse on `ask_question` expects `decision: "deny"`
// or `decision: "allow"` (never empty); Stop expects `decision: "continue"` with `reason`, or `{}`
// to let the turn end, and sends `terminationReason`.
const runAgy = (input, stateDir) => spawnSync(process.execPath, [HOOK, '--host', 'antigravity'], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
  env: { ...process.env, TMPDIR: stateDir, HOME: stateDir },
});
const agyTranscript = (firstLine) => {
  const file = join(tmp(), 'transcript_full.jsonl');
  writeFileSync(file, `${JSON.stringify(firstLine)}\n`);
  return file;
};
const AGY_MAIN = () => agyTranscript({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: '<USER_REQUEST>\nexecutar\n</USER_REQUEST>' });
const AGY_SUB = () => agyTranscript({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-28T10:00:00Z sender=${CONDUCTOR} priority=MESSAGE_PRIORITY_HIGH content=tarefa\n</SYSTEM_MESSAGE>` });
const agyAsk = (cwd, session = CONDUCTOR, transcriptPath = AGY_MAIN()) => ({
  hookEventName: 'PreToolUse', conversationId: session, cwd, transcriptPath,
  toolCall: { id: 'call-1', name: 'ask_question', args: { questions: [] } },
});
const agyStop = (cwd, session = CONDUCTOR, extra = {}, transcriptPath = AGY_MAIN()) => ({
  hookEventName: 'Stop', conversationId: session, cwd, transcriptPath,
  terminationReason: 'NO_TOOL_CALL', continuationActive: false, executionNum: 0, ...extra,
});
const AGY_CONDUCTOR = `/portal/?chat=antigravity%3A${CONDUCTOR}&de=pessoa%40example.com`;

test('antigravity: conductor ask_question is denied; other conversations, stopped deliveries and subagents get allow', async () => {
  const repo = await repoWith('rodando', { conductor: AGY_CONDUCTOR });
  const denied = runAgy(agyAsk(repo), tmp());
  assert.equal(denied.status, 0);
  const out = json(denied);
  assert.equal(out.decision, 'deny');
  assert.match(out.reason, /ENT-004/);
  assert.match(out.reason, /decidido pelo agente, conferir no fim/);
  assert.match(out.reason, /Esperando a pessoa/);
  assert.deepEqual(json(runAgy(agyAsk(repo, OTHER), tmp())), { decision: 'allow' });
  assert.deepEqual(json(runAgy(agyAsk(repo, CONDUCTOR, AGY_SUB()), tmp())), { decision: 'allow' });
  const stopped = await repoWith('fim', { conductor: AGY_CONDUCTOR });
  assert.deepEqual(json(runAgy(agyAsk(stopped), tmp())), { decision: 'allow' });
});

test('antigravity: Stop returns continue on NO_TOOL_CALL and {} on non-normal termination, other sessions, subagents or changed status', async () => {
  const repo = await repoWith('rodando', { conductor: AGY_CONDUCTOR });
  const blocked = runAgy(agyStop(repo), tmp());
  assert.equal(blocked.status, 0);
  const out = json(blocked);
  assert.equal(out.decision, 'continue');
  assert.match(out.reason, /ENT-004/);
  for (const s of ['parado para conversa nova', 'fim', 'parado por pergunta', 'parado a pedido']) assert.match(out.reason, new RegExp(`"${s}"`));
  for (const reason of ['USER_CANCELED', 'ERROR', 'MAX_INVOCATIONS', 'MAX_FORCED_INVOCATIONS', 'MAX_TOKEN_BUDGET_EXCEEDED', 'TERMINAL_CUSTOM_HOOK', 'TERMINAL_STEP_TYPE']) {
    assert.deepEqual(json(runAgy(agyStop(repo, CONDUCTOR, { terminationReason: reason }), tmp())), {}, `must allow Stop on ${reason}`);
  }
  assert.deepEqual(json(runAgy(agyStop(repo, OTHER), tmp())), {});
  assert.deepEqual(json(runAgy(agyStop(repo, CONDUCTOR, {}, AGY_SUB()), tmp())), {});
  writeFileSync(join(repo, PROGRESS), progress('fim', { conductor: AGY_CONDUCTOR }));
  assert.deepEqual(json(runAgy(agyStop(repo), tmp())), {});
});

test('antigravity: Stop respects the three-without-commit loop guard and resets after a commit', async () => {
  const repo = await repoWith('rodando', { conductor: AGY_CONDUCTOR });
  execFileSync('git', ['branch', 'baco/ENT-004'], { cwd: repo });
  const state = tmp();
  for (let i = 0; i < 3; i++) assert.equal(json(runAgy(agyStop(repo, CONDUCTOR, { executionNum: i }), state)).decision, 'continue');
  assert.deepEqual(json(runAgy(agyStop(repo, CONDUCTOR, { executionNum: 3 }), state)), {}, 'fourth stop allowed');
  commit(repo, { 'src/x.js': 'x\n' }, 'ENT-004 T-001: progresso');
  execFileSync('git', ['branch', '-f', 'baco/ENT-004-T-001'], { cwd: repo });
  assert.equal(json(runAgy(agyStop(repo, CONDUCTOR, { executionNum: 4 }), state)).decision, 'continue');
});

test('antigravity: outside a project or with garbage input, fails open in the Antigravity format', () => {
  const plain = tmp();
  assert.deepEqual(json(runAgy(agyAsk(plain), tmp())), { decision: 'allow' });
  assert.deepEqual(json(runAgy(agyStop(plain), tmp())), {});
  for (const bad of ['não é json', '']) {
    const r = runAgy(bad, tmp());
    assert.equal(r.status, 0);
    // `decision: "allow"` fails open for PreToolUse and also allows Stop (only "continue" blocks Stop).
    assert.deepEqual(json(r), { decision: 'allow' });
  }
});
