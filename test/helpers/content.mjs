import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'baco-sdd');

// Name of the source method; must never appear in skill content. `baco spec-diff` is an engine command and is allowed.
export const SOURCE_NAME_RE = /baco[\s_-]?spec(?!-diff)/i;

export function listFiles(dir, ext) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries.sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, ext));
    else if (!ext || p.endsWith(ext)) out.push(p);
  }
  return out;
}

const unquote = (v) => {
  const s = v.trim();
  return /^(".*"|'.*')$/.test(s) ? s.slice(1, -1) : s;
};

export function frontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { data: {}, body: md };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  let parent = null;
  let key = null;
  for (const line of lines) {
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top) {
      key = top[1]; parent = null;
      const v = top[2].trim();
      if (v === '') { parent = key; key = null; continue; }
      if (/^[>|][+-]?$/.test(v)) { data[key] = ''; continue; }
      data[key] = unquote(v);
      continue;
    }
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested && parent) { data[`${parent}.${nested[1]}`] = unquote(nested[2]); continue; }
    if (key && /^\s+\S/.test(line)) data[key] = (data[key] ? data[key] + ' ' : '') + line.trim();
  }
  return { data, body: md.slice(m[0].length) };
}

export function mdLinks(md) {
  const out = [];
  for (const m of md.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const t = m[1];
    if (/^https?:/i.test(t) || t.startsWith('#')) continue;
    out.push(t);
  }
  return out;
}

export function bacoMentions(md) {
  return [...md.matchAll(/\bbaco ([a-z][a-z-]+)/g)].map((m) => m[1]);
}

export const read = (p) => readFileSync(p, 'utf8');
