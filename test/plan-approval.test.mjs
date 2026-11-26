import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { readPlanApproval, renderPlanApproval, parsePlanApproval, criteriaHash } from '../skills/baco-sdd/scripts/lib/plan-approval.mjs';
import { resetGitBinary, gitBinaries } from '../skills/baco-sdd/scripts/lib/git.mjs';
import { messages, t as tr } from '../skills/baco-sdd/scripts/lib/messages.mjs';
import { makeTempDirSync } from './helpers/tmpdir.mjs';
import { capture, git, setupDelivery, acceptance, mergeCheck, DELIVERY, SPEC, QA, PLAN, NEW_PROGRESS } from './helpers/plan-delivery.mjs';

const PORTRAIT = `${DELIVERY}/aprovacao-plano.md`;

// 1. History of the portrait: deleting aprovacao-plano.md does not bypass the --replace protection.

test('approve-plan refuses without --replace when the portrait existed in a commit of the delivery and was deleted', async (t) => {
  const { repo } = await setupDelivery(t, { approve: true });
  git(repo, 'rm', '-q', PORTRAIT);
  git(repo, 'commit', '-q', '-m', 'drop portrait');

  const c1 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--json', '--cwd', repo], c1.io), 2, c1.out().stdout);
  const data = JSON.parse(c1.out().stdout);
  assert.equal(data.deletedInHistory.path, PORTRAIT);
  assert.match(data.deletedInHistory.commit, /^[0-9a-f]{40}$/);
  assert.equal(existsSync(join(repo, PORTRAIT)), false, 'nothing is written');

  const c2 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--cwd', repo], c2.io), 2);
  assert.ok(c2.out().stdout.includes('--replace'), c2.out().stdout);

  const c3 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--replace', '--json', '--cwd', repo], c3.io), 0, c3.out().stderr + c3.out().stdout);
  assert.equal(readPlanApproval(join(repo, DELIVERY)).by, 'Bia');
});

test('approve-plan refuses when the portrait was only deleted from the disk, and after a rename of the delivery folder', async (t) => {
  const { repo } = await setupDelivery(t, { approve: true });
  rmSync(join(repo, PORTRAIT));
  const c1 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--json', '--cwd', repo], c1.io), 2, c1.out().stdout);

  git(repo, 'add', '-A', 'docs');
  git(repo, 'mv', DELIVERY, 'docs/entregas/ENT-001-outro-nome');
  git(repo, 'commit', '-q', '-m', 'rename delivery');
  const c2 = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--json', '--cwd', repo], c2.io), 2, c2.out().stdout);
  assert.equal(JSON.parse(c2.out().stdout).deletedInHistory.path, PORTRAIT);
});

test('approve-plan records the first portrait when the delivery history never had one', async (t) => {
  const { repo } = await setupDelivery(t);
  const c = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Ana', '--json', '--cwd', repo], c.io), 0, c.out().stderr + c.out().stdout);
});

test('acceptance-report and merge-check block as a human gate when the portrait was deleted, comparing with the latest one of the history', async (t) => {
  const { repo, traces } = await setupDelivery(t, { approve: true });
  let r = await acceptance(repo, traces);
  assert.equal(r.code, 0, r.out.stdout);

  rmSync(join(repo, PORTRAIT));
  r = await acceptance(repo, traces);
  assert.equal(r.code, 2, r.out.stdout);
  assert.ok(r.data.blockers.includes('merge.plan_approval_deleted'), r.data.blockers.join());
  assert.equal(r.data.blockers.includes('merge.plan_unapproved'), false);

  // merge-check reads the portrait of the tip it merges: a deletion only on the disk is not one there.
  const deletedText = tr('pt-BR', 'merge.plan_approval_deleted', { commit: '' }).slice(0, 30);
  let m = await mergeCheck(repo);
  assert.equal(m.acceptanceCondition.ok, true, m.acceptanceCondition.detail);

  git(repo, 'add', '-A', DELIVERY);
  git(repo, 'commit', '-q', '-m', 'drop portrait');
  m = await mergeCheck(repo);
  assert.equal(m.code, 2);
  assert.equal(m.acceptanceCondition.ok, false);
  assert.ok(m.acceptanceCondition.detail.includes(deletedText), m.acceptanceCondition.detail);

  // The comparison uses the deleted portrait: a spec change since the approval shows too.
  const specPath = join(repo, 'docs/specs/spec-a.md');
  writeFileSync(specPath, readFileSync(specPath, 'utf8').replace('| Versão | 1.0 |', '| Versão | 1.1 |'));
  r = await acceptance(repo, traces);
  assert.ok(r.data.blockers.includes('merge.plan_approval_deleted'));
  assert.ok(r.data.blockers.includes('merge.plan_specs_changed'), r.data.blockers.join());
});

test('merge-check: an uncommitted portrait on the disk does not hide its deletion at the tip', async (t) => {
  const { repo, traces } = await setupDelivery(t, { approve: true });
  const saved = readFileSync(join(repo, PORTRAIT), 'utf8');
  git(repo, 'rm', '-q', PORTRAIT);
  git(repo, 'commit', '-q', '-m', 'drop portrait');
  writeFileSync(join(repo, PORTRAIT), saved); // back on the disk, never committed

  const m = await mergeCheck(repo);
  assert.equal(m.code, 2);
  assert.equal(m.acceptanceCondition.ok, false);
  assert.ok(m.acceptanceCondition.detail.includes(tr('pt-BR', 'merge.plan_approval_deleted', { commit: '' }).slice(0, 30)), m.acceptanceCondition.detail);

  // The acceptance report reads the working copy (approve-plan writes it there before the commit).
  const r = await acceptance(repo, traces);
  assert.equal(r.data.blockers.includes('merge.plan_approval_deleted'), false, r.data.blockers.join());
});

test('acceptance-report with a committed deletion of the portrait still blocks', async (t) => {
  const { repo, traces } = await setupDelivery(t, { approve: true });
  git(repo, 'rm', '-q', PORTRAIT);
  git(repo, 'commit', '-q', '-m', 'drop portrait');
  const r = await acceptance(repo, traces);
  assert.equal(r.code, 2);
  assert.ok(r.data.blockers.includes('merge.plan_approval_deleted'), r.data.blockers.join());
});

test('approve-plan fails closed (exit 65) when git stops answering during the history check', async (t) => {
  const { repo } = await setupDelivery(t, { approve: true });
  rmSync(join(repo, PORTRAIT));
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = makeTempDirSync('baco-fakegit-', t);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$*" in *show-toplevel*) exec '${realGit}' "$@";; esac\necho "xcrun: error: invalid active developer path" >&2\nexit 72\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const saved = { PATH: process.env.PATH, BACO_GIT: process.env.BACO_GIT, fallbacks: [...gitBinaries.fallbacks] };
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.BACO_GIT === undefined) delete process.env.BACO_GIT; else process.env.BACO_GIT = saved.BACO_GIT;
    gitBinaries.fallbacks = saved.fallbacks;
    resetGitBinary();
  });
  resetGitBinary();
  delete process.env.BACO_GIT;
  gitBinaries.fallbacks = [];
  process.env.PATH = `${bin}:${saved.PATH}`;
  const c = capture();
  assert.equal(await main(['approve-plan', 'ENT-001', '--by', 'Bia', '--cwd', repo], c.io), 65);
  assert.ok(c.out().stderr.includes('não respondeu'), c.out().stderr);
  assert.equal(existsSync(join(repo, PORTRAIT)), false);
});

// 2. Plan gate on and no portrait in a 1.11+ delivery.

const PLAN_NO_CUT = PLAN.replace('| `CA-002` | `fora desta entrega` |', '| `CA-002` | `T-002` |');
const QA_ALL_AUTO = QA.replace('- **Automação:** manual', '- **Automação:** automatizado');
const JUNIT_BOTH = '<testsuite><testcase classname="a" name="[CT-001] ok"/><testcase classname="a" name="[CT-002] ok"/></testsuite>\n';

test('1.11+ delivery (progresso.md with the Retomada fields) with the plan gate on and no portrait blocks as merge.plan_unapproved', async (t) => {
  const { repo, traces } = await setupDelivery(t, { plan: PLAN_NO_CUT, qa: QA_ALL_AUTO, progress: NEW_PROGRESS, junit: JUNIT_BOTH });
  const r = await acceptance(repo, traces);
  assert.equal(r.code, 2, r.out.stdout);
  assert.deepEqual(r.data.blockers, ['merge.plan_unapproved']);

  const m = await mergeCheck(repo);
  assert.equal(m.acceptanceCondition.ok, false);
  assert.ok(m.acceptanceCondition.detail.includes(tr('pt-BR', 'merge.plan_unapproved')), m.acceptanceCondition.detail);
});

test('1.11+ delivery recognized by the regressão marker blocks without a portrait; the plan gate off does not', async (t) => {
  const plan = `${PLAN_NO_CUT}\n| \`CA-003\` | \`regressão\` | \`CT-003\` | \`regra\` |\n`;
  const spec = `${SPEC}- **CA-003:** Antigo.\n`;
  const qa = `${QA_ALL_AUTO}\n### CT-003 | Antigo\n- **Contratos:** CA-003\n- **Automação:** automatizado\n`;
  const junit = JUNIT_BOTH.replace('</testsuite>', '<testcase classname="a" name="[CT-003] ok"/></testsuite>');
  const { repo, traces } = await setupDelivery(t, { plan, spec, qa, junit });
  let r = await acceptance(repo, traces);
  assert.equal(r.code, 2, r.out.stdout);
  assert.deepEqual(r.data.blockers, ['merge.plan_unapproved']);

  const off = await setupDelivery(t, { plan, spec, qa, junit, extraConfig: 'gates:\n  plan: off' });
  r = await acceptance(off.repo, off.traces);
  assert.equal(r.code, 0, r.out.stdout);
});

test('a delivery from before 1.11 (no new marker, old progresso.md) without a portrait keeps passing', async (t) => {
  const { repo, traces } = await setupDelivery(t, { plan: PLAN_NO_CUT, qa: QA_ALL_AUTO, junit: JUNIT_BOTH });
  const r = await acceptance(repo, traces);
  assert.equal(r.code, 0, r.out.stdout);
});

// 3. Real spec version, normalized hash of the CA definitions and `path#ID` keys.

test('approve-plan records the version read from the spec file, the CA hashes and the universe as path#ID', async (t) => {
  const { repo } = await setupDelivery(t, {
    approve: true,
    plan: PLAN.replace('spec-a.md@1.0', 'spec-a.md@1.0, docs/specs/spec-b.md@2.0'),
    extraSpecs: {
      'docs/specs/spec-b.md': '# Spec B\n\n| Campo | Valor |\n|---|---|\n| Versão | 2.0 |\n\n- **CA-001:** Outro.\n',
      'docs/qa/cenarios-qa-spec-b.md': '# QA\n\n### CT-001 | Outro\n- **Contratos:** CA-001\n- **Automação:** automatizado\n',
    },
  });
  const a = readPlanApproval(join(repo, DELIVERY));
  assert.deepEqual(a.specs, ['docs/specs/spec-a.md@1.0', 'docs/specs/spec-b.md@2.0']);
  assert.deepEqual(a.specVersions, ['docs/specs/spec-a.md@1.0', 'docs/specs/spec-b.md@2.0']);
  assert.deepEqual(a.universeCas, ['docs/specs/spec-a.md#CA-001', 'docs/specs/spec-a.md#CA-002', 'docs/specs/spec-b.md#CA-001']);
  assert.deepEqual(a.universeScenarios, ['docs/specs/spec-a.md#CT-001', 'docs/specs/spec-a.md#CT-002', 'docs/specs/spec-b.md#CT-001']);
  assert.deepEqual(Object.keys(a.criteria).sort(), a.universeCas);
  assert.match(a.criteria['docs/specs/spec-a.md#CA-001'], /^[0-9a-f]{16}$/);
  assert.notEqual(a.criteria['docs/specs/spec-a.md#CA-001'], a.criteria['docs/specs/spec-b.md#CA-001']);
});

test('criteriaHash changes with the content only, not with spacing or line breaks', () => {
  const h = (text) => criteriaHash([{ text }]);
  assert.equal(h('**CA-001:** O valor   aparece no\n  extrato.'), h('**CA-001:** O valor aparece no extrato.'));
  assert.equal(h('CA-001 |  O valor | ok '), h('CA-001 | O valor | ok'));
  assert.notEqual(h('**CA-001:** O valor aparece no extrato.'), h('**CA-001:** O valor some do extrato.'));
});

test('spec file version bump with the plan header untouched blocks as merge.plan_specs_changed', async (t) => {
  const { repo, traces } = await setupDelivery(t, { approve: true });
  writeFileSync(join(repo, 'docs/specs/spec-a.md'), SPEC.replace('| Versão | 1.0 |', '| Versão | 1.1 |'));
  const r = await acceptance(repo, traces);
  assert.equal(r.code, 2, r.out.stdout);
  assert.ok(r.data.blockers.includes('merge.plan_specs_changed'), r.data.blockers.join());
});

test('a changed CA text blocks as merge.plan_criteria_changed; re-spacing it does not', async (t) => {
  const { repo, traces } = await setupDelivery(t, { approve: true });
  const specPath = join(repo, 'docs/specs/spec-a.md');
  writeFileSync(specPath, SPEC.replace('- **CA-001:** Ok.', '- **CA-001:**    Ok.\n  '));
  let r = await acceptance(repo, traces);
  assert.equal(r.code, 0, r.out.stdout);

  writeFileSync(specPath, SPEC.replace('- **CA-001:** Ok.', '- **CA-001:** Ok, com outra regra.'));
  r = await acceptance(repo, traces);
  assert.equal(r.code, 2, r.out.stdout);
  assert.ok(r.data.blockers.includes('merge.plan_criteria_changed'), r.data.blockers.join());
  const report = readFileSync(join(repo, DELIVERY, 'aceite.md'), 'utf8');
  assert.ok(report.includes('docs/specs/spec-a.md#CA-001'), report);

  const m = await mergeCheck(repo);
  assert.equal(m.acceptanceCondition.ok, false);
});

test('the universe is checked per spec: a CA removed from one spec is caught even when another spec has the same ID', async (t) => {
  const specB = '# Spec B\n\n| Campo | Valor |\n|---|---|\n| Versão | 2.0 |\n\n- **CA-002:** Mesmo número em outra spec.\n';
  const { repo, traces } = await setupDelivery(t, {
    approve: true,
    plan: `${PLAN.replace('spec-a.md@1.0', 'spec-a.md@1.0, docs/specs/spec-b.md@2.0')}\n| \`CA-002\` | \`T-003\` | \`-\` | \`regra\` |\n`.replace('| `CA-002` | `fora desta entrega` | `CT-002` | `-` |\n', ''),
    qa: QA_ALL_AUTO,
    extraSpecs: {
      'docs/specs/spec-b.md': specB,
      'docs/qa/cenarios-qa-spec-b.md': '# QA\n\n### CT-009 | B\n- **Contratos:** CA-002\n- **Automação:** automatizado\n',
    },
  });
  writeFileSync(join(repo, 'docs/specs/spec-a.md'), SPEC.replace('- **CA-002:** Futuro.\n', ''));
  const r = await acceptance(repo, traces);
  assert.ok(r.data.blockers.includes('merge.plan_universe_shrank'), r.data.blockers.join());
  const report = readFileSync(join(repo, DELIVERY, 'aceite.md'), 'utf8');
  assert.ok(report.includes('docs/specs/spec-a.md#CA-002'), report);
  assert.equal(report.includes('docs/specs/spec-b.md#CA-002'), false);
});

test('a 1.11.0 portrait (IDs only, no spec file versions nor CA hashes) is still read and compared by ID', async (t) => {
  const { repo, traces, dir } = await setupDelivery(t);
  // What 1.11.0 wrote: renderPlanApproval without the new fields and with bare IDs.
  const legacy = renderPlanApproval({
    entId: 'ENT-001', by: 'Ana', gate: 'on', date: '2026-11-20 10:00 (UTC)',
    specs: ['docs/specs/spec-a.md@1.0'], universeCas: ['CA-001', 'CA-002'], universeScenarios: ['CT-001', 'CT-002'],
    outOfScope: ['CA-002'], outOfScopeScenarios: [],
  });
  const parsed = parsePlanApproval(legacy);
  assert.equal(parsed.specVersions, null);
  assert.equal(parsed.criteria, null);
  writeFileSync(join(dir, 'aprovacao-plano.md'), legacy);
  let r = await acceptance(repo, traces);
  assert.equal(r.code, 0, r.out.stdout);

  writeFileSync(join(repo, 'docs/specs/spec-a.md'), SPEC.replace('- **CA-002:** Futuro.\n', ''));
  r = await acceptance(repo, traces);
  assert.ok(r.data.blockers.includes('merge.plan_universe_shrank'), r.data.blockers.join());
});

test('the new messages exist in pt-BR and en', () => {
  for (const key of ['approve_plan.deleted_in_history', 'merge.plan_approval_deleted', 'merge.plan_unapproved', 'merge.plan_criteria_changed']) {
    assert.ok(messages['pt-BR'][key], key);
    assert.ok(messages.en[key], key);
  }
});
