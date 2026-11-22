import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

// Real token usage read from the session transcripts of the AI tools, never from what an agent
// says it spent. Only numbers, model names and agent types leave this module: no message text,
// no session id, no path from inside a transcript.
//
// Claude Code keeps one JSONL per conversation in ~/.claude/projects/<encoded cwd>/<session>.jsonl
// (the conductor) and the transcripts of its subagents in <session>/subagents/agent-*.jsonl, with
// the agent type in agent-*.meta.json. One API response can be written on several lines (one per
// content block) with the same message id, its usage sometimes updated from one line to the next
// (output_tokens growing while it streams): it is counted once, by message id, with the largest
// value of each number among its lines (they only grow, so this is the final usage, in any order).
// Codex keeps ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl: `token_usage_record` lines carry a
// response id (counted once each, the same way); older files only have `token_count` events, whose
// `last_token_usage` is one response, repeated when the running total did not move. A file can mix
// both (a session started on an older version and continued on a newer one): its `token_count`
// events count up to the first record, and from there only the records do, since each newer
// response writes both. The last counted `token_count` before that first record is the record's
// own response, and is dropped, only when it has the same usage and no new turn (`turn_context`,
// a user message, a task start) lies between them: equal numbers alone are not the same response.

//
// Tools that print their usage only at the end of a non-interactive call (Antigravity CLI,
// `--output-format json`) are measured from the ledger `baco harness-answer` keeps in the project:
// `.baco/logs/uso-ferramentas.jsonl`, one line per call with the conversation's running total
// (that tool reports usage since the conversation began). Each call counts what it added to the
// largest earlier total of its conversation; a line written twice adds nothing.
// OpenCode keeps every message in its own SQLite file (`$XDG_DATA_HOME/opencode/opencode.db`),
// each assistant message with its tokens, model, working folder and time; it is read with
// node:sqlite, read-only.

export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
export const opencodeDbPath = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db');
export const TOOL_LEDGER = join('.baco', 'logs', 'uso-ferramentas.jsonl');

// Claude Code names the project folder after the working directory, every character other than a
// letter or a digit replaced by a hyphen.
export const encodeProjectDir = (path) => path.replace(/[^A-Za-z0-9]/g, '-');

const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const blank = () => ({ responses: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 });
const inWindow = (ts, since, until) => {
  const t = Date.parse(ts ?? '');
  if (Number.isNaN(t)) return since === null && until === null;
  return (since === null || t >= since) && (until === null || t <= until);
};
// A file last written before the window starts holds nothing inside it.
const staleFile = (path, since) => since !== null && statSync(path).mtimeMs < since;

function readLines(path, onBad) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { onBad(); }
  }
  return out;
}

function listJsonl(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsonl(p));
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function agentTypeOf(jsonlPath) {
  const meta = jsonlPath.replace(/\.jsonl$/, '.meta.json');
  if (!existsSync(meta)) return null;
  try {
    const t = JSON.parse(readFileSync(meta, 'utf8')).agentType;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  } catch { return null; }
}

// Collects responses (one per key; a repeated key keeps the largest value of each number) and
// sums them into rows keyed by harness, model and who ('condutor' or the agent type).
const NUMBERS = ['input', 'cacheRead', 'cacheWrite', 'output', 'context'];
//
// Conductor sessions are also tracked one by one (`session`: a private key, never printed): how many
// responses the conversation has in all and how many fall inside the window. When a conversation
// hands off to a new one both overlap for a few minutes, so a session OWNS the window when at least
// half of its responses are inside it (when none does, the one with the most responses inside).
// Tokens of every session in the window are real spend and are all summed; only the largest context
// of the stage (and of the conductor rows) comes from the owning sessions.
const OWNS_WINDOW = 0.5;
function makeLedger() {
  const responses = [];
  const byKey = new Map();
  const sessions = new Map(); // session key -> { harness, who, all: Set, inside: Set }
  return {
    // Every response of a conductor session, inside the window or not (before the window filter).
    seen(session, harness, who, respKey, inside) {
      if (!sessions.has(session)) sessions.set(session, { harness, who, all: new Set(), inside: new Set() });
      const s = sessions.get(session);
      s.all.add(respKey);
      if (inside) s.inside.add(respKey);
    },
    add(entry) {
      const prev = entry.key ? byKey.get(entry.key) : undefined;
      if (prev) { for (const f of NUMBERS) prev[f] = Math.max(prev[f], entry[f]); return; }
      const e = { ...entry };
      if (e.key) byKey.set(e.key, e);
      responses.push(e);
    },
    // The conductor sessions that have responses in the window, in order of their first one there,
    // with the private key of each: [{ key, harness, who, label, responses, totalResponses, share, owner, total, maxContext, firstAt, lastAt }].
    sessionList() {
      const list = [];
      for (const [key, s] of sessions) {
        const mine = responses.filter((e) => e.session === key);
        if (!s.inside.size || !mine.length) continue;
        const times = mine.map((e) => e.at).filter((x) => x !== null).sort((a, b) => a - b);
        list.push({
          key, harness: s.harness, who: s.who, responses: s.inside.size, totalResponses: s.all.size,
          share: Math.round((s.inside.size / s.all.size) * 1000) / 1000,
          total: mine.reduce((a, e) => a + e.input + e.cacheRead + e.cacheWrite + e.output, 0),
          maxContext: mine.reduce((m, e) => Math.max(m, e.context), 0),
          firstAt: times.length ? new Date(times[0]).toISOString() : null,
          lastAt: times.length ? new Date(times.at(-1)).toISOString() : null,
          _first: times.length ? times[0] : Infinity,
        });
      }
      list.sort((a, b) => a._first - b._first);
      const counters = {};
      for (const s of list) {
        s.owner = s.share >= OWNS_WINDOW;
        s.label = `${s.who}-${(counters[s.who] = (counters[s.who] ?? 0) + 1)}`;
        delete s._first;
      }
      const main = list.filter((s) => s.who === 'condutor');
      if (main.length && !main.some((s) => s.owner)) {
        main.reduce((best, s) => (s.responses > best.responses ? s : best)).owner = true;
      }
      return list;
    },
    rows(ownerKeys = new Set()) {
      const rows = new Map();
      for (const { harness, model, who, input, cacheRead, cacheWrite, output, context, session } of responses) {
        const id = JSON.stringify([harness, model, who]);
        if (!rows.has(id)) rows.set(id, { harness, model, who, ...blank(), maxContext: who === 'condutor' ? 0 : null });
        const r = rows.get(id);
        r.responses++;
        r.input += input; r.cacheRead += cacheRead; r.cacheWrite += cacheWrite; r.output += output;
        r.total += input + cacheRead + cacheWrite + output;
        if (r.maxContext !== null && ownerKeys.has(session)) r.maxContext = Math.max(r.maxContext, context);
      }
      return [...rows.values()];
    },
  };
}

// `main`: { session, who } for a conversation's own file ('condutor', or 'avulsa' when Claude Code
// is not the conductor's harness); null for a subagent transcript, whose `who` is its agent type.
function readClaudeFile(path, who, main, ledger, opts, stats) {
  let line = 0;
  for (const o of readLines(path, () => stats.skippedLines++)) {
    line++;
    if (o?.type !== 'assistant') continue;
    const m = o.message;
    const u = m?.usage;
    if (!u || !m.model || m.model === '<synthetic>') continue;
    const inside = inWindow(o.timestamp, opts.since, opts.until);
    // Older versions wrote subagent turns into the conductor's file, marked as a side chain.
    const sidechain = main && o.isSidechain;
    const id = m.id ?? o.requestId ?? o.uuid;
    if (main && !sidechain) ledger.seen(main.session, 'claude-code', who, id ?? `linha-${line}`, inside);
    if (!inside) continue;
    const input = n(u.input_tokens), cacheRead = n(u.cache_read_input_tokens), cacheWrite = n(u.cache_creation_input_tokens);
    const whoHere = sidechain ? (o.attributionAgent || 'subagente') : who;
    const at = Date.parse(o.timestamp ?? '');
    ledger.add({
      key: id ? `claude:${id}` : null,
      harness: 'claude-code', model: m.model, who: whoHere,
      session: main && !sidechain ? main.session : null, at: Number.isNaN(at) ? null : at,
      input, cacheRead, cacheWrite, output: n(u.output_tokens), context: input + cacheRead + cacheWrite,
    });
  }
}

function readClaude(dirs, ledger, opts, stats) {
  for (const dir of dirs) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        const id = e.name.slice(0, -'.jsonl'.length);
        if (opts.sessions && !opts.sessions.includes(id)) continue;
        if (staleFile(p, opts.since)) continue;
        stats.claudeConductor++;
        const who = opts.conductorHarness === 'claude-code' ? 'condutor' : 'avulsa';
        readClaudeFile(p, who, { session: `claude:${id}` }, ledger, opts, stats);
      } else if (e.isDirectory() && existsSync(join(p, 'subagents'))) {
        if (opts.sessions && !opts.sessions.includes(e.name)) continue;
        for (const f of listJsonl(join(p, 'subagents'))) {
          if (staleFile(f, opts.since)) continue;
          stats.claudeSubagents++;
          readClaudeFile(f, agentTypeOf(f) ?? 'subagente', null, ledger, opts, stats);
        }
      }
    }
  }
}

// A Windows path (drive letter or UNC) is compared with either separator and without case, as
// Windows does; a POSIX path as it is. Both on directory boundaries: /repo2 is not inside /repo.
const isWindowsPath = (p) => /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
const comparable = (p) => (isWindowsPath(p) ? p.replace(/\\/g, '/').toLowerCase() : p).replace(/(.)\/+$/, '$1');
export function insideRoot(cwd, root) {
  if (typeof cwd !== 'string' || typeof root !== 'string' || !cwd || !root) return false;
  if (isWindowsPath(cwd) !== isWindowsPath(root)) return false;
  const c = comparable(cwd), r = comparable(root);
  return c === r || c.startsWith(r.endsWith('/') ? r : `${r}/`);
}
const inside = (cwd, roots) => roots.some((r) => insideRoot(cwd, r));

// Who a Codex session is: `codex exec` runs are roles the conductor started; Codex's own
// subagents (source { subagent: ... }) are subagents; any other session is a conductor.
function codexWho(source) {
  if (source === 'exec') return 'exec';
  if (source && typeof source === 'object' && source.subagent) {
    const s = source.subagent;
    return typeof s === 'string' ? s : (typeof s?.other === 'string' ? s.other : 'subagente');
  }
  return 'condutor';
}

function codexUsage(u) {
  const inputAll = n(u?.input_tokens), cacheRead = Math.min(n(u?.cached_input_tokens), inputAll), cacheWrite = n(u?.cache_write_input_tokens);
  // Codex counts cached tokens inside input_tokens; the row keeps them apart, like Claude Code.
  return { input: inputAll - cacheRead, cacheRead, cacheWrite, output: n(u?.output_tokens), context: inputAll + cacheWrite };
}

const isTokenCount = (o) => o?.type === 'event_msg' && o.payload?.type === 'token_count' && Boolean(o.payload.info);
const isNewTurn = (o) => o?.type === 'turn_context' || (o?.type === 'event_msg' && ['user_message', 'task_started'].includes(o.payload?.type));
const sameUsage = (a, b) => {
  const x = codexUsage(a), y = codexUsage(b);
  return NUMBERS.every((f) => x[f] === y[f]);
};

function readCodex(dir, ledger, opts, stats) {
  for (const path of listJsonl(dir)) {
    if (opts.sessions && !opts.sessions.some((id) => basename(path).includes(id))) continue;
    if (staleFile(path, opts.since)) continue;
    const lines = readLines(path, () => stats.skippedLines++);
    const meta = lines.find((o) => o?.type === 'session_meta')?.payload ?? {};
    if (!opts.sessions && !inside(meta.cwd, opts.roots)) continue;
    stats.codexSessions++;
    let who = codexWho(meta.source);
    // A Codex session that is no role of the conductor counts as the conductor only when Codex is
    // the conductor's harness; otherwise it is someone else's work (a file written in a session
    // opened for that), kept apart as 'avulsa'.
    if (who === 'condutor' && opts.conductorHarness !== 'codex') who = 'avulsa';
    const session = `codex:${basename(path)}`;
    const tracked = who === 'condutor' || who === 'avulsa';
    // token_count events count only before the first record, once per move of the running total.
    let firstRecord = lines.findIndex((o) => o?.type === 'token_usage_record');
    if (firstRecord === -1) firstRecord = lines.length;
    const legacy = [];
    let lastTotal = null;
    for (let i = 0; i < firstRecord; i++) {
      if (!isTokenCount(lines[i])) continue;
      const total = lines[i].payload.info.total_token_usage?.total_tokens;
      if (total !== undefined && total === lastTotal) continue; // the same response reported again
      lastTotal = total;
      legacy.push(i);
    }
    // The last of them is the first record's own response only with the same usage and no new turn
    // in between; equal numbers across a turn are two responses.
    const counted = new Set(legacy);
    const last = legacy[legacy.length - 1];
    if (last !== undefined && firstRecord < lines.length
      && sameUsage(lines[last].payload.info.last_token_usage, lines[firstRecord].payload?.usage)
      && !lines.slice(last + 1, firstRecord).some(isNewTurn)) counted.delete(last);
    let model = meta.model ?? 'desconhecido';
    for (const [i, o] of lines.entries()) {
      if (o?.type === 'turn_context' && o.payload?.model) { model = o.payload.model; continue; }
      let u = null, key = null;
      if (o?.type === 'token_usage_record') {
        u = o.payload?.usage;
        key = o.payload?.response_id ? `codex:${o.payload.response_id}` : null;
      } else if (counted.has(i)) {
        u = o.payload.info.last_token_usage;
      }
      if (!u) continue;
      const inside = inWindow(o.timestamp, opts.since, opts.until);
      if (tracked) ledger.seen(session, 'codex', who, key ?? `linha-${i}`, inside);
      if (!inside) continue;
      const at = Date.parse(o.timestamp ?? '');
      ledger.add({ key, harness: 'codex', model, who, session: tracked ? session : null, at: Number.isNaN(at) ? null : at, ...codexUsage(u) });
    }
  }
}

// The ledger of `baco harness-answer`. `who` is the role the conductor named (`--agent`), else 'exec'.
function readToolLedger(file, ledger, opts, stats) {
  const calls = new Map(); // harness + conversation -> [line]
  for (const o of readLines(file, () => stats.skippedLines++)) {
    if (!o || typeof o.harness !== 'string' || typeof o.conversation !== 'string') { stats.skippedLines++; continue; }
    if (opts.sessions && !opts.sessions.includes(o.conversation)) continue;
    const k = JSON.stringify([o.harness, o.conversation]);
    if (!calls.has(k)) calls.set(k, []);
    calls.get(k).push(o);
  }
  const f = (o, k) => n(o[k]);
  for (const list of calls.values()) {
    list.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
    const before = { input: 0, output: 0, thinking: 0, cacheRead: 0 };
    let last = null;
    for (const o of list) {
      const same = last && last.at === o.at && Object.keys(before).every((k) => f(last, k) === f(o, k));
      last = o;
      if (same) continue; // the same call written twice
      stats.toolCalls++;
      const added = {};
      for (const k of Object.keys(before)) { added[k] = Math.max(0, f(o, k) - before[k]); before[k] = Math.max(before[k], f(o, k)); }
      if (!inWindow(o.at, opts.since, opts.until)) continue;
      const at = Date.parse(o.at ?? '');
      ledger.add({
        key: null, harness: o.harness, model: typeof o.model === 'string' && o.model ? o.model : 'desconhecido',
        who: typeof o.agent === 'string' && o.agent ? o.agent : 'exec', session: null, at: Number.isNaN(at) ? null : at,
        input: added.input, cacheRead: added.cacheRead, cacheWrite: 0, output: added.output + added.thinking,
        context: added.input + added.cacheRead,
      });
    }
  }
}

// node:sqlite exists from Node 22.5 and prints an experimental warning when loaded: the warning is
// kept off the command's output. Null when this Node has no node:sqlite.
function sqlite() {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try { return process.getBuiltinModule?.('node:sqlite') ?? null; } catch { return null; } finally { process.emitWarning = emit; }
}

// OpenCode: assistant messages whose working folder is inside the project (or of the chosen
// sessions). A session with a parent is a subagent, named by its agent; any other is 'sessão'.
function readOpenCode(file, ledger, opts, stats) {
  const mod = sqlite();
  if (!mod) { stats.opencodeUnreadable = true; return; }
  let db;
  try { db = new mod.DatabaseSync(file, { readOnly: true }); } catch { stats.opencodeUnreadable = true; return; }
  try {
    const sessions = new Map(db.prepare('SELECT id, parent_id, agent FROM session').all().map((s) => [s.id, s]));
    const seen = new Set();
    for (const m of db.prepare('SELECT id, session_id, time_created, data FROM message').all()) {
      if (opts.sessions && !opts.sessions.includes(m.session_id)) continue;
      let d;
      try { d = JSON.parse(m.data); } catch { stats.skippedLines++; continue; }
      if (d?.role !== 'assistant' || !d.tokens) continue;
      if (!opts.sessions && !inside(d.path?.cwd, opts.roots)) continue;
      const at = Number.isFinite(d.time?.created) ? d.time.created : m.time_created;
      if (!inWindow(new Date(at).toISOString(), opts.since, opts.until)) continue;
      seen.add(m.session_id);
      const s = sessions.get(m.session_id);
      const who = s?.parent_id ? (typeof s.agent === 'string' && s.agent ? s.agent : 'subagente') : 'sessão';
      const t = d.tokens;
      const input = n(t.input), cacheRead = n(t.cache?.read), cacheWrite = n(t.cache?.write);
      ledger.add({
        key: `opencode:${m.id}`, harness: 'opencode', model: typeof d.modelID === 'string' && d.modelID ? d.modelID : 'desconhecido',
        who, session: null, at, input, cacheRead, cacheWrite, output: n(t.output) + n(t.reasoning), context: input + cacheRead + cacheWrite,
      });
    }
    stats.opencodeSessions = seen.size;
  } catch { stats.opencodeUnreadable = true; } finally { db.close(); }
}

export function totals(rows, harnessOverride = null) {
  const sum = (list) => list.reduce((a, r) => {
    for (const k of Object.keys(blank())) a[k] += r[k];
    return a;
  }, blank());
  const by = (field) => {
    const out = {};
    for (const r of rows) {
      const a = (out[r[field]] ??= blank());
      for (const k of Object.keys(blank())) a[k] += r[k];
    }
    return out;
  };
  const cond = rows.filter((r) => r.who === 'condutor');
  const total = sum(rows);
  const conductor = { ...sum(cond), maxContext: cond.reduce((m, r) => Math.max(m, r.maxContext ?? 0), 0) };
  // Output groups: the conductor, the subagents of the conductor's harness, and each other harness
  // (all its rows, roles and loose sessions alike) on its own. Conductor rows are grouped by their own
  // harness: a measurement made before `avulsa` existed may hold conductor rows of two harnesses.
  const conductorHarness = harnessOverride ?? cond[0]?.harness ?? 'claude-code';
  const groups = [];
  const groupOf = (kind, harness, list) => {
    if (!list.length) return;
    const maxContext = list.reduce((m, r) => Math.max(m, r.maxContext ?? 0), 0);
    groups.push({ kind, harness, ...sum(list), ...(kind === 'conductor' ? { maxContext } : {}) });
  };
  for (const h of [conductorHarness, ...new Set(cond.map((r) => r.harness).filter((x) => x !== conductorHarness))]) {
    groupOf('conductor', h, cond.filter((r) => r.harness === h));
  }
  groupOf('subagents', conductorHarness, rows.filter((r) => r.who !== 'condutor' && r.harness === conductorHarness));
  for (const h of [...new Set(rows.filter((r) => r.who !== 'condutor' && r.harness !== conductorHarness).map((r) => r.harness))]) {
    groupOf('harness', h, rows.filter((r) => r.who !== 'condutor' && r.harness === h));
  }
  return {
    total, conductor, subagents: sum(rows.filter((r) => r.who !== 'condutor')),
    conductorShare: total.total ? Math.round((conductor.total / total.total) * 1000) / 1000 : 0,
    byHarness: by('harness'), byModel: by('model'), conductorHarness, groups,
  };
}

// opts: { claudeDirs: [existing dirs], codexDir: existing dir or null, since/until: ms or null,
// sessions: [ids] or null, roots: [project paths a Codex session must run inside],
// conductorHarness: 'claude-code' (default) or 'codex' (the harness whose own sessions are the conductor) }.
export function measureUsage(given) {
  const opts = { ...given, conductorHarness: given.conductorHarness || 'claude-code' };
  const stats = { claudeConductor: 0, claudeSubagents: 0, codexSessions: 0, toolCalls: 0, opencodeSessions: 0, opencodeUnreadable: false, skippedLines: 0 };
  const ledger = makeLedger();
  readClaude(opts.claudeDirs ?? [], ledger, opts, stats);
  if (opts.codexDir) readCodex(opts.codexDir, ledger, opts, stats);
  if (opts.toolLedger && existsSync(opts.toolLedger)) readToolLedger(opts.toolLedger, ledger, opts, stats);
  if (opts.opencodeDb && existsSync(opts.opencodeDb)) readOpenCode(opts.opencodeDb, ledger, opts, stats);
  const order = (r) => [r.harness, r.who === 'condutor' ? 0 : 1, r.who, r.model].join('\u0000');
  const sessionList = ledger.sessionList();
  const owners = new Set(sessionList.filter((s) => s.who === 'condutor' && s.owner).map((s) => s.key));
  const rows = ledger.rows(owners).sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  // The private key of a session never leaves this module; the label is its order in the window.
  const conductorSessions = sessionList.map(({ key, ...s }) => s);
  return {
    rows, ...totals(rows, opts.conductorHarness), conductorSessions, skippedLines: stats.skippedLines,
    sources: {
      claude: { conductorFiles: stats.claudeConductor, subagentFiles: stats.claudeSubagents },
      codex: { sessions: stats.codexSessions },
      tools: { calls: stats.toolCalls },
      opencode: { sessions: stats.opencodeSessions, unreadable: stats.opencodeUnreadable },
    },
  };
}
