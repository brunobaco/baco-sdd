#!/usr/bin/env node
// Builds the BACO plugin for the Antigravity CLI from this repository's Claude Code plugin, straight
// into the folder Antigravity loads it from (default ~/.gemini/config/plugins/baco). Run it on the
// machine that uses it: the subagents get the absolute path of their role files there, because a
// subagent's instructions cannot point at a file relative to anything. Checked with CLI 1.5.10.
//
//   node tools/antigravity.mjs [--dest <folder>]
//
// What changes from the Claude Code plugin:
// - agents/<role>.md -> agents/baco-<role>.md: `subagent: true`, `mainAgent: false`, the tools as a
//   list of Antigravity names (a misspelled name can hang a subagent), `model: inherit` (the
//   conductor's model) or `flash` for the lightest roles; Antigravity has no effort per subagent.
// - commands/<name>.md -> skills/baco-<name>/SKILL.md, loaded by the model when the person asks for
//   the command by name: `/name` does not expand plugin skills in the CLI 1.5.10.
// - hooks.json in Antigravity's format, its commands run from the plugin folder with
//   `--host antigravity` (hooks/host.mjs).
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';

export const MARKER = '<!-- baco:antigravity-plugin -->';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = {
  Read: ['read_file'], Grep: ['read_file'], Glob: ['read_file'],
  Bash: ['run_command', 'manage_task'], Edit: ['edit_file'], Write: ['write_file'],
};
const FILE_TOOLS = 'write_file|edit_file|replace_file_content|write_to_file|multi_replace_file_content';

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: text.slice(m[0].length) };
}

const yamlString = (s) => JSON.stringify(s);
const commandNames = (text) => text.replace(/\/baco:([a-z][a-z-]*)/g, '/baco-$1');

function agentFile(name, text, dest) {
  const { meta, body } = frontmatter(text);
  const tools = [];
  for (const t of String(meta.tools ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    for (const n of TOOLS[t] ?? []) if (!tools.includes(n)) tools.push(n);
  }
  if (!tools.length) throw new Error(`agents/${name}.md: no tool maps to Antigravity`);
  const model = meta.model === 'haiku' ? 'flash' : 'inherit';
  const prompt = commandNames(body.replaceAll('${CLAUDE_PLUGIN_ROOT}', dest))
    .replaceAll('only with the Write and Edit tools', 'only with the file tools (write_file, edit_file)')
    .replaceAll('Use Write only', 'Use write_file only').replaceAll('Use Bash only', 'Use run_command only');
  return [
    '---', `name: baco-${name}`, `description: ${yamlString(meta.description ?? '')}`, 'subagent: true', 'mainAgent: false',
    `model: ${model}`, `tools: [${tools.join(', ')}]`, '---', '', prompt.trimStart(),
  ].join('\n');
}

function commandSkill(name, text) {
  const { meta, body } = frontmatter(text);
  const description = `BACO command "${name}". Use only when the person asks for it by name (/baco-${name} or "baco ${name}"): ${meta.description ?? ''}`;
  const prompt = commandNames(body)
    .replace(/`\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/baco-sdd\/([^`]+)`/g, (_, p) => `[${p}](../baco-sdd/${p})`)
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/', '../baco-sdd/')
    .replaceAll('$ARGUMENTS', 'what the person wrote when asking for this command');
  return ['---', `name: baco-${name}`, `description: ${yamlString(description)}`, '---', '', prompt.trimStart()].join('\n');
}

function rewriteCommandNames(dir) {
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) rewriteCommandNames(p);
    else if (n.name.endsWith('.md')) {
      const text = readFileSync(p, 'utf8');
      const next = commandNames(text);
      if (next !== text) writeFileSync(p, next);
    }
  }
}

const hookCommand = (file) => ({ type: 'command', command: `node ./hooks/${file} --host antigravity`, timeout: 10 });

export function buildAntigravityPlugin({ root = ROOT, dest }) {
  const target = resolve(dest);
  if (existsSync(target) && readdirSync(target).length) {
    const readme = join(target, 'README.md');
    const ours = existsSync(readme) && readFileSync(readme, 'utf8').startsWith(MARKER);
    if (!ours) throw new Error(`A pasta ${target} já existe e não foi gerada pelo BACO; nada foi gravado.`);
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  const claude = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));

  writeFileSync(join(target, 'plugin.json'), `${JSON.stringify({
    name: 'baco', displayName: 'BACO-SDD', version: claude.version, description: claude.description,
    ...(claude.author ? { author: claude.author } : {}), logo: 'assets/logo.png',
  }, null, 2)}\n`);
  mkdirSync(join(target, 'assets'));
  cpSync(join(root, '.claude-plugin', 'icon.png'), join(target, 'assets', 'logo.png'));

  cpSync(join(root, 'skills', 'baco-sdd'), join(target, 'skills', 'baco-sdd'), { recursive: true });
  rewriteCommandNames(join(target, 'skills', 'baco-sdd'));

  mkdirSync(join(target, 'agents'));
  const agents = readdirSync(join(root, 'agents')).filter((f) => f.endsWith('.md')).sort();
  for (const f of agents) {
    const name = f.replace(/\.md$/, '');
    writeFileSync(join(target, 'agents', `baco-${f}`), agentFile(name, readFileSync(join(root, 'agents', f), 'utf8'), target));
  }

  const commands = readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.md')).sort();
  for (const f of commands) {
    const name = f.replace(/\.md$/, '');
    mkdirSync(join(target, 'skills', `baco-${name}`));
    writeFileSync(join(target, 'skills', `baco-${name}`, 'SKILL.md'), commandSkill(name, readFileSync(join(root, 'commands', f), 'utf8')));
  }

  mkdirSync(join(target, 'hooks'));
  for (const f of readdirSync(join(root, 'hooks')).filter((n) => n.endsWith('.mjs'))) cpSync(join(root, 'hooks', f), join(target, 'hooks', f));
  writeFileSync(join(target, 'hooks.json'), `${JSON.stringify({
    baco: {
      SessionStart: [hookCommand('baco-context.mjs')],
      PreToolUse: [
        { matcher: FILE_TOOLS, hooks: [hookCommand('branch-guard.mjs')] },
        { matcher: 'run_command', hooks: [hookCommand('write-guard.mjs')] },
      ],
      PostToolUse: [
        { matcher: FILE_TOOLS, hooks: [hookCommand('board-sync.mjs')] },
      ],
      PreInvocation: [hookCommand('context-size.mjs')],
    },
  }, null, 2)}\n`);

  writeFileSync(join(target, 'README.md'), [
    MARKER,
    `# BACO-SDD ${claude.version} para o Antigravity`,
    '',
    'Gerado por `node tools/antigravity.mjs` a partir do plugin do Claude Code. Não edite aqui: gere de novo.',
    'Os papéis rodam como subagentes `baco-<papel>` e os comandos como skills `baco-<nome>`, que você chama pelo nome (por exemplo "baco executar ENT-001").',
    '',
  ].join('\n'));
  return { dest: target, agents: agents.length, commands: commands.length, version: claude.version };
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--dest');
  if (i >= 0 && !argv[i + 1]) { console.error('uso: node tools/antigravity.mjs [--dest <pasta>]'); process.exit(64); }
  const dest = i >= 0 ? argv[i + 1].replace(/^~(?=\/|$)/, homedir()) : join(homedir(), '.gemini', 'config', 'plugins', 'baco');
  try {
    const r = buildAntigravityPlugin({ dest });
    console.log(`Plugin BACO ${r.version} para o Antigravity em ${r.dest}: ${r.agents} subagentes, ${r.commands} comandos como skills, 5 ganchos.`);
    console.log('Para conferir: antigravity plugin validate <pasta> (ou agy plugin validate <pasta>).');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
