import { readFileSync } from 'node:fs';
import { parseId } from './ids.mjs';

export function readText(path) {
  return readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function fold(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const splitLines = (md) => String(md).replace(/\r\n?/g, '\n').split('\n');

// Marks lines that are inside (or are the delimiters of) fenced code blocks.
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let fence = null;
  lines.forEach((l, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (fence) {
      mask[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (m) {
      fence = m[1];
      mask[i] = true;
    }
  });
  return mask;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;

export function headings(md) {
  const lines = splitLines(md);
  const mask = fenceMask(lines);
  const out = [];
  lines.forEach((l, i) => {
    if (mask[i]) return;
    const m = HEADING_RE.exec(l);
    if (m) out.push({ level: m[1].length, title: m[2], line: i + 1 });
  });
  return out;
}

const clean = (c) => {
  let s = c.trim();
  s = s.replace(/^\*\*(.*)\*\*$/, '$1').trim();
  s = s.replace(/`/g, '').trim();
  return s;
};

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur);
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur);
  return cells.map(clean);
}

const isRowLine = (l) => l.trim().startsWith('|');
const isSeparator = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');

export function tables(md) {
  const lines = splitLines(md);
  const mask = fenceMask(lines);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!mask[i] && isRowLine(lines[i]) && i + 1 < lines.length && !mask[i + 1] && isSeparator(lines[i + 1])) {
      const table = { line: i + 1, headers: splitRow(lines[i]), rows: [] };
      let j = i + 2;
      while (j < lines.length && !mask[j] && isRowLine(lines[j])) {
        table.rows.push({ line: j + 1, cells: splitRow(lines[j]) });
        j++;
      }
      out.push(table);
      i = j;
    } else i++;
  }
  return out;
}

const ID_SRC = '((?:RNF|RN|RF|INV|CA|CT|QA|ADR|P)-(?:[A-Z]{2,6}-)?\\d{3})(?!\\d)';
const HEADING_DEF_RE = new RegExp(`^(#{2,6})\\s+(?:\\*\\*)?${ID_SRC}(?:\\*\\*)?(?:\\s*(?:[|:—–]|-(?=\\s))\\s*(.*?))?\\s*$`);
const BULLET_DEF_RE = new RegExp(`^\\s*[-*]\\s+(\\*\\*)?${ID_SRC}(\\*\\*)?(.*)$`);
// ID cell followed by a title: whitespace or a separator (dash, colon) after the ID, then text.
const TITLED_CELL_RE = new RegExp(`^(?:\\*\\*)?${ID_SRC}(?:\\*\\*)?(?:\\s*[—–:]\\s*|\\s+-\\s+|\\s+)(\\S.*)$`);

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const stripBold = (s) => s.replace(/\*\*/g, '').trim();

function classify(line) {
  let m = HEADING_DEF_RE.exec(line);
  if (m) return { form: 'heading', id: m[2], level: m[1].length, title: stripBold(m[3] ?? '') };
  m = BULLET_DEF_RE.exec(line);
  if (m) {
    const rest = m[4];
    // Lead token only: the ID must be followed by a title separator, a colon, or end of line.
    if (!/^\s*(\||:|$)/.test(rest) && !(m[1] && /^\s*\*\*/.test(rest))) return null;
    let title = '';
    const pipe = /^\s*\|\s*(.*)$/.exec(rest);
    if (pipe) {
      const colon = pipe[1].search(/:(?:\*\*)?(\s|$)/);
      const raw = colon >= 0 ? pipe[1].slice(0, colon) : pipe[1].replace(/\*\*.*$/, '');
      title = stripBold(raw);
    }
    return { form: 'bullet', id: m[2], title };
  }
  if (isRowLine(line) && !isSeparator(line)) {
    const cells = splitRow(line);
    if (cells[0] && parseId(cells[0])) return { form: 'row', id: cells[0], title: '', cells };
    // `| **CA-XYZ-001** Title |` or `| CA-XYZ-001 — Title |`: the spec decides (by table) whether it counts.
    const t = TITLED_CELL_RE.exec(cells[0] ?? '');
    if (t) return { form: 'row', id: t[1], title: stripBold(t[2]), cells, titled: true };
  }
  return null;
}

// A line that leads with an RF/RN/RNF/INV/CA ID like a definition would (paragraph, list item or
// heading), but that classify() does not read. Reported so a definition is never dropped in silence.
const OWN_SRC = '((?:RNF|RN|RF|INV|CA)-(?:[A-Z]{2,6}-)?\\d{3})(?!\\d)';
const LOOKS_LIKE_DEF_RE = new RegExp(`^\\s{0,3}(?:(?:[-*+]|\\d+[.)])\\s+)?(?:\\*\\*|__)?${OWN_SRC}(?:\\*\\*|__)?\\s*(?:[|:—–]|-\\s)`);
const HEADING_LEAD_RE = new RegExp(`^#{1,6}\\s+(?:\\*\\*)?${OWN_SRC}(?:\\*\\*)?(?:\\s|$)`);

export function findUnrecognizedDefinitions(md) {
  const lines = splitLines(md);
  const mask = fenceMask(lines);
  const out = [];
  lines.forEach((l, i) => {
    if (mask[i] || isRowLine(l) || classify(l)) return;
    const m = LOOKS_LIKE_DEF_RE.exec(l) ?? HEADING_LEAD_RE.exec(l);
    if (m) out.push({ id: m[1], line: i + 1 });
  });
  return out;
}

export function findAllDefinitions(md) {
  const lines = splitLines(md);
  const mask = fenceMask(lines);
  const info = lines.map((l, i) => (mask[i] ? null : classify(l)));
  const isHeading = (i) => !mask[i] && HEADING_RE.test(lines[i]);
  const out = [];
  info.forEach((d, i) => {
    if (!d) return;
    let text;
    if (d.form === 'row') {
      text = d.cells.join(' | ');
    } else if (d.form === 'bullet') {
      const parts = [lines[i].replace(/^\s*[-*]\s+/, '')];
      let j = i + 1;
      while (j < lines.length) {
        if (mask[j] || info[j] || isHeading(j)) break;
        if (/^\s+\S/.test(lines[j])) {
          parts.push(lines[j]);
          j++;
        } else if (lines[j].trim() === '') {
          let k = j;
          while (k < lines.length && lines[k].trim() === '') k++;
          if (k < lines.length && /^\s+\S/.test(lines[k]) && !info[k] && !mask[k]) j = k;
          else break;
        } else break;
      }
      text = parts.join(' ');
    } else {
      const parts = [lines[i].replace(/^#+\s+/, '')];
      for (let j = i + 1; j < lines.length; j++) {
        if (!mask[j]) {
          const h = HEADING_RE.exec(lines[j]);
          if (h && h[1].length <= d.level) break;
          if (info[j]) break;
        }
        parts.push(lines[j]);
      }
      text = parts.join(' ');
    }
    out.push({ id: d.id, kind: parseId(d.id).kind, title: d.title, line: i + 1, text: collapse(text), ...(d.titled ? { titled: true } : {}) });
  });
  return out;
}

export function findDefinitions(md) {
  const seen = new Set();
  return findAllDefinitions(md).filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}
