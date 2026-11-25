import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, ENT_ID } from '../lib/delivery.mjs';
import { githubProject } from '../lib/config.mjs';
import { fold, headings, readText, tables } from '../lib/markdown.mjs';
import { isAncestor, refExists } from '../lib/git.mjs';

export const usage = 'baco board <ENT-NNN> [--apply] [--applied "<issue-url>=<status>"]... [--all] [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });

const ISSUE_URL = /https:\/\/github\.com\/[^\s/<>()`|\]]+\/[^\s/<>()`|\]]+\/issues\/\d+/;
const TASK_FILE = /^([A-Z]+-\d+)\.md$/;
// Fix tasks of phase 7 (created by import-verdict or the internal review) are not published.
const UNPUBLISHED = /^(FIX|INT)-/;
const clean = (s) => String(s ?? '').replace(/[`*]/g, '').trim().replace(/^_+|_+$/g, '');

// Issue URL of a task file: the row `| Issue | <url> |` of its table (backticks, angle brackets or a
// markdown link around the URL allowed). null when the task was not published to GitHub.
export function taskIssue(md) {
  for (const tb of tables(md)) {
    for (const r of tb.rows) {
      if (fold(clean(r.cells[0])) !== 'issue') continue;
      const m = ISSUE_URL.exec(r.cells.slice(1).join(' '));
      if (m) return m[0];
    }
  }
  return null;
}

// Parent issue URL in progresso.md: the first line naming "Issue mãe" that holds an issue URL.
export function parentIssue(md) {
  for (const line of String(md).split(/\r?\n/)) {
    if (!/issue\s+mae\b/.test(fold(line))) continue;
    const m = ISSUE_URL.exec(line);
    if (m) return m[0];
  }
  return null;
}

// First table under the heading whose folded title starts with `title` that has every column in `cols`.
function sectionTable(md, title, cols) {
  const hs = headings(md);
  const i = hs.findIndex((h) => fold(h.title).trim().startsWith(title));
  if (i < 0) return null;
  const start = hs[i].line;
  const end = hs.slice(i + 1).find((h) => h.level <= hs[i].level)?.line ?? Infinity;
  for (const tb of tables(md)) {
    if (tb.line <= start || tb.line >= end) continue;
    const idx = cols.map((c) => tb.headers.findIndex((h) => fold(h).trim().startsWith(c)));
    if (idx.every((x) => x >= 0)) return { rows: tb.rows.map((r) => r.cells), idx };
  }
  return null;
}

// What progresso.md says about the run: the step of each task in `Tarefas em andamento`, the last
// state of each task in `Registro das tarefas`, and whether phase 6 started (Retomada's `Situação`
// filled, not the template placeholder).
export function readProgress(md) {
  const andamento = new Map();
  const a = sectionTable(md, 'tarefas em andamento', ['tarefa', 'etapa']);
  for (const cells of a?.rows ?? []) {
    const id = clean(cells[a.idx[0]]);
    if (/^[A-Z]+-\d+$/.test(id)) andamento.set(id, fold(clean(cells[a.idx[1]])));
  }
  const registro = new Map();
  const r = sectionTable(md, 'registro das tarefas', ['tarefa', 'estado']);
  for (const cells of r?.rows ?? []) {
    const id = clean(cells[r.idx[0]]);
    if (/^[A-Z]+-\d+$/.test(id)) registro.set(id, clean(cells[r.idx[1]]).toUpperCase());
  }
  let started = false;
  for (const line of String(md).split(/\r?\n/)) {
    const m = /^\s*[-*]\s*\*\*\s*Situa[çc][ãa]o\s*:?\s*\*\*\s*:?\s*(.*)$/i.exec(line);
    if (!m) continue;
    const value = m[1].replace(/`/g, '').trim();
    started = value !== '' && !value.startsWith('<');
    break;
  }
  return { andamento, registro, started };
}

// The state of one task: in `Tarefas em andamento`, review (task review or a human check) or started
// (building, fix round); out of it, merged when its last log row is FEITO or FEITO_COM_RESSALVAS
// (a merged task leaves the table), started for any other logged state, published otherwise.
function taskState(id, andamento, registro) {
  if (andamento.has(id)) return /revis|esperando/.test(andamento.get(id)) ? 'review' : 'started';
  const last = registro.get(id);
  if (last === undefined) return 'published';
  return /^FEITO(_COM_RESSALVAS)?$/.test(last) ? 'merged' : 'started';
}

// Pure mapping from the parsed delivery to the board items, the parent first.
export function boardItems({ parentUrl, tasks, started, merged, andamento, registro, status }) {
  const items = [];
  const anyTask = tasks.some((t) => andamento.has(t.id) || registro.has(t.id));
  if (parentUrl) {
    const state = merged ? 'merged' : started || anyTask ? 'started' : 'published';
    items.push({ kind: 'parent', task: null, url: parentUrl, state, status: status[state] });
  }
  for (const t of tasks) {
    const state = merged ? 'merged' : taskState(t.id, andamento, registro);
    items.push({ kind: 'task', task: t.id, url: t.url, state, status: status[state] });
  }
  return items;
}

// The delivery is merged when its branch, or the tag `entrega/ENT-NNN` that cleanup-branches leaves,
// is contained in the integration branch (local or origin/<integration>) or in the main branch.
function deliveryMerged(root, config, entId) {
  const heads = [`refs/heads/baco/${entId}`, `refs/tags/entrega/${entId}`].filter((r) => refExists(r, root));
  const branchNames = [config.branches?.integration, config.branches?.main].filter((b) => typeof b === 'string' && b);
  const targets = branchNames
    .flatMap((b) => [`refs/heads/${b}`, `refs/remotes/origin/${b}`])
    .filter((r) => refExists(r, root));
  return heads.some((h) => targets.some((t) => isAncestor(h, t, root)));
}

function ghRun(args, root) {
  const r = spawnSync(process.env.BACO_GH || 'gh', args, { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { ok: false, error: r.error.message, stdout: '' };
  if (r.status !== 0) return { ok: false, error: String(r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status ?? r.signal}`, stdout: r.stdout ?? '' };
  return { ok: true, stdout: r.stdout ?? '' };
}

function fieldValueOf(item, fieldName) {
  if (!item || typeof item !== 'object') return null;
  const want = fold(fieldName);
  for (const [k, v] of Object.entries(item)) {
    if (fold(k) !== want) continue;
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof v.name === 'string') return v.name;
  }
  return null;
}

const BOARD_LIST_INITIAL_LIMIT = 100;
const BOARD_LIST_MAX_LIMIT = 10000;

// Queries `gh project item-list` with expanding limits based on `totalCount` (or page fill when
// `totalCount` is absent) so large boards (> 200 items) never drop edited cards from read-back.
function listBoardItems(project, root, wantedUrls) {
  let limit = BOARD_LIST_INITIAL_LIMIT;
  let lastItems = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const listArgs = ['project', 'item-list', String(project.number), '--owner', project.owner, '--limit', String(limit), '--format', 'json'];
    if (fold(project.field) !== 'status') listArgs.push('--field', project.field);
    const listed = ghRun(listArgs, root);
    if (!listed.ok) return { error: `read-back: ${listed.error}` };
    let parsed;
    try { parsed = JSON.parse(listed.stdout); } catch (e) { return { error: `read-back JSON: ${e.message}` }; }
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    lastItems = items;
    const foundUrls = new Set(items.map((item) => item?.content?.url ?? item?.url).filter((u) => typeof u === 'string'));
    if (wantedUrls.every((u) => foundUrls.has(u))) return { items };
    const total = typeof parsed?.totalCount === 'number' ? parsed.totalCount : null;
    if (total !== null) {
      if (total <= items.length || limit >= Math.min(total, BOARD_LIST_MAX_LIMIT)) return { items };
      limit = Math.min(total, BOARD_LIST_MAX_LIMIT);
    } else {
      if (items.length < limit || limit >= BOARD_LIST_MAX_LIMIT) return { items };
      limit = Math.min(limit * 2, BOARD_LIST_MAX_LIMIT);
    }
  }
  return { items: lastItems };
}

// Applies the pending board moves via gh, reads the board back to verify each move, and returns
// { applied: [{ item, url, status }], failed: [{ item, url, status, error }] }.
export function applyBoardChanges(changes, project, root) {
  const edited = [];
  const failed = [];
  for (const it of changes) {
    const editArgs = ['project', 'item-edit', String(project.number), '--owner', project.owner, '--url', it.url, '--field', project.field, '--value', it.status];
    let r = ghRun(editArgs, root);
    if (!r.ok) {
      // If the issue is not yet on the project board, add it once and retry the edit.
      const add = ghRun(['project', 'item-add', String(project.number), '--owner', project.owner, '--url', it.url], root);
      if (add.ok) r = ghRun(editArgs, root);
    }
    if (!r.ok) {
      failed.push({ item: it.task ?? null, url: it.url, status: it.status, error: r.error });
    } else {
      edited.push(it);
    }
  }
  if (!edited.length) return { applied: [], failed };
  const listed = listBoardItems(project, root, edited.map((it) => it.url));
  if (listed.error) {
    for (const it of edited) failed.push({ item: it.task ?? null, url: it.url, status: it.status, error: listed.error });
    return { applied: [], failed };
  }
  const byUrl = new Map();
  for (const item of listed.items) {
    const u = item?.content?.url ?? item?.url;
    if (typeof u === 'string') byUrl.set(u, fieldValueOf(item, project.field));
  }
  const applied = [];
  for (const it of edited) {
    const actual = byUrl.get(it.url);
    if (actual === it.status) applied.push({ item: it.task ?? null, url: it.url, status: it.status });
    else failed.push({ item: it.task ?? null, url: it.url, status: it.status, error: `read-back: expected "${it.status}", got "${actual ?? '-'}"` });
  }
  return { applied, failed };
}

function readRecord(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data.applied === 'object' && data.applied !== null ? data.applied : {};
  } catch {
    return {};
  }
}

export async function run(args, ctx) {
  const entId = args._[0];
  if (!entId || args._.length > 1 || !ENT_ID.test(entId)) return usageError();
  const appliedArgs = [].concat(args.flags.applied ?? []);
  if (appliedArgs.some((a) => typeof a !== 'string' || !a.includes('='))) return usageError();
  const dir = deliveryDir(ctx.root, ctx.config, entId); // not found -> 65 in the dispatcher

  const project = githubProject(ctx.config);
  if (!project) {
    return { code: 0, data: { configured: false, items: [], changes: [] }, messages: [{ key: 'board.not_configured' }] };
  }

  const tasks = [];
  const missing = [];
  const taskDir = join(dir, 'tarefas');
  const names = existsSync(taskDir) ? readdirSync(taskDir).filter((n) => TASK_FILE.test(n) && !UNPUBLISHED.test(n)) : [];
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const name of names) {
    const id = TASK_FILE.exec(name)[1];
    const url = taskIssue(readText(join(taskDir, name)));
    if (url) tasks.push({ id, url });
    else missing.push(id);
  }
  const progressPath = join(dir, 'progresso.md');
  const progressMd = existsSync(progressPath) ? readText(progressPath) : '';
  const parentUrl = parentIssue(progressMd);
  const { andamento, registro, started } = readProgress(progressMd);
  const merged = deliveryMerged(ctx.root, ctx.config, entId);
  const items = boardItems({ parentUrl, tasks, started, merged, andamento, registro, status: project.status });

  // --applied <url>=<status>: the conductor set that column and read it back.
  const recordPath = join(ctx.root, '.baco', 'logs', `quadro-${entId}.json`);
  const recordRel = `.baco/logs/quadro-${entId}.json`;
  const applied = readRecord(recordPath);
  const columns = Object.values(project.status);
  const updates = [];
  for (const a of appliedArgs) {
    const i = a.lastIndexOf('=');
    const url = a.slice(0, i).trim();
    const status = a.slice(i + 1).trim();
    if (!items.some((it) => it.url === url)) return { code: 64, data: {}, messages: [{ key: 'board.applied_unknown_issue', params: { url } }] };
    if (!columns.includes(status)) return { code: 64, data: {}, messages: [{ key: 'board.applied_unknown_status', params: { status, columns: columns.join(', ') } }] };
    updates.push([url, status]);
  }
  if (updates.length) {
    for (const [url, status] of updates) applied[url] = status;
    mkdirSync(join(ctx.root, '.baco', 'logs'), { recursive: true });
    writeFileSync(recordPath, JSON.stringify({ project: { owner: project.owner, number: project.number }, applied }, null, 2) + '\n');
  }

  for (const it of items) {
    it.recorded = applied[it.url] ?? null;
    it.change = args.flags.all === true || it.recorded !== it.status;
  }
  const changes = items.filter((it) => it.change);
  const command = (it) => `gh project item-edit ${project.number} --owner ${project.owner} --url ${it.url} --field "${project.field}" --value "${it.status}"`;

  if (args.flags.apply === true) {
    const { applied: moved, failed } = changes.length ? applyBoardChanges(changes, project, ctx.root) : { applied: [], failed: [] };
    if (moved.length) {
      for (const m of moved) applied[m.url] = m.status;
      mkdirSync(join(ctx.root, '.baco', 'logs'), { recursive: true });
      writeFileSync(recordPath, JSON.stringify({ project: { owner: project.owner, number: project.number }, applied }, null, 2) + '\n');
    }
    const messages = [{ key: 'board.summary', params: { ent: entId, owner: project.owner, number: project.number, total: items.length, changes: changes.length } }];
    if (!parentUrl) messages.push({ key: 'board.parent_missing' });
    if (missing.length) messages.push({ key: 'board.tasks_missing', params: { tasks: missing.join(', ') } });
    if (moved.length) messages.push({ key: 'board.applied_ok', params: { n: moved.length, path: recordRel } });
    for (const f of failed) messages.push({ key: 'board.apply_failed', params: { item: f.item ?? entId, status: f.status, error: f.error } });
    return {
      code: failed.length ? 1 : 0,
      data: {
        configured: true,
        apply: true,
        project: { owner: project.owner, number: project.number, field: project.field },
        items,
        changes: changes.map((it) => ({ ...it, command: command(it) })),
        applied: moved,
        applyFailed: failed,
        missing,
        parentMissing: !parentUrl,
        record: recordRel,
      },
      messages,
    };
  }

  const messages = [{ key: 'board.summary', params: { ent: entId, owner: project.owner, number: project.number, total: items.length, changes: changes.length } }];
  if (!parentUrl) messages.push({ key: 'board.parent_missing' });
  if (missing.length) messages.push({ key: 'board.tasks_missing', params: { tasks: missing.join(', ') } });
  for (const it of changes) messages.push({ key: 'board.change', params: { item: it.task ?? entId, status: it.status, command: command(it) } });
  if (updates.length) messages.push({ key: 'board.recorded', params: { n: updates.length, path: recordRel } });
  if (changes.length) messages.push({ key: 'board.next', params: { ent: entId } });
  return {
    code: 0,
    data: {
      configured: true,
      project: { owner: project.owner, number: project.number, field: project.field },
      items,
      changes: changes.map((it) => ({ ...it, command: command(it) })),
      missing,
      parentMissing: !parentUrl,
      record: recordRel,
    },
    messages,
  };
}
