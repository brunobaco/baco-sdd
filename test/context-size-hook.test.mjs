import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { pickAutoCompactWindow, effectiveLimit, AUTO_COMPACT_MARGIN, retomadaReminderDue, openTaskDeliveries } from '../skills/baco-sdd/scripts/lib/hookrules.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmprepo.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';

const REPO = join(SKILL_ROOT, '..', '..');
const HOOK = join(REPO, 'hooks', 'context-size.mjs');
const temps = [];
const track = (d) => { temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

// Each test gets its own TMPDIR, so the hook's state file (under os.tmpdir()) never leaks between tests.
const tmp = () => track(mkdtempSync(join(tmpdir(), 'baco-ctx-')));
const run = (input, stateDir) => spawnSync(process.execPath, [HOOK], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
  // HOME is isolated too: the hook reads `autoCompactWindow` from ~/.claude/settings.json.
  env: { ...process.env, TMPDIR: stateDir, HOME: stateDir, CLAUDE_CONFIG_DIR: '' },
});

const assistant = (input, cacheRead, cacheCreation, extra = {}) => JSON.stringify({
  type: 'assistant', isSidechain: false,
  message: { role: 'assistant', usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation, output_tokens: 10 } },
  ...extra,
});
const userLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } });

function transcript(dir, lines) {
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
const input = (cwd, transcriptPath, session = 'sess-1') => ({ hook_event_name: 'PostToolUse', session_id: session, transcript_path: transcriptPath, cwd, tool_name: 'Read' });
const context = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null);

test('hooks.json registers the context-size hook on PostToolUse', () => {
  const hooks = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const post = hooks.PostToolUse;
  assert.ok(Array.isArray(post) && post.length === 1, 'one PostToolUse entry');
  assert.equal(post[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/context-size.mjs"');
  assert.ok(post[0].hooks[0].timeout <= 10);
  assert.ok(existsSync(HOOK));
});

test('below the threshold: silent', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const t = transcript(tmp(), [userLine, assistant(1000, 300000, 2000)]);
  const r = run(input(repo, t), tmp());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('above the default threshold: warns once with the measured size, as PostToolUse context', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const state = tmp();
  const t = transcript(tmp(), [userLine, assistant(1200, 400000, 3000)]);
  const r = run(input(repo, t), state);
  assert.equal(r.status, 0, r.stderr);
  const out = context(r);
  assert.equal(out.hookEventName, 'PostToolUse');
  assert.match(out.additionalContext, /404200/);
  assert.match(out.additionalContext, /400000/);
  assert.match(out.additionalContext, /baco-sdd/);
  assert.match(out.additionalContext, /Conversation size/);
  assert.match(out.additionalContext, /session sess-1/, 'names this conversation for the new one');
  assert.equal(run(input(repo, t), state).stdout, '', 'same level: no second warning');
});

test('warns again every further 100000 tokens, and again after dropping below and crossing anew', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const state = tmp();
  const dir = tmp();
  const at = (n) => run(input(repo, transcript(dir, [assistant(0, n, 0)])), state);
  assert.ok(context(at(410000)), 'first crossing');
  assert.equal(at(480000).stdout, '', 'still the first step');
  assert.match(context(at(505000)).additionalContext, /505000/, 'second step');
  assert.equal(at(560000).stdout, '');
  assert.equal(at(120000).stdout, '', 'below again (after a compaction): silent, and the count resets');
  assert.ok(context(at(401000)), 'crossing again warns again');
  const other = run(input(repo, transcript(dir, [assistant(0, 401000, 0)]), 'sess-2'), state);
  assert.ok(context(other), 'another session has its own count');
});

// Claude Code sends agent_id only when the hook fires inside a subagent; agent_type alone also
// appears in a main thread started with --agent.
test('inside a subagent (agent_id): silent and the state is not touched', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const state = tmp();
  const t = transcript(tmp(), [assistant(0, 450000, 0)]);
  const sub = run({ ...input(repo, t), agent_id: 'a1b2', agent_type: 'baco:task-reviewer' }, state);
  assert.equal(sub.status, 0, sub.stderr);
  assert.equal(sub.stdout, '');
  assert.ok(context(run(input(repo, t), state)), 'the main conversation still gets its warning');
  assert.ok(context(run({ ...input(repo, t), agent_type: 'baco', session_id: 'sess-agent' }, state)), 'agent_type alone is a main thread');
});

test('the warning is written even when the state cannot be saved; state is per user', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const blocked = join(tmp(), 'not-a-folder');
  writeFileSync(blocked, 'x');
  const t = transcript(tmp(), [assistant(0, 430000, 0)]);
  const r = run(input(repo, t), blocked);
  assert.equal(r.status, 0, r.stderr);
  assert.match(context(r).additionalContext, /430000/);
  const state = tmp();
  run(input(repo, t), state);
  const folders = readdirSync(state);
  assert.equal(folders.length, 1);
  assert.match(folders[0], /^baco-context-size-.+/, 'the folder name carries the user');
});

test('the threshold comes from context.handoff_at, also from a subfolder', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'context:\n  handoff_at: 150000\n', 'src/a.js': '' });
  const t = transcript(tmp(), [assistant(100, 160000, 0)]);
  const r = run(input(join(repo, 'src'), t), tmp());
  assert.match(context(r).additionalContext, /150000/);
});

test('reads the last main-conversation answer: later sidechain lines and lines without usage are skipped', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const t = transcript(tmp(), [
    assistant(0, 450000, 0),
    assistant(0, 10, 0, { isSidechain: true }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant' } }),
    userLine,
    '{ not json',
  ]);
  assert.match(context(run(input(repo, t), tmp())).additionalContext, /450000/);
});

test('a large transcript is read from the end', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(5000) } });
  const t = transcript(tmp(), [assistant(0, 999999, 0), ...Array(400).fill(filler), assistant(0, 420000, 0), ...Array(100).fill(filler)]);
  assert.match(context(run(input(repo, t), tmp())).additionalContext, /420000/);
});

test('fails open: missing transcript, garbage stdin, no transcript path', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  for (const inp of [input(repo, join(tmp(), 'nao-existe.jsonl')), 'not json', '', { cwd: repo, session_id: 's' }, { ...input(repo, 5) }]) {
    const r = run(inp, tmp());
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', JSON.stringify(inp));
  }
});

test('outside a BACO project: silent, even above the threshold', async () => {
  const repo = await makeRepo({ 'src/a.js': '' });
  const t = transcript(tmp(), [assistant(0, 900000, 0)]);
  const r = run(input(repo, t), tmp());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

const runContext = (inp) => spawnSync(process.execPath, [join(REPO, 'hooks', 'baco-context.mjs')], { input: JSON.stringify(inp), encoding: 'utf8' });

test('after a compaction, the context hook asks to re-read the skill, the phase reference and the Retomada', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const compact = JSON.parse(runContext({ hook_event_name: 'SessionStart', source: 'compact', cwd: repo }).stdout).hookSpecificOutput.additionalContext;
  for (const p of ['SKILL.md', 'current phase', '## Retomada']) assert.ok(compact.includes(p), p);
  const startup = JSON.parse(runContext({ hook_event_name: 'SessionStart', source: 'startup', cwd: repo }).stdout).hookSpecificOutput.additionalContext;
  assert.ok(!startup.includes('## Retomada'), 'only after a compaction');
  const plain = await makeRepo({ 'a.js': '' });
  assert.equal(runContext({ hook_event_name: 'SessionStart', source: 'compact', cwd: plain }).stdout, '');
});

test('effectiveLimit: the smaller of handoff_at and 80% of autoCompactWindow minus a safety margin', () => {
  assert.equal(AUTO_COMPACT_MARGIN, 30000);
  // The round D case: handoff_at 400000, window 400000. Auto-compact near 320000; the warning comes 30000 before.
  assert.deepEqual(effectiveLimit(400000, 400000), { limit: 290000, source: 'autoCompactWindow', autoCompactAt: 320000 });
  assert.deepEqual(effectiveLimit(400000, 1000000), { limit: 400000, source: 'config' });
  assert.deepEqual(effectiveLimit(400000, null), { limit: 400000, source: 'config' });
  assert.deepEqual(effectiveLimit(200000, 400000), { limit: 200000, source: 'config' });
  assert.deepEqual(effectiveLimit(400000, 'x'), { limit: 400000, source: 'config' });
  // A handoff_at inside the margin is pulled back too: 310000 would leave less than one large step.
  assert.deepEqual(effectiveLimit(310000, 400000), { limit: 290000, source: 'autoCompactWindow', autoCompactAt: 320000 });
  assert.deepEqual(effectiveLimit(290000, 400000), { limit: 290000, source: 'config' });
  // A tiny window never gives a limit at or below zero: at most half of the auto-compact point is taken off.
  assert.deepEqual(effectiveLimit(400000, 50000), { limit: 20000, source: 'autoCompactWindow', autoCompactAt: 40000 });
});

test('pickAutoCompactWindow: first valid value in the order local, project, user', () => {
  assert.equal(pickAutoCompactWindow([{ autoCompactWindow: 300000 }, { autoCompactWindow: 400000 }, {}]), 300000);
  assert.equal(pickAutoCompactWindow([null, { autoCompactWindow: 'x' }, { autoCompactWindow: 400000 }]), 400000);
  assert.equal(pickAutoCompactWindow([null, {}, {}]), null);
});

test('the hook warns a safety margin before 80% of autoCompactWindow (user settings) and names both sizes', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  const state = tmp();
  mkdirSync(join(state, '.claude'));
  writeFileSync(join(state, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 400000 }));
  assert.equal(run(input(repo, transcript(tmp(), [assistant(0, 285000, 0)])), state).stdout, '', 'below the margin: silent');
  const t = transcript(tmp(), [assistant(0, 300000, 0)]);
  const out = context(run(input(repo, t), state));
  assert.ok(out, 'warns before the auto-compact point, with room for a few steps');
  assert.match(out.additionalContext, /290000/);
  assert.match(out.additionalContext, /320000/);
  assert.match(out.additionalContext, /autoCompactWindow/);
  // Project local settings win over the user's.
  const state2 = tmp();
  mkdirSync(join(state2, '.claude'));
  writeFileSync(join(state2, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: 400000 }));
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'settings.local.json'), JSON.stringify({ autoCompactWindow: 1000000 }));
  assert.equal(run(input(repo, t), state2).stdout, '', 'a larger local window leaves the 400000 default');
});

test('retomadaReminderDue: needs an open task branch, a stale progresso and no recent reminder', () => {
  const now = 10 * 3600 * 1000;
  const min = 60 * 1000;
  const base = { nowMs: now, progressMtimeMs: now - 45 * min, hasOpenTaskBranch: true, lastReminderMs: null };
  assert.equal(retomadaReminderDue(base), true);
  assert.equal(retomadaReminderDue({ ...base, hasOpenTaskBranch: false }), false);
  assert.equal(retomadaReminderDue({ ...base, progressMtimeMs: now - 10 * min }), false);
  assert.equal(retomadaReminderDue({ ...base, lastReminderMs: now - 10 * min }), false, 'throttled');
  assert.equal(retomadaReminderDue({ ...base, lastReminderMs: now - 40 * min }), true);
  assert.equal(retomadaReminderDue({ ...base, progressMtimeMs: NaN }), false);
});

test('openTaskDeliveries: a task branch not merged into its delivery branch', () => {
  const merged = (b) => b === 'baco/ENT-001-T-001';
  assert.deepEqual(openTaskDeliveries(['main', 'baco/ENT-001', 'baco/ENT-001-T-001', 'baco/ENT-001-T-002', 'baco/ENT-001-PROMO'], merged), ['ENT-001']);
  assert.deepEqual(openTaskDeliveries(['baco/ENT-001', 'baco/ENT-001-T-001'], merged), []);
  assert.deepEqual(openTaskDeliveries(['baco/ENT-001-T-002'], () => false), [], 'no delivery branch: nothing to compare');
});

test('openTaskDeliveries: fix tasks FIX-NN and INT-NN count as task branches; PROMO and other names do not', () => {
  const none = () => false;
  assert.deepEqual(openTaskDeliveries(['baco/ENT-002', 'baco/ENT-002-FIX-01'], none), ['ENT-002']);
  assert.deepEqual(openTaskDeliveries(['baco/ENT-003', 'baco/ENT-003-INT-02'], none), ['ENT-003']);
  assert.deepEqual(openTaskDeliveries(['baco/ENT-004', 'baco/ENT-004-PROMO', 'baco/ENT-004-FIX', 'baco/ENT-004-X-01'], none), []);
});

test('the hook reminds to update Retomada when progresso.md is stale and a task branch is open; at most once per 30 minutes', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'docs/entregas/ENT-001-x/progresso.md': '# Progresso\n' });
  const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('branch', 'baco/ENT-001');
  g('switch', '-q', '-c', 'baco/ENT-001-T-001', 'baco/ENT-001');
  writeFileSync(join(repo, 'x.txt'), 'x');
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'task work');
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(join(repo, 'docs/entregas/ENT-001-x/progresso.md'), old, old);
  const state = tmp();
  const t = transcript(tmp(), [assistant(0, 1000, 0)]);
  const first = context(run(input(repo, t), state));
  assert.ok(first, 'reminds');
  assert.match(first.additionalContext, /Retomada/);
  assert.match(first.additionalContext, /ENT-001/);
  assert.equal(run(input(repo, t), state).stdout, '', 'throttled');
  // A fresh progresso.md: no reminder in another session either.
  const now = new Date();
  utimesSync(join(repo, 'docs/entregas/ENT-001-x/progresso.md'), now, now);
  assert.equal(run(input(repo, t, 'sess-2'), state).stdout, '');
});

test('no reminder outside a BACO project or without an open task branch', async () => {
  const plain = await makeRepo({ 'a.js': '' });
  const t = transcript(tmp(), [assistant(0, 1000, 0)]);
  assert.equal(run(input(plain, t), tmp()).stdout, '');
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'docs/entregas/ENT-001-x/progresso.md': '# P\n' });
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(join(repo, 'docs/entregas/ENT-001-x/progresso.md'), old, old);
  assert.equal(run(input(repo, t), tmp()).stdout, '');
});
