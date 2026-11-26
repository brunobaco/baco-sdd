#!/usr/bin/env node
// PostToolUse hook on Edit/Write (Antigravity: file-writing tools): when a delivery's progresso.md
// is edited in a BACO project with `github.project` configured, triggers `baco board <ENT-NNN> --apply`
// in a detached worker. Uses a short-lived lock file per delivery plus a dirty mark so concurrent
// edits never spawn parallel syncs and never lose the last edit; the lock names one owner (pid and
// random nonce), the worker renews its timestamp each round and removes it when finished only while
// it is still its own; the project root comes from the edited file path; quadro-sync.log is capped.
// Failures are logged and never block or fail the edit. Zero dependencies.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, githubProject } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, quietAnswer } from './host.mjs';

const PROGRESS_RE = /(?:^|[/\\])entregas[/\\](ENT-\d{3})-[^/\\]+[/\\]progresso\.md$/;
const SELF_FILE = fileURLToPath(import.meta.url);
const BACO_BIN = resolve(dirname(SELF_FILE), '..', 'skills', 'baco-sdd', 'scripts', 'baco.mjs');
const DEFAULT_LOCK_TTL_MS = 30_000;
const MAX_LOG_BYTES = 256 * 1024;
const KEEP_LOG_BYTES = 64 * 1024;

export function extractDeliveryFromPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const m = PROGRESS_RE.exec(filePath);
  return m ? m[1] : null;
}

const hasConfig = (dir) => existsSync(join(dir, '.baco', 'config.yaml'));

function bacoRootFromDir(startDir) {
  let cur = resolve(startDir);
  while (true) {
    if (hasConfig(cur)) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: startDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top !== '' && hasConfig(top) ? top : null;
  } catch {
    return null;
  }
}

const newNonce = () => randomBytes(8).toString('hex');
const lockBody = (nonce, at) => JSON.stringify({ pid: process.pid, nonce, at });

// The lock names one owner: the pid that wrote it and a random nonce. The nonce travels to the worker,
// so only the process that holds it may renew or remove the lock (a lock that expired and went to
// another process is never touched by the previous owner).
function readLock(lockPath) {
  try {
    const raw = readFileSync(lockPath, 'utf8');
    let lock = null;
    try { lock = JSON.parse(raw); } catch { /* corrupt */ }
    return { raw, lock };
  } catch {
    return null;
  }
}

function acquireSyncLock(lockPath, now, ttlMs, nonce = newNonce()) {
  const payload = lockBody(nonce, now);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, payload, { flag: 'wx' });
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') return false;
      const prev = readLock(lockPath);
      let expired = true;
      if (typeof prev?.lock?.at === 'number' && now - prev.lock.at < ttlMs) expired = false;
      if (!expired) return false;
      // Corrupt or expired: remove it only if it is still the very lock we judged (not a fresh one).
      if (readLock(lockPath)?.raw !== prev?.raw) continue;
      try { unlinkSync(lockPath); } catch { /* raced with another cleaner */ }
    }
  }
  return false;
}

// Removes the lock only when it still belongs to `nonce`.
function releaseSyncLock(lockPath, nonce) {
  if (readLock(lockPath)?.lock?.nonce !== nonce) return false;
  try { unlinkSync(lockPath); return true; } catch { return false; }
}

// Renews the timestamp of the lock that belongs to `nonce` (atomic rename); a lock that vanished is
// taken back. False when the lock now belongs to someone else (or is corrupt): the caller must stop.
function renewSyncLock(lockPath, nonce, now) {
  const cur = readLock(lockPath);
  if (cur === null) {
    try { writeFileSync(lockPath, lockBody(nonce, now), { flag: 'wx' }); return true; } catch { return false; }
  }
  if (cur.lock?.nonce !== nonce) return false;
  const tmp = `${lockPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, lockBody(nonce, now));
    renameSync(tmp, lockPath);
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
  }
  return true;
}

function trimLogIfNeeded(logPath, maxBytes = MAX_LOG_BYTES, keepBytes = KEEP_LOG_BYTES) {
  try {
    if (!existsSync(logPath)) return;
    if (statSync(logPath).size <= maxBytes) return;
    const buf = readFileSync(logPath);
    let slice = buf.subarray(Math.max(0, buf.length - keepBytes));
    const nl = slice.indexOf(0x0a);
    if (nl >= 0 && nl + 1 < slice.length) slice = slice.subarray(nl + 1);
    writeFileSync(logPath, slice);
  } catch { /* best effort */ }
}

// Worker loop run by the detached child process: runs `baco board <ENT-NNN> --apply`, checks if a
// concurrent edit recorded a dirty mark while it ran, re-runs until clean (capped at maxRounds),
// and removes the lock file on exit, but only while the lock is still its own. Each round renews the
// lock timestamp; when the lock went to another process (it expired during a long round) the worker
// stops and leaves the dirty mark for the new owner. `owner` is the nonce the hook wrote in the lock.
export function runBoardSyncWorker({ entId, root, execFn = spawnSync, maxRounds = 5, owner, nowFn = () => Date.now() } = {}) {
  const logDir = join(root, '.baco', 'logs');
  const lockPath = join(logDir, `quadro-sync-${entId}.lock`);
  const dirtyPath = join(logDir, `quadro-sync-${entId}.dirty`);
  const nonce = owner ?? readLock(lockPath)?.lock?.nonce ?? newNonce();
  let rounds = 0;
  const runOnce = () => {
    try { unlinkSync(dirtyPath); } catch { /* not dirty */ }
    rounds++;
    execFn(process.execPath, [BACO_BIN, 'board', entId, '--apply', '--cwd', root], {
      cwd: root,
      stdio: 'inherit',
    });
  };
  try {
    while (rounds < maxRounds) {
      if (!renewSyncLock(lockPath, nonce, nowFn())) break;
      runOnce();
      if (!existsSync(dirtyPath)) break;
    }
  } finally {
    releaseSyncLock(lockPath, nonce);
  }
  // Catch a dirty mark written in the narrow window right before removing the lock.
  const tailNonce = newNonce();
  if (rounds < maxRounds && existsSync(dirtyPath) && acquireSyncLock(lockPath, nowFn(), DEFAULT_LOCK_TTL_MS, tailNonce)) {
    try {
      runOnce();
    } finally {
      releaseSyncLock(lockPath, tailNonce);
    }
  }
  return rounds;
}

export function maybeSyncBoard(hook, { spawnFn = spawn, nowFn = () => Date.now(), ttlMs = DEFAULT_LOCK_TTL_MS, maxLogBytes = MAX_LOG_BYTES } = {}) {
  if (!hook || hook.subagent()) return false;
  const entId = extractDeliveryFromPath(hook.filePath);
  if (!entId) return false;
  // Derive project root from the edited file path, never blindly from cwd.
  const absFile = isAbsolute(hook.filePath)
    ? hook.filePath
    : resolve(hook.cwd || process.cwd(), hook.filePath);
  const startDir = dirname(absFile);
  const root = bacoRootFromDir(existsSync(startDir) ? startDir : (hook.cwd || process.cwd()));
  if (!root) return false;
  const config = loadConfig(root);
  if (!githubProject(config)) return false;

  const logDir = join(root, '.baco', 'logs');
  mkdirSync(logDir, { recursive: true });
  const now = nowFn();
  const lockPath = join(logDir, `quadro-sync-${entId}.lock`);
  const dirtyPath = join(logDir, `quadro-sync-${entId}.dirty`);
  const nonce = newNonce();
  if (!acquireSyncLock(lockPath, now, ttlMs, nonce)) {
    // Another sync is active: record a dirty mark so the worker re-runs after finishing.
    try { writeFileSync(dirtyPath, String(now)); } catch { /* best effort */ }
    return false;
  }

  const logPath = join(logDir, 'quadro-sync.log');
  trimLogIfNeeded(logPath, maxLogBytes, Math.min(KEEP_LOG_BYTES, Math.floor(maxLogBytes / 2)));
  let fd;
  try {
    fd = openSync(logPath, 'a');
    const child = spawnFn(process.execPath, [SELF_FILE, '--worker', entId, root, nonce], {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch (e) {
    releaseSyncLock(lockPath, nonce);
    throw e;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv[2] === '--worker') {
    const [, , , entId, root, owner] = process.argv;
    if (entId && root) {
      try {
        runBoardSyncWorker({ entId, root, owner });
      } catch (e) {
        process.stderr.write(`baco board-sync worker: ${e?.message ?? e}\n`);
      }
    }
    process.exit(0);
  }
  let hook = readHookInput(null);
  try {
    hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    maybeSyncBoard(hook);
  } catch (e) {
    process.stderr.write(`baco board-sync: ${e?.message ?? e}\n`);
  }
  process.stdout.write(quietAnswer(hook.host));
  process.exit(0);
}
