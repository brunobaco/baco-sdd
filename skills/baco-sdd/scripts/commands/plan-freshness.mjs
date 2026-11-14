import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deliveryDir, readPlanHeader, ENT_ID } from '../lib/delivery.mjs';
import { readSpec, numeric } from '../lib/spec.mjs';
import { readText } from '../lib/markdown.mjs';

export const usage = 'baco plan-freshness <ENT-NNN | path/to/plano.md> [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });

export async function run(args, ctx) {
  const arg = args._[0];
  if (!arg) return usageError();
  let planPath;
  let planLabel = arg;
  if (/\.md$/i.test(arg) || /[\\/]/.test(arg)) {
    planPath = resolve(ctx.cwd, arg);
  } else {
    if (!ENT_ID.test(arg)) return usageError();
    planPath = join(deliveryDir(ctx.root, ctx.config, arg), 'plano.md');
    planLabel = arg;
  }
  const { specs } = readPlanHeader(readText(planPath)); // ENOENT -> 65 in the dispatcher
  // A plan that names no spec cannot be fresh: nothing was checked.
  if (!specs.length) return { code: 1, data: { stale: [], noSpecs: true }, messages: [{ key: 'freshness.no_specs', params: { plan: planLabel } }] };
  const specRoot = ctx.root ?? ctx.cwd;
  const stale = [];
  for (const s of specs) {
    const file = resolve(specRoot, s.path);
    const current = existsSync(file) ? readSpec(file).version : null;
    const a = numeric(s.version);
    const b = numeric(current);
    if (current === null || a === null || b === null || a !== b) {
      stale.push({ path: s.path, planned: s.version, current });
    }
  }
  const messages = [{ key: 'freshness.summary', params: { plan: planLabel, total: specs.length, stale: stale.length } }];
  for (const s of stale) messages.push({ key: 'freshness.stale', params: { path: s.path, planned: s.planned ?? '-', current: s.current ?? '-' } });
  messages.push({ key: stale.length ? 'freshness.stale_plan' : 'freshness.fresh' });
  return { code: stale.length ? 1 : 0, data: { stale }, messages };
}
