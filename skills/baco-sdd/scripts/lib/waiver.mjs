// The human's recorded decision to skip the external review (`baco waive-review`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HANDOFF_HEAD } from './delivery.mjs';

export const WAIVER_FILE = 'dispensa-revisao-externa.md';

const FOOTER = /<!-- baco:waiver (.*) -->\s*$/;
const oneLine = (s) => String(s).replace(/\s*\r?\n\s*/g, ' ').trim();

// First line: the HEAD the waiver was given on (same marker as handoffs). Last line: a JSON footer
// the engine reads back (`--` escaped so the HTML comment cannot be closed early).
export function renderWaiver({ entId, by, date, reason, head }) {
  const json = JSON.stringify({ by, date, reason }).replace(/--/g, '-\\u002d');
  return [
    `<!-- baco:head ${head} -->`,
    `# Dispensa da revisão externa | ${entId}`,
    '',
    `- **Quem decidiu:** ${oneLine(by)}`,
    `- **Data:** ${date}`,
    `- **Motivo:** ${oneLine(reason)}`,
    `- **Commit:** ${head}`,
    '',
    'A entrega segue sem revisão externa por decisão registrada acima. A dispensa vale só para este commit (ou para commits posteriores que mudam apenas os registros da entrega) e só enquanto nenhum veredito for importado.',
    '',
    `<!-- baco:waiver ${json} -->`,
    '',
  ].join('\n');
}

// { head, by, date, reason } from revDir/dispensa-revisao-externa.md, or null when absent or unreadable.
export function readWaiver(revDir) {
  let md;
  try {
    md = readFileSync(join(revDir, WAIVER_FILE), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
  const head = HANDOFF_HEAD.exec(md.split(/\r?\n/, 1)[0])?.[1] ?? null;
  const m = FOOTER.exec(md);
  if (!head || !m) return null;
  try {
    const { by, date, reason } = JSON.parse(m[1]);
    if (![by, date, reason].every((v) => typeof v === 'string')) return null;
    return { head, by, date, reason };
  } catch {
    return null;
  }
}
