import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../skills/baco-sdd/scripts/baco.mjs';
import { readWaiver } from '../skills/baco-sdd/scripts/lib/waiver.mjs';
import { formatZoned } from '../skills/baco-sdd/scripts/commands/waive-review.mjs';
import { makeRepo as makeRepoRaw } from './helpers/tmprepo.mjs';

// Every temp repo made here is removed when the file ends.
const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });
const makeRepo = async (files) => { const d = await makeRepoRaw(files); temps.push(d); return d; };

const capture = () => {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } } };
};
const ENT = 'docs/entregas/ENT-001-a';
const FILE = `${ENT}/revisao/dispensa-revisao-externa.md`;
const plan = '# Plano\n\n**Specs:** docs/specs/x.md@1.0\n**Base:** HEAD\n';

test('waive-review writes the waiver with who, local date, reason and HEAD', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const { io, out } = capture();
  assert.equal(await main(['waive-review', 'ENT-001', '--by', 'Ana Souza', '--reason', 'protótipo interno -- sem revisor', '--json', '--cwd', dir], io), 0, out.stderr);
  const data = JSON.parse(out.stdout);
  assert.equal(data.file, join(dir, FILE));
  assert.equal(data.by, 'Ana Souza');
  assert.equal(data.reason, 'protótipo interno -- sem revisor');
  assert.equal(data.head, head);
  assert.match(data.date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}(, [^)]+)?\)$/);
  const md = readFileSync(join(dir, FILE), 'utf8');
  assert.equal(md.split('\n')[0], `<!-- baco:head ${head} -->`);
  for (const s of ['Ana Souza', data.date, 'protótipo interno -- sem revisor', 'ENT-001']) assert.ok(md.includes(s), s);
  assert.deepEqual(readWaiver(join(dir, ENT, 'revisao')), { head, by: 'Ana Souza', date: data.date, reason: 'protótipo interno -- sem revisor' });
  const c = capture();
  assert.equal(await main(['waive-review', 'ENT-001', '--by', 'Ana', '--reason', 'x', '--cwd', dir], c.io), 0);
  assert.match(c.out.stdout, /dispensa/i);
});

test('waive-review names the time zone of the date: offset and IANA zone', async () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    assert.equal(formatZoned(new Date(Date.UTC(2026, 10, 2, 17, 10))), '2026-11-02 14:10 (UTC-03:00, America/Sao_Paulo)');
    process.env.TZ = 'Asia/Kolkata';
    assert.match(formatZoned(new Date(Date.UTC(2026, 10, 2, 17, 10))), /^2026-11-02 22:40 \(UTC\+05:30, Asia\/(Kolkata|Calcutta)\)$/);
    process.env.TZ = 'UTC';
    assert.match(formatZoned(new Date(Date.UTC(2026, 10, 2, 17, 10))), /^2026-11-02 17:10 \(UTC\+00:00(, (Etc\/)?UTC)?\)$/);
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});

test('waive-review: missing or empty flags exit 64; unknown delivery 65', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan });
  for (const args of [
    ['ENT-001', '--by', 'Ana'],
    ['ENT-001', '--reason', 'x'],
    ['ENT-001', '--by', '--reason', 'x'],
    ['ENT-001', '--by', ' ', '--reason', 'x'],
    ['--by', 'Ana', '--reason', 'x'],
    ['ENT-1', '--by', 'Ana', '--reason', 'x'],
  ]) assert.equal(await main(['waive-review', ...args, '--cwd', dir], capture().io), 64, args.join(' '));
  assert.ok(!existsSync(join(dir, FILE)));
  assert.equal(await main(['waive-review', 'ENT-009', '--by', 'Ana', '--reason', 'x', '--cwd', dir], capture().io), 65);
});

test('waive-review is refused once a verdict was imported', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan, [`${ENT}/revisao/veredito-01.md`]: 'VEREDITO: ajustes\n' });
  const { io, out } = capture();
  assert.equal(await main(['waive-review', 'ENT-001', '--by', 'Ana', '--reason', 'x', '--cwd', dir], io), 64);
  assert.match(out.stderr, /veredito/i);
  assert.ok(!existsSync(join(dir, FILE)));
});

test('readWaiver: none or unreadable is null', async () => {
  const dir = await makeRepo({ [`${ENT}/plano.md`]: plan, [FILE]: '# só texto\n' });
  assert.equal(readWaiver(join(dir, ENT, 'revisao')), null);
  assert.equal(readWaiver(join(dir, 'nope')), null);
});
