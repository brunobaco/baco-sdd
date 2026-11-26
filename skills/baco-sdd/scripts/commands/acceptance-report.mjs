import { writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { deliveryDir, readPlanHeader, computeDeliveryScope, latestVerdict, deliveryKnownIds, builtOutOfScopeDetail, describeBuilt, isPortraitEra, ENT_ID } from '../lib/delivery.mjs';
import { orphansOf } from './trace.mjs';
import { revParse, isAncestor, diffQuiet, showFile, refExists, tagTarget } from '../lib/git.mjs';
import { loadTrace } from '../lib/tracefile.mjs';
import { manualPendingRule, provenancePathspecs, parseYamlSubset, resolveConfig } from '../lib/config.mjs';
import { readQa, resolveSpecialistKind } from '../lib/qa.mjs';
import { readText, normalizeText, headings, tables, fold } from '../lib/markdown.mjs';
import { readWaiver } from '../lib/waiver.mjs';
import { loadPlanApproval } from '../lib/plan-approval.mjs';
import { agentRuns } from './cost.mjs';
import { t } from '../lib/messages.mjs';

export const usage = 'baco acceptance-report <ENT-NNN> --target <branch> --trace <file.json>... [--qa <qa.md>]... [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const STATUSES = ['proven', 'failed', 'pending', 'uncovered', 'out_of_scope'];
// R18: these blockers are verification failures (exit 1); any other blocker is a human gate (exit 2).
export const VERIFICATION_BLOCKERS = ['merge.failed', 'merge.uncovered', 'merge.no_criteria', 'merge.scenario_failed', 'merge.out_of_scope_contradiction', 'merge.out_of_scope_built'];
// Worse status wins when the same CA appears in several traces; unknown statuses are the worst.
const RANK = { out_of_scope: 0, proven: 1, pending: 2, uncovered: 3, failed: 4 };
const rank = (s) => RANK[s] ?? 5;
const MANUAL_PENDING = 'manual_pending';
const OUT_OF_SCOPE = 'out_of_scope';
// `skipped` is an automated test that did not run: it can never count as proof.
const NOT_RUN = ['not_run', 'skipped'];

const casOf = (trace) => (Array.isArray(trace?.cas) ? trace.cas : []);
const scenariosOf = (ca) => (Array.isArray(ca.scenarios) ? ca.scenarios : []);
// QA scenarios tied to no CA (only to a rule or requirement); traces made before them have none.
const othersOf = (trace) => (Array.isArray(trace?.otherScenarios) ? trace.otherScenarios.filter((s) => s && typeof s === 'object') : []);
const OTHER_PASSED = ['passed', 'manual_ok', OUT_OF_SCOPE];
// Rejected or failed, and, failing safe, any result this engine does not know.
const otherFailed = (s) => ![...OTHER_PASSED, MANUAL_PENDING, ...NOT_RUN].includes(s.result);

export function outOfScopeItems(trace) {
  const cas = [];
  const scenarios = new Set();
  for (const c of casOf(trace)) {
    if (c.status === OUT_OF_SCOPE) {
      cas.push(c.ca);
    } else {
      for (const s of scenariosOf(c)) {
        if (s.result === OUT_OF_SCOPE) scenarios.add(s.id);
      }
    }
  }
  for (const s of othersOf(trace)) {
    if (s.result === OUT_OF_SCOPE) scenarios.add(s.id);
  }
  return { cas: [...new Set(cas)].sort(), scenarios: [...scenarios].sort() };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Checks out-of-scope consistency and the approved portrait (aprovacao-plano.md) using the single
// shared computeDeliveryScope calculation. Contradictions are verification failures (exit 1);
// missing portrait when out-of-scope exists (or, in a 1.11+ delivery with the plan gate on, at all),
// deleted portrait, removed/changed spec versions (plan header or spec file), changed CA text,
// shrunk CA/CT universe, changed out-of-scope set, or gate-off portrait with non-empty out-of-scope
// are human gates (exit 2).
//
// `deleted` ({ commit }): the portrait is gone from the disk (or unreadable) but the branch history
// had it; `approval` is then that latest historical version, and the deletion is a human gate too.
// `requireApproval`: the plan gate is on and the delivery is 1.11+ (isPortraitEra), so a missing
// portrait is a human gate even with nothing out of scope.
// Universe entries `path#ID` are compared per spec; bare IDs (1.11.0 portraits) by ID only. Spec
// file versions and CA hashes are compared only when the portrait recorded them.
// `scopeRef` (a commit, from mergedDeliveryRef): the delivery is already merged into what is checked
// out (promotion, delivery.md 6b), so the specs, versions, universe and CA texts are compared with
// the plan, specs and QA as committed at that commit (the delivery as merged), not with the working
// copy, where another delivery or the reconciliation may have evolved the spec since. `planRel` is
// the plan's path from the root.
export function planScopeBlockers({ root, planText, config, trace, approval, deleted = null, requireApproval = false, scopeRef = null, planRel = null }) {
  const current = computeDeliveryScope({ root, planText, config });
  const atRef = (rel) => {
    const text = showFile(scopeRef, rel.split('\\').join('/'), root);
    return text === null ? null : normalizeText(text);
  };
  const portraitScope = scopeRef
    ? computeDeliveryScope({
      root,
      planText: (planRel && atRef(planRel)) ?? planText,
      config,
      readFile: (abs) => atRef(relative(root, abs)),
    })
    : current;
  const oos = outOfScopeItems(trace);
  const currentCas = [...new Set([...current.outOfScope, ...oos.cas])].sort();
  const currentScenarios = [...new Set([...current.outOfScopeScenarios, ...oos.scenarios])].sort();
  const contradictions = [...new Set([
    ...current.contradictions,
    ...currentCas.filter((id) => current.coveredByTask.has(id)),
  ])].sort();
  const blockers = [];
  const params = {};
  if (contradictions.length) {
    blockers.push('merge.out_of_scope_contradiction');
    params['merge.out_of_scope_contradiction'] = { ids: contradictions.join(', ') };
  }
  const builtDetail = builtOutOfScopeDetail(casOf(trace), othersOf(trace), new Set(current.outOfScope));
  const built = builtDetail.map((d) => d.id);
  if (built.length) {
    blockers.push('merge.out_of_scope_built');
    params['merge.out_of_scope_built'] = { ids: describeBuilt(builtDetail) };
  }
  const hasCurrent = currentCas.length > 0 || currentScenarios.length > 0;
  if (deleted) {
    blockers.push('merge.plan_approval_deleted');
    params['merge.plan_approval_deleted'] = { commit: String(deleted.commit ?? '').slice(0, 12) };
  }
  if (!approval) {
    if (hasCurrent) {
      blockers.push('merge.out_of_scope_unapproved');
      params['merge.out_of_scope_unapproved'] = { ids: [...currentCas, ...currentScenarios].join(', ') };
    } else if (requireApproval && !deleted) {
      blockers.push('merge.plan_unapproved');
    }
  } else {
    // Declared in the plan header and read from the spec file are compared each on its own side.
    const currentSpecSet = new Set(portraitScope.specs);
    const currentFileSet = new Set(portraitScope.specVersions);
    const missingSpecs = [...new Set([
      ...approval.specs.filter((s) => !currentSpecSet.has(s)),
      ...(approval.specVersions ?? []).filter((s) => !currentFileSet.has(s)),
    ])];
    if (missingSpecs.length) {
      blockers.push('merge.plan_specs_changed');
      params['merge.plan_specs_changed'] = { specs: missingSpecs.join(', ') };
    }
    const uCasSet = new Set([...portraitScope.universeCas, ...portraitScope.universeCaKeys]);
    const uScSet = new Set([...portraitScope.universeScenarios, ...portraitScope.universeScenarioKeys]);
    const missingUniverse = [
      ...approval.universeCas.filter((id) => !uCasSet.has(id)),
      ...approval.universeScenarios.filter((id) => !uScSet.has(id)),
    ];
    if (missingUniverse.length) {
      blockers.push('merge.plan_universe_shrank');
      params['merge.plan_universe_shrank'] = { ids: missingUniverse.join(', ') };
    }
    const changedCriteria = Object.entries(approval.criteria ?? {})
      .filter(([key, hash]) => portraitScope.criteria[key] !== undefined && portraitScope.criteria[key] !== hash)
      .map(([key]) => key)
      .sort();
    if (changedCriteria.length) {
      blockers.push('merge.plan_criteria_changed');
      params['merge.plan_criteria_changed'] = { ids: changedCriteria.join(', ') };
    }
    const approvedCas = [...new Set(approval.outOfScope)].sort();
    const approvedScenarios = [...new Set(approval.outOfScopeScenarios)].sort();
    if (!sameList(currentCas, approvedCas) || !sameList(currentScenarios, approvedScenarios)) {
      blockers.push('merge.out_of_scope_changed');
      params['merge.out_of_scope_changed'] = {
        approved: [...approvedCas, ...approvedScenarios].join(', ') || '-',
        current: [...currentCas, ...currentScenarios].join(', ') || '-',
      };
    }
    if (approval.gate === 'off' && hasCurrent) {
      blockers.push('merge.out_of_scope_gate_off');
      params['merge.out_of_scope_gate_off'] = { ids: [...currentCas, ...currentScenarios].join(', ') };
    }
  }
  return { blockers, params, contradictions, built, currentCas, currentScenarios };
}

// The delivery as it was merged, when it is already merged into HEAD (promotion, delivery.md 6b):
// the tip of `baco/ENT-NNN` while the branch exists; after the cleanup deleted it, the tag
// `entrega/ENT-NNN` (on the merge commit into the integration branch: its second parent, the merged
// side; the tag itself when it is not a merge, the cleanup's fallback at the tip). null when HEAD is
// that commit or does not contain it (on the delivery branch, before the merge): then the working
// copy is the delivery.
export function mergedDeliveryRef({ root, entId }) {
  const head = refExists('HEAD', root) ? revParse('HEAD', root) : null;
  if (!head) return null;
  const merged = (sha) => (sha && sha !== head && isAncestor(sha, head, root) ? sha : null);
  const branch = `refs/heads/baco/${entId}`;
  if (refExists(branch, root)) return merged(revParse(branch, root));
  const tag = tagTarget(`entrega/${entId}`, root);
  if (!tag) return null;
  const side = refExists(`${tag}^2`, root) ? revParse(`${tag}^2`, root) : tag;
  return merged(side);
}

// The portrait inputs of planScopeBlockers for a delivery folder, with the history read at `ref`
// (HEAD for the acceptance report, the delivery branch tip for merge-check). `fromRef`: the current
// portrait is the one committed at `ref` (merge-check), not the one on the disk (acceptance report).
export function planApprovalInputs({ root, config, dir, entId, ref = 'HEAD', fromRef = false, planText }) {
  const { approval, deleted } = loadPlanApproval({ root, config, dir, entId, ref, fromRef });
  const progressFile = join(dir, 'progresso.md');
  const progressText = existsSync(progressFile) ? readText(progressFile) : '';
  const requireApproval = config?.gates?.plan !== false && isPortraitEra({ planText, progressText });
  return { approval, deleted, requireApproval };
}

// Pending scenarios across all criteria and the scenarios without a CA, deduplicated by id. A
// "pending" criterion with no identifiable pending scenario is reported as not run (never silently ok).
// A manual scenario flagged `specialist` (only a specialist QA runs it) whose kind is one of `kinds`
// (the config's `qa.specialist`; a flag without a kind means the only entry when there is exactly one)
// goes to `specialist`, never to `manual`: it is not asked to the person and never blocks a merge.
// Any other flag is an ordinary manual scenario. `specialist`: [{ id, kind }], kind the config entry.
export function pendingItems(trace, kinds = []) {
  const manual = new Map();
  const auto = new Map();
  const specialist = new Map();
  const kindOf = (s) => (s.specialist === true ? resolveSpecialistKind(typeof s.specialistKind === 'string' ? s.specialistKind : null, kinds) : null);
  const add = (s) => {
    const kind = s.result === MANUAL_PENDING ? kindOf(s) : null;
    if (kind !== null) specialist.set(s.id, { id: s.id, kind });
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
// `specialist`: the config's `qa.specialist` kinds (see pendingItems).
export function mergeDecision({ trace, verdict, rule, waiver = null, specialist: kinds = [] }) {
  const blockers = [];
  const warnings = [];
  const cas = casOf(trace);
  const inScope = cas.filter((c) => c.status !== OUT_OF_SCOPE);
  if (inScope.length === 0) blockers.push('merge.no_criteria');
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
  const pending = pendingItems(trace, kinds);
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

// The final decision: the merge decision's blockers plus the provenance blockers (R19), once each;
// `specsNotTraced` only when that blocker is there. Shared with merge-check's `acceptance` condition.
export function combineDecision(base, prov) {
  const blockers = [...base.blockers, ...prov.blockers.filter((b) => !base.blockers.includes(b))];
  const decision = { allowed: blockers.length === 0, blockers, warnings: base.warnings };
  if (prov.specsNotTraced.length && blockers.includes('merge.spec_not_traced')) decision.specsNotTraced = prov.specsNotTraced;
  return decision;
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
// `writerText`: the writer's text kept from the previous report (null: empty slot). `specialist`: the
// config's `qa.specialist` kinds.
export function renderAcceptance({ entId, target, trace, verdict, decision, lang = 'pt-BR', titles = new Map(), blockerParams = {}, waiver = null, openItems: items = [], agents = null, writerText = null, specialist: kinds = [] }) {
  const T = (key, params) => t(lang, key, params);
  const cas = casOf(trace);
  const inScopeCas = cas.filter((c) => c.status !== OUT_OF_SCOPE);
  const outScope = outOfScopeItems(trace);
  const count = (s) => inScopeCas.filter((c) => c.status === s).length;
  const proven = count('proven');
  const failed = inScopeCas.filter((c) => c.status === 'failed' || !STATUSES.includes(c.status)).length;
  const pending = pendingItems(trace, kinds);
  const gloss = (v) => { const k = `acceptance.verdict.${v}`; return T(k) === k ? v : T(k); };
  const plural = (what, n) => T(`acceptance.plain.${what}.${n === 1 ? 'one' : 'other'}`, { n });

  const summary = [
    T(decision.allowed ? 'acceptance.summary.allowed' : 'acceptance.summary.blocked'),
    T('acceptance.summary.plain', {
      parts: [
        plural('proven', proven),
        ...(outScope.cas.length ? [plural('future', outScope.cas.length)] : []),
        plural('manual', pending.manual.length),
      ].join(', '),
    }),
    T('acceptance.summary.counts', { total: inScopeCas.length, proven, failed, pending: count('pending'), uncovered: count('uncovered') }),
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
    if (s.result === OUT_OF_SCOPE) return T('acceptance.result.out_of_scope');
    const where = s.via === 'direct' || s.automation === 'automatizado' ? 'auto' : 'manual';
    const ev = s.evidence;
    // Manual evidence: say where, when and in which delivery the test was run (R19).
    const how = (s.result === 'manual_ok' || s.result === 'manual_fail') && ev && typeof ev === 'object'
      ? T('acceptance.proof.evidence', { where: ev.where || '-', date: ev.date || '-', delivery: ev.delivery || '-' })
      : T(`acceptance.where.${where}`);
    return `${T(`acceptance.result.${s.result}`)} (${how})`;
  };
  const rows = inScopeCas.map((c) => {
    const status = T(`acceptance.status.${STATUSES.includes(c.status) ? c.status : 'failed'}`);
    const proof = scenariosOf(c).map((s) => `${s.id}: ${resultOf(s)}`);
    return `| ${cell(c.ca)} | ${status} | ${cell(proof.length ? proof.join('; ') : T('acceptance.proof.none'))} |`;
  });
  const others = othersOf(trace).filter((s) => s.result !== OUT_OF_SCOPE);
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
  // Only when there is one: criteria or scenarios of unbuilt features outside this delivery.
  const outScopeRows = outScope.cas.length || outScope.scenarios.length ? [
    '',
    `## ${T('acceptance.h.out_of_scope')}`,
    '',
    T('acceptance.out_of_scope.intro'),
    '',
    ...outScope.cas.map((id) => `- ${id}`),
    ...outScope.scenarios.map((id) => `- ${id}${titles.get(id) ? `: ${titles.get(id)}` : ''}`),
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
    ...outScopeRows,
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
  const planText = readText(join(dir, 'plano.md')); // ENOENT -> 65
  const { specs: planSpecs } = readPlanHeader(planText);
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
  const specialist = ctx.config.qa?.specialist ?? [];
  const scopeRef = mergedDeliveryRef({ root: ctx.root, entId });
  const scopeCheck = planScopeBlockers({
    root: ctx.root, planText, config: ctx.config, trace,
    scopeRef, planRel: relative(ctx.root, join(dir, 'plano.md')),
    ...planApprovalInputs({ root: ctx.root, config: ctx.config, dir, entId, ref: 'HEAD', planText }),
  });
  const baseDecision = mergeDecision({ trace, verdict, rule: manualPendingRule(ctx.config, target), waiver, specialist });
  const decision = combineDecision(baseDecision, {
    blockers: [...prov.blockers, ...scopeCheck.blockers],
    specsNotTraced: prov.specsNotTraced,
  });
  const { blockers } = decision;
  const blockerParams = {
    'merge.spec_not_traced': { paths: prov.specsNotTraced.join(', ') },
    'merge.trace_other_delivery': { id: entId },
    'merge.waiver_stale': { by: waiver?.by ?? '-', date: waiver?.date ?? '-' },
    ...scopeCheck.params,
  };
  const warningParams = {
    'merge.review_waived': { by: waiver?.by ?? '-', date: waiver?.date ?? '-', reason: noFinalDot(waiver?.reason ?? '-') },
    'merge.specialist_pending': { items: pendingItems(trace, specialist).specialist.map((s) => s.id).join(', ') },
  };
  const progressFile = join(dir, 'progresso.md');
  const items = existsSync(progressFile) ? openItems(readText(progressFile)) : [];
  const costFile = join(dir, 'custo.md');
  const agents = existsSync(costFile) ? agentRuns(readText(costFile)) : null;
  const out = join(dir, 'aceite.md');
  // A re-run keeps what the writer filled in its slot (when it can be identified).
  const writerText = existsSync(out) ? extractWriterText(readText(out)) : null;
  writeFileSync(out, renderAcceptance({ entId, target, trace, verdict, decision, lang: ctx.lang, titles, blockerParams, waiver, openItems: items, agents, writerText, specialist }));
  if (writerText) decision.writerKept = true;
  if (scopeRef) decision.planScopeRef = scopeRef;

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
