import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { makeRepo } from './helpers/tmprepo.mjs';
import { extractDeliveryFromPath, maybeSyncBoard, runBoardSyncWorker, LOCK_TTL_MS, ROUND_TIMEOUT_MS } from '../hooks/board-sync.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

const CONFIG = `tracker: [files, github]
branches:
  main: main
  integration: develop
github:
  project:
    owner: acme
    number: 7
`;
const issueUrl = (n) => `https://github.com/acme/app/issues/${n}`;
const TASK = (id, issue) => `# ${id} | Algo\n\n| Campo | Valor |\n|---|---|\n| Entrega | \`ENT-001\` |\n| Branch | \`baco/ENT-001-${id}\` |\n| Issue | ${issue} |\n`;
const PROG = (situacao = '`rodando`') => `# Progresso | ENT-001 \`app\`

- **Issue mãe:** ${issueUrl(1)}

## Retomada

- **Atualizado em:** \`2026-11-25 10:00\`
- **Situação:** ${situacao}

### Tarefas em andamento

| Tarefa | Ramo | Pasta de trabalho | Relatório | Último commit | Etapa | Revisões |
|---|---|---|---|---|---|---|
| \`T-001\` | \`baco/ENT-001-T-001\` | \`.worktrees/T-001\` | \`r.md\` | \`abc\` | construção | revisão 1 de 3 |

## Registro das tarefas

| Data/hora | Tarefa | Estado | Commits | Nota |
|---|---|---|---|---|
`;

function makeFakeGh(t, scriptBody) {
  const dir = mkdtempSync(join(tmpdir(), 'baco-fake-gh-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'gh');
  writeFileSync(bin, `#!/usr/bin/env node\n${scriptBody}\n`);
  chmodSync(bin, 0o755);
  return { bin, dir };
}

test('board --apply edits items via gh, verifies via item-list, records in quadro-ENT-001.json, and is idempotent', async (t) => {
  const repo = await makeRepo({
    '.baco/config.yaml': CONFIG,
    'docs/entregas/ENT-001-app/plano.md': '# Plano\n',
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
    'docs/entregas/ENT-001-app/tarefas/T-001.md': TASK('T-001', issueUrl(2)),
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const { bin, dir } = makeFakeGh(t, `
    const fs = require('fs');
    const stateFile = ${JSON.stringify(join(repo, '.baco/logs/fake-gh-state.json'))};
    const logFile = ${JSON.stringify(join(repo, '.baco/logs/fake-gh-calls.log'))};
    const args = process.argv.slice(2);
    fs.mkdirSync(${JSON.stringify(join(repo, '.baco/logs'))}, { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    if (args[0] === 'project' && args[1] === 'item-edit') {
      const url = args[args.indexOf('--url') + 1];
      const val = args[args.indexOf('--value') + 1];
      state[url] = val;
      fs.writeFileSync(stateFile, JSON.stringify(state));
      process.exit(0);
    }
    if (args[0] === 'project' && args[1] === 'item-list') {
      const items = Object.entries(state).map(([url, status]) => ({ content: { url }, status }));
      process.stdout.write(JSON.stringify({ items }));
      process.exit(0);
    }
    process.exit(1);
  `);
  void dir;

  const prevGh = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prevGh === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prevGh; });

  const c1 = capture();
  const code1 = await main(['board', 'ENT-001', '--apply', '--json', '--cwd', repo], c1.io);
  assert.equal(code1, 0, c1.out.stderr);
  const d1 = JSON.parse(c1.out.stdout);
  assert.equal(d1.apply, true);
  assert.equal(d1.applied.length, 2);
  assert.deepEqual(d1.applyFailed, []);
  const rec = JSON.parse(readFileSync(join(repo, '.baco/logs/quadro-ENT-001.json'), 'utf8'));
  assert.deepEqual(rec.applied, { [issueUrl(1)]: 'In progress', [issueUrl(2)]: 'In progress' });

  const callsBefore = readFileSync(join(repo, '.baco/logs/fake-gh-calls.log'), 'utf8').trim().split('\n').length;
  const c2 = capture();
  const code2 = await main(['board', 'ENT-001', '--apply', '--json', '--cwd', repo], c2.io);
  assert.equal(code2, 0);
  const callsAfter = readFileSync(join(repo, '.baco/logs/fake-gh-calls.log'), 'utf8').trim().split('\n').length;
  assert.equal(callsAfter, callsBefore, 'second --apply makes zero gh calls when nothing changed');
});

test('board --apply retries via item-add when item-edit fails, and reports read-back mismatch as failure', async (t) => {
  const repo = await makeRepo({
    '.baco/config.yaml': CONFIG,
    'docs/entregas/ENT-001-app/plano.md': '# Plano\n',
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
    'docs/entregas/ENT-001-app/tarefas/T-001.md': TASK('T-001', issueUrl(2)),
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const { bin } = makeFakeGh(t, `
    const fs = require('fs');
    const addedFile = ${JSON.stringify(join(repo, '.baco/logs/added.json'))};
    fs.mkdirSync(${JSON.stringify(join(repo, '.baco/logs'))}, { recursive: true });
    const added = fs.existsSync(addedFile) ? JSON.parse(fs.readFileSync(addedFile, 'utf8')) : {};
    const args = process.argv.slice(2);
    if (args[0] === 'project' && args[1] === 'item-add') {
      const url = args[args.indexOf('--url') + 1];
      added[url] = true;
      fs.writeFileSync(addedFile, JSON.stringify(added));
      process.exit(0);
    }
    if (args[0] === 'project' && args[1] === 'item-edit') {
      const url = args[args.indexOf('--url') + 1];
      if (url.endsWith('/1') && !added[url]) {
        process.stderr.write('item not in project\\n');
        process.exit(1);
      }
      process.exit(0);
    }
    if (args[0] === 'project' && args[1] === 'item-list') {
      // /1 matches In progress; /2 still says Backlog (mismatch)
      process.stdout.write(JSON.stringify({
        items: [
          { content: { url: ${JSON.stringify(issueUrl(1))} }, status: 'In progress' },
          { content: { url: ${JSON.stringify(issueUrl(2))} }, status: 'Backlog' },
        ],
      }));
      process.exit(0);
    }
    process.exit(1);
  `);

  const prevGh = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prevGh === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prevGh; });

  const c = capture();
  const code = await main(['board', 'ENT-001', '--apply', '--json', '--cwd', repo], c.io);
  assert.equal(code, 1);
  const d = JSON.parse(c.out.stdout);
  assert.equal(d.applied.length, 1);
  assert.equal(d.applied[0].url, issueUrl(1));
  assert.equal(d.applyFailed.length, 1);
  assert.equal(d.applyFailed[0].url, issueUrl(2));
});

test('board recognizes delivery merged into origin/<integration> even before local integration moves', async (t) => {
  const repo = await makeRepo({
    '.baco/config.yaml': CONFIG,
    'docs/entregas/ENT-001-app/plano.md': '# Plano\n',
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
    'docs/entregas/ENT-001-app/tarefas/T-001.md': TASK('T-001', issueUrl(2)),
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'checkout', '-q', '-b', 'develop');
  git(repo, 'checkout', '-q', '-b', 'baco/ENT-001');
  writeFileSync(join(repo, 'a.txt'), 'ok\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'work');
  const tip = git(repo, 'rev-parse', 'HEAD');
  // Simulate PR merged on GitHub: origin/develop points at tip, local develop is still behind.
  git(repo, 'update-ref', 'refs/remotes/origin/develop', tip);

  const c = capture();
  const code = await main(['board', 'ENT-001', '--json', '--cwd', repo], c.io);
  assert.equal(code, 0);
  const d = JSON.parse(c.out.stdout);
  assert.deepEqual(d.items.map((i) => i.status), ['Done', 'Done']);
});

test('board --apply paginates gh project item-list beyond 200 items using totalCount', async (t) => {
  const repo = await makeRepo({
    '.baco/config.yaml': CONFIG,
    'docs/entregas/ENT-001-app/plano.md': '# Plano\n',
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
    'docs/entregas/ENT-001-app/tarefas/T-001.md': TASK('T-001', issueUrl(250)),
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const { bin } = makeFakeGh(t, `
    const fs = require('fs');
    const logFile = ${JSON.stringify(join(repo, '.baco/logs/pag-calls.log'))};
    fs.mkdirSync(${JSON.stringify(join(repo, '.baco/logs'))}, { recursive: true });
    const args = process.argv.slice(2);
    fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
    if (args[0] === 'project' && args[1] === 'item-edit') process.exit(0);
    if (args[0] === 'project' && args[1] === 'item-list') {
      const limit = Number(args[args.indexOf('--limit') + 1] || 30);
      const all = [];
      for (let i = 1; i <= 250; i++) {
        const url = 'https://github.com/acme/app/issues/' + i;
        all.push({ content: { url }, status: (i === 1 || i === 250) ? 'In progress' : 'Backlog' });
      }
      process.stdout.write(JSON.stringify({ items: all.slice(0, limit), totalCount: 250 }));
      process.exit(0);
    }
    process.exit(1);
  `);

  const prevGh = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prevGh === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prevGh; });

  const c = capture();
  const code = await main(['board', 'ENT-001', '--apply', '--json', '--cwd', repo], c.io);
  assert.equal(code, 0, c.out.stderr + c.out.stdout);
  const d = JSON.parse(c.out.stdout);
  assert.equal(d.applied.length, 2);
  assert.deepEqual(d.applyFailed, []);
  const calls = readFileSync(join(repo, '.baco/logs/pag-calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const listCalls = calls.filter((a) => a[0] === 'project' && a[1] === 'item-list');
  assert.ok(listCalls.length >= 2, 'must re-query with larger limit when totalCount exceeds initial page');
  assert.equal(listCalls[listCalls.length - 1][listCalls[listCalls.length - 1].indexOf('--limit') + 1], '250');
});

async function syncRepo(t) {
  const conf = await makeRepo({
    '.baco/config.yaml': CONFIG,
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
  });
  t.after(() => rmSync(conf, { recursive: true, force: true }));
  const logDir = join(conf, '.baco/logs');
  return {
    conf,
    lockPath: join(logDir, 'quadro-sync-ENT-001.lock'),
    dirtyPath: join(logDir, 'quadro-sync-ENT-001.dirty'),
    hook: ({ now, spawnFn = () => ({ unref() {} }) }) => maybeSyncBoard({
      subagent: () => false,
      cwd: conf,
      filePath: join(conf, 'docs/entregas/ENT-001-app/progresso.md'),
    }, { nowFn: () => now(), ttlMs: 30_000, spawnFn }),
  };
}
const readLock = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('board-sync lock names a single owner (pid and random nonce) and the worker receives the nonce', async (t) => {
  const { lockPath, hook } = await syncRepo(t);
  let args = null;
  assert.equal(hook({ now: () => 1_000_000, spawnFn: (_c, a) => { args = a; return { unref() {} }; } }), true);
  const lock = readLock(lockPath);
  assert.equal(typeof lock.pid, 'number');
  assert.match(lock.nonce, /^[0-9a-f]{16,}$/);
  assert.equal(lock.at, 1_000_000);
  assert.ok(args.includes(lock.nonce), 'the nonce reaches the worker');
  // a second owner gets another nonce
  const { lockPath: lock2, hook: hook2 } = await syncRepo(t);
  hook2({ now: () => 1_000_000 });
  assert.notEqual(readLock(lock2).nonce, lock.nonce);
});

test('board-sync worker renews the lock timestamp on every round and then removes its own lock', async (t) => {
  const { conf, lockPath, dirtyPath, hook } = await syncRepo(t);
  let now = 1_000_000;
  let args = null;
  hook({ now: () => now, spawnFn: (_c, a) => { args = a; return { unref() {} }; } });
  const owner = readLock(lockPath).nonce;
  assert.equal(args.at(-1), owner);
  const seen = [];
  now = 1_010_000;
  const rounds = runBoardSyncWorker({
    entId: 'ENT-001',
    root: conf,
    owner,
    nowFn: () => now,
    execFn: () => {
      seen.push(readLock(lockPath));
      if (seen.length === 1) { writeFileSync(dirtyPath, 'x'); now += 20_000; }
      return { status: 0 };
    },
  });
  assert.equal(rounds, 2);
  assert.deepEqual(seen.map((l) => l.at), [1_010_000, 1_030_000], 'timestamp renewed at the start of each round');
  assert.ok(seen.every((l) => l.nonce === owner), 'renewing keeps the same owner');
  assert.equal(existsSync(lockPath), false, 'its own lock is removed at the end');
});

test('board-sync worker never removes a lock that expired and now belongs to another process', async (t) => {
  const { conf, lockPath, dirtyPath, hook } = await syncRepo(t);
  let now = 1_000_000;
  const spawned = [];
  hook({ now: () => now, spawnFn: (_c, a) => { spawned.push(a); return { unref() {} }; } });
  const ownerA = readLock(lockPath).nonce;
  const calls = [];
  const rounds = runBoardSyncWorker({
    entId: 'ENT-001',
    root: conf,
    owner: ownerA,
    nowFn: () => now,
    execFn: () => {
      calls.push(1);
      // A runs for longer than the TTL: the lock expires and a new edit hands the lock to B.
      now += 60_000;
      assert.equal(hook({ now: () => now, spawnFn: (_c, a) => { spawned.push(a); return { unref() {} }; } }), true, 'B takes the expired lock');
      writeFileSync(dirtyPath, 'x'); // an edit that A would otherwise re-run for
      return { status: 0 };
    },
  });
  const lockB = readLock(lockPath);
  const ownerB = lockB.nonce;
  assert.notEqual(ownerB, ownerA);
  assert.equal(lockB.at, 1_060_000, 'B lock untouched by A');
  assert.equal(calls.length, 1, 'A stops once it lost the lock instead of running beside B');
  assert.equal(rounds, 1);
  assert.equal(existsSync(dirtyPath), true, 'the dirty mark is left for B');

  // B finishes normally and removes its own lock.
  runBoardSyncWorker({ entId: 'ENT-001', root: conf, owner: ownerB, nowFn: () => now, execFn: () => ({ status: 0 }) });
  assert.equal(existsSync(lockPath), false);
});

test('board-sync long round: the lock outlives a slow board --apply, so a new edit never starts a second worker', async (t) => {
  const { conf, lockPath, dirtyPath } = await syncRepo(t);
  let now = 1_000_000;
  let spawns = 0;
  // Default TTL (no ttlMs override): what the real hook uses.
  const edit = () => maybeSyncBoard({
    subagent: () => false,
    cwd: conf,
    filePath: join(conf, 'docs/entregas/ENT-001-app/progresso.md'),
  }, { nowFn: () => now, spawnFn: () => { spawns++; return { unref() {} }; } });
  assert.equal(edit(), true);
  const owner = readLock(lockPath).nonce;
  assert.ok(ROUND_TIMEOUT_MS < LOCK_TTL_MS, 'a round is cut before the lock can expire');
  const opts = [];
  const rounds = runBoardSyncWorker({
    entId: 'ENT-001', root: conf, owner, nowFn: () => now,
    execFn: (_c, _a, o) => {
      opts.push(o);
      // Many gh calls: each round takes three minutes, far over the old 30 s.
      now += 3 * 60_000;
      if (opts.length === 1) assert.equal(edit(), false, 'the edit during the long round does not take the lock');
      return { status: 0 };
    },
  });
  assert.equal(spawns, 1, 'no second worker in parallel');
  assert.equal(rounds, 2, 'the edit during the round is picked up by the same worker');
  assert.ok(opts.every((o) => o.timeout === ROUND_TIMEOUT_MS), 'every round is bounded by the round timeout');
  assert.equal(existsSync(lockPath), false);
  assert.equal(existsSync(dirtyPath), false);
});

test('board-sync worker without an owner never adopts the nonce of the lock it finds', async (t) => {
  const { conf, lockPath, hook } = await syncRepo(t);
  hook({ now: () => 1_000_000 });
  const before = readFileSync(lockPath, 'utf8');
  let calls = 0;
  const rounds = runBoardSyncWorker({ entId: 'ENT-001', root: conf, nowFn: () => 1_001_000, execFn: () => { calls++; return { status: 0 }; } });
  assert.equal(rounds, 0);
  assert.equal(calls, 0, 'a worker without the owner nonce does not run beside the owner');
  assert.equal(readFileSync(lockPath, 'utf8'), before, 'the owner lock is left alone');
});

test('board-sync worker whose lock vanished takes it back, and a corrupt lock is not its own', async (t) => {
  const { conf, lockPath, hook } = await syncRepo(t);
  hook({ now: () => 1_000_000 });
  const owner = readLock(lockPath).nonce;
  let calls = 0;
  let during = null;
  runBoardSyncWorker({
    entId: 'ENT-001', root: conf, owner, nowFn: () => 1_005_000,
    execFn: () => {
      calls++;
      if (calls === 1) { rmSync(lockPath); writeFileSync(join(conf, '.baco/logs/quadro-sync-ENT-001.dirty'), 'x'); } else during = readLock(lockPath);
      return { status: 0 };
    },
  });
  assert.equal(calls, 2);
  assert.equal(during.nonce, owner, 'the missing lock is taken back by the same owner');
  assert.equal(existsSync(lockPath), false);
  // corrupt content: not the owner's, so it is left alone
  hook({ now: () => 5_000_000 });
  const owner2 = readLock(lockPath).nonce;
  runBoardSyncWorker({
    entId: 'ENT-001', root: conf, owner: owner2, nowFn: () => 5_001_000,
    execFn: () => { writeFileSync(lockPath, '{broken'); return { status: 0 }; },
  });
  assert.equal(readFileSync(lockPath, 'utf8'), '{broken');
});

test('board-sync hook derives root from edited filePath (not cwd), enforces short lock, caps log size, and runs via symlink', async (t) => {
  assert.equal(extractDeliveryFromPath('/proj/docs/entregas/ENT-007-teste/progresso.md'), 'ENT-007');
  assert.equal(extractDeliveryFromPath('/proj/docs/entregas/ENT-007-teste/plano.md'), null);
  assert.equal(extractDeliveryFromPath('/proj/src/app.js'), null);

  const unconf = await makeRepo({
    '.baco/config.yaml': 'tracker: [files]\n',
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
  });
  t.after(() => rmSync(unconf, { recursive: true, force: true }));
  let spawned = false;
  assert.equal(maybeSyncBoard({
    subagent: () => false,
    cwd: unconf,
    filePath: join(unconf, 'docs/entregas/ENT-001-app/progresso.md'),
  }, { spawnFn: () => { spawned = true; } }), false);
  assert.equal(spawned, false);

  const conf = await makeRepo({
    '.baco/config.yaml': CONFIG,
    'docs/entregas/ENT-001-app/progresso.md': PROG(),
  });
  t.after(() => rmSync(conf, { recursive: true, force: true }));
  const otherCwd = mkdtempSync(join(tmpdir(), 'baco-other-cwd-'));
  t.after(() => rmSync(otherCwd, { recursive: true, force: true }));

  // Pre-seed oversized quadro-sync.log (> 256 KiB) to verify log size cap
  const logDir = join(conf, '.baco/logs');
  const logPath = join(logDir, 'quadro-sync.log');
  writeFileSync(join(conf, '.baco/config.yaml'), CONFIG);
  const { mkdirSync, statSync } = await import('node:fs');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(logPath, `${'x'.repeat(100)}\n`.repeat(3000)); // ~303 KB

  assert.equal(maybeSyncBoard({
    subagent: () => true,
    cwd: otherCwd,
    filePath: join(conf, 'docs/entregas/ENT-001-app/progresso.md'),
  }, { spawnFn: () => { spawned = true; } }), false, 'subagent skipped');

  let spawnCount = 0;
  let capturedArgs = null;
  let now = 1_000_000;
  const runHook = () => maybeSyncBoard({
    subagent: () => false,
    cwd: otherCwd, // deliberately NOT the project root!
    filePath: join(conf, 'docs/entregas/ENT-001-app/progresso.md'),
  }, {
    nowFn: () => now,
    ttlMs: 30_000,
    spawnFn: (cmd, args) => { spawnCount++; capturedArgs = { cmd, args }; return { unref() {} }; },
  });

  // First call: finds root from filePath (NOT otherCwd), trims log, acquires lock, spawns worker
  assert.equal(runHook(), true);
  assert.equal(spawnCount, 1);
  assert.ok(capturedArgs);
  assert.ok(capturedArgs.args.includes('--worker'));
  assert.ok(capturedArgs.args.includes('ENT-001'));
  assert.ok(capturedArgs.args.includes(conf));
  assert.ok(statSync(logPath).size <= 128 * 1024, 'quadro-sync.log must be capped');
  const lockPath = join(logDir, 'quadro-sync-ENT-001.lock');
  const dirtyPath = join(logDir, 'quadro-sync-ENT-001.dirty');
  assert.equal(existsSync(lockPath), true, 'lock must exist while worker runs');
  assert.equal(existsSync(dirtyPath), false);

  // Second call within lock TTL: skipped (no parallel spawn), writes dirty mark so latest edit is not lost
  now += 5_000;
  assert.equal(runHook(), false);
  assert.equal(spawnCount, 1);
  assert.equal(existsSync(dirtyPath), true, 'concurrent edit while locked must write dirty mark');

  // Worker consumes dirty mark and runs a second round, deleting both lock and dirty mark when done
  const workerCalls = [];
  const rounds = runBoardSyncWorker({
    entId: 'ENT-001',
    root: conf,
    owner: capturedArgs.args.at(-1), // the nonce the hook handed to the worker
    execFn: (_cmd, args) => {
      workerCalls.push(args);
      if (workerCalls.length === 1) {
        // Simulate another edit arriving mid-run while lock is still held
        assert.equal(runHook(), false);
        assert.equal(existsSync(dirtyPath), true);
      }
      return { status: 0 };
    },
  });
  assert.equal(rounds, 2);
  assert.equal(workerCalls.length, 2);
  assert.ok(workerCalls[0].includes('board') && workerCalls[0].includes('ENT-001') && workerCalls[0].includes('--apply'));
  assert.equal(existsSync(lockPath), false, 'worker must remove lock when finished');
  assert.equal(existsSync(dirtyPath), false, 'worker must clear dirty mark when finished');

  // After worker removes lock, a new edit immediately acquires lock and spawns again
  now += 1_000;
  assert.equal(runHook(), true);
  assert.equal(spawnCount, 2);

  // Worker removes lock even if execFn throws
  assert.throws(() => runBoardSyncWorker({
    entId: 'ENT-001',
    root: conf,
    owner: capturedArgs.args.at(-1),
    execFn: () => { throw new Error('boom'); },
  }), /boom/);
  assert.equal(existsSync(lockPath), false, 'worker must remove lock even on error');

  // Symlink invocation fails open with exit 0 and writes diagnostic to stderr
  const base = mkdtempSync(join(tmpdir(), 'baco-board-hook-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const link = join(base, 'repo');
  symlinkSync(REPO_ROOT, link);
  const r = spawnSync(process.execPath, [join(link, 'hooks/board-sync.mjs')], { input: 'not-json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /baco board-sync:/);
});
