import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo } from './helpers/tmprepo.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';
import { loadConfig } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { harnessFileChecks, harnessFileProblems } from '../skills/baco-sdd/scripts/lib/harnessfiles.mjs';

// Session-start check of the files each harness needs in the project: Codex's command rules and
// Antigravity's read rules must exist and equal the skill's templates.
const REPO = join(SKILL_ROOT, '..', '..');
const CODEX = join(SKILL_ROOT, 'templates', 'codex', 'baco.rules');
const AGY = join(SKILL_ROOT, 'templates', 'antigravity', 'leitura.json');
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

const project = async (harnesses, files = {}) => {
  const repo = await makeRepo({ '.baco/config.yaml': `language: pt-BR\nharnesses:\n${harnesses}`, ...files });
  temps.push(repo);
  return repo;
};
const place = (repo, rel, from) => {
  mkdirSync(join(repo, rel, '..'), { recursive: true });
  copyFileSync(from, join(repo, rel));
};

test('harnessFileChecks: no harnesses, nothing to check', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n' });
  temps.push(repo);
  assert.deepEqual(harnessFileChecks(repo, loadConfig(repo)), []);
});

test('harnessFileChecks: a codex harness needs .codex/rules/baco.rules equal to the template', async () => {
  const repo = await project('  codex:\n    models: { forte: a }\n  claude-code:\n    models: { forte: b }\n');
  const missing = harnessFileChecks(repo, loadConfig(repo));
  assert.deepEqual(missing, [{ file: '.codex/rules/baco.rules', template: CODEX, harnesses: ['codex'], status: 'missing' }]);
  place(repo, '.codex/rules/baco.rules', CODEX);
  assert.equal(harnessFileChecks(repo, loadConfig(repo))[0].status, 'ok');
  assert.deepEqual(harnessFileProblems(repo, loadConfig(repo)), []);
  writeFileSync(join(repo, '.codex/rules/baco.rules'), `${readFileSync(CODEX, 'utf8')}\n# local\n`);
  assert.equal(harnessFileProblems(repo, loadConfig(repo))[0].status, 'different');
});

test('harnessFileChecks: antigravity by name or by tool, once per file, case-insensitive', async () => {
  const repo = await project('  Antigravity:\n    models: { forte: a }\n  meu-perfil:\n    tool: antigravity\n    models: { forte: b }\n  Codex-CLI:\n    models: { forte: c }\n');
  const checks = harnessFileChecks(repo, loadConfig(repo));
  assert.deepEqual(checks.map((c) => [c.file, c.harnesses, c.status]), [
    ['.baco/antigravity/leitura.json', ['Antigravity', 'meu-perfil'], 'missing'],
    ['.codex/rules/baco.rules', ['Codex-CLI'], 'missing'],
  ]);
  assert.equal(checks[0].template, AGY);
  place(repo, '.baco/antigravity/leitura.json', AGY);
  assert.deepEqual(harnessFileProblems(repo, loadConfig(repo)).map((c) => c.file), ['.codex/rules/baco.rules']);
});

test('harnessFileChecks: a folder where the file should be counts as different, never throws', async () => {
  const repo = await project('  codex:\n    models: { forte: a }\n');
  mkdirSync(join(repo, '.codex', 'rules', 'baco.rules'), { recursive: true });
  assert.equal(harnessFileProblems(repo, loadConfig(repo))[0].status, 'different');
});

// The SessionStart hook turns the problems into a note for the conductor.
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'baco-hf-')); temps.push(d); return d; };
const runStart = (inp) => {
  const state = tmp();
  return spawnSync(process.execPath, [join(REPO, 'hooks', 'baco-context.mjs')], {
    input: JSON.stringify(inp), encoding: 'utf8', env: { ...process.env, TMPDIR: state, HOME: state, CLAUDE_PLUGIN_ROOT: '' },
  });
};
const note = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '');

test('baco-context: a missing or different harness file adds a note to offer copying it now; conductor only', async () => {
  const repo = await project('  codex:\n    models: { forte: a }\n  antigravity:\n    models: { forte: b }\n');
  const r = runStart({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's-hf', cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const text = note(r);
  assert.match(text, /baco-sdd/, 'the usual note stays');
  for (const p of ['.codex/rules/baco.rules', '.baco/antigravity/leitura.json', 'missing', 'offer', CODEX, AGY]) assert.ok(text.includes(p), p);
  const sub = runStart({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's-hf', cwd: repo, agent_id: 'a1' });
  assert.equal(sub.stdout, '', 'a subagent gets nothing');
  place(repo, '.codex/rules/baco.rules', CODEX);
  place(repo, '.baco/antigravity/leitura.json', AGY);
  const ok = note(runStart({ hook_event_name: 'SessionStart', source: 'startup', cwd: repo }));
  assert.ok(ok.includes('baco-sdd') && !ok.includes('.codex/rules/baco.rules'), 'files in place: only the usual note');
});

test('baco-context: an unreadable config still gives the usual note', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'harnesses:\n\tcodex: x\n' });
  temps.push(repo);
  const r = runStart({ hook_event_name: 'SessionStart', source: 'startup', cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  assert.match(note(r), /baco-sdd/);
});
