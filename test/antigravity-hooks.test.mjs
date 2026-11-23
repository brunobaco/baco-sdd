import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmprepo.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';
import { readHookInput, preToolAnswer, contextAnswer, quietAnswer, isAntigravitySubagent } from '../hooks/host.mjs';

// Hook input and output of the Antigravity CLI (1.5.10), as captured from a real session: camelCase
// fields, the tool call in `toolCall` (`write_file`/`edit_file` with `Path`, `run_command` with
// `CommandLine`), a PreToolUse answer that must always carry a `decision` (an empty `{}` denies the
// tool), and context injected as `injectSteps` system messages. A subagent is a conversation of its
// own; its transcript starts with a system message sent by the parent conversation.

const REPO = join(SKILL_ROOT, '..', '..');
const temps = [];
const track = (d) => { temps.push(d); return d; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => track(mkdtempSync(join(tmpdir(), 'baco-agy-')));
const repoWith = async (files) => track(await makeRepo(files));

const hook = (name, input, env = {}) => spawnSync(process.execPath, [join(REPO, 'hooks', `${name}.mjs`), '--host', 'antigravity'], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env },
});
const out = (r) => JSON.parse(r.stdout);

const PARENT = 'ae66ce22-deed-4d42-91c9-e064994090c6';
const mainLine = JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: '<USER_REQUEST>\noi\n</USER_REQUEST>' });
const subLine = JSON.stringify({ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-20T18:54:39Z sender=${PARENT} priority=MESSAGE_PRIORITY_HIGH content=faça a tarefa\n</SYSTEM_MESSAGE>` });
const planner = (input, cacheRead) => JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', model: 'gemini-3.8-flash-low', input_tokens: input, cache_read_tokens: cacheRead, output_tokens: 40 });
function transcript(lines) {
  const file = join(tmp(), 'transcript_full.jsonl');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
const base = (event, cwd, transcriptPath, extra = {}) => ({
  artifactDirectoryPath: '/x/brain/c1', conversationId: 'c1-conv', cwd, hookEventName: event, modelName: 'gemini-3.8-flash-low',
  transcriptPath, workspacePaths: [cwd], ...extra,
});
const tool = (cwd, transcriptPath, name, args) => base('PreToolUse', cwd, transcriptPath, { stepIdx: 2, toolCall: { id: 'call-1', name, args } });

test('host: reads both input formats into the same fields', () => {
  const claude = readHookInput({ hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '/t', cwd: '/w', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1' }, []);
  assert.deepEqual(
    { host: claude.host, event: claude.event, session: claude.session, transcript: claude.transcript, cwd: claude.cwd, tool: claude.tool, command: claude.command, subagent: claude.subagent() },
    { host: 'claude', event: 'PreToolUse', session: 's', transcript: '/t', cwd: '/w', tool: 'Bash', command: 'ls', subagent: true },
  );
  assert.equal(readHookInput({ tool_name: 'Edit', tool_input: { file_path: '/w/a.js' } }, []).filePath, '/w/a.js');
  assert.equal(readHookInput({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/w/n.ipynb' } }, []).filePath, '/w/n.ipynb');
  const agy = readHookInput(tool('/w', '/t', 'edit_file', { Path: '/w/a.js', Target: 'a', Replacement: 'b' }), ['--host', 'antigravity']);
  assert.deepEqual({ host: agy.host, event: agy.event, session: agy.session, tool: agy.tool, filePath: agy.filePath }, { host: 'antigravity', event: 'PreToolUse', session: 'c1-conv', tool: 'edit_file', filePath: '/w/a.js' });
  assert.equal(readHookInput(tool('/w', '/t', 'run_command', { CommandLine: 'echo x' }), ['--host', 'antigravity']).command, 'echo x');
  // The flag decides even when the input is garbage, so the answer is always in the host's format.
  assert.equal(readHookInput(null, ['--host', 'antigravity']).host, 'antigravity');
  assert.equal(readHookInput(null, []).host, 'claude');
});

test('host: answers in each host format', () => {
  assert.equal(preToolAnswer('claude', { deny: false }), '');
  assert.deepEqual(JSON.parse(preToolAnswer('claude', { deny: true, reason: 'r' })), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } });
  // `allow` leaves the permission rules in charge (checked live: a command outside the rules stayed denied).
  assert.deepEqual(JSON.parse(preToolAnswer('antigravity', { deny: false })), { decision: 'allow' });
  assert.deepEqual(JSON.parse(preToolAnswer('antigravity', { deny: true, reason: 'r' })), { decision: 'deny', reason: 'r' });
  assert.deepEqual(JSON.parse(contextAnswer('claude', 'SessionStart', 'n')), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'n' } });
  assert.deepEqual(JSON.parse(contextAnswer('antigravity', 'SessionStart', 'n')), { injectSteps: [{ systemMessage: { systemMessage: 'n' } }] });
  assert.equal(quietAnswer('claude'), '');
  assert.equal(quietAnswer('antigravity'), '{}');
});

test('host: an Antigravity subagent is told by the first line of its transcript', () => {
  assert.equal(isAntigravitySubagent(transcript([subLine, planner(10, 0)])), true);
  assert.equal(isAntigravitySubagent(transcript([mainLine, planner(10, 0)])), false);
  assert.equal(isAntigravitySubagent(join(tmp(), 'missing.jsonl')), false);
  assert.equal(isAntigravitySubagent(transcript(['not json'])), false);
  assert.equal(isAntigravitySubagent(undefined), false);
});

test('branch-guard (antigravity): denies write_file and edit_file on a protected branch, allows elsewhere', async () => {
  const repo = await repoWith({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  const t = transcript([mainLine]);
  for (const [name, args] of [['write_file', { Path: join(repo, 'src/b.js'), Content: 'x' }], ['edit_file', { Path: join(repo, 'src/a.js'), Target: '', Replacement: 'x' }]]) {
    const r = hook('branch-guard', tool(repo, t, name, args));
    assert.equal(r.status, 0);
    assert.equal(out(r).decision, 'deny', name);
    assert.match(out(r).reason, /protegida/);
  }
  const inBaco = hook('branch-guard', tool(repo, t, 'write_file', { Path: join(repo, '.baco/logs/x.md'), Content: 'x' }));
  assert.deepEqual(out(inBaco), { decision: 'allow' });
  execFileSync('git', ['switch', '-q', '-c', 'baco/ENT-001'], { cwd: repo });
  const onDelivery = hook('branch-guard', tool(repo, t, 'write_file', { Path: join(repo, 'src/b.js'), Content: 'x' }));
  assert.deepEqual(out(onDelivery), { decision: 'allow' });
});

test('branch-guard (antigravity): garbage input or an unknown tool still answers allow', () => {
  assert.deepEqual(out(hook('branch-guard', 'not json')), { decision: 'allow' });
  assert.deepEqual(out(hook('branch-guard', tool('/', transcript([mainLine]), 'view_file', { Path: '/etc/hosts' }))), { decision: 'allow' });
});

test('write-guard (antigravity): a subagent redirecting outside the project is denied; the main conversation is not guarded', async () => {
  const repo = await repoWith({ '.baco/config.yaml': 'language: pt-BR\n' });
  const cmd = { CommandLine: 'npm test > ../saida.log', WaitMsBeforeAsync: 5000 };
  const sub = hook('write-guard', tool(repo, transcript([subLine]), 'run_command', cmd));
  assert.equal(out(sub).decision, 'deny');
  assert.match(out(sub).reason, /fora do projeto/);
  const inside = hook('write-guard', tool(repo, transcript([subLine]), 'run_command', { CommandLine: 'npm test > .baco/logs/t.log' }));
  assert.deepEqual(out(inside), { decision: 'allow' });
  const main = hook('write-guard', tool(repo, transcript([mainLine]), 'run_command', cmd));
  assert.deepEqual(out(main), { decision: 'allow' });
  assert.deepEqual(out(hook('write-guard', 'garbage')), { decision: 'allow' });
});

test('context-size (antigravity): warns past the threshold as an injected system message, main conversation only', async () => {
  const repo = await repoWith({ '.baco/config.yaml': 'language: pt-BR\ncontext:\n  handoff_at: 100000\n' });
  const state = tmp();
  const env = { TMPDIR: state, HOME: state };
  const below = hook('context-size', base('PreInvocation', repo, transcript([mainLine, planner(20000, 30000)]), { invocationNum: 3 }), env);
  assert.deepEqual(out(below), {});
  const big = transcript([mainLine, planner(20000, 30000), planner(40000, 90000)]);
  const above = hook('context-size', base('PreInvocation', repo, big, { invocationNum: 4 }), env);
  const steps = out(above).injectSteps;
  assert.equal(steps.length, 1);
  assert.match(steps[0].systemMessage.systemMessage, /about 130000 tokens/);
  assert.match(steps[0].systemMessage.systemMessage, /c1-conv/);
  // Once per step of 100000 tokens, as in Claude Code.
  assert.deepEqual(out(hook('context-size', base('PreInvocation', repo, big, { invocationNum: 5 }), env)), {});
  const sub = hook('context-size', base('PreInvocation', repo, transcript([subLine, planner(40000, 900000)]), { conversationId: 'sub-conv' }), env);
  assert.deepEqual(out(sub), {});
  assert.deepEqual(out(hook('context-size', 'garbage', env)), {});
});

test('baco-context (antigravity): the BACO note at the start of a main conversation, nothing for a subagent or outside a project', async () => {
  const repo = await repoWith({ '.baco/config.yaml': 'language: pt-BR\n' });
  // The hook records the plugin version per conversation under os.tmpdir(): keep it in the test's folder.
  const state = tmp();
  const main = hook('baco-context', base('SessionStart', repo, transcript([mainLine])), { TMPDIR: state, HOME: state });
  assert.match(out(main).injectSteps[0].systemMessage.systemMessage, /BACO-SDD/);
  assert.deepEqual(out(hook('baco-context', base('SessionStart', repo, transcript([subLine])))), {});
  const plain = await repoWith({ 'a.txt': 'x' });
  assert.deepEqual(out(hook('baco-context', base('SessionStart', plain, transcript([mainLine])))), {});
  assert.deepEqual(out(hook('baco-context', 'garbage')), {});
});

test('the Claude Code format is unchanged: no output when allowed', async () => {
  const repo = await repoWith({ '.baco/config.yaml': 'language: pt-BR\n' });
  execFileSync('git', ['switch', '-q', '-c', 'baco/ENT-001'], { cwd: repo });
  const r = spawnSync(process.execPath, [join(REPO, 'hooks', 'branch-guard.mjs')], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: repo, tool_input: { file_path: join(repo, 'a.js') } }), encoding: 'utf8',
  });
  assert.equal(r.stdout, '');
  assert.ok(!existsSync(join(repo, 'a.js')));
  assert.ok(readdirSync(repo).includes('.baco'));
});
