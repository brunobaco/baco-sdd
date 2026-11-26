import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function canonical(p) {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

export function isMainModule(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  return canonical(argv1) === canonical(fileURLToPath(metaUrl));
}
