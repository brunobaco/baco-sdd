// Pure decisions of the plugin hooks `hooks/context-size.mjs` and `hooks/baco-context.mjs`, kept here
// so the tests can import them (the hooks run at import time). No I/O in this file, except
// `readAutoCompactWindow`, `readPluginVersion` and `newestPluginVersion`, which read files and fail open.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Claude Code summarizes the conversation by itself at about `autoCompactWindow` minus this many
// tokens (measured: 18 automatic summaries between 366000 and 375000 tokens with a 400000 window),
// not at a fraction of it.
export const AUTO_COMPACT_RESERVE = 33000;
export const RETOMADA_STALE_MS = 30 * 60 * 1000;
// A task branch `baco/ENT-NNN-<TASK-ID>`: plan tasks `T-NNN` and the phase 7 fix tasks `FIX-NN` and
// `INT-NN` (implementation.md, section 2). The promotion branch `baco/ENT-NNN-PROMO` is not a task.
export const TASK_BRANCH = /^baco\/(ENT-\d{3})-(?:T|FIX|INT)-\d+$/;

const positiveInt = (n) => (Number.isInteger(n) && n > 0 ? n : null);

// `autoCompactWindow` of the first settings object that has a valid one. The objects come in the
// order of precedence: project local, project, user.
export function pickAutoCompactWindow(settingsList) {
  for (const s of settingsList) {
    const n = positiveInt(s?.autoCompactWindow);
    if (n) return n;
  }
  return null;
}

// Reads the three settings files of Claude Code (fail open: an unreadable or invalid file is skipped).
export function readAutoCompactWindow(root, home, env = process.env) {
  const userDir = env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
  const files = [join(root, '.claude', 'settings.local.json'), join(root, '.claude', 'settings.json'), join(userDir, 'settings.json')];
  const parsed = files.map((f) => {
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  });
  return pickAutoCompactWindow(parsed);
}

// How long before Claude Code's own summary the warning comes. A conductor step adds 10000 to 20000
// tokens, and the warning is read only after the step that crossed the line: warning right at the
// auto-compact point left the conversation summarized before the switch (end-to-end test, round D).
export const AUTO_COMPACT_MARGIN = 30000;

// The size from which the warning fires: `context.handoff_at`, or, when it is smaller, the point where
// Claude Code summarizes the conversation by itself (`autoCompactWindow` - 33000, never below half the
// window, so a tiny window keeps a positive point) minus a safety margin (never more than half of that
// point). `autoCompactAt` is that point, for the warning's text.
export function effectiveLimit(handoffAt, autoCompactWindow) {
  const window = positiveInt(autoCompactWindow);
  if (!window) return { limit: handoffAt, source: 'config' };
  const auto = Math.max(window - AUTO_COMPACT_RESERVE, Math.floor(window / 2));
  const guard = auto - Math.min(AUTO_COMPACT_MARGIN, Math.floor(auto / 2));
  return guard < handoffAt ? { limit: guard, source: 'autoCompactWindow', autoCompactAt: auto } : { limit: handoffAt, source: 'config' };
}

// Whether to remind the conductor to update `## Retomada`: a task branch is open, `progresso.md`
// has not changed for 30 minutes and no reminder was sent in the last 30 minutes (per session).
export function retomadaReminderDue({ progressMtimeMs, nowMs, hasOpenTaskBranch, lastReminderMs = null, staleMs = RETOMADA_STALE_MS }) {
  if (!hasOpenTaskBranch) return false;
  if (!Number.isFinite(progressMtimeMs) || !Number.isFinite(nowMs)) return false;
  if (nowMs - progressMtimeMs <= staleMs) return false;
  if (Number.isFinite(lastReminderMs) && nowMs - lastReminderMs < staleMs) return false;
  return true;
}

// Delivery ids that have a task branch not yet merged into its delivery branch.
// `branches`: local branch names; `isMerged(branch, deliveryBranch)`: whether it is an ancestor.
export function openTaskDeliveries(branches, isMerged) {
  const set = new Set(branches);
  const open = [];
  for (const b of branches) {
    const m = TASK_BRANCH.exec(b);
    if (!m) continue;
    const delivery = `baco/${m[1]}`;
    if (set.has(delivery) && !isMerged(b, delivery) && !open.includes(m[1])) open.push(m[1]);
  }
  return open;
}

// Per-session state of the hooks: small files in a folder of os.tmpdir() named after the user
// (another Linux user's folder would refuse the write).
export function hookStateDir() {
  let who;
  try { who = userInfo().uid; } catch { who = -1; }
  if (!Number.isInteger(who) || who < 0) {
    try { who = userInfo().username; } catch { who = process.env.USER || process.env.USERNAME || 'anon'; }
  }
  return join(tmpdir(), `baco-context-size-${String(who).replace(/[^\w.-]/g, '_')}`);
}
export const sessionStateFile = (session, suffix = '') => join(hookStateDir(), `${String(session).replace(/[^\w.-]/g, '_')}${suffix}.json`);

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

// Compares two `X.Y.Z` versions: positive when `a` is newer, 0 when equal, null when either is not one.
export function compareVersions(a, b) {
  const pa = VERSION.exec(String(a ?? ''));
  const pb = VERSION.exec(String(b ?? ''));
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

// The version of the plugin installed at `root`: Claude Code's `.claude-plugin/plugin.json`, the
// Antigravity plugin's `plugin.json`, or the skill's `metadata.version`. Null when none is readable.
export function readPluginVersion(root) {
  for (const f of [join(root, '.claude-plugin', 'plugin.json'), join(root, 'plugin.json')]) {
    try {
      const v = JSON.parse(readFileSync(f, 'utf8')).version;
      if (VERSION.test(String(v ?? ''))) return v;
    } catch { /* next source */ }
  }
  try {
    const text = readFileSync(join(root, 'skills', 'baco-sdd', 'SKILL.md'), 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const v = /^metadata:\s*\n(?:[ \t]+.*\n)*?[ \t]+version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m.exec(`${front}\n`)?.[1];
    if (v) return v;
  } catch { /* none */ }
  return null;
}

// The newest version installed for the plugin running at `root`: its own, or a newer folder beside it
// when `root` is a version folder of the plugin cache (`.../cache/<marketplace>/baco/<version>/`).
// A checkout or any folder whose name is not a version has no siblings to compare. Null when nothing
// is readable.
export function newestPluginVersion(root) {
  let newest = readPluginVersion(root);
  if (!VERSION.test(basename(root))) return newest;
  let names = [];
  try { names = readdirSync(dirname(root)); } catch { return newest; }
  for (const name of names) {
    if (!VERSION.test(name) || name === basename(root)) continue;
    try { if (!statSync(join(dirname(root), name)).isDirectory()) continue; } catch { continue; }
    if (newest === null || compareVersions(name, newest) > 0) newest = name;
  }
  return newest;
}
