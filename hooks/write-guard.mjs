#!/usr/bin/env node
// PreToolUse guard on the shell tool (Claude Code: Bash; Antigravity: run_command), for BACO subagents
// only (host.mjs tells a subagent in each host): denies a command that redirects output (`>`, `>>`, `&>`, `<>`, `tee`) to a file outside
// the project. It guards against an agent's accidental writes, not against a hostile agent: it is not
// a security boundary. The project is the git work tree of the command's folder (with
// `.baco/config.yaml`) and, from a linked worktree, the main work tree too. The destination is judged
// where the kernel would open it: each path component is followed through symlinks (also a dangling
// one) before `..` is applied. /dev/* is fine when the path reaches it without `..`. A target it
// cannot place is allowed: one with a variable, a command substitution or an unquoted wildcard, an
// unquoted `~user`, or a relative path after a change of folder. Known gaps (see
// scripts/lib/shellwrites.mjs): `sh -c` and `eval` strings, aliases and functions, heredoc body
// expansions, and files programs write by themselves. Fails open: on any error it allows the command
// and writes one line to stderr. End-to-end test, round D: an implementer wrote `../a.log` in the
// parent folder while redirecting a command's output.
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { shellWrites } from '../skills/baco-sdd/scripts/lib/shellwrites.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, preToolAnswer } from './host.mjs';

const ALLOW = { deny: false };
const gitOut = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// The folders the subagent may write in: its work tree and, for a linked worktree, the main one.
function projectRoots(cwd) {
  let top;
  try { top = gitOut(['rev-parse', '--show-toplevel'], cwd); } catch { return null; }
  if (!top || !existsSync(join(top, '.baco', 'config.yaml'))) return null;
  const roots = [realpathSync(top)];
  try {
    const common = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    const main = dirname(common);
    if (common.endsWith(`${sep}.git`) && existsSync(main)) {
      const real = realpathSync(main);
      if (!roots.includes(real)) roots.push(real);
    }
  } catch { /* old git: the work tree only */ }
  return roots;
}

// Where the kernel would open `path` (absolute `path`, or relative to the real folder `base`): each
// component is followed through symlinks, a dangling one too, before the next one or `..` applies.
// A component that does not exist is kept as written. Null when links loop.
function physical(base, path, hops = 0) {
  let cur = path.startsWith('/') ? '/' : realpathSync(base);
  const parts = path.split('/').filter((p) => p !== '' && p !== '.');
  for (let k = 0; k < parts.length; k++) {
    if (parts[k] === '..') { cur = dirname(cur); continue; }
    const next = cur === '/' ? `/${parts[k]}` : `${cur}/${parts[k]}`;
    let link = null;
    try { if (lstatSync(next).isSymbolicLink()) link = readlinkSync(next); } catch { /* missing: kept as written */ }
    if (link !== null) {
      if (hops >= 40) return null;
      const rest = parts.slice(k + 1).join('/');
      return physical(cur, rest ? `${link}/${rest}` : link, hops + 1);
    }
    cur = next;
  }
  return cur;
}

const inside = (path, root) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
const isDevice = (raw) => /^\/dev\//.test(raw) && !raw.split('/').includes('..');

// `hook` is the normalized input of host.mjs.
export function decide(hook) {
  if (!hook.subagent()) return ALLOW;
  const command = hook.command;
  const cwd = hook.cwd;
  if (typeof command !== 'string' || !cwd || !existsSync(cwd)) return ALLOW;
  const placed = [];
  for (const t of shellWrites(command).targets) {
    // Cannot be placed without running the shell: an expansion, an unquoted wildcard, `~user`.
    if (t.value === '' || t.expands || t.glob) continue;
    let p = t.value;
    if (t.tilde) {
      if (p !== '~' && !p.startsWith('~/')) continue;
      p = homedir() + p.slice(1);
    }
    if (!p.startsWith('/') && t.afterCd) continue;
    if (isDevice(p)) continue;
    placed.push({ raw: t.value, path: p });
  }
  if (!placed.length) return ALLOW;
  const roots = projectRoots(cwd);
  if (!roots) return ALLOW;
  const outside = placed.filter(({ path }) => {
    const real = physical(cwd, path);
    return real !== null && !roots.some((r) => inside(real, r));
  });
  if (!outside.length) return ALLOW;
  return {
    deny: true,
    reason: `Comando bloqueado: grava fora do projeto (${outside.map((o) => o.raw).join(', ')}). `
      + 'Saída de comando vai para .baco/logs/ dentro do projeto ou é filtrada com | tail; nunca grave fora do projeto. '
      + 'Para testes, use baco run-tests, que já guarda a saída inteira em .baco/logs/.',
  };
}

if (isMainModule(import.meta.url)) {
  let hook = readHookInput(null);
  let result = ALLOW;
  try {
    hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    result = decide(hook);
  } catch (err) {
    process.stderr.write(`baco write-guard: ${err.message} (permitido)\n`);
  }
  process.stdout.write(preToolAnswer(hook.host, result));
  process.exit(0);
}
