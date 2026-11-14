import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fold, readText, tables } from './markdown.mjs';
import { loadConfig } from './config.mjs';

export const IMPLEMENTED_COL = 'Versão implementada';
export const VALIDATED_COL = 'Versão validada';
export const CATALOG_FILE = 'catalogo-de-specs.md';
const EMPTY = '—';

export class CatalogError extends Error {
  constructor(message, key, params) {
    super(message);
    this.name = 'CatalogError';
    this.key = key;
    this.params = params;
  }
}

const findTable = (md) => tables(md).find((t) => {
  const f = t.headers.map(fold);
  return f.includes('codigo') && f.includes('implementacao');
});

export function readCatalog(md) {
  const table = findTable(md);
  if (!table) return { headers: [], rows: [] };
  const rows = table.rows.map((r) => ({
    code: r.cells[0] ?? '',
    cells: Object.fromEntries(table.headers.map((h, i) => [h, r.cells[i] ?? ''])),
    line: r.line,
  }));
  return { headers: table.headers, rows };
}

// Raw split: keeps every segment byte-for-byte (between the outer pipes).
function rawSegments(line) {
  let s = line.trimEnd();
  const lead = s.length - s.trimStart().length;
  s = s.slice(lead);
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const segs = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; }
    else if (s[i] === '|') { segs.push(cur); cur = ''; }
    else cur += s[i];
  }
  segs.push(cur);
  return segs;
}

const joinSegments = (segs) => `|${segs.join('|')}|`;
const cellText = (v) => ` ${String(v).replace(/\|/g, '\\|')} `;

export function updateRow(md, code, patch) {
  const table = findTable(md);
  const row = table?.rows.find((r) => r.cells[0] === code);
  if (!row) {
    const codes = (table?.rows ?? []).map((r) => r.cells[0]);
    throw new CatalogError(`unknown code ${code}`, 'catalog.unknown_code', { code, example: codes[0] ?? 'COD', codes: codes.join(', ') || '-' });
  }

  const lines = md.split('\n');
  const headers = [...table.headers];
  const known = new Set([...headers, IMPLEMENTED_COL, VALIDATED_COL]);
  for (const key of Object.keys(patch)) {
    if (!known.has(key)) throw new CatalogError(`unknown column ${key}`, 'catalog.unknown_column', { column: key });
  }

  // Columns to insert, in order, right after Validação (or at the end).
  const missing = [IMPLEMENTED_COL, VALIDATED_COL].filter((c) => !headers.includes(c));
  const valIdx = headers.findIndex((h) => fold(h) === 'validacao');
  const at = valIdx === -1 ? headers.length : valIdx + 1;
  headers.splice(at, 0, ...missing);

  const eol = (l) => (l.endsWith('\r') ? '\r' : '');
  const hdrLine = table.line - 1;
  const lastLine = table.rows.length ? table.rows[table.rows.length - 1].line - 1 : hdrLine + 1;
  const pad = (segs, n) => { while (segs.length < n) segs.push(' '); return segs; };

  if (missing.length) {
    const edit = (i, fn) => {
      const l = lines[i];
      const segs = pad(rawSegments(l), at);
      const lead = l.match(/^\s*/)[0];
      const out = joinSegments(fn(segs));
      lines[i] = lead + out + eol(l);
    };
    edit(hdrLine, (segs) => { segs.splice(at, 0, ...missing.map((m) => ` ${m} `)); return segs; });
    edit(hdrLine + 1, (segs) => { segs.splice(at, 0, ...missing.map(() => '---')); return segs; });
    for (let i = hdrLine + 2; i <= lastLine; i++) {
      edit(i, (segs) => { segs.splice(at, 0, ...missing.map(() => cellText(EMPTY))); return segs; });
    }
  }

  const l = lines[row.line - 1];
  const segs = pad(rawSegments(l), headers.length);
  for (const [key, value] of Object.entries(patch)) segs[headers.indexOf(key)] = cellText(value);
  lines[row.line - 1] = l.match(/^\s*/)[0] + joinSegments(segs) + eol(l);
  return lines.join('\n');
}

export function formatImplemented({ version, sha, delivery }) {
  const base = `${version} @ ${String(sha).slice(0, 7)}`;
  return delivery ? `${base} (${delivery})` : base;
}

export function parseImplemented(s) {
  const m = /^\s*([^\s@]+)\s*@\s*([0-9a-fA-F]{4,40})\s*(?:\(\s*([^)]*?)\s*\))?\s*$/.exec(String(s ?? ''));
  return m ? { version: m[1], sha: m[2], delivery: m[3] || null } : null;
}

export const catalogPath = (root, config) => join(root, config?.docs_root ?? 'docs', CATALOG_FILE);

// Implemented sha for a spec code from the catalog, or null when there is none.
export function implementedRef(root, code) {
  if (!code) return null;
  const path = catalogPath(root, loadConfig(root));
  if (!existsSync(path)) return null;
  const row = readCatalog(readText(path)).rows.find((r) => r.code === code);
  return parseImplemented(row?.cells[IMPLEMENTED_COL])?.sha ?? null;
}
