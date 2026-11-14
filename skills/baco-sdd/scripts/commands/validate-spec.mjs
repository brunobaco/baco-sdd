import { resolve } from 'node:path';
import { readSpec, validateSpec } from '../lib/spec.mjs';

export const usage = 'baco validate-spec <spec.md> [--json] [--cwd <dir>]';
export const needsRepo = false;

export async function run(args, ctx) {
  const arg = args._[0];
  if (!arg) return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  const path = resolve(ctx.cwd, arg);
  const spec = readSpec(path);
  const findings = validateSpec(path);
  const counts = { RF: 0, RN: 0, RNF: 0, INV: 0, CA: 0 };
  for (const d of spec.definitions) if (d.kind in counts) counts[d.kind]++;
  const errors = findings.filter((f) => f.level === 'error').length;
  const messages = [{ key: 'spec.summary', params: { path: arg, code: spec.code ?? '-', version: spec.version ?? '-', errors, warnings: findings.length - errors } }];
  for (const f of findings) messages.push({ key: `spec.finding.${f.code}`, params: { ...f, id: f.id ?? '' } });
  messages.push({ key: errors ? 'spec.invalid' : 'spec.valid' });
  return { code: errors ? 1 : 0, data: { path, code: spec.code, version: spec.version, counts, retired: spec.retired.map((d) => d.id), nextFree: spec.nextFree, findings }, messages };
}
