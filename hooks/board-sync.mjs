#!/usr/bin/env node
// PostToolUse hook on Edit/Write (Antigravity: file-writing tools): when a delivery's progresso.md
// is edited in a BACO project with `github.project` configured, triggers `baco board <ENT-NNN> --apply`
// in the background (detached, non-blocking). Uses a short-lived lock file per delivery to prevent
// concurrent syncs, derives the project root from the edited file path, and caps quadro-sync.log size.
// Failures are logged and never block or fail the edit. Zero dependencies.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, githubProject } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, quietAnswer } from './host.mjs';

const PROGRESS_RE = /(?:^|[/\\])entregas[/\\](ENT-\d{3})-[^/\\]+[/\\]progresso\.md$/;
const BACO_BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'baco-sdd', 'scripts', 'baco.mjs');
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
  const lockPath = join(logDir, `quadro-sync-${entId}.lock`);
  if (!acquireSyncLock(lockPath, nowFn(), ttlMs)) return false;

  const logPath = join(logDir, 'quadro-sync.log');
  trimLogIfNeeded(logPath, maxLogBytes, Math.min(KEEP_LOG_BYTES, Math.floor(maxLogBytes / 2)));
  let fd;
  try {
    fd = openSync(logPath, 'a');
    const child = spawnFn(process.execPath, [BACO_BIN, 'board', entId, '--apply', '--cwd', root], {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}

if (isMainModule(import.meta.url)) {
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
