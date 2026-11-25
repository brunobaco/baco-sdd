import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

async function setupDelivery(t, { integrationMerge = 'auto', ciState = 'SUCCESS', mergeExit = 0 } = {}) {
  const repo = await makeRepo({
    '.baco/config.yaml': [
      'branches:',
      '  main: main',
      '  integration: develop',
      'manual_pending:',
      '  main: block',
      '  other: warn',
      'delivery:',
      '  target: integration',
      `  integration_merge: ${integrationMerge}`,
      '',
    ].join('\n'),
    'docs/specs/spec-a.md': '# Spec A\n\n| Versão | 1.0 |\n|---|---|\n\n- **CA-001:** Ok.\n',
    'src/a.js': 'export const a = 1;\n',
  });
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'checkout', '-q', '-b', 'develop');
  git(repo, 'checkout', '-q', '-b', 'baco/ENT-001');
  const tip = commit(repo, {
    'src/a.js': 'export const a = 2;\n',
    'docs/entregas/ENT-001-x/plano.md': '# Plano\n\n**Specs:** docs/specs/spec-a.md@1.0\n',
    'docs/entregas/ENT-001-x/progresso.md': '# Progresso\n\n## Esperando a pessoa\n\n| Item | Situação |\n|---|---|\n',
  }, 'work');
  // Stamp, trace and approved verdict on tip
  const stamp = { head: tip, dirty: false, seconds: 10, layers: [{ layer: 'unit', exit: 0, failures: [] }] };
  const trace = {
    head: tip,
    delivery: 'ENT-001',
    spec: { path: 'docs/specs/spec-a.md', version: '1.0' },
    cas: [{ ca: 'CA-001', status: 'proven', scenarios: [{ id: 'CT-001', via: 'qa', automation: 'automatizado', result: 'passed', evidence: null }] }],
    otherScenarios: [],
    orphanTests: [],
    summary: { proven: 1, failed: 0, pending: 0, uncovered: 0 },
  };
  const verdict = `# Veredito\n\n<!-- baco:parsed ${JSON.stringify({ verdict: 'aprovado', reviewedHead: tip, source: 'agent', findings: [] })} -->\n`;
  commit(repo, {
    'docs/entregas/ENT-001-x/revisao/trace-a.json': JSON.stringify(trace),
    'docs/entregas/ENT-001-x/revisao/veredito-01.md': verdict,
  }, 'review artifacts');
  const deliveryTip = git(repo, 'rev-parse', 'HEAD');
  mkdirSync(join(repo, '.baco/logs'), { recursive: true });
  const logDir = mkdtempSync(join(tmpdir(), 'baco-mc-gh-'));
  t.after(() => rmSync(logDir, { recursive: true, force: true }));
  const callsFile = join(logDir, 'calls.log');
  const bin = join(logDir, 'gh');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'view') {
  const base = ${JSON.stringify('develop')};
  process.stdout.write(JSON.stringify({
    headRefOid: ${JSON.stringify(deliveryTip)},
    baseRefName: process.env.FAKE_PR_BASE || base,
    state: 'OPEN',
    statusCheckRollup: [{ name: 'ci', status: 'COMPLETED', conclusion: ${JSON.stringify(ciState)} }],
  }));
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'merge') {
  if (${mergeExit} !== 0) { process.stderr.write('merge rejected\\n'); process.exit(${mergeExit}); }
  process.exit(0);
}
process.exit(1);
`);
  chmodSync(bin, 0o755);
  writeFileSync(join(repo, '.baco/logs/bateria-completa.json'), JSON.stringify({ ...stamp, head: deliveryTip }));
  return { repo, bin, callsFile };
}

test('merge-check --apply requires --pr', async (t) => {
  const { repo } = await setupDelivery(t);
  const c = capture();
  const code = await main(['merge-check', 'ENT-001', '--target', 'develop', '--apply', '--cwd', repo], c.io);
  assert.equal(code, 64);
});

test('merge-check --apply merges via gh pr merge --merge (no --delete-branch) when clean and auto on integration', async (t) => {
  const { repo, bin, callsFile } = await setupDelivery(t);
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const c = capture();
  const code = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c.io);
  assert.equal(code, 0, c.out.stderr + c.out.stdout);
  const d = JSON.parse(c.out.stdout);
  assert.equal(d.ok, true);
  assert.equal(d.apply, true);
  assert.equal(d.merged, true);
  const calls = readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const mergeCall = calls.find((a) => a[0] === 'pr' && a[1] === 'merge');
  assert.deepEqual(mergeCall, ['pr', 'merge', '42', '--merge']);
  assert.ok(!mergeCall.includes('--delete-branch'));
});

test('merge-check --apply refuses to merge into main, when ask, or when CI failed', async (t) => {
  for (const [label, opts, target] of [
    ['main target', { integrationMerge: 'auto' }, 'main'],
    ['ask policy', { integrationMerge: 'ask' }, 'develop'],
    ['ci failure', { integrationMerge: 'auto', ciState: 'FAILURE' }, 'develop'],
  ]) {
    const { repo, bin, callsFile } = await setupDelivery(t, opts);
    const prev = process.env.BACO_GH;
    const prevBase = process.env.FAKE_PR_BASE;
    process.env.BACO_GH = bin;
    process.env.FAKE_PR_BASE = target;
    t.after(() => {
      if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev;
      if (prevBase === undefined) delete process.env.FAKE_PR_BASE; else process.env.FAKE_PR_BASE = prevBase;
    });

    const c = capture();
    const code = await main(['merge-check', 'ENT-001', '--target', target, '--pr', '42', '--apply', '--json', '--cwd', repo], c.io);
    assert.equal(code, 2, label);
    const d = JSON.parse(c.out.stdout);
    assert.equal(d.merged, false, label);
    const calls = readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.some((a) => a[0] === 'pr' && a[1] === 'merge'), false, `${label} must never call gh pr merge`);
  }
});

test('merge-check --apply exits 1 when gh pr merge fails', async (t) => {
  const { repo, bin } = await setupDelivery(t, { mergeExit: 1 });
  const prev = process.env.BACO_GH;
  process.env.BACO_GH = bin;
  t.after(() => { if (prev === undefined) delete process.env.BACO_GH; else process.env.BACO_GH = prev; });

  const c = capture();
  const code = await main(['merge-check', 'ENT-001', '--target', 'develop', '--pr', '42', '--apply', '--json', '--cwd', repo], c.io);
  assert.equal(code, 1);
  const d = JSON.parse(c.out.stdout);
  assert.equal(d.merged, false);
  assert.match(d.applyError, /merge rejected/);
});
