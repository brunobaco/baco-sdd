import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepo as makeRepoRaw } from './helpers/tmprepo.mjs';
import { parseLocalEnv, readLocalEnv } from '../skills/baco-sdd/scripts/lib/localenv.mjs';
import { acquireQueue, QueueTimeoutError, QueueBlockedError } from '../skills/baco-sdd/scripts/lib/queue.mjs';
import { shellQuote } from '../skills/baco-sdd/scripts/commands/run-tests.mjs';

const BACO = fileURLToPath(new URL('../skills/baco-sdd/scripts/baco.mjs', import.meta.url));
const LOCK = 'baco-test-queue.lock';

// Every temp folder made here is removed when the file ends.
const temps = [];
const track = (dir) => { temps.push(dir); return dir; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const makeRepo = async (files) => track(await makeRepoRaw(files));
const tmpQ = () => track(mkdtempSync(join(tmpdir(), 'baco-q-')));

// Each CLI run gets its own queue folder (BACO_QUEUE_DIR, and TMPDIR alike), so the machine-wide queue
// lock of a test never meets another's. `openStdin`: the CLI gets a stdin pipe that stays open (never
// written, never ended), like an agent's terminal; `limitMs`: the CLI is killed after that long
// (then `code` is null and `killed` true).
function cli(dir, args, { env = {}, tmp = tmpQ(), openStdin = false, limitMs = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BACO, 'run-tests', '--cwd', dir, ...args], {
      env: { ...process.env, TMPDIR: tmp, BACO_QUEUE_DIR: tmp, ...env }, stdio: [openStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', killed = false;
    const timer = limitMs ? setTimeout(() => { killed = true; child.kill('SIGKILL'); child.stdin?.destroy(); }, limitMs) : null;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => { clearTimeout(timer); child.stdin?.destroy(); resolve({ code, stdout, stderr, tmp, killed }); });
  });
}
const config = (body) => ({ '.baco/config.yaml': body, '.gitignore': '.baco/local.env\n.baco/logs/\n' });
const read = (dir, f) => readFileSync(join(dir, f), 'utf8');
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
const holdLock = (tmp, owner) => {
  mkdirSync(join(tmp, LOCK));
  writeFileSync(join(tmp, LOCK, 'owner.json'), JSON.stringify({ root: '/other/project', layer: 'e2e_web', started: '2026-11-02T10:00:00.000Z', token: 'x', ...owner }));
};

// ---- libs

test('parseLocalEnv: KEY=VALUE, # comments, optional quotes and export; bad lines reported', () => {
  const { vars, bad } = parseLocalEnv('# comment\n\nA=1\nexport B = two words \nC="x # y"\nD=\'q\'\nE=\nnot a line\n1X=2\r\n');
  assert.deepEqual(vars, { A: '1', B: 'two words', C: 'x # y', D: 'q', E: '' });
  assert.deepEqual(bad, [8, 9]);
});

test('shellQuote leaves safe words and quotes the rest', () => {
  assert.equal(shellQuote('tests/a.spec.ts'), 'tests/a.spec.ts');
  assert.equal(shellQuote('a b'), "'a b'");
  assert.equal(shellQuote("c'd"), "'c'\\''d'");
  assert.equal(shellQuote(''), "''");
  assert.equal(shellQuote('$(rm -rf x)'), "'$(rm -rf x)'");
});

test('queue: a free lock is taken with an owner file and released; release keeps a lock it does not own', async () => {
  const lockDir = join(tmpQ(), LOCK);
  const q = await acquireQueue({ lockDir, owner: { root: '/p', layer: 'e2e' }, timeoutMs: 1000, pollMs: 20 });
  const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.root, '/p');
  assert.equal(owner.layer, 'e2e');
  assert.ok(!Number.isNaN(Date.parse(owner.started)));
  assert.equal(q.waitedMs, 0);
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ ...owner, token: 'someone-else' }));
  q.release();
  assert.ok(existsSync(lockDir));
});

test('queue: a stale lock (dead pid) is taken over', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: deadPid() });
  let waited = 0;
  const q = await acquireQueue({ lockDir: join(tmp, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 1000, pollMs: 20, onWait: () => { waited++; } });
  assert.equal(waited, 0);
  assert.equal(JSON.parse(read(tmp, `${LOCK}/owner.json`)).pid, process.pid);
  q.release();
  assert.ok(!existsSync(join(tmp, LOCK)));
});

test('queue: a live holder makes it wait (onWait once) and time out with the holder', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.ppid });
  const calls = [];
  await assert.rejects(
    acquireQueue({ lockDir: join(tmp, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 200, pollMs: 20, onWait: (h) => calls.push(h) }),
    (e) => e instanceof QueueTimeoutError && e.holder.root === '/other/project',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].layer, 'e2e_web');
});

test('queue: it proceeds when the holder releases', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.ppid });
  setTimeout(() => spawnSync('rm', ['-rf', join(tmp, LOCK)]), 250);
  const q = await acquireQueue({ lockDir: join(tmp, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 5000, pollMs: 20 });
  assert.ok(q.waitedMs >= 200, String(q.waitedMs));
  q.release();
});

// ---- command

test('runs the layer command through sh at the repo root; data records the run; exit 0', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "mkdir -p .baco/junit && echo \'<testsuite/>\' > .baco/junit/unit.xml && pwd > where.txt"\n'));
  mkdirSync(join(dir, 'sub'));
  const r = await cli(join(dir, 'sub'), ['--layer', 'unit', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const [run] = JSON.parse(r.stdout).runs;
  assert.equal(run.layer, 'unit');
  assert.equal(run.quick, false);
  assert.equal(run.exit, 0);
  assert.equal(run.junitWritten, true);
  assert.equal(typeof run.seconds, 'number');
  assert.equal(run.waitedSeconds, 0);
  assert.match(run.command, /unit\.xml/);
  assert.equal(realpathSync(read(dir, 'where.txt').trim()), realpathSync(dir));
});

test('--verbose passes the child output through; a failure exits 1; --all continues after a failure', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "echo out-unit; echo err-unit >&2; exit 3"\n  api: "touch api-ran; echo out-api"\n'));
  const r = await cli(dir, ['--all', '--verbose']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /out-unit/);
  assert.match(r.stderr, /err-unit/);
  assert.match(r.stdout, /out-api/);
  assert.ok(existsSync(join(dir, 'api-ran')));
  assert.ok(!existsSync(join(dir, '.baco/logs')), '--verbose writes no log');
  const json = await cli(dir, ['--all', '--json']);
  const data = JSON.parse(json.stdout);
  assert.deepEqual(data.runs.map((x) => [x.layer, x.exit]), [['unit', 3], ['api', 0]]);
  assert.match(data.runs[0].output, /out-unit[\s\S]*err-unit|err-unit[\s\S]*out-unit/);
  assert.doesNotMatch(json.stdout.split('\n')[0], /out-unit/);
});

const FAILING_XML = '<testsuite><testcase name="[CA-001] soma dois números" classname="soma" file="tests/soma.test.js"><failure message="esperado 4, recebido 5">stack line 1</failure></testcase><testcase name="[CA-002] passa sempre" classname="soma"/></testsuite>';
const logPathIn = (text) => (/(\.baco\/logs\/[^\s]+\.log)/.exec(text) ?? [])[1];

test('default mode prints only the summary and writes the full output to .baco/logs/', async () => {
  const noisy = 'for i in $(seq 1 300); do echo noisy-line-$i; done; echo err-unit >&2; exit 3';
  const dir = await makeRepo(config(`tests:\n  unit: "${noisy}"\n  api: "printf out-%s api"\n`));
  const r = await cli(dir, ['--all']);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /noisy-line-1\b/, 'the child output is not printed');
  assert.doesNotMatch(r.stdout + r.stderr, /out-api/);
  assert.match(r.stdout, /Camada unit: falhou/);
  assert.match(r.stdout, /Camada api: passou/);
  const unitLog = logPathIn(r.stdout.split('\n').find((l) => /unit/.test(l) && /\.baco\/logs\//.test(l)) ?? '');
  assert.ok(unitLog, `log path of unit missing in: ${r.stdout}`);
  const log = read(dir, unitLog);
  assert.match(log, /noisy-line-1\n[\s\S]*noisy-line-300/);
  assert.match(log, /err-unit/);
  assert.ok(r.stdout.split('\n').length < 60, `summary too long: ${r.stdout.split('\n').length} lines`);
});

test('a failed layer lists its failing tests with their message, read from the JUnit XML it wrote', async () => {
  const dir = await makeRepo({ ...config('tests:\n  unit: "mkdir -p .baco/junit && cp fx/unit.xml .baco/junit/unit.xml; echo saida-ruidosa; exit 1"\n'), 'fx/unit.xml': FAILING_XML });
  const r = await cli(dir, ['--layer', 'unit']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[CA-001\] soma dois números[^\n]*esperado 4, recebido 5/);
  assert.doesNotMatch(r.stdout, /CA-002/, 'passing tests are not listed');
  assert.doesNotMatch(r.stdout, /saida-ruidosa|stack line/);
  assert.match(r.stdout, /\.baco\/logs\/[^\s]+\.log/);
});

test('a failing test shows its whole message in the summary, up to 20 lines each', async () => {
  const msg = Array.from({ length: 25 }, (_, i) => `msg-linha-${i + 1}`).join('&#10;');
  const xml = `<testsuite><testcase name="[CA-001] longo" classname="x" file="t/x.test.js"><failure message="${msg}"/></testcase><testcase name="[CA-002] curto" classname="x"><failure message="Expected: 4&#10;Received: 5"/></testcase></testsuite>`;
  const dir = await makeRepo({ ...config('tests:\n  unit: "mkdir -p .baco/junit && cp fx/unit.xml .baco/junit/unit.xml; exit 1"\n'), 'fx/unit.xml': xml });
  const r = await cli(dir, ['--layer', 'unit']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /msg-linha-1\n[\s\S]*msg-linha-20\n/);
  assert.doesNotMatch(r.stdout, /msg-linha-21\b/);
  assert.match(r.stdout, /mais 5 linhas/);
  assert.match(r.stdout, /Expected: 4\n\s+Received: 5/);
});

test('a failed layer without JUnit failures shows the last lines of its output', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "for i in $(seq 1 100); do echo linha-$i; done; echo erro-final; exit 2"\n'));
  const r = await cli(dir, ['--layer', 'unit']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /erro-final/);
  assert.match(r.stdout, /linha-100/);
  assert.doesNotMatch(r.stdout, /linha-1\n/);
});

test('--json keeps runs[].output and adds the log path and the failing tests', async () => {
  const dir = await makeRepo({ ...config('tests:\n  unit: "mkdir -p .baco/junit && cp fx/unit.xml .baco/junit/unit.xml; seq 1 5000; echo fim-da-saida; exit 1"\n'), 'fx/unit.xml': FAILING_XML });
  const r = await cli(dir, ['--layer', 'unit', '--json']);
  assert.equal(r.code, 1, r.stderr);
  const [run] = JSON.parse(r.stdout).runs;
  assert.ok(run.output.length <= 16000);
  assert.match(run.output, /fim-da-saida/);
  assert.match(run.log, /^\.baco\/logs\/.+\.log$/);
  const log = read(dir, run.log);
  assert.ok(log.length > 20000, 'the log keeps the whole output');
  assert.deepEqual(run.failures, [{ name: '[CA-001] soma dois números', classname: 'soma', file: 'tests/soma.test.js', message: 'esperado 4, recebido 5' }]);
  const ok = JSON.parse((await cli(await makeRepo(config('tests:\n  unit: "true"\n')), ['--layer', 'unit', '--json'])).stdout).runs[0];
  assert.deepEqual(ok.failures, []);
});

// End-to-end round D: the failures listed must match Playwright's count (see junit.test.mjs).
test('a Playwright layer with two failing tests in one file lists both, per project', async () => {
  const xml = readFileSync(new URL('./fixtures/junit-playwright.xml', import.meta.url), 'utf8');
  const dir = await makeRepo({ ...config('tests:\n  e2e: "mkdir -p .baco/junit && cp fx/e2e.xml .baco/junit/e2e.xml; exit 1"\n  queue: []\n'), 'fx/e2e.xml': xml });
  const r = await cli(dir, ['--layer', 'e2e', '--json']);
  assert.equal(r.code, 1, r.stderr);
  const [run] = JSON.parse(r.stdout).runs;
  assert.equal(run.failures.length, 4);
  assert.equal(run.failures.filter((f) => f.name.includes('[CT-002]')).length, 1);
});

test('warns when .baco/logs/ is not git-ignored', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'tests:\n  unit: "true"\n', '.gitignore': '.baco/local.env\n' });
  const r = await cli(dir, ['--layer', 'unit']);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /\.baco\/logs\/[^\n]*\.gitignore/);
  const ok = await makeRepo(config('tests:\n  unit: "true"\n'));
  assert.doesNotMatch((await cli(ok, ['--layer', 'unit'])).stderr, /gitignore/);
});

test('usage errors: no --layer/--all, unknown layer, layer without command, --all with no layers (64)', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "true"\n  odd: [x]\n'));
  assert.equal((await cli(dir, [])).code, 64);
  const unknown = await cli(dir, ['--layer', 'nope']);
  assert.equal(unknown.code, 64);
  assert.match(unknown.stderr, /nope/);
  assert.equal((await cli(dir, ['--layer', 'odd'])).code, 64);
  assert.equal((await cli(dir, ['--layer', 'unit', '--all'])).code, 64);
  const empty = await makeRepo({ 'a.txt': 'x' });
  assert.equal((await cli(empty, ['--all'])).code, 64);
  assert.equal((await cli(empty, ['--smoke'])).code, 64);
});

test('--quick uses tests_quick and falls back to tests per layer', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "echo unit-full"\n  e2e_web: "echo web-full"\n  queue: []\ntests_quick:\n  e2e_web: "echo web-quick"\n'));
  const data = JSON.parse((await cli(dir, ['--all', '--quick', '--json'])).stdout);
  assert.deepEqual(data.runs.map((x) => [x.layer, x.quick, x.command]), [['unit', true, 'echo unit-full'], ['e2e_web', true, 'echo web-quick']]);
  const full = JSON.parse((await cli(dir, ['--layer', 'e2e_web', '--json'])).stdout);
  assert.equal(full.runs[0].command, 'echo web-full');
});

test('stdin is closed: an interactive prompt fails instead of hanging, even when the caller keeps stdin open', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "read answer"\n'));
  const r = await cli(dir, ['--layer', 'unit'], { openStdin: true, limitMs: 8000 });
  assert.equal(r.killed, false, 'the prompt hung on the open stdin');
  assert.equal(r.code, 1);
});

test('after a normal exit, a leftover that ignores SIGTERM is killed after a short grace', async () => {
  const dir = await makeRepo(config("tests:\n  unit: \"(trap '' TERM; exec sleep 30) & echo $! > bg.txt\"\n"));
  const t0 = Date.now();
  const r = await cli(dir, ['--layer', 'unit']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(Date.now() - t0 < 10000);
  await new Promise((res) => setTimeout(res, 200));
  assert.throws(() => process.kill(Number(read(dir, 'bg.txt')), 0));
});

test('.baco/local.env: a task worktree without its own file uses the main checkout one; its own file wins', async () => {
  const dir = await makeRepo({ ...config('tests:\n  unit: echo "$FROM_MAIN" > env.txt\n'), '.baco/local.env': 'FROM_MAIN=main-file\n' });
  const wt = join(track(mkdtempSync(join(tmpdir(), 'baco-wt-'))), 'task');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'task', wt], { cwd: dir });
  assert.ok(!existsSync(join(wt, '.baco/local.env')));
  let r = await cli(wt, ['--layer', 'unit']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(wt, 'env.txt').trim(), 'main-file');
  assert.doesNotMatch(r.stderr, /gitignore/);
  const local = readLocalEnv(wt);
  assert.equal(realpathSync(local.file), realpathSync(join(dir, '.baco/local.env')));
  assert.equal(local.ignored, true);
  writeFileSync(join(wt, '.baco/local.env'), 'FROM_MAIN=worktree-file\n');
  r = await cli(wt, ['--layer', 'unit']);
  assert.equal(read(wt, 'env.txt').trim(), 'worktree-file');
  assert.equal(readLocalEnv(dir).file, join(dir, '.baco/local.env'));
  assert.equal(readLocalEnv(track(mkdtempSync(join(tmpdir(), 'baco-nogit-')))).exists, false);
});

test('extra args after -- are shell-quoted and appended; refused with several layers', async () => {
  const dir = await makeRepo(config("tests:\n  unit: printf '%s\\n' > args.txt\n  api: \"true\"\n"));
  const r = await cli(dir, ['--layer', 'unit', '--', 'a b', "c'd", '--grep', '$HOME']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(read(dir, 'args.txt').split('\n').filter(Boolean), ['a b', "c'd", '--grep', '$HOME']);
  assert.equal((await cli(dir, ['--all', '--', 'x'])).code, 64);
});

test('.baco/local.env vars reach the child over process.env; warning when it is not git-ignored', async () => {
  const dir = await makeRepo({ ...config('tests:\n  unit: echo "$FROM_FILE/$OVER" > env.txt\n'), '.baco/local.env': '# máquina\nFROM_FILE="/opt/browsers"\nOVER=file\n' });
  let r = await cli(dir, ['--layer', 'unit'], { env: { OVER: 'process' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(dir, 'env.txt').trim(), '/opt/browsers/file');
  assert.doesNotMatch(r.stderr, /gitignore/);
  writeFileSync(join(dir, '.gitignore'), '');
  r = await cli(dir, ['--layer', 'unit']);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /local\.env[\s\S]*\.gitignore/);
});

test('warns when the layer wrote no JUnit XML; an updated XML counts as written', async () => {
  const dir = await makeRepo({ ...config('tests:\n  unit: "true"\n  api: "touch .baco/junit/api.xml"\n'), '.baco/junit/api.xml': '<testsuite/>' });
  utimesSync(join(dir, '.baco/junit/api.xml'), new Date(2000, 1, 1), new Date(2000, 1, 1));
  const r = await cli(dir, ['--all', '--json']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout).runs.map((x) => [x.layer, x.junitWritten]), [['unit', false], ['api', true]]);
  assert.match(r.stderr, /unit[^\n]*JUnit/);
  assert.doesNotMatch(r.stderr, /api[^\n]*JUnit/);
});

test('queue: an e2e layer waits for a live holder and gives up after BACO_QUEUE_TIMEOUT (65); other layers do not wait', async () => {
  const dir = await makeRepo(config('tests:\n  unit: "touch unit-ran"\n  e2e_web: "touch e2e-ran"\n'));
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.pid });
  const env = { BACO_QUEUE_TIMEOUT: '1', BACO_QUEUE_POLL_MS: '50' };
  const r = await cli(dir, ['--layer', 'e2e_web'], { env, tmp });
  assert.equal(r.code, 65);
  assert.equal((r.stderr.match(/Esperando outra bateria/g) ?? []).length, 1, r.stderr);
  assert.match(r.stderr, /projeto \/other\/project, camada e2e_web/);
  assert.match(r.stderr, /Desisti de esperar[^\n]*e2e_web/);
  assert.ok(!existsSync(join(dir, 'e2e-ran')));
  assert.equal((await cli(dir, ['--layer', 'unit'], { env, tmp })).code, 0);
  assert.ok(existsSync(join(dir, 'unit-ran')));
  assert.ok(existsSync(join(tmp, LOCK)), 'the other holder keeps its lock');
});

test('queue: tests.queue replaces the e2e default; the owner file names pid, project and layer; released after', async () => {
  const dir = await makeRepo(config('tests:\n  unit: cat "$TMPDIR/baco-test-queue.lock/owner.json" > owner.json\n  queue: [unit]\n'));
  const r = await cli(dir, ['--layer', 'unit', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const owner = JSON.parse(read(dir, 'owner.json'));
  assert.equal(owner.layer, 'unit');
  assert.equal(realpathSync(owner.root), realpathSync(dir));
  assert.equal(typeof owner.pid, 'number');
  assert.ok(owner.started);
  assert.ok(!existsSync(join(r.tmp, LOCK)));
});

test('queue: a signal kills the running battery and releases the lock', async () => {
  const dir = await makeRepo(config('tests:\n  e2e_web: "echo $$ > pid.txt; exec sleep 30"\n'));
  const tmp = tmpQ();
  const child = spawn(process.execPath, [BACO, 'run-tests', '--cwd', dir, '--layer', 'e2e_web'], { env: { ...process.env, TMPDIR: tmp, BACO_QUEUE_DIR: tmp }, stdio: 'ignore' });
  const closed = new Promise((res) => child.on('close', (code, signal) => res({ code, signal })));
  const t0 = Date.now();
  while (!existsSync(join(dir, 'pid.txt')) || !read(dir, 'pid.txt').trim()) {
    if (Date.now() - t0 > 10000) throw new Error('battery did not start');
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.ok(existsSync(join(tmp, LOCK)));
  child.kill('SIGTERM');
  const { code } = await closed;
  assert.notEqual(code, 0);
  assert.ok(!existsSync(join(tmp, LOCK)));
  const pid = Number(read(dir, 'pid.txt'));
  await new Promise((res) => setTimeout(res, 200));
  assert.throws(() => process.kill(pid, 0));
});

test('--smoke: 0 when app.smoke exits 0, 1 when it fails, 1 on timeout (process group killed)', async () => {
  let dir = await makeRepo(config('app:\n  smoke: "echo $X > smoke.txt"\n'));
  writeFileSync(join(dir, '.baco/local.env'), 'X=ok\n');
  let r = await cli(dir, ['--smoke', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(dir, 'smoke.txt').trim(), 'ok');
  assert.deepEqual(Object.keys(JSON.parse(r.stdout).smoke).sort(), ['command', 'exit', 'output', 'seconds', 'timedOut']);
  dir = await makeRepo(config('app:\n  smoke: "read yn"\n'));
  r = await cli(dir, ['--smoke'], { openStdin: true, limitMs: 8000 });
  assert.equal(r.killed, false, 'the prompt hung on the open stdin');
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stderr + r.stdout, /tempo|timeout/i);
  dir = await makeRepo(config('app:\n  smoke: "sleep 30 & echo $! > bg.txt; sleep 30"\n'));
  const t0 = Date.now();
  r = await cli(dir, ['--smoke'], { env: { BACO_SMOKE_TIMEOUT: '1' } });
  assert.equal(r.code, 1);
  assert.ok(Date.now() - t0 < 10000);
  assert.match(r.stdout, /1 s/);
  r = await cli(dir, ['--smoke', '--json'], { env: { BACO_SMOKE_TIMEOUT: '1' } });
  assert.equal(JSON.parse(r.stdout).smoke.timedOut, true);
  await new Promise((res) => setTimeout(res, 200));
  assert.throws(() => process.kill(Number(read(dir, 'bg.txt')), 0));
});

test('queue: a folder the engine creates for the lock is open to every user (0777, no sticky bit)', { skip: process.platform === 'win32' }, async () => {
  const base = join(tmpQ(), 'shared', 'baco-queue');
  const q = await acquireQueue({ lockDir: join(base, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 1000, pollMs: 20 });
  assert.equal(statSync(base).mode & 0o7777, 0o777);
  q.release();
  // An existing folder is left as it is.
  const own = tmpQ();
  chmodSync(own, 0o750);
  (await acquireQueue({ lockDir: join(own, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 1000, pollMs: 20 })).release();
  assert.equal(statSync(own).mode & 0o7777, 0o750);
});

const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
test('queue: a dead lock that cannot be moved stops at once naming the lock to remove (65)', { skip: process.platform === 'win32' || asRoot }, async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: deadPid() });
  chmodSync(tmp, 0o555); // like another user's lock in a sticky /tmp: rename refused
  try {
    const t0 = Date.now();
    await assert.rejects(
      acquireQueue({ lockDir: join(tmp, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 60000, pollMs: 20 }),
      (e) => e instanceof QueueBlockedError && e.path === join(tmp, LOCK),
    );
    assert.ok(Date.now() - t0 < 5000);
    const dir = await makeRepo(config('tests:\n  e2e_web: "touch e2e-ran"\n'));
    const r = await cli(dir, ['--layer', 'e2e_web'], { tmp, env: { BACO_QUEUE_TIMEOUT: '60', BACO_QUEUE_POLL_MS: '50' }, limitMs: 20000 });
    assert.equal(r.code, 65, r.stderr);
    assert.equal(r.stderr.split(join(tmp, LOCK)).length - 1, 1, r.stderr);
    assert.doesNotMatch(r.stderr, /Esperando outra bateria/);
    assert.ok(!existsSync(join(dir, 'e2e-ran')));
  } finally {
    chmodSync(tmp, 0o755);
  }
});

test('queueLockDir: /tmp/baco-queue by default, whatever TMPDIR says; BACO_QUEUE_DIR wins', async () => {
  const { queueLockDir } = await import('../skills/baco-sdd/scripts/lib/queue.mjs');
  const saved = { TMPDIR: process.env.TMPDIR, BACO_QUEUE_DIR: process.env.BACO_QUEUE_DIR };
  try {
    process.env.TMPDIR = '/tmp/per-session-xyz';
    delete process.env.BACO_QUEUE_DIR;
    if (process.platform !== 'win32') assert.equal(queueLockDir(), '/tmp/baco-queue/baco-test-queue.lock');
    process.env.BACO_QUEUE_DIR = '/srv/q';
    assert.equal(queueLockDir(), '/srv/q/baco-test-queue.lock');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
