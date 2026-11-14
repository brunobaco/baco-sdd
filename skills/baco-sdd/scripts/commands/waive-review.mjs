import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, numberedFiles, ENT_ID } from '../lib/delivery.mjs';
import { revParse } from '../lib/git.mjs';
import { renderWaiver, WAIVER_FILE } from '../lib/waiver.mjs';
import { formatTimestamp } from './cost.mjs';

export const usage = 'baco waive-review <ENT-NNN> --by <name> --reason <text> [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const pad = (n) => String(n).padStart(2, '0');

// Local date and time with its zone, so a reader elsewhere knows when it was:
// `2026-11-02 14:10 (UTC-03:00, America/Sao_Paulo)`; the IANA name is left out when unknown.
export function formatZoned(d) {
  const off = -d.getTimezoneOffset();
  const offset = `UTC${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  let zone = null;
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* no Intl zone data */ }
  return `${formatTimestamp(d)} (${zone ? `${offset}, ${zone}` : offset})`;
}
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Records the human's decision to go without an external review. Valid only while no verdict was
// imported: once a verdict exists, the verdict rules apply (a new round, or the exit-3 decision).
export async function run(args, ctx) {
  const entId = args._[0];
  const by = str(args.flags.by);
  const reason = str(args.flags.reason);
  if (!entId || !ENT_ID.test(entId) || !by || !reason) return usageError();
  const revDir = join(deliveryDir(ctx.root, ctx.config, entId), 'revisao');
  if (numberedFiles(revDir, 'veredito').length) return { code: 64, data: {}, messages: [{ key: 'waive.verdict_exists', params: { id: entId } }] };
  const head = revParse('HEAD', ctx.root);
  const date = formatZoned(ctx.now ? ctx.now() : new Date());
  mkdirSync(revDir, { recursive: true });
  const file = join(revDir, WAIVER_FILE);
  writeFileSync(file, renderWaiver({ entId, by, date, reason, head }));
  return { code: 0, data: { file, by, date, reason, head }, messages: [{ key: 'waive.written', params: { file, by, date } }] };
}
