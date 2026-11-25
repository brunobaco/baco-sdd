import { basename, dirname, join } from 'node:path';
import { fold, headings, readText, tables } from './markdown.mjs';
import { expandRefs } from './ids.mjs';

// QA scenarios file of a spec, by convention: <spec dir>/../qa/cenarios-qa-spec-<name>.md, where
// <name> is the spec file name without `spec-` and `.md`.
export function qaPathFor(specPath) {
  const name = basename(specPath).replace(/^spec-/, '').replace(/\.md$/, '');
  return join(dirname(specPath), '..', 'qa', `cenarios-qa-spec-${name}.md`);
}

export const QA_AUTOMATION_FIELD = 'Automação';
export const EVIDENCE_HEADERS = ['CT', 'Resultado', 'Data', 'Onde', 'Entrega'];
const EVIDENCE_TITLE = 'Evidências de execução';
const AUTOMATION = ['automatizado', 'manual', 'pendente'];
const OUT_OF_SCOPE = /^fora\s+desta\s+entrega(?:\s*$|\s*[;(.:,-])/;
const RESULTS = ['aprovado', 'reprovado'];

const isEvidenceTable = (t) => {
  const f = t.headers.map(fold);
  return f[0] === 'ct' && f.includes('resultado');
};

// Value of a `- **Label:** value` bullet (label matched accent/case-insensitively), or null.
function field(lines, label) {
  const want = fold(label);
  for (const l of lines) {
    const m = /^\s*[-*]\s+\*\*(.+?):?\*\*:?\s*(.*)$/.exec(l);
    if (m && fold(m[1]).replace(/:$/, '').trim() === want) return m[2].trim();
  }
  return null;
}

// Every backticked test path of an `Automação` value, in order, without repeats. A path has a `/` or
// ends in a file extension (spaces inside are kept), so a backticked word such as `regra` is not one.
function testPaths(value) {
  const out = [];
  for (const m of String(value ?? '').matchAll(/`([^`]+)`/g)) {
    const p = m[1].trim();
    if ((p.includes('/') || /\.\w+$/.test(p)) && !out.includes(p)) out.push(p);
  }
  return out;
}

export const LAYERS = ['regra', 'navegador'];
// The test layer an `Automação` value declares (`regra` or `navegador`, as a word, backticked or not,
// outside the test paths), or null when it names none or both.
function layerOf(value) {
  const words = fold(String(value ?? '').replace(/`([^`]+)`/g, (m, p) => (testPaths(m).length ? ' ' : ` ${p} `))).split(/[^a-z]+/);
  const found = LAYERS.filter((l) => words.includes(l));
  return found.length === 1 ? found[0] : null;
}

// The kind a specialist marker stands for, among the configured `qa.specialist` kinds: the entry equal
// to `kind` once folded (case and accents); with no kind, the only entry when there is exactly one.
// null when it matches none: then the scenario is an ordinary manual one.
export function resolveSpecialistKind(kind, kinds) {
  const list = (Array.isArray(kinds) ? kinds : []).filter((k) => typeof k === 'string' && k.trim());
  const given = typeof kind === 'string' ? fold(kind).replace(/\s+/g, ' ').trim() : '';
  if (!given) return list.length === 1 ? list[0] : null;
  return list.find((k) => fold(k).replace(/\s+/g, ' ').trim() === given) ?? null;
}

// The raw specialist marker of an `Automação` value: it counts only when the value STARTS with
// `manual, especialista`, optionally `manual, especialista: <tipo>` (emphasis and backticks ignored);
// after the word, only the end, `:` and the kind, or a note after `;`, `(` or `.`. Returns
// { marked, kind } (kind: the folded text after the colon, or null; resolveSpecialistKind names it).
function specialistMarker(value) {
  const text = fold(String(value ?? '').replace(/[`*_]/g, '')).trim();
  const m = /^manual\s*,\s*especialista(?:\s*$|\s*[;(.]|\s*:\s*([^;()]*))/u.exec(text);
  if (!m) return { marked: false, kind: null };
  const kind = (m[1] ?? '').trim().replace(/[\s.,]+$/, '');
  return { marked: true, kind: kind || null };
}

// A specialist scenario: a manual one with the marker above whose kind is one of `kinds` (the config's
// `qa.specialist`). Only a specialist QA runs it: never asked to the person and never a merge blocker.
// `kind` is the configured entry it stands for.
function specialistOf(word, value, kinds) {
  if (word !== 'manual') return { specialist: false, kind: null };
  const mark = specialistMarker(value);
  if (!mark.marked) return { specialist: false, kind: null };
  const kind = resolveSpecialistKind(mark.kind, kinds);
  return kind === null ? { specialist: false, kind: null } : { specialist: true, kind };
}

// `specialist`: the config's `qa.specialist` kinds (default none: no scenario is a specialist one).
export function readQa(path, { specialist: kinds = [] } = {}) {
  const md = readText(path);
  const lines = md.split('\n');
  const heads = headings(md);

  const scenarios = [];
  heads.forEach((h, i) => {
    const m = /^(CT-(?:[A-Z]{2,6}-)?\d{3})(?!\d)\s*(?:[|:—–]|-(?=\s))?\s*(.*)$/.exec(h.title.replace(/\*\*/g, '').trim());
    if (!m) return;
    const end = heads[i + 1] ? heads[i + 1].line - 1 : lines.length;
    const block = lines.slice(h.line, end);
    const contracts = field(block, 'Contratos');
    const auto = field(block, QA_AUTOMATION_FIELD);
    const word = auto === null ? '' : fold(auto.replace(/[`*]/g, '').trim().split(/[\s(:;,.]+/)[0] ?? '');
    const autoClean = auto === null ? '' : fold(auto.replace(/[`*_]/g, '')).trim();
    const testRefs = testPaths(auto);
    const automation = OUT_OF_SCOPE.test(autoClean) ? 'out_of_scope' : AUTOMATION.includes(word) ? word : null;
    const special = specialistOf(automation, auto, kinds);
    scenarios.push({
      id: m[1],
      title: m[2].trim(),
      line: h.line,
      contracts: contracts ? expandRefs(contracts) : [],
      automation,
      testRefs,
      testRef: testRefs[0] ?? null,
      layer: layerOf(auto),
      specialist: special.specialist,
      specialistKind: special.kind,
    });
  });

  const evidence = [];
  for (const t of tables(md).filter(isEvidenceTable)) {
    const idx = Object.fromEntries(['ct', 'resultado', 'data', 'onde', 'entrega'].map((k) => [k, t.headers.map(fold).indexOf(k)]));
    for (const r of t.rows) {
      const get = (k) => (idx[k] >= 0 ? r.cells[idx[k]] ?? '' : '');
      const result = fold(get('resultado'));
      if (!RESULTS.includes(result)) continue;
      evidence.push({ ct: get('ct'), result, date: get('data'), where: get('onde'), delivery: get('entrega'), line: r.line });
    }
  }

  let specVersion = null;
  for (const t of tables(md)) {
    const row = t.rows.find((r) => fold(r.cells[0] ?? '') === 'versao da spec');
    if (row) { specVersion = /\d+(?:\.\d+)*/.exec(row.cells[1] ?? '')?.[0] ?? null; break; }
  }
  return { specVersion, scenarios, evidence };
}

const cell = (v) => ` ${String(v).replace(/\|/g, '\\|')} `;
const rowOf = (e) => `|${[e.ct, e.result, e.date, e.where, e.delivery].map(cell).join('|')}|`;
const headerLines = () => [
  `|${EVIDENCE_HEADERS.map(cell).join('|')}|`,
  `|${EVIDENCE_HEADERS.map(() => '---').join('|')}|`,
];

// Appends one evidence row to the LAST evidence table (so it is the latest row by document order,
// which is how trace picks a CT's result); every untouched line stays byte-identical.
export function appendEvidence(md, entry) {
  const eolCr = md.includes('\r\n') ? '\r' : '';
  const lines = md.split('\n');
  const row = rowOf(entry) + eolCr;

  const table = tables(md).filter(isEvidenceTable).at(-1);
  if (table) {
    const last = table.rows.length ? table.rows[table.rows.length - 1].line : table.line + 1;
    lines.splice(last, 0, row);
    return lines.join('\n');
  }
  const block = [...headerLines(), rowOf(entry)].map((l) => l + eolCr);
  const head = headings(md).find((h) => fold(h.title).replace(/^[\d.\s]+/, '') === fold(EVIDENCE_TITLE));
  if (head) {
    lines.splice(head.line, 0, '' + eolCr, ...block, '' + eolCr);
    return lines.join('\n');
  }
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  const tail = [eolCr, `## ${EVIDENCE_TITLE}${eolCr}`, eolCr, ...block];
  lines.splice(end, lines.length - end, ...tail, ...(md.endsWith('\n') ? [''] : []));
  return lines.join('\n');
}
