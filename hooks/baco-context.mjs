#!/usr/bin/env node
// SessionStart hook: in a BACO project, tells the model to route spec work through the baco-sdd skill;
// after an automatic summary (source "compact"), also to re-read the skill, the phase reference and the Retomada.
// Fails open: any error exits 0 with no output. Zero dependencies.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const NOTE = 'This project is managed with BACO-SDD (.baco/config.yaml present). Requests about its specs, '
  + 'acceptance criteria (CA-*), plans, deliveries (ENT-*), tasks (T-*), tests tied to criteria, gates or the '
  + 'catalog must go through the `baco-sdd` skill: load it before acting, even if the user does not name BACO.';

// After an automatic summary (SessionStart with source "compact"), what the summary may have lost is on disk.
const AFTER_COMPACT = ' The conversation was just summarized automatically. Before the next step, re-read the '
  + '`baco-sdd` SKILL.md, the reference of the current phase and the `## Retomada` section of the current delivery\'s '
  + '`progresso.md` (with its `Tarefas em andamento` table), and continue from them, not from the summary alone.';

const hasConfig = (dir) => existsSync(join(dir, '.baco', 'config.yaml'));

try {
  let cwd = process.cwd();
  let compact = false;
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    if (typeof input?.cwd === 'string' && input.cwd) cwd = input.cwd;
    compact = input?.source === 'compact';
  } catch { /* garbage stdin: keep process.cwd() */ }
  let found = hasConfig(cwd);
  if (!found) {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    found = top !== '' && hasConfig(top);
  }
  if (found) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: compact ? NOTE + AFTER_COMPACT : NOTE } })}\n`);
  }
} catch { /* fail open */ }
process.exit(0);
