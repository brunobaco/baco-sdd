import { fold } from './markdown.mjs';

// reason: { key, params? } — a message key resolved by the caller.
export class VerdictError extends Error {
  constructor(reason) {
    super(reason?.key ?? String(reason));
    this.name = 'VerdictError';
    this.reason = reason;
  }
}

const VERDICTS = new Set(['aprovado', 'ajustes', 'bloqueio']);
const SEVERITIES = { critico: 'crítico', importante: 'importante', sugestao: 'sugestão' };
const SEV_TOKEN = /\[\s*[^\]]*\]/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
const strip = (s) => s.replace(/^[\s*_`]+|[\s*_`]+$/g, '');
const looksLikeLocation = (s) => /:\d+/.test(s) || /[/.]/.test(s);

// A bullet whose first word (after stripping bold, brackets and parentheses) is a severity label,
// written without the mandatory bracket token: `- crítico: …`, `- **Crítico** …`, `1. (crítico) …`.
function unbracketedSeverity(line) {
  if (!BULLET.test(line)) return false;
  const body = fold(line.replace(BULLET, '')).replace(/[*_`()[\]]/g, ' ').trim();
  const word = /^[a-z]+/.exec(body)?.[0] ?? '';
  return ['critico', 'importante', 'sugestao'].includes(word) || word.startsWith('bloque');
}

function parseFinding(line) {
  const bad = () => new VerdictError({ key: 'verdict.reason.malformed_finding', params: { line: line.trim() } });
  const body = line.replace(BULLET, '');
  const m = /^[\s*_`]*\[\s*([^\]]*?)\s*\][\s*_`]*(.*?)\s*$/.exec(body);
  const severity = m && SEVERITIES[fold(m[1])];
  if (!severity) throw bad();
  const rest = m[2];
  let location = null;
  let text = rest;
  const withLoc = /^(\S+)\s+[—–-]\s+(.+)$/.exec(rest);
  const noLoc = /^[—–-]\s*(.+)$/.exec(rest);
  if (withLoc && looksLikeLocation(strip(withLoc[1]))) {
    location = strip(withLoc[1]);
    text = withLoc[2];
  } else if (noLoc) text = noLoc[1];
  text = text.trim();
  if (!text) throw bad();
  return { severity, location, text };
}

// True when the answer has a "O que foi conferido" section with at least one line of text under it
// (before the next heading or the VEREDITO or Achados label). A heading with nothing under it is empty.
export function hasScopeSection(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let inScope = false;
  for (const line of lines) {
    const folded = fold(line);
    const label = folded.replace(/^[\s#>*_`]+|[\s*_`:#]+$/g, '');
    const isHeading = /^\s{0,3}#{1,6}\s/.test(line);
    if (/^o que foi conferido(?![a-z])/.test(label) && (isHeading || !BULLET.test(line))) {
      inScope = true;
      // Text on the same line counts only when it has a letter or digit (`?`, `:` or `-` are not content).
      const same = label.replace(/^o que foi conferido/, '');
      if (/[\p{L}\p{N}]/u.test(same)) return true;
      continue;
    }
    if (isHeading || /^achados(?![a-z])/.test(label) || /^veredito\s*:/.test(label)) { inScope = false; continue; }
    if (inScope && /[\p{L}\p{N}]/u.test(line)) return true;
  }
  return false;
}

// Parses the reviewer's answer. Throws VerdictError({ key, params }).
export function parseVerdict(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let verdict = null;
  let inFindings = false;
  const findings = [];
  for (const line of lines) {
    const folded = fold(line);
    const v = /^[\s#>*_`]*veredito[\s*_]*:[\s*_`]*(.*?)[\s*_`.]*$/.exec(folded);
    if (v && verdict === null) {
      if (!VERDICTS.has(v[1])) throw new VerdictError({ key: 'verdict.reason.unknown_value', params: { value: v[1] } });
      verdict = v[1];
      continue;
    }
    const isHeading = /^\s{0,3}#{1,6}\s/.test(line);
    const label = folded.replace(/^[\s#>*_`]+|[\s*_`:#]+$/g, '');
    const isSection = /^achados(?![a-z])/.test(label);
    const bareSection = !BULLET.test(line) && /^achados(\s*[(\[]?\s*\d*\s*[)\]]?)?$/.test(label);
    if (isHeading || bareSection) {
      inFindings = isSection;
      continue;
    }
    if (!inFindings) continue;
    if (!SEV_TOKEN.test(line)) {
      if (unbracketedSeverity(line)) throw new VerdictError({ key: 'verdict.reason.malformed_finding', params: { line: line.trim() } });
      continue;
    }
    findings.push(parseFinding(line));
  }
  if (verdict === null) throw new VerdictError({ key: 'verdict.reason.no_line' });
  if (verdict !== 'aprovado' && findings.length === 0) throw new VerdictError({ key: 'verdict.reason.no_findings', params: { verdict } });
  if (verdict === 'aprovado' && findings.some((f) => f.severity !== 'sugestão')) throw new VerdictError({ key: 'verdict.reason.contradictory' });
  return { verdict, findings };
}
