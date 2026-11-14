#!/usr/bin/env node
// Packages skills/baco-sdd into dist/baco-sdd-skill-<version>.zip (from git HEAD).
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`package: ${msg}`); process.exit(1); };
const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const argv = process.argv.slice(2);
const i = argv.indexOf('--out');
const out = resolve(ROOT, i >= 0 && argv[i + 1] ? argv[i + 1] : 'dist');

const status = git(['status', '--porcelain', '--', 'skills/']);
if (status.status !== 0) fail(`git status failed: ${status.stderr}`);
if (status.stdout.trim()) fail(`working tree under skills/ is dirty; commit or discard first:\n${status.stdout}`);

const plugin = json('.claude-plugin/plugin.json').version;
const market = json('.claude-plugin/marketplace.json').plugins[0].version;
const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(ROOT, 'skills/baco-sdd/SKILL.md'), 'utf8'))?.[1] ?? '';
const skill = /metadata:\s*\n\s+version:\s*"?([^"\n]+)"?/.exec(fm)?.[1];
const top = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('## '));
// A release names its version: an unreleased section on top ("## Próxima versão (não lançada)") is not packaged.
if (/^## .*(n[ãa]o lan[çc]ad|unreleased)/i.test(top ?? '')) fail(`CHANGELOG.md starts with an unreleased section ("${top}"); name the version before packaging`);
const changelog = /^## (\S+)/.exec(top ?? '')?.[1];
if (plugin !== market || plugin !== skill || plugin !== changelog) {
  fail(`versions disagree: plugin.json=${plugin}, marketplace.json=${market}, SKILL.md=${skill}, CHANGELOG.md=${changelog}`);
}

mkdirSync(out, { recursive: true });
const zip = join(out, `baco-sdd-skill-${plugin}.zip`);
const r = git(['archive', '--format=zip', '--prefix=baco-sdd/', '-o', zip, 'HEAD:skills/baco-sdd']);
if (r.status !== 0) fail(`git archive failed: ${r.stderr}`);
console.log(zip);
