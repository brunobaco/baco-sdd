import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { scanTestDiff, globToRegExp } from '../skills/baco-sdd/scripts/commands/guard-tests.mjs';
import { makeRepo, commit } from './helpers/tmprepo.mjs';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const guard = async (dir, ...extra) => {
  const { io, out } = capture();
  const code = await main(['guard-tests', '--json', '--cwd', dir, ...extra], io);
  let data = null;
  try { data = JSON.parse(out.stdout); } catch { /* not json */ }
  return { code, data, out };
};

const TEST_V1 = "it('[CA-001] adds', () => {\n  assert.equal(add(1, 1), 2);\n});\n";
const TEST_V2 = "it('[CA-001] adds', () => {\n  assert.ok(true);\n});\n";

test('globToRegExp supports **, * and ?', () => {
  const re = (p) => globToRegExp(p);
  assert.ok(re('**/*.test.*').test('a.test.js'));
  assert.ok(re('**/*.test.*').test('src/deep/a.test.ts'));
  assert.ok(!re('**/*.test.*').test('src/a.js'));
  assert.ok(re('**/e2e/**').test('e2e/x.js'));
  assert.ok(re('**/e2e/**').test('app/e2e/x/y.js'));
  assert.ok(re('.maestro/**').test('.maestro/flow.yaml'));
  assert.ok(!re('*.js').test('a/b.js'));
  assert.ok(re('a?.js').test('ab.js'));
  assert.ok(!re('a?.js').test('a/.js'));
});

test('scanTestDiff reports line numbers and ignores non-test files', () => {
  const patch = [
    'diff --git a/t.test.js b/t.test.js', '--- a/t.test.js', '+++ b/t.test.js',
    '@@ -1,3 +1,3 @@', " it('[CA-001][CA-002] x', () => {", '-  expect(1).toBe(1);', '+  expect(1).toBe(2);', ' });',
    '@@ -10,2 +10,3 @@', " ctx", "-// [CA-001] old", "+it.skip('y', () => {});",
    'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +1 @@', '-// [CA-009] x', '+// y', '',
  ].join('\n');
  const f = scanTestDiff(patch, (p) => p.endsWith('.test.js'), new Set(['CA-002']));
  assert.deepEqual(f, [
    { code: 'TAGGED_TEST_CHANGED', path: 't.test.js', id: 'CA-001', line: 11 },
    { code: 'SKIP_ADDED', path: 't.test.js', line: 11 },
  ]);
});

test('editing an assertion inside a [CA-001] test exits 2; --allow CA-001 exits 0', async () => {
  const dir = await makeRepo({ 'src/a.test.js': TEST_V1 });
  commit(dir, { 'src/a.test.js': TEST_V2 }, 'weaken');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id, f.path, f.line]), [['TAGGED_TEST_CHANGED', 'CA-001', 'src/a.test.js', 2]]);
  const ok = await guard(dir, '--base', 'HEAD~1', '--allow', 'CA-001');
  assert.equal(ok.code, 0);
  assert.deepEqual(ok.data.findings, []);
});

test('an added line inside a tagged test is flagged; untagged test and new tagged tests are not', async () => {
  const before = TEST_V1 + "it('plain', () => {\n  assert.equal(2, 2);\n});\n";
  const dir = await makeRepo({ 'a.test.js': before });
  commit(dir, { 'a.test.js': before.replace('assert.equal(add(1, 1), 2);', 'assert.equal(add(1, 1), 2);\n  if (false) return;') }, 'insert');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.deepEqual(r.data.findings.map((f) => [f.id, f.line]), [['CA-001', 3]]);
  const dir2 = await makeRepo({ 'a.test.js': before });
  commit(dir2, { 'a.test.js': before.replace('assert.equal(2, 2);', 'assert.equal(3, 3);') + "it('[CA-009] new', () => {\n  assert.ok(1);\n});\n" }, 'untagged change + new test');
  const r2 = await guard(dir2, '--base', 'HEAD~1');
  assert.equal(r2.code, 0);
  assert.deepEqual(r2.data.findings, []);
});

// End-to-end test, round D: a helper written after the last test of a file was attributed to that
// test and stopped the run for a human with no test changed.
test('a top-level helper appended after the last tagged test is not attributed to it', async () => {
  const before = "import { test } from '@playwright/test';\n\n"
    + "test('[CT-001] first', async ({ page }) => {\n  await page.goto('/');\n});\n\n"
    + "test('[CT-002] last', async ({ page }) => {\n  await expect(page.getByText('ok')).toBeVisible();\n});\n";
  const helper = "\nfunction seed(page) {\n  return page.evaluate(() => {\n    localStorage.clear();\n  });\n}\n";
  const dir = await makeRepo({ 'tests/e2e/x.spec.mjs': before });
  commit(dir, { 'tests/e2e/x.spec.mjs': before + helper }, 'helper after the last test');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 0, JSON.stringify(r.data.findings));
  assert.deepEqual(r.data.findings, []);

  // The same inside a describe: a helper after the last test of the block is not inside that test.
  const nested = "describe('[CA-001] block', () => {\n  it('[CT-003] a', () => {\n    assert.ok(1);\n  });\n});\n";
  const dir2 = await makeRepo({ 'a.test.js': nested });
  commit(dir2, { 'a.test.js': nested.replace('  });\n});', "  });\n\n  const h = () => {\n    return 2;\n  };\n});") }, 'helper in describe');
  const r2 = await guard(dir2, '--base', 'HEAD~1');
  assert.deepEqual(r2.data.findings.map((f) => f.id), ['CA-001'], 'still inside the describe, not inside the test');

  // A one-line test closes on its own line.
  const oneLine = "it('[CT-004] one', () => assert.ok(1));\n";
  const dir3 = await makeRepo({ 'a.test.js': oneLine });
  commit(dir3, { 'a.test.js': oneLine + "function h() {\n  return 1;\n}\n" }, 'helper after a one-line test');
  assert.deepEqual((await guard(dir3, '--base', 'HEAD~1')).data.findings, []);
});

test('a changed line inside a tagged test is still flagged after an inner block or template text at a lower indent', async () => {
  const before = "test('[CT-001] page', async ({ page }) => {\n  if (x) {\n    y();\n  }\n  await page.setContent(`\n<p>oi</p>\n`);\n  await expect(page.getByText('oi')).toBeVisible();\n});\n";
  const dir = await makeRepo({ 'tests/e2e/x.spec.mjs': before });
  commit(dir, { 'tests/e2e/x.spec.mjs': before.replace("toBeVisible();\n});", "toBeAttached();\n});") }, 'weaken');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id]), [['TAGGED_TEST_CHANGED', 'CT-001']]);
});

// PR review of round D fixes: the end of a test is where its call's parentheses balance, read with
// strings, templates and comments, not the first closing-looking line.
test('a weakened assertion after a column-zero brace in a template, an options object or a comment with ")" is still flagged', async () => {
  const cases = {
    template: "test('[CT-001] css', async ({ page }) => {\n  await page.addStyleTag({ content: `\nbody {\n  color: red;\n}\n` });\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    options: "test('[CT-001] tagged', {\n  tag: '@smoke',\n}, async ({ page }) => {\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    comment: "test('[CT-001] note', async ({ page }) => { // see (a)\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    blockComment: "test('[CT-001] block', async ({ page }) => { /* ) */\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    // Round 2: parentheses inside regex literals are not code.
    regexClass: "test('[CT-001] regex', async ({ page }) => {\n  const closing = /[)]/;\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    regexEscape: "test('[CT-001] regex', async ({ page }) => {\n  expect(text).toMatch(/a\\)b/);\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    regexReturn: "test('[CT-001] regex', async ({ page }) => {\n  const f = () => { return /)/.test(x); };\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    regexLineStart: "test('[CT-001] regex', async ({ page }) => {\n  const ok = [\n    /)/,\n  ];\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    // Round 3: the lexer guesses wrong; the indentation rule keeps the test open.
    regexAfterParen: "test('[CT-001] regex', async ({ page }) => {\n  if (ready) /[)]/.test(text);\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    divisionAfterComment: "test('[CT-001] div', async ({ page }) => {\n  const ratio = total /* bytes */ / (\n    count + 1\n  );\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    divisionAfterNumber: "test('[CT-001] div', async ({ page }) => {\n  const ratio = 10 / (\n    count + 1\n  );\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    // Round 4: the lexical reading misreads the division and the template holds a column-zero `const`.
    bothReadings: "test('[CT-001] page', async ({ page }) => {\n  const ratio = total /* bytes */ / (\n    count + 1\n  );\n  await page.setContent(`\n<p id=\"out\"></p>\n<script>\nconst n = 5;\ndocument.getElementById('out').textContent = String(n);\n</script>\n`);\n  await expect(page.locator('body')).toBeVisible();\n});\n",
    blockCommentDecl: "test('[CT-001] note', async ({ page }) => {\n  const ratio = total /* bytes */ / (\n    count + 1\n  );\n/*\nfunction old() {}\n*/\n  await expect(page.locator('body')).toBeVisible();\n});\n",
  };
  for (const [name, before] of Object.entries(cases)) {
    const dir = await makeRepo({ 'tests/e2e/x.spec.mjs': before });
    commit(dir, { 'tests/e2e/x.spec.mjs': before.replace('toBeVisible()', 'toBeAttached()') }, 'weaken');
    const r = await guard(dir, '--base', 'HEAD~1');
    assert.equal(r.code, 2, name);
    assert.deepEqual(r.data.findings.map((f) => [f.code, f.id]), [['TAGGED_TEST_CHANGED', 'CT-001']], name);
  }
});

// Round 4: `}, 10000);` (a timeout after the callback) closes the test; a hook after it is outside.
test('a test closing with a timeout argument does not own the hook written after it', async () => {
  const before = "test('[CA-001] slow', async () => {\n  expect(await slow()).toBe(1);\n}, 10000);\n\nafterEach(() => {\n  cleanup('old');\n});\n";
  const dir = await makeRepo({ 'a.test.js': before });
  commit(dir, { 'a.test.js': before.replace("cleanup('old')", "cleanup('new')") }, 'hook');
  assert.deepEqual((await guard(dir, '--base', 'HEAD~1')).data.findings, []);
  const opts = "test('[CA-001] slow', async () => {\n  expect(await slow()).toBe(1);\n}, { timeout: 10000 });\n\nafterEach(() => {\n  cleanup('old');\n});\n";
  const dir2 = await makeRepo({ 'a.test.js': opts });
  commit(dir2, { 'a.test.js': opts.replace("cleanup('old')", "cleanup('new')") }, 'hook');
  assert.deepEqual((await guard(dir2, '--base', 'HEAD~1')).data.findings, []);
});

// Round 5: a regex with `/*` or a backtick inside must not open a phantom comment or template.
test('a regex with a comment or template character does not keep the test open over the next hook', async () => {
  for (const re of ['/[/*]/', '/`/']) {
    const before = `test('[CA-001] text', () => {\n  expect(x).not.toMatch(${re});\n});\n\nafterEach(() => {\n  vi.restoreAllMocks();\n});\n`;
    const dir = await makeRepo({ 'a.test.js': before });
    commit(dir, { 'a.test.js': before.replace('vi.restoreAllMocks()', 'vi.clearAllMocks()') }, 'hook');
    assert.deepEqual((await guard(dir, '--base', 'HEAD~1')).data.findings, [], re);
  }
});

test('division is not read as a regex: a helper after a test with a division is still outside it', async () => {
  const before = "test('[CT-001] div', () => {\n  const half = total / 2 + (a) / (b);\n  expect(half).toBe(1);\n});\n";
  const dir = await makeRepo({ 'a.test.js': before });
  commit(dir, { 'a.test.js': before + "\nfunction h() {\n  return 1;\n}\n" }, 'helper');
  assert.deepEqual((await guard(dir, '--base', 'HEAD~1')).data.findings, []);
});

test('SKIP_ADDED covers modifier chains and x/f aliases without false positives', async () => {
  const cases = ["it.skip.each([1])('x', () => {});", "it.concurrent.skip('x', () => {});", "xtest('x', () => {});", "fit('x', () => {});", "describe.only('x', () => {});"];
  for (const line of cases) {
    const dir = await makeRepo({ 'a.test.js': "it('x', () => {});\n" });
    commit(dir, { 'a.test.js': `it('x', () => {});\n${line}\n` }, 'skip');
    const r = await guard(dir, '--base', 'HEAD~1');
    assert.deepEqual(r.data.findings.map((f) => f.code), ['SKIP_ADDED'], line);
  }
  const dir = await makeRepo({ 'a.test.js': "it('x', () => {});\n" });
  commit(dir, { 'a.test.js': "it('x', () => {});\nskipLink();\ndoNotSkip();\nmodel.fit(data);\n" }, 'benign');
  assert.equal((await guard(dir, '--base', 'HEAD~1')).code, 0);
});

test('changing the title line of a tagged test is flagged', async () => {
  const dir = await makeRepo({ 'a.test.js': TEST_V1 });
  commit(dir, { 'a.test.js': TEST_V1.replace('adds', 'sums') }, 'rename title');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.equal(r.data.findings[0].id, 'CA-001');
});

test('adding it.skip( is SKIP_ADDED even without tags', async () => {
  const dir = await makeRepo({ 'a.test.js': "it('x', () => {});\n" });
  commit(dir, { 'a.test.js': "it('x', () => {});\nit.skip('y', () => {});\n" }, 'skip');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.line]), [['SKIP_ADDED', 2]]);
});

test('deleting a test file with [CT-EMP-001] is TAGGED_TEST_DELETED, one per ID', async () => {
  const dir = await makeRepo({ 'e2e/x.js': "test('[CT-EMP-001][CT-EMP-002] flow', () => {});\n", 'keep.js': 'x\n' });
  commit(dir, { 'e2e/x.js': null }, 'rm');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id, f.path]), [
    ['TAGGED_TEST_DELETED', 'CT-EMP-001', 'e2e/x.js'],
    ['TAGGED_TEST_DELETED', 'CT-EMP-002', 'e2e/x.js'],
  ]);
  const ok = await guard(dir, '--base', 'HEAD~1', '--allow', 'CT-EMP-001', '--allow', 'CT-EMP-002');
  assert.equal(ok.code, 0);
});

test('a non-test file with [CA-001] in a comment yields no finding', async () => {
  const dir = await makeRepo({ 'src/a.js': '// [CA-001] note\n' });
  commit(dir, { 'src/a.js': '// changed\n' }, 'edit');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 0);
});

test('renamed test file is scanned as modified', async () => {
  const pad = Array.from({ length: 12 }, (_, i) => `// filler ${i}\n`).join('');
  const dir = await makeRepo({ 'a.test.js': pad + TEST_V1 });
  commit(dir, { 'a.test.js': null, 'b.test.js': pad + TEST_V2.replace('adds', 'sums') }, 'rename+weaken');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.path, f.id]), [['TAGGED_TEST_CHANGED', 'b.test.js', 'CA-001']]);
});

const SPEC = (text) => `# Spec\n\n## Critérios de aceite\n\n- **CA-001:** ${text}\n- **CA-002:** outro\n`;

test('--allow-from-spec allows changed CAs and, via the QA file, CTs that list them', async () => {
  const qa = '# QA\n\n### CT-001: cenario\n\n- **Contratos:** CA-001\n';
  const dir = await makeRepo({
    'docs/specs/spec-emp.md': SPEC('antigo'),
    'docs/qa/cenarios-qa-spec-emp.md': qa,
    'a.test.js': "it('[CT-001] x', () => {\n  assert.equal(1, 1);\n});\n",
    'b.test.js': "it('[CA-001] y', () => {\n  assert.equal(1, 1);\n});\n",
    'c.test.js': "it('[CA-002] z', () => {\n  assert.equal(1, 1);\n});\n",
  });
  commit(dir, {
    'docs/specs/spec-emp.md': SPEC('novo'),
    'a.test.js': "it('[CT-001] x', () => {\n  assert.equal(1, 2);\n});\n",
    'b.test.js': "it('[CA-001] y', () => {\n  assert.equal(1, 2);\n});\n",
    'c.test.js': "it('[CA-002] z', () => {\n  assert.equal(1, 2);\n});\n",
  }, 'spec change');
  const bare = await guard(dir, '--base', 'HEAD~1');
  assert.deepEqual(bare.data.findings.map((f) => f.id).sort(), ['CA-001', 'CA-002', 'CT-001']);
  const r = await guard(dir, '--base', 'HEAD~1', '--allow-from-spec', 'docs/specs/spec-emp.md@HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.path, f.id]), [['c.test.js', 'CA-002']]);
  const r2 = await guard(dir, '--base', 'HEAD~1', '--allow-from-spec', 'docs/specs/spec-emp.md@HEAD~1', '--allow', 'CA-002');
  assert.equal(r2.code, 0);
});

test('--allow-from-spec without a QA file allows only CA IDs; bad ref exits 65; no @ exits 64', async () => {
  const dir = await makeRepo({ 'docs/specs/spec-x.md': SPEC('a'), 'a.test.js': "it('x', () => {\n  a(); // [CA-001]\n});\n" });
  commit(dir, { 'docs/specs/spec-x.md': SPEC('b'), 'a.test.js': "it('x', () => {\n  b();\n});\n" }, 'c');
  assert.equal((await guard(dir, '--base', 'HEAD~1', '--allow-from-spec', 'docs/specs/spec-x.md@HEAD~1')).code, 0);
  assert.equal((await guard(dir, '--base', 'HEAD~1', '--allow-from-spec', 'docs/specs/spec-x.md@nope')).code, 65);
  assert.equal((await guard(dir, '--base', 'HEAD~1', '--allow-from-spec', 'docs/specs/spec-x.md')).code, 64);
});

test('guard-tests requires --base (64) and bad base is 65', async () => {
  const dir = await makeRepo({ 'a.md': 'x' });
  assert.equal((await guard(dir)).code, 64);
  assert.equal((await guard(dir, '--base', 'nope')).code, 65);
});

test('text output lists findings in pt-BR', async () => {
  const dir = await makeRepo({ 'a.test.js': "it('x', () => {});\n" });
  commit(dir, { 'a.test.js': "it.only('x', () => {});\n" }, 'only');
  const { io, out } = capture();
  assert.equal(await main(['guard-tests', '--base', 'HEAD~1', '--cwd', dir], io), 2);
  assert.match(out.stdout, /a\.test\.js/);
});

// C2: a tagged test file renamed/moved to a non-test path, or replaced by another file type, must not pass.
const TAGGED = "it('[CA-001][CA-002] adds', () => {\n  assert.equal(add(1, 1), 2);\n});\n";
const ids = (r) => r.data.findings.map((f) => [f.code, f.id, f.path]);

test('C2: renaming a tagged test to a non-test name is TAGGED_TEST_DELETED per ID', async () => {
  // With the default glob `**/*.test.*`, `a.test.js.disabled` still counts as a test path, so the
  // runner-facing patterns are narrowed here (see the fix report: default-pattern concern).
  const dir = await makeRepo({ '.baco/config.yaml': 'tests:\n  patterns: ["**/*.test.js"]\n', 'src/a.test.js': TAGGED });
  commit(dir, { 'src/a.test.js': null, 'src/a.test.js.disabled': TAGGED }, 'disable');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(ids(r), [['TAGGED_TEST_DELETED', 'CA-001', 'src/a.test.js'], ['TAGGED_TEST_DELETED', 'CA-002', 'src/a.test.js']]);
  assert.equal((await guard(dir, '--base', 'HEAD~1', '--allow', 'CA-001', '--allow', 'CA-002')).code, 0);
});

test('C2: moving a tagged test to a non-test path (also with edits) is TAGGED_TEST_DELETED', async () => {
  const dir = await makeRepo({ 'src/a.test.js': TAGGED });
  commit(dir, { 'src/a.test.js': null, 'old/a.txt': TAGGED }, 'move');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(ids(r), [['TAGGED_TEST_DELETED', 'CA-001', 'src/a.test.js'], ['TAGGED_TEST_DELETED', 'CA-002', 'src/a.test.js']]);
  const pad = Array.from({ length: 12 }, (_, i) => `// filler ${i}\n`).join('');
  const dir2 = await makeRepo({ 'src/b.test.js': pad + TAGGED });
  commit(dir2, { 'src/b.test.js': null, 'old/b.txt': pad + TAGGED.replace('2);', '3);') }, 'move+edit');
  const r2 = await guard(dir2, '--base', 'HEAD~1');
  assert.equal(r2.code, 2);
  assert.deepEqual(ids(r2), [['TAGGED_TEST_DELETED', 'CA-001', 'src/b.test.js'], ['TAGGED_TEST_DELETED', 'CA-002', 'src/b.test.js']]);
});

test('C2: replacing a tagged test file by a symlink (type change) is TAGGED_TEST_DELETED', async () => {
  const dir = await makeRepo({ 'src/a.test.js': TAGGED, 'src/empty.js': '' });
  execFileSync('git', ['rm', '-q', 'src/a.test.js'], { cwd: dir });
  symlinkSync('empty.js', join(dir, 'src/a.test.js'));
  commit(dir, {}, 'typechange');
  assert.match(execFileSync('git', ['diff', '--name-status', 'HEAD~1', 'HEAD'], { cwd: dir, encoding: 'utf8' }), /^T\s/m);
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id]), [['TAGGED_TEST_DELETED', 'CA-001'], ['TAGGED_TEST_DELETED', 'CA-002']]);
});

// I10: test patterns come from the base config too; changing the tests section needs the gate.
test('I10: narrowing tests.patterns in the same change does not hide a weakened tagged test', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'tests:\n  patterns: ["checks/**"]\n', 'checks/a.js': TAGGED });
  commit(dir, { '.baco/config.yaml': 'tests:\n  patterns: ["nothing/**"]\n', 'checks/a.js': TAGGED.replace('2);', '3);') }, 'narrow + weaken');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id ?? null]), [
    ['CONFIG_TESTS_CHANGED', null], ['TAGGED_TEST_CHANGED', 'CA-001'], ['TAGGED_TEST_CHANGED', 'CA-002'],
  ]);
});

test('I10: CONFIG_TESTS_CHANGED only when the tests section differs', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'language: pt-BR\ntests:\n  patterns: ["**/*.test.*"]\n' });
  commit(dir, { '.baco/config.yaml': 'language: en\ntests:\n  patterns: ["**/*.test.*"]\n' }, 'lang only');
  assert.equal((await guard(dir, '--base', 'HEAD~1')).code, 0);
  commit(dir, { '.baco/config.yaml': 'language: en\ntests:\n  patterns: ["**/*.test.*"]\n  junit_dir: out\n' }, 'tests section');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings, [{ code: 'CONFIG_TESTS_CHANGED', path: '.baco/config.yaml', line: null }]);
  const fresh = await makeRepo({ 'a.md': 'x' });
  commit(fresh, { '.baco/config.yaml': 'tests:\n  patterns: ["x/**"]\n' }, 'new config');
  assert.deepEqual((await guard(fresh, '--base', 'HEAD~1')).data.findings.map((f) => f.code), ['CONFIG_TESTS_CHANGED']);
});

test('CONFIG_TESTS_CHANGED also fires when tests_quick or app.smoke changes, not on other app keys', async () => {
  const cfg = (extra) => `tests:\n  unit: "u"\n${extra}`;
  const dir = await makeRepo({ '.baco/config.yaml': cfg('') });
  commit(dir, { '.baco/config.yaml': cfg('tests_quick:\n  unit: "u --fast"\n') }, 'quick added');
  assert.deepEqual((await guard(dir, '--base', 'HEAD~1')).data.findings.map((f) => f.code), ['CONFIG_TESTS_CHANGED']);
  commit(dir, { '.baco/config.yaml': cfg('tests_quick:\n  unit: "u --fast"\napp:\n  smoke: "s"\n') }, 'smoke added');
  assert.deepEqual((await guard(dir, '--base', 'HEAD~1')).data.findings.map((f) => f.code), ['CONFIG_TESTS_CHANGED']);
  commit(dir, { '.baco/config.yaml': cfg('tests_quick:\n  unit: "u --fast"\napp:\n  smoke: "s"\n  name: x\n') }, 'other app key');
  assert.equal((await guard(dir, '--base', 'HEAD~1')).code, 0);
  commit(dir, { '.baco/config.yaml': cfg('tests_quick:\n  unit: "u --fast"\napp:\n  smoke: "s2"\n  name: x\n') }, 'smoke changed');
  assert.equal((await guard(dir, '--base', 'HEAD~1')).code, 2);
});

// 0.1.1 review: the files that do not count as code (provenance.ignore) need a person's ok to change.
test('CONFIG_PROVENANCE_CHANGED: a different resolved provenance.ignore exits 2; --allow does not clear it', async () => {
  const cfg = (ignore) => `tests:\n  patterns: ["**/*.test.*"]\n${ignore === null ? '' : `provenance:\n  ignore: ${ignore}\n`}`;
  const dir = await makeRepo({ '.baco/config.yaml': cfg(null) });
  commit(dir, { '.baco/config.yaml': cfg('[logs/**]') }, 'ignore logs');
  const r = await guard(dir, '--base', 'HEAD~1', '--allow', 'CA-001');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings, [{ code: 'CONFIG_PROVENANCE_CHANGED', path: '.baco/config.yaml', line: null }]);
  const c = capture();
  assert.equal(await main(['guard-tests', '--cwd', dir, '--base', 'HEAD~1'], c.io), 2);
  assert.match(c.out.stdout, /lista de arquivos que não contam como código[^\n]*mudou; precisa do ok de uma pessoa/);
  // Same resolved list (a leading ./ and a refused entry added): no finding.
  commit(dir, { '.baco/config.yaml': cfg('[./logs/**, "**"]') }, 'same list');
  assert.equal((await guard(dir, '--base', 'HEAD~1')).code, 0);
  // Removing the entry is a change too; with a tests change both findings show.
  commit(dir, { '.baco/config.yaml': cfg(null).replace('**/*.test.*', '**/*.spec.*') }, 'both');
  assert.deepEqual((await guard(dir, '--base', 'HEAD~1')).data.findings.map((f) => f.code), ['CONFIG_TESTS_CHANGED', 'CONFIG_PROVENANCE_CHANGED']);
});

// R24: default patterns name code extensions; a rename changing a tagged test's extension needs the gate.
test('R24: globToRegExp supports {a,b} brace alternation', () => {
  const re = globToRegExp('**/*.test.{js,ts}');
  assert.ok(re.test('a.test.js'));
  assert.ok(re.test('src/a.test.ts'));
  assert.ok(!re.test('a.test.js.disabled'));
  assert.ok(!re.test('a.test.jsx'));
  assert.ok(globToRegExp('.maestro/**/*.{yaml,yml}').test('.maestro/flows/a.yml'));
});

test('R24: default patterns do not match a disabled copy', async () => {
  const { DEFAULTS } = await import('../skills/baco-sdd/scripts/lib/config.mjs');
  const res = DEFAULTS.tests.patterns.map(globToRegExp);
  const isTest = (p) => res.some((r) => r.test(p));
  for (const p of ['a.test.js', 'src/b.spec.tsx', 'e2e/x.ts', 'app/e2e/deep/y.mjs', '.maestro/f.yaml']) assert.ok(isTest(p), p);
  for (const p of ['a.test.js.disabled', 'e2e/x.spec.ts.bak', 'e2e/readme.md', '.maestro/notes.txt']) assert.ok(!isTest(p), p);
});

test('R24: with the DEFAULT config, renames that change a tagged test extension exit 2', async () => {
  const dir = await makeRepo({ 'a.test.js': TAGGED });
  commit(dir, { 'a.test.js': null, 'a.test.js.disabled': TAGGED }, 'disable');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(ids(r), [['TAGGED_TEST_DELETED', 'CA-001', 'a.test.js'], ['TAGGED_TEST_DELETED', 'CA-002', 'a.test.js']]);
  const dir2 = await makeRepo({ 'e2e/x.spec.ts': TAGGED });
  commit(dir2, { 'e2e/x.spec.ts': null, 'e2e/x.spec.ts.bak': TAGGED }, 'bak');
  const r2 = await guard(dir2, '--base', 'HEAD~1');
  assert.equal(r2.code, 2);
  assert.deepEqual(r2.data.findings.map((f) => f.code), ['TAGGED_TEST_DELETED', 'TAGGED_TEST_DELETED']);
  assert.equal((await guard(dir2, '--base', 'HEAD~1', '--allow', 'CA-001', '--allow', 'CA-002')).code, 0);
});

test('R24: an extension change is flagged even when both paths are test paths', async () => {
  const dir = await makeRepo({ '.baco/config.yaml': 'tests:\n  patterns: ["**/*.test.*"]\n', 'a.test.js': TAGGED });
  commit(dir, { 'a.test.js': null, 'a.test.js.disabled': TAGGED }, 'disable');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id]), [['TAGGED_TEST_DELETED', 'CA-001'], ['TAGGED_TEST_DELETED', 'CA-002']]);
});

test('R24: a plain rename keeping the extension, content unchanged, has no finding', async () => {
  const dir = await makeRepo({ 'a.test.js': TAGGED });
  commit(dir, { 'a.test.js': null, 'b.test.js': TAGGED }, 'rename');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 0);
  assert.deepEqual(r.data.findings, []);
});

// R25: the R24 extension rule applies only when the OLD path is a test; renamed tests keep SKIP_ADDED.
test('R25: a non-test file renamed into a test path is scanned normally (SKIP_ADDED, no deletion)', async () => {
  const body = "it('[CA-001] x', () => {\n  a();\n});\n";
  const dir = await makeRepo({ 'src/a.mjs': body });
  commit(dir, { 'src/a.mjs': null, 'src/a.test.js': body + "it.only('y', () => {});\n" }, 'into tests');
  const r = await guard(dir, '--base', 'HEAD~1');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => f.code), ['SKIP_ADDED']);
  const dir2 = await makeRepo({ 'src/b.mjs': body });
  commit(dir2, { 'src/b.mjs': null, 'src/b.test.js': body }, 'plain move into tests');
  const r2 = await guard(dir2, '--base', 'HEAD~1');
  assert.equal(r2.code, 0);
  assert.deepEqual(r2.data.findings, []);
});

// E2E round C: a test created by an earlier task of the same delivery did not exist at the plan's
// Base, so a later task that weakened it passed. The guard also compares against the task's start.
const sh = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const FULL = "it('[CA-001] shows the full text', () => {\n  assert.equal(screen.text(), 'Olá, Ana');\n});\n";
async function deliveryWithTwoTasks(task2Content) {
  const dir = await makeRepo({ 'src/app.js': 'x\n' });
  const base = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', 'baco/ENT-001');
  sh(dir, 'checkout', '-q', '-b', 'baco/ENT-001-T-001');
  commit(dir, { 'src/a.test.js': FULL }, 'T-001 adds the test');
  sh(dir, 'checkout', '-q', 'baco/ENT-001');
  sh(dir, 'merge', '-q', '--no-ff', '-m', 'merge T-001', 'baco/ENT-001-T-001');
  sh(dir, 'checkout', '-q', '-b', 'baco/ENT-001-T-002');
  commit(dir, { 'src/a.test.js': task2Content }, 'T-002 weakens it');
  return { dir, base };
}

test('a test added by an earlier task of the delivery is protected in a later task (task start found from the branch)', async () => {
  const noId = FULL.replace('[CA-001] ', '');
  const { dir, base } = await deliveryWithTwoTasks(noId);
  const r = await guard(dir, '--base', base);
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id, f.path]), [['TAGGED_TEST_CHANGED', 'CA-001', 'src/a.test.js']]);
  assert.equal(r.data.taskBase, sh(dir, 'merge-base', 'HEAD', 'baco/ENT-001'));
  const css = FULL.replace("assert.equal(screen.text(), 'Olá, Ana');", "assert.ok(screen.hasClass('saudacao'));");
  const other = await deliveryWithTwoTasks(css);
  const r2 = await guard(other.dir, '--base', other.base);
  assert.equal(r2.code, 2);
  assert.deepEqual(r2.data.findings.map((f) => [f.code, f.id]), [['TAGGED_TEST_CHANGED', 'CA-001']]);
  assert.equal((await guard(dir, '--base', base, '--allow', 'CA-001')).code, 0);
});

test('--task-base names the delivery branch explicitly; without it and off a task branch only --base counts', async () => {
  const { dir, base } = await deliveryWithTwoTasks(FULL.replace("'Olá, Ana'", "'Ol'"));
  sh(dir, 'branch', '-q', '-m', 'baco/ENT-001-T-002', 'trabalho');
  const plain = await guard(dir, '--base', base);
  assert.equal(plain.code, 0);
  assert.equal(plain.data.taskBase, null);
  const r = await guard(dir, '--base', base, '--task-base', 'baco/ENT-001');
  assert.equal(r.code, 2);
  assert.equal(r.data.taskBase, sh(dir, 'merge-base', 'HEAD', 'baco/ENT-001'));
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id]), [['TAGGED_TEST_CHANGED', 'CA-001']]);
  assert.equal((await guard(dir, '--base', base, '--task-base', 'nope')).code, 65);
});

test('a finding seen from both the Base and the task start is reported once', async () => {
  const dir = await makeRepo({ 'src/a.test.js': FULL });
  const base = sh(dir, 'rev-parse', 'HEAD');
  sh(dir, 'checkout', '-q', '-b', 'baco/ENT-002');
  commit(dir, { 'src/b.js': 'y\n' }, 'other task');
  sh(dir, 'checkout', '-q', '-b', 'baco/ENT-002-T-002');
  commit(dir, { 'src/a.test.js': FULL.replace('[CA-001] ', '') + "it.skip('x', () => {});\n" }, 'weaken + skip');
  const r = await guard(dir, '--base', base);
  assert.deepEqual(r.data.findings.map((f) => [f.code, f.id ?? null]), [['TAGGED_TEST_CHANGED', 'CA-001'], ['SKIP_ADDED', null]]);
});

test('R25: an allowed extension-changing rename still reports an added skip', async () => {
  const pad = Array.from({ length: 12 }, (_, i) => `// filler ${i}\n`).join('');
  const dir = await makeRepo({ 'a.test.js': pad + TAGGED });
  commit(dir, { 'a.test.js': null, 'a.test.ts': pad + TAGGED + "it.skip('later', () => {});\n" }, 'to ts + skip');
  const r = await guard(dir, '--base', 'HEAD~1', '--allow', 'CA-001', '--allow', 'CA-002');
  assert.equal(r.code, 2);
  assert.deepEqual(r.data.findings.map((f) => f.code), ['SKIP_ADDED']);
});
