import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_RE, parseId, formatId, expandRefs } from '../skills/baco-sdd/scripts/lib/ids.mjs';

test('parseId handles namespaced, plain and invalid IDs', () => {
  assert.deepEqual(parseId('RF-EMP-001'), { id: 'RF-EMP-001', kind: 'RF', cap: 'EMP', num: 1 });
  assert.equal(parseId('CA-012').cap, null);
  assert.equal(parseId('CA-012').num, 12);
  assert.equal(parseId('XX-001'), null);
  assert.equal(parseId('RF-0012'), null);
  assert.equal(parseId('RF-001 '), null);
});

test('RNF is not swallowed by RN', () => {
  assert.equal(parseId('RNF-EMP-001').kind, 'RNF');
  assert.equal(parseId('RN-EMP-001').kind, 'RN');
  assert.deepEqual([...'RNF-EMP-001 RN-002'.matchAll(ID_RE)].map((m) => m[0]), ['RNF-EMP-001', 'RN-002']);
});

test('ID_RE does not match inside longer tokens', () => {
  assert.deepEqual([...'XRF-001 RF-0012 ok'.matchAll(ID_RE)].map((m) => m[0]), []);
  assert.deepEqual([...'(P-001), ADR-002.'.matchAll(ID_RE)].map((m) => m[0]), ['P-001', 'ADR-002']);
});

test('formatId pads to 3 digits', () => {
  assert.equal(formatId({ kind: 'RF', cap: 'EMP', num: 7 }), 'RF-EMP-007');
  assert.equal(formatId({ kind: 'CA', cap: null, num: 12 }), 'CA-012');
});

test('expandRefs expands slash lists and ranges', () => {
  assert.deepEqual(expandRefs('RF-EMP-001/007, CT-EMP-001–004 e RN-002'), [
    'RF-EMP-001', 'RF-EMP-007', 'CT-EMP-001', 'CT-EMP-002', 'CT-EMP-003', 'CT-EMP-004', 'RN-002',
  ]);
  assert.deepEqual(expandRefs('CT-EMP-001-003'), ['CT-EMP-001', 'CT-EMP-002', 'CT-EMP-003']);
  assert.deepEqual(expandRefs('RN-EMP-002/003/004/012'), ['RN-EMP-002', 'RN-EMP-003', 'RN-EMP-004', 'RN-EMP-012']);
});

test('expandRefs: unique, ordered, range only with exactly 3 digits', () => {
  assert.deepEqual(expandRefs('RF-001 e RF-001, RF-002'), ['RF-001', 'RF-002']);
  assert.deepEqual(expandRefs('CT-001-0042'), ['CT-001']);
  assert.deepEqual(expandRefs('RF-001/12'), ['RF-001']);
  assert.deepEqual(expandRefs('RF-001-ABC'), ['RF-001']);
  assert.deepEqual(expandRefs('sem ids'), []);
});

test('expandRefs mixes ranges and lists', () => {
  assert.deepEqual(expandRefs('CT-EMP-001–002/019/021'), ['CT-EMP-001', 'CT-EMP-002', 'CT-EMP-019', 'CT-EMP-021']);
});
