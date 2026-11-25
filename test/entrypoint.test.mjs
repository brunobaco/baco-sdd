import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function withSymlinkRoot(t) {
  const base = mkdtempSync(join(tmpdir(), 'baco-symlink-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const link = join(base, 'repo-link');
  symlinkSync(REPO_ROOT, link);
  return link;
}

test('isMainModule matches direct and symlinked paths and falls back when realpath fails', (t) => {
  const link = withSymlinkRoot(t);
  const realBaco = join(REPO_ROOT, 'skills/baco-sdd/scripts/baco.mjs');
  const linkBaco = join(link, 'skills/baco-sdd/scripts/baco.mjs');
  const url = pathToFileURL(realBaco).href;

  assert.equal(isMainModule(url, realBaco), true);
  assert.equal(isMainModule(url, linkBaco), true);
  assert.equal(isMainModule(url, ''), false);
  assert.equal(isMainModule(url, undefined), false);
  assert.equal(isMainModule(url, join(REPO_ROOT, 'hooks/branch-guard.mjs')), false);

  const missing = join(link, 'does-not-exist-anywhere.mjs');
  assert.equal(isMainModule(pathToFileURL(missing).href, missing), true);
});

test('baco.mjs runs when invoked through a symlinked directory', (t) => {
  const link = withSymlinkRoot(t);
  const r = spawnSync(process.execPath, [join(link, 'skills/baco-sdd/scripts/baco.mjs'), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /validate-spec/);
  assert.match(r.stdout, /merge-check/);
});

test('write-guard.mjs runs when invoked through a symlinked directory', (t) => {
  const link = withSymlinkRoot(t);
  const r = spawnSync(process.execPath, [join(link, 'hooks/write-guard.mjs')], {
    input: 'not-valid-json',
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /baco write-guard:/);
});

test('branch-guard.mjs runs when invoked through a symlinked directory', (t) => {
  const link = withSymlinkRoot(t);
  const r = spawnSync(process.execPath, [join(link, 'hooks/branch-guard.mjs')], {
    input: 'not-valid-json',
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /baco branch-guard:/);
});

test('tools/antigravity.mjs runs when invoked through a symlinked directory', (t) => {
  const link = withSymlinkRoot(t);
  const r = spawnSync(process.execPath, [join(link, 'tools/antigravity.mjs'), '--dest'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /uso: node tools\/antigravity\.mjs/);
});
