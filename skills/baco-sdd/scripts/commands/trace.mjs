import { relative, resolve, sep } from 'node:path';
import { existsSync, readdirSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { revParse } from '../lib/git.mjs';
import { ENT_ID, computeSpecScope, deliveryKnownIdsOf, deliveryScopeOf, builtOutOfScopeDetail, describeBuilt } from '../lib/delivery.mjs';
import { t } from '../lib/messages.mjs';
import { dirname } from 'node:path';
import { readText } from '../lib/markdown.mjs';
import { readSpec } from '../lib/spec.mjs';
import { readQa } from '../lib/qa.mjs';
import { parseJUnit, idsInTitle } from '../lib/junit.mjs';

export const usage = 'baco trace --spec <spec.md> --qa <qa.md> [--junit <file.xml>]... [--delivery ENT-NNN] [--ca <CA-ID>[,<CA-ID>...]]... [--out <file.json>] [--json] [--cwd <dir>]';

// failed > skipped > passed
function aggregate(cases) {
  if (cases.some((c) => c.status === 'failed')) return 'failed';
  if (cases.some((c) => c.status === 'skipped')) return 'skipped';
  return 'passed';
}

const MANUAL = { aprovado: 'manual_ok', reprovado: 'manual_fail' };

const CODE_EXT = /\.(?:m?[jt]sx?|c[jt]s|py|rb|go|java|kt|cs|php|swift|dart|ya?ml|feature)$/i;
const normFile = (p) => String(p).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
// The test file a JUnit case names: its `file` attribute, or a classname that is a path (Playwright
// and Vitest put the file there; node:test puts `test`). Null when the runner names no file.
export function caseFile(c) {
  for (const v of [c?.file, c?.classname]) {
    if (typeof v !== 'string' || v.trim() === '') continue;
    const p = normFile(v);
    if (p.includes('/') || CODE_EXT.test(p)) return p;
  }
  return null;
}
// Same file, allowing either side to be relative to a deeper folder (Playwright names the file from
// its test folder, the QA from the repo root; node may give an absolute path).
const sameFile = (a, b) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);

// Test files declared per layer in the QA's Automação lines.
function layerFiles(qa) {
  const files = { regra: [], navegador: [] };
  for (const s of qa.scenarios) if (s.layer && files[s.layer]) files[s.layer].push(...(s.testRefs ?? []).map(normFile));
  return files;
}

// The layer a JUnit case is known to belong to: the one layer whose declared paths match its file,
// or null (no file named, no declared path matched, or a short name that matches both layers).
function caseLayer(c, files) {
  const f = caseFile(c);
  if (f === null) return null;
  const hits = Object.keys(files).filter((l) => files[l].some((r) => sameFile(f, r)));
  return hits.length === 1 ? hits[0] : null;
}

// Whether a JUnit case can prove a scenario of `layer`. A browser scenario needs a case known to come
// from a file declared for `navegador` (a runner that names no file, a short name shared with a rule
// file or a QA with no browser path declared cannot show it). A rule scenario is refused only a case
// known to come from a browser file.
function provesLayer(c, layer, files) {
  const known = caseLayer(c, files);
  return layer === 'navegador' ? known === 'navegador' : known !== 'navegador';
}

// Returns { result, evidence }. `evidence` is the evidence row used ({date, where, delivery}) or null.
// With `delivery`, only evidence rows of that delivery count (R19).
function scenarioResult(sc, qa, casesById, delivery, files, forceOutOfScope = false) {
  const matched = casesById.get(sc.id) ?? [];
  const rows = qa.evidence.filter((e) => e.ct === sc.id && (delivery === null || String(e.delivery).trim() === delivery));
  // Latest row by document order across all evidence tables.
  const last = rows.reduce((a, r) => (a === null || r.line > a.line ? r : a), null);
  const evidence = last ? { date: last.date, where: last.where, delivery: last.delivery } : null;
  let result;
  if (matched.length) {
    // R9: when both JUnit and evidence exist, the worse outcome wins.
    const junit = aggregate(matched);
    if (junit === 'failed') result = 'failed';
    else if (last?.result === 'reprovado') result = 'manual_fail';
    // A declared layer: the cases that passed must include one of that layer (end-to-end round D).
    else if (sc.layer && !matched.some((c) => provesLayer(c, sc.layer, files))) result = 'layer_mismatch';
    else result = junit;
  } else if (last?.result === 'reprovado') result = 'manual_fail'; // a rejection stands without a JUnit match too
  else if (forceOutOfScope || sc.automation === 'out_of_scope') result = last?.result === 'aprovado' && sc.automation !== 'automatizado' ? 'manual_ok' : 'out_of_scope';
  else if (sc.automation === 'automatizado') result = 'not_run';
  else result = last ? MANUAL[last.result] ?? 'manual_pending' : 'manual_pending';
  return { result, evidence };
}

function caStatus(scenarios, caOutOfScope = false) {
  if (scenarios.some((s) => isFailedResult(s.result))) return 'failed';
  const inScope = scenarios.filter((s) => s.result !== 'out_of_scope');
  if (inScope.length > 0 && inScope.every((s) => s.result === 'passed' || s.result === 'manual_ok')) return 'proven';
  if (caOutOfScope) return 'out_of_scope';
  if (scenarios.length === 0) return 'uncovered';
  if (inScope.length === 0) return 'out_of_scope';
  return 'pending';
}

// A test is an orphan when its title has bracketed IDs and none of them is known.
export const orphansOf = (names, known) => {
  const out = [];
  for (const name of names) {
    const ids = idsInTitle(name);
    if (ids.length && !ids.some((id) => known.has(id)) && !out.includes(name)) out.push(name);
  }
  return out;
};

// `alsoKnown`: IDs of the other specs of the delivery (and their QA scenarios); a test tagged with
// one of them belongs to the delivery, not to this spec, and is not an orphan.
export function traceCoverage({ spec, qa, cases = [], delivery = null, alsoKnown = new Set(), outOfScope = new Set() }) {
  const casesById = new Map();
  for (const c of cases) {
    for (const id of idsInTitle(c.name)) {
      if (!casesById.has(id)) casesById.set(id, []);
      casesById.get(id).push(c);
    }
  }
  const files = layerFiles(qa);
  // Optional fields only when they apply: the declared layer and the specialist flag (with its kind).
  const withLayer = (sc, o) => {
    const out = sc.layer ? { ...o, layer: sc.layer } : o;
    if (!sc.specialist) return out;
    return sc.specialistKind ? { ...out, specialist: true, specialistKind: sc.specialistKind } : { ...out, specialist: true };
  };
  const cas = spec.definitions.filter((d) => d.kind === 'CA').map((d) => {
    const caOos = outOfScope.has(d.id);
    const scenarios = [];
    for (const sc of qa.scenarios.filter((s) => s.contracts.includes(d.id))) {
      const { result, evidence } = scenarioResult(sc, qa, casesById, delivery, files, caOos);
      scenarios.push(withLayer(sc, { id: sc.id, via: 'qa', automation: sc.automation, tests: sc.testRefs ?? [], result, evidence }));
    }
    const direct = casesById.get(d.id);
    if (direct?.length) scenarios.push({ id: d.id, via: 'direct', automation: 'automatizado', result: aggregate(direct), evidence: null });
    return { ca: d.id, status: caStatus(scenarios, caOos), scenarios };
  });

  // Scenarios tied to no CA of the spec (only to a rule, a requirement or nothing) are not proof of a
  // criterion, but they are still part of the spec's QA: listed with their result, so a manual one
  // without evidence stays visible as pending and a rejected one as failed.
  const caIds = new Set(cas.map((c) => c.ca));
  const otherScenarios = qa.scenarios.filter((s) => !s.contracts.some((id) => caIds.has(id))).map((sc) => {
    const { result, evidence } = scenarioResult(sc, qa, casesById, delivery, files, false);
    return withLayer(sc, { id: sc.id, contracts: sc.contracts, automation: sc.automation, tests: sc.testRefs ?? [], result, evidence });
  });

  // A criterion or scenario marked out of this delivery that already has proof (a test that passed or
  // an approved manual run) is a function that exists: the mark would hide it, so it is a contradiction.
  const builtDetail = builtOutOfScopeDetail(cas, otherScenarios, outOfScope);
  const built = builtDetail.map((d) => d.id);

  const known = new Set([...spec.definitions.map((d) => d.id), ...qa.scenarios.map((s) => s.id), ...alsoKnown]);
  const orphanTests = orphansOf(cases.map((c) => c.name), known);

  const summary = { proven: 0, failed: 0, pending: 0, uncovered: 0 };
  let oos = 0;
  for (const c of cas) {
    if (c.status === 'out_of_scope') oos++;
    else summary[c.status]++;
  }
  if (oos > 0) summary.out_of_scope = oos;
  return { cas, otherScenarios, orphanTests, summary, ...(built.length ? { builtOutOfScope: built, builtProofs: builtDetail } : {}) };
}

// `layer_mismatch`: the tests that passed are not of the layer the scenario declares; never proof.
export function isFailedResult(r) { return r === 'failed' || r === 'manual_fail' || r === 'layer_mismatch'; }

export function junitFiles(args, ctx) {
  const given = [].concat(args.flags.junit ?? []).filter((v) => typeof v === 'string');
  if (given.length) return given.map((p) => resolve(ctx.cwd, p));
  const dir = resolve(ctx.root ?? ctx.cwd, ctx.config.tests?.junit_dir ?? '.baco/junit');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xml')).sort().map((f) => resolve(dir, f));
}

// `--ca` values (repeatable, comma lists) -> list of IDs, or null when malformed.
function caFilter(flag) {
  if (flag === undefined) return [];
  const ids = [];
  for (const v of [].concat(flag)) {
    if (typeof v !== 'string') return null;
    for (const raw of v.split(',')) {
      const id = raw.trim();
      if (!id) return null;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export async function run(args, ctx) {
  const specArg = args.flags.spec;
  const qaArg = args.flags.qa;
  if (typeof specArg !== 'string' || typeof qaArg !== 'string') {
    return { code: 64, data: {}, messages: [{ key: 'trace.need_flags', params: { usage } }] };
  }
  const deliveryFlag = args.flags.delivery;
  if (deliveryFlag !== undefined && (typeof deliveryFlag !== 'string' || !ENT_ID.test(deliveryFlag))) {
    return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  }
  const delivery = deliveryFlag ?? null;
  const caIds = caFilter(args.flags.ca);
  if (caIds === null) return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  const specAbs = resolve(ctx.cwd, specArg);
  const spec = readSpec(specAbs);
  const specCas = spec.definitions.filter((d) => d.kind === 'CA').map((d) => d.id);
  const unknown = caIds.filter((id) => !specCas.includes(id));
  if (unknown.length) return { code: 64, data: {}, messages: [{ key: 'trace.unknown_ca', params: { ids: unknown.join(', '), path: specArg } }] };
  const qa = readQa(resolve(ctx.cwd, qaArg), { specialist: ctx.config?.qa?.specialist });
  const cases = junitFiles(args, ctx).flatMap((f) => parseJUnit(readText(f)));
  // R19 provenance: which code (HEAD), which spec and which delivery this trace proves.
  let head = null;
  if (ctx.root) { try { head = revParse('HEAD', ctx.root); } catch { head = null; } }
  const base = ctx.root ? realpathSync(ctx.root) : ctx.cwd;
  const specPath = relative(base, realpathSync(specAbs)).split(sep).join('/');
  // With --delivery, the IDs of every spec of the plan are known (a delivery with no folder adds none).
  const alsoKnown = delivery && ctx.root ? deliveryKnownIdsOf(ctx.root, ctx.config, delivery) : new Set();
  const planScope = delivery && ctx.root
    ? deliveryScopeOf(ctx.root, ctx.config, delivery)
    : { outOfScope: new Set(), coveredByTask: new Set(), contradictions: [], unrecognizedTasks: [] };
  const specScope = computeSpecScope({ spec, qa, planOutOfScope: planScope.outOfScope, coveredByTask: planScope.coveredByTask });
  const coverage = traceCoverage({ spec, qa, cases, delivery, alsoKnown, outOfScope: planScope.outOfScope });
  // --ca: only those criteria count (result and exit code). The JSON records the filter so a partial
  // trace is never taken as the proof of a whole delivery (acceptance-report and build-handoff refuse it).
  let filter = null;
  if (caIds.length) {
    filter = specCas.filter((id) => caIds.includes(id));
    coverage.cas = coverage.cas.filter((c) => filter.includes(c.ca));
    coverage.otherScenarios = [];
    coverage.summary = { proven: 0, failed: 0, pending: 0, uncovered: 0 };
    let oos = 0;
    for (const c of coverage.cas) {
      if (c.status === 'out_of_scope') oos++;
      else coverage.summary[c.status]++;
    }
    if (oos > 0) coverage.summary.out_of_scope = oos;
    const builtKept = (coverage.builtProofs ?? []).filter((d) => filter.includes(d.id));
    delete coverage.builtOutOfScope;
    delete coverage.builtProofs;
    if (builtKept.length) Object.assign(coverage, { builtOutOfScope: builtKept.map((d) => d.id), builtProofs: builtKept });
  }
  const specCaSet = new Set(coverage.cas.map((c) => c.ca));
  const scopeContradictions = [...new Set([
    ...planScope.contradictions.filter((id) => !filter || specCaSet.has(id)),
    ...specScope.contradictions.filter((id) => !filter || specCaSet.has(id)),
  ])].sort();
  const unrecognizedTasks = planScope.unrecognizedTasks ?? [];
  const data = {
    head,
    spec: { path: specPath, version: spec.version ?? null },
    delivery,
    filter,
    ...coverage,
    ...(scopeContradictions.length ? { scopeContradictions } : {}),
    ...(unrecognizedTasks.length ? { unrecognizedTasks } : {}),
  };
  if (typeof args.flags.out === 'string') {
    const out = resolve(ctx.cwd, args.flags.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  }
  const { summary } = data;
  const messages = [{ key: summary.out_of_scope ? 'trace.summary_out_of_scope' : 'trace.summary', params: { ...summary } }];
  if (filter) messages.push({ key: 'trace.filtered', params: { ids: filter.join(', ') } });
  for (const u of unrecognizedTasks) {
    messages.push({ key: 'plan.unrecognized_task_marker', params: { cas: u.cas.join(', '), value: u.value, line: u.line } });
  }
  if (scopeContradictions.length) messages.push({ key: 'trace.scope_contradiction', params: { ids: scopeContradictions.join(', ') } });
  const built = data.builtOutOfScope ?? [];
  if (built.length) messages.push({ key: 'trace.built_out_of_scope', params: { ids: describeBuilt(data.builtProofs ?? []) } });
  for (const c of data.cas) {
    messages.push({
      key: 'trace.ca',
      params: {
        ca: c.ca,
        status: t(ctx.lang, `trace.status.${c.status}`),
        scenarios: c.scenarios.map((s) => `${s.id}=${t(ctx.lang, `acceptance.result.${s.result}`)}`).join(', ') || '-',
      },
    });
  }
  if (data.otherScenarios.length) {
    messages.push({
      key: 'trace.others',
      params: { scenarios: data.otherScenarios.map((s) => `${s.id}=${t(ctx.lang, `acceptance.result.${s.result}`)}`).join(', ') },
    });
  }
  if (data.orphanTests.length) messages.push({ key: 'trace.orphans', params: { tests: data.orphanTests.join('; ') } });
  const otherFailed = data.otherScenarios.some((s) => isFailedResult(s.result));
  return { code: summary.uncovered + summary.failed > 0 || otherFailed || scopeContradictions.length > 0 || built.length > 0 ? 1 : 0, data, messages };
}
