import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deliveryDir, nextNumber, latestHandoff, numberedFiles, ENT_ID } from '../lib/delivery.mjs';
import { readText } from '../lib/markdown.mjs';
import { t } from '../lib/messages.mjs';
import { parseVerdict, hasScopeSection, VerdictError } from '../lib/verdict.mjs';

export { parseVerdict, VerdictError };
export const usage = 'baco import-verdict <ENT-NNN> <file|-> [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });

// The same fields every other task file has (templates/pt-BR/tarefa.md), with defaults: a crítico
// finding is `arriscada` (it breaks the spec, loses data or opens a security hole), the others are
// `padrão`; level and effort come from `models` of the config; the lane is `FIX`.
function fixFields(entId, name, finding, config) {
  const risky = finding.severity === 'crítico';
  const m = config?.models?.[risky ? 'risky' : 'standard'];
  const file = finding.location ? finding.location.replace(/:\d+(?:[-:]\d+)*$/, '') : null;
  return [
    '| Campo | Valor |',
    '|---|---|',
    `| Entrega | \`${entId}\` |`,
    '| CAs | `a definir pelo implementador (achado da revisão)` |',
    `| Classe | \`${risky ? 'arriscada' : 'padrão'}\` |`,
    `| Nível/esforço | \`${m ? `${m.level}/${m.effort}` : risky ? 'forte/medio' : 'medio/medio'}\` |`,
    '| Harness e modelo | `o que o plano dá aos implementadores da classe` |',
    '| Faixa | `FIX` |',
    `| Arquivos prováveis | \`${file ?? 'a definir pelo implementador'}\` |`,
    `| Branch | \`baco/${entId}-${name}\` |`,
    '| Dependências | `nenhuma` |',
    '| Parada humana | `não` |',
    '',
    '## Testes da tarefa',
    '',
    '- a escrever: teste que falha antes da correção (achado que pede só prova, como cenário manual, homologação ou registro: troque por "evidência: <o que falta>", sem teste novo)',
    '',
  ];
}

// Parses a verdict text and records it for the delivery: veredito-NN.md with the parsed footer and one
// FIX task per finding that is not a sugestão. Shared by import-verdict and import-pr-verdict.
// `requireScope` (the agent reviewer's answer, `import-pr-verdict`): the answer must also say, in a
// non-empty "O que foi conferido" section, what the reviewer checked. `source`: who gave the verdict,
// recorded in the footer (`agent` from import-pr-verdict, `person` from import-verdict); a footer
// written before it existed has none, read as unknown.
export function importVerdictText(text, entId, ctx, { requireScope = false, source = null } = {}) {
  const dir = deliveryDir(ctx.root, ctx.config, entId);
  let parsed;
  try {
    parsed = parseVerdict(text);
    if (requireScope && !hasScopeSection(text)) throw new VerdictError({ key: 'verdict.reason.no_scope' });
  } catch (e) {
    if (e instanceof VerdictError) return { code: 1, data: {}, messages: [{ key: 'verdict.invalid', params: { reason: t(ctx.lang, e.reason.key, e.reason.params) } }] };
    throw e;
  }

  const revDir = join(dir, 'revisao');
  mkdirSync(revDir, { recursive: true });
  const num = nextNumber(revDir, 'veredito');
  // R21: this verdict answers the latest handoff that exists now; its head is what was reviewed.
  const answered = latestHandoff(revDir);
  const footer = { ...parsed, handoff: answered?.name ?? null, reviewedHead: answered?.head ?? null, ...(source ? { source } : {}) };
  writeFileSync(join(revDir, `veredito-${num}.md`), `${text.replace(/\s+$/, '')}\n\n<!-- baco:parsed ${JSON.stringify(footer).replace(/--/g, '-\\u002d')} -->\n`);
  const round = numberedFiles(revDir, 'veredito').length;

  const tasksDir = join(dir, 'tarefas');
  const fixes = [];
  const messages = [];
  parsed.findings.forEach((f, i) => {
    if (f.severity === 'sugestão') return;
    mkdirSync(tasksDir, { recursive: true });
    const n = nextNumber(tasksDir, 'FIX');
    const name = `FIX-${n}`;
    writeFileSync(join(tasksDir, `${name}.md`), [
      `# ${name} | ${f.text.slice(0, 60)}`,
      `- **Origem:** veredito-${num}, achado ${i + 1}`,
      `- **Gravidade:** ${f.severity}`,
      `- **Local:** ${f.location ?? '—'}`,
      `- **Descrição:** ${f.text}`,
      '',
      ...fixFields(entId, name, f, ctx.config),
    ].join('\n'));
    fixes.push(`${name}.md`);
    messages.push({ key: 'verdict.fix_created', params: { file: `${name}.md` } });
  });

  const max = ctx.config.review?.external_rounds_max ?? 3;
  const data = { verdict: parsed.verdict, round, fixes };
  messages.unshift({ key: 'verdict.imported', params: { verdict: parsed.verdict, round, fixes: fixes.length } });
  if (round > max && parsed.verdict !== 'aprovado') {
    messages.push({ key: 'verdict.rounds_exceeded', params: { max } });
    return { code: 3, data, messages };
  }
  return { code: 0, data, messages };
}

export async function run(args, ctx) {
  const [entId, source] = args._;
  if (!entId || !ENT_ID.test(entId) || !source) return usageError();
  deliveryDir(ctx.root, ctx.config, entId); // a missing delivery fails before stdin is read
  const text = source === '-' ? readFileSync(0, 'utf8') : readText(resolve(ctx.cwd, source));
  return importVerdictText(text, entId, ctx, { source: 'person' });
}
