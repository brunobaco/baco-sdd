#!/usr/bin/env node
// PreToolUse guard: denies a file edit (Claude Code: Edit/Write/NotebookEdit; Antigravity: write_file,
// edit_file and the other file-writing tools) on a protected branch of a BACO project.
// Fails open: on any error it allows the edit and writes one line to stderr.
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, relative, isAbsolute, resolve, sep } from 'node:path';
import { repoRoot, currentBranch, git } from '../skills/baco-sdd/scripts/lib/git.mjs';
import { loadConfig, resolveConfig, protectedBranches, ConfigError } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, preToolAnswer } from './host.mjs';

const ALLOW = { deny: false };

function nearestExistingDir(path) {
  let dir = dirname(path);
  while (!existsSync(dir)) {
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return dir;
}

// Follows a symlink chain by hand (lstat/readlink), so a dangling link is judged by the place it points to,
// not by the place the link itself lives. Any failure keeps the path as given (fail-open).
function followLinks(path) {
  let p = path;
  try {
    for (let i = 0; i < 40; i++) {
      if (!lstatSync(p).isSymbolicLink()) return p;
      p = resolve(dirname(p), readlinkSync(p));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') return p;
  }
  return p;
}

// An unreadable config must not switch protection off: fall back to the defaults.
function projectConfig(root) {
  try {
    return loadConfig(root);
  } catch (err) {
    if (err instanceof ConfigError) return resolveConfig({});
    throw err;
  }
}

// symbolic-ref also works in a repo with no commit yet; a detached HEAD falls back to rev-parse.
function branchName(root) {
  try {
    return git(['symbolic-ref', '--short', 'HEAD'], root);
  } catch {
    return currentBranch(root);
  }
}

const ENGINE_ONLY_RE = /(?:^|\/)entregas\/[^/]+\/(?:aprovacao-plano\.md|revisao\/dispensa-revisao-externa\.md)$/;

// `hook` is the normalized input of host.mjs.
export function decide(hook) {
  const path = hook.filePath;
  if (typeof path !== 'string' || !isAbsolute(path)) return ALLOW;
  const dir = nearestExistingDir(path);
  const root = dir && repoRoot(dir);
  if (!root || !existsSync(join(root, '.baco', 'config.yaml'))) return ALLOW;
  // git reports the real path (macOS /var -> /private/var); compare in the same terms.
  // An existing file is compared by its own real path, so a symlink in .baco/ pointing out is not exempt.
  const end = followLinks(path);
  const endDir = nearestExistingDir(end) ?? dir;
  const target = existsSync(end) ? realpathSync(end) : join(realpathSync(endDir), relative(endDir, end));
  const rel = relative(realpathSync(root), target);
  if (rel === '.baco' || rel.startsWith(`.baco${sep}`)) return ALLOW;
  const relPosix = rel.split(sep).join('/');
  if (ENGINE_ONLY_RE.test(relPosix)) {
    return {
      deny: true,
      reason: 'Edição bloqueada: aprovações do plano (aprovacao-plano.md) e dispensas de revisão externa (dispensa-revisao-externa.md) só podem ser gravadas pelo motor do BACO (baco approve-plan / baco waive-review).',
    };
  }
  const branch = branchName(root);
  if (!protectedBranches(projectConfig(root)).includes(branch)) return ALLOW;
  return {
    deny: true,
    reason: `Edição bloqueada: a branch "${branch}" é protegida neste projeto. Trabalhe na branch da entrega (baco/ENT-NNN) ou numa branch docs/<nome>. Para conferir: baco check-branch.`,
  };
}

if (isMainModule(import.meta.url)) {
  let hook = readHookInput(null);
  let result = ALLOW;
  try {
    hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    result = decide(hook);
  } catch (err) {
    process.stderr.write(`baco branch-guard: ${err.message} (permitido)\n`);
  }
  process.stdout.write(preToolAnswer(hook.host, result));
  process.exit(0);
}
