import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, ENT_ID } from '../lib/delivery.mjs';
import { fold, headings, readText } from '../lib/markdown.mjs';

export const usage = 'baco check-stalled [ENT-NNN] [--minutes <n>] [--json] [--cwd <dir>]';

const DEFAULT_MINUTES = 20;
const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const clean = (s) => String(s ?? '').replace(/`/g, '').trim();
const isPlaceholder = (s) => !s || s.startsWith('<') || /^nao\s+informad[oa]$/i.test(fold(s));

// Extracts Retomada fields from progresso.md: status, autonomous flag, conductor conversation
// address/link, and next step.
export function parseRetomada(md) {
  const text = String(md ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const hs = headings(text);
  const idx = hs.findIndex((h) => fold(h.title).trim().startsWith('retomada'));
  if (idx < 0) return { status: null, autonomous: false, conductor: null, nextStep: null };
  const start = hs[idx].line;
  const end = hs.slice(idx + 1).find((h) => h.level <= hs[idx].level)?.line ?? lines.length + 1;

  let status = null;
  let autonomous = false;
  let conductor = null;
  let nextStep = null;

  for (let i = start; i < end - 1; i++) {
    const m = /^\s*[-*]\s*\*\*\s*([^*:]+?)\s*:?\s*\*\*\s*:?\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const label = fold(m[1]).replace(/:$/, '').trim();
    const val = clean(m[2]);
    if (label === 'situacao') {
      status = isPlaceholder(val) ? null : fold(val);
    } else if (label === 'execucao autonoma' || label === 'autonomous') {
      autonomous = /^(sim|yes|true|on)\b/.test(fold(val));
    } else if (label === 'conversa condutora' || label === 'conductor conversation') {
      conductor = isPlaceholder(val) ? null : val;
    } else if (label === 'proximo passo') {
      nextStep = isPlaceholder(val) ? null : val;
    }
  }
  return { status, autonomous, conductor, nextStep };
}

function listDeliveryDirs(root, config, entId) {
  if (entId) return [{ id: entId, dir: deliveryDir(root, config, entId) }];
  const base = join(root, config?.docs_root ?? 'docs', 'entregas');
  if (!existsSync(base)) return [];
  const out = [];
  for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const m = /^(ENT-\d{3})-/.exec(d.name);
    if (m) out.push({ id: m[1], dir: join(base, d.name) });
  }
  out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}

export async function run(args, ctx) {
  const entId = args._[0];
  if (args._.length > 1 || (entId !== undefined && !ENT_ID.test(entId))) return usageError();
  let minutes = DEFAULT_MINUTES;
  if (args.flags.minutes !== undefined) {
    if (typeof args.flags.minutes !== 'string' || !/^[1-9]\d*$/.test(args.flags.minutes)) return usageError();
    minutes = Number(args.flags.minutes);
  }
  const nowMs = Date.now();
  const dirs = listDeliveryDirs(ctx.root, ctx.config, entId);
  const stalled = [];

  for (const { id, dir } of dirs) {
    const progressPath = join(dir, 'progresso.md');
    if (!existsSync(progressPath)) continue;
    const info = parseRetomada(readText(progressPath));
    if (!info.autonomous || info.status !== 'rodando') continue;
    const mtimeMs = statSync(progressPath).mtimeMs;
    const idleMinutes = Math.max(0, Math.floor((nowMs - mtimeMs) / 60000));
    if (idleMinutes >= minutes) {
      stalled.push({
        delivery: id,
        idleMinutes,
        conductor: info.conductor,
        nextStep: info.nextStep,
        updatedAt: new Date(mtimeMs).toISOString(),
      });
    }
  }

  const data = { stalled: stalled.length > 0, minutes, deliveries: stalled };
  if (!stalled.length) {
    return { code: 0, data, messages: [{ key: 'stalled.none', params: { minutes } }] };
  }
  const messages = [
    { key: 'stalled.found', params: { count: stalled.length, minutes } },
    ...stalled.map((d) => ({
      key: 'stalled.item',
      params: {
        delivery: d.delivery,
        idleMinutes: d.idleMinutes,
        conductor: d.conductor ?? '-',
        nextStep: d.nextStep ?? '-',
      },
    })),
  ];
  return { code: 2, data, messages };
}
