// Machine-wide queue for heavy test batteries (browser e2e): one at a time on this machine, whatever
// the project. The lock is a directory (mkdir is atomic) holding an owner file.
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// The lock sits under the shared `/tmp`, not `os.tmpdir()`: hosts often give each user or session its
// own TMPDIR, and a queue that cannot see the other batteries is no queue. It sits in its own folder,
// open to every user without the sticky bit, so anyone can take over a dead lock left by another user
// (in a sticky `/tmp` only the owner can move it). BACO_QUEUE_DIR overrides the folder. Inside a
// sandbox that makes `/tmp` read-only (Claude Code's sandbox writes only the project and its own
// TMPDIR), the queue falls back to TMPDIR; the conductor then hands the same folder to the Codex
// implementer through BACO_QUEUE_DIR (references/ambientes.md), so both still share one queue.
const writableDir = (p) => {
  try { accessSync(p, constants.W_OK); return true; } catch { return false; }
};
export function resolveQueueBase({ env = process.env, platform = process.platform, isWritable = writableDir, tmp = tmpdir() } = {}) {
  if (env.BACO_QUEUE_DIR) return env.BACO_QUEUE_DIR;
  if (platform !== 'win32') {
    const shared = join('/tmp', 'baco-queue');
    if (isWritable(shared) || isWritable('/tmp')) return shared;
  }
  return join(tmp, 'baco-queue');
}
const defaultBase = () => resolveQueueBase({ env: {} });
const queueBase = () => resolveQueueBase();
export const queueLockDir = () => join(queueBase(), 'baco-test-queue.lock');
// Runs waiting for the lock, one `<pid>-<token>.json` each ({pid, root, layer, since}), next to it.
export const queueWaitingDir = (lockDir = queueLockDir()) => join(dirname(lockDir), 'waiting');
const OWNER = 'owner.json';
// A lock directory with no owner file yet is being created; older than this, it is abandoned.
const ORPHAN_MS = 30_000;

export class QueueTimeoutError extends Error {
  constructor(holder, waitedMs) {
    super('queue timeout');
    this.name = 'QueueTimeoutError';
    this.holder = holder;
    this.waitedMs = waitedMs;
  }
}

// The queue cannot work without a human: `reason` 'stale' = a dead lock at `path` that this user cannot
// move (remove it by hand); 'base' = the lock cannot be created in the folder `path` (permissions).
export class QueueBlockedError extends Error {
  constructor(reason, path, cause) {
    super(`queue blocked (${reason}): ${path}`);
    this.name = 'QueueBlockedError';
    this.reason = reason;
    this.path = path;
    this.cause = cause;
  }
}

// Creates the lock's folder when missing. The folder the engine creates, and the default one always,
// is made 0777 without the sticky bit; a failed chmod is ignored (another user's folder, already open).
// An existing folder given by BACO_QUEUE_DIR is left as it is.
function prepareBase(base) {
  const existed = existsSync(base);
  if (!existed) {
    try { mkdirSync(base, { recursive: true }); } catch { return; } // the lock mkdir reports it
  }
  if (existed && base !== defaultBase()) return;
  try { if ((statSync(base).mode & 0o7777) !== 0o777) chmodSync(base, 0o777); } catch { /* not ours */ }
}

function readOwner(lockDir) {
  try { return JSON.parse(readFileSync(join(lockDir, OWNER), 'utf8')); } catch { return null; }
}

// EPERM means the process exists but belongs to another user: alive.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function stale(lockDir, owner) {
  if (owner) return !alive(owner.pid);
  try { return Date.now() - statSync(lockDir).mtimeMs > ORPHAN_MS; } catch { return false; }
}

// Takes over a stale lock: rename it aside (atomic, so only one taker wins), then check the renamed
// lock is still the dead one we judged; if a live owner got in between, put it back. When this user may
// not move it (EPERM/EACCES: another user's lock in a folder that is not open to all), waiting would
// only last until the timeout: QueueBlockedError names the lock to remove. Other failures: false.
function takeOver(lockDir, judged) {
  const aside = `${lockDir}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
  try { renameSync(lockDir, aside); } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') throw new QueueBlockedError('stale', lockDir, e);
    return e.code === 'ENOENT';
  }
  const moved = readOwner(aside);
  if (judged && moved && moved.token !== judged.token && alive(moved.pid)) {
    try { renameSync(aside, lockDir); return true; } catch { /* a new lock exists: drop the moved one */ }
  }
  rmSync(aside, { recursive: true, force: true });
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Writes this run's waiting entry (best effort: the queue works without it). Returns its remover,
// also hooked to process exit, so a run stopped by a signal leaves the list too.
function registerWaiting(lockDir, entry, token) {
  const dir = queueWaitingDir(lockDir);
  const file = join(dir, `${entry.pid}-${token}.json`);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir);
      try { chmodSync(dir, 0o777); } catch { /* not ours */ }
    }
    // Written aside and renamed in (same folder: atomic), so a reader never sees half an entry. The
    // temporary name does not end in `.json`: readers skip it.
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(entry)); renameSync(tmp, file); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  } catch {
    return () => {};
  }
  const remove = () => { process.removeListener('exit', remove); rmSync(file, { force: true }); };
  process.on('exit', remove);
  return remove;
}

// Waits until the lock is free and takes it. `owner` ({root, layer}) is recorded with pid, start time
// and a token. `onWait(holder)` is called once, when the first wait starts; from then until the wait
// ends (lock taken, timeout, error, exit) the run is listed in `queueWaitingDir`. Throws
// QueueTimeoutError after `timeoutMs`, QueueBlockedError at once when waiting cannot help. Returns
// { release(), waitedMs }; release() removes the lock only if it is ours.
export async function acquireQueue({ owner, timeoutMs, pollMs = 2000, onWait, lockDir = queueLockDir() }) {
  const t0 = Date.now();
  const mine = { pid: process.pid, ...owner, started: null, token: randomBytes(8).toString('hex') };
  let unlist = () => {};
  try {
    return await waitForLock({ mine, t0, timeoutMs, pollMs, lockDir, onWait: (holder) => {
      unlist = registerWaiting(lockDir, { pid: mine.pid, root: mine.root, layer: mine.layer, since: new Date().toISOString() }, mine.token);
      onWait?.(holder);
    } });
  } finally {
    unlist();
  }
}

async function waitForLock({ mine, t0, timeoutMs, pollMs, lockDir, onWait }) {
  let warned = false;
  prepareBase(dirname(lockDir));
  for (;;) {
    try {
      try { mkdirSync(lockDir); } catch (e) {
        if (['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EROFS'].includes(e.code)) throw new QueueBlockedError('base', dirname(lockDir), e);
        throw e;
      }
      mine.started = new Date().toISOString();
      try { writeFileSync(join(lockDir, OWNER), JSON.stringify(mine)); } catch (e) { rmSync(lockDir, { recursive: true, force: true }); throw e; }
      const waitedMs = Date.now() - t0;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (readOwner(lockDir)?.token === mine.token) rmSync(lockDir, { recursive: true, force: true });
      };
      return { release, waitedMs: warned ? waitedMs : 0 };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const holder = readOwner(lockDir);
    if (stale(lockDir, holder) && takeOver(lockDir, holder)) continue;
    const waited = Date.now() - t0;
    if (waited >= timeoutMs) throw new QueueTimeoutError(holder, waited);
    if (!warned) { warned = true; onWait?.(holder ?? {}); }
    await sleep(Math.min(pollMs, Math.max(1, timeoutMs - waited)));
  }
}

// An unreadable waiting entry younger than this may still be in the making: it is left alone.
const UNREADABLE_GRACE_MS = 10_000;

// View of the queue (creates nothing): `lock` is the holder ({pid, root, layer, started, alive}; null
// fields while the owner file is being written) or null when free; `waiting` lists the live waiting
// runs, oldest first. It also cleans up: entries of dead processes, and unreadable ones older than
// 10 s, are skipped and removed; a younger unreadable entry is only skipped.
export function readQueueStatus({ lockDir = queueLockDir() } = {}) {
  let lock = null;
  if (existsSync(lockDir)) {
    const o = readOwner(lockDir) ?? {};
    const pid = Number.isInteger(o.pid) ? o.pid : null;
    lock = { pid, root: o.root ?? null, layer: o.layer ?? null, started: o.started ?? null, alive: pid === null ? !stale(lockDir, null) : alive(pid) };
  }
  const dir = queueWaitingDir(lockDir);
  const waiting = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { /* none yet */ }
  for (const name of names) {
    const file = join(dir, name);
    let e = null;
    try { e = JSON.parse(readFileSync(file, 'utf8')); } catch { /* unreadable */ }
    if (e && alive(e.pid)) { waiting.push({ pid: e.pid, root: e.root ?? null, layer: e.layer ?? null, since: e.since ?? null }); continue; }
    if (!e) {
      let young = false;
      try { young = Date.now() - statSync(file).mtimeMs < UNREADABLE_GRACE_MS; } catch { continue; } // already gone
      if (young) continue;
    }
    try { rmSync(file, { force: true }); } catch { /* another user's entry */ }
  }
  waiting.sort((a, b) => String(a.since).localeCompare(String(b.since)));
  return { lock, waiting };
}
