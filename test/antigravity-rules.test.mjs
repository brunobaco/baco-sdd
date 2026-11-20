import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The read-only permission rules BACO hands to the Antigravity CLI (`--settings`). The CLI matches
// a `command(regex:...)` rule against the whole command line; these cases were also run against the
// real CLI (1.5.10) before the template was written, with the same results.
const settings = JSON.parse(readFileSync(new URL('../skills/baco-sdd/templates/antigravity/leitura.json', import.meta.url), 'utf8'));
const allow = settings.permissions.allow.map((r) => {
  const m = /^command\(regex:(.*)\)$/s.exec(r);
  assert.ok(m, `every allow rule is a command regex: ${r}`);
  return new RegExp(m[1], 's');
});
const allowed = (cmd) => allow.some((re) => re.test(cmd));

test('antigravity read rules: every allow rule is anchored and starts with a literal program name', () => {
  for (const r of settings.permissions.allow) {
    // The CLI ignored deny regexes that began with `^.*`; a literal program after `^` is the form that worked.
    assert.match(r, /^command\(regex:\^[a-z]/, r);
    assert.ok(r.endsWith('$)'), r);
  }
});

// Checked live: a personal `toolPermission: always-proceed` let a command outside the allow list run;
// the same setting in the session's `--settings` overrides it (permission lists are not merged).
test('antigravity read rules: the approval mode is pinned, so the person\'s own settings cannot widen it', () => {
  assert.equal(settings.toolPermission, 'request-review');
  assert.equal(settings.agentMode, '');
});

test('antigravity read rules: writing files and the web are denied', () => {
  for (const d of ['write_file(/)', 'read_url(*)', 'execute_url(*)', 'download_url(*)']) {
    assert.ok(settings.permissions.deny.includes(d), d);
  }
});

test('antigravity read rules: the read commands a reviewer uses are allowed', () => {
  for (const cmd of [
    'git status --short',
    'git status --porcelain --ignored --untracked-files=all -- .baco .worktrees',
    "git diff HEAD -- . ':(exclude)docs/entregas/**'",
    "git diff baco/ENT-001...baco/ENT-001-T-001 -- . ':(exclude)docs/entregas/**'",
    'git log -3 --format=%h',
    'git log -L 10,20:src/a.js',
    'git show --stat HEAD',
    'git blame -L 1,5 src/a.js',
    'git rev-parse --short HEAD',
    'ls -la',
    'ls docs/specs',
    'cat a.txt',
    'cat -n "docs/specs/pedidos.md"',
    'grep -rn hello .',
    "grep -rn --include=*.mjs 'export const' src",
    'head -n 40 src/a.js',
    'tail -n 20 src/a.js',
    'wc -l src/a.js',
    'pwd',
  ]) assert.ok(allowed(cmd), `should be allowed: ${cmd}`);
});

test('antigravity read rules: writes, chains, substitutions and other programs are not allowed', () => {
  for (const cmd of [
    'git diff --output=x1.txt HEAD',
    'git log -1 --output=x2.txt',
    'git log --ext-diff -1',
    'git show --textconv HEAD:a.txt',
    'git grep -Otouch hello',
    'git grep -n hello',
    'git commit -m x',
    'git checkout -- a.txt',
    'git -C /tmp status',
    'cat a.txt > x2.txt',
    'cat a.txt >> x2.txt',
    'cat a.txt | tee x7.txt',
    'git status; touch x3.txt',
    'cat a.txt && touch x4.txt',
    'cat a.txt || touch x4.txt',
    'cat a.txt & touch x4.txt',
    'cat $(touch x5.txt)',
    'cat "$(touch x5.txt)"',
    'ls `touch x6.txt`',
    'cat a.txt\ntouch x8.txt',
    "cat 'a.txt';touch x9.txt",
    'cat <(touch x)',
    'find . -name a.txt',
    'tail -f a.txt',
    'tail --follow a.txt',
    'touch x.txt',
    'rm a.txt',
    'sed -n 1p a.txt',
    'curl https://example.com',
    'node -e 1',
    'pwd; touch x',
  ]) assert.ok(!allowed(cmd), `should be refused: ${JSON.stringify(cmd)}`);
});
