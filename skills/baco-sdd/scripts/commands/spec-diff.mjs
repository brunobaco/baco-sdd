import { resolve, relative, sep, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import { readText, findAllDefinitions } from '../lib/markdown.mjs';
import { parseSpecText, readSpec } from '../lib/spec.mjs';
import { implementedRef } from '../lib/catalog.mjs';
import { showFile, revParse } from '../lib/git.mjs';
import { parseId } from '../lib/ids.mjs';

export const usage = 'baco spec-diff <spec.md> --base <ref|auto> [--json] [--cwd <dir>]';

const KIND_ORDER = ['RF', 'RNF', 'RN', 'INV', 'CA'];

function sortIds(ids) {
  const rank = (id) => {
    const p = parseId(id);
    const k = KIND_ORDER.indexOf(p?.kind);
    return [k === -1 ? KIND_ORDER.length : k, p?.num ?? 0];
  };
  return [...ids].sort((a, b) => {
    const [ka, na] = rank(a);
    const [kb, nb] = rank(b);
    return ka - kb || na - nb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

const norm = (t) => t.replace(/\s+/g, ' ').trim();

// map: definitions (ID -> text); seen: every row, bullet or heading that leads with the ID, read as a
// definition or not (ID -> set of texts), to tell a reclassification from a real change.
function textMap(md) {
  const map = new Map();
  const seen = new Map();
  if (md === null) return { map, seen, version: null };
  const spec = parseSpecText(md);
  for (const d of spec.definitions) if (!map.has(d.id)) map.set(d.id, norm(d.text));
  for (const d of findAllDefinitions(md)) {
    if (!seen.has(d.id)) seen.set(d.id, new Set());
    seen.get(d.id).add(norm(d.text));
  }
  return { map, seen, version: spec.version };
}

// An ID that is a definition on one side only, but whose row is on the other side with the same text,
// only changed how the engine reads it (e.g. a renamed heading): reclassified, not added or removed.
function diffMaps(base, head) {
  const added = [];
  const modified = [];
  const removed = [];
  const reclassified = [];
  let unchanged = 0;
  for (const [id, text] of head.map) {
    if (!base.map.has(id)) (base.seen.get(id)?.has(text) ? reclassified : added).push(id);
    else if (base.map.get(id) !== text) modified.push(id);
    else unchanged++;
  }
  for (const [id, text] of base.map) {
    if (!head.map.has(id)) (head.seen.get(id)?.has(text) ? reclassified : removed).push(id);
  }
  return { added: sortIds(added), modified: sortIds(modified), removed: sortIds(removed), reclassified: sortIds(reclassified), unchanged };
}

export function diffSpecs(baseMd, headMd) {
  return diffMaps(textMap(baseMd), textMap(headMd));
}

export async function run(args, ctx) {
  const arg = args._[0];
  const base = args.flags.base;
  if (!arg || typeof base !== 'string') {
    return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  }
  const abs = resolve(ctx.cwd, arg);
  const headMd = readText(abs);
  // root comes from git (symlinks resolved); resolve the file the same way.
  const rel = relative(realpathSync(ctx.root), realpathSync(abs)).split(sep).join('/');
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    return { code: 65, data: { path: abs }, messages: [{ key: 'specdiff.outside_repo', params: { path: arg } }] };
  }
  // auto: the baseline is the implemented sha recorded in the catalog (none = everything added).
  const ref = base === 'auto' ? implementedRef(ctx.root, readSpec(abs).code) : base;
  const baseMd = ref === null ? null : showFile(ref, rel, ctx.cwd); // throws GitError on a bad ref
  const sha = ref === null ? null : revParse(ref, ctx.cwd);
  const b = textMap(baseMd);
  const h = textMap(headMd);
  const { added, modified, removed, reclassified } = diffMaps(b, h);
  const data = {
    path: abs,
    base: { ref: base, sha: baseMd === null ? null : sha, version: b.version },
    head: { version: h.version },
    added,
    modified,
    removed,
    reclassified,
  };
  const messages = [{
    key: 'specdiff.summary',
    params: { path: arg, base, baseVersion: b.version ?? '-', headVersion: h.version ?? '-', added: added.length, modified: modified.length, removed: removed.length },
  }];
  for (const [k, ids] of [['added', added], ['modified', modified], ['removed', removed], ['reclassified', reclassified]]) {
    if (ids.length) messages.push({ key: `specdiff.${k}`, params: { ids: ids.join(', ') } });
  }
  if (!added.length && !modified.length && !removed.length) messages.push({ key: 'specdiff.no_changes' });
  return { code: 0, data, messages };
}
