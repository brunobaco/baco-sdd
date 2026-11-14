import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readText } from '../lib/markdown.mjs';
import { readQa, appendEvidence } from '../lib/qa.mjs';

export const usage = 'baco qa-evidence <qa.md> --ct <CT-ID> --result aprovado|reprovado --where <text> --delivery <ENT-NNN> [--date YYYY-MM-DD] [--json] [--cwd <dir>]';

const pad = (n) => String(n).padStart(2, '0');
// Today's date in the LOCAL time zone (the tester's calendar day), as YYYY-MM-DD.
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const bad = (key, params) => ({ code: 64, data: {}, messages: [{ key, params }] });
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function run(args, ctx) {
  const [arg] = args._;
  const { ct, result, where, delivery, date } = Object.fromEntries(
    ['ct', 'result', 'where', 'delivery', 'date'].map((k) => [k, str(args.flags[k])]),
  );
  if (!arg || !ct || !result || !where || !delivery) return bad('cli.usage', { usage });
  if (!['aprovado', 'reprovado'].includes(result)) return bad('qa.bad_result', { value: result });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad('qa.bad_date', { value: date });
  const path = resolve(ctx.cwd, arg);
  const md = readText(path);
  const qa = readQa(path);
  if (!qa.scenarios.some((s) => s.id === ct)) return bad('qa.unknown_ct', { ct });
  const entry = { ct, result, date: date ?? localDate(new Date()), where, delivery };
  writeFileSync(path, appendEvidence(md, entry));
  return { code: 0, data: { ct, result }, messages: [{ key: 'qa.evidence_added', params: { ct, result } }] };
}
