import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fold, headings, readText, tables } from './markdown.mjs';
import { expandRefs } from './ids.mjs';
import { readSpec } from './spec.mjs';
import { readQa, qaPathFor } from './qa.mjs';

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
const EMPTY_TASK = /^(?:[-—–]+|n\/a|<[^>]*>)$/i;

// Scope cutout declared in plano.md: only the 1.11.0 marker `fora desta entrega` counts (in the
// header `**Fora desta entrega:** CA-...` or in the `Tarefa` cell of `## Cobertura`), so legacy
// plans with other phrasing do not change meaning. Also returns every CA assigned to a real task in
// `## Cobertura` and any contradictions (marked out of scope while also assigned to a real task).
export function readPlanScope(md) {
  const outOfScope = new Set();
  const coveredByTask = new Set();
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
        const task = fold(String(r.cells[taskCol] ?? '').replace(/[`*_]/g, '')).trim();
        const cas = expandRefs(r.cells[caCol] ?? '').filter((id) => id.startsWith('CA-'));
        if (!cas.length) continue;
        if (PLAN_OUT_OF_SCOPE.test(task)) {
          for (const id of cas) outOfScope.add(id);
        } else if (task && !EMPTY_TASK.test(task)) {
          for (const id of cas) coveredByTask.add(id);
        }
      }
    }
  }
  const contradictions = [...outOfScope].filter((id) => coveredByTask.has(id)).sort();
  return { outOfScope, coveredByTask, contradictions };
}

export function readPlanOutOfScope(md) {
  return readPlanScope(md).outOfScope;
}

// Scope cutout of a delivery's plano.md; empty sets when the delivery or its plan does not exist.
export function deliveryScopeOf(root, config, entId) {
  let dir;
  try { dir = deliveryDir(root, config, entId); } catch (e) {
    if (e instanceof DeliveryError) return { outOfScope: new Set(), coveredByTask: new Set(), contradictions: [] };
    throw e;
  }
  const plan = join(dir, 'plano.md');
  return existsSync(plan) ? readPlanScope(readText(plan)) : { outOfScope: new Set(), coveredByTask: new Set(), contradictions: [] };
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
