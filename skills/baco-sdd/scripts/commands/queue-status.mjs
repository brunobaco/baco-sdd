import { readQueueStatus } from '../lib/queue.mjs';

export const usage = 'baco queue-status [--json] [--cwd <dir>]';
// The queue is machine-wide: it can be read from any folder.
export const needsRepo = false;

const pad = (n) => String(n).padStart(2, '0');
// Local time of day (HH:MM) of an ISO date, or '?'.
export function hhmm(iso) {
  const d = new Date(iso ?? NaN);
  return Number.isNaN(d.getTime()) ? '?' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Reads the test queue: who holds the lock (project, layer, since when) and which runs wait for it.
export async function run(args) {
  if (args._.length) return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  const { lock, waiting } = readQueueStatus();
  const who = (x) => ({ root: x.root ?? '?', layer: x.layer ?? '?', pid: x.pid ?? '?' });
  const messages = [];
  if (!lock) messages.push({ key: 'queuestatus.free' });
  else messages.push({ key: lock.alive ? 'queuestatus.running' : 'queuestatus.abandoned', params: { ...who(lock), time: hhmm(lock.started) } });
  if (!waiting.length) messages.push({ key: 'queuestatus.nobody_waiting' });
  else {
    messages.push({ key: 'queuestatus.waiting', params: { n: waiting.length } });
    for (const w of waiting) messages.push({ key: 'queuestatus.waiting_item', params: { ...who(w), time: hhmm(w.since) } });
  }
  return { code: 0, data: { lock, waiting }, messages };
}
