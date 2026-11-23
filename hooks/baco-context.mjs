#!/usr/bin/env node
// SessionStart hook: in a BACO project, tells the model to route spec work through the baco-sdd skill;
// after an automatic summary (source "compact"), also to re-read the skill, the phase reference and the Retomada.
// It also tells the conductor which harness files are missing or differ from the skill's templates
// (scripts/lib/harnessfiles.mjs), so it offers to copy them now, and records the version of the running
// plugin for this session (read by context-size.mjs, which says when a newer version is installed);
// after a summary the recorded version is kept, since the conversation goes on.
// In Antigravity it runs for a subagent's conversation too, and says nothing there: the note is for the
// conductor. Fails open: any error exits 0 with no output (`{}` in Antigravity). Zero dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readHookInput, contextAnswer, quietAnswer } from './host.mjs';
import { loadConfig } from '../skills/baco-sdd/scripts/lib/config.mjs';
import { harnessFileProblems } from '../skills/baco-sdd/scripts/lib/harnessfiles.mjs';
import { hookStateDir, sessionStateFile, readPluginVersion } from '../skills/baco-sdd/scripts/lib/hookrules.mjs';

const NOTE = 'This project is managed with BACO-SDD (.baco/config.yaml present). Requests about its specs, '
  + 'acceptance criteria (CA-*), plans, deliveries (ENT-*), tasks (T-*), tests tied to criteria, gates or the '
  + 'catalog must go through the `baco-sdd` skill: load it before acting, even if the user does not name BACO.';

// After an automatic summary (SessionStart with source "compact"), what the summary may have lost is on disk.
const AFTER_COMPACT = ' The conversation was just summarized automatically. Before the next step, re-read the '
  + '`baco-sdd` SKILL.md, the reference of the current phase and the `## Retomada` section of the current delivery\'s '
  + '`progresso.md` (with its `Tarefas em andamento` table), and continue from them, not from the summary alone.';

const harnessNote = (problems) => ' Harness files: '
  + problems.map((p) => `\`${p.file}\` (for ${p.harnesses.join(', ')}) is ${p.status === 'missing' ? 'missing' : 'different from the skill template'}, template ${p.template}`).join('; ')
  + '. The calls of those harnesses refuse to run without an identical copy. Before other work, offer the person to copy '
  + 'each template to its path now (then `cmp` both), in plain words; a no leaves those harnesses out until it is copied.';

const hasConfig = (dir) => existsSync(join(dir, '.baco', 'config.yaml'));

function bacoRoot(cwd) {
  if (hasConfig(cwd)) return cwd;
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return top !== '' && hasConfig(top) ? top : null;
}

// The plugin folder this hook runs from: Claude Code's CLAUDE_PLUGIN_ROOT, or the hook's own parent folder.
const pluginRoot = (host) => (host === 'claude' && process.env.CLAUDE_PLUGIN_ROOT
  ? process.env.CLAUDE_PLUGIN_ROOT
  : resolve(dirname(fileURLToPath(import.meta.url)), '..'));

// Records the running plugin version for this session; after a summary an existing record stays.
function recordVersion(host, session, compact) {
  const file = sessionStateFile(session, '.version');
  if (compact && existsSync(file)) return;
  const started = readPluginVersion(pluginRoot(host));
  if (!started) return;
  mkdirSync(hookStateDir(), { recursive: true });
  writeFileSync(file, JSON.stringify({ started }));
}

let hook = readHookInput(null);
let answer = '';
try {
  let cwd = process.cwd();
  try {
    hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    if (hook.cwd) cwd = hook.cwd;
  } catch { /* garbage stdin: keep process.cwd() */ }
  if (!hook.subagent()) {
    const root = bacoRoot(cwd);
    if (root) {
      let text = hook.compact ? NOTE + AFTER_COMPACT : NOTE;
      try {
        const problems = harnessFileProblems(root, loadConfig(root));
        if (problems.length) text += harnessNote(problems);
      } catch { /* unreadable config: only the usual note */ }
      answer = contextAnswer(hook.host, 'SessionStart', text);
      // Without a session id there is nothing to key the record on.
      if (hook.session) {
        try { recordVersion(hook.host, hook.session, hook.compact); } catch { /* fail open */ }
      }
    }
  }
} catch { /* fail open */ }
process.stdout.write(answer ? `${answer}\n` : quietAnswer(hook.host));
process.exit(0);
