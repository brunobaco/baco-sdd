import { join, relative } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { deliveryDir, ENT_ID } from '../lib/delivery.mjs';
import { tables, fold } from '../lib/markdown.mjs';
import { git, worktrees } from '../lib/git.mjs';
import { claudeHome, codexSessionsDir, encodeProjectDir, measureUsage, totals } from '../lib/usage.mjs';

export const usage = 'baco cost add <ENT-NNN> --phase <n> --agent <name> --model <m> --effort <e> [--harness <h>] [--turns n] [--tokens n] [--seconds n] [--note s] | baco cost summary <ENT-NNN> | baco cost summary --project | baco cost measure [<ENT-NNN>] [--since <AAAA-MM-DD HH:MM>] [--until <AAAA-MM-DD HH:MM>] [--session <id>]... [--claude-dir <dir>]... [--codex-dir <dir> | --no-codex] [--conductor-harness <claude-code|codex>] [--write [--label <etapa>]] [--json] [--cwd <dir>]';

const DASH = '—';
const HARNESS_NAME = { 'claude-code': 'Claude', codex: 'Codex' };
const HEADERS = ['Data/hora', 'Fase', 'Agente', 'Modelo', 'Esforço', 'Turnos', 'Tokens', 'Segundos', 'Nota', 'Harness'];
const MEASURED_SECTION = '## Medido nas transcrições';
const MEASURED_HEADERS = ['Etapa', 'Janela', 'Harness', 'Modelo', 'Quem', 'Respostas', 'Entrada', 'Cache lido', 'Cache gravado', 'Saída', 'Total', 'Maior contexto'];
const PROJECT_FILE = 'custo-projeto.md';
const NUMERIC = ['responses', 'input', 'cacheRead', 'cacheWrite', 'output', 'total'];

const esc = (v) => String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const pad = (n) => String(n).padStart(2, '0');
export const formatTimestamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const num = (v) => (v === undefined || v === null || v === '' || v === DASH ? DASH : String(v));

const ledgerHead = () => [`| ${HEADERS.join(' | ')} |`, `|${HEADERS.map(() => '---').join('|')}|`];

// Creates the ledger when md is null; otherwise adds one row at the end of the ledger table,
// keeping every other byte untouched (a measured section below the table stays below it).
// A ledger written before the Harness column keeps its 9 cells: the harness goes into the note.
export function appendCost(md, entry) {
  const harness = entry.harness ?? null;
  const fresh = md === null || md === undefined;
  const table = fresh ? null : costTable(md);
  const withColumn = !table || harnessColumn(md) >= 0;
  const note = !withColumn && harness ? [`harness: ${harness}`, entry.note].filter(Boolean).join('; ') : entry.note ?? '';
  const cells = [
    entry.timestamp ?? formatTimestamp(new Date()), entry.phase, entry.agent, entry.model, entry.effort,
    num(entry.turns), num(entry.tokens), num(entry.seconds), note,
    ...(withColumn ? [harness ?? DASH] : []),
  ];
  const row = `| ${cells.map((c, i) => (i >= 5 && i <= 7 ? c : esc(c))).join(' | ')} |`;
  if (fresh) return [`# Custo | ${entry.ent}`, '', ...ledgerHead(), row, ''].join('\n');
  if (!table) return md.replace(/\n*$/, '\n') + ['', ...ledgerHead(), row, ''].join('\n');
  const lines = md.split('\n');
  const last = table.rows.length ? table.rows.at(-1).line : table.line + 1; // 1-based line of the table's end
  if (lines.slice(last).every((l) => !l.trim())) return md.replace(/\n*$/, '\n') + row + '\n';
  lines.splice(last, 0, row);
  return lines.join('\n');
}

// --- Measured usage (`cost measure`): a section of its own, one row per stage, harness, model and
// who (`condutor` or the agent type). Measuring a stage again replaces that stage's rows.

const measuredTable = (md) => tables(md).find((tb) => fold(tb.headers[0] ?? '') === 'etapa' && tb.headers.some((h) => fold(h) === 'total'));

export function writeMeasured(md, { label, window, rows }) {
  const cells = (r) => [label, window, r.harness, r.model, r.who, ...NUMERIC.map((k) => r[k]), r.maxContext ?? DASH];
  const newRows = rows.map((r) => `| ${cells(r).map(esc).join(' | ')} |`);
  const table = measuredTable(md);
  if (!table) {
    return md.replace(/\n*$/, '\n') + ['', MEASURED_SECTION, '', `| ${MEASURED_HEADERS.join(' | ')} |`, `|${MEASURED_HEADERS.map(() => '---').join('|')}|`, ...newRows, ''].join('\n');
  }
  const lines = md.split('\n');
  const last = table.rows.length ? table.rows.at(-1).line : table.line + 1;
  const kept = table.rows.filter((r) => fold(r.cells[0] ?? '') !== fold(label)).map((r) => lines[r.line - 1]);
  return [...lines.slice(0, table.line + 1), ...kept, ...newRows, ...lines.slice(last)].join('\n');
}

// Totals of the measured section, or null when the file has none.
export function summarizeMeasured(md) {
  const table = measuredTable(md);
  if (!table) return null;
  const rows = table.rows.map(({ cells }) => {
    const [label, , harness, model, who] = cells;
    const r = { label, harness, model, who };
    NUMERIC.forEach((k, i) => { r[k] = toInt((cells[5 + i] ?? '').trim()); });
    const ctx = (cells[11] ?? '').trim();
    r.maxContext = /^\d+$/.test(ctx) ? Number(ctx) : null;
    return r;
  });
  const byLabel = {};
  for (const r of rows) (byLabel[r.label] ??= []).push(r);
  return {
    ...totals(rows),
    byLabel: Object.fromEntries(Object.entries(byLabel).map(([k, list]) => {
      const s = totals(list);
      return [k, { ...s.total, conductor: s.conductor.total, maxContext: s.conductor.maxContext }];
    })),
  };
}

const blank = () => ({ turns: 0, tokens: 0, seconds: 0, runs: 0 });
const toInt = (s) => (/^\d+$/.test(s) ? Number(s) : 0);

const costTable = (md) => tables(md).find((tb) => tb.headers.length >= 8 && fold(tb.headers[1]) === 'fase' && fold(tb.headers[3]) === 'modelo');
// Index of the Harness column, or -1 when the ledger predates it.
function harnessColumn(md) {
  const table = costTable(md);
  return table ? table.headers.findIndex((h) => fold(h) === 'harness') : -1;
}
const harnessOf = (cells, col) => {
  const v = col >= 0 ? (cells[col] ?? '').trim() : '';
  return v && v !== DASH ? v : null;
};

// Distinct (agent, model, effort, harness) in first-seen order, with the number of rows (runs) of
// each. `harness` is null when the row does not name one.
export function agentRuns(md) {
  const byKey = new Map();
  const col = harnessColumn(md);
  for (const { cells } of costTable(md)?.rows ?? []) {
    const [, , agent = '', model = '', effort = ''] = cells;
    const harness = harnessOf(cells, col);
    const key = JSON.stringify([agent, model, effort, harness]);
    if (!byKey.has(key)) byKey.set(key, { agent, model, effort, harness, runs: 0 });
    byKey.get(key).runs++;
  }
  return [...byKey.values()];
}

export function summarize(md) {
  const byPhase = {};
  const byModel = {};
  const byHarness = {};
  const total = { ...blank(), tokensUnknownRuns: 0 };
  const table = costTable(md);
  const col = harnessColumn(md);
  for (const { cells } of table?.rows ?? []) {
    const [, phase, , model, , turns, tokens, seconds] = cells;
    const tokenUnknown = !/^\d+$/.test(tokens ?? '');
    const harness = harnessOf(cells, col) ?? DASH;
    for (const acc of [(byPhase[phase] ??= blank()), (byModel[model] ??= blank()), (byHarness[harness] ??= blank()), total]) {
      acc.runs++;
      acc.turns += toInt(turns ?? '');
      acc.tokens += toInt(tokens ?? '');
      acc.seconds += toInt(seconds ?? '');
    }
    if (tokenUnknown) total.tokensUnknownRuns++;
  }
  return { byPhase, byModel, byHarness, total };
}

const bad = (key, params) => ({ code: 64, data: {}, messages: [{ key, params }] });
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const resolveFile = (ctx, ent) => join(deliveryDir(ctx.root, ctx.config, ent), 'custo.md');

const row = (name, a) => ({ key: 'cost.row', params: { name, runs: a.runs, turns: a.turns, tokens: a.tokens, seconds: a.seconds } });

// True when the date and the time exist (no 2026-02-30, 24:00 or 12:60).
const validParts = (y, mo, d, h = 0, mi = 0, s = 0) =>
  mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() && h <= 23 && mi <= 59 && s <= 59;

// `AAAA-MM-DD`, `AAAA-MM-DD HH:MM[:SS]` (local time, as `date` prints it) or ISO with a zone.
export function parseTime(s) {
  if (typeof s !== 'string') return null;
  const v = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(v);
  if (m) {
    const p = m.slice(1, 7).map((x) => +(x ?? 0));
    if (!validParts(...p)) return null;
    const t = new Date(p[0], p[1] - 1, p[2], p[3], p[4], p[5]).getTime();
    return Number.isNaN(t) ? null : t;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):?(\d{2}))$/.exec(v);
  if (!m || !validParts(...m.slice(1, 7).map((x) => +(x ?? 0)))) return null;
  if (m[7] !== undefined && (+m[7] > 23 || +m[8] > 59)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// Where a delivery's window starts: the plan's `**Início:**` line, else the first commit that
// touched the delivery folder (which misses the planning talk before it).
function deliveryStart(ctx, dir) {
  const plan = join(dir, 'plano.md');
  if (existsSync(plan)) {
    const m = /^\*\*In[ií]cio:\*\*\s*`?([0-9][0-9T: -]+[0-9])`?\s*$/im.exec(readFileSync(plan, 'utf8'));
    const t = m ? parseTime(m[1]) : null;
    if (t !== null) return t;
  }
  const first = git(['log', '--reverse', '--format=%cI', '--', relative(ctx.root, dir)], ctx.root).split('\n')[0];
  return first ? Date.parse(first) : null;
}

const list = (v) => (v === undefined ? [] : [].concat(v)).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());

// The folders whose conversations belong to the project: the repo, its worktrees now, and every
// worktree seen by an earlier measurement, kept in a git-ignored file of this machine, so a
// measurement after the branch cleanup still finds the tasks' conversations. The file holds only
// folder paths; it is written only when git ignores it.
const SOURCES_FILE = join('.baco', 'logs', 'custo-fontes.json');
function knownRoots(root, warnings) {
  const file = join(root, SOURCES_FILE);
  let recorded = [];
  try { recorded = JSON.parse(readFileSync(file, 'utf8')).roots ?? []; } catch { /* none yet, or unreadable */ }
  const roots = [root, ...worktrees(root).map((w) => w.path), ...recorded.filter((p) => typeof p === 'string' && p)]
    .filter((p, i, a) => a.indexOf(p) === i);
  // `git check-ignore -q`: 0 = ignored, 1 = not ignored, anything else = cannot tell.
  const ignored = spawnSync('git', ['check-ignore', '-q', SOURCES_FILE], { cwd: root, stdio: 'ignore' }).status;
  if (ignored === 0) {
    if (roots.length !== recorded.length || roots.some((p, i) => p !== recorded[i])) {
      try {
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, `${JSON.stringify({ roots }, null, 2)}\n`);
      } catch { /* the record only helps a later measurement */ }
    }
  } else if (ignored === 1) warnings.push({ key: 'cost.measure_sources_not_ignored', params: { path: '.baco/logs/' } });
  return roots;
}

// Claude Code folders of those roots, plus any folder of a task worktree under `.worktrees/`
// (`.worktrees/<TASK-ID>`), found by its encoded name even when the worktree is gone.
function claudeProjectDirs(root, roots) {
  const projects = join(claudeHome(), 'projects');
  const dirs = roots.map((r) => join(projects, encodeProjectDir(r)));
  const prefix = `${encodeProjectDir(join(root, '.worktrees'))}-`;
  if (existsSync(projects)) {
    for (const e of readdirSync(projects, { withFileTypes: true })) if (e.isDirectory() && e.name.startsWith(prefix)) dirs.push(join(projects, e.name));
  }
  return dirs.filter((d, i, a) => a.indexOf(d) === i && existsSync(d));
}

async function measure(args, ctx) {
  const f = args.flags;
  // A boolean flag written before the delivery id swallows it (`--write ENT-001`): give it back.
  const pos = [...args._.slice(1)];
  for (const k of ['write', 'no-codex']) if (typeof f[k] === 'string') { pos.push(f[k]); f[k] = true; }
  const ent = pos[0];
  if (pos.length > 1 || (ent !== undefined && !ENT_ID.test(ent))) return bad('cli.usage', { usage });
  const dir = ent ? deliveryDir(ctx.root, ctx.config, ent) : null;
  const time = {};
  for (const k of ['since', 'until']) {
    if (f[k] === undefined) { time[k] = null; continue; }
    time[k] = parseTime(f[k]);
    if (time[k] === null) return bad('cost.bad_time', { flag: k, value: String(f[k]) });
  }
  const sessions = list(f.session);
  if (time.since === null && dir && !sessions.length) time.since = deliveryStart(ctx, dir);
  if (time.since === null && !sessions.length) return bad('cost.measure_need_window', {});
  const write = f.write === true;
  const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim() : (dir ? 'entrega' : null);
  if (write && !label) return bad('cost.measure_need_label', {});

  const warnings = [];
  const roots = knownRoots(ctx.root, warnings);
  const given = list(f['claude-dir']);
  for (const d of given) if (!existsSync(d)) return { code: 65, data: {}, messages: [{ key: 'cost.measure_dir_missing', params: { path: d } }] };
  const claudeDirs = given.length ? given : claudeProjectDirs(ctx.root, roots);
  let codexDir = null;
  if (f['no-codex'] !== true) {
    if (typeof f['codex-dir'] === 'string') {
      if (!existsSync(f['codex-dir'])) return { code: 65, data: {}, messages: [{ key: 'cost.measure_dir_missing', params: { path: f['codex-dir'] } }] };
      codexDir = f['codex-dir'];
    } else if (existsSync(codexSessionsDir())) codexDir = codexSessionsDir();
  }

  // A window with a start ends now unless --until says otherwise; chosen sessions alone have no window.
  const until = time.until ?? (time.since === null ? null : (ctx.now ? ctx.now() : new Date()).getTime());
  const conductorHarness = typeof f['conductor-harness'] === 'string' && f['conductor-harness'].trim() ? f['conductor-harness'].trim() : 'claude-code';
  const result = measureUsage({ claudeDirs, codexDir, since: time.since, until, sessions: sessions.length ? sessions : null, roots, conductorHarness });
  const iso = (t) => (t === null ? null : new Date(t).toISOString());
  const data = { ent: ent ?? null, since: iso(time.since), until: iso(until), sessions, ...result };
  // Session ids stay out of the written file: the window names only how many were chosen.
  const window = sessions.length && time.since === null ? `${sessions.length} sessão(ões) escolhida(s)` : `${formatTimestamp(new Date(time.since))} a ${formatTimestamp(new Date(until))}`;
  const messages = [...warnings, { key: 'cost.measure_title', params: { window } },
    { key: 'cost.measure_sources', params: { conductor: result.sources.claude.conductorFiles, subagents: result.sources.claude.subagentFiles, codex: result.sources.codex.sessions } }];
  if (result.skippedLines) messages.push({ key: 'cost.measure_bad_lines', params: { n: result.skippedLines } });
  if (!result.rows.length) {
    const dirs = [...claudeDirs, ...(codexDir ? [codexDir] : [])].join(', ') || '—';
    return { code: 1, data, messages: [...messages, { key: 'cost.measure_none', params: { dirs } }] };
  }
  messages.push({ key: 'cost.measure_head' });
  for (const r of result.rows) messages.push({ key: 'cost.measure_row', params: { ...r, maxContext: r.maxContext ?? DASH } });
  messages.push({ key: 'cost.measure_groups_head' });
  for (const g of result.groups) {
    messages.push({ key: `cost.group_${g.kind}`, params: { harness: HARNESS_NAME[g.harness] ?? g.harness, responses: g.responses, total: g.total, maxContext: g.maxContext ?? DASH } });
  }
  if (result.conductorSessions.length) {
    messages.push({ key: 'cost.measure_sessions_head' });
    for (const s of result.conductorSessions) {
      messages.push({ key: s.owner ? 'cost.measure_session_row_owner' : 'cost.measure_session_row', params: { ...s, maxContext: s.maxContext || DASH } });
    }
  }
  messages.push({ key: 'cost.measure_total', params: totalsParams(result) });
  if (write) {
    const file = dir ? join(dir, 'custo.md') : join(ctx.root, ctx.config?.docs_root ?? 'docs', PROJECT_FILE);
    let md;
    if (existsSync(file)) md = readFileSync(file, 'utf8');
    else if (dir) md = [`# Custo | ${ent}`, '', ...ledgerHead(), ''].join('\n');
    else { mkdirSync(join(file, '..'), { recursive: true }); md = '# Custo do projeto\n'; }
    writeFileSync(file, writeMeasured(md, { label, window, rows: result.rows }));
    data.written = file;
    data.label = label;
    messages.push({ key: 'cost.measure_written', params: { file, label } });
  }
  return { code: 0, data, messages };
}

// The share as a percentage with one decimal, written with a decimal comma (the message is pt-BR
// by default; an English reader still reads "24,1%" right).
const pct = (share) => (Math.round(share * 1000) / 10).toString().replace('.', ',');
// `subagents` is the Claude (conductor's harness) subagents only; every other harness follows in
// `others` (" Codex: N tokens."). The JSON keeps `subagents.total` as the sum of both.
const totalsParams = (s) => {
  const name = (h) => HARNESS_NAME[h] ?? h;
  const mine = s.groups?.find((g) => g.kind === 'subagents');
  const others = (s.groups ?? []).filter((g) => g.kind === 'harness').map((g) => ` ${name(g.harness)}: ${g.total} tokens.`).join('');
  return {
    total: s.total.total, responses: s.total.responses, conductor: s.conductor.total, share: pct(s.conductorShare), maxContext: s.conductor.maxContext,
    subagents: mine ? mine.total : 0, harness: name(s.conductorHarness ?? 'claude-code'), others,
  };
};

export async function run(args, ctx) {
  const [sub, ent] = args._;
  if (sub === 'measure') return measure(args, ctx);
  if (sub === 'summary' && args.flags.project === true && ent === undefined) {
    const s = summarizeMeasured(readFileSync(join(ctx.root, ctx.config?.docs_root ?? 'docs', PROJECT_FILE), 'utf8')); // ENOENT -> 65
    const messages = [{ key: 'cost.project_title' }];
    for (const [k, a] of Object.entries(s?.byLabel ?? {})) messages.push({ key: 'cost.project_row', params: { label: k, ...a } });
    if (s) messages.push({ key: 'cost.measure_total', params: totalsParams(s) });
    return { code: 0, data: { measured: s }, messages };
  }
  if (!['add', 'summary'].includes(sub) || !ent || !ENT_ID.test(ent)) return bad('cli.usage', { usage });
  const f = args.flags;
  if (sub === 'add') {
    const v = Object.fromEntries(['phase', 'agent', 'model', 'effort'].map((k) => [k, str(f[k])]));
    if (!v.phase || !v.agent || !v.model || !v.effort) return bad('cli.usage', { usage });
    const harness = f.harness === undefined ? null : str(f.harness);
    if (f.harness !== undefined && !harness) return bad('cli.usage', { usage });
    const n = {};
    for (const k of ['turns', 'tokens', 'seconds']) {
      const raw = f[k];
      if (raw === undefined || raw === DASH) { n[k] = DASH; continue; }
      if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return bad('cost.bad_number', { flag: k, value: String(raw) });
      n[k] = raw.trim();
    }
    const path = resolveFile(ctx, ent);
    const md = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const note = typeof f.note === 'string' ? f.note : '';
    const now = ctx.now ? ctx.now() : new Date();
    writeFileSync(path, appendCost(md, { ent, timestamp: formatTimestamp(now), ...v, ...n, note, harness }));
    const created = md === null;
    return {
      code: 0, data: { ent, ...v, harness, ...n, ...(created ? { created: path } : {}) },
      messages: [...(created ? [{ key: 'cost.created', params: { file: path } }] : []), { key: 'cost.added', params: { ent, phase: v.phase, model: v.model } }],
    };
  }
  const path = resolveFile(ctx, ent);
  const md = readFileSync(path, 'utf8'); // ENOENT -> 65 in the dispatcher
  const s = { ...summarize(md), measured: summarizeMeasured(md) };
  const messages = [{ key: 'cost.summary_title', params: { ent } }, { key: 'cost.by_phase_head' }];
  for (const [k, a] of Object.entries(s.byPhase)) messages.push(row(k, a));
  messages.push({ key: 'cost.by_model_head' });
  for (const [k, a] of Object.entries(s.byModel)) messages.push(row(k, a));
  if (Object.keys(s.byHarness).some((k) => k !== DASH)) {
    messages.push({ key: 'cost.by_harness_head' });
    for (const [k, a] of Object.entries(s.byHarness)) messages.push(row(k, a));
  }
  messages.push({ key: 'cost.total', params: { runs: s.total.runs, turns: s.total.turns, tokens: s.total.tokens, seconds: s.total.seconds } });
  if (s.total.tokensUnknownRuns) messages.push({ key: 'cost.unknown_tokens', params: { n: s.total.tokensUnknownRuns } });
  if (s.measured) messages.push({ key: 'cost.measured_summary', params: totalsParams(s.measured) });
  else messages.push({ key: 'cost.not_measured', params: { ent } });
  return { code: 0, data: s, messages };
}
