import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fold, headings, readText, tables } from './markdown.mjs';
import { expandRefs } from './ids.mjs';
import { readSpec } from './spec.mjs';
import { readQa, qaPathFor } from './qa.mjs';
import { criteriaHash } from './plan-approval.mjs';

export class DeliveryError extends Error {
  constructor(code, message, id = null) {
    super(message);
    this.name = 'DeliveryError';
    this.code = code; // 'NOT_FOUND' | 'AMBIGUOUS'
    this.id = id;
  }
}

export const ENT_ID = /^ENT-\d{3}$/;

// Resolves docs/entregas/<entId>-* (absolute path). Throws DeliveryError (mapped to exit 65 by the dispatcher).
export function deliveryDir(root, config, entId) {
  const base = join(root, config?.docs_root ?? 'docs', 'entregas');
  let names = [];
  try {
    names = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const hits = names.filter((n) => n.startsWith(`${entId}-`)).sort();
  if (hits.length === 0) throw new DeliveryError('NOT_FOUND', `delivery ${entId} not found`, entId);
  if (hits.length > 1) throw new DeliveryError('AMBIGUOUS', `delivery ${entId} is ambiguous`, entId);
  return join(base, hits[0]);
}

// Reads `**Specs:** path@version, ...` and `**Base:** <ref>` (labels case/accent-insensitive).
export function readPlanHeader(md) {
  const specs = [];
  let baseRef = null;
  let seenSpecs = false;
  for (const line of String(md).replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*\*\*\s*([^*:]+?)\s*:\s*\*\*\s*(.*)$/.exec(line) ?? /^\s*\*\*\s*([^*:]+?)\s*\*\*\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const label = fold(m[1]);
    const value = m[2].trim();
    if (label === 'specs' && !seenSpecs) {
      seenSpecs = true;
      for (const part of value.replace(/\.\s*$/, '').split(',')) {
        const entry = part.trim().replace(/^`|`$/g, '').trim();
        if (!entry) continue;
        const at = entry.lastIndexOf('@');
        const path = (at === -1 ? entry : entry.slice(0, at)).trim();
        const version = at === -1 ? '' : entry.slice(at + 1).trim().replace(/\.$/, '');
        if (path) specs.push({ path, version: version || null });
      }
    } else if (label === 'base' && baseRef === null) {
      baseRef = value.replace(/^`|`$/g, '').replace(/\.\s*$/, '').trim() || null;
    }
  }
  return { specs, baseRef };
}

// IDs known to a delivery: every definition of each spec of the plan header (paths relative to the
// repo root) and every scenario of its conventional QA file (`qaPathFor`). A missing spec or QA file
// adds nothing. Used so that a test of another spec of the same delivery is not called an orphan.
export function deliveryKnownIds(root, planSpecs) {
  const ids = new Set();
  for (const { path } of planSpecs) {
    const spec = resolve(root, path);
    if (!existsSync(spec)) continue;
    for (const d of readSpec(spec).definitions) ids.add(d.id);
    const qa = qaPathFor(spec);
    if (existsSync(qa)) for (const s of readQa(qa).scenarios) ids.add(s.id);
  }
  return ids;
}

// Same, from the delivery's plano.md; an empty set when the delivery or its plan does not exist.
export function deliveryKnownIdsOf(root, config, entId) {
  let dir;
  try { dir = deliveryDir(root, config, entId); } catch (e) {
    if (e instanceof DeliveryError) return new Set();
    throw e;
  }
  const plan = join(dir, 'plano.md');
  return existsSync(plan) ? deliveryKnownIds(root, readPlanHeader(readText(plan)).specs) : new Set();
}

const PLAN_OUT_OF_SCOPE = /^fora\s+desta\s+entrega(?:\s*$|\s*[;(.:,-])/;
const REAL_TASK_ID = /\bT-\d+\b/i;
// A function built in an earlier delivery: no task now, its existing tests count as regression.
const PLAN_REGRESSION = /^regressao(?:\s*$|\s*[;(.:,-])/;
const EMPTY_TASK = /^(?:[-—–]+|<[^>]*>)$/;

// Scope cutout declared in plano.md:
// - Only the 1.11.0 marker `fora desta entrega` counts as out of scope (header `**Fora desta entrega:** CA-...`
//   or `Tarefa` cell of `## Cobertura`).
// - Only a task ID (`T-\d+`) in the `Tarefa` cell counts as a real task.
// - Any other non-empty non-placeholder text in `Tarefa` (e.g. "próxima entrega", "nenhuma", "fora do plano")
//   is neither a real task nor out of scope, and is returned in `unrecognizedTasks` for a warning.
export function readPlanScope(md) {
  const outOfScope = new Set();
  const coveredByTask = new Set();
  const regression = new Set();
  const unrecognizedTasks = [];
  const text = String(md ?? '').replace(/\r\n?/g, '\n');
  for (const line of text.split('\n')) {
    const m = /^\s*\*\*\s*([^*:]+?)\s*:\s*\*\*\s*(.*)$/.exec(line) ?? /^\s*\*\*\s*([^*:]+?)\s*\*\*\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const label = fold(m[1]).trim();
    if (label === 'fora desta entrega') {
      for (const id of expandRefs(m[2])) if (id.startsWith('CA-')) outOfScope.add(id);
    }
  }
  const hs = headings(text);
  const i = hs.findIndex((h) => fold(h.title).trim().startsWith('cobertura'));
  if (i >= 0) {
    const start = hs[i].line;
    const end = hs.slice(i + 1).find((h) => h.level <= hs[i].level)?.line ?? Infinity;
    for (const tb of tables(text)) {
      if (tb.line <= start || tb.line >= end) continue;
      const caCol = tb.headers.findIndex((h) => fold(h).trim().startsWith('criterio'));
      const taskCol = tb.headers.findIndex((h) => fold(h).trim() === 'tarefa');
      if (caCol < 0 || taskCol < 0) continue;
      for (const r of tb.rows) {
        const rawTask = String(r.cells[taskCol] ?? '').replace(/[`*_]/g, '').trim();
        const task = fold(rawTask).trim();
        const cas = expandRefs(r.cells[caCol] ?? '').filter((id) => id.startsWith('CA-'));
        if (!cas.length) continue;
        if (PLAN_OUT_OF_SCOPE.test(task)) {
          for (const id of cas) outOfScope.add(id);
        } else if (PLAN_REGRESSION.test(task)) {
          for (const id of cas) regression.add(id);
        } else if (REAL_TASK_ID.test(rawTask)) {
          for (const id of cas) coveredByTask.add(id);
        } else if (rawTask && !EMPTY_TASK.test(rawTask)) {
          unrecognizedTasks.push({ cas, value: rawTask, line: r.line });
        }
      }
    }
  }
  const contradictions = [...outOfScope].filter((id) => coveredByTask.has(id)).sort();
  return { outOfScope, coveredByTask, regression, contradictions, unrecognizedTasks };
}

// Single unified out-of-scope calculation for one spec + its QA file against the plan cutout:
// - A CA is out of scope only when declared out of scope in plano.md OR ALL of its linked QA
//   scenarios are marked `fora desta entrega`.
// - A CA with mixed scenarios (some in scope, some `fora desta entrega`) stays IN scope, and its
//   marked scenarios go into `outOfScopeScenarios` (no contradiction with a task in ## Cobertura).
// - Unlinked QA scenarios marked `fora desta entrega` also go into `outOfScopeScenarios`.
export function computeSpecScope({ spec, qa, planOutOfScope = new Set(), coveredByTask = new Set() }) {
  const universeCas = spec.definitions.filter((d) => d.kind === 'CA').map((d) => d.id);
  const caSet = new Set(universeCas);
  const scenarios = qa?.scenarios ?? [];
  const universeScenarios = scenarios.map((s) => s.id);
  const outOfScopeCas = new Set();
  const outOfScopeScenarios = new Set();

  for (const caId of universeCas) {
    const linked = scenarios.filter((s) => s.contracts.includes(caId));
    const allScenariosOos = linked.length > 0 && linked.every((s) => s.automation === 'out_of_scope');
    if (planOutOfScope.has(caId) || allScenariosOos) {
      outOfScopeCas.add(caId);
    } else {
      for (const sc of linked) if (sc.automation === 'out_of_scope') outOfScopeScenarios.add(sc.id);
    }
  }
  for (const sc of scenarios) {
    if (!sc.contracts.some((id) => caSet.has(id)) && sc.automation === 'out_of_scope') {
      outOfScopeScenarios.add(sc.id);
    }
  }
  const contradictions = [...outOfScopeCas].filter((id) => coveredByTask.has(id)).sort();
  return {
    universeCas: [...new Set(universeCas)].sort(),
    universeScenarios: [...new Set(universeScenarios)].sort(),
    outOfScopeCas,
    outOfScopeScenarios,
    contradictions,
  };
}

// A plan spec path as a stable key: relative to the repo root, forward slashes (`./docs/a.md` and
// `docs/a.md` are the same spec).
export const specKey = (root, path) => relative(root, resolve(root, path)).split(sep).join('/');

// Single unified scope calculation for a whole delivery (shared by approve-plan, acceptance-report
// and merge-check), calling computeSpecScope for every spec in plano.md's **Specs:** header.
// Besides the bare IDs, it returns the universe as `<spec path>#<ID>` keys (scenarios keyed by the
// spec their QA file belongs to), the version read from each spec file (`specVersions`, `path@version`,
// or just `path` when the file has none) and a normalized hash of each CA definition (`criteria`).
export function computeDeliveryScope({ root, planText, config }) {
  const { specs: planSpecs } = readPlanHeader(planText);
  const planScope = readPlanScope(planText);
  const universeCas = new Set();
  const universeScenarios = new Set();
  const universeCaKeys = new Set();
  const universeScenarioKeys = new Set();
  const specVersions = [];
  const criteria = {};
  const outOfScope = new Set(planScope.outOfScope);
  const outOfScopeScenarios = new Set();
  const contradictions = new Set(planScope.contradictions);

  for (const { path } of planSpecs) {
    const specAbs = resolve(root, path);
    if (!existsSync(specAbs)) continue;
    const key = specKey(root, path);
    const spec = readSpec(specAbs);
    const qaAbs = qaPathFor(specAbs);
    const qa = existsSync(qaAbs) ? readQa(qaAbs, { specialist: config?.qa?.specialist }) : { scenarios: [], evidence: [] };
    const s = computeSpecScope({ spec, qa, planOutOfScope: planScope.outOfScope, coveredByTask: planScope.coveredByTask });
    specVersions.push(spec.version ? `${key}@${spec.version}` : key);
    for (const id of s.universeCas) {
      universeCas.add(id);
      universeCaKeys.add(`${key}#${id}`);
      criteria[`${key}#${id}`] = criteriaHash(spec.definitions.filter((d) => d.id === id));
    }
    for (const id of s.universeScenarios) {
      universeScenarios.add(id);
      universeScenarioKeys.add(`${key}#${id}`);
    }
    for (const id of s.outOfScopeCas) outOfScope.add(id);
    for (const id of s.outOfScopeScenarios) outOfScopeScenarios.add(id);
    for (const id of s.contradictions) contradictions.add(id);
  }
  return {
    specs: planSpecs.map((s) => (s.version ? `${s.path}@${s.version}` : s.path)),
    specVersions: [...new Set(specVersions)],
    criteria,
    universeCas: [...universeCas].sort(),
    universeScenarios: [...universeScenarios].sort(),
    universeCaKeys: [...universeCaKeys].sort(),
    universeScenarioKeys: [...universeScenarioKeys].sort(),
    outOfScope: [...outOfScope].sort(),
    outOfScopeScenarios: [...outOfScopeScenarios].sort(),
    contradictions: [...contradictions].sort(),
    coveredByTask: planScope.coveredByTask,
    regression: planScope.regression,
    unrecognizedTasks: planScope.unrecognizedTasks,
  };
}

// Criteria (or scenarios without a criterion) marked out of this delivery that already have proof
// (a passing test or an approved manual run): the function exists. A whole criterion is marked when
// the plan puts it out or when every QA scenario of it is marked; otherwise only its marked scenarios
// count. Shared by trace and acceptance-report/merge-check (which pass merged or older trace files).
// Returns [{ id, proofs }], proofs being the scenario IDs (or `[CA-ID]` for a test named after it).
export function builtOutOfScopeDetail(cas = [], others = [], planOutOfScope = new Set()) {
  const proof = (s) => s?.result === 'passed' || s?.result === 'manual_ok';
  const out = [];
  for (const c of cas) {
    const scs = Array.isArray(c.scenarios) ? c.scenarios : [];
    const qaScs = scs.filter((s) => s.via !== 'direct');
    const whole = planOutOfScope.has(c.ca) || (qaScs.length > 0 && qaScs.every((s) => s.automation === 'out_of_scope'));
    const marked = whole ? scs : qaScs.filter((s) => s.automation === 'out_of_scope');
    const proofs = marked.filter(proof).map((s) => (s.via === 'direct' ? `[${s.id}]` : s.id));
    if (proofs.length) out.push({ id: c.ca, proofs });
  }
  for (const s of others) if (s?.automation === 'out_of_scope' && proof(s)) out.push({ id: s.id, proofs: [s.id] });
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const describeBuilt = (detail) => detail.map((d) => (d.proofs.length === 1 && d.proofs[0] === d.id ? d.id : `${d.id} (${d.proofs.join(', ')})`)).join(', ');

// Criteria of the plan specs with neither a T-NNN task nor the out-of-scope mark. In a slice
// delivery an unbuilt one would surface at the end as a manual test nobody had to do.
export function unmarkedCriteria(scope) {
  const out = new Set(scope.outOfScope);
  const regression = scope.regression ?? new Set();
  return scope.universeCas.filter((id) => !scope.coveredByTask.has(id) && !out.has(id) && !regression.has(id));
}

// Labels of the `## Retomada` block that the 1.11 progresso.md template brought.
const RESUME_LABEL_1_11 = /^\s*[-*]\s*\*\*\s*(execucao autonoma|conversa condutora|autonomous|conductor conversation)\s*:?\s*\*\*/;

// A delivery made with 1.11 or later, where every plan approval is recorded in aprovacao-plano.md.
// There is no version stamp in a delivery, so it is told apart by what only 1.11+ writes: a
// `fora desta entrega` or `regressão` mark in plano.md, or the `Execução autônoma` / `Conversa
// condutora` fields of progresso.md. A delivery with none of them is treated as older (no portrait
// required), so deliveries from before 1.11 keep passing. Known limit: a 1.11+ delivery with no mark
// in its plan and a progresso.md outside the template (without those fields) is treated as older too.
export function isPortraitEra({ planText = '', progressText = '' } = {}) {
  const scope = readPlanScope(planText);
  if (scope.outOfScope.size || scope.regression.size) return true;
  return String(progressText ?? '').replace(/\r\n?/g, '\n').split('\n').some((l) => RESUME_LABEL_1_11.test(fold(l)));
}

export function readPlanOutOfScope(md) {
  return readPlanScope(md).outOfScope;
}

// Scope cutout of a delivery's plano.md; empty sets when the delivery or its plan does not exist.
export function deliveryScopeOf(root, config, entId) {
  let dir;
  try { dir = deliveryDir(root, config, entId); } catch (e) {
    if (e instanceof DeliveryError) return { outOfScope: new Set(), coveredByTask: new Set(), contradictions: [], unrecognizedTasks: [] };
    throw e;
  }
  const plan = join(dir, 'plano.md');
  return existsSync(plan)
    ? readPlanScope(readText(plan))
    : { outOfScope: new Set(), coveredByTask: new Set(), contradictions: [], unrecognizedTasks: [] };
}

// Out-of-scope CAs of a delivery's plano.md; an empty set when the delivery or its plan does not exist.
export function deliveryOutOfScopeOf(root, config, entId) {
  return deliveryScopeOf(root, config, entId).outOfScope;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Files `<prefix>-NN.md` in dir as [{ num, name }], sorted NUMERICALLY (handoff-100 after handoff-99).
export function numberedFiles(dir, prefix) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const re = new RegExp(`^${escapeRe(prefix)}-(\\d{2,})\\.md$`);
  return names.map((name) => ({ name, m: re.exec(name) })).filter((x) => x.m)
    .map(({ name, m }) => ({ num: Number(m[1]), name })).sort((a, b) => a.num - b.num);
}

export const HANDOFF_HEAD = /^<!--\s*baco:head\s+([0-9a-f]{7,64})\s*-->/;

// Head sha recorded on the first line of a handoff file, or null.
export function handoffHead(path) {
  const first = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0];
  return HANDOFF_HEAD.exec(first)?.[1] ?? null;
}

// The latest handoff (numerically) in revDir: { name, head } or null when there is none.
export function latestHandoff(revDir) {
  const files = numberedFiles(revDir, 'handoff');
  if (!files.length) return null;
  const { name } = files[files.length - 1];
  return { name, head: handoffHead(join(revDir, name)) };
}

// The `<!-- baco:parsed {...} -->` footer of the highest-numbered veredito-NN.md in revDir, or null
// when there is no verdict or its footer is unreadable.
export function latestVerdict(revDir) {
  const files = numberedFiles(revDir, 'veredito');
  if (!files.length) return null;
  const m = /<!-- baco:parsed (.*) -->\s*$/.exec(readFileSync(join(revDir, files[files.length - 1].name), 'utf8'));
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return parsed && typeof parsed.verdict === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

// Next 2-digit number for files `<prefix>-NN.md` in dir ('01' when none).
export function nextNumber(dir, prefix) {
  const files = numberedFiles(dir, prefix);
  return String((files.length ? files[files.length - 1].num : 0) + 1).padStart(2, '0');
}
