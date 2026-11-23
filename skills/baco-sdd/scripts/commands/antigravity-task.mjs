import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentBranch, git, repoRoot } from '../lib/git.mjs';
import { loadConfig, protectedBranches } from '../lib/config.mjs';

export const needsRepo = false;
export const usage = 'baco antigravity-task <pasta da tarefa> [--sandbox protegida|rede|livre] [--model <modelo>] [--clean] [--json] [--cwd <dir>]';

export const SANDBOXES = ['protegida', 'rede', 'livre'];

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

// One plain argument: a single-quoted text, a double-quoted text without `$`, backtick or backslash,
// or a word with no space, shell operator, `$`, backtick, parenthesis, quote or backslash (the same
// shapes the read rules accept). So no `|`, `&&`, `;`, `>` or substitution passes.
const BT = '`';
const ARG = String.raw`(?:'[^'\n]*'|"[^"\n$` + BT + String.raw`\\]*"|[^ \t\n;&|<>$` + BT + String.raw`()'"\\]+)`;
const commandRule = (head, arg = ARG) => `command(regex:^${head}(?: +${arg})*$)`;
// npx arguments: the same shapes, except that none may turn the registry download back on: no `--yes`
// or `-y` (no long option starting with `y`, no short option group with a `y`) and no quoted text
// starting with `-`. No lookahead: Antigravity's matcher may not support it.
const WORD = String.raw`[^ \t\n;&|<>$` + BT + String.raw`()'"\\]`;
const NPX_ARG = String.raw`(?:'(?:[^-'\n][^'\n]*)?'|"(?:[^-"\n$` + BT + String.raw`\\][^"\n$` + BT + String.raw`\\]*)?"|[^- \t\n;&|<>$` + BT + String.raw`()'"\\]${WORD}*|-[a-xzA-Z0-9]+|--|--[a-xz0-9]${WORD}*)`;
// rede and livre: installs and browser tests by itself. npm only with the subcommands that install,
// test, run a script or read the registry (never publish, unpublish, token, login, adduser, config,
// owner, access, dist-tag, deprecate); npx only with `--no` or `--no-install`, so it runs what is
// already installed and never downloads a package. `node` runs any program: the honest limit.
const NETWORK_RULES = [
  commandRule('npm (?:ci|install|i|test|run|ls|view)'),
  `command(regex:^npx +--no(?:-install)?(?: +${NPX_ARG})*$)`,
  commandRule('node'),
];
// livre: the same command list. `git grep` and `find` are left out: their safe forms (without `-O`,
// without `-exec`, `-delete` and the like) needed a lookahead, and reading is covered by the read rules.
const LIVRE_RULES = [];

// The task's permission rules: the read-only reviewer's rules, plus BACO's test runner (exact path,
// plain arguments, no shell constructs), with the approval mode pinned, so the person's own
// Antigravity settings cannot widen them (checked with CLI 1.5.10). protegida: no install, no git
// write, no web. rede and livre add npm (listed subcommands), npx (no download) and node; livre differs
// only by having no write hook. The web tools stay denied in every mode.
function taskSettings(sandbox) {
  const read = JSON.parse(readFileSync(READ_RULES, 'utf8'));
  const runTests = `command(regex:^node ${escapeRegex(BACO)} run-tests(?: +[^ \\t\\n;&|<>$\`()'"\\\\]+)*$)`;
  const allow = [...read.permissions.allow, runTests];
  if (sandbox === 'rede') allow.push(...NETWORK_RULES);
  if (sandbox === 'livre') allow.push(...LIVRE_RULES, ...NETWORK_RULES);
  return {
    toolPermission: 'request-review',
    agentMode: '',
    permissions: {
      allow,
      deny: ['read_url(*)', 'execute_url(*)', 'download_url(*)'],
    },
  };
}

// The implementer call's arguments after `-p "<prompt>"`, run from the task folder with stdin from
// /dev/null. `--mode accept-edits` approves the file edits headless; never --dangerously-skip-permissions.
const callArgs = (model) => ['--settings', SETTINGS.split('\\').join('/'), '--model', model, '--mode', 'accept-edits', '--print-timeout', '0', '--output-format', 'json'];

// Prepares a task folder for an Antigravity implementer, or (--clean) takes the preparation out.
// The folder must be the top of a git working tree (a task worktree) on a branch that is not
// protected. Antigravity loads a workspace's hooks from `.agents/hooks.json`; BACO's hook there keeps
// the file tools inside the folder (protegida and rede; livre has none, and a BACO one left there is
// removed). Both files are listed in git's exclude list, so they never show in `git status` nor get
// committed.
export async function run(args, ctx) {
  const [folderArg, ...extra] = args._;
  if (!folderArg || extra.length) return usageError();
  const sandbox = args.flags.sandbox === undefined ? 'protegida' : args.flags.sandbox;
  if (!SANDBOXES.includes(sandbox)) {
    return { code: 64, data: {}, messages: [{ key: 'agytask.bad_sandbox', params: { value: String(sandbox), usage } }] };
  }
  const model = typeof args.flags.model === 'string' && args.flags.model.trim() ? args.flags.model.trim() : '<model>';
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
  const guarded = sandbox !== 'livre';
  if (guarded) {
    const command = `node "${GUARD}" --root "${folder}"`;
    writeFileSync(hooksFile, `${JSON.stringify({
      [KEY]: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command, timeout: 10 }] }] },
    }, null, 2)}\n`);
  } else {
    // Only a BACO hooks file reaches here (any other was refused above).
    rmSync(hooksFile, { force: true });
  }
  writeFileSync(settingsFile, `${JSON.stringify(taskSettings(sandbox), null, 2)}\n`);

  const exclude = resolve(folder, git(['rev-parse', '--git-path', 'info/exclude'], folder));
  mkdirSync(dirname(exclude), { recursive: true });
  const lines = existsSync(exclude) ? readFileSync(exclude, 'utf8').split('\n') : [];
  const missing = EXCLUDE.filter((l) => !lines.includes(l));
  if (missing.length) {
    const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  }

  const runTests = `node ${BACO} run-tests`;
  return {
    code: 0,
    data: {
      folder, branch, sandbox, hooks: guarded ? hooksFile : null, settings: settingsFile, settingsArg: SETTINGS,
      guard: guarded ? GUARD : null, runTests, callArgs: callArgs(model),
    },
    messages: [{ key: sandbox === 'protegida' ? 'agytask.ready' : `agytask.ready_${sandbox}`, params: { folder, settings: SETTINGS, runTests } }],
  };
}
