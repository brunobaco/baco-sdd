import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { t } from '../lib/messages.mjs';
import { protectedBranches } from '../lib/config.mjs';
import { git, GitError, localBranches, worktrees, isAncestor, currentBranch, refExists, revParse, tagTarget } from '../lib/git.mjs';

export const usage = 'baco cleanup-branches [--apply] [--remote] [--remote-name <name>] [--confirm-commands] [--json] [--cwd <dir>]';
export const needsRepo = true;

const DELIVERY = /^baco\/(ENT-\d{3})$/;
const TASK = /^baco\/(ENT-\d{3})-.+$/;
const PROMO = /^baco\/ENT-\d{3}-PROMO$/;
const DOCS = /^docs\/.+$/;
const short = (b) => (b ? b.replace(/^refs\/heads\//, '') : null);

// Pure. Returns { candidates, skipped }. `worktrees[0]` is the main worktree (git lists it first).
export function evaluateCleanup({ branches, worktrees: wts = [], current, protectedList = [], integration = null, mainBranch = null, isMergedInto, tipOf = () => null }) {
  const set = new Set(branches);
  const main = wts[0]?.path ?? null;
  const byBranch = new Map();
  for (const w of wts) if (short(w.branch)) byBranch.set(short(w.branch), w);
  const integrationOk = integration && set.has(integration);
  const candidates = [];
  const skipped = [];
  for (const branch of branches) {
    // The configured main and integration branches are never removed, whatever their names look like.
    if (branch === current || branch === integration || branch === mainBranch || protectedList.includes(branch)) continue;
    let reason = null;
    let target = null;
    let m;
    if (PROMO.test(branch) || DOCS.test(branch)) {
      // Cut from the integration tip (promotion) or from a base for document work: merged into the
      // integration branch or into main. A branch at the very tip of the target is kept: an empty
      // new branch cannot be told from one merged by fast-forward.
      reason = PROMO.test(branch) ? 'promo_merged' : 'docs_merged';
      const tip = tipOf(branch);
      target = [integration, mainBranch].find((tg) => tg && tg !== branch && set.has(tg) && isMergedInto(branch, tg) && !(tip && tip === tipOf(tg))) ?? null;
    } else if ((m = TASK.exec(branch))) {
      const delivery = `baco/${m[1]}`;
      target = set.has(delivery) ? delivery : null;
      if (!target && integrationOk) target = integration;
      reason = 'task_merged';
    } else if (DELIVERY.test(branch)) {
      if (integrationOk) target = integration;
      reason = 'delivery_merged';
    }
    if (!target || !isMergedInto(branch, target)) continue;
    const wt = byBranch.get(branch) ?? null;
    if (wt && wt.path === main) { skipped.push({ branch, reason: 'checked_out', worktree: wt.path }); continue; }
    candidates.push({ branch, sha: tipOf(branch), worktree: wt ? wt.path : null, reason, target });
  }
  // Task branches go first and delivery branches last, so deliveries are removed after their tasks.
  const order = { task_merged: 0, docs_merged: 1, promo_merged: 1, delivery_merged: 2 };
  candidates.sort((a, b) => order[a.reason] - order[b.reason]);
  return { candidates, skipped };
}

export function planCleanup(input) {
  return evaluateCleanup(input).candidates;
}

// Sha of refs/heads/<branch> on the remote, or null when the remote has no such branch.
export function remoteTip(remote, branch, cwd) {
  const listed = git(['ls-remote', '--heads', remote, `refs/heads/${branch}`], cwd);
  for (const line of listed.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (ref === `refs/heads/${branch}` && /^[0-9a-f]{7,64}$/.test(sha)) return sha;
  }
  return null;
}

// Dry-run view of the remote step: 'delete' (remote tip equals the local tip), 'keep_ahead'
// (remote differs: it would be kept and reported as remote_ahead), 'none' (no remote branch),
// 'error' (remote unreachable).
function remoteAction(remote, c, cwd) {
  try {
    const sha = remoteTip(remote, c.branch, cwd);
    if (sha === null) return 'none';
    return sha === c.sha ? 'delete' : 'keep_ahead';
  } catch {
    return 'error';
  }
}

// The merge commit on `target` that brought `tip` in: walking the first-parent history of `target`
// from the oldest commit not in `tip`, the first merge whose second parent is `tip` or has it as an
// ancestor. null when there is none (fast-forward, or merged some other way).
export function mergeCommitOf(tip, target, cwd) {
  const out = git(['rev-list', '--first-parent', '--reverse', '--min-parents=2', '--parents', `${tip}..refs/heads/${target}`], cwd);
  for (const line of out.split('\n')) {
    const [commit, , second] = line.split(' ');
    if (second && isAncestor(tip, second, cwd)) return commit;
  }
  return null;
}

function deleteLocal(branch, sha, cwd) {
  // Compare-and-delete: refuses when the branch moved since it was verified.
  git(['update-ref', '-d', `refs/heads/${branch}`, sha], cwd);
  try { git(['config', '--remove-section', `branch.${branch}`], cwd); } catch { /* no config section */ }
}

// Known 0-byte mount stubs that Claude Code's sandbox (`rede`) may leave inside worktrees (older
// versions left them on disk; checked with 2.1.331, which leaves none after the session, only the
// empty folder `.claude/.cc-writes`, and `git worktree remove` without `--force` accepts that).
// Files only, never folders. Removed one by one before `git worktree remove` ONLY when regular,
// 0 bytes, and untracked by git.
export const SANDBOX_EMPTY_STUBS = [
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/launch.json',
  '.claude/loop.md',
  '.claude/scheduled_tasks.json',
  '.mcp.json',
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.zshrc',
  '.zprofile',
  '.ripgreprc',
];

export function removeSandboxEmptyStubs(worktreePath) {
  if (!worktreePath || !existsSync(worktreePath)) return;
  let tracked = null;
  const isTracked = (rel) => {
    if (tracked === null) {
      try {
        tracked = new Set(git(['ls-files', '--', ...SANDBOX_EMPTY_STUBS], worktreePath).split('\n').filter(Boolean));
      } catch {
        // Fail closed: if git cannot tell us what is tracked, delete nothing.
        tracked = new Set(SANDBOX_EMPTY_STUBS);
      }
    }
    return tracked.has(rel);
  };
  let touchedClaude = false;
  for (const rel of SANDBOX_EMPTY_STUBS) {
    const full = join(worktreePath, rel);
    let st;
    try { st = lstatSync(full); } catch { continue; }
    if (!st.isFile() || st.size !== 0) continue;
    if (isTracked(rel)) continue;
    try {
      unlinkSync(full);
      if (rel.startsWith('.claude/')) touchedClaude = true;
    } catch { /* ignore: git worktree remove will report if blocked */ }
  }
  if (touchedClaude) {
    const claudeDir = join(worktreePath, '.claude');
    try {
      if (readdirSync(claudeDir).length === 0) rmdirSync(claudeDir);
    } catch { /* ignore */ }
  }
}

// Applies a plan. Each candidate is re-verified (not protected, tip unchanged and still merged)
// before anything is touched.
export function applyCleanup(candidates, { root, remote = null, protectedList = [] }) {
  const done = [];
  const failed = [];
  const warnings = [];
  const messages = [];
  const fail = (entry) => {
    failed.push(entry);
    messages.push({ key: 'cleanup.failed', params: { branch: entry.branch, step: entry.step, error: entry.error } });
  };
  for (const c of candidates) {
    const entry = { branch: c.branch, worktree_removed: false, tag: null, remote_deleted: false };
    if (protectedList.includes(c.branch)) {
      fail({ branch: c.branch, step: 'protected', error: 'protected branch' });
      continue;
    }
    let step = 'changed_since_plan';
    try {
      const tipNow = refExists(`refs/heads/${c.branch}`, root) ? revParse(`refs/heads/${c.branch}`, root) : null;
      if (!c.sha || tipNow !== c.sha || !isAncestor(c.sha, `refs/heads/${c.target}`, root)) {
        fail({ branch: c.branch, step, error: 'branch changed since plan' });
        continue;
      }
      step = 'worktree';
      if (c.worktree) {
        removeSandboxEmptyStubs(c.worktree);
        git(['worktree', 'remove', c.worktree], root);
        entry.worktree_removed = true;
      }
      if (c.reason === 'delivery_merged') {
        step = 'tag';
        const tag = `entrega/${DELIVERY.exec(c.branch)[1]}`;
        // The tag marks where the delivery entered the integration branch; the tip only as a fallback.
        let at = mergeCommitOf(c.sha, c.target, root);
        if (at === null) {
          at = c.sha;
          const params = { tag, branch: c.branch, target: c.target };
          warnings.push({ key: 'cleanup.tag_at_tip', params });
          messages.push({ key: 'cleanup.tag_at_tip', params });
        }
        const existing = tagTarget(tag, root);
        if (existing === null) { git(['tag', tag, at], root); entry.tag = tag; entry.tag_commit = at; }
        else if (existing !== at) {
          warnings.push({ key: 'cleanup.tag_elsewhere', params: { tag } });
          messages.push({ key: 'cleanup.tag_elsewhere', params: { tag } });
        }
      }
      step = 'branch';
      deleteLocal(c.branch, c.sha, root);
    } catch (e) {
      fail({ branch: c.branch, step, error: e.message });
      // The folder is gone but git could not remove its data under `.git/worktrees/<name>` (inside
      // Claude Code's sandbox that folder is read-only): the worktree is left `prunable`. Pruning
      // here would fail the same way, so the person runs `git worktree prune` outside the sandbox.
      if (step === 'worktree' && c.worktree && !existsSync(c.worktree)) {
        messages.push({ key: 'cleanup.worktree_prunable', params: { branch: c.branch, path: c.worktree } });
      }
      continue;
    }
    if (remote) {
      try {
        // Compare-and-delete on the remote too: delete only when the remote tip is exactly the
        // verified local tip, and push with a lease so a concurrent push is never destroyed.
        const remoteSha = remoteTip(remote, c.branch, root);
        if (remoteSha !== null) {
          if (remoteSha !== c.sha) {
            failed.push({ branch: c.branch, step: 'remote_ahead', error: `remote ${remote} has ${remoteSha}, planned ${c.sha}`, remote_sha: remoteSha, local_deleted: true });
            messages.push({ key: 'cleanup.remote_ahead', params: { branch: c.branch, remote } });
            continue;
          }
          git(['push', `--force-with-lease=refs/heads/${c.branch}:${c.sha}`, remote, `:refs/heads/${c.branch}`], root);
          entry.remote_deleted = true;
        }
      } catch (e) {
        fail({ branch: c.branch, step: 'remote', error: e.message, local_deleted: true });
        continue;
      }
    }
    done.push(entry);
    messages.push({ key: 'cleanup.done', params: { branch: c.branch } });
  }
  return { done, failed, warnings, messages };
}

const SHARED_LOGS = new Set(['harnesses.md', 'uso-ferramentas.jsonl', 'custo-fontes.json', 'quadro-sync.log', 'bateria-completa.json', 'cleanup-commands.sha256']);

function canonical(p) {
  try { return realpathSync(p); } catch { return p; }
}

// Plans removal of loose folders inside `.worktrees/` not registered as live git worktrees.
// ONLY empty folders are candidates (removed with rmdirSync). Any non-empty folder (git repo,
// broken worktree, loose or ignored files) is never deleted: it is listed in `skipped` for the person.
export function planOrphanWorktrees(root, wts = worktrees(root)) {
  const dir = join(root, '.worktrees');
  if (!existsSync(dir)) return { candidates: [], skipped: [] };
  const live = new Set(wts.map((w) => canonical(w.path)));
  const candidates = [];
  const skipped = [];
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (live.has(canonical(full))) continue;
    const rel = `.worktrees/${entry.name}`;
    let children;
    try { children = readdirSync(full); } catch { children = null; }
    if (children !== null && children.length === 0) candidates.push({ path: rel, kind: 'empty' });
    else skipped.push({ path: rel, reason: 'not_empty' });
  }
  return { candidates, skipped };
}

export function findOrphanWorktrees(root, wts = worktrees(root)) {
  return planOrphanWorktrees(root, wts).candidates.map((c) => c.path);
}

// Finds `.baco/logs/` entries belonging to deliveries whose branch is being closed (matches ENT-NNN
// as a whole token; shared project logs are never touched). Returns [{ path, entIds }].
function planDeliveryLogs(root, entIds) {
  const ids = [...new Set(entIds.filter(Boolean))];
  if (!ids.length) return [];
  const dir = join(root, '.baco', 'logs');
  if (!existsSync(dir)) return [];
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (SHARED_LOGS.has(entry.name)) continue;
    const matched = ids.filter((id) => new RegExp(`(?:^|[^A-Za-z0-9])${id}(?![0-9])`, 'i').test(entry.name));
    if (matched.length) out.push({ path: `.baco/logs/${entry.name}`, entIds: matched });
  }
  return out;
}

export function findDeliveryLogs(root, entIds) {
  return planDeliveryLogs(root, entIds).map((e) => e.path);
}

const COMMANDS_HASH_PATH = '.baco/logs/cleanup-commands.sha256';
const COMMANDS_HASH_FILE = join('.baco', 'logs', 'cleanup-commands.sha256');

// Canonical form of `cleanup.commands`: each command with the whitespace at its ends removed
// (blank entries dropped), in the order of the configuration, joined by "\n", SHA-256 in lowercase
// hex of the UTF-8 text. null when no command is declared.
export function cleanupCommandsHash(commands = []) {
  const list = commands.map((c) => String(c).trim()).filter(Boolean);
  if (!list.length) return null;
  return createHash('sha256').update(list.join('\n'), 'utf8').digest('hex');
}

// Compares the hash of the configured commands with the one recorded in `.baco/logs/`:
// 'none' (no commands), 'unconfirmed' (nothing recorded), 'confirmed' (same hash), 'changed'.
export function cleanupCommandsStatus(root, commands = []) {
  const list = commands.map((c) => String(c).trim()).filter(Boolean);
  const hash = cleanupCommandsHash(list);
  let recorded = null;
  try { recorded = readFileSync(join(root, COMMANDS_HASH_FILE), 'utf8').trim().toLowerCase() || null; } catch { /* not recorded yet */ }
  const status = hash === null ? 'none' : recorded === null ? 'unconfirmed' : recorded === hash ? 'confirmed' : 'changed';
  return { commands: list, hash, recorded, status };
}

function commandsMessages(info) {
  if (info.status === 'none') return [];
  const items = info.commands.map((command) => ({ key: 'cleanup.command_item', params: { command } }));
  if (info.status === 'confirmed') return [{ key: 'cleanup.commands_confirmed', params: { hash: info.hash } }, ...items];
  return [{ key: info.status === 'changed' ? 'cleanup.commands_changed' : 'cleanup.commands_unconfirmed', params: { hash: info.hash, recorded: info.recorded ?? '-' } }, ...items];
}

// Records the hash of the commands the person has just seen and approved.
function confirmCommands(root, commands) {
  const info = cleanupCommandsStatus(root, commands);
  if (info.hash === null) return { code: 0, data: { confirmed: false, commands: [], hash: null }, messages: [{ key: 'cleanup.commands_none' }] };
  const file = join(root, COMMANDS_HASH_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${info.hash}\n`);
  return {
    code: 0,
    data: { confirmed: true, commands: info.commands, hash: info.hash, path: COMMANDS_HASH_PATH },
    messages: [{ key: 'cleanup.commands_recorded', params: { path: COMMANDS_HASH_PATH, hash: info.hash } }],
  };
}

export async function run(args, ctx) {
  const { root, config } = ctx;
  if (args.flags['confirm-commands']) return confirmCommands(root, config.cleanup?.commands ?? []);
  const commandsInfo = cleanupCommandsStatus(root, config.cleanup?.commands ?? []);
  const { integration, main: mainBranch } = config.branches;
  const protectedList = protectedBranches(config);
  const apply = Boolean(args.flags.apply);
  const remote = args.flags.remote ? (typeof args.flags['remote-name'] === 'string' ? args.flags['remote-name'] : 'origin') : null;

  const wts = worktrees(root);
  const { candidates, skipped } = evaluateCleanup({
    branches: localBranches(root),
    worktrees: wts,
    current: currentBranch(root),
    protectedList,
    integration: refExists(integration, root) ? integration : null,
    mainBranch: mainBranch && refExists(mainBranch, root) ? mainBranch : null,
    isMergedInto: (b, target) => isAncestor(`refs/heads/${b}`, `refs/heads/${target}`, root),
    tipOf: (b) => revParse(`refs/heads/${b}`, root),
  });
  const orphanPlan = planOrphanWorktrees(root, wts);
  const orphanWorktrees = orphanPlan.candidates.map((c) => c.path);
  const skippedOrphans = orphanPlan.skipped;
  const closedDeliveries = candidates
    .filter((c) => c.reason === 'delivery_merged')
    .map((c) => DELIVERY.exec(c.branch)?.[1])
    .filter(Boolean);
  const deliveryLogPlan = planDeliveryLogs(root, closedDeliveries);
  const deliveryLogs = deliveryLogPlan.map((e) => e.path);

  const reason = (r) => t(ctx.lang, `cleanup.reason.${r}`);
  const skippedMessages = [
    ...skipped.map((s) => ({ key: 'cleanup.skipped', params: { ...s, reason: reason(s.reason) } })),
    ...skippedOrphans.map((s) => ({ key: `cleanup.orphan_skipped.${s.reason}`, params: { path: s.path } })),
  ];
  const hasAnything = candidates.length > 0 || orphanWorktrees.length > 0 || deliveryLogs.length > 0;
  if (!apply) {
    const messages = [];
    for (const c of candidates) {
      messages.push({ key: 'cleanup.candidate', params: { ...c, reason: reason(c.reason), worktree: c.worktree ?? '-' } });
      if (remote) {
        c.remote_action = remoteAction(remote, c, root);
        messages.push({ key: `cleanup.remote.${c.remote_action}`, params: { branch: c.branch, remote } });
      }
    }
    for (const p of orphanWorktrees) messages.push({ key: 'cleanup.orphan_worktree', params: { path: p } });
    for (const p of deliveryLogs) messages.push({ key: 'cleanup.delivery_log', params: { path: p } });
    messages.push(...skippedMessages);
    if (!hasAnything) messages.push({ key: 'cleanup.nothing' });
    else messages.push({ key: 'cleanup.dry_run_hint' });
    messages.push(...commandsMessages(commandsInfo));
    return { code: 0, data: { apply: false, candidates, skipped, orphanWorktrees, skippedOrphans, deliveryLogs, cleanupCommands: commandsInfo }, messages };
  }

  const { done, failed, warnings, messages } = applyCleanup(candidates, { root, remote, protectedList });
  const removedWorktrees = [];
  for (const item of orphanPlan.candidates) {
    const full = join(root, item.path);
    try {
      rmdirSync(full);
      removedWorktrees.push(item.path);
      messages.push({ key: 'cleanup.orphan_removed', params: { path: item.path } });
    } catch (e) {
      failed.push({ branch: item.path, step: 'orphan_worktree', error: e.message });
      messages.push({ key: 'cleanup.failed', params: { branch: item.path, step: 'orphan_worktree', error: e.message } });
    }
  }
  if (removedWorktrees.length || done.some((d) => d.worktree_removed)) {
    try { git(['worktree', 'prune'], root); } catch { /* best effort */ }
  }
  const closedOk = new Set(done.filter((d) => DELIVERY.test(d.branch)).map((d) => DELIVERY.exec(d.branch)[1]));
  const removedLogs = [];
  for (const item of deliveryLogPlan) {
    if (!item.entIds.every((id) => closedOk.has(id))) continue;
    try {
      rmSync(join(root, item.path), { recursive: true, force: true });
      removedLogs.push(item.path);
      messages.push({ key: 'cleanup.log_removed', params: { path: item.path } });
    } catch (e) {
      failed.push({ branch: item.path, step: 'delivery_log', error: e.message });
      messages.push({ key: 'cleanup.failed', params: { branch: item.path, step: 'delivery_log', error: e.message } });
    }
  }
  messages.push(...skippedMessages);
  if (!hasAnything) messages.push({ key: 'cleanup.nothing' });
  messages.push(...commandsMessages(commandsInfo));
  return {
    code: failed.length ? 1 : 0,
    data: { apply: true, candidates, skipped, done, failed, warnings, orphanWorktrees, skippedOrphans, removedWorktrees, deliveryLogs, removedLogs, cleanupCommands: commandsInfo },
    messages,
  };
}
