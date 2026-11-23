// baco guard-tests: finds weakened, skipped or deleted tagged tests in a diff. A changed line counts
// for the tests enclosing it; a test ends at the LATER of its lexical end (balanced call) and its
// indentation end (see `closedBefore`), so when one reading is unsure the protection stays on.
import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { currentBranch, diffNames, diffPatch, mergeBase, refExists, revParse, showFile } from '../lib/git.mjs';
import { idsInTitle } from '../lib/junit.mjs';
import { readText } from '../lib/markdown.mjs';
import { readQa, qaPathFor } from '../lib/qa.mjs';
import { parseYamlSubset, resolveConfig } from '../lib/config.mjs';
import { globToRegExp } from '../lib/glob.mjs';
import { diffSpecs } from './spec-diff.mjs';

export const usage = 'baco guard-tests --base <ref> [--head HEAD] [--task-base <ref>] [--allow <ID>]... [--allow-from-spec <spec.md>@<ref>]... [--json] [--cwd <dir>]';
export const needsRepo = true;

const SKIP_RES = [
  /\b(it|test|describe)(\.\w+)*\.(skip|only|todo|fixme)\b/,
  /(?<![\w.$])(xit|xtest|xdescribe|fit|fdescribe)\s*\(/,
];
const TEST_OPEN_RE = /\b(it|test|describe)(\.\w+)*\s*\(/;
const lastExt = (p) => { const b = String(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1) : ''; };
const indentOf = (l) => /^\s*/.exec(l)[0].length;

// Whether the `/` at `i` starts a regex literal rather than a division. Division only after a value:
// an identifier or number (not a keyword such as `return`), `)` or `]`. Anything else, the start of
// the line included, is read as a regex: a wrong guess then skips text, which leaves the test open.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
function startsRegex(l, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(l[j])) j--;
  if (j < 0) return true;
  if (l[j] === ')' || l[j] === ']') return false;
  if (!/[\w$]/.test(l[j])) return true;
  let k = j;
  while (k > 0 && /[\w$]/.test(l[k - 1])) k--;
  return REGEX_AFTER_WORD.has(l.slice(k, j + 1));
}
// Index of the closing `/` of the regex literal opening at `i` (escapes and `[...]` classes read),
// or the end of the line when it is not closed there.
function regexEnd(l, i) {
  let inClass = false;
  for (let j = i + 1; j < l.length; j++) {
    const c = l[j];
    if (c === '\\') j++;
    else if (inClass) { if (c === ']') inClass = false; }
    else if (c === '[') inClass = true;
    else if (c === '/') return j;
  }
  return l.length;
}

// Index of the line where the test call opened on line `open` closes: its parentheses are counted
// from the `(` after the name, skipping strings, template text (but not `${ }` code inside it),
// regex literals, line and block comments and escaped characters. Infinity when it never closes (or the line has no
// call): the test then reaches the end of the file, which keeps the protection on.
function callEndLine(lines, open) {
  const m = TEST_OPEN_RE.exec(lines[open]);
  if (!m) return Infinity;
  let depth = 0;
  let block = false; // inside /* */
  let quote = null; // ' or " (a string never crosses a line)
  // Template nesting: 'tpl' is template text; a code frame counts its braces so `}` can close `${`.
  const stack = [{ kind: 'code', braces: 0 }];
  for (let li = open; li < lines.length; li++) {
    const l = lines[li];
    quote = null;
    for (let i = li === open ? m.index + m[0].length - 1 : 0; i < l.length; i++) {
      const c = l[i];
      const top = stack[stack.length - 1];
      if (block) { if (c === '*' && l[i + 1] === '/') { block = false; i++; } continue; }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (top.kind === 'tpl') {
        if (c === '\\') i++;
        else if (c === '`') stack.pop();
        else if (c === '$' && l[i + 1] === '{') { stack.push({ kind: 'code', braces: 0, expr: true }); i++; }
        continue;
      }
      if (c === '\\') { i++; continue; }
      if (c === '/' && l[i + 1] === '/') break;
      if (c === '/' && l[i + 1] === '*') { block = true; i++; continue; }
      if (c === '/' && startsRegex(l, i)) { i = regexEnd(l, i); continue; }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === '`') { stack.push({ kind: 'tpl' }); continue; }
      if (c === '{') top.braces++;
      else if (c === '}') { if (top.expr && top.braces === 0) stack.pop(); else top.braces--; }
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return li;
    }
  }
  return Infinity;
}
// The simple scanner's own regex test, narrower than `startsRegex`: a `/` right after one of
// `( , = : [ ! & | ? { ;`, after `return`, or at the line start. Used only within one line.
function simpleRegexStart(l, i) {
  const before = l.slice(0, i).trimEnd();
  return before === '' || /[(,=:[!&|?{;]$/.test(before) || /(^|[^\w$])return$/.test(before);
}

// For each line from `open` on, whether it starts inside template text or a block comment. A simple
// scanner of its own (backticks with `${ }` nesting, block and line comments, quoted strings on a
// line, and a regex literal closed on the same line, so `/[/*]/` or `/`/` open nothing),
// deliberately without the regex-or-division guess of `callEndLine`, so one misreading cannot
// mislead both readings.
function insideText(lines, open) {
  const inside = [];
  const stack = []; // 'tpl' or a brace count of a `${ }` code part
  let block = false;
  for (let li = open; li < lines.length; li++) {
    inside[li] = block || stack[stack.length - 1] === 'tpl';
    const l = lines[li];
    let quote = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      const top = stack[stack.length - 1];
      if (block) { if (c === '*' && l[i + 1] === '/') { block = false; i++; } continue; }
      if (top === 'tpl') {
        if (c === '\\') i++;
        else if (c === '`') stack.pop();
        else if (c === '$' && l[i + 1] === '{') { stack.push(0); i++; }
        continue;
      }
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '\\') { i++; continue; }
      if (c === '/' && l[i + 1] === '/') break;
      if (c === '/' && l[i + 1] === '*') { block = true; i++; continue; }
      if (c === '/' && simpleRegexStart(l, i)) {
        const end = regexEnd(l, i);
        if (end < l.length) { i = end; continue; } // no closing `/` on the line: a plain character
      }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === '`') { stack.push('tpl'); continue; }
      if (typeof top === 'number') {
        if (c === '{') stack[stack.length - 1]++;
        else if (c === '}') { if (top === 0) stack.pop(); else stack[stack.length - 1]--; }
      }
    }
  }
  return inside;
}

// Index of the last line of the test opened on line `open`, by indentation, among the lines that do
// not start inside template text or a block comment: the first later line at the opener's
// indentation or less that starts with `})` or `)` (the usual closing of a test call), or with `}`
// and `,` once the callback has opened on an earlier line (`}, 10000);`, `}, { timeout });`); or,
// ending the test just before it, such a line that opens another test or describe or starts a
// declaration (`function`, `const`, `class`...: a one-line test followed by a helper). Other lines
// at that indentation (the `},` after an options object, before the callback) do not end it.
// Infinity when nothing ends it.
const TEST_START_RE = /^\s*(it|test|describe)(\.\w+)*\s*\(/;
const DECL_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|const|let|var|class)\b/;
const CALLBACK_RE = /=>\s*\{|\bfunction\b[^{]*\{/;
function indentEndLine(lines, open) {
  const indent = indentOf(lines[open]);
  const inside = insideText(lines, open);
  let callback = CALLBACK_RE.test(lines[open]);
  for (let j = open + 1; j < lines.length; j++) {
    const l = lines[j];
    if (inside[j]) continue;
    if (l.trim() !== '' && indentOf(l) <= indent) {
      if (/^\s*\}?\)/.test(l) || (callback && /^\s*\}\s*,/.test(l))) return j;
      if (TEST_START_RE.test(l) || DECL_RE.test(l)) return j - 1;
    }
    if (CALLBACK_RE.test(l)) callback = true;
  }
  return Infinity;
}

// Whether the test opened at index `open` has already ended before index `at`. Its end is the LATER
// of two independent readings, the lexical balance of the call (`callEndLine`) and the indentation
// rule (`indentEndLine`): a misreading in either one can only keep the test open longer, never cut
// its protection short. A helper written after the last test is outside it, since both agree.
const closedBefore = (lines, open, at) => Math.max(callEndLine(lines, open), indentEndLine(lines, open)) < at;

// IDs in the titles of the tests enclosing (1-based) `lineNo`: walk upward collecting test-opening
// lines with strictly smaller indentation whose call has not closed before the line (so a helper
// written after the last test is not attributed to it). Ancestors in `skip` (lines added by the
// diff) are ignored so a brand-new tagged test is not reported as a change.
function enclosingIds(content, lineNo, skip) {
  if (content === null || content === undefined) return [];
  const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
  const cur = lines[lineNo - 1];
  if (cur === undefined || cur.trim() === '') return [];
  let threshold = indentOf(cur);
  const ids = [];
  for (let i = lineNo - 2; i >= 0 && threshold > 0; i--) {
    const l = lines[i];
    if (l.trim() === '' || indentOf(l) >= threshold) continue;
    if (!TEST_OPEN_RE.test(l)) continue;
    threshold = indentOf(l);
    if (closedBefore(lines, i, lineNo - 1)) continue;
    if (!skip.has(i + 1)) for (const id of idsInTitle(l)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export { globToRegExp };

// Scans a unified diff (git diff output). `line` is the line number in the head file for added
// lines and in the base file for removed lines. A deleted test file, or one renamed/moved from a
// test path to a non-test path, yields TAGGED_TEST_DELETED per ID (its removed lines are not also
// reported as TAGGED_TEST_CHANGED).
// A changed (removed or added) line is attributed to the tagged tests enclosing it, plus (for
// removed lines) the IDs on the line itself. `getContent(side, path)` ('base'|'head', path in that
// side's tree) supplies file text for the enclosing lookup; without it only the line's own IDs count.
export function scanTestDiff(patch, isTestFile, allowedIds, getContent = null) {
  const findings = [];
  let path = null;
  let active = false;
  let deleted = false;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const deletedSeen = new Set();
  const changedSeen = new Set();
  const addedLines = new Set();
  const cache = new Map();
  let oldPath = null;
  let hunk = 0;
  const content = (side, p) => {
    const key = `${side}\0${p}`;
    if (!cache.has(key)) cache.set(key, getContent ? getContent(side, p) : null);
    return cache.get(key);
  };
  const flagChanged = (id, line) => {
    if (allowedIds.has(id)) return;
    const key = `${path}\0${id}\0${hunk}`;
    if (changedSeen.has(key)) return;
    changedSeen.add(key);
    findings.push({ code: 'TAGGED_TEST_CHANGED', path, id, line });
  };
  let headerOpen = false;
  let skipOnly = false; // R25: file already reported as deleted; scan its hunks for SKIP_ADDED only
  // Everything a test file tagged is gone when the file leaves the test tree (renamed or moved to a
  // non-test path). A 100% rename has no hunks, so the IDs are read from the base content.
  const flagLeft = (p) => {
    const text = content('base', p);
    if (text === null || text === undefined) return;
    text.split('\n').forEach((l, i) => {
      for (const id of idsInTitle(l)) {
        if (allowedIds.has(id) || deletedSeen.has(`${p}\0${id}`)) continue;
        deletedSeen.add(`${p}\0${id}`);
        findings.push({ code: 'TAGGED_TEST_DELETED', path: p, id, line: i + 1 });
      }
    });
  };
  // Called once per file when its extended header ends (first hunk, next file, or end of patch).
  const closeHeader = () => {
    if (!headerOpen) return;
    headerOpen = false;
    const newIsTest = path !== null && isTestFile(path);
    const oldIsTest = oldPath !== null && oldPath !== path && isTestFile(oldPath);
    if (oldIsTest && !newIsTest) { flagLeft(oldPath); active = false; return; }
    // R24: a rename of a test-relevant file that changes its last extension (`.js` -> `.disabled`)
    // usually takes it out of the runner, whatever the patterns say: treat it as a deletion.
    // R25: only when the OLD path is a test; the hunks are still scanned for SKIP_ADDED.
    if (oldIsTest && lastExt(oldPath) !== lastExt(path)) {
      flagLeft(oldPath); active = newIsTest; skipOnly = true; return;
    }
    active = newIsTest;
  };
  for (const raw of patch.split('\n')) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (text.startsWith('diff --git ')) {
      closeHeader();
      const m = /^diff --git a\/.* b\/(.*)$/.exec(text);
      path = m ? m[1] : null;
      active = false;
      skipOnly = false;
      headerOpen = true;
      deleted = false;
      inHunk = false;
      oldPath = path;
      addedLines.clear();
      hunk++;
      continue;
    }
    if (!inHunk) {
      if (text.startsWith('deleted file mode')) deleted = true;
      if (text.startsWith('rename from ')) oldPath = text.slice(12);
      if (text.startsWith('rename to ')) path = text.slice(10);
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (h) { closeHeader(); oldLine = Number(h[1]); newLine = Number(h[2]); inHunk = true; hunk++; }
      continue;
    }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (h) { oldLine = Number(h[1]); newLine = Number(h[2]); hunk++; continue; }
    const sign = text[0];
    if (sign === '+') {
      addedLines.add(newLine);
      if (active && SKIP_RES.some((re) => re.test(text.slice(1)))) findings.push({ code: 'SKIP_ADDED', path, line: newLine });
      if (active && !deleted && !skipOnly) for (const id of enclosingIds(content('head', path), newLine, addedLines)) flagChanged(id, newLine);
      newLine++;
    } else if (sign === '-') {
      if (active && !skipOnly) {
        for (const id of idsInTitle(text.slice(1))) {
          if (allowedIds.has(id)) continue;
          if (deleted) {
            if (deletedSeen.has(`${path}\0${id}`)) continue;
            deletedSeen.add(`${path}\0${id}`);
            findings.push({ code: 'TAGGED_TEST_DELETED', path, id, line: oldLine });
          } else flagChanged(id, oldLine);
        }
        if (!deleted) for (const id of enclosingIds(content('base', oldPath), oldLine, new Set())) flagChanged(id, oldLine);
      }
      oldLine++;
    } else if (sign === ' ') { oldLine++; newLine++; }
  }
  closeHeader();
  return findings;
}

const CONFIG_PATH = '.baco/config.yaml';
// Resolved `tests` section of a config file's text (null/absent -> defaults).
const testsSection = (text) => resolveConfig(text === null ? {} : parseYamlSubset(text)).tests;
// What decides which tests run and how: `tests`, `tests_quick` and `app.smoke`.
const testsSettings = (text) => {
  const c = resolveConfig(text === null ? {} : parseYamlSubset(text));
  return { tests: c.tests, tests_quick: c.tests_quick ?? null, smoke: c.app?.smoke ?? null };
};
// Resolved `provenance.ignore` (refused entries already dropped), order and duplicates aside.
const provenanceIgnore = (text) => [...resolveConfig(text === null ? {} : parseYamlSubset(text)).provenance.ignore].sort();

const list = (v) => (v === undefined ? [] : [].concat(v)).filter((x) => typeof x === 'string');

function allowedFromSpec(spec, ctx) {
  const at = spec.lastIndexOf('@');
  if (at <= 0 || at === spec.length - 1) return null;
  const specPath = spec.slice(0, at);
  const ref = spec.slice(at + 1);
  const abs = resolve(ctx.cwd, specPath);
  const headMd = readText(abs);
  const rel = relative(realpathSync(ctx.root), realpathSync(abs)).split(sep).join('/');
  const baseMd = showFile(ref, rel, ctx.cwd); // GitError on a bad ref
  const { modified, removed } = diffSpecs(baseMd, headMd);
  const ids = new Set([...modified, ...removed].filter((id) => id.startsWith('CA-')));
  const qaPath = qaPathFor(abs);
  if (ids.size && existsSync(qaPath)) {
    for (const s of readQa(qaPath).scenarios) if (s.contracts.some((c) => ids.has(c))) ids.add(s.id);
  }
  return ids;
}

// Findings of one range (from..head): config changes first, then the test diff.
function scanRange(from, fromText, head, headText, isTestFile, allowed, cwd) {
  const findings = [];
  if (fromText !== headText && JSON.stringify(testsSettings(fromText)) !== JSON.stringify(testsSettings(headText))) {
    findings.push({ code: 'CONFIG_TESTS_CHANGED', path: CONFIG_PATH, line: null });
  }
  // The paths that do not make a recorded head stale (R26) are as sensitive as the tests themselves.
  if (fromText !== headText && JSON.stringify(provenanceIgnore(fromText)) !== JSON.stringify(provenanceIgnore(headText))) {
    findings.push({ code: 'CONFIG_PROVENANCE_CHANGED', path: CONFIG_PATH, line: null });
  }
  // The whole patch is fetched (no pathspec) so rename detection pairs old and new paths; a
  // renamed test is then scanned as a modification. Only committed changes (from..head) count.
  // A file is test-relevant when its old OR new path is a test path.
  const changed = diffNames(from, head, cwd).some((f) => isTestFile(f.path) || (f.oldPath !== undefined && isTestFile(f.oldPath)));
  if (!changed) return findings;
  const getContent = (side, p) => showFile(side === 'base' ? from : head, p, cwd);
  return [...findings, ...scanTestDiff(diffPatch(from, head, null, cwd), isTestFile, allowed, getContent)];
}

// Where the task started: merge-base of head with `--task-base`, or, without the flag, with the
// delivery branch `baco/ENT-NNN` when head is a task branch `baco/ENT-NNN-<TASK-ID>` and that
// delivery branch exists. Null when there is none; false for a malformed flag.
const TASK_BRANCH_RE = /^baco\/(ENT-\d+)-.+$/;
function taskStart(flag, head, cwd) {
  if (flag !== undefined) return typeof flag === 'string' ? mergeBase(head, flag, cwd) : false;
  const branch = head === 'HEAD' ? currentBranch(cwd) : head;
  const m = TASK_BRANCH_RE.exec(branch);
  if (!m || !refExists(`refs/heads/baco/${m[1]}`, cwd)) return null;
  return mergeBase(head, `baco/${m[1]}`, cwd);
}

export async function run(args, ctx) {
  const { base, head = 'HEAD' } = args.flags;
  if (typeof base !== 'string' || typeof head !== 'string') {
    return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  }
  const allowed = new Set(list(args.flags.allow));
  // Repeatable: the allowed IDs are the union of every spec's changed criteria (and their scenarios).
  const fromSpec = args.flags['allow-from-spec'];
  for (const spec of fromSpec === undefined ? [] : [].concat(fromSpec)) {
    const ids = typeof spec === 'string' ? allowedFromSpec(spec, ctx) : null;
    if (ids === null) return { code: 64, data: {}, messages: [{ key: 'guard.bad_allow_spec' }] };
    for (const id of ids) allowed.add(id);
  }
  const headText = showFile(head, CONFIG_PATH, ctx.cwd);
  const taskBase = taskStart(args.flags['task-base'], head, ctx.cwd);
  if (taskBase === false) return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  // I10: patterns are the union of the configs at each starting point and the current config's, so
  // a change cannot hide its own test edits by narrowing tests.patterns.
  const froms = taskBase && revParse(taskBase, ctx.cwd) !== revParse(base, ctx.cwd) ? [base, taskBase] : [base];
  const fromTexts = froms.map((ref) => showFile(ref, CONFIG_PATH, ctx.cwd));
  const patterns = [...new Set([...fromTexts.flatMap((t) => testsSection(t).patterns), ...ctx.config.tests.patterns])];
  const matchers = patterns.map(globToRegExp);
  const isTestFile = (p) => matchers.some((re) => re.test(p));
  // The Base check covers the whole delivery; the task-start check protects tests that earlier
  // tasks of the same delivery added (they did not exist at Base). A finding seen from both is kept once.
  const findings = [];
  const seen = new Set();
  froms.forEach((from, i) => {
    const found = scanRange(from, fromTexts[i], head, headText, isTestFile, allowed, ctx.cwd);
    const keyOf = (f) => (f.code === 'SKIP_ADDED' ? `${f.code}\0${f.path}\0${f.line}` : `${f.code}\0${f.path}\0${f.id ?? ''}`);
    const fresh = found.filter((f) => !seen.has(keyOf(f)));
    for (const f of found) seen.add(keyOf(f));
    findings.push(...fresh);
  });
  const messages = [{ key: 'guard.summary', params: { base, head, count: findings.length } }];
  if (taskBase) messages.push({ key: 'guard.task_base', params: { ref: taskBase.slice(0, 12) } });
  if (!findings.length) messages.push({ key: 'guard.ok' });
  for (const f of findings) messages.push({ key: `guard.finding.${f.code}`, params: { path: f.path, id: f.id ?? '', line: f.line ?? '-' } });
  if (findings.length) messages.push({ key: 'guard.gate' });
  return { code: findings.length ? 2 : 0, data: { findings, taskBase: taskBase || null }, messages };
}
