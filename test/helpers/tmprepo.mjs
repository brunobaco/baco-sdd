import { mkdir, writeFile } from 'node:fs/promises';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTempDir } from './tmpdir.mjs';

// Isolate every git call made by the tests (helpers, test files and the engine, which inherit
// process.env) from the user's global and system git config.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

async function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    if (content === null) { rmSync(full, { force: true }); continue; }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

export async function makeRepo(files, t = null) {
  const dir = await makeTempDir('baco-', t);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Baco Test');
  git(dir, 'config', 'user.email', 'baco@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFiles(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'initial');
  return dir;
}

// Synchronous on purpose: callers get the sha directly.
export function commit(dir, files, msg) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    if (content === null) { rmSync(full, { force: true }); continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}
