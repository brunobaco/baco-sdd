import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, latestVerdict, numberedFiles, readPlanHeader, ENT_ID } from '../lib/delivery.mjs';
import { git, refExists, revParse, isAncestor, diffQuiet } from '../lib/git.mjs';
import { manualPendingRule } from '../lib/config.mjs';
import { loadTrace } from '../lib/tracefile.mjs';
import { readText, headings, tables, fold } from '../lib/markdown.mjs';
import { readWaiver } from '../lib/waiver.mjs';
import { combineDecision, freshnessCheck, mergeDecision, mergeTraces, pendingItems, provenanceBlockers, ProvenanceIgnoreError } from './acceptance-report.mjs';
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

// The template's placeholder row: every non-empty cell is `<...>` (backticks already removed).
const placeholderRow = (cells) => cells.filter((x) => x.trim()).every((x) => /^<[^>]*>$/.test(x.trim()));

// The `## Esperando a pessoa` section of progresso.md, read failing closed. { readable: false } when
// the section has any content (HTML comments aside) that is not one table with a Situação column;
// otherwise { readable: true, items }: the Item cell of every non-empty row whose Situação does not
// start with "resolvido"/"resolvida" (emphasis or code around it and a note after it allowed), the
// template's placeholder row left out. No section, an empty one or an empty table: no items.
export function waitingState(md) {
  const s = sectionRange(md, 'esperando a pessoa');
  if (!s) return { readable: true, items: [] };
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const last = s.end === Infinity ? lines.length : s.end - 1; // 1-based line numbers inside the section
  const content = [];
  let inComment = false;
  for (let n = s.start + 1; n <= last; n++) {
    let l = lines[n - 1];
    if (inComment) { const e = l.indexOf('-->'); if (e < 0) continue; l = l.slice(e + 3); inComment = false; }
    l = l.replace(/<!--.*?-->/g, '');
    const open = l.indexOf('<!--');
    if (open >= 0) { l = l.slice(0, open); inComment = true; }
    if (l.trim()) content.push(n);
  }
  if (!content.length) return { readable: true, items: [] };
  const tb = tables(md).find((x) => x.line > s.start && x.line <= last);
  if (!tb) return { readable: false };
  const col = (name) => tb.headers.findIndex((h) => fold(h).trim() === name);
  const state = col('situacao');
  if (state < 0) return { readable: false };
  const span = new Set([tb.line, tb.line + 1, ...tb.rows.map((r) => r.line)]);
  if (content.some((n) => !span.has(n))) return { readable: false };
  const item = Math.max(col('item'), 0);
  const items = tb.rows.map((r) => r.cells)
    .filter((cells) => cells.some((x) => x.trim()) && !placeholderRow(cells))
    .filter((cells) => !/^resolvid[oa](?![a-z0-9])/.test(fold(cells[state] ?? '').replace(/^[\s`*_]+/, '')))
    .map((cells) => (cells[item] ?? '').trim() || '-');
  return { readable: true, items };
}

function waitingCondition(progress) {
  if (progress === null) return { reason: 'no_progress' };
  const w = waitingState(progress);
  if (!w.readable) return { reason: 'unreadable' };
  return w.items.length ? { reason: 'open', params: { items: w.items.join(', ') } } : { ok: true, reason: 'ok' };
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

// Names a re-run entry recorded as passed: only when that same name did not also fail in it (two
// browsers). An entry without the lists (recorded before them) or with both empty (a re-run that
// selected no test) proves nothing.
function rerunPassed(r) {
  const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const failed = new Set(names(r.failed));
  return new Set(names(r.passed).filter((n) => !failed.has(n)));
}

// With an `origin` remote, brings `origin/<target>` up to date before it is compared (a push to the
// target on GitHub is seen only after a fetch). true when there is no origin or the fetch worked.
function fetchTarget(root, target) {
  const bin = process.env.BACO_GIT || 'git';
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const remote = spawnSync(bin, ['remote', 'get-url', 'origin'], { cwd: root, env, stdio: 'ignore' });
  if (remote.status !== 0) return true;
  const r = spawnSync(bin, ['fetch', '--quiet', 'origin', target], { cwd: root, env, stdio: 'ignore', timeout: 120000 });
  return r.status === 0;
}

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
  if (!fetchTarget(root, target)) return { reason: 'fetch_failed', params: { target } };
  if (!refExists(target, root)) return { reason: 'target_missing', params: { target } };
  const refs = [[target, target]];
  if (refExists(`refs/remotes/origin/${target}`, root)) refs.push([`refs/remotes/origin/${target}`, `origin/${target}`]);
  for (const [ref, label] of refs) {
    if (!isAncestor(ref, tip, root)) return { reason: 'target_moved', params: { ref: label, branch } };
  }
  // Re-runs are recorded only on the stamp's head (run-tests), so each one came after the battery.
  const reruns = (Array.isArray(s.reruns) ? s.reruns : []).filter((r) => r && typeof r === 'object');
  const flaky = [];
  const unproven = [];
  for (const l of s.layers) {
    if (l.exit === 0) continue;
    const failures = (Array.isArray(l.failures) ? l.failures : []).filter((f) => f && typeof f === 'object');
    // A failed layer that listed no failing test cannot be proven by a re-run of some tests.
    if (!failures.length) { unproven.push(l.layer); continue; }
    const own = reruns.filter((r) => r.layer === l.layer).map(rerunPassed);
    for (const f of failures) {
      // Flaky only when a re-run of the layer shows that same test name passing.
      const covered = typeof f.name === 'string' && f.name !== '' && own.some((passed) => passed.has(f.name));
      if (covered) flaky.push({ layer: l.layer, name: String(f.name ?? '-'), file: f.file });
      else unproven.push(`${f.name ?? '-'} (${f.file ?? l.layer})`);
    }
  }
  if (unproven.length) return { reason: 'failed', params: { tests: unproven.join(', ') } };
  if (flaky.length) return { ok: true, reason: 'ok_flaky', params: { head, tests: flaky.map((f) => `${f.name} (${f.file})`).join(', ') }, flaky };
  return { ok: true, reason: 'ok', params: { head, seconds: typeof s.seconds === 'number' ? s.seconds : '-' } };
}

function verdictCondition({ revDir, progress, isCurrent, config, lang }) {
  const verdict = latestVerdict(revDir);
  if (verdict) {
    const files = numberedFiles(revDir, 'veredito');
    const file = files[files.length - 1].name;
    if (!(typeof verdict.reviewedHead === 'string' && isCurrent(verdict.reviewedHead))) return { reason: 'stale', params: { verdict: verdict.verdict, file } };
    if (verdict.verdict === 'aprovado') {
      // With `ambos`, the agent reviews first and the person last: the aprovado that counts is the person's.
      // The footer's `source`: `person` (import-verdict), `agent` (import-pr-verdict); none: unknown.
      if (config.review?.pr?.reviewer === 'ambos' && verdict.source !== 'person') {
        const who = t(lang, `mergecheck.verdict.source.${verdict.source === 'agent' ? 'agent' : 'unknown'}`);
        return { reason: 'needs_person', params: { file, who } };
      }
      return { ok: true, reason: 'approved', params: { file } };
    }
    if (progress !== null && exit3Decided(progress, file)) {
      // Under auto, the merge after an exit-3 choice is still decided with the person, per blocker (gates.md).
      if ((config.delivery?.integration_merge ?? 'ask') === 'auto') return { reason: 'exit3_auto', params: { file, verdict: verdict.verdict } };
      return { ok: true, reason: 'exit3', params: { file, verdict: verdict.verdict } };
    }
    return { reason: 'not_approved', params: { file, verdict: verdict.verdict } };
  }
  // As in the acceptance report, a waiver counts only when no verdict was imported, and while current.
  const waiver = readWaiver(revDir);
  if (waiver) return { ok: isCurrent(waiver.head), reason: isCurrent(waiver.head) ? 'waived' : 'waiver_stale', params: { by: waiver.by, date: waiver.date } };
  return { reason: 'none' };
}

// The delivery's traces `revisao/trace-*.json`, in name order: { traces, names }, or { error, path }
// for the first unreadable or filtered one (a trace of part of the criteria proves a task, not the
// delivery), or { none: true }.
function readTraces(revDir) {
  let names = [];
  try { names = readdirSync(revDir).filter((n) => /^trace-.*\.json$/.test(n)).sort(); } catch { /* no review folder */ }
  if (!names.length) return { none: true };
  const traces = [];
  for (const n of names) {
    const r = loadTrace(join(revDir, n));
    if (r.error || (r.trace.filter !== undefined && r.trace.filter !== null)) return { error: true, path: `revisao/${n}` };
    traces.push(r.trace);
  }
  return { traces, names };
}

function manualCondition({ read, config, target, isCurrent }) {
  const rule = manualPendingRule(config, target);
  // Same fail-safe reading as the acceptance report: only `ignore` and `warn` let a pending scenario through.
  if (rule === 'ignore' || rule === 'warn') return { ok: true, reason: 'not_blocking', params: { target, rule } };
  if (read.none) return { reason: 'no_trace', params: { target } };
  if (read.error) return { reason: 'bad_trace', params: { path: read.path } };
  // Under a blocking rule, a trace of older code says nothing about the scenarios of this code.
  const stale = read.names.filter((n, i) => !(typeof read.traces[i].head === 'string' && read.traces[i].head && isCurrent(read.traces[i].head)));
  if (stale.length) return { reason: 'stale_trace', params: { paths: stale.map((n) => `revisao/${n}`).join(', ') } };
  // Specialist scenarios of a configured kind (only a specialist QA runs them) never count.
  const p = pendingItems(mergeTraces(read.traces), config.qa?.specialist ?? []);
  const items = [...p.manual, ...p.auto];
  return items.length ? { reason: 'pending', params: { target, items: items.join(', ') } } : { ok: true, reason: 'ok', params: { target } };
}

// What `acceptance-report` decides, with the delivery's traces, its latest verdict or waiver and its
// plan, against the delivery tip and the rule for this target: ok only when the merge is allowed and
// no automated test is left not run (`merge.not_run`, a warning under a `warn` rule).
function acceptanceCondition({ read, dir, revDir, config, target, entId, tip, isCurrent, lang }) {
  if (read.none) return { reason: 'no_trace' };
  if (read.error) return { reason: 'bad_trace', params: { path: read.path } };
  let planText = '';
  try { planText = readText(join(dir, 'plano.md')); } catch { /* no plan: no specs, a blocker below */ }
  const { specs: planSpecs } = readPlanHeader(planText);
  const verdict = latestVerdict(revDir);
  const recorded = readWaiver(revDir);
  const waiver = recorded ? { ...recorded, current: isCurrent(recorded.head) } : null;
  const prov = provenanceBlockers({ traces: read.traces, verdict, head: tip, entId, planSpecs, isCurrent });
  const base = mergeDecision({ trace: mergeTraces(read.traces), verdict, rule: manualPendingRule(config, target), waiver, specialist: config.qa?.specialist ?? [] });
  const decision = combineDecision(base, prov);
  const params = {
    'merge.spec_not_traced': { paths: prov.specsNotTraced.join(', ') },
    'merge.trace_other_delivery': { id: entId },
    'merge.waiver_stale': { by: waiver?.by ?? '-', date: waiver?.date ?? '-' },
  };
  if (!decision.allowed) return { reason: 'blocked', params: { reasons: decision.blockers.map((k) => t(lang, k, params[k])).join(' ') }, blockers: decision.blockers };
  if (decision.warnings.includes('merge.not_run')) return { reason: 'not_run', params: { reasons: t(lang, 'merge.not_run') } };
  return { ok: true, reason: 'ok' };
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
// Any `*.md` counts here, unlike the battery's code rule (only Markdown under docs_root): this is about
// whether CI ran at all, and the CI template ignores `**.md` everywhere.
function markdownOnly(sha, root) {
  const [, parent] = git(['rev-list', '--parents', '-n', '1', sha], root).split(' ');
  const out = parent ? git(['-c', 'core.quotepath=off', 'diff', '--name-only', parent, sha], root) : git(['-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', sha], root);
  return out.split('\n').filter(Boolean).every((f) => f.endsWith('.md'));
}

function ciCondition({ root, pr, tip, branch, target }) {
  if (pr === undefined) return { reason: 'no_pr' };
  const view = gh(['pr', 'view', pr, '--json', 'headRefOid,statusCheckRollup,baseRefName,state'], root);
  if (view.error) return { reason: 'gh_failed', params: { message: view.error } };
  const { headRefOid, statusCheckRollup, baseRefName, state } = view.json ?? {};
  if (typeof headRefOid !== 'string' || !Array.isArray(statusCheckRollup) || typeof baseRefName !== 'string' || typeof state !== 'string') {
    return { reason: 'gh_failed', params: { message: 'headRefOid, statusCheckRollup, baseRefName, state' } };
  }
  // The checks of a PR into another branch, or of a closed or merged one, say nothing about this merge.
  if (baseRefName !== target) return { reason: 'wrong_base', params: { pr, base: baseRefName, target } };
  if (state !== 'OPEN') return { reason: 'not_open', params: { pr, state } };
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
      const runs = gh(['api', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`], root);
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
  const traces = readTraces(revDir);
  try {
    const isCurrent = freshnessCheck({ head: tip, root: ctx.root, config: ctx.config });
    results.battery = batteryCondition({ root: ctx.root, config: ctx.config, tip, branch, target, read });
    results.verdict = verdictCondition({ revDir, progress, isCurrent, config: ctx.config, lang: ctx.lang });
    results.manual = manualCondition({ read: traces, config: ctx.config, target, isCurrent });
    results.acceptance = acceptanceCondition({ read: traces, dir, revDir, config: ctx.config, target, entId, tip, isCurrent, lang: ctx.lang });
  } catch (e) {
    if (!(e instanceof ProvenanceIgnoreError)) throw e;
    return { code: 65, data: {}, messages: [{ key: 'acceptance.provenance_ignore_failed', params: { message: e.message } }] };
  }
  results.waiting = waitingCondition(progress);
  results.ci = ciCondition({ root: ctx.root, pr, tip, branch, target });
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
