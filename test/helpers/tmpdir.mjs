import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tracked = new Set();
let hookRegistered = false;

function removeQuiet(dir) {
  tracked.delete(dir);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function ensureExitCleanup() {
  if (hookRegistered) return;
  hookRegistered = true;
  process.on('exit', () => {
    for (const dir of [...tracked]) removeQuiet(dir);
  });
}

// Tracks an existing temporary folder so it is removed when the test ends (if `t` is given)
// and unconditionally when the process exits, even on errors.
export function trackTempDir(dir, t = null) {
  ensureExitCleanup();
  tracked.add(dir);
  if (t && typeof t.after === 'function') t.after(() => removeQuiet(dir));
  return dir;
}

export function makeTempDirSync(prefix = 'baco-', t = null, base = tmpdir()) {
  return trackTempDir(mkdtempSync(join(base, prefix)), t);
}

export async function makeTempDir(prefix = 'baco-', t = null, base = tmpdir()) {
  return trackTempDir(await mkdtemp(join(base, prefix)), t);
}
