import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deliveryDir, readPlanHeader, latestVerdict, deliveryKnownIds, ENT_ID } from '../lib/delivery.mjs';
import { orphansOf } from './trace.mjs';
import { revParse, isAncestor, diffQuiet, showFile } from '../lib/git.mjs';
import { loadTrace } from '../lib/tracefile.mjs';
import { manualPendingRule, provenancePathspecs, parseYamlSubset, resolveConfig } from '../lib/config.mjs';
import { readQa } from '../lib/qa.mjs';
import { readText, headings, tables, fold } from '../lib/markdown.mjs';
import { readWaiver } from '../lib/waiver.mjs';
import { agentRuns } from './cost.mjs';
import { t } from '../lib/messages.mjs';

export const usage = 'baco acceptance-report <ENT-NNN> --target <branch> --trace <file.json>... [--qa <qa.md>]... [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const STATUSES = ['proven', 'failed', 'pending', 'uncovered'];
// R18: these blockers are verification failures (exit 1); any other blocker is a human gate (exit 2).
export const VERIFICATION_BLOCKERS = ['merge.failed', 'merge.uncovered', 'merge.no_criteria', 'merge.scenario_failed'];
// Worse status wins when the same CA appears in several traces; unknown statuses are the worst.
const RANK = { proven: 0, pending: 1, uncovered: 2, failed: 3 };
const rank = (s) => RANK[s] ?? 4;
const MANUAL_PENDING = 'manual_pending';
// `skipped` is an automated test that did not run: it can never count as proof.
const NOT_RUN = ['not_run', 'skipped'];

const casOf = (trace) => (Array.isArray(trace?.cas) ? trace.cas : []);
const scenariosOf = (ca) => (Array.isArray(ca.scenarios) ? ca.scenarios : []);
// QA scenarios tied to no CA (only to a rule or requirement); traces made before them have none.
const othersOf = (trace) => (Array.isArray(trace?.otherScenarios) ? trace.otherScenarios.filter((s) => s && typeof s === 'object') : []);
const OTHER_PASSED = ['passed', 'manual_ok'];
// Rejected or failed, and, failing safe, any result this engine does not know.
const otherFailed = (s) => ![...OTHER_PASSED, MANUAL_PENDING, ...NOT_RUN].includes(s.result);

// Pending scenarios across all criteria and the scenarios without a CA, deduplicated by id. A
// "pending" criterion with no identifiable pending scenario is reported as not run (never silently ok).
// A manual scenario flagged `specialist` (only a specialist QA runs it) goes to `specialist`, never
// to `manual`: it is not asked to the person and never blocks a merge. `specialist`: [{ id, kind }].
export function pendingItems(trace) {
  const manual = new Map();
  const auto = new Map();
  const specialist = new Map();
  const add = (s) => {
    if (s.result === MANUAL_PENDING && s.specialist === true) specialist.set(s.id, { id: s.id, kind: typeof s.specialistKind === 'string' && s.specialistKind ? s.specialistKind : null });
    else if (s.result === MANUAL_PENDING) manual.set(s.id, s);
    else if (NOT_RUN.includes(s.result)) auto.set(s.id, s);
    else return false;
    return true;
  };
  for (const ca of casOf(trace)) {
    let found = false;
    for (const s of scenariosOf(ca)) if (add(s)) found = true;
    if (ca.status === 'pending' && !found) auto.set(ca.ca, { id: ca.ca });
  }
  for (const s of othersOf(trace)) add(s);
  for (const id of specialist.keys()) if (manual.has(id)) specialist.delete(id);
  return { manual: [...manual.keys()], auto: [...auto.keys()], specialist: [...specialist.values()] };
}

// `waiver`: the human's recorded waiver of the external review ({ by, date, reason, current }) or
// null. It counts only when there is no verdict and it is current; a stale one is named as a blocker.
export function mergeDecision({ trace, verdict, rule, waiver = null }) {
  const blockers = [];
  const warnings = [];
  const cas = casOf(trace);
  if (cas.length === 0) blockers.push('merge.no_criteria');
  // Unknown statuses are treated as failed: never merge on data we do not understand.
  if (cas.some((c) => c.status === 'failed' || !STATUSES.includes(c.status))) blockers.push('merge.failed');
  if (cas.some((c) => c.status === 'uncovered')) blockers.push('merge.uncovered');
  if (othersOf(trace).some(otherFailed)) blockers.push('merge.scenario_failed');
  if (!verdict) {
    if (waiver?.current) warnings.push('merge.review_waived');
    else {
      blockers.push('merge.no_verdict');
      if (waiver) blockers.push('merge.waiver_stale');
    }
  } else if (verdict.verdict !== 'aprovado') blockers.push('merge.verdict_not_approved');
  const pending = pendingItems(trace);
  // Fail safe: only an explicit 'ignore' skips and only 'warn' warns; anything else blocks.
  const target = rule === 'ignore' ? null : rule === 'warn' ? warnings : blockers;
  if (target) {
    if (pending.manual.length) target.push('merge.manual_pending');
    if (pending.auto.length) target.push('merge.not_run');
  }
  // Specialist scenarios: whatever the rule and the target, a warning, never a blocker.
  if (pending.specialist.length) warnings.push('merge.specialist_pending');
  return { allowed: blockers.length === 0, blockers, warnings };
}

// Merges the `cas` of several traces (one per spec). Same CA twice: the worse status wins and the
// scenarios of both are kept. Same scenario without a CA twice: the worse result wins.
const OTHER_RANK = (s) => (otherFailed(s) ? 3 : s.result === MANUAL_PENDING || NOT_RUN.includes(s.result) ? 2 : 1);
export function mergeTraces(traces) {
  const byCa = new Map();
  const others = new Map();
  const orphanTests = [];
  for (const tr of traces) {
    for (const s of othersOf(tr)) {
      const prev = others.get(s.id);
      if (!prev || OTHER_RANK(s) > OTHER_RANK(prev)) others.set(s.id, s);
    }
    for (const c of casOf(tr)) {
      const prev = byCa.get(c.ca);
      if (!prev) { byCa.set(c.ca, { ...c, scenarios: [...scenariosOf(c)] }); continue; }
      byCa.set(c.ca, { ...prev, status: rank(c.status) > rank(prev.status) ? c.status : prev.status, scenarios: [...prev.scenarios, ...scenariosOf(c)] });
    }
    for (const o of Array.isArray(tr?.orphanTests) ? tr.orphanTests : []) if (!orphanTests.includes(o)) orphanTests.push(o);
  }
  return { cas: [...byCa.values()], otherScenarios: [...others.values()], orphanTests };
}

const normPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');

// R19: the evidence must be about the code being merged and this delivery, and must cover every
// spec of the plan. Returns { blockers, specsNotTraced }.
// `isCurrent(sha)` decides whether a recorded head still describes the code (default: equals head).
export function provenanceBlockers({ traces, verdict, head, entId, planSpecs, isCurrent = (h) => h === head }) {
  const blockers = [];
  const current = (h) => typeof h === 'string' && h !== '' && isCurrent(h);
  if (traces.some((tr) => !current(tr.head))) blockers.push('merge.stale_trace');
  if (traces.some((tr) => tr.delivery !== entId)) blockers.push('merge.trace_other_delivery');
  if (verdict && !current(verdict.reviewedHead)) blockers.push('merge.stale_verdict');
  const traced = new Set(traces.map((tr) => normPath(tr.spec?.path)));
  const specsNotTraced = planSpecs.map((s) => s.path).filter((p) => !traced.has(normPath(p)));
  if (!planSpecs.length) blockers.push('merge.no_plan_specs');
  else if (specsNotTraced.length) blockers.push('merge.spec_not_traced');
  return { blockers, specsNotTraced };
}

// Git refused the R26 diff only because of a `provenance.ignore` entry: a config problem, not a stale head.
export class ProvenanceIgnoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProvenanceIgnoreError';
  }
}

// `provenance.ignore` at a recorded head: [] when its config is missing or unreadable (fail safe).
function ignoreAt(sha, root, showFile) {
  try {
    const text = showFile(sha, '.baco/config.yaml', root);
    return text === null ? [] : resolveConfig(parseYamlSubset(text)).provenance.ignore;
  } catch { return []; }
}

// R26: returns isCurrent(sha). A recorded head is still current when it equals HEAD, or is an ancestor
// of HEAD and the only commits since touch delivery artifacts (<docs_root>/entregas/**), e.g. the
// verdict or aceite.md, or paths of `provenance.ignore` present both in the config at that head and
// in the current one, so an entry added later never hides what changed after the head. Any git error
// means not current, except one that disappears without the ignore entries: ProvenanceIgnoreError.
export function freshnessCheck({ head, root, config, git = { isAncestor, diffQuiet, showFile } }) {
  const seen = new Map();
  const check = (h) => {
    if (!/^[0-9a-f]{7,64}$/.test(h)) return false;
    try { if (!git.isAncestor(h, head, root)) return false; } catch { return false; }
    const pathspecs = provenancePathspecs(config, ignoreAt(h, root, git.showFile));
    const plain = provenancePathspecs(config, []);
    try { return git.diffQuiet(h, head, pathspecs, root); } catch (e) {
      if (pathspecs.length === plain.length) return false;
      try { git.diffQuiet(h, head, plain, root); } catch { return false; }
      throw new ProvenanceIgnoreError(e.message);
    }
  };
  return (h) => {
    if (h === head) return true;
    if (!seen.has(h)) seen.set(h, check(h));
    return seen.get(h);
  };
}

const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const PENDING_WARNINGS = ['merge.manual_pending', 'merge.not_run'];
const noFinalDot = (s) => String(s).replace(/[\s.]+$/, '');

// Open items of progresso.md: the table (headers ID, Pendência, Impacto, Responsável, Destino,
// Situação; matched by name, accent/case-insensitive) under the heading "Pendências". Every row whose
// Situação does not start with "resolvida" (case-insensitive, with a note after it allowed) is open. Missing section or table: [].
export function openItems(md) {
  const hs = headings(md);
  const i = hs.findIndex((h) => /^pendencias\b/.test(fold(h.title).trim()));
  if (i < 0) return [];
  const start = hs[i].line;
  const end = hs.slice(i + 1).find((h) => h.level <= hs[i].level)?.line ?? Infinity;
  for (const tb of tables(md)) {
    if (tb.line <= start || tb.line >= end) continue;
    const col = (name) => tb.headers.findIndex((h) => fold(h).trim() === name);
    const c = { id: col('id'), item: col('pendencia'), impact: col('impacto'), dest: col('destino'), state: col('situacao') };
    if (c.item < 0 || c.state < 0) continue;
    const get = (cells, k) => (c[k] >= 0 ? (cells[c[k]] ?? '').trim() : '');
    return tb.rows.map((r) => r.cells)
      .filter((cells) => cells.some((x) => x.trim()))
      // Markdown emphasis or code around the value (`**resolvida**`, `` `resolvida` ``) does not count,
      // and a note after the word closes it too ("resolvida (2026-11-13 17:36, teste passou)").
      .filter((cells) => !/^resolvida(?![a-z0-9])/.test(fold(get(cells, 'state')).replace(/^[\s`*_]+/, '')))
      .map((cells) => ({ id: get(cells, 'id'), item: get(cells, 'item'), impact: get(cells, 'impact'), dest: get(cells, 'dest') }));
  }
  return [];
}

// The writer's slot is the last section of aceite.md: its heading, then the text between these markers.
export const WRITER_OPEN = '<!-- preencher: redator -->';
export const WRITER_CLOSE = '<!-- fim: redator -->';
const USER_HEADINGS = ['pt-BR', 'en'].map((l) => `## ${t(l, 'acceptance.h.user')}`);

// Text the writer filled in an existing aceite.md, or null when none can be identified. The slot is
// the last section the engine writes, so everything after its heading belongs to the writer, minus
// the markers. Reports written before the closing marker existed, and writers that replaced the
// opening marker by their text, are read the same way.
export function extractWriterText(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findLastIndex((l) => USER_HEADINGS.includes(l.trim()));
  if (at < 0) return null;
  const text = lines.slice(at + 1).filter((l) => ![WRITER_OPEN, WRITER_CLOSE].includes(l.trim())).join('\n').trim();
  return text || null;
}

// `waiver`: { by, date, reason, current } or null. `openItems`: from progresso.md. `agents`: from
// custo.md ([{ agent, model, effort, harness, runs }]), or null when the delivery has no cost ledger.
// `writerText`: the writer's text kept from the previous report (null: empty slot).
export function renderAcceptance({ entId, target, trace, verdict, decision, lang = 'pt-BR', titles = new Map(), blockerParams = {}, waiver = null, openItems: items = [], agents = null, writerText = null }) {
  const T = (key, params) => t(lang, key, params);
  const cas = casOf(trace);
  const count = (s) => cas.filter((c) => c.status === s).length;
  const proven = count('proven');
  const failed = cas.filter((c) => c.status === 'failed' || !STATUSES.includes(c.status)).length;
  const pending = pendingItems(trace);
  const gloss = (v) => { const k = `acceptance.verdict.${v}`; return T(k) === k ? v : T(k); };

  const summary = [
    T(decision.allowed ? 'acceptance.summary.allowed' : 'acceptance.summary.blocked'),
    T('acceptance.summary.counts', { total: cas.length, proven, failed, pending: count('pending'), uncovered: count('uncovered') }),
    verdict ? T('acceptance.summary.review', { verdict: gloss(verdict.verdict) })
      : waiver?.current ? T('acceptance.summary.review_waived', { by: waiver.by, date: waiver.date })
        : T('acceptance.summary.review_none'),
  ];
  if (decision.blockers.length) summary.push(T('acceptance.summary.reasons', { reasons: decision.blockers.map((k) => T(k, blockerParams[k])).join(' ') }));
  if (decision.warnings.some((w) => PENDING_WARNINGS.includes(w))) {
    const items = [
      ...pending.manual.map((id) => `${id} (${T('acceptance.pending.manual')})`),
      ...pending.auto.map((id) => `${id} (${T('acceptance.pending.auto')})`),
    ];
    summary.push(T('acceptance.summary.pending', { items: items.join(', ') }));
  }

  const resultOf = (s) => {
    const where = s.via === 'direct' || s.automation === 'automatizado' ? 'auto' : 'manual';
    const ev = s.evidence;
    // Manual evidence: say where, when and in which delivery the test was run (R19).
    const how = (s.result === 'manual_ok' || s.result === 'manual_fail') && ev && typeof ev === 'object'
      ? T('acceptance.proof.evidence', { where: ev.where || '-', date: ev.date || '-', delivery: ev.delivery || '-' })
      : T(`acceptance.where.${where}`);
    return `${T(`acceptance.result.${s.result}`)} (${how})`;
  };
  const rows = cas.map((c) => {
    const status = T(`acceptance.status.${STATUSES.includes(c.status) ? c.status : 'failed'}`);
    const proof = scenariosOf(c).map((s) => `${s.id}: ${resultOf(s)}`);
    return `| ${cell(c.ca)} | ${status} | ${cell(proof.length ? proof.join('; ') : T('acceptance.proof.none'))} |`;
  });
  const others = othersOf(trace);
  const otherRows = others.length ? [
    '',
    `## ${T('acceptance.h.others')}`,
    '',
    `| ${T('acceptance.th.scenario')} | ${T('acceptance.th.links')} | ${T('acceptance.th.status')} |`,
    '|---|---|---|',
    ...others.map((s) => `| ${cell(s.id)} | ${cell((Array.isArray(s.contracts) ? s.contracts : []).join(', ') || '-')} | ${cell(resultOf(s))} |`),
  ] : [];

  const manual = pending.manual.length
    ? [T('acceptance.manual.intro'), '', ...pending.manual.map((id) => (titles.get(id) ? `- [ ] ${id}: ${titles.get(id)}` : `- [ ] ${id}`))]
    : [T('acceptance.manual.none')];
  // Only when there is one: scenarios left for a specialist QA (not asked to the person, never a blocker).
  const specialistRows = pending.specialist.length ? [
    '',
    `## ${T('acceptance.h.specialist')}`,
    '',
    T('acceptance.specialist.intro'),
    '',
    ...pending.specialist.map(({ id, kind }) => `- ${id}${titles.get(id) ? `: ${titles.get(id)}` : ''}${kind ? ` (${kind})` : ''}`),
  ] : [];

  let review;
  if (!verdict && waiver?.current) review = [T('acceptance.review.waived', { by: waiver.by, date: waiver.date, reason: noFinalDot(waiver.reason) })];
  else if (!verdict) {
    review = [T('acceptance.review.none')];
    if (waiver) review.push(T('acceptance.review.waiver_stale', { by: waiver.by, date: waiver.date }));
  } else {
    const n = (sev) => (verdict.findings ?? []).filter((f) => f.severity === sev).length;
    review = [
      T('acceptance.review.verdict', { verdict: gloss(verdict.verdict) }),
      T('acceptance.review.counts', { critical: n('crítico'), important: n('importante'), suggestion: n('sugestão') }),
    ];
  }

  const risks = [];
  if (pending.manual.length) risks.push(`- ${T('acceptance.risks.pending', { items: pending.manual.map((id) => `${id} (${T('acceptance.pending.manual')})`).join(', ') })}`);
  if (pending.auto.length) risks.push(`- ${T('acceptance.risks.pending', { items: pending.auto.map((id) => `${id} (${T('acceptance.pending.auto')})`).join(', ') })}`);
  for (const f of verdict?.findings ?? []) {
    if (f.severity === 'sugestão') continue;
    risks.push(`- ${T('acceptance.risks.finding', { severity: f.severity, where: f.location ? T('acceptance.risks.at', { location: f.location }) : '', text: f.text })}`);
  }
  for (const o of items) {
    risks.push(`- ${T('acceptance.risks.open_item', { id: o.id || '-', item: noFinalDot(o.item) || '-', impact: noFinalDot(o.impact) || '-', dest: noFinalDot(o.dest) || '-' })}`);
  }
  const orphans = Array.isArray(trace?.orphanTests) ? trace.orphanTests : [];
  if (orphans.length) risks.push(`- ${T('acceptance.risks.orphans', { tests: orphans.map((o) => (typeof o === 'string' ? o : o.name ?? o.id ?? JSON.stringify(o))).join(', ') })}`);
  if (!risks.length) risks.push(T('acceptance.risks.none'));

  const agentLines = agents?.length
    ? agents.map((a) => `- ${T(a.harness ? 'acceptance.agents.row_harness' : 'acceptance.agents.row', { agent: a.agent, model: a.model, harness: a.harness, effort: a.effort, runs: T(a.runs === 1 ? 'acceptance.agents.runs_one' : 'acceptance.agents.runs_many', { n: a.runs }) })}`)
    : [T('acceptance.agents.none')];

  return [
    `# ${T('acceptance.title', { id: entId })}`,
    '',
    T('acceptance.target', { target }),
    '',
    `## ${T('acceptance.h.summary')}`,
    '',
    summary.join(' '),
    '',
    `## ${T('acceptance.h.criteria')}`,
    '',
    `| ${T('acceptance.th.criterion')} | ${T('acceptance.th.status')} | ${T('acceptance.th.proof')} |`,
    '|---|---|---|',
    ...rows,
    ...otherRows,
    '',
    `## ${T('acceptance.h.manual')}`,
    '',
    ...manual,
    ...specialistRows,
    '',
    `## ${T('acceptance.h.review')}`,
    '',
    ...review,
    '',
    `## ${T('acceptance.h.risks')}`,
    '',
    ...risks,
    '',
    `## ${T('acceptance.h.agents')}`,
    '',
    ...agentLines,
    '',
    `## ${T('acceptance.h.user')}`,
    '',
    WRITER_OPEN,
    ...(writerText ? [writerText] : []),
    WRITER_CLOSE,
    '',
  ].join('\n');
}

export async function run(args, ctx) {
  const entId = args._[0];
  const target = args.flags.target;
  const tracePaths = args.flags.trace === undefined ? [] : [].concat(args.flags.trace);
  if (!entId || !ENT_ID.test(entId) || typeof target !== 'string' || !tracePaths.length || tracePaths.some((p) => typeof p !== 'string')) return usageError();

  const dir = deliveryDir(ctx.root, ctx.config, entId);

  const traces = [];
  for (const tracePath of tracePaths) {
    const r = loadTrace(resolve(ctx.cwd, tracePath)); // ENOENT -> 65 in the dispatcher
    if (r.error) {
      return { code: 65, data: { detail: r.detail }, messages: [{ key: 'acceptance.bad_trace', params: { path: tracePath, reason: t(ctx.lang, `acceptance.bad_trace.${r.error}`) } }] };
    }
    // A trace limited to some criteria (`trace --ca`, recorded as `filter`) proves a task, not the delivery.
    if (r.trace.filter !== undefined && r.trace.filter !== null) {
      return { code: 65, data: {}, messages: [{ key: 'acceptance.filtered_trace', params: { path: tracePath } }] };
    }
    traces.push(r.trace);
  }
  const trace = mergeTraces(traces);
  const { specs: planSpecs } = readPlanHeader(readText(join(dir, 'plano.md'))); // ENOENT -> 65
  // A test tagged with an ID of another spec of the delivery is not unknown: only IDs unknown to every
  // plan spec (and its QA file) and to every trace stay orphans, whatever the traces recorded.
  const known = deliveryKnownIds(ctx.root, planSpecs);
  for (const c of trace.cas) { known.add(c.ca); for (const s of scenariosOf(c)) known.add(s.id); }
  for (const s of trace.otherScenarios) known.add(s.id);
  trace.orphanTests = trace.orphanTests.filter((o) => typeof o !== 'string' || orphansOf([o], known).length);

  const titles = new Map();
  for (const q of [].concat(args.flags.qa ?? []).filter((v) => typeof v === 'string')) {
    for (const s of readQa(resolve(ctx.cwd, q)).scenarios) if (s.title) titles.set(s.id, s.title);
  }

  // Highest veredito-NN.md wins; its baco:parsed footer is the verdict (null when unreadable).
  const verdict = latestVerdict(join(dir, 'revisao'));
  const head = revParse('HEAD', ctx.root);
  const isCurrent = freshnessCheck({ head, root: ctx.root, config: ctx.config });
  let waiver, prov;
  try {
    // A waiver of the external review follows the same "current" rule as a verdict (R26).
    const recorded = readWaiver(join(dir, 'revisao'));
    waiver = recorded ? { ...recorded, current: isCurrent(recorded.head) } : null;
    prov = provenanceBlockers({ traces, verdict, head, entId, planSpecs, isCurrent });
  } catch (e) {
    if (!(e instanceof ProvenanceIgnoreError)) throw e;
    return { code: 65, data: {}, messages: [{ key: 'acceptance.provenance_ignore_failed', params: { message: e.message } }] };
  }
  const base = mergeDecision({ trace, verdict, rule: manualPendingRule(ctx.config, target), waiver });
  const blockers = [...base.blockers, ...prov.blockers.filter((b) => !base.blockers.includes(b))];
  const decision = { allowed: blockers.length === 0, blockers, warnings: base.warnings };
  if (prov.specsNotTraced.length && blockers.includes('merge.spec_not_traced')) decision.specsNotTraced = prov.specsNotTraced;
  const blockerParams = {
    'merge.spec_not_traced': { paths: prov.specsNotTraced.join(', ') },
    'merge.trace_other_delivery': { id: entId },
    'merge.waiver_stale': { by: waiver?.by ?? '-', date: waiver?.date ?? '-' },
  };
  const warningParams = {
    'merge.review_waived': { by: waiver?.by ?? '-', date: waiver?.date ?? '-', reason: noFinalDot(waiver?.reason ?? '-') },
    'merge.specialist_pending': { items: pendingItems(trace).specialist.map((s) => s.id).join(', ') },
  };
  const progressFile = join(dir, 'progresso.md');
  const items = existsSync(progressFile) ? openItems(readText(progressFile)) : [];
  const costFile = join(dir, 'custo.md');
  const agents = existsSync(costFile) ? agentRuns(readText(costFile)) : null;
  const out = join(dir, 'aceite.md');
  // A re-run keeps what the writer filled in its slot (when it can be identified).
  const writerText = existsSync(out) ? extractWriterText(readText(out)) : null;
  writeFileSync(out, renderAcceptance({ entId, target, trace, verdict, decision, lang: ctx.lang, titles, blockerParams, waiver, openItems: items, agents, writerText }));
  if (writerText) decision.writerKept = true;

  const messages = [
    { key: 'acceptance.written', params: { file: out } },
    ...(writerText ? [{ key: 'acceptance.writer_kept' }] : []),
    { key: decision.allowed ? 'acceptance.allowed' : 'acceptance.blocked' },
    ...decision.blockers.map((key) => ({ key, params: blockerParams[key] })),
    ...decision.warnings.map((key) => ({ key, params: warningParams[key] })),
  ];
  const code = decision.allowed ? 0 : blockers.some((b) => VERIFICATION_BLOCKERS.includes(b)) ? 1 : 2;
  return { code, data: decision, messages };
}
