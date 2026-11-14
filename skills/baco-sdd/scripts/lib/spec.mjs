import { readText, fold, headings, tables, findAllDefinitions, findUnrecognizedDefinitions } from './markdown.mjs';
import { expandRefs, parseId, formatId, ID_RE } from './ids.mjs';

const OWN_KINDS = new Set(['RF', 'RN', 'RNF', 'INV', 'CA']);
const clean = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();
export const numeric = (v) => /\d+(?:\.\d+)*/.exec(v ?? '')?.[0] ?? null;

// First token of a code cell: `IDC / Identidade e Cadastro` -> IDC.
const codeToken = (v) => clean(v).split(/\s*[/—–]\s*|\s+-\s+|\s+/)[0] || null;

function readMeta(md, tbls, lines) {
  let code = null;
  let version = null;
  for (const t of tbls) {
    for (const r of t.rows) {
      const key = fold(r.cells[0] ?? '');
      if (code === null && key.startsWith('codigo')) code = codeToken(r.cells[1]);
      if (version === null && key === 'versao') version = clean(r.cells[1]) || null;
    }
  }
  for (const l of lines) {
    const m = /^\s*[-*]\s+(?:\*\*)?(versao(?:\/recorte)?|codigo)\s*:(?:\*\*)?\s*(.*)$/.exec(fold(l));
    if (!m) continue;
    const value = clean(l.slice(l.indexOf(':') + 1)) || null;
    if (m[1] === 'codigo') code ??= codeToken(value);
    else version ??= value;
  }
  return { code, version };
}

function readHistory(md, tbls, lines) {
  const CHANGE = ['alteracao', 'descricao', 'mudanca'];
  const hs0 = headings(md);
  const underHistory = (t) => {
    const i = hs0.findLastIndex((h) => h.line < t.line);
    return i >= 0 && fold(hs0[i].title).includes('historico');
  };
  const table =
    tbls.find((t) => {
      const h = t.headers.map(fold);
      return h.includes('versao') && CHANGE.some((c) => h.includes(c));
    }) ?? tbls.find((t) => underHistory(t) && t.headers.map(fold).includes('versao'));
  if (table) {
    const h = table.headers.map(fold);
    const idx = (...names) => h.findIndex((x) => names.includes(x));
    const [iv, ia, id, ic] = [idx('versao'), idx('responsavel', 'autor'), idx('data'), idx(...CHANGE)];
    return table.rows.map((r) => ({
      version: clean(r.cells[iv]),
      author: ia >= 0 ? clean(r.cells[ia]) : '',
      date: id >= 0 ? clean(r.cells[id]) : '',
      change: ic >= 0 ? clean(r.cells[ic]) : '',
      line: r.line,
    }));
  }
  const hs = headings(md);
  const out = [];
  hs.forEach((h, i) => {
    if (!fold(h.title).includes('historico')) return;
    const end = hs.slice(i + 1).find((x) => x.level <= h.level)?.line ?? lines.length + 1;
    for (let n = h.line; n < end - 1; n++) {
      const m = /^\s*[-*]\s+(.*)$/.exec(lines[n]);
      if (!m) continue;
      const parts = m[1].split('|').map(clean);
      if (parts.length < 2) continue;
      const [version, ...rest] = parts;
      const [author, date, change] = rest.length >= 3 ? rest : ['', rest[0], rest.slice(1).join(' | ')];
      out.push({ version, author, date, change, line: n + 1 });
    }
  });
  return out;
}

// "Próximos números livres": per series, the highest number ever used (in any version) plus one.
// Read from a metadata table row or a bullet; null when the spec does not have the line.
const NEXT_FREE_KEY = 'proximos numeros livres';
const ENGINE_KINDS = new Set(['RF', 'RNF', 'RN', 'INV', 'CA', 'CT', 'QA', 'ADR', 'P']);
const SERIES_ORDER = ['RF', 'RNF', 'RN', 'INV', 'CA', 'P', 'CT', 'QA', 'ADR'];
function readNextFreeLine(tbls, lines) {
  for (const t of tbls) {
    for (const r of t.rows) if (fold(clean(r.cells[0])) === NEXT_FREE_KEY) return { line: r.line, value: r.cells.slice(1).join(' ') };
  }
  for (const [i, l] of lines.entries()) {
    const m = /^\s*[-*]\s+(?:\*\*)?([^:*]+?)\s*:(?:\*\*)?\s*(.*)$/.exec(l);
    if (m && fold(m[1]) === NEXT_FREE_KEY) return { line: i + 1, value: m[2] };
  }
  return null;
}

// declared: the line's IDs by series; minimum: max used + 1 for each series the spec defines or
// retires (a lower bound: numbers used only in earlier versions are not in the file).
function nextFree(tbls, lines, code, used) {
  const max = new Map();
  for (const d of used) {
    const p = parseId(d.id);
    if (p.cap !== code) continue;
    if (!max.has(p.kind) || p.num > parseId(max.get(p.kind)).num) max.set(p.kind, d.id);
  }
  const series = [...max.keys()].sort((a, b) => SERIES_ORDER.indexOf(a) - SERIES_ORDER.indexOf(b));
  const minimum = Object.fromEntries(series.map((k) => [k, formatId({ ...parseId(max.get(k)), num: parseId(max.get(k)).num + 1 })]));
  const found = readNextFreeLine(tbls, lines);
  if (!found) return { line: null, declared: null, minimum, max, invalid: [] };
  const declared = {};
  const invalid = [];
  for (const token of clean(found.value).split(/[\s,;]+/).filter(Boolean)) {
    const p = parseId(token);
    const kind = /^([A-Z]+)-(?:[A-Z]{2,6}-)?\d+$/.exec(token)?.[1];
    // A series the engine does not know (DEC, RIS...) belongs to the project: accepted, not checked.
    if (!p && kind && !ENGINE_KINDS.has(kind)) continue;
    if (!p || p.cap !== code || p.kind in declared) invalid.push(token);
    else declared[p.kind] = p.id;
  }
  return { line: found.line, declared, minimum, max, invalid };
}

// A table row defines an ID only in an ID table or a Given/When/Then table (ruling R4).
function rowTable(tbls, line) {
  return tbls.find((t) => t.rows.some((r) => r.line === line));
}
function countsAsDefinition(t) {
  const h = t.headers.map(fold);
  return h[0] === 'id' || ['dado', 'quando', 'entao'].some((k) => h.includes(k));
}

// Ruling R6: rows of traceability/matrix/coverage tables are references, never definitions.
// So are rows of tables under a history/disposition/retired heading.
const REFERENCE_HEADINGS = ['rastreabilidade', 'matriz', 'cobertura', 'historico', 'disposicao', 'obsolet', 'aposentad', 'retirad', 'descontinuad', 'history', 'retired', 'deprecated', 'superseded'];
function isTraceTable(t, hs) {
  const h = t.headers.map(fold);
  if (h.includes('origem') || h.includes('verificacao')) return true;
  const i = hs.findLastIndex((x) => x.line < t.line);
  return i >= 0 && REFERENCE_HEADINGS.some((k) => fold(hs[i].title).includes(k));
}

// Retired IDs: a row whose status says the ID is no longer in force (obsoleto, substituído, revogado...).
// The status is read from a Situação/Status/Estado/Disposição column; a table with no such column and
// that is not a definition table is read on any cell after the ID. "Parcialmente" keeps it in force.
const RETIRED_RE = /^(obsolet|substituid|revogad|retirad|removid|descontinuad|aposentad|cancelad|superseded|replaced|revoked|retired|removed|withdrawn|deprecated|cancell?ed)/;
const PARTIAL_RE = /\b(parcial|em parte|partial)/;
const STATUS_HEADERS = ['situacao', 'status', 'estado', 'disposicao', 'state', 'disposition'];
function retirement(t, line, defTable) {
  const row = t.rows.find((r) => r.line === line);
  const h = t.headers.map(fold);
  let cols = h.flatMap((x, i) => (i > 0 && STATUS_HEADERS.some((k) => x.startsWith(k)) ? [i] : []));
  if (!cols.length) {
    if (defTable) return null;
    cols = row.cells.map((_, i) => i).slice(1);
  }
  for (const i of cols) {
    const v = fold(clean(row.cells[i]));
    if (RETIRED_RE.test(v)) return PARTIAL_RE.test(v) ? 'partial' : 'retired';
  }
  return null;
}

function splitDefinitions(md, tbls) {
  const hs = headings(md);
  const kept = [];
  const filtered = [];
  const refRows = [];
  const retired = [];
  for (const d of findAllDefinitions(md)) {
    const t = rowTable(tbls, d.line);
    const entry = { ...d, headers: t ? t.headers : null };
    if (!t) {
      kept.push(entry);
      continue;
    }
    const defTable = countsAsDefinition(t);
    const r = retirement(t, d.line, defTable);
    if (r === 'retired') retired.push(entry);
    else if (defTable) kept.push(entry);
    // A titled ID cell or a partly superseded ID outside a definition table is only a mention.
    else if (d.titled || r === 'partial' || isTraceTable(t, hs)) refRows.push(entry);
    else filtered.push(entry);
  }
  // A filtered row is still THE definition when the ID is defined (or retired) nowhere else.
  const known = new Set([...kept, ...retired].map((d) => d.id));
  for (const d of filtered) {
    if (known.has(d.id)) continue;
    known.add(d.id);
    kept.push(d);
  }
  return { defs: kept.sort((a, b) => a.line - b.line), refRows, retired };
}

const strip = ({ headers, titled, ...d }) => d;

export function readSpec(path) {
  return parseSpecText(readText(path));
}

export function parseSpecText(md) {
  const lines = md.split('\n');
  const tbls = tables(md);
  const { code, version } = readMeta(md, tbls, lines);
  const { defs, retired } = splitDefinitions(md, tbls);
  const nf = nextFree(tbls, lines, code ?? (defs[0] ? parseId(defs[0].id).cap : null), [...defs, ...retired]);
  const seen = new Set();
  const retiredOnce = retired.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  return { code, version, definitions: defs.map(strip), retired: retiredOnce.map(({ id, kind, line }) => ({ id, kind, line })), nextFree: { line: nf.line, declared: nf.declared, minimum: nf.minimum }, history: readHistory(md, tbls, lines) };
}

export function validateSpec(path) {
  const md = readText(path);
  const tbls = tables(md);
  const spec = parseSpecText(md);
  const { defs, refRows, retired } = splitDefinitions(md, tbls);
  const retiredIds = new Set(retired.map((d) => d.id));
  const findings = [];
  const add = (level, code, line, id, extra) => findings.push({ ...(id ? { level, code, line, id } : { level, code, line }), ...extra });

  const seen = new Map();
  for (const d of defs) {
    if (seen.has(d.id)) add('error', 'DUPLICATE_ID', d.line, d.id);
    else seen.set(d.id, d);
  }

  // A retired ID is reserved: defining it again reuses a published number.
  for (const d of defs) if (retiredIds.has(d.id)) add('error', 'RETIRED_ID_REDEFINED', d.line, d.id);

  // Definitions in a shape the engine does not read are reported, never dropped in silence.
  const ownId = (s) => [...String(s).matchAll(ID_RE)].map((m) => m[0]).find((id) => OWN_KINDS.has(parseId(id).kind));
  const unrecognized = findUnrecognizedDefinitions(md);
  const candidateLines = new Set(findAllDefinitions(md).map((d) => d.line));
  for (const t of tbls) {
    if (!countsAsDefinition(t)) continue;
    for (const r of t.rows) {
      const id = ownId(r.cells[0] ?? '');
      if (id && !candidateLines.has(r.line)) unrecognized.push({ id, line: r.line });
    }
  }
  unrecognized.sort((a, b) => a.line - b.line);
  if (defs.length === 0) {
    const lines = md.split('\n');
    // The "Próximos números livres" line holds IDs by design: it is not a citation.
    const hit = lines.findIndex((l, i) => i + 1 !== spec.nextFree.line && [...l.matchAll(ID_RE)].some((m) => {
      const p = parseId(m[0]);
      return OWN_KINDS.has(p.kind) && !retiredIds.has(p.id) && (!spec.code || !p.cap || p.cap === spec.code);
    }));
    if (hit >= 0) add('error', 'NO_DEFINITIONS', hit + 1);
  }
  for (const u of unrecognized) add('warning', 'UNRECOGNIZED_DEFINITION', u.line, u.id);

  for (const d of defs) {
    if (d.kind !== 'CA') continue;
    const hay = fold([...(d.headers ?? []), d.text].join(' '));
    if (!(/\bdad[oa]s?\b/.test(hay) && /\bquando\b/.test(hay) && /\bentao\b/.test(hay))) add('error', 'CA_MISSING_GWT', d.line, d.id);
  }

  if (!headings(md).some((h) => fold(h.title).includes('aceite'))) add('error', 'MISSING_ACCEPTANCE_SECTION', 1);

  const last = spec.history.at(-1);
  if (spec.version && last && numeric(spec.version) && numeric(last.version) && numeric(spec.version) !== numeric(last.version)) {
    add('error', 'VERSION_MISMATCH', last.line);
  }

  const caps = new Set(defs.map((d) => parseId(d.id).cap).filter(Boolean));
  if (caps.size > 1) {
    const base = spec.code && caps.has(spec.code) ? spec.code : parseId(defs[0].id).cap;
    for (const d of defs) {
      const cap = parseId(d.id).cap;
      if (cap && cap !== base) add('warning', 'MIXED_CAPABILITY_CODE', d.line, d.id);
    }
    if (!findings.some((f) => f.code === 'MIXED_CAPABILITY_CODE')) add('warning', 'MIXED_CAPABILITY_CODE', 1);
  }

  const specCap = spec.code ?? [...caps][0] ?? null;
  const reported = new Set();
  for (const d of [...defs, ...refRows, ...retired]) {
    for (const ref of expandRefs(d.text)) {
      const p = parseId(ref);
      if ((ref === d.id && !refRows.includes(d)) || !OWN_KINDS.has(p.kind) || p.cap !== specCap || seen.has(ref) || retiredIds.has(ref) || reported.has(ref)) continue;
      reported.add(ref);
      add('warning', 'DANGLING_REF', d.line, ref);
    }
  }

  if (spec.history.length === 0) add('warning', 'NO_HISTORY', 1);

  // The next-free line must stay ahead of every number in use, or a number may be reused.
  const nf = nextFree(tbls, md.split('\n'), specCap, [...defs, ...retired]);
  if (nf.declared) {
    for (const value of nf.invalid) add('warning', 'NEXT_FREE_INVALID', nf.line, null, { value });
    for (const [series, minimum] of Object.entries(nf.minimum)) {
      const declared = nf.declared[series];
      const max = nf.max.get(series);
      if (!declared) add('warning', 'NEXT_FREE_MISSING_SERIES', nf.line, null, { series, max, minimum });
      else if (parseId(max).num >= parseId(declared).num) add('warning', 'NEXT_FREE_STALE', nf.line, max, { series, max, declared, minimum });
    }
  }
  return findings;
}
