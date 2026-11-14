import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soma } from '../src/soma.mjs';

test('[CA-TAR-001] soma dois números', () => {
  assert.equal(soma(1, 1), 2);
});
