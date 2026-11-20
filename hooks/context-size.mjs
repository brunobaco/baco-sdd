#!/usr/bin/env node
// PostToolUse hook (Antigravity: PreInvocation, since its PostToolUse cannot add context): in a BACO project, measures the conversation's context from the transcript Claude
// Code hands to the hook and, past `context.handoff_at` (default 400000 tokens, or 30000 tokens before
// 80% of Claude Code's `autoCompactWindow` setting when that is smaller: Claude Code summarizes the
// conversation by itself there), tells the conductor to continue in a new conversation. It also reminds the conductor, at most
// once per 30 minutes per session, to update `## Retomada` when a task branch is open and the delivery's
// `progresso.md` has not changed for 30 minutes. Warns when the size crosses the threshold and again every further
// 100000 tokens; the last warned step is kept per session in a small file under os.tmpdir(), in a
// folder named after the user (another Linux user's folder would refuse the write). The size is the
// last main-conversation answer's input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
// Inside a subagent (Claude Code sends `agent_id` only there) it does nothing: the warning is for the
// conductor. The warning is written before the state is saved, so a state that cannot be saved never
// swallows it. Fails open: any error exits 0; it never blocks.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, DEFAULTS } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { localBranches, isAncestor } from '../skills/baco-sdd/scripts/lib/git.mjs';
import { deliveryDir } from '../skills/baco-sdd/scripts/lib/delivery.mjs';
import { effectiveLimit, readAutoCompactWindow, retomadaReminderDue, openTaskDeliveries, RETOMADA_STALE_MS } from '../skills/baco-sdd/scripts/lib/hookrules.mjs';
import { readHookInput, contextAnswer, quietAnswer } from './host.mjs';

const STEP = 100000;
const CHUNK = 64 * 1024;

const hasConfig = (dir) => existsSync(join(dir, '.baco', 'config.yaml'));

function bacoRoot(cwd) {
  if (hasConfig(cwd)) return cwd;
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return top !== '' && hasConfig(top) ? top : null;
}

function threshold(root) {
  try {
    const n = loadConfig(root).context?.handoff_at;
    if (Number.isInteger(n) && n > 0) return n;
  } catch { /* unreadable config: the default */ }
  return DEFAULTS.context.handoff_at;
}

// Size of the last answer of the main conversation, read from the end of the transcript (JSON lines).
function lastContextSize(file) {
  const fd = openSync(file, 'r');
  try {
    let pos = fstatSync(fd).size;
    let rest = Buffer.alloc(0);
    while (pos > 0) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, pos);
      const data = Buffer.concat([buf, rest]);
      // The first piece may be a partial line, unless the start of the file was reached.
      const cut = pos > 0 ? data.indexOf(0x0a) : -1;
      if (pos > 0 && cut < 0) { rest = data; continue; } // one line longer than the chunk: read on
      rest = cut >= 0 ? data.subarray(0, cut) : Buffer.alloc(0);
      const lines = (cut >= 0 ? data.subarray(cut + 1) : data).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const n = sizeOf(lines[i]);
        if (n !== null) return n;
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

// Antigravity transcript lines: each model answer is a PLANNER_RESPONSE step of the MODEL with its
// input_tokens and cache_read_tokens (a subagent writes its own transcript, never this one).
function antigravitySizeOf(line) {
  if (!line.includes('"PLANNER_RESPONSE"')) return null;
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  if (entry?.type !== 'PLANNER_RESPONSE' || entry.source !== 'MODEL') return null;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  if (!Number.isFinite(entry.input_tokens) && !Number.isFinite(entry.cache_read_tokens)) return null;
  return num(entry.input_tokens) + num(entry.cache_read_tokens);
}

function sizeOf(line) {
  const agy = antigravitySizeOf(line);
  if (agy !== null) return agy;
  if (!line.includes('"assistant"') || !line.includes('usage')) return null;
  let entry;
  try { entry = JSON.parse(line); } catch { return null; }
  if (entry?.type !== 'assistant' || entry.isSidechain) return null;
  const u = entry.message?.usage;
  if (!u || typeof u !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
}

function stateDir() {
  let who;
  try { who = userInfo().uid; } catch { who = -1; }
  if (!Number.isInteger(who) || who < 0) {
    try { who = userInfo().username; } catch { who = process.env.USER || process.env.USERNAME || 'anon'; }
  }
  return join(tmpdir(), `baco-context-size-${String(who).replace(/[^\w.-]/g, '_')}`);
}
const stateFile = (session) => join(stateDir(), `${String(session).replace(/[^\w.-]/g, '_')}.json`);

function readStep(file) {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')).step;
    return Number.isInteger(s) ? s : -1;
  } catch { return -1; }
}

const note = (size, limit, session, transcript, source = 'config', handoffAt = limit, autoCompactAt = null) => `BACO-SDD: this conversation's context is now about ${size} tokens, `
  + (source === 'autoCompactWindow'
    ? `past the effective size for continuing in a new conversation (${limit} tokens: a safety margin before about ${autoCompactAt}, `
      + `80% of the autoCompactWindow setting of Claude Code, where it summarizes the conversation by itself; `
      + `the ${handoffAt} of context.handoff_at in .baco/config.yaml would come too late). Switch soon: each step adds 10000 to 20000 tokens. `
    : `past the size set for continuing in a new conversation (${limit} tokens, context.handoff_at in .baco/config.yaml). `)
  + 'Follow the rule in the baco-sdd skill, section "Conversation size" of SKILL.md (in phases 6 and 7 also '
  + 'references/implementation.md, section 10, "Conversation size"), which says what to do in each case; never stop a step halfway. '
  + `This conversation's identifier, for the new conversation's request: session ${session} (transcript ${transcript}).`;

const CHECK_EVERY_MS = 5 * 60 * 1000;
const retomadaFile = (session) => join(stateDir(), `${String(session).replace(/[^\w.-]/g, '_')}.retomada.json`);

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

// Reminder to update `## Retomada` of `progresso.md`. Cheap when nothing is due: a state read first
// (a check at most every 5 minutes, a reminder at most every 30 per session), git only after that.
// Returns { text, save } or null; any error means no reminder.
function retomadaReminder(root, session, nowMs) {
  const file = retomadaFile(session);
  const last = readJson(file);
  if (Number.isFinite(last.checkedAt) && nowMs - last.checkedAt < CHECK_EVERY_MS) return null;
  if (Number.isFinite(last.at) && nowMs - last.at < RETOMADA_STALE_MS) return null;
  const save = (state) => {
    try {
      mkdirSync(stateDir(), { recursive: true });
      writeFileSync(file, JSON.stringify({ ...last, ...state }));
    } catch { /* state not saved: the check may repeat */ }
  };
  const open = openTaskDeliveries(localBranches(root), (b, d) => isAncestor(`refs/heads/${b}`, `refs/heads/${d}`, root));
  const config = loadConfig(root);
  for (const ent of open) {
    const progress = join(deliveryDir(root, config, ent), 'progresso.md');
    if (!existsSync(progress)) continue;
    if (retomadaReminderDue({ progressMtimeMs: statSync(progress).mtimeMs, nowMs, hasOpenTaskBranch: true, lastReminderMs: last.at ?? null })) {
      const minutes = Math.round((nowMs - statSync(progress).mtimeMs) / 60000);
      return {
        text: `BACO-SDD: ${ent} has a task branch not yet merged, but its progresso.md was last changed ${minutes} minutes ago. `
          + 'Update the `## Retomada` section now (`Atualizado em`, what is running, and the `Tarefas em andamento` table: one row per task started and not merged), '
          + 'as implementation.md, section 4 and section 10, ask; a stale Retomada misleads the next conversation after a summary or a switch.',
        save: () => save({ at: nowMs, checkedAt: nowMs }),
      };
    }
  }
  save({ checkedAt: nowMs });
  return null;
}

let hook = readHookInput(null);
let answer = '';
try {
  hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
  const cwd = hook.cwd ?? process.cwd();
  const transcript = hook.transcript;
  const session = hook.session ?? 'sem-sessao';
  if (transcript && existsSync(transcript) && !hook.subagent()) {
    const root = bacoRoot(cwd);
    if (root) {
      const notes = [];
      const saves = [];
      try {
        const handoffAt = threshold(root);
        // autoCompactWindow is a Claude Code setting; Antigravity has none BACO can read.
        const { limit, source, autoCompactAt } = effectiveLimit(handoffAt, hook.host === 'claude' ? readAutoCompactWindow(root, homedir()) : null);
        const size = lastContextSize(transcript);
        if (size !== null) {
          const file = stateFile(session);
          if (size < limit) {
            if (existsSync(file)) rmSync(file, { force: true });
          } else {
            const step = Math.floor((size - limit) / STEP);
            if (step > readStep(file)) {
              notes.push(note(size, limit, session, transcript, source, handoffAt, autoCompactAt));
              saves.push(() => {
                mkdirSync(stateDir(), { recursive: true });
                writeFileSync(file, JSON.stringify({ step, size, limit }));
              });
            }
          }
        }
      } catch { /* the size check failed: the reminder below still runs */ }
      try {
        const reminder = retomadaReminder(root, session, Date.now());
        if (reminder) { notes.push(reminder.text); saves.push(reminder.save); }
      } catch { /* fail open */ }
      // The notes are written before any state is saved, so a state that cannot be saved never swallows them.
      if (notes.length) {
        answer = `${contextAnswer(hook.host, hook.event ?? 'PostToolUse', notes.join('\n\n'))}\n`;
        process.stdout.write(answer);
      }
      for (const save of saves) {
        try { save(); } catch { /* state not saved: the warning may repeat, never be lost */ }
      }
    }
  }
} catch { /* fail open */ }
if (!answer) process.stdout.write(quietAnswer(hook.host));
process.exit(0);
