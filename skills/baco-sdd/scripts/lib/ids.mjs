// ID grammar: (RF|RNF|RN|INV|CA|CT|QA|P|ADR)- + optional capability [A-Z]{2,6}- + 3 digits.
// RNF must come before RN in the alternation so RN never swallows RNF.
const KINDS = 'RNF|RN|RF|INV|CA|CT|QA|ADR|P';
const BODY = `(?:${KINDS})-(?:[A-Z]{2,6}-)?\\d{3}`;

// Global regex: use with matchAll (or reset lastIndex) — it is stateful with exec/test.
export const ID_RE = new RegExp(`(?<![A-Za-z0-9])${BODY}(?!\\d)`, 'g');

const PARSE_RE = new RegExp(`^(${KINDS})-(?:([A-Z]{2,6})-)?(\\d{3})$`);

export function parseId(s) {
  const m = PARSE_RE.exec(String(s));
  if (!m) return null;
  return { id: m[0], kind: m[1], cap: m[2] ?? null, num: Number(m[3]) };
}

export function formatId({ kind, cap, num }) {
  return `${kind}-${cap ? `${cap}-` : ''}${String(num).padStart(3, '0')}`;
}

// An ID followed by shorthand tails: "/007" (list) or "–004" / "-004" (range).
// A tail only counts when it is exactly 3 digits.
const REF_RE = new RegExp(`(?<![A-Za-z0-9])(${BODY})(?!\\d)((?:[/–-]\\d{3}(?!\\d))*)`, 'g');

export function expandRefs(text) {
  const seen = new Set();
  const out = [];
  const add = (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const m of String(text).matchAll(REF_RE)) {
    const base = parseId(m[1]);
    add(base.id);
    let last = base.num;
    for (const tail of m[2].matchAll(/([/–-])(\d{3})/g)) {
      const n = Number(tail[2]);
      if (tail[1] !== '/' && n > last) {
        for (let i = last + 1; i <= n; i++) add(formatId({ ...base, num: i }));
      } else {
        add(formatId({ ...base, num: n }));
      }
      last = n;
    }
  }
  return out;
}
