// Files each harness of the project needs, checked at session start (hook `hooks/baco-context.mjs`,
// and the startup step of SKILL.md on other hosts): a harness whose name or `tool` contains `codex`
// needs `.codex/rules/baco.rules` equal to the skill's `templates/codex/baco.rules`; one containing
// `antigravity` needs `.baco/antigravity/leitura.json` equal to `templates/antigravity/leitura.json`.
// The harness calls refuse to run with a missing or different file, so the conductor offers to copy it.
// Reads files only; never throws for a file it cannot read.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessTool } from './config.mjs';

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

const KINDS = [
  { match: 'antigravity', file: '.baco/antigravity/leitura.json', template: ['antigravity', 'leitura.json'] },
  { match: 'codex', file: '.codex/rules/baco.rules', template: ['codex', 'baco.rules'] },
];

const read = (file) => {
  try { return { ok: true, data: readFileSync(file) }; } catch (e) { return { ok: false, code: e?.code }; }
};

// One entry per required file: `{ file (relative to root), template (absolute), harnesses (names),
// status: ok | missing | different }`, in a fixed order. No harness that needs one: [].
export function harnessFileChecks(root, config, { templatesDir = TEMPLATES } = {}) {
  const names = Object.keys(config?.harnesses ?? {});
  const out = [];
  for (const kind of KINDS) {
    const harnesses = names.filter((n) => `${n} ${harnessTool(config, n)}`.toLowerCase().includes(kind.match));
    if (!harnesses.length) continue;
    const template = join(templatesDir, ...kind.template);
    const have = read(join(root, kind.file));
    const want = read(template);
    let status = 'ok';
    if (!have.ok) status = have.code === 'ENOENT' || have.code === 'ENOTDIR' ? 'missing' : 'different';
    else if (!want.ok || !have.data.equals(want.data)) status = 'different';
    out.push({ file: kind.file, template, harnesses, status });
  }
  return out;
}

// Only the files that are missing or differ from the template.
export const harnessFileProblems = (root, config, opts) => harnessFileChecks(root, config, opts).filter((c) => c.status !== 'ok');
