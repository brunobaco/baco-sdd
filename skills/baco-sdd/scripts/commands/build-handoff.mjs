import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deliveryDir, readPlanHeader, nextNumber, latestVerdict, ENT_ID } from '../lib/delivery.mjs';
import { git, diffPatch, diffQuiet, revParse } from '../lib/git.mjs';
import { readSpec } from '../lib/spec.mjs';
import { readText } from '../lib/markdown.mjs';
import { junitFiles } from './trace.mjs';
import { mergeTraces } from './acceptance-report.mjs';
import { parseJUnit } from '../lib/junit.mjs';
import { loadTrace } from '../lib/tracefile.mjs';
import { t } from '../lib/messages.mjs';

export const usage = 'baco build-handoff <ENT-NNN> [--mode pacote|repositorio|pr] [--dest <dir>] [--pr <url|number>] [--qa <path>]... [--trace <file.json>]... [--junit <file.xml>]... [--adr <path>]... [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const template = (name) => fileURLToPath(new URL(`../../templates/pt-BR/${name}`, import.meta.url));
const PROMPT_FILE = template('prompt-revisor.md');
const REPO_PROMPT_FILE = template('prompt-revisor-repositorio.md');
const PR_PROMPT_FILE = template('prompt-revisor-pr.md');
const DEFINITION_KINDS = new Set(['RF', 'RN', 'RNF', 'INV', 'CA']);
export const MODES = ['pacote', 'repositorio', 'pr'];

const fenceFor = (text) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

function testsSection(trace, failedCases, lang) {
  if (!trace && !failedCases.length) return t(lang, 'handoff.no_tests');
  const parts = [];
  if (trace) {
    const { summary, cas = [] } = trace;
    const lines = [`| ${t(lang, 'handoff.tests_status')} | ${t(lang, 'handoff.tests_count')} |`, '|---|---|'];
    for (const k of ['proven', 'failed', 'pending', 'uncovered']) lines.push(`| ${t(lang, `handoff.status.${k}`)} | ${summary?.[k] ?? 0} |`);
    parts.push(lines.join('\n'));
    if (cas.length) {
      const rows = [`| CA | ${t(lang, 'handoff.th.status')} | ${t(lang, 'handoff.th.scenarios')} |`, '|---|---|---|'];
      for (const c of cas) {
        const sc = (c.scenarios ?? []).map((s) => `${s.id}=${t(lang, `acceptance.result.${s.result}`)}`).join(', ') || '-';
        rows.push(`| ${c.ca} | ${t(lang, `trace.status.${c.status}`)} | ${sc} |`);
      }
      parts.push(rows.join('\n'));
    }
  }
  if (failedCases.length) {
    const blocks = failedCases.map((c) => {
      const msg = String(c.message ?? '').slice(0, 500);
      const f = fenceFor(msg);
      return `- ${[c.classname, c.name].filter(Boolean).join(' › ')}${msg ? `\n\n${f}\n${msg}\n${f}` : ''}`;
    });
    parts.push(`${t(lang, 'handoff.tests_failures')}:\n\n${blocks.join('\n\n')}`);
  }
  return parts.join('\n\n');
}

// A spec or ADR that did not change since the reviewed round is named, not repeated (`unchangedSince`).
const unchangedLine = (round, lang) => t(lang, 'handoff.unchanged_since', { round });

export function renderHandoff({ entId, specs, diff, trace = null, failedCases = [], adrs = [], reviewerPrompt, sinceRef = null, lang = 'pt-BR' }) {
  const title = sinceRef
    ? t(lang, 'handoff.title_delta', { id: entId, since: sinceRef.slice(0, 12) })
    : t(lang, 'handoff.title', { id: entId });
  const specText = specs.length
    ? specs.map((s) => `### ${s.path}${s.version ? `@${s.version}` : ''}\n\n${s.unchangedSince ? unchangedLine(s.unchangedSince, lang) : s.definitionsText}`).join('\n\n')
    : t(lang, 'handoff.no_spec');
  const adrText = adrs.length
    ? adrs.map((a) => `### ${a.path}\n\n${a.unchangedSince ? unchangedLine(a.unchangedSince, lang) : a.text.trim()}`).join('\n\n')
    : t(lang, 'handoff.no_adr');
  const fence = fenceFor(diff);
  return [
    `# ${title}`,
    `## ${t(lang, 'handoff.h.how')}\n\n${t(lang, 'handoff.how_note')}\n\n${t(lang, 'handoff.how', { id: entId })}`,
    `## ${t(lang, 'handoff.h.prompt')}\n\n${reviewerPrompt.trim()}`,
    `## ${t(lang, 'handoff.h.spec')}\n\n${specText}`,
    `## ${t(lang, 'handoff.h.adr')}\n\n${adrText}`,
    `## ${t(lang, 'handoff.h.tests')}\n\n${testsSection(trace, failedCases, lang)}`,
    `## ${t(lang, 'handoff.h.diff')}\n\n${fence}diff\n${diff.trim() ? diff.replace(/\n$/, '') : t(lang, 'handoff.no_diff')}\n${fence}`,
    t(lang, 'handoff.h.reminder'),
  ].join('\n\n') + '\n';
}

// REVISAO.md, written at the root of the exported copy (mode repositorio).
export function renderReviewGuide({ entId, round, baseSha, head, sinceRound = null, specs, adrs, trace = null, failedCases = [], reviewerPrompt, docsRoot = 'docs', lang = 'pt-BR' }) {
  const T = (key, params) => t(lang, key, params);
  const state = (x) => (sinceRound ? ` (${T(x.unchangedSince ? 'handoff.repo.unchanged' : 'handoff.repo.changed', { round: sinceRound })})` : '');
  const specList = specs.length ? specs.map((s) => `- \`${s.path}\`${s.version ? ` (${T('handoff.repo.version', { version: s.version })})` : ''}${state(s)}`).join('\n') : T('handoff.no_spec');
  const adrList = adrs.length ? adrs.map((a) => `- \`${a.path}\`${state(a)}`).join('\n') : T('handoff.no_adr');
  const title = sinceRound ? T('handoff.repo.title_delta', { id: entId, round: Number(round), since: sinceRound }) : T('handoff.repo.title', { id: entId, round: Number(round) });
  return [
    `# ${title}`,
    reviewerPrompt.trim(),
    `## ${T('handoff.repo.h.round')}\n\n${[
      `- ${T('handoff.repo.delivery', { id: entId })}`,
      `- ${T('handoff.repo.round', { round: Number(round) })}`,
      `- ${T(sinceRound ? 'handoff.repo.base_delta' : 'handoff.repo.base', { sha: baseSha, round: sinceRound })}`,
      `- ${T('handoff.repo.head', { sha: head })}`,
      `- ${T('handoff.repo.diff', { docs: docsRoot })}`,
    ].join('\n')}`,
    `## ${T('handoff.repo.h.specs')}\n\n${specList}`,
    `## ${T('handoff.repo.h.adrs')}\n\n${adrList}`,
    `## ${T('handoff.h.tests')}\n\n${testsSection(trace, failedCases, lang)}`,
    T('handoff.h.reminder'),
  ].join('\n\n') + '\n';
}

// The handoff kept in the repository for mode repositorio: mode, export path and the short prompt.
export function renderRepoHandoff({ entId, dest, sinceRef = null, lang = 'pt-BR' }) {
  const T = (key, params) => t(lang, key, params);
  const title = sinceRef ? T('handoff.title_delta', { id: entId, since: sinceRef.slice(0, 12) }) : T('handoff.title', { id: entId });
  return [
    `# ${title}`,
    `- ${T('handoff.repo.mode')}\n- ${T('handoff.repo.dest', { dest })}`,
    `## ${T('handoff.h.how')}\n\n${T('handoff.repo.how', { id: entId, dest })}`,
    `## ${T('handoff.repo.h.short')}\n\n${T('handoff.repo.short')}`,
  ].join('\n\n') + '\n';
}

// pedido.md of mode pr: the reviewer prompt, the round data (base, head, the diff file, the answer
// file) and the paths to read, all relative to the repo root. Paths only: the reviewer opens the files
// in the project itself. Never the PR: `gh pr diff/view` would show the delivery folder.
export function renderPrRequest({ entId, round, baseSha, head, sinceRound = null, diffFile, answerFile, specs, qa = [], adrs, trace = null, failedCases = [], reviewerPrompt, docsRoot = 'docs', lang = 'pt-BR' }) {
  const T = (key, params) => t(lang, key, params);
  const state = (x) => (sinceRound ? ` (${T(x.unchangedSince ? 'handoff.repo.unchanged' : 'handoff.repo.changed', { round: sinceRound })})` : '');
  const list = (items, empty, extra = () => '') => (items.length ? items.map((x) => `- \`${x.path}\`${extra(x)}${state(x)}`).join('\n') : T(empty));
  const title = sinceRound ? T('handoff.pr.title_delta', { id: entId, round: Number(round), since: sinceRound }) : T('handoff.pr.title', { id: entId, round: Number(round) });
  return [
    `# ${title}`,
    reviewerPrompt.trim(),
    `## ${T('handoff.repo.h.round')}\n\n${[
      `- ${T('handoff.repo.delivery', { id: entId })}`,
      `- ${T('handoff.repo.round', { round: Number(round) })}`,
      `- ${T(sinceRound ? 'handoff.repo.base_delta' : 'handoff.repo.base', { sha: baseSha, round: sinceRound })}`,
      `- ${T('handoff.pr.head', { sha: head })}`,
      `- ${T('handoff.pr.diff', { file: diffFile, docs: docsRoot })}`,
      `- ${T('handoff.pr.answer_file', { file: answerFile })}`,
    ].join('\n')}`,
    `## ${T('handoff.repo.h.specs')}\n\n${list(specs, 'handoff.no_spec', (s) => (s.version ? ` (${T('handoff.repo.version', { version: s.version })})` : ''))}`,
    `## ${T('handoff.pr.h.qa')}\n\n${list(qa, 'handoff.pr.no_qa')}`,
    `## ${T('handoff.repo.h.adrs')}\n\n${list(adrs, 'handoff.no_adr')}`,
    `## ${T('handoff.h.tests')}\n\n${testsSection(trace, failedCases, lang)}`,
    T('handoff.h.reminder'),
  ].join('\n\n') + '\n';
}

// The handoff kept in the repository for mode pr: mode, PR, request and answer paths (relative to the
// repo root), how to use.
export function renderPrHandoff({ entId, pr = null, request, answer, sinceRef = null, lang = 'pt-BR' }) {
  const T = (key, params) => t(lang, key, params);
  const title = sinceRef ? T('handoff.title_delta', { id: entId, since: sinceRef.slice(0, 12) }) : T('handoff.title', { id: entId });
  return [
    `# ${title}`,
    [T('handoff.pr.mode'), pr ? T('handoff.pr.pr', { pr }) : T('handoff.pr.no_pr'), T('handoff.pr.request', { path: request }), T('handoff.pr.answer', { path: answer })].map((l) => `- ${l}`).join('\n'),
    `## ${T('handoff.h.how')}\n\n${T('handoff.pr.how', { id: entId })}`,
  ].join('\n\n') + '\n';
}

// True when `target` is the repository root or inside it (symlinks resolved on the existing part).
function insideRepo(target, root) {
  let probe = target;
  const rest = [];
  while (!existsSync(probe) && dirname(probe) !== probe) { rest.unshift(basename(probe)); probe = dirname(probe); }
  const real = join(realpathSync(probe), ...rest);
  const rel = relative(realpathSync(root), real);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const isEmptyDir = (p) => statSync(p).isDirectory() && readdirSync(p).length === 0;

// Path relative to the repo root, or null when the file is outside it.
function repoRelative(abs, root) {
  let real = abs;
  try { real = realpathSync(abs); } catch { /* missing: keep as is */ }
  const rel = relative(realpathSync(root), real);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : null;
}

// Writes the tree at HEAD (minus the excluded pathspec) into dest with `git archive` + `tar -x`.
function exportTree(root, dest, pathspecs) {
  const tmp = mkdtempSync(join(tmpdir(), 'baco-archive-'));
  try {
    const tar = join(tmp, 'head.tar');
    git(['archive', '--format=tar', '-o', tar, 'HEAD', '--', ...pathspecs], root);
    mkdirSync(dest, { recursive: true });
    execFileSync('tar', ['-xf', tar, '-C', dest], { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function run(args, ctx) {
  const entId = args._[0];
  if (!entId || !ENT_ID.test(entId)) return usageError();
  const mode = args.flags.mode ?? 'pacote';
  if (!MODES.includes(mode)) return usageError();
  const destFlag = args.flags.dest;
  if (destFlag !== undefined && (mode !== 'repositorio' || typeof destFlag !== 'string')) return usageError();
  const prFlag = args.flags.pr;
  if (prFlag !== undefined && (mode !== 'pr' || typeof prFlag !== 'string' || !prFlag.trim())) return usageError();
  const qaFlag = args.flags.qa;
  if (qaFlag !== undefined && (mode !== 'pr' || [].concat(qaFlag).some((q) => typeof q !== 'string'))) return usageError();
  const dir = deliveryDir(ctx.root, ctx.config, entId);
  const { specs: planSpecs, baseRef } = readPlanHeader(readText(join(dir, 'plano.md')));
  const revDir = join(dir, 'revisao');
  // R21: the delta base is the head recorded in the handoff the LATEST imported verdict answered.
  // No verdict (or one that answered no handoff) -> a full handoff from the plan Base.
  const reviewed = latestVerdict(revDir);
  const sinceRef = reviewed?.reviewedHead ?? null;
  const sinceRound = sinceRef ? Number(/-(\d+)\.md$/.exec(reviewed.handoff ?? '')?.[1] ?? 0) || null : null;
  const base = sinceRef ?? baseRef;
  if (!base) return { code: 64, data: {}, messages: [{ key: 'handoff.no_base' }] };
  const round = nextNumber(revDir, 'handoff');

  let dest = null;
  if (mode === 'repositorio') {
    dest = typeof destFlag === 'string'
      ? resolve(ctx.cwd, destFlag)
      : join(dirname(ctx.root), `${basename(ctx.root)}-revisao-${entId}-r${round}`);
    if (insideRepo(dest, ctx.root)) return { code: 64, data: {}, messages: [{ key: 'handoff.dest_inside_repo', params: { dest } }] };
    if (existsSync(dest) && !isEmptyDir(dest)) return { code: 64, data: {}, messages: [{ key: 'handoff.dest_not_empty', params: { dest } }] };
  } else if (mode === 'pr') {
    // Inside the repo, in the git-ignored logs folder: the reviewer reads the project in place.
    // NN follows handoff-NN.md, so an existing folder for this round was left by a run interrupted
    // before its handoff was written: it is reused (pedido.md is rewritten, so an old resposta.md
    // there is older than it and import-pr-verdict refuses it).
    dest = join(ctx.root, '.baco', 'logs', 'revisao-pr', `${entId}-r${round}`);
    if (existsSync(dest) && !statSync(dest).isDirectory()) return { code: 64, data: {}, messages: [{ key: 'handoff.dest_not_empty', params: { dest } }] };
  }

  const head = revParse('HEAD', ctx.root);
  // The packet never carries the delivery folder: progress log, reports, earlier packets and verdicts.
  const docsRoot = String(ctx.config.docs_root ?? 'docs').replace(/\/+$/, '');
  const pathspecs = ['.', `:(exclude)${docsRoot}/entregas/**`];
  const diff = diffPatch(base, head, pathspecs, ctx.root);
  // Delta round: a file unchanged since the reviewed head is named, not repeated.
  const unchangedSince = (rel) => (sinceRef && sinceRound && rel && diffQuiet(sinceRef, head, [`:(literal)${rel}`], ctx.root) ? sinceRound : null);

  const specs = planSpecs.map((s) => {
    const file = resolve(ctx.root, s.path);
    const defs = existsSync(file) ? readSpec(file).definitions.filter((d) => DEFINITION_KINDS.has(d.kind)) : [];
    return { path: s.path, version: s.version, definitionsText: defs.map((d) => `- ${d.text}`).join('\n'), unchangedSince: unchangedSince(repoRelative(file, ctx.root)) };
  });
  const adrFlag = args.flags.adr;
  const adrs = (adrFlag === undefined || adrFlag === true ? [] : [].concat(adrFlag))
    .map((p) => {
      const file = resolve(ctx.cwd, p);
      return { path: p, text: readText(file), unchangedSince: unchangedSince(repoRelative(file, ctx.root)) };
    });
  // `--trace` is repeatable (one per spec): the criteria of every trace go into the tests section.
  const traceFlag = args.flags.trace;
  const tracePaths = (traceFlag === undefined || traceFlag === true ? [] : [].concat(traceFlag)).filter((p) => typeof p === 'string');
  let trace = null;
  if (tracePaths.length) {
    const loaded = [];
    for (const tracePath of tracePaths) {
      const r = loadTrace(resolve(ctx.cwd, tracePath)); // ENOENT -> 65 in the dispatcher
      if (r.error) {
        return { code: 65, data: { detail: r.detail }, messages: [{ key: 'handoff.bad_trace', params: { path: tracePath, reason: t(ctx.lang, `acceptance.bad_trace.${r.error}`) } }] };
      }
      loaded.push(r.trace);
    }
    const { cas } = mergeTraces(loaded);
    const summary = { proven: 0, failed: 0, pending: 0, uncovered: 0 };
    for (const c of cas) if (c.status in summary) summary[c.status] += 1;
    trace = { cas, summary };
  }

  const failedCases = junitFiles(args, ctx)
    .flatMap((f) => parseJUnit(readText(f))).filter((c) => c.status === 'failed');
  const file = join(revDir, `handoff-${round}.md`);
  let body;
  const extra = {};
  if (mode === 'pr') {
    mkdirSync(dest, { recursive: true });
    const diffFile = join(dest, 'mudancas.diff');
    writeFileSync(diffFile, diff);
    const pr = typeof prFlag === 'string' ? prFlag.trim() : null;
    const rel = (p) => { const file = resolve(ctx.cwd, p); return repoRelative(file, ctx.root) ?? p; };
    const qa = (qaFlag === undefined ? [] : [].concat(qaFlag)).map((p) => ({ path: rel(p), unchangedSince: unchangedSince(repoRelative(resolve(ctx.cwd, p), ctx.root)) }));
    extra.request = join(dest, 'pedido.md');
    extra.answer = join(dest, 'resposta.md');
    const inRepo = (abs) => relative(ctx.root, abs).split('\\').join('/');
    writeFileSync(extra.request, renderPrRequest({
      entId, round, baseSha: revParse(base, ctx.root), head, sinceRound, diffFile: inRepo(diffFile), answerFile: inRepo(extra.answer), specs, qa,
      adrs: adrs.map((a) => ({ ...a, path: rel(a.path) })), trace, failedCases, docsRoot, lang: ctx.lang,
      reviewerPrompt: readText(PR_PROMPT_FILE),
    }));
    body = renderPrHandoff({ entId, pr, request: inRepo(extra.request), answer: inRepo(extra.answer), sinceRef, lang: ctx.lang });
  } else if (mode === 'repositorio') {
    exportTree(ctx.root, dest, pathspecs);
    writeFileSync(join(dest, 'mudancas.diff'), diff);
    // In the copy, ADR paths are listed relative to the repo root (they are at the same place there).
    const repoAdrs = adrs.map((a) => ({ ...a, path: repoRelative(resolve(ctx.cwd, a.path), ctx.root) ?? a.path }));
    writeFileSync(join(dest, 'REVISAO.md'), renderReviewGuide({
      entId, round, baseSha: revParse(base, ctx.root), head, sinceRound, specs, adrs: repoAdrs, trace, failedCases, docsRoot,
      lang: ctx.lang, reviewerPrompt: readText(REPO_PROMPT_FILE),
    }));
    body = renderRepoHandoff({ entId, dest, sinceRef, lang: ctx.lang });
  } else {
    body = renderHandoff({
      entId, specs, diff, trace, failedCases, adrs, sinceRef, lang: ctx.lang,
      reviewerPrompt: readText(PROMPT_FILE),
    });
  }
  mkdirSync(revDir, { recursive: true });
  writeFileSync(file, `<!-- baco:head ${head} -->\n${body}`);
  const messages = [{ key: 'handoff.written', params: { round, file } }];
  if (mode === 'repositorio') messages.push({ key: 'handoff.exported', params: { dest } });
  if (mode === 'pr') {
    messages.push({ key: 'handoff.pr.written', params: extra });
    // `git check-ignore -q`: 0 = ignored, 1 = not ignored, anything else = cannot tell (no warning).
    const probe = spawnSync('git', ['check-ignore', '-q', '.baco/logs/revisao-pr/x.md'], { cwd: ctx.root, stdio: 'ignore' });
    if (probe.status === 1) messages.push({ key: 'handoff.pr.logs_not_ignored', params: { path: '.baco/logs/' } });
  }
  return { code: 0, data: { file, round: Number(round), mode, dest, ...extra }, messages };
}
