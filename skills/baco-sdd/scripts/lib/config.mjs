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
  // the person); pr.auto_fix: whether the findings become fix tasks that run on their own.
  review: { external_rounds_max: 3, pr: { reviewer: 'agente', auto_fix: true } },
  // AI tools (harnesses) available to the project, by name: `models` maps the BACO levels (forte,
  // medio, leve) to that tool's model names; `implementers` allows it to run implementers when it is
  // not the conductor's own tool (default false: only read-only roles run there).
  harnesses: {},
  // Paths (git pathspec globs) that, like <docs_root>/entregas/**, never make a recorded head stale (R26).
  provenance: { ignore: [] },
  // Conversation size (input + cache tokens of the last answer) from which the conductor suggests,
  // or with auto_handoff makes during construction, the switch to a new conversation.
  context: { handoff_at: 400000, auto_handoff: false },
};

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
const MAP_SECTIONS = ['gates', 'branches', 'tests', 'models', 'review', 'manual_pending', 'tests_quick', 'app', 'provenance', 'context', 'harnesses'];
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
const PR_REVIEWERS = ['agente', 'pessoa', 'ambos'];

// `harnesses.<name>`: a map with `models` (level -> non-empty model name) and `implementers`
// (boolean, default false). An entry that is not a map, a level that is not forte/medio/leve, an
// empty model name or a bad `implementers` is dropped with `config.invalid_section`.
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
    out[name] = { ...entry, models, implementers };
  }
  return out;
}

// `review.pr`: reviewer agente|pessoa|ambos, auto_fix boolean. A bad reviewer (or a `pr` that is
// not a map) falls back to `pessoa`, the most human review, with a warning; a bad auto_fix keeps
// the default.
function normalizeReview(review, warnings) {
  const out = { ...review };
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
  // context.handoff_at must be a positive integer, context.auto_handoff a boolean; a bad value is
  // dropped (the default stays) with config.invalid_section.
  if (isPlainObject(user.context)) {
    const context = { ...user.context };
    const checks = { handoff_at: (v) => Number.isInteger(v) && v > 0, auto_handoff: (v) => typeof v === 'boolean' };
    for (const [key, ok] of Object.entries(checks)) {
      if (context[key] === undefined || context[key] === null || ok(context[key])) continue;
      delete context[key];
      warnings.push({ key: 'config.invalid_section', params: { section: `context.${key}` } });
    }
    user = { ...user, context };
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
