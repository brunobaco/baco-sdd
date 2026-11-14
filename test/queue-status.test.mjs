import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { acquireQueue, readQueueStatus, QueueTimeoutError } from '../skills/baco-sdd/scripts/lib/queue.mjs';
import { makeRepo as makeRepoRaw } from './helpers/tmprepo.mjs';

// 0.1.1 (atrito 6): who holds the machine-wide test queue and who is waiting for it.
const BACO = fileURLToPath(new URL('../skills/baco-sdd/scripts/baco.mjs', import.meta.url));
const LOCK = 'baco-test-queue.lock';
const temps = [];
const track = (dir) => { temps.push(dir); return dir; };
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const tmpQ = () => track(mkdtempSync(join(tmpdir(), 'baco-qs-')));
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
const STARTED = '2026-11-02T10:05:00.000Z';
const hhmm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const holdLock = (tmp, owner) => {
  mkdirSync(join(tmp, LOCK));
  writeFileSync(join(tmp, LOCK, 'owner.json'), JSON.stringify({ root: '/other/project', layer: 'e2e_web', started: STARTED, token: 'x', ...owner }));
};
const addWaiting = (tmp, name, entry) => {
  mkdirSync(join(tmp, 'waiting'), { recursive: true });
  writeFileSync(join(tmp, 'waiting', name), JSON.stringify(entry));
};
const waitingFiles = (tmp) => (existsSync(join(tmp, 'waiting')) ? readdirSync(join(tmp, 'waiting')) : []);
const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
// Runs queue-status in-process with BACO_QUEUE_DIR pointing at `tmp`.
async function status(tmp, ...args) {
  const saved = process.env.BACO_QUEUE_DIR;
  process.env.BACO_QUEUE_DIR = tmp;
  try {
    const c = capture();
    const code = await main(['queue-status', ...args], c.io);
    return { code, ...c.out };
  } finally {
    if (saved === undefined) delete process.env.BACO_QUEUE_DIR; else process.env.BACO_QUEUE_DIR = saved;
  }
}

test('lib: a run that waits registers itself in waiting/ and leaves when it gets the lock', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.ppid });
  let seen = null;
  const p = acquireQueue({
    lockDir: join(tmp, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 5000, pollMs: 20,
    onWait: () => { setTimeout(() => { seen = waitingFiles(tmp).map((f) => JSON.parse(readFileSync(join(tmp, 'waiting', f), 'utf8'))); rmSync(join(tmp, LOCK), { recursive: true, force: true }); }, 50); },
  });
  const q = await p;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].pid, process.pid);
  assert.equal(seen[0].root, '/p');
  assert.equal(seen[0].layer, 'e2e');
  assert.ok(!Number.isNaN(Date.parse(seen[0].since)));
  assert.deepEqual(waitingFiles(tmp), []);
  q.release();
});

test('lib: a run that times out removes its waiting entry; a free lock never registers', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.ppid });
  await assert.rejects(acquireQueue({ lockDir: join(tmp, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 100, pollMs: 20 }), QueueTimeoutError);
  assert.deepEqual(waitingFiles(tmp), []);
  const free = tmpQ();
  const q = await acquireQueue({ lockDir: join(free, LOCK), owner: { root: '/p', layer: 'e2e' }, timeoutMs: 100, pollMs: 20 });
  assert.equal(existsSync(join(free, 'waiting')), false);
  q.release();
});

test('lib: readQueueStatus lists the holder and the live waiting runs by time; dead entries are dropped and cleaned', () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.pid });
  addWaiting(tmp, 'b.json', { pid: process.pid, root: '/b', layer: 'e2e_b', since: '2026-11-02T10:20:00.000Z' });
  addWaiting(tmp, 'a.json', { pid: process.ppid, root: '/a', layer: 'e2e_a', since: '2026-11-02T10:10:00.000Z' });
  addWaiting(tmp, 'dead.json', { pid: deadPid(), root: '/d', layer: 'e2e_d', since: '2026-11-02T10:00:00.000Z' });
  writeFileSync(join(tmp, 'waiting', 'junk.json'), '{nope');
  const s = readQueueStatus({ lockDir: join(tmp, LOCK) });
  assert.deepEqual(s.lock, { pid: process.pid, root: '/other/project', layer: 'e2e_web', started: STARTED, alive: true });
  assert.deepEqual(s.waiting.map((w) => w.root), ['/a', '/b']);
  // An unreadable entry younger than 10 s may be one being written: kept until it is older.
  assert.deepEqual(waitingFiles(tmp).sort(), ['a.json', 'b.json', 'junk.json']);
  const old = new Date(Date.now() - 11_000);
  utimesSync(join(tmp, 'waiting', 'junk.json'), old, old);
  readQueueStatus({ lockDir: join(tmp, LOCK) });
  assert.deepEqual(waitingFiles(tmp).sort(), ['a.json', 'b.json']);
  const none = readQueueStatus({ lockDir: join(tmpQ(), LOCK) });
  assert.deepEqual(none, { lock: null, waiting: [] });
});

test('lib: a young unreadable waiting entry is neither listed nor removed', () => {
  const tmp = tmpQ();
  mkdirSync(join(tmp, 'waiting'));
  writeFileSync(join(tmp, 'waiting', '123-abc.json'), '');
  assert.deepEqual(readQueueStatus({ lockDir: join(tmp, LOCK) }).waiting, []);
  assert.deepEqual(waitingFiles(tmp), ['123-abc.json']);
});

test('queue-status: a free queue says so and exits 0 (outside a repo too)', async () => {
  const tmp = tmpQ();
  const r = await status(tmp, '--cwd', tmpQ());
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /fila de testes desta máquina está livre/);
  assert.match(r.stdout, /Ninguém esperando/);
  const j = await status(tmp, '--json', '--cwd', tmpQ());
  assert.deepEqual(JSON.parse(j.stdout), { lock: null, waiting: [] });
  // The command only reads: it does not create the queue folder.
  const missing = join(tmpQ(), 'nope');
  assert.equal((await status(missing)).code, 0);
  assert.equal(existsSync(missing), false);
});

test('queue-status: names the holder and the waiting runs with local HH:MM; en follows the config language', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.pid });
  addWaiting(tmp, 'w.json', { pid: process.pid, root: '/proj/b', layer: 'e2e_mobile', since: '2026-11-02T10:30:00.000Z' });
  addWaiting(tmp, 'dead.json', { pid: deadPid(), root: '/proj/dead', layer: 'e2e_x', since: '2026-11-02T10:00:00.000Z' });
  const r = await status(tmp, '--cwd', tmpQ());
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes(`Rodando agora: camada e2e_web do projeto /other/project, desde as ${hhmm(STARTED)}`), r.stdout);
  assert.match(r.stdout, /Esperando \(1\):/);
  assert.ok(r.stdout.includes(`- camada e2e_mobile do projeto /proj/b, esperando desde as ${hhmm('2026-11-02T10:30:00.000Z')}`), r.stdout);
  assert.doesNotMatch(r.stdout, /proj\/dead/);
  const data = JSON.parse((await status(tmp, '--json')).stdout);
  assert.equal(data.lock.layer, 'e2e_web');
  assert.deepEqual(data.waiting, [{ pid: process.pid, root: '/proj/b', layer: 'e2e_mobile', since: '2026-11-02T10:30:00.000Z' }]);
  const repo = track(await makeRepoRaw({ '.baco/config.yaml': 'language: en\n' }));
  const en = await status(tmp, '--cwd', repo);
  assert.match(en.stdout, /Running now: layer e2e_web of project \/other\/project/);
  assert.match(en.stdout, /Waiting \(1\):/);
});

test('queue-status: an abandoned lock (dead pid) is shown as such; extra arguments are a usage error', async () => {
  const tmp = tmpQ();
  holdLock(tmp, { pid: deadPid() });
  const r = await status(tmp);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /trava abandonada/);
  assert.equal((await status(tmp, 'x')).code, 64);
});

test('run-tests waiting in the queue shows up in queue-status and leaves the list when stopped', async () => {
  const dir = track(await makeRepoRaw({ '.baco/config.yaml': 'tests:\n  e2e_web: "true"\n' }));
  const tmp = tmpQ();
  holdLock(tmp, { pid: process.pid });
  const child = spawn(process.execPath, [BACO, 'run-tests', '--cwd', dir, '--layer', 'e2e_web'], {
    env: { ...process.env, TMPDIR: tmp, BACO_QUEUE_DIR: tmp, BACO_QUEUE_TIMEOUT: '30', BACO_QUEUE_POLL_MS: '50' }, stdio: 'ignore',
  });
  const closed = new Promise((res) => child.on('close', res));
  const t0 = Date.now();
  while (!waitingFiles(tmp).length) {
    if (Date.now() - t0 > 10000) { child.kill('SIGKILL'); throw new Error('run-tests did not register as waiting'); }
    await new Promise((res) => setTimeout(res, 50));
  }
  const data = JSON.parse((await status(tmp, '--json')).stdout);
  assert.equal(data.waiting.length, 1);
  assert.equal(data.waiting[0].pid, child.pid);
  assert.equal(data.waiting[0].layer, 'e2e_web');
  child.kill('SIGTERM');
  await closed;
  assert.deepEqual(waitingFiles(tmp), []);
});
