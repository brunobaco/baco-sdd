import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, ENT_ID } from '../lib/delivery.mjs';
import { githubProject } from '../lib/config.mjs';
import { fold, headings, readText, tables } from '../lib/markdown.mjs';
import { isAncestor, refExists } from '../lib/git.mjs';

export const usage = 'baco board <ENT-NNN> [--applied "<issue-url>=<status>"]... [--all] [--json] [--cwd <dir>]';

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
// is contained in the integration branch (or in the main branch, for a delivery merged straight there).
function deliveryMerged(root, config, entId) {
  const heads = [`refs/heads/baco/${entId}`, `refs/tags/entrega/${entId}`].filter((r) => refExists(r, root));
  const targets = [config.branches?.integration, config.branches?.main]
    .filter((b) => typeof b === 'string' && b)
    .map((b) => `refs/heads/${b}`)
    .filter((r) => refExists(r, root));
  return heads.some((h) => targets.some((t) => isAncestor(h, t, root)));
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
