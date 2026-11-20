import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentBranch, git, repoRoot } from '../lib/git.mjs';
import { loadConfig, protectedBranches } from '../lib/config.mjs';

export const needsRepo = false;
export const usage = 'baco antigravity-task <pasta da tarefa> [--clean] [--json] [--cwd <dir>]';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(SCRIPTS, 'antigravity-guard.mjs');
const BACO = join(SCRIPTS, 'baco.mjs');
const READ_RULES = join(SCRIPTS, '..', 'templates', 'antigravity', 'leitura.json');
const KEY = 'baco-tarefa';
const HOOKS = join('.agents', 'hooks.json');
const SETTINGS = join('.agents', 'baco-construcao.json');
const EXCLUDE = ['/.agents/hooks.json', '/.agents/baco-construcao.json'];

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const refuse = (key, params, data = {}) => ({ code: 1, data, messages: [{ key, params }] });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A hooks file is ours when its only group is BACO's.
function hooksAreOurs(file) {
  try {
    const keys = Object.keys(JSON.parse(readFileSync(file, 'utf8')));
    return keys.length === 1 && keys[0] === KEY;
  } catch {
    return false;
  }
}

// The task's permission rules: the read-only reviewer's rules, plus BACO's test runner (exact path,
// plain arguments, no shell constructs), with the approval mode pinned, so the person's own
// Antigravity settings cannot widen them (checked with CLI 1.5.10). No install, no git write, no web.
function taskSettings() {
  const read = JSON.parse(readFileSync(READ_RULES, 'utf8'));
  const runTests = `command(regex:^node ${escapeRegex(BACO)} run-tests(?: +[^ \\t\\n;&|<>$\`()'"\\\\]+)*$)`;
  return {
    toolPermission: 'request-review',
    agentMode: '',
    permissions: {
      allow: [...read.permissions.allow, runTests],
      deny: ['read_url(*)', 'execute_url(*)', 'download_url(*)'],
    },
  };
}

// Prepares a task folder for an Antigravity implementer, or (--clean) takes the preparation out.
// The folder must be the top of a git working tree (a task worktree) on a branch that is not
// protected. Antigravity loads a workspace's hooks from `.agents/hooks.json`; BACO's hook there keeps
// the file tools inside the folder. Both files are listed in git's exclude list, so they never show
// in `git status` nor get committed.
export async function run(args, ctx) {
  const [folderArg, ...extra] = args._;
  if (!folderArg || extra.length) return usageError();
  const asked = resolve(ctx.cwd, folderArg);
  const top = existsSync(asked) ? repoRoot(asked) : null;
  if (!top || realpathSync(top) !== realpathSync(asked)) return refuse('agytask.not_task_folder', { folder: asked });
  const folder = realpathSync(asked);
  const hooksFile = join(folder, HOOKS);
  const settingsFile = join(folder, SETTINGS);
  const tracked = git(['ls-files', '--', HOOKS, SETTINGS], folder);
  if (tracked || (existsSync(hooksFile) && !hooksAreOurs(hooksFile))) {
    return refuse('agytask.foreign_hooks', { file: hooksFile });
  }

  if (args.flags.clean) {
    rmSync(hooksFile, { force: true });
    rmSync(settingsFile, { force: true });
    const dir = join(folder, '.agents');
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
    return { code: 0, data: { folder, cleaned: true }, messages: [{ key: 'agytask.cleaned', params: { folder } }] };
  }

  // The branch name also on a fresh folder with no commit yet (the write check's scratch folder).
  let branch;
  try {
    branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], folder);
  } catch {
    branch = currentBranch(folder);
  }
  if (protectedBranches(loadConfig(folder)).includes(branch)) return refuse('agytask.protected', { folder, branch });

  mkdirSync(join(folder, '.agents'), { recursive: true });
  const command = `node "${GUARD}" --root "${folder}"`;
  writeFileSync(hooksFile, `${JSON.stringify({
    [KEY]: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }] },
  }, null, 2)}\n`);
  writeFileSync(settingsFile, `${JSON.stringify(taskSettings(), null, 2)}\n`);

  const exclude = resolve(folder, git(['rev-parse', '--git-path', 'info/exclude'], folder));
  mkdirSync(dirname(exclude), { recursive: true });
  const lines = existsSync(exclude) ? readFileSync(exclude, 'utf8').split('\n') : [];
  const missing = EXCLUDE.filter((l) => !lines.includes(l));
  if (missing.length) {
    const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  }

  return {
    code: 0,
    data: { folder, branch, hooks: hooksFile, settings: settingsFile, settingsArg: SETTINGS, guard: GUARD, runTests: `node ${BACO} run-tests` },
    messages: [{ key: 'agytask.ready', params: { folder, settings: SETTINGS, runTests: `node ${BACO} run-tests` } }],
  };
}
