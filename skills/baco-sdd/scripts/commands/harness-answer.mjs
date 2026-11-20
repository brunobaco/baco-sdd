import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const needsRepo = false;
export const usage = 'baco harness-answer <resposta.json> --out <resposta.md> [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

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
  const base = {
    status: env.status,
    conversation: typeof env.conversation_id === 'string' ? env.conversation_id : null,
    tokens: usage?.total ?? null,
    usage,
    turns: num(env.num_turns),
    seconds: seconds === null ? null : Math.round(seconds),
    denied,
  };
  const actions = denied.join(', ');

  if (env.status !== 'SUCCESS') {
    const error = typeof env.error === 'string' && env.error.trim() ? env.error.trim() : null;
    return { code: 1, data: { outcome: 'failed', ...base, error }, messages: [{ key: 'answer.failed', params: { status: env.status, error: error ? `: ${error}` : '' } }] };
  }
  if (!response.trim()) {
    if (denied.length) {
      return { code: 1, data: { outcome: 'denied', ...base }, messages: [{ key: 'answer.denied', params: { actions, conversation: base.conversation ?? '?' } }] };
    }
    return { code: 1, data: { outcome: 'empty', ...base }, messages: [{ key: 'answer.empty' }] };
  }

  writeFileSync(out, response);
  const messages = [{
    key: 'answer.written',
    params: {
      out, chars: response.length, tokens: base.tokens ?? '?', turns: base.turns ?? '?', seconds: base.seconds ?? '?',
    },
  }];
  if (denied.length) messages.push({ key: 'answer.denied_warning', params: { n: denied.length, actions } });
  return { code: 0, data: { outcome: 'written', ...base, out, chars: response.length }, messages };
}
