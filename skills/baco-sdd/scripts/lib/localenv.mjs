// Per-machine settings for test commands: `.baco/local.env` (not versioned).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mainCheckout } from './git.mjs';

export const LOCAL_ENV = '.baco/local.env';

// `KEY=VALUE` lines; blank lines and `#` lines are skipped; an optional `export ` prefix and one pair
// of surrounding quotes are removed (no escapes, no expansion). Returns { vars, bad: [line numbers] }.
export function parseLocalEnv(text) {
  const vars = {};
  const bad = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) { bad.push(i + 1); return; }
    let value = m[2].trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1);
    vars[m[1]] = value;
  });
  return { vars, bad };
}

// Reads `<root>/.baco/local.env`; when `root` is a task worktree without one, the git-ignored file of
// the main checkout instead (it is never copied into worktrees). `file` is the file read, `ignored`
// whether git ignores it (null when it cannot be told).
export function readLocalEnv(root) {
  let base = root;
  if (!existsSync(join(base, LOCAL_ENV))) base = mainCheckout(root);
  const file = base ? join(base, LOCAL_ENV) : null;
  if (!file || !existsSync(file)) return { exists: false, file: null, vars: {}, bad: [], ignored: null };
  const { vars, bad } = parseLocalEnv(readFileSync(file, 'utf8'));
  // `git check-ignore -q`: 0 = ignored, 1 = not ignored, anything else = cannot tell.
  const r = spawnSync('git', ['check-ignore', '-q', LOCAL_ENV], { cwd: base, stdio: 'ignore' });
  const ignored = r.status === 0 ? true : r.status === 1 ? false : null;
  return { exists: true, file, vars, bad, ignored };
}
