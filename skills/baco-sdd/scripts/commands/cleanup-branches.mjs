import { t } from '../lib/messages.mjs';
import { protectedBranches } from '../lib/config.mjs';
import { git, GitError, localBranches, worktrees, isAncestor, currentBranch, refExists, revParse, tagTarget } from '../lib/git.mjs';

export const usage = 'baco cleanup-branches [--apply] [--remote] [--remote-name <name>] [--json] [--cwd <dir>]';
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

export async function run(args, ctx) {
  const { root, config } = ctx;
  const { integration, main: mainBranch } = config.branches;
  const protectedList = protectedBranches(config);
  const apply = Boolean(args.flags.apply);
  const remote = args.flags.remote ? (typeof args.flags['remote-name'] === 'string' ? args.flags['remote-name'] : 'origin') : null;

  const { candidates, skipped } = evaluateCleanup({
    branches: localBranches(root),
    worktrees: worktrees(root),
    current: currentBranch(root),
    protectedList,
    integration: refExists(integration, root) ? integration : null,
    mainBranch: mainBranch && refExists(mainBranch, root) ? mainBranch : null,
    isMergedInto: (b, target) => isAncestor(`refs/heads/${b}`, `refs/heads/${target}`, root),
    tipOf: (b) => revParse(`refs/heads/${b}`, root),
  });

  const reason = (r) => t(ctx.lang, `cleanup.reason.${r}`);
  const skippedMessages = skipped.map((s) => ({ key: 'cleanup.skipped', params: { ...s, reason: reason(s.reason) } }));
  if (!apply) {
    const messages = [];
    for (const c of candidates) {
      messages.push({ key: 'cleanup.candidate', params: { ...c, reason: reason(c.reason), worktree: c.worktree ?? '-' } });
      if (remote) {
        c.remote_action = remoteAction(remote, c, root);
        messages.push({ key: `cleanup.remote.${c.remote_action}`, params: { branch: c.branch, remote } });
      }
    }
    messages.push(...skippedMessages);
    if (!candidates.length) messages.push({ key: 'cleanup.nothing' });
    else messages.push({ key: 'cleanup.dry_run_hint' });
    return { code: 0, data: { apply: false, candidates, skipped }, messages };
  }

  const { done, failed, warnings, messages } = applyCleanup(candidates, { root, remote, protectedList });
  messages.push(...skippedMessages);
  if (!candidates.length) messages.push({ key: 'cleanup.nothing' });
  return { code: failed.length ? 1 : 0, data: { apply: true, candidates, skipped, done, failed, warnings }, messages };
}
