#!/usr/bin/env node
// PreToolUse hook for an Antigravity implementer, installed in its task folder by
// `baco antigravity-task` (`.agents/hooks.json`). In non-interactive mode the Antigravity CLI's file
// tools write anywhere the person can, whatever the permission rules say (checked with CLI 1.5.10),
// so this hook is what keeps them inside the task folder. It answers in Antigravity's format:
// `{"decision":"deny","reason":...}` blocks the tool and the model reads the reason (the run goes
// on); `{"decision":"allow"}` leaves the permission rules in charge. Any doubt denies.
//
//   node antigravity-guard.mjs --root <task folder>
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// Tools that only read; their paths are not checked (Antigravity itself keeps reads in the workspace).
const READ_TOOLS = new Set([
  'read_file', 'view_file', 'view_file_outline', 'view_code_item', 'list_dir', 'list_directory',
  'grep_search', 'find_by_name', 'codebase_search',
]);
// Arguments that name a place on disk, in any tool: Path, TargetFile, AbsolutePath, DirectoryPath, Cwd...
const PLACE = /(path|file|dir|directory|folder|cwd)$/i;
// Inside the task folder, still never written: the hook and its rules, and git's data.
const CONTROL = new Set(['.agents', '.git']);

const answer = (deny, reason) => {
  process.stdout.write(JSON.stringify(deny ? { decision: 'deny', reason } : { decision: 'allow' }));
  process.exit(0);
};

// The real place of a path that may not exist yet: the real path of its deepest existing ancestor,
// plus the rest, so a symbolic link inside the folder cannot lead a write out of it.
function realPlace(p) {
  let head = p;
  const rest = [];
  while (!existsSync(head)) {
    const up = dirname(head);
    if (up === head) return p;
    rest.unshift(basename(head));
    head = up;
  }
  return join(realpathSync(head), ...rest);
}

const i = process.argv.indexOf('--root');
const rootArg = i >= 0 ? process.argv[i + 1] : null;
if (!rootArg || !existsSync(rootArg)) answer(true, 'BACO: a trava da pasta da tarefa está sem a pasta (--root); nada é gravado.');
const root = realpathSync(rootArg);

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  answer(true, 'BACO: a trava da pasta da tarefa não conseguiu ler a chamada; nada é gravado.');
}
const name = typeof input?.toolCall?.name === 'string' ? input.toolCall.name : '';
const args = input?.toolCall?.args && typeof input.toolCall.args === 'object' ? input.toolCall.args : {};
if (READ_TOOLS.has(name)) answer(false);

const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
for (const [key, value] of Object.entries(args)) {
  if (!PLACE.test(key) || typeof value !== 'string' || !value.trim()) continue;
  const place = realPlace(resolve(base, value));
  const rel = relative(root, place);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    answer(true, `BACO: fora da pasta da tarefa (${place}). Grave e rode comandos só dentro de ${root}.`);
  }
  if (CONTROL.has(rel.split(sep)[0])) {
    answer(true, `BACO: ${rel} é arquivo de controle da tarefa e não se altera.`);
  }
}
answer(false);
