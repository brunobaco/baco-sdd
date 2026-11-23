import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { constants } from 'node:os';
import { join, resolve } from 'node:path';
import { testLayers, layerCommand, queuedLayers, smokeCommand } from '../lib/config.mjs';
import { readLocalEnv, LOCAL_ENV } from '../lib/localenv.mjs';
import { acquireQueue, QueueBlockedError, QueueTimeoutError } from '../lib/queue.mjs';
import { parseJUnit } from '../lib/junit.mjs';
import { t } from '../lib/messages.mjs';

export const usage = 'baco run-tests (--layer <name>... | --all) [--quick] [--verbose] [-- <extra args>] | baco run-tests --smoke [--json] [--cwd <dir>]';

const SAFE_WORD = /^[\w@%+=:,./-]+$/;
// POSIX shell quoting for the extra args appended to a configured command.
export const shellQuote = (s) => (s !== '' && SAFE_WORD.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

const OUTPUT_TAIL = 16000; // characters of captured output kept in --json data
export const LOGS_DIR = '.baco/logs';
const TAIL_LINES = 20; // lines shown when a failed layer has no failing test in its JUnit report
const MAX_FAILURES = 20; // failing tests listed in the summary
const MESSAGE_LINES = 20; // lines of each failing test's message shown in the summary
const round1 = (ms) => Math.round(ms / 100) / 10;
function envSeconds(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name];
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && (n > 0 || (allowZero && n === 0)) ? n : fallback;
}
const killGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch { /* already gone */ } };
// Whether any process is left in the group (EPERM: one exists that is not ours to signal).
const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const LEFTOVER_GRACE_MS = 2000; // after the shell exits: SIGTERM to the leftovers, then SIGKILL

// The child currently running and the queue lock currently held, for the signal handlers.
const live = { child: null, lock: null };

// Runs `command` with `sh -c` in its own process group: stdin closed (a prompt fails at once instead
// of hanging), stdout/stderr passed through or, with `capture`, collected (tail kept). When the shell
// exits, what it left running in its group gets SIGTERM, and SIGKILL if still there after
// LEFTOVER_GRACE_MS. With `timeoutMs`, the whole group is terminated (SIGTERM, then SIGKILL) when
// time runs out.
function runShell(command, { cwd, env, capture, timeoutMs, logFd = null }) {
  return new Promise((done) => {
    let settled = false;
    let output = '';
    let timedOut = false;
    let timer = null;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); live.child = null; done({ output: capture ? output : null, timedOut, ...r }); };
    const child = spawn('sh', ['-c', command], { cwd, env, detached: true, stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'] });
    live.child = child;
    if (capture) {
      const keep = (d) => {
        if (logFd !== null) { try { writeSync(logFd, d); } catch { /* the log is best effort */ } }
        output += d;
        if (output.length > OUTPUT_TAIL) output = output.slice(-OUTPUT_TAIL);
      };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
    }
    child.on('error', (error) => finish({ error }));
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup(child.pid, 'SIGTERM');
        setTimeout(() => killGroup(child.pid, 'SIGKILL'), 3000).unref();
      }, timeoutMs);
    }
    child.on('exit', (code, signal) => {
      killGroup(child.pid, 'SIGTERM');
      // Done when the pipes drained and the group is empty; at the end of the grace, what is left of
      // the group gets SIGKILL (a leftover that ignores SIGTERM) and the run ends anyway.
      const t0 = Date.now();
      let closed = false;
      let poll = null;
      const settle = () => {
        if (settled) return clearInterval(poll);
        if (closed && !groupAlive(child.pid)) { clearInterval(poll); return finish({ exit: code, signal }); }
        if (Date.now() - t0 < LEFTOVER_GRACE_MS) return;
        clearInterval(poll);
        killGroup(child.pid, 'SIGKILL');
        finish({ exit: code, signal });
      };
      poll = setInterval(settle, 50);
      child.on('close', () => { closed = true; settle(); });
    });
  });
}

// On SIGINT/SIGTERM/SIGHUP: stop the running command's group, release the queue, exit 128+n.
function trapSignals() {
  const onSignal = (sig) => {
    if (live.child) killGroup(live.child.pid, 'SIGTERM');
    live.lock?.release();
    process.exit(128 + (constants.signals[sig] ?? 1));
  };
  const onExit = () => live.lock?.release();
  const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => { const f = () => onSignal(s); process.on(s, f); return [s, f]; });
  process.on('exit', onExit);
  return () => {
    for (const [s, f] of sigs) process.removeListener(s, f);
    process.removeListener('exit', onExit);
  };
}

function junitSnapshot(dir) {
  const m = new Map();
  if (!existsSync(dir)) return m;
  for (const f of readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.xml')) continue;
    try { m.set(f, statSync(join(dir, f)).mtimeMs); } catch { /* vanished */ }
  }
  return m;
}
const changedXml = (before, after) => [...after].filter(([f, mtime]) => before.get(f) !== mtime).map(([f]) => f);

// Every test case of the JUnit files a layer created or updated; an unreadable file is skipped.
function junitCases(dir, files) {
  const out = [];
  for (const f of files) {
    try { out.push(...parseJUnit(readFileSync(join(dir, f), 'utf8'))); } catch { /* unreadable: skipped */ }
  }
  return out;
}
const failuresOf = (cases) => cases.filter((c) => c.status === 'failed').map((c) => ({ name: c.name, classname: c.classname, file: c.file, message: c.message }));

// A new log file under <root>/.baco/logs/ for one layer; null when it cannot be created.
function openLog(root, layer) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rel = `${LOGS_DIR}/run-tests-${stamp}-${process.pid}-${layer.replace(/[^\w.-]/g, '_')}.log`;
  try {
    mkdirSync(join(root, LOGS_DIR), { recursive: true });
    return { rel, fd: openSync(join(root, rel), 'w') };
  } catch (error) {
    return { rel, fd: null, error };
  }
}

// `git check-ignore -q`: 0 = ignored, 1 = not ignored, anything else = cannot tell (no warning).
const logsIgnored = (root) => spawnSync('git', ['check-ignore', '-q', `${LOGS_DIR}/x.log`], { cwd: root, stdio: 'ignore' }).status !== 1;

// Battery stamp: written by a full `--all` run (no --quick, no extra args), read by `baco merge-check`.
export const STAMP_FILE = `${LOGS_DIR}/bateria-completa.json`;

// Pathspecs of what counts as code for the battery: everything except the delivery records
// (<docs_root>/entregas/**) and the Markdown documents under <docs_root> (specs, QA files, plans).
// Markdown elsewhere may be read by the code or a test (a prompt, a fixture), so it counts.
export function codePathspecs(config) {
  const docsRoot = String(config?.docs_root ?? 'docs').replace(/\/+$/, '') || 'docs';
  return ['.', `:(exclude)${docsRoot}/entregas/**`, `:(exclude,glob)${docsRoot}/**/*.md`];
}

const gitText = (args, root) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
};

// Uncommitted changes to code (codePathspecs), leaving out what the engine and the tests write
// (.baco/logs/, the JUnit folder). When git cannot tell, the tree counts as dirty (fail safe).
function treeDirty(root, config, junitDirRel) {
  const specs = [...codePathspecs(config), `:(exclude)${LOGS_DIR}/**`];
  const junit = String(junitDirRel ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (junit && !junit.startsWith('/') && !junit.startsWith('..')) specs.push(`:(exclude)${junit}/**`);
  const out = gitText(['status', '--porcelain', '--untracked-files=all', '--', ...specs], root);
  return out === null ? true : out !== '';
}

function readStamp(root) {
  try { return JSON.parse(readFileSync(join(root, STAMP_FILE), 'utf8')); } catch { return null; }
}

function writeStamp(root, stamp) {
  mkdirSync(join(root, LOGS_DIR), { recursive: true });
  writeFileSync(join(root, STAMP_FILE), JSON.stringify(stamp, null, 2) + '\n');
}

// A failing test's whole message, blank edges trimmed, at most MESSAGE_LINES lines; the lines after
// the first are indented under the summary line.
function failureMessage(s, lang) {
  const lines = String(s ?? '').replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '').split('\n');
  if (!lines.join('').trim()) return '-';
  const shown = lines.slice(0, MESSAGE_LINES);
  if (lines.length > MESSAGE_LINES) shown.push(t(lang, 'runtests.failure_more_lines', { count: lines.length - MESSAGE_LINES }));
  return shown.map((l, i) => (i ? `      ${l}` : l.trim())).join('\n');
}
const lastLines = (s, n) => String(s ?? '').replace(/\s+$/, '').split('\n').slice(-n).join('\n');

function loadEnv(ctx, say) {
  const local = readLocalEnv(ctx.root);
  // The file of the main checkout (read from a task worktree) is named by its full path.
  const path = local.exists && local.file !== join(ctx.root, LOCAL_ENV) ? local.file : LOCAL_ENV;
  if (local.exists && local.ignored === false) say('runtests.local_env_not_ignored', { path });
  if (local.bad.length) say('runtests.local_env_bad_line', { path, lines: local.bad.join(', ') });
  return { ...process.env, ...local.vars };
}

async function runSmoke(ctx, { env, capture, say }) {
  const command = smokeCommand(ctx.config);
  if (!command) return { code: 64, data: {}, messages: [{ key: 'runtests.smoke_missing' }] };
  const limit = envSeconds('BACO_SMOKE_TIMEOUT', 300);
  say('runtests.smoke_start', { command });
  const t0 = Date.now();
  const r = await runShell(command, { cwd: ctx.root, env, capture, timeoutMs: limit * 1000 });
  const seconds = round1(Date.now() - t0);
  if (r.error) return { code: 65, data: {}, messages: [{ key: 'runtests.spawn_error', params: { layer: 'app.smoke', message: r.error.message } }] };
  const smoke = { command, exit: r.exit, timedOut: r.timedOut, seconds, output: r.output };
  if (r.timedOut) return { code: 1, data: { smoke }, messages: [{ key: 'runtests.smoke_timeout', params: { seconds: limit } }] };
  if (r.exit !== 0) return { code: 1, data: { smoke }, messages: [{ key: 'runtests.smoke_failed', params: { exit: r.exit ?? r.signal } }] };
  return { code: 0, data: { smoke }, messages: [{ key: 'runtests.smoke_ok', params: { seconds } }] };
}

// Resolves the layers to run, or returns a usage result.
function plan(args, ctx, quick) {
  const err = (key, params) => ({ error: { code: 64, data: {}, messages: [{ key, params }] } });
  const given = args.flags.layer === undefined ? [] : [].concat(args.flags.layer);
  if (given.some((v) => typeof v !== 'string')) return err('cli.usage', { usage });
  const names = given.flatMap((v) => v.split(',')).map((s) => s.trim());
  if (names.some((n) => !n) || (names.length > 0) === (args.flags.all === true)) return err('cli.usage', { usage });
  const layers = args.flags.all === true ? testLayers(ctx.config, { quick }) : [...new Set(names)];
  if (!layers.length) return err('runtests.no_layers');
  if ((args.passthrough ?? []).length && layers.length > 1) return err('runtests.extra_one_layer');
  const steps = [];
  for (const layer of layers) {
    const command = layerCommand(ctx.config, layer, quick);
    if (command === undefined) return err('runtests.unknown_layer', { layer, layers: testLayers(ctx.config, { quick: true }).join(', ') || '-' });
    if (command === null) return err('runtests.no_command', { layer, section: quick ? 'tests_quick / tests' : 'tests' });
    // `fast`: the command really is the quick one (not the fallback to `tests`).
    steps.push({ layer, command, fast: quick && command !== layerCommand(ctx.config, layer, false) });
  }
  return { steps };
}

export async function run(args, ctx) {
  const out = ctx.io?.stderr ?? process.stderr;
  const say = (key, params) => out.write(t(ctx.lang, key, params) + '\n');
  const json = args.flags.json === true;
  const capture = json;
  const extra = args.passthrough ?? [];
  const smoke = args.flags.smoke === true;
  if (args.flags.smoke !== undefined && !smoke) return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  if (args.flags.verbose !== undefined && args.flags.verbose !== true) return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  const verbose = args.flags.verbose === true;
  if (smoke && (args.flags.layer !== undefined || args.flags.all !== undefined || args.flags.quick !== undefined || verbose || extra.length)) {
    return { code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] };
  }
  const quick = args.flags.quick === true;
  const planned = smoke ? null : plan(args, ctx, quick);
  if (planned?.error) return planned.error;

  const env = loadEnv(ctx, say);
  const untrap = trapSignals();
  try {
    if (smoke) return await runSmoke(ctx, { env, capture, say });
    const queued = queuedLayers(ctx.config);
    const junitDirRel = ctx.config.tests?.junit_dir ?? '.baco/junit';
    const junitDir = resolve(ctx.root, junitDirRel);
    const timeoutMs = envSeconds('BACO_QUEUE_TIMEOUT', 3600, { allowZero: true }) * 1000;
    const pollMs = envSeconds('BACO_QUEUE_POLL_MS', 2000);
    const runs = [];
    const messages = [];
    let code = 0;
    // Without --verbose, the child output goes to a log file and only a summary is printed.
    const logging = !verbose;
    if (logging && !logsIgnored(ctx.root)) say('runtests.logs_not_ignored', { path: `${LOGS_DIR}/` });
    // A full battery (--all, no --quick, no extra args) writes the stamp; one layer with files after
    // `--`, without --quick, on the stamp's head and a clean tree, is a re-run of tests that failed.
    const fullBattery = !quick && args.flags.all === true && extra.length === 0;
    const rerun = !quick && args.flags.layer !== undefined && extra.length > 0;
    const stampBase = fullBattery || rerun ? {
      head: gitText(['rev-parse', 'HEAD'], ctx.root),
      branch: gitText(['rev-parse', '--abbrev-ref', 'HEAD'], ctx.root),
      dirty: treeDirty(ctx.root, ctx.config, junitDirRel),
    } : null;
    const batteryStart = Date.now();
    let rerunNames = { passed: [], failed: [] };
    for (const { layer, command: base, fast } of planned.steps) {
      const command = extra.length ? `${base} ${extra.map(shellQuote).join(' ')}` : base;
      let waitedMs = 0;
      if (queued.includes(layer)) {
        try {
          live.lock = await acquireQueue({
            owner: { root: ctx.root, layer }, timeoutMs, pollMs,
            onWait: (h) => say('runtests.waiting', { root: h.root ?? '?', layer: h.layer ?? '?', pid: h.pid ?? '?', since: h.started ?? '?' }),
          });
          waitedMs = live.lock.waitedMs;
        } catch (e) {
          if (e instanceof QueueBlockedError) messages.push({ key: e.reason === 'stale' ? 'runtests.queue_stale_locked' : 'runtests.queue_base_blocked', params: { layer, path: e.path } });
          else if (e instanceof QueueTimeoutError) messages.push({ key: 'runtests.queue_timeout', params: { layer, seconds: Math.round(e.waitedMs / 1000), root: e.holder?.root ?? '?', other: e.holder?.layer ?? '?', pid: e.holder?.pid ?? '?' } });
          else throw e;
          code = 65;
          break;
        }
      }
      say('runtests.start', { layer, mode: t(ctx.lang, fast ? 'runtests.mode.quick' : 'runtests.mode.full'), command });
      const before = junitSnapshot(junitDir);
      const log = logging ? openLog(ctx.root, layer) : null;
      if (log && log.fd === null) say('runtests.log_unavailable', { path: log.rel, message: log.error?.message ?? '' });
      const logFd = log?.fd ?? null;
      const t0 = Date.now();
      let r;
      try {
        r = await runShell(command, { cwd: ctx.root, env, capture: capture || logFd !== null, logFd });
      } finally {
        live.lock?.release(); live.lock = null;
        if (logFd !== null) { try { closeSync(logFd); } catch { /* already closed */ } }
      }
      const seconds = round1(Date.now() - t0);
      if (r.error) {
        messages.push({ key: 'runtests.spawn_error', params: { layer, message: r.error.message } });
        code = 65;
        break;
      }
      const changed = changedXml(before, junitSnapshot(junitDir));
      const junitWritten = changed.length > 0;
      if (!junitWritten) say('runtests.no_junit', { layer, dir: junitDirRel });
      const cases = junitCases(junitDir, changed);
      const failures = failuresOf(cases);
      const logRel = logFd !== null ? log.rel : null;
      runs.push({ layer, quick, command, exit: r.exit, junitWritten, seconds, waitedSeconds: round1(waitedMs), output: capture ? r.output : null, log: logRel, failures });
      // Names of the tests that passed and failed, for the stamp's re-run entry (one layer only).
      rerunNames = { passed: cases.filter((c) => c.status === 'passed').map((c) => c.name), failed: failures.map((f) => f.name) };
      if (r.exit === 0) messages.push({ key: 'runtests.passed', params: { layer, seconds } });
      else {
        messages.push({ key: 'runtests.failed', params: { layer, exit: r.exit ?? r.signal, seconds } });
        code = Math.max(code, 1);
        for (const f of failures.slice(0, MAX_FAILURES)) messages.push({ key: 'runtests.failure', params: { name: f.name, where: f.file ?? f.classname ?? '-', message: failureMessage(f.message, ctx.lang) } });
        if (failures.length > MAX_FAILURES) messages.push({ key: 'runtests.failures_more', params: { count: failures.length - MAX_FAILURES } });
        if (!failures.length && r.output !== null && r.output.trim()) messages.push({ key: 'runtests.output_tail', params: { layer, lines: TAIL_LINES, text: lastLines(r.output, TAIL_LINES) } });
      }
      if (logRel) messages.push({ key: 'runtests.log', params: { layer, path: logRel } });
    }
    if (stampBase?.head) {
      try {
        if (fullBattery) {
          // A layer that did not run (queue or spawn error) is recorded with exit null: never a pass.
          const layers = planned.steps.map(({ layer }) => {
            const r = runs.find((x) => x.layer === layer);
            return r ? { layer, exit: r.exit, seconds: r.seconds, failures: r.failures.map((f) => ({ name: f.name, file: f.file ?? null })) }
              : { layer, exit: null, seconds: 0, failures: [] };
          });
          writeStamp(ctx.root, {
            at: new Date().toISOString(), head: stampBase.head, branch: stampBase.branch, dirty: stampBase.dirty,
            seconds: round1(Date.now() - batteryStart), passed: layers.every((l) => l.exit === 0), layers, reruns: [],
          });
          messages.push({ key: 'runtests.stamp_written', params: { path: STAMP_FILE, head: stampBase.head.slice(0, 12) } });
        } else if (rerun && runs.length === 1 && !stampBase.dirty) {
          const stamp = readStamp(ctx.root);
          if (stamp && stamp.head === stampBase.head && Array.isArray(stamp.reruns)) {
            // merge-check counts a failed test as flaky only when a re-run shows that same name passing;
            // a re-run that selected no test has both lists empty and counts for nothing.
            stamp.reruns.push({ at: new Date().toISOString(), layer: runs[0].layer, args: [...extra], exit: runs[0].exit, passed: rerunNames.passed, failed: rerunNames.failed });
            writeStamp(ctx.root, stamp);
            messages.push({ key: 'runtests.rerun_recorded', params: { path: STAMP_FILE, layer: runs[0].layer } });
          }
        }
      } catch (error) {
        say('runtests.stamp_failed', { path: STAMP_FILE, message: error.message });
      }
    }
    return { code, data: { runs }, messages };
  } finally {
    untrap();
  }
}
