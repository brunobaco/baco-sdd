import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('plugin.json has name, semver version and description', () => {
  const plugin = read('.claude-plugin/plugin.json');
  assert.equal(plugin.name, 'baco');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description);
});

test('marketplace.json matches plugin.json', () => {
  const plugin = read('.claude-plugin/plugin.json');
  const market = read('.claude-plugin/marketplace.json');
  assert.equal(market.name, 'baco-sdd');
  assert.equal(market.plugins[0].name, 'baco');
  assert.equal(market.plugins[0].source, './');
  assert.equal(market.plugins[0].version, plugin.version);
});

test('package.json has no dependencies', () => {
  const pkg = read('package.json');
  assert.equal('dependencies' in pkg, false);
  assert.equal('devDependencies' in pkg, false);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22');
});

const REPO = fileURLToPath(new URL('..', import.meta.url));
const hasClaude = () => spawnSync('claude', ['--version']).status === 0;

test('plugin validates with the Claude Code CLI', { skip: !hasClaude() && 'claude CLI not installed' }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', '.', '--strict'], { cwd: REPO, encoding: 'utf8' });
  if (r.status === 0) return;
  // The only accepted warning: the root CLAUDE.md guides the developers of this repo and is
  // deliberately not plugin context. Any other warning or error still fails.
  const out = r.stdout + r.stderr;
  // Newer CLIs (2.1.326) list what the plugin provides after the warnings, with the same marker.
  const warnings = out.split(/^Provides:/m)[0].split('\n').filter((l) => /^\s*❯ /.test(l));
  const plugin = warnings.filter((l) => !/plugin directory|ICON_MISSING/.test(l));
  assert.deepEqual(plugin.map((l) => l.trim()).filter((l) => !/CLAUDE\.md at the plugin root/.test(l)), [], out);
  assert.match(out, /Found 1 warning/, out);
  assert.equal(spawnSync('claude', ['plugin', 'validate', '.'], { cwd: REPO, encoding: 'utf8' }).status, 0, out);
});
