#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { t } from './lib/messages.mjs';
import { repoRoot, GitError, GitUnavailableError } from './lib/git.mjs';
import { loadConfig, ConfigError, DEFAULTS } from './lib/config.mjs';
import { DeliveryError } from './lib/delivery.mjs';

export const COMMANDS = [
  'validate-spec', 'spec-diff', 'catalog', 'trace', 'plan-freshness', 'check-branch',
  'guard-tests', 'cleanup-branches', 'build-handoff', 'import-verdict', 'import-pr-verdict',
  'acceptance-report', 'cost', 'qa-evidence', 'waive-review', 'run-tests', 'queue-status', 'board',
  'harness-answer', 'antigravity-task', 'merge-check',
];

export function parseArgs(argv) {
  const result = { _: [], flags: {} };
  const set = (key, value) => {
    const prev = result.flags[key];
    if (prev === undefined) result.flags[key] = value;
    else result.flags[key] = [].concat(prev, value);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // A bare `--` ends the options: the rest is passed through verbatim (e.g. to a test runner).
    if (arg === '--') { result.passthrough = argv.slice(i + 1); break; }
    if (arg.startsWith('--') && arg.length > 2) {
      const eq = arg.indexOf('=');
      if (eq !== -1) set(arg.slice(2, eq), arg.slice(eq + 1));
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { set(arg.slice(2), next); i++; }
        else set(arg.slice(2), true);
      }
    } else result._.push(arg);
  }
  return result;
}

class ExitError extends Error {
  constructor(code, key, params) {
    super(key);
    this.code = code;
    this.key = key;
    this.params = params;
  }
}

export async function buildContext(flags, mod) {
  const cwd = resolve(typeof flags.cwd === 'string' ? flags.cwd : process.cwd());
  const root = repoRoot(cwd);
  if (root === null && mod?.needsRepo !== false) throw new ExitError(65, 'env.not_git_repo');
  const config = root ? loadConfig(root) : { ...structuredClone(DEFAULTS), warnings: [] };
  return { cwd, root, config, lang: config.language ?? 'pt-BR' };
}

function describeError(e) {
  if (e instanceof ExitError) return { code: e.code, key: e.key, params: e.params };
  if (e instanceof GitUnavailableError) return { code: 65, key: 'env.git_unavailable', params: { message: e.message } };
  if (e instanceof GitError) return { code: 65, key: 'env.git_error', params: { message: e.message } };
  if (e instanceof DeliveryError) return { code: 65, key: e.code === 'AMBIGUOUS' ? 'delivery.ambiguous' : 'delivery.not_found', params: { id: e.id ?? '' } };
  if (e instanceof ConfigError) return { code: 65, key: 'env.config_error', params: { line: e.line ?? '-', message: e.message } };
  if (e?.code === 'ENOENT') return { code: 65, key: 'env.file_not_found', params: { path: e.path ?? '' } };
  return { code: 1, key: 'cli.unexpected_error', params: { message: e?.message ?? String(e) } };
}

const commandFile = (name) => fileURLToPath(new URL(`./commands/${name}.mjs`, import.meta.url));

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const { _: positional, flags, passthrough = [] } = parseArgs(argv);
  const lang = 'pt-BR';
  const [name, ...rest] = positional;

  if (flags.help || name === undefined) {
    const lines = [t(lang, 'cli.help_header')];
    for (const c of COMMANDS) lines.push(`  ${c.padEnd(18)}${t(lang, `cmd.${c}.summary`)}`);
    lines.push('', t(lang, 'cli.help_footer'));
    io.stdout.write(lines.join('\n') + '\n');
    return 0;
  }

  if (!COMMANDS.includes(name)) {
    io.stderr.write(t(lang, 'cli.unknown_command', { name }) + '\n');
    return 64;
  }
  if (!existsSync(commandFile(name))) {
    io.stderr.write(t(lang, 'cli.not_implemented', { name }) + '\n');
    return 64;
  }

  const mod = await import(pathToFileURL(commandFile(name)).href);
  let ctx;
  try {
    ctx = await buildContext(flags, mod);
    ctx.io = io; // for commands that report progress while they run (run-tests)
    for (const w of ctx.config.warnings ?? []) io.stderr.write(t(ctx.lang, w.key, w.params) + '\n');
    const { code, data, messages = [] } = await mod.run({ _: rest, flags, passthrough }, ctx);
    const out = code >= 3 ? io.stderr : io.stdout;
    if (flags.json) {
      // Usage/environment errors are never silent: messages go to stderr and the first one is
      // added to the JSON as `error`. Success output keeps the command's `data` shape.
      if (code >= 64 && messages.length) {
        for (const m of messages) io.stderr.write(t(ctx.lang, m.key, m.params) + '\n');
        io.stdout.write(JSON.stringify({ ...data, error: { key: messages[0].key, params: messages[0].params ?? {} } }, null, 2) + '\n');
      } else io.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else for (const m of messages) out.write(t(ctx.lang, m.key, m.params) + '\n');
    return code;
  } catch (e) {
    const { code, key, params } = describeError(e);
    if (process.env.BACO_DEBUG === '1' && e?.stack) io.stderr.write(e.stack + '\n');
    io.stderr.write(t(ctx?.lang ?? 'pt-BR', key, params) + '\n');
    if (flags.json && code >= 64) io.stdout.write(JSON.stringify({ error: { key, params: params ?? {} } }, null, 2) + '\n');
    return code;
  }
}

// `baco ... | head -1` closes the pipe early: the next write fails with EPIPE. That is the reader's
// choice, not an error, so the process leaves quietly with exit 0; any other stream error is rethrown.
export function exitQuietlyOnEpipe(stream, exit = (code) => process.exit(code)) {
  stream.on('error', (e) => {
    if (e?.code === 'EPIPE') exit(0);
    else throw e;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  exitQuietlyOnEpipe(process.stdout);
  exitQuietlyOnEpipe(process.stderr);
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
