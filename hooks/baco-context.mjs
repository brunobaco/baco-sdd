#!/usr/bin/env node
// SessionStart hook: in a BACO project, tells the model to route spec work through the baco-sdd skill;
// after an automatic summary (source "compact"), also to re-read the skill, the phase reference and the Retomada.
// In Antigravity it runs for a subagent's conversation too, and says nothing there: the note is for the
// conductor. Fails open: any error exits 0 with no output (`{}` in Antigravity). Zero dependencies.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readHookInput, contextAnswer, quietAnswer } from './host.mjs';

const NOTE = 'This project is managed with BACO-SDD (.baco/config.yaml present). Requests about its specs, '
  + 'acceptance criteria (CA-*), plans, deliveries (ENT-*), tasks (T-*), tests tied to criteria, gates or the '
  + 'catalog must go through the `baco-sdd` skill: load it before acting, even if the user does not name BACO.';

// After an automatic summary (SessionStart with source "compact"), what the summary may have lost is on disk.
const AFTER_COMPACT = ' The conversation was just summarized automatically. Before the next step, re-read the '
  + '`baco-sdd` SKILL.md, the reference of the current phase and the `## Retomada` section of the current delivery\'s '
  + '`progresso.md` (with its `Tarefas em andamento` table), and continue from them, not from the summary alone.';

const hasConfig = (dir) => existsSync(join(dir, '.baco', 'config.yaml'));

let hook = readHookInput(null);
let answer = '';
try {
  let cwd = process.cwd();
  try {
    hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    if (hook.cwd) cwd = hook.cwd;
  } catch { /* garbage stdin: keep process.cwd() */ }
  if (!hook.subagent()) {
    let found = hasConfig(cwd);
    if (!found) {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      found = top !== '' && hasConfig(top);
    }
    if (found) answer = contextAnswer(hook.host, 'SessionStart', hook.compact ? NOTE + AFTER_COMPACT : NOTE);
  }
} catch { /* fail open */ }
process.stdout.write(answer ? `${answer}\n` : quietAnswer(hook.host));
process.exit(0);
