import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellWrites } from '../skills/baco-sdd/scripts/lib/shellwrites.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';
import { SKILL_ROOT } from './helpers/content.mjs';

const REPO = join(SKILL_ROOT, '..', '..');
const HOOK = join(REPO, 'hooks', 'write-guard.mjs');
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

const targets = (cmd) => shellWrites(cmd).targets.map((t) => t.value);

test('shellWrites: redirection targets, appends, both streams and tee', () => {
  assert.deepEqual(targets('npm test > ../a.log'), ['../a.log']);
  assert.deepEqual(targets('npm test >>../a.log 2>&1'), ['../a.log']);
  assert.deepEqual(targets('npm test 2> err.txt'), ['err.txt']);
  assert.deepEqual(targets('npm test &> /tmp/all.log'), ['/tmp/all.log']);
  assert.deepEqual(targets('npm test >| out.txt; echo x >& both.txt'), ['out.txt', 'both.txt']);
  assert.deepEqual(targets('npm test 2>&1 | tee -a ../run.log | tail -5'), ['../run.log']);
  assert.deepEqual(targets('npm test | sudo tee one.log two.log'), ['one.log', 'two.log']);
  assert.deepEqual(targets("echo ok > '../with space.log'"), ['../with space.log']);
  assert.deepEqual(targets('x=$(npm test > ../sub.log)'), ['../sub.log']);
});

test('shellWrites: no false targets from quotes, fd copies, comparisons and heredoc bodies', () => {
  assert.deepEqual(targets('npm test 2>&1 | tail -15'), []);
  assert.deepEqual(targets('cmd >&2; cmd 1>&-'), []);
  assert.deepEqual(targets(`node -e "if (a > b) console.log('>../x')"`), []);
  assert.deepEqual(targets("grep -n '=>' src/a.js"), []);
  assert.deepEqual(targets('echo a \\> b'), []);
  assert.deepEqual(targets('[[ $a > $b ]] && echo y'), []);
  assert.deepEqual(targets('echo $(( 3 > 2 )); (( n > 1 )) && echo z'), []);
  assert.deepEqual(targets("git commit -F - <<'EOF'\nfeat: a > b\n<p>../x</p> > ../y\nEOF\ngit log -1"), []);
  assert.deepEqual(targets('cat <<EOF > out.md\nline > ../no\nEOF'), ['out.md']);
  assert.deepEqual(targets('diff <(sort a) <(sort b) && tee >(cat) < in.txt'), []);
  assert.deepEqual(targets('npm test # > ../x\necho a#b > in.txt'), ['in.txt']);
});

test('shellWrites: only targets after a change of directory are marked as such', () => {
  assert.deepEqual(shellWrites('cd .. && ls > a.log').targets.map((t) => t.afterCd), [true]);
  assert.deepEqual(shellWrites('ls > a.log').targets.map((t) => t.afterCd), [false]);
  assert.deepEqual(shellWrites('echo ok > ../outside.log; cd . ; ls > b.log').targets.map((t) => [t.value, t.afterCd]), [['../outside.log', false], ['b.log', true]]);
  assert.deepEqual(shellWrites('env -C /x tee a.log').targets.map((t) => t.afterCd), [true], 'env -C changes the folder of tee');
  // Round 2: a cd in a substitution or subshell stays there; env -C and sudo -D change only the wrapped program's folder.
  const after = (cmd) => shellWrites(cmd).targets.map((t) => [t.value, t.afterCd]);
  assert.deepEqual(after('v="$(cd src && pwd)"; npm test > ../outside.log'), [['../outside.log', false]]);
  assert.deepEqual(after('v=$(cd src; ls > in.log); (cd src; ls > b.log); npm test > ../o.log'), [['in.log', true], ['b.log', true], ['../o.log', false]]);
  assert.deepEqual(after('env -C /tmp npm test > ../outside.log'), [['../outside.log', false]]);
  assert.deepEqual(after('env -C /tmp pwd; npm test > ../outside.log'), [['../outside.log', false]]);
  assert.deepEqual(after('sudo -D /tmp tee a.log > ../b.log'), [['a.log', true], ['../b.log', false]]);
});

// PR review of the round D fixes.
test('shellWrites: substitutions in double quotes and backticks, <> and wrappers with options', () => {
  assert.deepEqual(targets('echo "$(echo ok > ../outside.log)"'), ['../outside.log']);
  assert.deepEqual(targets('echo "`echo ok > ../b.log`" `date > ../c.log`'), ['../b.log', '../c.log']);
  assert.deepEqual(targets('exec 3<> ../rw.log; cat <> ../rw2.log'), ['../rw.log', '../rw2.log']);
  assert.deepEqual(targets('npm test | timeout 30 tee ../x'), ['../x']);
  assert.deepEqual(targets('npm test | timeout -s KILL 30 tee ../x'), ['../x']);
  assert.deepEqual(targets('npm test | env -i FOO=1 tee ../x'), ['../x']);
  assert.deepEqual(targets('npm test | sudo -u nobody tee ../x'), ['../x']);
  assert.deepEqual(targets('npm test | nice -n 5 stdbuf -o L tee ../x'), ['../x']);
  assert.deepEqual(targets('ls | xargs -I {} tee ../x'), ['../x']);
  assert.deepEqual(targets('command tee ../x; nohup tee ../y'), ['../x', '../y']);
  assert.deepEqual(targets('timeout 30 npm test 2>&1 | tail -5'), [], 'a wrapper does not turn the command into tee');
});

test('shellWrites: quoting is kept per target', () => {
  const [lit] = shellWrites("echo > '../report[1].log'").targets;
  assert.deepEqual([lit.value, lit.glob, lit.expands, lit.tilde], ['../report[1].log', false, false, false]);
  const [home] = shellWrites('echo > "~/file"').targets;
  assert.equal(home.tilde, false, 'a quoted ~ is a literal name');
  assert.equal(shellWrites('echo > ~/file').targets[0].tilde, true);
  assert.equal(shellWrites('echo > "$OUT/x"').targets[0].expands, true);
  assert.equal(shellWrites('echo > ../*.log').targets[0].glob, true);
});

// The hook, run as Claude Code runs it.
const run = (input) => spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
const bash = (cwd, command, extra = { agent_id: 'a1', agent_type: 'baco:implementer-standard' }) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command }, ...extra });
const denied = (r) => r.status === 0 && r.stdout !== '' && JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === 'deny';

test('hooks.json wires the write guard on Bash', () => {
  const pre = JSON.parse(readFileSync(join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
  const entry = pre.find((h) => h.matcher === 'Bash');
  assert.ok(entry, 'a Bash entry');
  assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/write-guard.mjs"');
  assert.ok(entry.hooks[0].timeout <= 10);
});

test('write guard: a subagent redirecting outside the project is denied with the rule', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'baco-wg-')));
  temps.push(parent);
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  for (const cmd of ['npm test > ../a.log 2>&1', `npm test | tee ${join(parent, 'b.log')}`, 'npm test > ~/c.log', 'npm test >> /tmp/d.log']) {
    const r = run(bash(repo, cmd));
    assert.ok(denied(r), `${cmd}: ${r.stdout}${r.stderr}`);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /\.baco\/logs\//);
  }
  // From a subfolder, a target that climbs but stays inside is fine.
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  assert.equal(run(bash(join(repo, 'src', 'deep'), 'npm test > ../../.baco/logs/x.log')).stdout, '');
});

test('write guard: allows writes inside, /dev/null, the conductor, non-BACO folders and unsure targets', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  for (const cmd of [
    'npm test > .baco/logs/t.log 2>&1', 'npm test 2>/dev/null | tail -5', 'ls &>/dev/null', 'echo x > src/out.txt',
    'npm test > "$LOG"', 'cd .. && ls > a.log', 'npm test 2>&1 | tail -15',
  ]) assert.equal(run(bash(repo, cmd)).stdout, '', cmd);
  assert.equal(run(bash(repo, 'npm test > ../a.log', {})).stdout, '', 'the conductor (no agent_id) is not checked');
  const plain = await makeRepo({ 'a.js': '' });
  assert.equal(run(bash(plain, 'npm test > ../a.log')).stdout, '', 'not a BACO project');
});

test('write guard: a linked worktree may write to its own folder and to the main project', async () => {
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  const wt = join(realpathSync(mkdtempSync(join(tmpdir(), 'baco-wt-'))), 'w');
  temps.push(join(wt, '..'));
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'baco/ENT-001-T-001', wt], { cwd: repo });
  assert.equal(run(bash(wt, 'npm test > .baco/logs/x.log')).stdout, '');
  assert.equal(run(bash(wt, `npm test > ${join(repo, '.baco', 'logs', 'y.log')}`)).stdout, '');
  assert.ok(denied(run(bash(wt, 'npm test > ../fora.log'))));
});

// PR review of the round D fixes: the destination is judged where the kernel would open it.
test('write guard: symlinks, /dev/.., quoted names and writes before a cd', async () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'baco-out-')));
  temps.push(outside);
  mkdirSync(join(outside, 'subdir'));
  const repo = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\n', 'src/a.js': '' });
  symlinkSync(join(outside, 'subdir'), join(repo, 'external'));
  symlinkSync(join(outside, 'new.log'), join(repo, 'dangling.log'));
  symlinkSync('src', join(repo, 'inner'));
  for (const cmd of [
    'npm test > external/../run.log', 'npm test > external/x.log', 'npm test > dangling.log',
    'npm test > /dev/../tmp/outside.log', "echo > '../report[1].log'", 'echo ok > ../outside.log; cd .',
    'echo "$(echo ok > ../outside.log)"', 'npm test | timeout 30 tee ../x', 'exec 3<> ../rw.log',
    'v="$(cd src && pwd)"; npm test > ../outside.log', 'env -C /tmp npm test > ../outside.log', 'env -C /tmp pwd; npm test > ../outside.log',
  ]) assert.ok(denied(run(bash(repo, cmd))), cmd);
  for (const cmd of ['npm test > inner/x.log', 'echo > "~/file"', 'npm test > /dev/stderr', 'cd . ; ls > ../after-cd.log']) {
    assert.equal(run(bash(repo, cmd)).stdout, '', cmd);
  }
});

test('write guard fails open on bad input', () => {
  for (const bad of ['not json', '{}', JSON.stringify({ agent_id: 'a', tool_input: {} }), JSON.stringify({ agent_id: 'a', tool_input: { command: 42 } })]) {
    const r = run(bad);
    assert.equal(r.status, 0, bad);
    assert.equal(r.stdout, '', bad);
  }
});
