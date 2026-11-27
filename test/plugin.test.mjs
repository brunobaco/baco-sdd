import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readdirSync, realpathSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { makeRepo } from './helpers/tmprepo.mjs';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { DEFAULTS } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { SKILL_ROOT, SOURCE_NAME_RE, frontmatter, read, bacoMentions } from './helpers/content.mjs';
import { COMMANDS as ENGINE_COMMANDS } from '../skills/baco-sdd/scripts/baco.mjs';

const REPO = join(SKILL_ROOT, '..', '..');
const resolvePluginPath = (p) => p.replace('${CLAUDE_PLUGIN_ROOT}', REPO);
const list = (s) => String(s ?? '').split(/,\s*/).filter(Boolean);
const bodyLines = (body) => body.trim().split('\n').length;

const AGENTS = {
  'cold-reader': { role: 'cold-reader.md', model: 'sonnet', effort: 'medium', set: 'report' },
  'spec-auditor': { role: 'spec-auditor.md', model: 'opus', effort: 'high', set: 'report' },
  architect: { role: 'architect.md', model: 'opus', effort: 'high', set: 'report' },
  simplifier: { role: 'simplifier.md', model: 'sonnet', effort: 'high', set: 'report' },
  'devils-advocate': { role: 'devils-advocate.md', model: 'opus', effort: 'medium', set: 'report' },
  planner: { role: 'planner.md', model: 'opus', effort: 'medium', set: 'edit' },
  publisher: { role: 'publisher.md', model: 'haiku', effort: 'low', set: 'edit' },
  'implementer-mechanical': { role: 'implementer.md', model: 'haiku', effort: 'low', set: 'edit' },
  'implementer-standard': { role: 'implementer.md', model: 'sonnet', effort: 'medium', set: 'edit' },
  'implementer-risky': { role: 'implementer.md', model: 'opus', effort: 'medium', set: 'edit' },
  'task-reviewer': { role: 'task-reviewer.md', model: 'sonnet', effort: 'high', set: 'report' },
  'final-reviewer': { role: 'final-reviewer.md', model: 'opus', effort: 'high', set: 'report' },
  'ci-triage': { role: 'ci-triage.md', model: 'sonnet', effort: 'medium', set: 'report' },
  'acceptance-validator': { role: 'acceptance-validator.md', model: 'sonnet', effort: 'medium', set: 'report' },
  writer: { role: 'writer.md', model: 'haiku', effort: 'low', set: 'edit' },
  reconciler: { role: 'reconciler.md', model: 'opus', effort: 'medium', set: 'edit' },
  locator: { role: 'locator.md', model: 'haiku', effort: 'low', set: 'read' },
  'pr-reviewer': { role: 'pr-reviewer.md', model: 'opus', effort: 'high', set: 'report' },
};

const LEVEL_MODEL = { forte: 'opus', medio: 'sonnet', leve: 'haiku' };
const EFFORT_EN = { alto: 'high', medio: 'medium', baixo: 'low' };

const roleHeader = (file) => Object.fromEntries(
  read(join(SKILL_ROOT, 'references', 'roles', file)).split('\n').slice(1, 5)
    .map((l) => /^- (\w+): (.+)$/.exec(l)).filter(Boolean).map(([, k, v]) => [k.toLowerCase(), v.trim()]),
);

test('one agent per role, frontmatter matches the role header', () => {
  const files = readdirSync(join(REPO, 'agents')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, Object.keys(AGENTS).map((n) => `${n}.md`).sort());
  for (const [name, a] of Object.entries(AGENTS)) {
    const { data, body } = frontmatter(read(join(REPO, 'agents', `${name}.md`)));
    assert.equal(data.name, name);
    assert.ok(data.description?.length > 20, `${name}: description`);
    assert.equal(data.model, a.model, `${name}: model`);
    assert.equal(data.effort, a.effort, `${name}: effort`);
    const h = roleHeader(a.role);
    if (h.level !== 'per-task') {
      assert.equal(data.model, LEVEL_MODEL[h.level], `${name}: model vs role level`);
      assert.equal(data.effort, EFFORT_EN[h.effort], `${name}: effort vs role`);
    }
    assert.ok(list(data.disallowedTools).includes('Agent'), `${name}: may spawn agents`);
    const canEdit = list(data.tools).includes('Edit');
    const canWrite = list(data.tools).includes('Write');
    assert.equal(canEdit, a.set === 'edit', `${name}: tool set`);
    assert.equal(canWrite, a.set !== 'read', `${name}: write tool`);
    assert.equal(h.tools, a.set === 'read' ? 'read-only' : a.set, `${name}: tool set vs role header`);
    if (!canEdit) for (const t of ['Edit', 'NotebookEdit']) assert.ok(list(data.disallowedTools).includes(t), `${name}: ${t} not denied`);
    if (!canWrite) assert.ok(list(data.disallowedTools).includes('Write'), `${name}: Write not denied`);
    if (a.set === 'report') {
      assert.ok(!list(data.disallowedTools).includes('Write'), `${name}: Write must not be denied`);
      assert.ok(body.includes('Use Write only for that report file') && body.includes('`git status`'), `${name}: write limited to the report`);
    }
    const ref = `\${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/roles/${a.role}`;
    assert.ok(body.includes(ref), `${name}: must point to ${a.role}`);
    assert.ok(existsSync(resolvePluginPath(ref)), `${name}: ${a.role} missing`);
    assert.ok(bodyLines(body) <= 25, `${name}: body too long`);
  }
});

test('scratch copy: the task and final reviewers and the acceptance validator may create one and run commands in it, role and wrapper agree; no other review agent may', () => {
  for (const name of Object.keys(AGENTS)) {
    const { body } = frontmatter(read(join(REPO, 'agents', `${name}.md`)));
    const scratch = ['task-reviewer', 'final-reviewer', 'acceptance-validator'].includes(name);
    assert.equal(body.includes('git worktree add --detach .worktrees/copia-'), scratch, `${name}: scratch copy exception in the wrapper`);
    if (!scratch) continue;
    const role = read(join(REPO, 'skills', 'baco-sdd', 'references', 'roles', AGENTS[name].role));
    assert.ok(role.includes('git worktree add --detach .worktrees/copia-'), `${name}: scratch copy in the role`);
    assert.ok(!role.includes('it is the only file you touch'), `${name}: output contract allows the scratch copy`);
  }
});

test('implementer agents match DEFAULTS.models', () => {
  // The config speaks of levels; Claude Code agent files must name a model and an effort.
  const model = { forte: 'opus', medio: 'sonnet', leve: 'haiku' };
  const effort = { alto: 'high', medio: 'medium', baixo: 'low' };
  for (const cls of ['mechanical', 'standard', 'risky']) {
    const { data } = frontmatter(read(join(REPO, 'agents', `implementer-${cls}.md`)));
    assert.equal(data.model, model[DEFAULTS.models[cls].level], cls);
    assert.equal(data.effort, effort[DEFAULTS.models[cls].effort], cls);
  }
});

test('no source-method name in plugin layer', () => {
  for (const dir of ['agents', 'commands', 'hooks']) {
    if (!existsSync(join(REPO, dir))) continue;
    for (const f of readdirSync(join(REPO, dir))) assert.ok(!SOURCE_NAME_RE.test(read(join(REPO, dir, f))), `${dir}/${f}`);
  }
});

const runGuard = (input) => spawnSync('node', [join(REPO, 'hooks', 'branch-guard.mjs')], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
});
const edit = (repo, rel) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: repo, tool_input: { file_path: join(repo, rel) } });
const denied = (r) => r.status === 0 && r.stdout !== '' && JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === 'deny';

test('hooks.json wires the guard on Edit|Write|NotebookEdit', () => {
  const all = JSON.parse(read(join(REPO, 'hooks', 'hooks.json'))).hooks;
  assert.deepEqual(Object.keys(all).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'], 'PreToolUse + PostToolUse + SessionStart + Stop');
  const h = all.PreToolUse;
  assert.equal(h.length, 3, 'the branch guard, the Bash write guard (write-guard.test.mjs) and the autonomy guard (autonomy-guard.test.mjs)');
  assert.equal(h[0].matcher, 'Edit|Write|NotebookEdit');
  assert.equal(h[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/branch-guard.mjs"');
  assert.equal(h[0].hooks[0].timeout, 10);
});

test('guard denies on a protected branch of a BACO repo', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  const r = runGuard(edit(repo, 'src/a.js'));
  assert.ok(denied(r), r.stdout + r.stderr);
  const reason = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(reason.hookEventName, 'PreToolUse');
  assert.match(reason.permissionDecisionReason, /"main"/);
  assert.ok(denied(runGuard({ ...edit(repo, 'x'), tool_name: 'NotebookEdit', tool_input: { notebook_path: join(repo, 'n.ipynb') } })), 'NotebookEdit');
});

test('guard allows a feature branch, .baco/ files, non-BACO repos, outside paths', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  assert.equal(runGuard(edit(repo, '.baco/config.yaml')).stdout, '', '.baco/ on main');
  const plain = await makeRepo({ 'a.js': '' });
  assert.equal(runGuard(edit(plain, 'a.js')).stdout, '', 'repo without .baco');
  const loose = realpathSync(makeTempDirSync('baco-loose-'));
  assert.equal(runGuard(edit(loose, 'loose.txt')).stdout, '', 'outside any repo');
  execFileSync('git', ['checkout', '-q', '-b', 'baco/ENT-001'], { cwd: repo });
  assert.equal(runGuard(edit(repo, 'src/a.js')).stdout, '', 'delivery branch');
  assert.equal(runGuard({ ...edit(repo, 'novo/pasta/b.js'), tool_name: 'Write' }).stdout, '', 'new folder on branch');
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo });
  assert.ok(denied(runGuard({ ...edit(repo, 'novo/pasta/b.js'), tool_name: 'Write' })), 'new folder on main must be denied');
});

test('guard reads the protected list from the project config', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'branches:\n  protected: [trunk]\n', 'a.js': '' });
  execFileSync('git', ['checkout', '-q', '-b', 'feature/x'], { cwd: repo });
  assert.equal(runGuard(edit(repo, 'a.js')).stdout, '', 'unlisted branch is free');
  execFileSync('git', ['checkout', '-q', '-b', 'trunk'], { cwd: repo });
  assert.ok(denied(runGuard(edit(repo, 'a.js'))));
});

test('guard denies Write and Edit on aprovacao-plano.md and dispensa-revisao-externa.md even on a delivery branch', async () => {
  const repo = await makeRepo({
    '.baco/config.yaml': 'language: pt-BR\n',
    'docs/entregas/ENT-001-teste/plano.md': '# Plano\n',
  });
  execFileSync('git', ['checkout', '-q', '-b', 'baco/ENT-001'], { cwd: repo });
  for (const rel of [
    'docs/entregas/ENT-001-teste/aprovacao-plano.md',
    'docs/entregas/ENT-001-teste/revisao/dispensa-revisao-externa.md',
  ]) {
    for (const tool_name of ['Edit', 'Write']) {
      const r = runGuard({ ...edit(repo, rel), tool_name });
      assert.ok(denied(r), `${tool_name} on ${rel} must be denied`);
      const out = JSON.parse(r.stdout).hookSpecificOutput;
      assert.match(out.permissionDecisionReason, /motor|baco approve-plan|baco waive-review/i);
    }
  }
  // A symlink pointing at aprovacao-plano.md is also denied
  mkdirSync(join(repo, 'tmp'), { recursive: true });
  symlinkSync(join(repo, 'docs/entregas/ENT-001-teste/aprovacao-plano.md'), join(repo, 'tmp/link.md'));
  assert.ok(denied(runGuard({ ...edit(repo, 'tmp/link.md'), tool_name: 'Write' })), 'symlink to aprovacao-plano.md must be denied');
  // Normal delivery files on the delivery branch remain allowed
  assert.equal(runGuard(edit(repo, 'docs/entregas/ENT-001-teste/plano.md')).stdout, '');
});

test('guard: phase 0 setup writes go on baco/configuracao, since the integration branch is protected too', async () => {
  const repo = await makeRepo({ 'a.js': '' });
  const git = (...a) => execFileSync('git', a, { cwd: repo });
  git('branch', 'develop');
  git('switch', '-q', '-c', 'baco/configuracao', 'develop');
  const setup = ['.gitignore', '.claude/settings.local.json', '.baco/config.yaml'];
  for (const f of setup) assert.equal(runGuard({ ...edit(repo, f), tool_name: 'Write' }).stdout, '', `${f} before the config exists`);
  mkdirSync(join(repo, '.baco'), { recursive: true });
  writeFileSync(join(repo, '.baco', 'config.yaml'), 'language: pt-BR\n');
  for (const f of setup) assert.equal(runGuard({ ...edit(repo, f), tool_name: 'Write' }).stdout, '', `${f} on baco/configuracao after the config exists`);
  git('switch', '-q', 'develop');
  assert.ok(denied(runGuard({ ...edit(repo, '.claude/settings.local.json'), tool_name: 'Write' })), 'settings on develop is denied once the config exists');
  assert.ok(denied(runGuard({ ...edit(repo, '.gitignore'), tool_name: 'Write' })), '.gitignore on develop is denied once the config exists');
});

test('phase 0 setup order is the same in SKILL.md, configure.md and /baco:configurar', () => {
  const skill = read(join(REPO, 'skills', 'baco-sdd', 'SKILL.md'));
  const conf = read(join(REPO, 'skills', 'baco-sdd', 'references', 'configure.md'));
  const cmd = read(join(REPO, 'commands', 'configurar.md'));
  for (const [name, text] of [['SKILL.md', skill], ['configure.md', conf], ['configurar.md', cmd]]) {
    assert.ok(text.includes('`baco/configuracao`'), `${name}: setup branch baco/configuracao`);
  }
  assert.ok(!conf.includes('integration branch exists and is checked out, so the writes do not land on a protected branch'), 'configure.md: no writes on the integration branch');
  assert.match(conf, /git merge --no-ff baco\/configuracao/);
});

test('guard fails open on bad input', () => {
  for (const bad of ['not json', '{}', JSON.stringify({ tool_input: {} }), JSON.stringify({ tool_input: { file_path: 42 } })]) {
    const r = runGuard(bad);
    assert.equal(r.status, 0, bad);
    assert.equal(r.stdout, '', bad);
  }
});

const COMMANDS = {
  configurar: 'references/configure.md', iniciar: 'references/project-bootstrap.md', spec: 'SKILL.md',
  arquitetura: 'references/architecture.md', plano: 'references/planning.md', publicar: 'references/task-publication.md',
  executar: 'references/implementation.md', revisar: 'references/review.md', entregar: 'references/delivery.md',
  reconciliar: 'references/reconciliation.md', status: 'SKILL.md', 'roteiro-negocio': 'references/delivery.md',
  issue: 'references/issue.md',
};

test('one command per phase plus status, each pointing to the core', () => {
  const files = readdirSync(join(REPO, 'commands')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, Object.keys(COMMANDS).map((c) => `${c}.md`).sort());
  for (const [cmd, target] of Object.entries(COMMANDS)) {
    const md = read(join(REPO, 'commands', `${cmd}.md`));
    const { data, body } = frontmatter(md);
    assert.ok(data.description && !/\b(the|run|phase)\b/i.test(data.description), `${cmd}: description must be pt-BR`);
    assert.ok(data['argument-hint'], `${cmd}: argument-hint`);
    assert.equal(data['disable-model-invocation'], 'true', `${cmd}: must not load for the model`);
    for (const p of ['${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md', `\${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/${target}`]) {
      assert.ok(body.includes(p), `${cmd}: missing ${p}`);
      assert.ok(existsSync(resolvePluginPath(p)), `${cmd}: ${p} does not exist`);
    }
    assert.ok(body.includes('$ARGUMENTS'), `${cmd}: user text not passed`);
    assert.ok(bodyLines(body) <= 25, `${cmd}: body too long`);
    for (const c of bacoMentions(md)) assert.ok(ENGINE_COMMANDS.includes(c), `${cmd}: unknown "baco ${c}"`);
  }
});

test('README explains install, local test and every command', () => {
  const md = read(join(REPO, 'README.md'));
  for (const p of ['/plugin install baco --marketplace', '/plugin install baco@baco-sdd', 'claude --plugin-dir', '.baco/config.yaml']) assert.ok(md.includes(p), `README: "${p}" missing`);
  for (const c of Object.keys(COMMANDS)) assert.ok(md.includes(`/baco:${c}`), `README: /baco:${c} missing`);
});

test('status with no arguments reports, it does not ask', () => {
  const body = frontmatter(read(join(REPO, 'commands', 'status.md'))).body;
  assert.ok(!body.includes('If the request is empty, ask'), 'status must not ask on empty input');
  assert.ok(body.includes('If the request is empty, report the whole project'), 'status: empty-request rule missing');
});

test('read access to the plugin folder is explained where the user meets it', () => {
  const RULE = 'Read(~/.claude/plugins/cache/baco-sdd/**)';
  assert.ok(read(join(REPO, 'README.md')).includes(RULE), 'README: rule missing');
  assert.ok(read(join(REPO, 'README.md')).includes('--add-dir'), 'README: local test needs --add-dir');
  assert.ok(read(join(SKILL_ROOT, 'SKILL.md')).includes(RULE), 'SKILL.md startup: rule missing');
  const conf = frontmatter(read(join(REPO, 'commands', 'configurar.md'))).body;
  assert.ok(conf.includes(RULE) && conf.includes('ask'), 'configurar: must offer the rule with consent');
});

test('final review: agents stop when their role file is unreadable', () => {
  for (const name of Object.keys(AGENTS)) {
    const body = frontmatter(read(join(REPO, 'agents', `${name}.md`))).body;
    assert.ok(body.includes('If you cannot read the role file, stop and return only'), `${name}: no stop rule`);
  }
});

test('final review: invalid config keeps the default protection', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'branches:\n  protected: [main\n', 'a.js': '' });
  assert.ok(denied(runGuard(edit(repo, 'a.js'))), 'invalid config must not turn protection off');
});

test('final review: core dispatch and permission text are exact and conditional', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  assert.ok(skill.includes('`models.<class>`'), 'SKILL.md: must name models.<class>');
  const check = skill.slice(skill.indexOf('**Skill files.**'), skill.indexOf('7. **State.**'));
  assert.ok(check.indexOf('In Claude Code with the `baco` plugin') >= 0 && check.indexOf('In Claude Code with the `baco` plugin') < check.indexOf('Read(~/.claude'), 'check 4: remedy must be conditional');
});

test('Plan 3 leftovers: effort passed per call, no-commit repo, symlink in .baco, engine permission, publisher header', () => {
  const skill = read(join(SKILL_ROOT, 'SKILL.md'));
  assert.ok(skill.includes('pass both the model and the effort in every call'), 'SKILL.md: effort passed per call');
  assert.ok(!skill.includes('keeps the agent'), 'SKILL.md: old effort notice must be gone');
  const fresh = realpathSync(makeTempDirSync('baco-nocommit-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fresh });
  mkdirSync(join(fresh, '.baco'));
  writeFileSync(join(fresh, '.baco', 'config.yaml'), 'language: pt-BR\n');
  assert.ok(denied(runGuard(edit(fresh, 'a.js'))), 'repo with no commit must still be guarded');
  mkdirSync(join(fresh, 'src'));
  writeFileSync(join(fresh, 'src', 'app.js'), '');
  symlinkSync('../src/app.js', join(fresh, '.baco', 'link.js'));
  assert.ok(denied(runGuard(edit(fresh, '.baco/link.js'))), 'symlink out of .baco/ must not be exempt');
  const md = read(join(REPO, 'README.md'));
  const first = md.slice(md.indexOf('Primeiro uso'));
  assert.ok(first.includes('baco.mjs') && first.includes('node'), 'README: engine permission');
  assert.match(first, /pede (uma vez )?permissão para rodar o motor|pergunta uma vez/, 'README: asked once');
  assert.match(read(join(SKILL_ROOT, 'references', 'roles', 'publisher.md')), /^- Tools: edit$/m);
});

const runContext = (input) => spawnSync('node', [join(REPO, 'hooks', 'baco-context.mjs')], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
});

test('hooks.json registers the SessionStart context hook', () => {
  const h = JSON.parse(read(join(REPO, 'hooks', 'hooks.json'))).hooks.SessionStart;
  assert.equal(h.length, 1);
  assert.equal(h[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/baco-context.mjs"');
  assert.ok(existsSync(join(REPO, 'hooks', 'baco-context.mjs')));
});

test('context hook announces BACO in a BACO repo, also from a subfolder', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  for (const cwd of [repo, join(repo, 'src')]) {
    const r = runContext({ hook_event_name: 'SessionStart', cwd });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.hookEventName, 'SessionStart');
    assert.match(out.additionalContext, /baco-sdd/);
    assert.match(out.additionalContext, /CA-\*/);
  }
});

test('context hook is silent without .baco/config.yaml', async () => {
  const repo = await makeRepo({ 'src/a.js': '' });
  const r = runContext({ hook_event_name: 'SessionStart', cwd: repo });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('context hook fails open on garbage stdin', () => {
  for (const input of ['not json', '', '{"cwd": 5}']) {
    const r = runContext(input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "", `stdout silencioso para ${JSON.stringify(input)}`);
  }
});

test('guard: a dangling symlink in .baco/ is judged by its target, and fails open when unreadable', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  symlinkSync('../src/novo.js', join(repo, '.baco', 'solto.js')); // target does not exist yet
  assert.ok(denied(runGuard(edit(repo, '.baco/solto.js'))), 'dangling link pointing out of .baco/ must not be exempt');
  symlinkSync('nota.md', join(repo, '.baco', 'ok.md')); // dangling, but inside .baco/
  assert.equal(runGuard(edit(repo, '.baco/ok.md')).stdout, '', 'dangling link inside .baco/ stays exempt');
  symlinkSync('volta', join(repo, '.baco', 'ciclo')); // loop: cannot be resolved
  symlinkSync('ciclo', join(repo, '.baco', 'volta'));
  assert.equal(runGuard(edit(repo, '.baco/ciclo')).status, 0, 'a link loop must not crash the guard');
});
