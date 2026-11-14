// Pure decisions of the plugin hook `hooks/context-size.mjs`, kept here so the tests can import them
// (the hook itself runs at import time). No I/O in this file, except `readAutoCompactWindow`, which
// reads settings files and fails open.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Claude Code summarizes the conversation by itself at about this fraction of `autoCompactWindow`.
export const AUTO_COMPACT_FRACTION = 0.8;
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
// Claude Code summarizes the conversation by itself (80% of `autoCompactWindow`) minus a safety margin
// (never more than half of that point). `autoCompactAt` is that point, for the warning's text.
export function effectiveLimit(handoffAt, autoCompactWindow) {
  const window = positiveInt(autoCompactWindow);
  if (!window) return { limit: handoffAt, source: 'config' };
  const auto = Math.floor(window * AUTO_COMPACT_FRACTION);
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
