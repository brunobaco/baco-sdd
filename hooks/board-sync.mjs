#!/usr/bin/env node
// PostToolUse hook on Edit/Write (Antigravity: file-writing tools): when a delivery's progresso.md
// is edited in a BACO project with `github.project` configured, triggers `baco board <ENT-NNN> --apply`
// in the background (detached, non-blocking). Failures are written to `.baco/logs/quadro-sync.log`
// and never block or fail the edit. Zero dependencies.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, githubProject } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, quietAnswer } from './host.mjs';

const PROGRESS_RE = /(?:^|[/\\])entregas[/\\](ENT-\d{3})-[^/\\]+[/\\]progresso\.md$/;
const BACO_BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'baco-sdd', 'scripts', 'baco.mjs');

export function extractDeliveryFromPath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const m = PROGRESS_RE.exec(filePath);
  return m ? m[1] : null;
}

const hasConfig = (dir) => existsSync(join(dir, '.baco', 'config.yaml'));

function bacoRoot(cwd) {
  if (hasConfig(cwd)) return cwd;
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return top !== '' && hasConfig(top) ? top : null;
  } catch {
    return null;
  }
}

export function maybeSyncBoard(hook, { spawnFn = spawn } = {}) {
  if (!hook || hook.subagent()) return false;
  const entId = extractDeliveryFromPath(hook.filePath);
  if (!entId) return false;
  const cwd = hook.cwd ?? dirname(hook.filePath);
  const root = bacoRoot(cwd);
  if (!root) return false;
  const config = loadConfig(root);
  if (!githubProject(config)) return false;

  const logDir = join(root, '.baco', 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, 'quadro-sync.log');
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
  } catch { /* fail open: never block the edit */ }
  process.stdout.write(quietAnswer(hook.host));
  process.exit(0);
}
