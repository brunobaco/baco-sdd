// The human's recorded approval of the plan gate (`baco approve-plan`), including the approved
// out-of-scope set and the SHA-256 hash of plano.md so silent post-approval cutouts are caught.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLAN_APPROVAL_FILE = 'aprovacao-plano.md';

const FOOTER = /<!-- baco:plan-approval (.*) -->\s*$/;
const oneLine = (s) => String(s).replace(/\s*\r?\n\s*/g, ' ').trim();
const sortUnique = (arr) => [...new Set(arr)].sort();

export function sha256Text(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

export function renderPlanApproval({ entId, by, date, planSha256, outOfScope = [], outOfScopeScenarios = [] }) {
  const cas = sortUnique(outOfScope);
  const scenarios = sortUnique(outOfScopeScenarios);
  const payload = { by: oneLine(by), date, planSha256, outOfScope: cas, outOfScopeScenarios: scenarios };
  const json = JSON.stringify(payload).replace(/--/g, '-\\u002d');
  const oosText = cas.length ? cas.join(', ') : 'nenhum';
  const lines = [
    `# Aprovação do plano | ${entId}`,
    '',
    `- **Quem aprovou:** ${oneLine(by)}`,
    `- **Data:** ${date}`,
    `- **Hash do plano (SHA-256):** ${planSha256}`,
    `- **Fora desta entrega (critérios):** ${oosText}`,
  ];
  if (scenarios.length) lines.push(`- **Fora desta entrega (cenários sem CA):** ${scenarios.join(', ')}`);
  lines.push(
    '',
    'O conjunto fora desta entrega acima foi aprovado no portão do plano. Se o plano ou os cenários mudarem esse conjunto, o relatório de aceite e o merge-check bloqueiam até nova aprovação humana.',
    '',
    `<!-- baco:plan-approval ${json} -->`,
    '',
  );
  return lines.join('\n');
}

// { by, date, planSha256, outOfScope, outOfScopeScenarios } from deliveryDir/aprovacao-plano.md,
// or null when absent or unreadable.
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
    const parsed = JSON.parse(m[1]);
    if (typeof parsed?.by !== 'string' || typeof parsed?.date !== 'string' || typeof parsed?.planSha256 !== 'string') return null;
    if (!Array.isArray(parsed.outOfScope) || !parsed.outOfScope.every((x) => typeof x === 'string')) return null;
    const scenarios = Array.isArray(parsed.outOfScopeScenarios) && parsed.outOfScopeScenarios.every((x) => typeof x === 'string')
      ? sortUnique(parsed.outOfScopeScenarios)
      : [];
    return {
      by: parsed.by,
      date: parsed.date,
      planSha256: parsed.planSha256,
      outOfScope: sortUnique(parsed.outOfScope),
      outOfScopeScenarios: scenarios,
    };
  } catch {
    return null;
  }
}
