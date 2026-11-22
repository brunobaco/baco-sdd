import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mainCheckout } from '../lib/git.mjs';
import { TOOL_LEDGER } from '../lib/usage.mjs';

export const needsRepo = false;
export const usage = 'baco harness-answer <resposta.json> --out <resposta.md> [--harness <h>] [--model <m>] [--agent <papel>] [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const FIELDS = ['input', 'output', 'thinking', 'cacheRead', 'total'];

// The tool reports the usage of the whole conversation so far (a resume with --conversation prints
// the earlier calls' numbers plus its own). Each call is kept in the project's git-ignored ledger
// with that running total; what this call added is the difference to the largest earlier total of
// the same conversation. Only numbers, the harness entry, the model, the role and the tool's
// conversation id are written: never the prompt or the answer.
function record(ctx, { harness, model, agent, conversation, usage, turns }) {
  const out = { recorded: false, added: usage, turnsAdded: turns, resumed: false, ledger: null, warning: null };
  if (!ctx.root || !usage || !conversation) return out;
  const root = mainCheckout(ctx.root) ?? ctx.root;
  const file = join(root, TOOL_LEDGER);
  out.ledger = file;
  const earlier = [];
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      try {
        const o = JSON.parse(line);
        if (o && o.harness === harness && o.conversation === conversation) earlier.push(o);
      } catch { /* blank or broken line */ }
    }
  }
  if (earlier.length) {
    out.resumed = true;
    out.added = {};
    for (const f of FIELDS) {
      const before = Math.max(0, ...earlier.map((o) => num(o[f]) ?? 0));
      out.added[f] = usage[f] === null ? null : Math.max(0, usage[f] - before);
    }
    const turnsBefore = Math.max(0, ...earlier.map((o) => num(o.turns) ?? 0));
    out.turnsAdded = turns === null || !turnsBefore ? turns : Math.max(0, turns - turnsBefore);
  }
  // `git check-ignore -q`: 0 = ignored, 1 = not ignored, anything else = cannot tell.
  const ignored = spawnSync('git', ['check-ignore', '-q', TOOL_LEDGER], { cwd: root, stdio: 'ignore' }).status;
  if (ignored !== 0) {
    out.warning = { key: 'answer.ledger_not_ignored', params: { path: '.baco/logs/' } };
    return out;
  }
  mkdirSync(join(root, '.baco', 'logs'), { recursive: true });
  const row = { at: (ctx.now ? ctx.now() : new Date()).toISOString(), harness, model, agent, conversation, ...usage, ...(turns === null ? {} : { turns }) };
  appendFileSync(file, `${JSON.stringify(row)}\n`);
  out.recorded = true;
  return out;
}

// The usage block of the envelope, renamed; null when the tool reported none.
function readUsage(u) {
  if (!u || typeof u !== 'object') return null;
  return {
    input: num(u.input_tokens), output: num(u.output_tokens), thinking: num(u.thinking_tokens),
    cacheRead: num(u.cache_read_tokens), total: num(u.total_tokens),
  };
}

const isEnvelope = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.status === 'string';

// The whole file is the envelope (stdout redirected to it), or, when the tool's stderr went to the
// same file (a run in the background whose output the host captured), the last line that is one.
function readEnvelope(text) {
  try {
    const whole = JSON.parse(text);
    return isEnvelope(whole) ? { env: whole } : { problem: 'status' };
  } catch (e) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const v = JSON.parse(lines[i]);
        if (isEnvelope(v)) return { env: v };
      } catch { /* not a JSON line */ }
    }
    return { problem: e.message };
  }
}

// Reads the JSON envelope an AI tool prints in non-interactive mode (Antigravity CLI:
// `--output-format json`) and decides what the conductor does next. The engine, not the conductor,
// writes the reviewer's answer file, so the answer reaches the project exactly as the tool gave it.
// - written: SUCCESS with a non-empty response; the response goes to --out verbatim.
// - denied: the tool stopped on an action it may not run (headless mode cannot ask) before
//   answering; resume the same conversation (Antigravity CLI ends the run on the first such denial).
// - failed: any status other than SUCCESS (quota, error, cancel, timeout).
// - empty: SUCCESS with no response and no denial.
export async function run(args, ctx) {
  const [file, ...extra] = args._;
  const outFlag = args.flags.out;
  if (!file || extra.length || typeof outFlag !== 'string' || !outFlag.trim()) return usageError();
  const path = resolve(ctx.cwd, file);
  const out = resolve(ctx.cwd, outFlag.trim());
  if (out === path) return usageError();

  const { env, problem } = readEnvelope(readFileSync(path, 'utf8'));
  if (!env) return { code: 65, data: {}, messages: [{ key: 'answer.invalid_json', params: { path, message: problem } }] };

  const usage = readUsage(env.usage);
  const seconds = num(env.duration_seconds);
  const denied = Array.isArray(env.denied_actions)
    ? env.denied_actions.map((a) => (a && typeof a.action === 'string' ? a.action : String(a?.display_name ?? '?')))
    : [];
  const response = typeof env.response === 'string' ? env.response : '';
  const conversation = typeof env.conversation_id === 'string' ? env.conversation_id : null;
  for (const k of ['harness', 'model', 'agent']) if (args.flags[k] !== undefined && !text(args.flags[k])) return usageError();
  const call = record(ctx, {
    harness: text(args.flags.harness) ?? 'antigravity', model: text(args.flags.model) ?? 'desconhecido', agent: text(args.flags.agent),
    conversation, usage, turns: num(env.num_turns),
  });
  const base = {
    status: env.status,
    conversation,
    // What this call added; on a resume the tool's numbers are the conversation's running total.
    tokens: call.added?.total ?? null,
    usage: call.added,
    cumulative: usage,
    turns: call.turnsAdded,
    // The tool counts seconds since the conversation began, idle time included: unknown on a resume.
    seconds: seconds === null || call.resumed ? null : Math.round(seconds),
    denied,
    recorded: call.recorded,
    ledger: call.ledger,
  };
  const actions = denied.join(', ');
  const notes = call.warning ? [call.warning] : [];

  if (env.status !== 'SUCCESS') {
    const error = typeof env.error === 'string' && env.error.trim() ? env.error.trim() : null;
    return { code: 1, data: { outcome: 'failed', ...base, error }, messages: [{ key: 'answer.failed', params: { status: env.status, error: error ? `: ${error}` : '' } }, ...notes] };
  }
  if (!response.trim()) {
    if (denied.length) {
      return { code: 1, data: { outcome: 'denied', ...base }, messages: [{ key: 'answer.denied', params: { actions, conversation: base.conversation ?? '?' } }, ...notes] };
    }
    return { code: 1, data: { outcome: 'empty', ...base }, messages: [{ key: 'answer.empty' }, ...notes] };
  }

  writeFileSync(out, response);
  const messages = [...notes, {
    key: 'answer.written',
    params: {
      out, chars: response.length, tokens: base.tokens ?? '?', turns: base.turns ?? '?', seconds: base.seconds ?? '?',
    },
  }];
  if (denied.length) messages.push({ key: 'answer.denied_warning', params: { n: denied.length, actions } });
  return { code: 0, data: { outcome: 'written', ...base, out, chars: response.length }, messages };
}
