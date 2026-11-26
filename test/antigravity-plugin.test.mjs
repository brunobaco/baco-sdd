import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildAntigravityPlugin, MARKER } from '../tools/antigravity.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';

const REPO = join(SKILL_ROOT, '..', '..');
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'baco-agy-plugin-')); temps.push(d); return d; };
const build = () => { const dest = join(tmp(), 'baco'); buildAntigravityPlugin({ root: REPO, dest }); return dest; };

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const fm = (text) => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'frontmatter');
  return Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
};
// Tool names checked against the Antigravity CLI 1.5.10; a misspelled one can hang a subagent.
const KNOWN_TOOLS = new Set(['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task']);

test('antigravity plugin: manifest, logo and the parts a native plugin loads', () => {
  const dest = build();
  const manifest = JSON.parse(readFileSync(join(dest, 'plugin.json'), 'utf8'));
  const claude = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'baco');
  assert.equal(manifest.version, claude.version);
  assert.equal(manifest.description, claude.description);
  assert.equal(manifest.logo, 'assets/logo.png');
  assert.ok(existsSync(join(dest, 'assets', 'logo.png')));
  for (const k of Object.keys(manifest)) assert.ok(['name', 'displayName', 'version', 'description', 'author', 'logo'].includes(k), k);
  // What Antigravity warns about or ignores in a plugin is left out.
  for (const n of ['commands', 'CLAUDE.md', 'AGENTS.md', '.claude-plugin', 'test', 'evals', 'tools']) assert.ok(!existsSync(join(dest, n)), n);
  assert.ok(readFileSync(join(dest, 'README.md'), 'utf8').startsWith(MARKER));
});

test('antigravity plugin: one subagent per role, with checked tool names and the role file at an absolute path', () => {
  const dest = build();
  const roles = readdirSync(join(REPO, 'agents')).filter((f) => f.endsWith('.md'));
  const made = readdirSync(join(dest, 'agents')).sort();
  assert.deepEqual(made, roles.map((f) => `baco-${f}`).sort());
  for (const f of made) {
    const text = readFileSync(join(dest, 'agents', f), 'utf8');
    const meta = fm(text);
    assert.equal(meta.name, f.replace(/\.md$/, ''));
    assert.ok(meta.description.length > 20, f);
    assert.equal(meta.subagent, 'true');
    assert.equal(meta.mainAgent, 'false');
    assert.ok(['inherit', 'flash'].includes(meta.model), `${f}: ${meta.model}`);
    const tools = /^\[(.*)\]$/.exec(meta.tools)?.[1].split(',').map((s) => s.trim());
    assert.ok(tools?.length, `${f}: tools is a list`);
    for (const t of tools) assert.ok(KNOWN_TOOLS.has(t), `${f}: ${t}`);
    assert.ok(!tools.includes('invoke_subagent'), f);
    assert.ok(!text.includes('CLAUDE_PLUGIN_ROOT'), f);
    const rolePath = /`([^`]+\/references\/roles\/[a-z-]+\.md)`/.exec(text)?.[1];
    assert.ok(rolePath && rolePath.startsWith(dest), `${f}: role path ${rolePath}`);
    assert.ok(existsSync(rolePath), rolePath);
  }
  const locator = fm(readFileSync(join(dest, 'agents', 'baco-locator.md'), 'utf8'));
  assert.equal(locator.model, 'flash');
  assert.equal(locator.tools, '[read_file, run_command, manage_task]');
  const impl = fm(readFileSync(join(dest, 'agents', 'baco-implementer-risky.md'), 'utf8'));
  assert.equal(impl.tools, '[read_file, run_command, manage_task, edit_file, write_file]');
});

test('antigravity plugin: each command becomes a skill the person calls by name, with links relative to the main skill', () => {
  const dest = build();
  const cmds = readdirSync(join(REPO, 'commands')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  for (const c of cmds) {
    const file = join(dest, 'skills', `baco-${c}`, 'SKILL.md');
    const text = readFileSync(file, 'utf8');
    const meta = fm(text);
    assert.equal(meta.name, `baco-${c}`);
    assert.match(meta.description, new RegExp(`/baco-${c}`));
    assert.ok(!('disable-model-invocation' in meta), 'slash commands do not expand in the CLI 1.5.10: the model loads it by name');
    assert.ok(!text.includes('CLAUDE_PLUGIN_ROOT'), c);
    assert.ok(!text.includes('$ARGUMENTS'), c);
    assert.ok(!/\/baco:/.test(text), c);
    assert.ok(text.includes('](../baco-sdd/SKILL.md)'), c);
    for (const m of text.matchAll(/\]\((\.\.\/baco-sdd\/[^)]+)\)/g)) assert.ok(existsSync(join(dest, 'skills', `baco-${c}`, m[1])), `${c}: ${m[1]}`);
  }
});

test('antigravity plugin: the issue command becomes the skill baco-issue, pointing at the issue flow', () => {
  const dest = build();
  const text = readFileSync(join(dest, 'skills', 'baco-issue', 'SKILL.md'), 'utf8');
  const meta = fm(text);
  assert.equal(meta.name, 'baco-issue');
  assert.match(meta.description, /\/baco-issue/);
  assert.ok(text.includes('[references/issue.md](../baco-sdd/references/issue.md)'), 'link to the issue flow');
  assert.ok(existsSync(join(dest, 'skills', 'baco-sdd', 'references', 'issue.md')));
  for (const p of ['gh issue view', 'gh issue create', 'external data']) assert.ok(text.includes(p), p);
});

test('antigravity plugin: the main skill is copied whole, its commands named the Antigravity way, and fits the 24 KB Antigravity loads', () => {
  const dest = build();
  const src = join(REPO, 'skills', 'baco-sdd');
  for (const f of walk(src)) assert.ok(existsSync(join(dest, 'skills', 'baco-sdd', relative(src, f))), relative(src, f));
  for (const f of walk(join(dest, 'skills', 'baco-sdd')).filter((p) => p.endsWith('.md'))) assert.ok(!/\/baco:[a-z]/.test(readFileSync(f, 'utf8')), f);
  const body = readFileSync(join(dest, 'skills', 'baco-sdd', 'SKILL.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.ok(Buffer.byteLength(body) <= 24000, `SKILL.md body is ${Buffer.byteLength(body)} bytes; Antigravity loads only the first 24000`);
});

test('antigravity plugin: hooks in the Antigravity format, run from the plugin folder with --host antigravity', () => {
  const dest = build();
  const hooks = JSON.parse(readFileSync(join(dest, 'hooks.json'), 'utf8')).baco;
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'SessionStart']);
  const commands = [
    ...hooks.SessionStart.map((h) => h.command), ...hooks.PreInvocation.map((h) => h.command),
    ...hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command)),
    ...hooks.PostToolUse.flatMap((g) => g.hooks.map((h) => h.command)),
  ];
  for (const c of commands) {
    const m = /^node \.\/(hooks\/[a-z-]+\.mjs) --host antigravity$/.exec(c);
    assert.ok(m, c);
    assert.ok(existsSync(join(dest, m[1])), m[1]);
  }
  assert.match(hooks.PreToolUse[0].matcher, /write_file/);
  assert.match(hooks.PreToolUse[0].matcher, /edit_file/);
  assert.equal(hooks.PreToolUse[1].matcher, 'run_command');
  assert.ok(existsSync(join(dest, 'hooks', 'host.mjs')));
  assert.ok(!existsSync(join(dest, 'hooks', 'hooks.json')), 'only the root hooks.json is read by a native plugin');
  // The hooks import the engine from the copied skill, so they run from the plugin folder.
  const r = spawnSync(process.execPath, [join(dest, 'hooks', 'branch-guard.mjs'), '--host', 'antigravity'], { input: 'garbage', encoding: 'utf8', cwd: dest });
  assert.deepEqual(JSON.parse(r.stdout), { decision: 'allow' });
});

test('antigravity plugin: rebuilds its own folder, refuses to overwrite anything else', () => {
  const dest = build();
  writeFileSync(join(dest, 'agents', 'old-role.md'), 'x');
  buildAntigravityPlugin({ root: REPO, dest });
  assert.ok(!existsSync(join(dest, 'agents', 'old-role.md')), 'a rebuild starts clean');
  const other = join(tmp(), 'someone-else');
  mkdirSync(other);
  writeFileSync(join(other, 'plugin.json'), '{"name":"other"}');
  assert.throws(() => buildAntigravityPlugin({ root: REPO, dest: other }), /não foi gerada pelo BACO/);
  assert.equal(readFileSync(join(other, 'plugin.json'), 'utf8'), '{"name":"other"}');
});
