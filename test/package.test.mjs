import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frontmatter } from './helpers/content.mjs';

// The clone below reads the repo through a path that the VCS may judge as owned by someone else
// (root-owned .git in a container, a CI checkout). `safe.directory=*` goes in through the
// environment so the clone and the packaging script, which inherit it, behave the same everywhere.
// The clone's upload side is a separate process that ignores that variable, so it gets the setting
// on its own command line (`-u`, which needs `--no-local`).
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'safe.directory';
process.env.GIT_CONFIG_VALUE_0 = '*';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const readText = (p) => readFileSync(join(REPO, p), 'utf8');
const readJson = (p) => JSON.parse(readText(p));
const UNRELEASED = /^## .*(n[ãa]o lan[çc]ad|unreleased)/i;
// Drops an unreleased CHANGELOG section, as a release does when it names the version.
const dropUnreleased = (dir) => {
  const p = join(dir, 'CHANGELOG.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^## .*(?:n[ãa]o lan[çc]ad|unreleased).*\n[\s\S]*?(?=^## )/im, ''));
};
const hasUnzip = () => spawnSync('unzip', ['-v']).status === 0;

test('versions agree across plugin, marketplace, SKILL.md and CHANGELOG', () => {
  const v = readJson('.claude-plugin/plugin.json').version;
  assert.equal(readJson('.claude-plugin/marketplace.json').plugins[0].version, v);
  assert.equal(frontmatter(readText('skills/baco-sdd/SKILL.md')).data['metadata.version'], v);
  // An unreleased section ("## Próxima versão (não lançada)") may sit on top; the first released one is the version.
  const top = readText('CHANGELOG.md').split('\n').find((l) => l.startsWith('## ') && !UNRELEASED.test(l));
  assert.match(top, new RegExp(`^## ${v.replaceAll('.', '\\.')} \\(\\d{4}-\\d{2}-\\d{2}\\)$`));
});

// A fresh clone, so the result never depends on the developer's working tree.
function cloneRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baco-pkg-'));
  const r = spawnSync('git', ['clone', '--quiet', '--no-local', '-u', 'git -c safe.directory=* upload-pack', REPO, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  mkdirSync(join(dir, 'tools'), { recursive: true });
  copyFileSync(join(REPO, 'tools/package.mjs'), join(dir, 'tools/package.mjs'));
  return dir;
}
const run = (dir, args = []) => spawnSync('node', ['tools/package.mjs', ...args], { cwd: dir, encoding: 'utf8' });

test('package script builds a clean skill zip', { skip: !hasUnzip() && 'unzip not installed' }, () => {
  const dir = cloneRepo();
  try {
    dropUnreleased(dir);
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const zip = r.stdout.trim().split('\n').pop();
    const v = readJson('.claude-plugin/plugin.json').version;
    assert.ok(zip.endsWith(`dist/baco-sdd-skill-${v}.zip`), zip);
    assert.ok(existsSync(zip));
    const list = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    const files = list.filter((f) => !f.endsWith('/'));
    assert.equal(files[0], 'baco-sdd/SKILL.md');
    for (const f of ['baco-sdd/scripts/baco.mjs', 'baco-sdd/references/gates.md', 'baco-sdd/templates/pt-BR/spec.md']) {
      assert.ok(list.includes(f), `missing ${f}`);
    }
    for (const bad of ['test/', 'evals/', '.DS_Store', 'agents/', 'hooks/']) {
      assert.ok(!list.some((f) => f.includes(bad)), `unexpected ${bad}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('package script refuses a dirty skills/ tree', () => {
  const dir = cloneRepo();
  try {
    appendFileSync(join(dir, 'skills/baco-sdd/SKILL.md'), '\nsujeira\n');
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /skills\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('package script refuses a CHANGELOG whose top version differs from the plugin', () => {
  const dir = cloneRepo();
  try {
    const p = join(dir, 'CHANGELOG.md');
    dropUnreleased(dir);
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^## \d+\.\d+\.\d+/m, '## 9.9.9'));
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /versions disagree/);
    assert.match(r.stderr, /CHANGELOG\.md=9\.9\.9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('package script refuses a CHANGELOG with an unreleased section on top', () => {
  const dir = cloneRepo();
  try {
    const p = join(dir, 'CHANGELOG.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^## /m, '## Próxima versão (não lançada)\n\n- x\n\n## '));
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unreleased/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
