// Thin wrappers over the git CLI. Every helper takes `cwd` last.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export class GitError extends Error {
  constructor(message, args) {
    super(message);
    this.name = 'GitError';
    this.args = args;
  }
}

// The version control tool itself did not answer (missing, a macOS xcrun shim that cannot run in
// a sandbox, not executable). Different from a repo error: the dispatcher says "git did not respond".
export class GitUnavailableError extends GitError {
  constructor(message, args) {
    super(message, args);
    this.name = 'GitUnavailableError';
  }
}

// On macOS `/usr/bin/git` is an xcrun shim; inside a sandbox it exits 72 with "xcrun: error".
// `fallbacks` is the list tried after the primary binary fails that way (a test may replace it).
export const gitBinaries = {
  fallbacks: [
    '/Library/Developer/CommandLineTools/usr/bin/git',
    '/Applications/Xcode.app/Contents/Developer/usr/bin/git',
  ],
};
let remembered = null; // the fallback that worked, kept for the rest of the process

// Forgets the remembered binary (tests only).
export function resetGitBinary() { remembered = null; }

const isShimFailure = (e) => e?.status === 72 || /xcrun: error/.test(String(e?.stderr ?? ''));
const unreachable = (e) => isShimFailure(e) || e?.code === 'ENOENT';

function candidates() {
  if (remembered) return [remembered];
  const list = [];
  if (process.env.BACO_GIT && existsSync(process.env.BACO_GIT)) list.push(process.env.BACO_GIT);
  list.push('git');
  for (const f of gitBinaries.fallbacks) if (existsSync(f)) list.push(f);
  return [...new Set(list)];
}

// Runs git; when the binary cannot run (xcrun shim failure, not found) tries the next candidate.
// Throws the raw execFileSync error of the last attempt.
function execGit(args, cwd, options = {}) {
  const list = candidates();
  let last;
  for (let i = 0; i < list.length; i++) {
    try {
      const out = execFileSync(list[i], args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
      if (i > 0 && !remembered && list[i] !== 'git') remembered = list[i];
      return out;
    } catch (e) {
      if (!unreachable(e)) throw e;
      last = e;
    }
  }
  throw last;
}

function toError(e, args, cwd) {
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  const message = stderr || e.message;
  // ENOENT with a missing cwd is the folder's fault, not git's.
  const cwdMissing = e.code === 'ENOENT' && cwd !== undefined && !existsSync(cwd);
  if (!cwdMissing && (isShimFailure(e) || ['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT'].includes(e.code))) {
    return new GitUnavailableError(message, args);
  }
  return new GitError(message, args);
}

function raw(args, cwd) {
  try {
    return execGit(args, cwd, { maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    throw toError(e, args, cwd);
  }
}

export function git(args, cwd) {
  return raw(args, cwd).trim();
}

export function repoRoot(cwd) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd) || null;
  } catch (e) {
    if (e instanceof GitUnavailableError) throw e; // "git did not respond" is not "not a repo"
    return null;
  }
}

export function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export function revParse(ref, cwd) {
  return git(['rev-parse', ref], cwd);
}

export function refExists(ref, cwd) {
  try {
    raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
    return true;
  } catch (e) {
    if (e instanceof GitUnavailableError) throw e;
    return false;
  }
}

// Returns file content at ref, or null when the path is absent at that ref.
// An invalid ref throws GitError.
export function showFile(ref, relPath, cwd) {
  if (!refExists(ref, cwd)) throw new GitError(`bad revision '${ref}'`, ['rev-parse', ref]);
  try {
    raw(['cat-file', '-e', `${ref}:${relPath}`], cwd);
  } catch (e) {
    if (e instanceof GitUnavailableError) throw e;
    return null;
  }
  return raw(['show', `${ref}:${relPath}`], cwd);
}

export function diffNames(base, head, cwd) {
  const out = raw(['-c', 'core.quotepath=off', 'diff', '--name-status', '-M', base, head], cwd);
  const result = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [status, ...paths] = line.split('\t');
    let letter = status[0];
    if (!'AMDRTC'.includes(letter)) continue;
    // A type change (e.g. file -> symlink) or a copy is a modification of the new path.
    if (letter === 'T' || letter === 'C') letter = 'M';
    const entry = { status: letter, path: paths[paths.length - 1] };
    if (status[0] === 'R') entry.oldPath = paths[0];
    result.push(entry);
  }
  return result;
}

export function diffPatch(base, head, paths, cwd) {
  // Pinned flags: user git config (color, noprefix, external diff, textconv) must not change the patch shape.
  const args = ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '--src-prefix=a/', '--dst-prefix=b/', base, head];
  if (paths?.length) args.push('--', ...paths);
  return raw(args, cwd);
}

// True when there is no difference between a and b for the given pathspecs.
export function diffQuiet(a, b, pathspecs, cwd) {
  try {
    execGit(['diff', '--quiet', a, b, '--', ...pathspecs], cwd);
    return true;
  } catch (e) {
    if (e.status === 1) return false;
    throw toError(e, ['diff', '--quiet', a, b], cwd);
  }
}

export function isAncestor(a, b, cwd) {
  try {
    execGit(['merge-base', '--is-ancestor', a, b], cwd);
    return true;
  } catch (e) {
    if (e.status === 1) return false;
    throw toError(e, ['merge-base', '--is-ancestor', a, b], cwd);
  }
}

// The best common ancestor of a and b (a sha), or null when they share no history.
export function mergeBase(a, b, cwd) {
  try {
    return execGit(['merge-base', a, b], cwd).trim() || null;
  } catch (e) {
    if (e.status === 1) return null;
    throw toError(e, ['merge-base', a, b], cwd);
  }
}

export function localBranches(cwd) {
  const out = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], cwd);
  return out ? out.split('\n') : [];
}

export function worktrees(cwd) {
  const out = raw(['worktree', 'list', '--porcelain'], cwd);
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur); }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  return list;
}

// Returns the commit a tag points at, or null when the tag does not exist.
export function tagTarget(tag, cwd) {
  try {
    return raw(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], cwd).trim() || null;
  } catch (e) {
    if (e instanceof GitUnavailableError) throw e;
    return null;
  }
}
