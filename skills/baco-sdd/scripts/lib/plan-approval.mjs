// The recorded portrait of the approved delivery cut (`baco approve-plan`):
// specs as declared in the plan (`path@version`) and as read from each spec file (`path@version`),
// a normalized hash of each CA definition, the CA and QA scenario universe of those specs
// (`path#ID`), approved out-of-scope CAs and scenarios, who approved, and whether the `plan` gate
// was on or off. Portraits written by 1.11.0 have bare IDs in the universe and no spec file
// versions nor CA hashes; they are still read (those fields come back as null).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { git, refExists, showFile } from './git.mjs';

export const PLAN_APPROVAL_FILE = 'aprovacao-plano.md';

const FOOTER = /<!-- baco:plan-approval (.*) -->\s*$/;
const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
const sortUnique = (arr) => [...new Set(arr)].sort();
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isStringMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
const shortHash = (h) => h.slice(0, 8);

// Hash of one CA's definitions (spec `definitions` entries with the same ID, in order). Only the
// content counts: runs of spaces and line breaks collapse to one space and spacing around table
// cell bars is dropped, so re-wrapping or re-aligning a definition keeps the same hash.
export function criteriaHash(defs) {
  const text = defs
    .map((d) => String(d?.text ?? '').replace(/\s+/g, ' ').replace(/\s*\|\s*/g, '|').replace(/^\|+|\|+$/g, '').trim())
    .join('\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function renderPlanApproval({
  entId,
  by = '',
  gate = 'on',
  date,
  specs = [],
  specVersions = null,
  criteria = null,
  universeCas = [],
  universeScenarios = [],
  outOfScope = [],
  outOfScopeScenarios = [],
}) {
  const cleanBy = gate === 'off' ? '' : oneLine(by);
  const specList = [...new Set(specs)];
  const uCas = sortUnique(universeCas);
  const uScenarios = sortUnique(universeScenarios);
  const cas = sortUnique(outOfScope);
  const scenarios = sortUnique(outOfScopeScenarios);
  const fileVersions = specVersions ? [...new Set(specVersions)] : null;
  const hashes = criteria ? Object.fromEntries(Object.keys(criteria).sort().map((k) => [k, criteria[k]])) : null;
  const payload = {
    by: cleanBy,
    gate,
    date,
    specs: specList,
    ...(fileVersions ? { specVersions: fileVersions } : {}),
    ...(hashes ? { criteria: hashes } : {}),
    universeCas: uCas,
    universeScenarios: uScenarios,
    outOfScope: cas,
    outOfScopeScenarios: scenarios,
  };
  const json = JSON.stringify(payload).replace(/--/g, '-\\u002d');
  const lines = [
    `# Aprovação do plano | ${entId}`,
    '',
    `- **Quem aprovou:** ${cleanBy || 'portão plan desligado'}`,
    `- **Portão plan:** ${gate === 'on' ? 'ligado' : 'desligado'}`,
    `- **Data:** ${date}`,
    `- **Specs:** ${specList.length ? specList.join(', ') : 'nenhuma'}`,
    ...(fileVersions ? [`- **Versão no arquivo da spec:** ${fileVersions.length ? fileVersions.join(', ') : 'nenhuma'}`] : []),
    `- **Universo (critérios):** ${uCas.length ? uCas.join(', ') : 'nenhum'}`,
    ...(hashes ? [`- **Texto dos critérios (resumo):** ${Object.keys(hashes).length ? Object.entries(hashes).map(([k, h]) => `${k} ${shortHash(h)}`).join(', ') : 'nenhum'}`] : []),
    `- **Universo (cenários):** ${uScenarios.length ? uScenarios.join(', ') : 'nenhum'}`,
    `- **Fora desta entrega (critérios):** ${cas.length ? cas.join(', ') : 'nenhum'}`,
    `- **Fora desta entrega (cenários):** ${scenarios.length ? scenarios.join(', ') : 'nenhum'}`,
    '',
    'Este arquivo guarda o retrato do recorte aprovado no portão do plano. Se uma spec sair ou mudar de versão, se o texto de um critério mudar, se o universo de critérios ou cenários encolher, ou se o conjunto fora desta entrega mudar, o relatório de aceite e o merge-check bloqueiam como portão humano. Apagar este arquivo também bloqueia: o motor procura a última versão dele no histórico da branch.',
    '',
    `<!-- baco:plan-approval ${json} -->`,
    '',
  ];
  return lines.join('\n');
}

// Parses the portrait's footer, or returns null when it is missing or malformed.
export function parsePlanApproval(md) {
  const m = FOOTER.exec(String(md ?? ''));
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]);
    if (typeof p?.by !== 'string' || typeof p?.date !== 'string') return null;
    if (p.gate !== 'on' && p.gate !== 'off') return null;
    if (!isStringArray(p.specs) || !isStringArray(p.universeCas) || !isStringArray(p.universeScenarios)) return null;
    if (!isStringArray(p.outOfScope) || !isStringArray(p.outOfScopeScenarios)) return null;
    if (p.specVersions !== undefined && !isStringArray(p.specVersions)) return null;
    if (p.criteria !== undefined && !isStringMap(p.criteria)) return null;
    return {
      by: p.by,
      gate: p.gate,
      date: p.date,
      specs: [...new Set(p.specs)],
      specVersions: p.specVersions === undefined ? null : [...new Set(p.specVersions)],
      criteria: p.criteria === undefined ? null : { ...p.criteria },
      universeCas: sortUnique(p.universeCas),
      universeScenarios: sortUnique(p.universeScenarios),
      outOfScope: sortUnique(p.outOfScope),
      outOfScopeScenarios: sortUnique(p.outOfScopeScenarios),
    };
  } catch {
    return null;
  }
}

// Reads the recorded plan approval portrait from `deliveryDir/aprovacao-plano.md`,
// or returns null when absent or unreadable.
export function readPlanApproval(dir) {
  let md;
  try {
    md = readFileSync(join(dir, PLAN_APPROVAL_FILE), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
  return parsePlanApproval(md);
}

// The latest version of the delivery's portrait in the history of `ref` (default HEAD): every
// commit reachable from it, under any folder name of the delivery (`<docs_root>/entregas/<ENT>-*/`),
// so renaming the folder does not hide it. Returns { commit, path, approval } (approval null when
// that version is unreadable), or null when no commit ever had the file or `ref` has no commit yet.
// Any git failure propagates (the dispatcher turns it into exit 65): the check fails closed.
export function portraitInHistory({ root, config, entId, ref = 'HEAD' }) {
  if (!refExists(ref, root)) return null;
  const base = relative(root, join(root, config?.docs_root ?? 'docs', 'entregas')).split('\\').join('/');
  const pathspec = `:(glob)${base ? `${base}/` : ''}${entId}-*/${PLAN_APPROVAL_FILE}`;
  const out = git(['-c', 'core.quotepath=off', 'log', ref, '--full-history', '-n', '1', '--format=%H', '--name-only', '--diff-filter=AMR', '--', pathspec], root);
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const [commit, path] = lines;
  const text = path ? showFile(commit, path, root) : null;
  return { commit, path: path ?? null, approval: text === null ? null : parsePlanApproval(text) };
}

// The portrait to compare against: the one on disk when it is readable; otherwise the latest one of
// the history of `ref`, flagged `deleted` (the file was deleted or broken after it existed).
export function loadPlanApproval({ root, config, dir, entId, ref = 'HEAD' }) {
  const onDisk = readPlanApproval(dir);
  if (onDisk) return { approval: onDisk, deleted: null };
  const past = portraitInHistory({ root, config, entId, ref });
  if (!past) return { approval: null, deleted: null };
  return { approval: past.approval, deleted: { commit: past.commit, path: past.path } };
}
