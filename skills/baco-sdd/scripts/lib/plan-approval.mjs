// The recorded portrait of the approved delivery cut (`baco approve-plan`):
// specs (`path@version`), CA and QA scenario universe of those specs, approved out-of-scope CAs and
// scenarios, who approved, and whether the `plan` gate was on or off.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLAN_APPROVAL_FILE = 'aprovacao-plano.md';

const FOOTER = /<!-- baco:plan-approval (.*) -->\s*$/;
const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
const sortUnique = (arr) => [...new Set(arr)].sort();
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function renderPlanApproval({
  entId,
  by = '',
  gate = 'on',
  date,
  specs = [],
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
  const payload = {
    by: cleanBy,
    gate,
    date,
    specs: specList,
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
    `- **Universo (critérios):** ${uCas.length ? uCas.join(', ') : 'nenhum'}`,
    `- **Universo (cenários):** ${uScenarios.length ? uScenarios.join(', ') : 'nenhum'}`,
    `- **Fora desta entrega (critérios):** ${cas.length ? cas.join(', ') : 'nenhum'}`,
    `- **Fora desta entrega (cenários):** ${scenarios.length ? scenarios.join(', ') : 'nenhum'}`,
    '',
    'Este arquivo guarda o retrato do recorte aprovado no portão do plano. Se uma spec sair ou mudar de versão, se o universo de critérios ou cenários encolher, ou se o conjunto fora desta entrega mudar, o relatório de aceite e o merge-check bloqueiam como portão humano.',
    '',
    `<!-- baco:plan-approval ${json} -->`,
    '',
  ];
  return lines.join('\n');
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
  const m = FOOTER.exec(md);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]);
    if (typeof p?.by !== 'string' || typeof p?.date !== 'string') return null;
    if (p.gate !== 'on' && p.gate !== 'off') return null;
    if (!isStringArray(p.specs) || !isStringArray(p.universeCas) || !isStringArray(p.universeScenarios)) return null;
    if (!isStringArray(p.outOfScope) || !isStringArray(p.outOfScopeScenarios)) return null;
    return {
      by: p.by,
      gate: p.gate,
      date: p.date,
      specs: [...new Set(p.specs)],
      universeCas: sortUnique(p.universeCas),
      universeScenarios: sortUnique(p.universeScenarios),
      outOfScope: sortUnique(p.outOfScope),
      outOfScopeScenarios: sortUnique(p.outOfScopeScenarios),
    };
  } catch {
    return null;
  }
}
