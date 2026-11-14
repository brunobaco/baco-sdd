import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJUnit, idsInTitle } from '../skills/baco-sdd/scripts/lib/junit.mjs';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

test('parseJUnit reads nested suites, entities, self-closing and skipped; ignores CDATA', () => {
  const cases = parseJUnit(fx('junit-vitest.xml'));
  assert.equal(cases.length, 4);
  const failed = cases.filter((c) => c.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, '[CA-EMP-002] nega segunda & posição');
  assert.equal(failed[0].message, 'x');
  assert.equal(cases.filter((c) => c.status === 'skipped').length, 1);
  assert.equal(cases[2].status, 'passed');
  assert.equal(cases[0].file, null);
});

test('parseJUnit handles <error>, file attribute and empty input', () => {
  const c = parseJUnit('<testsuite><testcase name="a" file="x.ts"><error message="e"/></testcase></testsuite>');
  assert.deepEqual(c, [{ name: 'a', classname: '', file: 'x.ts', status: 'failed', message: 'e' }]);
  assert.deepEqual(parseJUnit(''), []);
  assert.deepEqual(parseJUnit(fx('junit-empty.xml')), []);
});

// End-to-end round D: a reviewer saw 1 failure counted where Playwright showed 2. Not reproduced: a
// real Playwright 1.64 report (two projects, describe blocks, a retry, an afterAll error written as
// <error> after <system-out>, a serial test that did not run) gives one case per test and project and
// the same failure count as Playwright's console. This pins that count.
test('parseJUnit counts every failing Playwright test, per project, as Playwright does', () => {
  const cases = parseJUnit(fx('junit-playwright.xml'));
  assert.equal(cases.length, 6);
  const failed = cases.filter((c) => c.status === 'failed');
  assert.deepEqual(failed.map((c) => c.name), [
    'grupo › [CT-001] primeiro',
    'grupo › [CT-002] segundo <tela> & "aspas"',
    'grupo › [CT-001] primeiro',
    '[CT-010] passa mas o afterAll quebra',
  ], 'two failing tests of one file in chromium, plus firefox; the <error> counts too');
  assert.equal(failed[3].message, 'teardown quebrou');
  assert.equal(cases.find((c) => c.name === '[CT-004] instável').status, 'passed', 'a test that passed on retry is not a failure');
  assert.equal(cases.find((c) => c.name.endsWith('nao roda')).status, 'skipped');
  assert.ok(cases.every((c) => c.classname === 'x.spec.js'));
});

test('idsInTitle only reads bracketed IDs', () => {
  assert.deepEqual(idsInTitle('[CT-EMP-001][CA-EMP-002] x RF-EMP-009'), ['CT-EMP-001', 'CA-EMP-002']);
});
