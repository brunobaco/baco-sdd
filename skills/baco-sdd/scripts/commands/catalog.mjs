import { writeFileSync } from 'node:fs';
import { readText, fold } from '../lib/markdown.mjs';
import {
  readCatalog, updateRow, formatImplemented, catalogPath, CatalogError,
  IMPLEMENTED_COL, VALIDATED_COL,
} from '../lib/catalog.mjs';

export const usage = 'baco catalog get <CODE> | set <CODE> [--implemented <v>@<sha>@<ENT>] [--impl-state <s>] [--validation <s>] [--validated <v>] [--json] [--cwd <dir>]';

const IMPL_STATES = ['não iniciada', 'em implementação', 'implementada', 'não verificada'];
// 'validada sem revisão externa': every criterion proven, the external review waived (waive-review).
const VALIDATION_STATES = ['pendente', 'parcialmente validada', 'validada', 'validada sem revisão externa', 'não conforme'];

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const bad = (key, params) => ({ code: 64, data: {}, messages: [{ key, params }] });

function buildPatch(flags) {
  const patch = {};
  const str = (k) => (typeof flags[k] === 'string' ? flags[k] : undefined);
  for (const k of ['implemented', 'impl-state', 'validation', 'validated']) {
    if (flags[k] !== undefined && str(k) === undefined) return { error: usageError() };
  }
  if (str('implemented') !== undefined) {
    const [version, sha, delivery, ...extra] = str('implemented').split('@').map((s) => s.trim());
    if (!version || !/^[0-9a-f]{7,40}$/i.test(sha ?? '') || extra.length) {
      return { error: bad('catalog.bad_implemented', { value: str('implemented') }) };
    }
    patch[IMPLEMENTED_COL] = formatImplemented({ version, sha, delivery });
  }
  if (str('impl-state') !== undefined) {
    if (!IMPL_STATES.includes(str('impl-state'))) {
      return { error: bad('catalog.bad_state', { value: str('impl-state'), allowed: IMPL_STATES.join(', ') }) };
    }
    patch['Implementação'] = str('impl-state');
  }
  if (str('validation') !== undefined) {
    if (!VALIDATION_STATES.includes(str('validation'))) {
      return { error: bad('catalog.bad_state', { value: str('validation'), allowed: VALIDATION_STATES.join(', ') }) };
    }
    patch['Validação'] = str('validation');
  }
  if (str('validated') !== undefined) patch[VALIDATED_COL] = str('validated');
  return { patch };
}

// The row's code from what the person typed: the code itself, or a spec name (or its file name) that
// matches exactly one row. Anything else is returned as typed, and the lookup then names the codes.
function resolveCode(md, typed) {
  const rows = readCatalog(md).rows;
  if (rows.some((r) => r.code === typed)) return typed;
  const key = fold(typed).replace(/\.md$/, '').replace(/^spec-/, '');
  const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const hits = rows.filter((r) => {
    const cell = Object.values(r.cells)[1] ?? '';
    const link = /\(([^)]*)\)/.exec(cell)?.[1] ?? '';
    const file = link.split('/').pop().replace(/\.md$/, '').replace(/^spec-/, '');
    const name = cell.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '');
    return [file, name].some((v) => v && norm(v) === norm(key)) || fold(r.code) === key;
  });
  return hits.length === 1 ? hits[0].code : typed;
}

export async function run(args, ctx) {
  const [sub, typed] = args._;
  if (!['get', 'set'].includes(sub) || !typed) return usageError();
  const path = catalogPath(ctx.root, ctx.config);
  const md = readText(path);
  const code = resolveCode(md, typed);
  try {
    if (sub === 'get') {
      const row = readCatalog(md).rows.find((r) => r.code === code);
      if (!row) {
        const codes = readCatalog(md).rows.map((r) => r.code);
        throw new CatalogError('unknown code', 'catalog.unknown_code', { code, example: codes[0] ?? 'COD', codes: codes.join(', ') || '-' });
      }
      const messages = Object.entries(row.cells).map(([header, value]) => ({ key: 'catalog.cell', params: { header, value } }));
      return { code: 0, data: row.cells, messages };
    }
    const { patch, error } = buildPatch(args.flags);
    if (error) return error;
    if (!Object.keys(patch).length) return usageError();
    writeFileSync(path, updateRow(md, code, patch));
    const row = readCatalog(readText(path)).rows.find((r) => r.code === code);
    return { code: 0, data: row.cells, messages: [{ key: 'catalog.updated', params: { code } }] };
  } catch (e) {
    if (e instanceof CatalogError) return bad(e.key, e.params);
    throw e;
  }
}
