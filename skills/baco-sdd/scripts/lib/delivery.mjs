import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fold, readText } from './markdown.mjs';
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
