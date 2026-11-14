import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { messages } from '../skills/baco-sdd/scripts/lib/messages.mjs';
import { SKILL_ROOT, listFiles } from './helpers/content.mjs';

const DASH = /[—–]/;

test('pt-BR engine messages contain no em or en dash', () => {
  const bad = Object.entries(messages['pt-BR']).filter(([, v]) => typeof v === 'string' && DASH.test(v)).map(([k]) => k);
  assert.deepEqual(bad, []);
});

test('pt-BR templates contain no em or en dash', () => {
  // catalogo-de-specs.md keeps the engine's empty-cell marker in its example row.
  const files = listFiles(join(SKILL_ROOT, 'templates', 'pt-BR'), '.md').filter((f) => !f.endsWith('catalogo-de-specs.md'));
  assert.ok(files.length > 10);
  const bad = files.filter((f) => DASH.test(readFileSync(f, 'utf8'))).map((f) => relative(SKILL_ROOT, f));
  assert.deepEqual(bad, []);
});
