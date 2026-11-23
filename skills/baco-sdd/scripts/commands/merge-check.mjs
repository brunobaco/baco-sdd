import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, latestVerdict, numberedFiles, ENT_ID } from '../lib/delivery.mjs';
import { git, refExists, revParse, isAncestor, diffQuiet } from '../lib/git.mjs';
import { manualPendingRule } from '../lib/config.mjs';
import { loadTrace } from '../lib/tracefile.mjs';
import { readText, headings, tables, fold } from '../lib/markdown.mjs';
import { readWaiver } from '../lib/waiver.mjs';
import { freshnessCheck, mergeTraces, pendingItems, ProvenanceIgnoreError } from './acceptance-report.mjs';
import { STAMP_FILE, codePathspecs } from './run-tests.mjs';
import { t } from '../lib/messages.mjs';

export const usage = 'baco merge-check <ENT-NNN> --target <branch> [--pr <number>] [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const SHA = /^[0-9a-f]{7,64}$/;
const short = (sha) => String(sha).slice(0, 12);
const CI_WALK_MAX = 50; // commits looked at, from the tip back, for the last one CI checked
const TIMEOUT_SHARE = 0.7; // battery seconds above this share of the largest CI timeout: warning

// The section whose heading, folded, starts with `prefix`: 1-based lines of its heading (`start`) and of
// the next heading of the same or a higher level (`end`, Infinity at the end of the file); null when absent.
function sectionRange(md, prefix) {
  const hs = headings(md);
  const i = hs.findIndex((h) => fold(h.title).trim().startsWith(prefix));
  if (i < 0) return null;
  return { start: hs[i].line, end: hs.slice(i + 1).find((h) => h.level <= hs[i].level)?.line ?? Infinity };
}

// Open rows of the `## Esperando a pessoa` table of progresso.md: every non-empty row whose Situação
// does not start with "resolvido"/"resolvida" (emphasis or code around it and a note after it allowed).
export function waitingItems(md) {
  const s = sectionRange(md, 'esperando a pessoa');
  if (!s) return [];
  for (const tb of tables(md)) {
    if (tb.line <= s.start || tb.line >= s.end) continue;
    const col = (name) => tb.headers.findIndex((h) => fold(h).trim() === name);
    const state = col('situacao');
    if (state < 0) continue;
    const item = Math.max(col('item'), 0);
    return tb.rows.map((r) => r.cells)
      .filter((cells) => cells.some((x) => x.trim()))
      .filter((cells) => !/^resolvid[oa](?![a-z0-9])/.test(fold(cells[state] ?? '').replace(/^[\s`*_]+/, '')))
      .map((cells) => (cells[item] ?? '').trim() || '-');
  }
  return [];
}

// The person's choice to proceed at exit 3 for this verdict: a line of `## Decisões registradas` that
// names exit 3 ("saída 3" or "exit 3") and the verdict file (`veredito-NN`).
export function exit3Decided(md, verdictFile) {
  const s = sectionRange(md, 'decisoes registradas');
  if (!s) return false;
  const base = verdictFile.replace(/\.md$/, '');
  const named = new RegExp(`\\b${base}(?!\\d)`);
  // 0-based, the lines after the heading up to the next heading.
  return String(md).split('\n').slice(s.start, s.end === Infinity ? undefined : s.end - 1)
    .some((l) => { const f = fold(l); return /\b(saida|exit)[ -]?3\b/.test(f) && named.test(f); });
}

// A re-run argument names the failed test file: same path, or one ends with the other as a path
// suffix (a JUnit file relative to the test folder); a `:line` after the file is ignored.
const normPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/:\d+(:\d+)?$/, '');
const samePath = (arg, file) => {
  const a = normPath(arg);
  const b = normPath(file);
  return !!a && !!b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));
};

function readStamp(root) {
  const file = join(root, STAMP_FILE);
  if (!existsSync(file)) return { missing: true };
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    const valid = s && typeof s === 'object' && typeof s.head === 'string' && Array.isArray(s.layers) && s.layers.length > 0
      && s.layers.every((l) => l && typeof l === 'object' && typeof l.layer === 'string');
    return valid ? { stamp: s } : { unreadable: true };
  } catch { return { unreadable: true }; }
}

function batteryCondition({ root, config, tip, branch, target, read }) {
  if (read.missing) return { reason: 'no_stamp', params: { path: STAMP_FILE } };
  if (read.unreadable) return { reason: 'unreadable', params: { path: STAMP_FILE } };
  const s = read.stamp;
  const head = short(s.head);
  if (s.dirty !== false) return { reason: 'dirty', params: { head } };
  if (!SHA.test(s.head) || !refExists(s.head, root)) return { reason: 'missing_head', params: { head } };
  if (!diffQuiet(s.head, tip, codePathspecs(config), root)) return { reason: 'code_changed', params: { head } };
  if (!refExists(target, root)) return { reason: 'target_missing', params: { target } };
  const refs = [[target, target]];
  if (refExists(`refs/remotes/origin/${target}`, root)) refs.push([`refs/remotes/origin/${target}`, `origin/${target}`]);
  for (const [ref, label] of refs) {
    if (!isAncestor(ref, tip, root)) return { reason: 'target_moved', params: { ref: label, branch } };
  }
  const reruns = (Array.isArray(s.reruns) ? s.reruns : []).filter((r) => r && r.exit === 0 && Array.isArray(r.args));
  const flaky = [];
  const unproven = [];
  for (const l of s.layers) {
    if (l.exit === 0) continue;
    const failures = (Array.isArray(l.failures) ? l.failures : []).filter((f) => f && typeof f === 'object');
    // A failed layer that listed no failing test cannot be proven by a re-run of some files.
    if (!failures.length) { unproven.push(l.layer); continue; }
    const own = reruns.filter((r) => r.layer === l.layer);
    for (const f of failures) {
      const covered = typeof f.file === 'string' && own.some((r) => r.args.some((a) => samePath(a, f.file)));
      if (covered) flaky.push({ layer: l.layer, name: String(f.name ?? '-'), file: f.file });
      else unproven.push(`${f.name ?? '-'} (${f.file ?? l.layer})`);
    }
  }
  if (unproven.length) return { reason: 'failed', params: { tests: unproven.join(', ') } };
  if (flaky.length) return { ok: true, reason: 'ok_flaky', params: { head, tests: flaky.map((f) => `${f.name} (${f.file})`).join(', ') }, flaky };
  return { ok: true, reason: 'ok', params: { head, seconds: typeof s.seconds === 'number' ? s.seconds : '-' } };
}

function verdictCondition({ revDir, progress, isCurrent }) {
  const verdict = latestVerdict(revDir);
  if (verdict) {
    const files = numberedFiles(revDir, 'veredito');
    const file = files[files.length - 1].name;
    if (!(typeof verdict.reviewedHead === 'string' && isCurrent(verdict.reviewedHead))) return { reason: 'stale', params: { verdict: verdict.verdict, file } };
    if (verdict.verdict === 'aprovado') return { ok: true, reason: 'approved', params: { file } };
    if (progress !== null && exit3Decided(progress, file)) return { ok: true, reason: 'exit3', params: { file, verdict: verdict.verdict } };
    return { reason: 'not_approved', params: { file, verdict: verdict.verdict } };
  }
  // As in the acceptance report, a waiver counts only when no verdict was imported, and while current.
  const waiver = readWaiver(revDir);
  if (waiver) return { ok: isCurrent(waiver.head), reason: isCurrent(waiver.head) ? 'waived' : 'waiver_stale', params: { by: waiver.by, date: waiver.date } };
  return { reason: 'none' };
}

function manualCondition({ revDir, config, target }) {
  const rule = manualPendingRule(config, target);
  // Same fail-safe reading as the acceptance report: only `ignore` and `warn` let a pending scenario through.
  if (rule === 'ignore' || rule === 'warn') return { ok: true, reason: 'not_blocking', params: { target, rule } };
  let names = [];
  try { names = readdirSync(revDir).filter((n) => /^trace-.*\.json$/.test(n)).sort(); } catch { /* no review folder */ }
  if (!names.length) return { reason: 'no_trace', params: { target } };
  const traces = [];
  for (const n of names) {
    const r = loadTrace(join(revDir, n));
    if (r.error) return { reason: 'bad_trace', params: { path: `revisao/${n}` } };
    traces.push(r.trace);
  }
  // Specialist scenarios (only a specialist QA runs them) never count: pendingItems leaves them out.
  const p = pendingItems(mergeTraces(traces));
  const items = [...p.manual, ...p.auto];
  return items.length ? { reason: 'pending', params: { target, items: items.join(', ') } } : { ok: true, reason: 'ok', params: { target } };
}

// Runs gh (BACO_GH overrides the binary) and parses its JSON; { error } when it cannot run, fails or
// prints something else.
function gh(args, root) {
  const r = spawnSync(process.env.BACO_GH || 'gh', args, { cwd: root, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { error: r.error.message };
  if (r.status !== 0) return { error: String(r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status ?? r.signal}` };
  try { return { json: JSON.parse(r.stdout) }; } catch (e) { return { error: `JSON: ${e.message}` }; }
}

// Checks of GitHub (PR rollup or REST check runs): failed and running names, and how many succeeded.
// A skipped or neutral check run counts neither way.
function evaluateChecks(list) {
  const failed = [];
  const running = [];
  let passed = 0;
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const name = c.name ?? c.context ?? '?';
    if (c.__typename === 'StatusContext' || (c.context !== undefined && c.state !== undefined)) {
      const state = String(c.state ?? '').toUpperCase();
      if (state === 'SUCCESS') passed++;
      else if (state === 'PENDING' || state === 'EXPECTED') running.push(name);
      else failed.push(name);
      continue;
    }
    if (String(c.status ?? '').toUpperCase() !== 'COMPLETED') { running.push(name); continue; }
    const conclusion = String(c.conclusion ?? '').toUpperCase();
    if (conclusion === 'SUCCESS') passed++;
    else if (conclusion !== 'SKIPPED' && conclusion !== 'NEUTRAL') failed.push(name);
  }
  return { failed, running, passed };
}

// Whether a commit changes only Markdown files (against its first parent; a root commit, its files).
function markdownOnly(sha, root) {
  const [, parent] = git(['rev-list', '--parents', '-n', '1', sha], root).split(' ');
  const out = parent ? git(['-c', 'core.quotepath=off', 'diff', '--name-only', parent, sha], root) : git(['-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', sha], root);
  return out.split('\n').filter(Boolean).every((f) => f.endsWith('.md'));
}

function ciCondition({ root, pr, tip, branch }) {
  if (pr === undefined) return { reason: 'no_pr' };
  const view = gh(['pr', 'view', pr, '--json', 'headRefOid,statusCheckRollup'], root);
  if (view.error) return { reason: 'gh_failed', params: { message: view.error } };
  const { headRefOid, statusCheckRollup } = view.json ?? {};
  if (typeof headRefOid !== 'string' || !Array.isArray(statusCheckRollup)) return { reason: 'gh_failed', params: { message: 'headRefOid, statusCheckRollup' } };
  if (headRefOid !== tip) return { reason: 'head_mismatch', params: { pr, prHead: short(headRefOid), branch, tip: short(tip) } };
  const decide = (v, okResult) => {
    if (v.failed.length) return { reason: 'failed', params: { checks: v.failed.join(', ') } };
    if (v.running.length) return { reason: 'running', params: { checks: v.running.join(', ') } };
    return v.passed > 0 ? okResult : null;
  };
  const atTip = decide(evaluateChecks(statusCheckRollup), { ok: true, reason: 'ok', params: { count: statusCheckRollup.length, pr, tip: short(tip) } });
  if (atTip) return atTip;
  // No check on the tip (the CI ignores Markdown): ok when the nearest earlier commit with checks is
  // green and every commit after it, the tip included, changes only Markdown.
  const commits = git(['rev-list', '--first-parent', `--max-count=${CI_WALK_MAX}`, tip], root).split('\n').filter(Boolean);
  for (let i = 0; i < commits.length; i++) {
    const sha = commits[i];
    if (i > 0) {
      const runs = gh(['api', `repos/{owner}/{repo}/commits/${sha}/check-runs`], root);
      if (runs.error) return { reason: 'gh_failed', params: { message: runs.error } };
      if (!Array.isArray(runs.json?.check_runs)) return { reason: 'gh_failed', params: { message: 'check_runs' } };
      const found = decide(evaluateChecks(runs.json.check_runs), { ok: true, reason: 'ok_markdown', params: { sha: short(sha) } });
      if (found) return found;
    }
    if (!markdownOnly(sha, root)) return { reason: 'not_run', params: { sha: short(sha) } };
  }
  return { reason: 'no_checks', params: { branch } };
}

function policyCondition({ config, target }) {
  const b = config.branches ?? {};
  if (target === b.main) return { reason: 'main' };
  if (target === b.integration) {
    const value = config.delivery?.integration_merge ?? 'ask';
    return value === 'auto' ? { ok: true, reason: 'auto' } : { reason: 'ask', params: { value } };
  }
  return { reason: 'other', params: { target, integration: b.integration ?? '-' } };
}

// Largest `timeout-minutes` in .github/workflows/*.yml|*.yaml, or null when none is found.
export function ciTimeoutMinutes(root) {
  let names;
  try { names = readdirSync(join(root, '.github', 'workflows')); } catch { return null; }
  let max = null;
  for (const n of names.filter((x) => /\.ya?ml$/.test(x)).sort()) {
    let text;
    try { text = readFileSync(join(root, '.github', 'workflows', n), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/^\s*timeout-minutes:\s*['"]?(\d+(?:\.\d+)?)/gm)) {
      const v = Number(m[1]);
      if (max === null || v > max) max = v;
    }
  }
  return max;
}

export async function run(args, ctx) {
  const entId = args._[0];
  const target = args.flags.target;
  const pr = args.flags.pr;
  if (!entId || !ENT_ID.test(entId) || args._.length > 1 || typeof target !== 'string' || !target.trim()) return usageError();
  if (pr !== undefined && (typeof pr !== 'string' || !/^[1-9]\d*$/.test(pr))) return usageError();

  const dir = deliveryDir(ctx.root, ctx.config, entId); // not found -> 65 in the dispatcher
  const branch = `baco/${entId}`;
  if (!refExists(`refs/heads/${branch}`, ctx.root)) return { code: 65, data: {}, messages: [{ key: 'mergecheck.no_branch', params: { branch } }] };
  const tip = revParse(`refs/heads/${branch}`, ctx.root);
  const revDir = join(dir, 'revisao');
  const progressFile = join(dir, 'progresso.md');
  const progress = existsSync(progressFile) ? readText(progressFile) : null;
  const read = readStamp(ctx.root);

  const results = {};
  try {
    results.battery = batteryCondition({ root: ctx.root, config: ctx.config, tip, branch, target, read });
    results.verdict = verdictCondition({ revDir, progress, isCurrent: freshnessCheck({ head: tip, root: ctx.root, config: ctx.config }) });
  } catch (e) {
    if (!(e instanceof ProvenanceIgnoreError)) throw e;
    return { code: 65, data: {}, messages: [{ key: 'acceptance.provenance_ignore_failed', params: { message: e.message } }] };
  }
  results.manual = manualCondition({ revDir, config: ctx.config, target });
  const waiting = progress === null ? [] : waitingItems(progress);
  results.waiting = waiting.length ? { reason: 'open', params: { items: waiting.join(', ') } } : { ok: true, reason: 'ok' };
  results.ci = ciCondition({ root: ctx.root, pr, tip, branch });
  results.policy = policyCondition({ config: ctx.config, target });

  const conditions = Object.entries(results).map(([key, r]) => ({ key, ok: r.ok === true, detail: t(ctx.lang, `mergecheck.${key}.${r.reason}`, r.params), reason: r.reason }));
  const ok = conditions.every((c) => c.ok);
  const batterySeconds = typeof read.stamp?.seconds === 'number' ? read.stamp.seconds : null;
  const minutes = ciTimeoutMinutes(ctx.root);
  const warnings = [];
  if ((ctx.config.test_runs?.ci_full ?? 'merge') === 'merge' && batterySeconds !== null && minutes !== null && batterySeconds > TIMEOUT_SHARE * minutes * 60) warnings.push('battery.ci_timeout_near');

  const data = { delivery: entId, target, branch, tip, ok, conditions, warnings, batterySeconds, ciTimeoutMinutes: minutes, flaky: results.battery.flaky ?? [] };
  const messages = [
    { key: ok ? 'mergecheck.clean' : 'mergecheck.needs_person', params: { id: entId, target, count: conditions.filter((c) => !c.ok).length } },
    ...conditions.map((c) => ({ key: c.ok ? 'mergecheck.line_ok' : 'mergecheck.line_no', params: { name: t(ctx.lang, `mergecheck.name.${c.key}`), detail: c.detail } })),
    ...warnings.map((key) => ({ key, params: { seconds: batterySeconds, minutes } })),
  ];
  return { code: ok ? 0 : 2, data, messages };
}
