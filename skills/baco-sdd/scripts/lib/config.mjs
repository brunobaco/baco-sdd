// Config loader: minimal YAML subset parser + defaults + deep merge.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { globToRegExp } from './glob.mjs';

export class ConfigError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'ConfigError';
    this.line = line;
  }
}

export const DEFAULTS = {
  language: 'pt-BR',
  docs_root: 'docs',
  tracker: ['files'],
  branches: { main: 'main', integration: 'develop', protected: ['main', 'master', 'develop'] },
  parallel: 3,
  gates: {
    project_start: true, architecture: true, plan: true, task_batch: true, each_task: false, before_pr: true,
    spec_approval: true, irreversible_action: true, merge_main: true,
  },
  manual_pending: { main: 'block', '*': 'warn' },
  tests: {
    junit_dir: '.baco/junit',
    // Code extensions only, so `a.test.js.disabled` or `x.spec.ts.bak` is not a test path (R24).
    patterns: [
      '**/*.test.{js,jsx,ts,tsx,mjs,cjs}', '**/*.spec.{js,jsx,ts,tsx,mjs,cjs}',
      '**/e2e/**/*.{js,jsx,ts,tsx,mjs,cjs}', '.maestro/**/*.{yaml,yml}',
    ],
  },
  models: {
    mechanical: { level: 'leve', effort: 'baixo' },
    standard: { level: 'medio', effort: 'medio' },
    risky: { level: 'forte', effort: 'medio' },
  },
  // pr.reviewer: who reviews the delivery's pull request (agente, pessoa or ambos: agent first, then
  // the person); pr.auto_fix: whether the findings become fix tasks that run on their own;
  // task_rounds: the project's default maximum of reviews of a task, counting the first, per risk
  // class (the plan of a delivery may change it); last_round_importante: a task whose last review has only
  // `importante` open is merged with the findings as pending items (seguir) or waits for the person (parar).
  // focus: the project's review focus, `always` (classes every review looks at) and `suggestion`
  // (classes whose finding is a `sugestão` unless it touches an `always` item); final_rounds_max: the
  // internal final review runs whole once, then at most (N-1) delta rounds.
  review: {
    external_rounds_max: 3, task_rounds: { mechanical: 2, standard: 3, risky: 4 },
    last_round_importante: 'seguir', pr: { reviewer: 'agente', auto_fix: true },
    focus: { always: [], suggestion: [] }, final_rounds_max: 2,
  },
  // AI tools (harnesses) available to the project, by name: `models` maps the BACO levels (forte,
  // medio, leve) to that tool's model names; `implementers` allows it to run implementers when it is
  // not the conductor's own tool (default false: only read-only roles run there); `sandbox` says how
  // free it is when it implements: protegida (writes only in the task folder, no network), rede (the
  // same folder limit, with network and local ports) or livre (no sandbox, only the command rules).
  // Default rede.
  harnesses: {},
  // How the plan splits the tasks: funcionalidade (each task delivers a whole behavior, server and
  // screen together) or front-back (each behavior becomes a back-end task and a front-end task, with
  // the API contract first, so the two run in parallel). risk: the project's own criterion, free text,
  // for the classes `arriscada` and `mecanica` (`padrao` is everything else; a missing class uses the
  // generic criterion). max_tasks / max_criteria: above them the planner proposes splitting the
  // delivery. freeze_specs: after the plan is approved, a spec change goes to the next delivery unless
  // the person decides to bring it in.
  planning: { task_split: 'funcionalidade', risk: {}, max_tasks: 8, max_criteria: 60, freeze_specs: true },
  // Who does each role, in order of preference: `<harness>` or `<harness>/<model>`. The next entry
  // takes over when the previous one is out of quota. The plan shows the lists and the person may
  // change them for one delivery when approving it. Empty: the plan decides as before.
  roles: {},
  // Paths (git pathspec globs) that, like <docs_root>/entregas/**, never make a recorded head stale (R26).
  provenance: { ignore: [] },
  // Conversation size (input + cache tokens of the last answer) from which the conductor suggests,
  // or with auto_handoff makes during construction, the switch to a new conversation.
  context: { handoff_at: 290000, auto_handoff: false },
  // github.project: the GitHub Project board that mirrors the delivery's tasks (owner, number,
  // field, status). Unset by default; used only with `github` in `tracker`. See githubProject().
  github: {},
  // screen_task_full: a task that changes a screen runs its own tests in every browser project once,
  // before its merge. ci_full: merge (the full battery runs in CI on the integration merge) or manual
  // (CI runs the quick battery; the full one only by hand).
  test_runs: { screen_task_full: false, ci_full: 'merge' },
  // monthly_minutes: the CI plan's monthly minutes, for the plan's CI estimate (null: unknown).
  ci: { monthly_minutes: null },
  // target: where the delivery ends (integration or main). integration_merge: ask, or auto (before_pr
  // and the merge into the integration branch go on alone when `baco merge-check` says clean).
  delivery: { target: 'integration', integration_merge: 'ask' },
  // specialist: kinds of manual scenario only a specialist QA runs (never asked, never a blocker).
  qa: { specialist: [] },
  // uses_ai: the system being built calls an AI model; turns on the prompt-injection requirements of
  // the architecture, the specs, the plan and the reviews.
  product: { uses_ai: false },
};

// Status options of the board, by event: published (phase 5), started (building), review (task
// review or human check) and merged (task merged into the delivery branch; the parent issue, the
// delivery merged into the integration branch).
export const BOARD_STATUS_DEFAULTS = { published: 'Backlog', started: 'In progress', review: 'In review', merged: 'Done' };

export const MANDATORY_GATES = ['spec_approval', 'irreversible_action', 'merge_main'];

// Removes a trailing `# comment` that is outside quotes.
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

// Splits on `sep` outside quotes and brackets.
function splitTop(s, sep, ln) {
  const parts = [];
  let depth = 0, q = null, cur = '';
  for (const c of s) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q || depth !== 0) throw new ConfigError('Unbalanced quote or bracket', ln);
  parts.push(cur);
  return parts;
}

function findKeyColon(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === ':' && (i === s.length - 1 || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
}

function parseScalar(raw, ln) {
  const s = raw.trim();
  if (s === '') return null;
  if (s[0] === '"' || s[0] === "'") {
    if (s.length < 2 || s[s.length - 1] !== s[0]) throw new ConfigError('Unterminated quoted string', ln);
    return s.slice(1, -1);
  }
  if (s[0] === '[') {
    if (s[s.length - 1] !== ']') throw new ConfigError('Unterminated inline list', ln);
    const inner = s.slice(1, -1).trim();
    return inner === '' ? [] : splitTop(inner, ',', ln).map((p) => parseScalar(p, ln));
  }
  if (s[0] === '{') {
    if (s[s.length - 1] !== '}') throw new ConfigError('Unterminated inline map', ln);
    const inner = s.slice(1, -1).trim();
    const out = {};
    if (inner === '') return out;
    for (const p of splitTop(inner, ',', ln)) {
      const i = findKeyColon(p.trim());
      if (i < 0) throw new ConfigError('Invalid inline map entry', ln);
      const t = p.trim();
      out[parseKey(t.slice(0, i), ln)] = parseScalar(t.slice(i + 1), ln);
    }
    return out;
  }
  if (s === 'on' || s === 'true') return true;
  if (s === 'off' || s === 'false') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  return s;
}

function parseKey(raw, ln) {
  const k = raw.trim();
  if (k === '') throw new ConfigError('Empty key', ln);
  if ((k[0] === '"' || k[0] === "'") && k[k.length - 1] === k[0] && k.length >= 2) return k.slice(1, -1);
  return k;
}

export function parseYamlSubset(text) {
  const lines = [];
  String(text).split(/\r?\n/).forEach((raw, idx) => {
    const ln = idx + 1;
    const indentMatch = /^[ \t]*/.exec(raw)[0];
    const body = stripComment(raw.slice(indentMatch.length)).trimEnd();
    if (body.trim() === '') return;
    if (indentMatch.includes('\t')) throw new ConfigError('Tab indentation is not allowed', ln);
    lines.push({ indent: indentMatch.length, text: body, ln });
  });

  let pos = 0;

  function parseBlock(indent) {
    if (lines[pos].text.startsWith('- ') || lines[pos].text === '-') return parseList(indent);
    return parseMap(indent);
  }

  function parseList(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent) {
      const { text, ln } = lines[pos];
      if (!(text.startsWith('- ') || text === '-')) throw new ConfigError('Expected a list item', ln);
      out.push(parseScalar(text.slice(1), ln));
      pos++;
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const { text, ln } = lines[pos];
      if (text.startsWith('- ')) throw new ConfigError('Unexpected list item', ln);
      const i = findKeyColon(text);
      if (i < 0) throw new ConfigError('Expected "key: value"', ln);
      const key = parseKey(text.slice(0, i), ln);
      const rest = text.slice(i + 1).trim();
      pos++;
      if (rest !== '') { out[key] = parseScalar(rest, ln); continue; }
      const next = lines[pos];
      if (next && next.indent > indent) out[key] = parseBlock(next.indent);
      else out[key] = null;
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new ConfigError('Unexpected indentation', lines[pos].ln);
    return out;
  }

  if (lines.length === 0) return {};
  if (lines[0].indent !== 0) throw new ConfigError('Unexpected indentation', lines[0].ln);
  const result = parseBlock(0);
  if (pos < lines.length) throw new ConfigError('Unexpected indentation', lines[pos].ln);
  return result;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

// Sections that must be maps; any other non-null value is ignored (defaults kept) with a warning.
const MAP_SECTIONS = ['gates', 'branches', 'tests', 'models', 'review', 'manual_pending', 'tests_quick', 'app', 'provenance', 'context', 'harnesses', 'github', 'planning', 'roles', 'test_runs', 'ci', 'delivery', 'qa', 'product'];
// List settings where a single scalar is accepted as a one-element list.
const LIST_SETTINGS = [['branches', 'protected'], ['tests', 'patterns'], ['tests', 'queue']];

// Model levels never name a model: forte = the most capable one of the environment, medio = the
// intermediate one, leve = the fastest and cheapest. The old form (`model: opus|sonnet|haiku`,
// `effort: high|medium|low`) keeps loading and is mapped to these words.
export const MODEL_CLASSES = ['mechanical', 'standard', 'risky'];
const LEVELS = { forte: 'forte', medio: 'medio', leve: 'leve', opus: 'forte', sonnet: 'medio', haiku: 'leve' };
const EFFORTS = { alto: 'alto', medio: 'medio', baixo: 'baixo', high: 'alto', xhigh: 'alto', max: 'alto', medium: 'medio', low: 'baixo' };
const fold = (v) => (typeof v === 'string' ? v.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : null);

// Rewrites `models.<class>` entries of a user config to `{ level, effort }`. A class that is not a
// map, or a value that is not recognized, is dropped (the default stays) with `config.invalid_section`.
function normalizeModels(models, warnings) {
  const out = { ...models };
  for (const cls of MODEL_CLASSES) {
    const entry = models[cls];
    if (entry === undefined || entry === null) continue;
    if (!isPlainObject(entry)) {
      delete out[cls];
      warnings.push({ key: 'config.invalid_section', params: { section: `models.${cls}` } });
      continue;
    }
    const norm = {};
    for (const [field, table, aliases] of [['level', LEVELS, ['level', 'model']], ['effort', EFFORTS, ['effort']]]) {
      const name = aliases.find((a) => entry[a] !== undefined && entry[a] !== null);
      if (name === undefined) continue;
      const value = table[fold(entry[name])];
      if (value === undefined) warnings.push({ key: 'config.invalid_section', params: { section: `models.${cls}.${name}` } });
      else norm[field] = value;
    }
    out[cls] = norm;
  }
  return out;
}

const HARNESS_LEVELS = ['forte', 'medio', 'leve'];
const HARNESS_SANDBOXES = ['protegida', 'rede', 'livre'];
const PR_REVIEWERS = ['agente', 'pessoa', 'ambos'];
const LAST_ROUND_IMPORTANTE = ['seguir', 'parar'];
const TASK_SPLITS = ['funcionalidade', 'front-back'];
export const ROLE_NAMES = ['implementer', 'backend', 'frontend', 'task_reviewer', 'task_reviewer_last', 'final_reviewer', 'pr_reviewer'];

// `harnesses.<name>`: a map with `models` (level -> non-empty model name), `implementers`
// (boolean, default false) and `sandbox` (protegida, rede or livre, default rede). An entry that is
// not a map, a level that is not forte/medio/leve, an empty model name or a bad `implementers` is
// dropped with `config.invalid_section`; a bad `sandbox` falls back to protegida, the strictest,
// with `config.sandbox_invalid`.
function normalizeHarnesses(harnesses, warnings) {
  const warn = (section) => warnings.push({ key: 'config.invalid_section', params: { section: `harnesses.${section}` } });
  const out = {};
  for (const [name, entry] of Object.entries(harnesses)) {
    if (!isPlainObject(entry)) { warn(name); continue; }
    const models = {};
    if (entry.models !== undefined && entry.models !== null) {
      if (!isPlainObject(entry.models)) warn(`${name}.models`);
      else {
        for (const [level, model] of Object.entries(entry.models)) {
          const value = typeof model === 'string' || typeof model === 'number' ? String(model).trim() : '';
          if (!HARNESS_LEVELS.includes(level) || !value) warn(`${name}.models.${level}`);
          else models[level] = value;
        }
      }
    }
    let implementers = false;
    if (entry.implementers !== undefined && entry.implementers !== null) {
      if (typeof entry.implementers === 'boolean') implementers = entry.implementers;
      else warn(`${name}.implementers`);
    }
    let sandbox = 'rede';
    if (entry.sandbox !== undefined && entry.sandbox !== null) {
      if (HARNESS_SANDBOXES.includes(entry.sandbox)) sandbox = entry.sandbox;
      else {
        sandbox = 'protegida';
        warnings.push({ key: 'config.sandbox_invalid', params: { harness: name, value: String(entry.sandbox) } });
      }
    }
    const next = { ...entry, models, implementers, sandbox };
    if (entry.tool !== undefined && entry.tool !== null) {
      const tool = typeof entry.tool === 'string' ? entry.tool.trim() : '';
      if (tool) next.tool = tool;
      else { delete next.tool; warn(`${name}.tool`); }
    }
    out[name] = next;
  }
  return out;
}

// The tool a harness entry calls: its `tool` when set (a profile, such as `antigravity-claude` with
// `tool: antigravity`), otherwise its own name.
export function harnessTool(config, name) {
  const tool = config.harnesses?.[name]?.tool;
  return typeof tool === 'string' && tool ? tool : name;
}

const invalidSection = (section) => ({ key: 'config.invalid_section', params: { section } });
const positiveInt = (v) => Number.isInteger(v) && v >= 1;
const isBool = (v) => typeof v === 'boolean';
const oneOf = (list) => (v) => list.includes(v);

// Drops each key of the map `section` (named `name`) whose value fails its check, so the default
// stays, with config.invalid_section naming `<name>.<key>`. Absent and empty (null) keys are left alone.
function checkKeys(name, section, checks, warnings) {
  const out = { ...section };
  for (const [key, ok] of Object.entries(checks)) {
    if (out[key] === undefined || out[key] === null || ok(out[key])) continue;
    delete out[key];
    warnings.push(invalidSection(`${name}.${key}`));
  }
  return out;
}

// A list of non-empty texts (one text is a one-element list). Items that are not text, or are empty,
// are dropped with one config.invalid_section naming `section`; a value that is neither a list nor a
// text gives undefined (the default stays) with the same warning.
function textList(value, section, warnings) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
  if (items === null) { warnings.push(invalidSection(section)); return undefined; }
  const out = [];
  let bad = false;
  for (const item of items) {
    const text = typeof item === 'string' ? item.trim() : '';
    if (!text) bad = true;
    else if (!out.includes(text)) out.push(text);
  }
  if (bad) warnings.push(invalidSection(section));
  return out;
}

// `planning.task_split`: funcionalidade or front-back; anything else falls back to funcionalidade.
// `planning.risk`: a map with the classes `arriscada` and `mecanica` (`mecânica` and any case are
// folded), each a non-empty text; another class, an empty or non-text value, or a risk that is not a
// map is dropped with config.invalid_section. `max_tasks` and `max_criteria`: integers >= 1;
// `freeze_specs`: a boolean.
const RISK_CLASSES = ['arriscada', 'mecanica'];
function normalizePlanning(planning, warnings) {
  const out = checkKeys('planning', planning, { max_tasks: positiveInt, max_criteria: positiveInt, freeze_specs: isBool }, warnings);
  const split = planning.task_split;
  if (split !== undefined && split !== null && !TASK_SPLITS.includes(split)) {
    warnings.push({ key: 'config.task_split_invalid', params: { value: String(split) } });
    out.task_split = 'funcionalidade';
  }
  const risk = planning.risk;
  if (risk !== undefined && risk !== null) {
    if (!isPlainObject(risk)) { delete out.risk; warnings.push(invalidSection('planning.risk')); }
    else {
      out.risk = {};
      for (const [cls, text] of Object.entries(risk)) {
        const key = fold(cls);
        const value = typeof text === 'string' ? text.trim() : '';
        if (!RISK_CLASSES.includes(key) || !value) warnings.push(invalidSection(`planning.risk.${cls}`));
        else out.risk[key] = value;
      }
    }
  }
  return out;
}

// `roles.<role>`: a list (or one text) of `<harness>` or `<harness>/<model>`, in order of
// preference. A role outside ROLE_NAMES, a list that is something else, an entry that is not text or
// has an empty part, and an entry naming a harness absent from `harnesses` are dropped with a warning.
function normalizeRoles(roles, harnesses, warnings) {
  const out = {};
  for (const [role, value] of Object.entries(roles)) {
    if (!ROLE_NAMES.includes(role)) {
      warnings.push({ key: 'config.role_unknown', params: { role, known: ROLE_NAMES.join(', ') } });
      continue;
    }
    if (value === undefined || value === null) continue;
    const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : null);
    if (list === null) { warnings.push({ key: 'config.invalid_section', params: { section: `roles.${role}` } }); continue; }
    const kept = [];
    for (const item of list) {
      const text = typeof item === 'string' ? item.trim() : '';
      const slash = text.indexOf('/');
      const harness = slash === -1 ? text : text.slice(0, slash).trim();
      const model = slash === -1 ? null : text.slice(slash + 1).trim();
      if (!harness || model === '') { warnings.push({ key: 'config.invalid_section', params: { section: `roles.${role}` } }); continue; }
      if (!Object.hasOwn(harnesses, harness)) {
        warnings.push({ key: 'config.role_harness_unknown', params: { role, harness } });
        continue;
      }
      kept.push(model === null ? harness : `${harness}/${model}`);
    }
    if (kept.length) out[role] = kept;
  }
  return out;
}

// The resolved list of a role: [{ harness, tool, model }], model null when the entry names none (the
// plan then takes the model of the task's level from that harness's `models`).
export function roleChain(config, role) {
  const list = config.roles?.[role];
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const slash = entry.indexOf('/');
    const harness = slash === -1 ? entry : entry.slice(0, slash);
    return { harness, tool: harnessTool(config, harness), model: slash === -1 ? null : entry.slice(slash + 1) };
  });
}

// `github.project`: a map with `owner` (non-empty text) and `number` (positive integer), plus an
// optional `field` (non-empty text) and `status` (a map whose keys are the BOARD_STATUS_DEFAULTS
// keys, each a non-empty option name). A project without a valid owner and number is dropped with
// `config.invalid_section`; a bad field or status entry keeps its default with the same warning.
function normalizeGithub(github, warnings) {
  const warn = (section) => warnings.push({ key: 'config.invalid_section', params: { section: `github.${section}` } });
  const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  const out = { ...github };
  const p = github.project;
  if (p === undefined || p === null) return out;
  delete out.project;
  if (!isPlainObject(p) || !text(p.owner) || !Number.isInteger(p.number) || p.number <= 0) { warn('project'); return out; }
  const project = { owner: text(p.owner), number: p.number };
  if (p.field !== undefined && p.field !== null) {
    if (text(p.field)) project.field = text(p.field);
    else warn('project.field');
  }
  if (p.status !== undefined && p.status !== null) {
    if (!isPlainObject(p.status)) warn('project.status');
    else {
      const status = {};
      for (const [key, value] of Object.entries(p.status)) {
        if (Object.hasOwn(BOARD_STATUS_DEFAULTS, key) && text(value)) status[key] = text(value);
        else warn(`project.status.${key}`);
      }
      project.status = status;
    }
  }
  out.project = project;
  return out;
}

// The board to mirror, or null when there is none: `github` must be in `tracker` and
// `github.project` valid. Field and status names come filled with their defaults.
export function githubProject(config) {
  const tracker = Array.isArray(config.tracker) ? config.tracker : [config.tracker];
  const p = config.github?.project;
  if (!tracker.includes('github') || !isPlainObject(p)) return null;
  return { owner: p.owner, number: p.number, field: p.field ?? 'Status', status: { ...BOARD_STATUS_DEFAULTS, ...(p.status ?? {}) } };
}

// `review.pr`: reviewer agente|pessoa|ambos, auto_fix boolean. A bad reviewer (or a `pr` that is
// not a map) falls back to `pessoa`, the most human review, with a warning; a bad auto_fix keeps
// the default. `last_round_importante` (1.4.0 name: `round5_importante`, read when the new one is
// absent) falls back to `parar`, the choice that waits for the person. `task_rounds`: a class whose
// value is not a positive whole number keeps its default, with a warning.
function normalizeReview(review, warnings) {
  const out = checkKeys('review', review, { final_rounds_max: positiveInt }, warnings);
  delete out.round5_importante;
  const last = review.last_round_importante ?? review.round5_importante;
  if (last !== undefined && last !== null) {
    if (LAST_ROUND_IMPORTANTE.includes(last)) out.last_round_importante = last;
    else {
      warnings.push({ key: 'config.last_round_importante_invalid', params: { value: String(last) } });
      out.last_round_importante = 'parar';
    }
  }
  if (review.task_rounds !== undefined && review.task_rounds !== null) {
    if (!isPlainObject(review.task_rounds)) {
      delete out.task_rounds;
      warnings.push({ key: 'config.invalid_section', params: { section: 'review.task_rounds' } });
    } else {
      const rounds = { ...review.task_rounds };
      for (const [cls, n] of Object.entries(rounds)) {
        if (Number.isInteger(n) && n >= 1) continue;
        delete rounds[cls];
        warnings.push({ key: 'config.invalid_section', params: { section: `review.task_rounds.${cls}` } });
      }
      out.task_rounds = rounds;
    }
  }
  // `final_rounds_max` (checked above): an integer >= 1. `focus`: a map with the lists `always` and
  // `suggestion` (see textList); another key, or a focus that is not a map, is dropped with
  // config.invalid_section.
  const focus = review.focus;
  if (focus !== undefined && focus !== null) {
    if (!isPlainObject(focus)) { delete out.focus; warnings.push(invalidSection('review.focus')); }
    else {
      out.focus = {};
      for (const [key, value] of Object.entries(focus)) {
        if (!['always', 'suggestion'].includes(key)) { warnings.push(invalidSection(`review.focus.${key}`)); continue; }
        if (value === undefined || value === null) continue;
        const list = textList(value, `review.focus.${key}`, warnings);
        if (list !== undefined) out.focus[key] = list;
      }
    }
  }
  const pr = review.pr;
  if (pr === undefined || pr === null) return out;
  if (!isPlainObject(pr)) {
    out.pr = { reviewer: 'pessoa' };
    warnings.push({ key: 'config.pr_reviewer_invalid', params: { value: String(pr) } });
    return out;
  }
  const next = { ...pr };
  if (next.reviewer !== undefined && next.reviewer !== null && !PR_REVIEWERS.includes(next.reviewer)) {
    warnings.push({ key: 'config.pr_reviewer_invalid', params: { value: String(next.reviewer) } });
    next.reviewer = 'pessoa';
  }
  if (next.auto_fix !== undefined && next.auto_fix !== null && typeof next.auto_fix !== 'boolean') {
    delete next.auto_fix;
    warnings.push({ key: 'config.invalid_section', params: { section: 'review.pr.auto_fix' } });
  }
  out.pr = next;
  return out;
}

const hasWildcard = (s) => /[*?]/.test(s);
const expandBraces = (p) => {
  const m = /\{([^{}]*)\}/.exec(p);
  return m ? m[1].split(',').flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length))) : [p];
};

// Concrete paths a glob matches: `**` as no folder or one folder (`a`; `x` when it ends the glob),
// `*` and `?` as `x`. `prefixes(next)` may add more folder lists for a `**` followed by the literal
// segment `next`.
function examplePaths(glob, prefixes = () => []) {
  const out = [];
  for (const alt of expandBraces(glob)) {
    const segs = alt.split('/').filter((s) => s !== '');
    const walk = (i, acc) => {
      if (i === segs.length) { if (acc.length) out.push(acc.join('/')); return; }
      const s = segs[i];
      if (s === '**') {
        if (i === segs.length - 1) return walk(i + 1, [...acc, 'x']);
        const next = segs[i + 1];
        for (const fill of [[], ['a'], ...(hasWildcard(next) ? [] : prefixes(next))]) walk(i + 1, [...acc, ...fill]);
      } else walk(i + 1, [...acc, s.replace(/\*+|\?/g, 'x')]);
    };
    walk(0, []);
  }
  return out;
}

// How git applies `:(exclude,glob)<entry>`: an entry without wildcards also covers everything under
// it (a folder); one with wildcards must match the whole path.
function ignoreMatcher(entry) {
  if (!hasWildcard(entry)) return (p) => p === entry || p.startsWith(`${entry}/`);
  const re = globToRegExp(entry);
  return (p) => re.test(p);
}

// Files of the engine that no ignore entry may hide.
const BACO_FILES = ['.baco/config.yaml', '.baco/local.env', '.baco/junit/x.xml', '.baco/x'];

// Why an ignore entry (already trimmed, leading `./` removed) is refused, or null when it is kept.
// The test check is a heuristic, made to err on the side of refusing: the entry is refused when it
// matches an example path of a test pattern (`**` there taken as no folder, one folder, or the
// folders the entry itself names before the pattern's own folder, as `src/` for `src/e2e/**` against
// `**/e2e/**`), or when a test pattern matches an example path of the entry. A test pattern that
// names only file names (`**/*.test.js`) is not applied to a folder glob such as `logs/**`.
export function ignoreEntryProblem(entry, testPatterns) {
  const p = entry.replace(/\/+$/, '');
  if (!p || entry.startsWith('/') || entry.startsWith(':')) return 'invalid';
  if (/^[*?./]+$/.test(p)) return 'too_broad';
  if (/[[\]\\]/.test(p)) return 'unsupported';
  const segs = p.split('/');
  if (segs.some((s) => s === '..' || s === '.')) return 'outside';
  const matches = ignoreMatcher(p);
  const first = segs[0];
  if (BACO_FILES.some(matches) || (first !== '**' && globToRegExp(first).test('.baco'))) return 'baco';
  const literal = [];
  for (const s of segs) { if (hasWildcard(s)) break; literal.push(s); }
  const prefixes = (next) => { const i = literal.indexOf(next); return i > 0 ? [literal.slice(0, i)] : []; };
  for (const pattern of testPatterns) {
    const re = globToRegExp(pattern);
    if (examplePaths(pattern, prefixes).some(matches) || examplePaths(p).some((x) => re.test(x))) return 'tests';
  }
  return null;
}

// `provenance.ignore`: a list (or one scalar) of repo-relative paths. Items that are not text, or
// that `ignoreEntryProblem` refuses (empty, absolute, own pathspec magic, too broad, `.`/`..`
// segments, `.baco` files, test files), are dropped with `config.invalid_section`; so is a value
// that is neither a list nor a scalar. `testPatterns` are the project's and the default test globs.
function normalizeIgnore(value, warnings, testPatterns) {
  const warn = () => warnings.push({ key: 'config.invalid_section', params: { section: 'provenance.ignore' } });
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value : (typeof value === 'string' || typeof value === 'number') ? [value] : null;
  if (items === null) { warn(); return []; }
  const out = [];
  let bad = false;
  for (const item of items) {
    const p = typeof item === 'string' || typeof item === 'number' ? String(item).trim().replace(/^(\.\/)+/, '') : '';
    if (!p || ignoreEntryProblem(p, testPatterns)) bad = true;
    else if (!out.includes(p)) out.push(p);
  }
  if (bad) warn();
  return out;
}

// Resolves a parsed user config over DEFAULTS. Never throws on shape: bad sections fall back to
// defaults with a warning, and the mandatory gates are always true.
export function resolveConfig(parsed) {
  if (parsed !== null && parsed !== undefined && !isPlainObject(parsed)) throw new ConfigError('Config root must be a map');
  let user = { ...(parsed ?? {}) };
  const warnings = [];
  for (const section of MAP_SECTIONS) {
    const v = user[section];
    if (v === undefined || v === null || isPlainObject(v)) continue;
    delete user[section];
    warnings.push({ key: 'config.invalid_section', params: { section } });
  }
  if (isPlainObject(user.models)) user = { ...user, models: normalizeModels(user.models, warnings) };
  if (isPlainObject(user.harnesses)) user = { ...user, harnesses: normalizeHarnesses(user.harnesses, warnings) };
  if (isPlainObject(user.review)) user = { ...user, review: normalizeReview(user.review, warnings) };
  if (isPlainObject(user.github)) user = { ...user, github: normalizeGithub(user.github, warnings) };
  if (isPlainObject(user.planning)) user = { ...user, planning: normalizePlanning(user.planning, warnings) };
  if (isPlainObject(user.roles)) user = { ...user, roles: normalizeRoles(user.roles, isPlainObject(user.harnesses) ? user.harnesses : {}, warnings) };
  for (const [section, key] of LIST_SETTINGS) {
    const v = user[section]?.[key];
    if (v === undefined || v === null) continue;
    let list;
    if (Array.isArray(v)) list = v.filter((x) => x !== null && x !== undefined).map(String);
    else if (typeof v === 'string' || typeof v === 'number') list = [String(v)];
    else {
      user = { ...user, [section]: { ...user[section] } };
      delete user[section][key];
      warnings.push({ key: 'config.invalid_section', params: { section: `${section}.${key}` } });
      continue;
    }
    user = { ...user, [section]: { ...user[section], [key]: list } };
  }
  // After tests.patterns is settled: an ignore entry may not cover the project's or the default tests.
  if (isPlainObject(user.provenance)) {
    const testPatterns = [...new Set([...DEFAULTS.tests.patterns, ...(user.tests?.patterns ?? [])])];
    const ignore = normalizeIgnore(user.provenance.ignore, warnings, testPatterns);
    user = { ...user, provenance: { ...user.provenance } };
    if (ignore === undefined) delete user.provenance.ignore;
    else user.provenance.ignore = ignore;
  }
  // Plain keys checked by type; a bad value is dropped (the default stays) with config.invalid_section.
  const SECTION_CHECKS = {
    context: { handoff_at: positiveInt, auto_handoff: isBool },
    test_runs: { screen_task_full: isBool, ci_full: oneOf(['merge', 'manual']) },
    ci: { monthly_minutes: positiveInt },
    delivery: { target: oneOf(['integration', 'main']), integration_merge: oneOf(['ask', 'auto']) },
    product: { uses_ai: isBool },
  };
  for (const [section, checks] of Object.entries(SECTION_CHECKS)) {
    if (isPlainObject(user[section])) user = { ...user, [section]: checkKeys(section, user[section], checks, warnings) };
  }
  // qa.specialist: a list of non-empty texts (see textList).
  if (isPlainObject(user.qa) && user.qa.specialist !== undefined && user.qa.specialist !== null) {
    const qa = { ...user.qa };
    const list = textList(qa.specialist, 'qa.specialist', warnings);
    if (list === undefined) delete qa.specialist;
    else qa.specialist = list;
    user = { ...user, qa };
  }
  if (isPlainObject(user.gates)) {
    for (const gate of MANDATORY_GATES) {
      if (Object.hasOwn(user.gates, gate) && user.gates[gate] !== true) {
        warnings.push({ key: 'config.mandatory_gate_ignored', params: { gate } });
      }
    }
  }
  const config = deepMerge(structuredClone(DEFAULTS), user);
  config.gates = { ...config.gates };
  for (const gate of MANDATORY_GATES) config.gates[gate] = true;
  return { ...config, warnings };
}

export function loadConfig(root) {
  const file = join(root, '.baco', 'config.yaml');
  return resolveConfig(existsSync(file) ? parseYamlSubset(readFileSync(file, 'utf8')) : {});
}

// R20: the keys `main` and `integration` are ROLE names resolved through config.branches; any other
// key is a literal branch name and wins over a role; '*' is the fallback.
export function manualPendingRule(config, targetBranch) {
  const rules = config.manual_pending ?? {};
  const own = (k) => (Object.hasOwn(rules, k) ? rules[k] : undefined);
  const branches = config.branches ?? DEFAULTS.branches;
  const ROLES = ['main', 'integration'];
  if (!ROLES.includes(targetBranch) && own(targetBranch) !== undefined) return own(targetBranch);
  for (const role of ROLES) {
    if (branches[role] === targetBranch && own(role) !== undefined) return own(role);
  }
  return own('*') ?? 'warn';
}

// Branches that must never be worked on or deleted: the configured list plus the main and
// integration branches.
export function protectedBranches(config) {
  const b = config.branches ?? DEFAULTS.branches;
  const list = Array.isArray(b.protected) ? [...b.protected] : [];
  for (const role of [b.main, b.integration]) if (typeof role === 'string' && role && !list.includes(role)) list.push(role);
  return list;
}

// Keys of `tests` that are settings, not test layers.
const TESTS_SETTINGS = ['junit_dir', 'patterns', 'queue'];
const layerKeys = (section) => Object.keys(section ?? {}).filter((k) => !TESTS_SETTINGS.includes(k));

// Test layers in config order: the keys of `tests` (minus its settings) and, with `quick`, the
// layers that exist only in `tests_quick`.
export function testLayers(config, { quick = false } = {}) {
  const layers = layerKeys(config.tests);
  if (quick) for (const k of layerKeys(config.tests_quick)) if (!layers.includes(k)) layers.push(k);
  return layers;
}

// Command of one layer: `tests_quick.<layer>` when `quick` and present, else `tests.<layer>`.
// undefined = unknown layer (in neither section); null = known but with no string command.
export function layerCommand(config, layer, quick = false) {
  const own = (section) => (section && !TESTS_SETTINGS.includes(layer) && Object.hasOwn(section, layer) ? section[layer] : undefined);
  const full = own(config.tests);
  const fast = own(config.tests_quick);
  if (full === undefined && fast === undefined) return undefined;
  if (quick && typeof fast === 'string' && fast.trim()) return fast;
  return typeof full === 'string' && full.trim() ? full : null;
}

// Layers whose runs are serialized machine-wide: `tests.queue` when set, else every layer whose
// name starts with `e2e`.
export function queuedLayers(config) {
  if (Array.isArray(config.tests?.queue)) return [...config.tests.queue];
  return testLayers(config, { quick: true }).filter((l) => l.startsWith('e2e'));
}

// R26 pathspecs: what a commit must touch to make a recorded head (trace, verdict, waiver) stale.
// Everything except the delivery artifacts (<docs_root>/entregas/**) and the `provenance.ignore`
// entries present both in `config` (current) and in `recordedIgnore` (the list in the config at the
// recorded head; none when omitted), so an entry added after the head never hides later changes.
export function provenancePathspecs(config, recordedIgnore = []) {
  const docsRoot = String(config.docs_root ?? 'docs').replace(/\/+$/, '');
  const current = Array.isArray(config.provenance?.ignore) ? config.provenance.ignore : [];
  const recorded = Array.isArray(recordedIgnore) ? recordedIgnore : [];
  const ignore = current.filter((p) => recorded.includes(p));
  return ['.', `:(exclude)${docsRoot}/entregas/**`, ...ignore.map((p) => `:(exclude,glob)${p}`)];
}

// `app.smoke`: starts the app the way the user does, checks it answers and exits. null when unset.
export function smokeCommand(config) {
  const v = config.app?.smoke;
  return typeof v === 'string' && v.trim() ? v : null;
}
