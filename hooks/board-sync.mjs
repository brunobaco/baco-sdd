#!/usr/bin/env node
// PostToolUse hook on Edit/Write (Antigravity: file-writing tools): when a delivery's progresso.md
// is edited in a BACO project with `github.project` configured, triggers `baco board <ENT-NNN> --apply`
// in a detached worker. Uses a short-lived lock file per delivery plus a dirty mark so concurrent
// edits never spawn parallel syncs and never lose the last edit; the worker removes the lock when
// finished, derives the project root from the edited file path, and caps quadro-sync.log size.
// Failures are logged and never block or fail the edit. Zero dependencies.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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

function acquireSyncLock(lockPath, now, ttlMs) {
  const payload = JSON.stringify({ pid: process.pid, at: now });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, payload, { flag: 'wx' });
      return true;
    } catch (e) {
      if (e?.code !== 'EEXIST') return false;
      let expired = true;
      try {
        const prev = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (typeof prev?.at === 'number' && now - prev.at < ttlMs) expired = false;
      } catch {
        // Corrupt or unreadable lock: treat as expired.
      }
      if (!expired) return false;
      try { unlinkSync(lockPath); } catch { /* raced with another cleaner */ }
    }
  }
  return false;
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
// and always removes the lock file on exit.
export function runBoardSyncWorker({ entId, root, execFn = spawnSync, maxRounds = 5 } = {}) {
  const logDir = join(root, '.baco', 'logs');
  const lockPath = join(logDir, `quadro-sync-${entId}.lock`);
  const dirtyPath = join(logDir, `quadro-sync-${entId}.dirty`);
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
      runOnce();
      if (!existsSync(dirtyPath)) break;
    }
  } finally {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
  // Catch a dirty mark written in the narrow window right before removing the lock.
  if (rounds < maxRounds && existsSync(dirtyPath) && acquireSyncLock(lockPath, Date.now(), DEFAULT_LOCK_TTL_MS)) {
    try {
      runOnce();
    } finally {
      try { unlinkSync(lockPath); } catch { /* already gone */ }
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
  if (!acquireSyncLock(lockPath, now, ttlMs)) {
    // Another sync is active: record a dirty mark so the worker re-runs after finishing.
    try { writeFileSync(dirtyPath, String(now)); } catch { /* best effort */ }
    return false;
  }

  const logPath = join(logDir, 'quadro-sync.log');
  trimLogIfNeeded(logPath, maxLogBytes, Math.min(KEEP_LOG_BYTES, Math.floor(maxLogBytes / 2)));
  let fd;
  try {
    fd = openSync(logPath, 'a');
    const child = spawnFn(process.execPath, [SELF_FILE, '--worker', entId, root], {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch (e) {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
    throw e;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

if (isMainModule(import.meta.url)) {
  if (process.argv[2] === '--worker') {
    const [, , , entId, root] = process.argv;
    if (entId && root) {
      try {
        runBoardSyncWorker({ entId, root });
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
