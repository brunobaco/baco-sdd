import { ID_RE } from './ids.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
  if (e[0] === '#') {
    const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    try { return String.fromCodePoint(cp); } catch { return m; }
  }
  return ENTITIES[e];
});

function attrs(src) {
  const out = {};
  for (const m of src.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[2] ?? m[3] ?? '');
  return out;
}

// Remove CDATA, comments and <system-out>/<system-err> so their text is never scanned as markup.
const strip = (xml) => xml
  .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<system-(out|err)\b[^>]*?\/>/g, '')
  .replace(/<system-(out|err)\b[^>]*>[\s\S]*?<\/system-\1>/g, '');

export function parseJUnit(xml) {
  const src = strip(String(xml ?? ''));
  const out = [];
  const re = /<testcase\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/)?>/g;
  let m;
  while ((m = re.exec(src))) {
    const a = attrs(m[1]);
    let body = '';
    if (!m[2]) {
      const end = src.indexOf('</testcase>', re.lastIndex);
      body = end === -1 ? '' : src.slice(re.lastIndex, end);
      if (end !== -1) re.lastIndex = end + '</testcase>'.length;
    }
    let status = 'passed';
    let message = null;
    const child = /<(failure|error|skipped)\b((?:"[^"]*"|'[^']*'|[^>"'])*?)\/?>/.exec(body);
    if (child) {
      status = child[1] === 'skipped' ? 'skipped' : 'failed';
      message = attrs(child[2]).message ?? null;
    }
    out.push({ name: a.name ?? '', classname: a.classname ?? '', file: a.file ?? null, status, message });
  }
  return out;
}

// IDs inside [...] brackets only.
export function idsInTitle(name) {
  const ids = [];
  for (const b of String(name).matchAll(/\[([^\]]*)\]/g)) {
    for (const m of b[1].matchAll(ID_RE)) if (!ids.includes(m[0])) ids.push(m[0]);
  }
  return ids;
}
