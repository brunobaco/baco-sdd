#!/usr/bin/env node
// PreToolUse (Claude Code: AskUserQuestion; Antigravity: ask_question) and Stop hook: keeps an
// autonomous delivery from stopping in the middle. While a delivery's progresso.md says
// `Execução autônoma: sim` and `Situação: rodando`, the conversation recorded in
// `Conversa condutora` (the first session id written there) may not ask a blocking question, which
// would hold the whole delivery until the person answers, nor end its turn: the rule in prose
// (implementation.md, section 7) was not enough on its own.
// Any other conversation, a subagent, and a delivery that is not running are left alone. In
// Antigravity, a Stop whose `terminationReason` is not `NO_TOOL_CALL` (user cancel, error, limit)
// is also left alone. The conductor ends legitimately by changing the situation to one of the
// template's stops (`parado para conversa nova`, `fim`, `parado por pergunta`, `parado a pedido`).
// Against a loop, Stop goes through after three blocks with no new commit on any branch of the
// delivery (touching progresso.md is not progress), and after ten blocks in one hour whatever
// happened. The project is found from the conversation's folder upward, also in a subfolder of a
// larger repository, and progresso.md is read from the main checkout even from a task worktree.
// Fails open: any error allows and exits 0.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseRetomada } from '../skills/baco-sdd/scripts/commands/check-stalled.mjs';
import { hookStateDir, sessionStateFile } from '../skills/baco-sdd/scripts/lib/hookrules.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, preToolAnswer, stopAnswer } from './host.mjs';

export const STOP_BLOCK_LIMIT = 3;
export const STOP_HOURLY_LIMIT = 10;
const HOUR_MS = 60 * 60 * 1000;
const ALLOW = null;
const SESSION_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ASK_TOOL = { claude: 'AskUserQuestion', antigravity: 'ask_question' };

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// The BACO project the folder belongs to, in the main checkout: the nearest folder with
// .baco/config.yaml from `cwd` up to the top of its git work tree, mapped from a worktree to the
// same place in the main checkout (git's common dir is the main repo's .git).
function projectRoot(cwd) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  let dir = resolve(cwd);
  while (!existsSync(join(dir, '.baco', 'config.yaml'))) {
    if (dir === top || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
  const common = git(['rev-parse', '--git-common-dir'], cwd);
  const mainTop = dirname(isAbsolute(common) ? common : resolve(cwd, common));
  const main = join(mainTop, relative(top, dir));
  return existsSync(join(main, '.baco', 'config.yaml')) ? main : dir;
}

function docsRoot(root) {
  try {
    const m = /^docs_root:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/m.exec(readFileSync(join(root, '.baco', 'config.yaml'), 'utf8'));
    if (m) return m[1].trim();
  } catch { /* default */ }
  return 'docs';
}

// The conductor is the first session id in the field; a field without one is compared whole.
function isConductor(field, session) {
  if (!field || !session) return false;
  const first = SESSION_ID.exec(field);
  return first ? first[0].toLowerCase() === session.toLowerCase() : field.includes(session);
}

// The running autonomous delivery this session conducts, or null.
export function conductedDelivery(cwd, session) {
  if (!cwd || !session) return null;
  const root = projectRoot(cwd);
  if (!root) return null;
  const base = join(root, docsRoot(root), 'entregas');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base, { withFileTypes: true })) {
    const m = /^(ENT-\d{3})-/.exec(d.name);
    if (!m || !d.isDirectory()) continue;
    const file = join(base, d.name, 'progresso.md');
    if (!existsSync(file)) continue;
    const info = parseRetomada(readFileSync(file, 'utf8'));
    if (!info.autonomous || !/^rodando(?:\b|$)/.test(info.status ?? '')) continue;
    if (!isConductor(info.conductor, session)) continue;
    return { id: m[1], root };
  }
  return null;
}

// Progress of the run: the tips of the delivery branch and of its task branches.
function progressKey(root, id) {
  try {
    return git(['for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/baco/${id}`, `refs/heads/baco/${id}-*`], root);
  } catch {
    return '';
  }
}

const askReason = (id) => `BACO, execução autônoma: esta conversa conduz a ${id}, e uma pergunta aqui travaria a entrega inteira até a pessoa responder (pode ser a noite toda). Não pergunte. Decida pela sua recomendação e siga. Registre a decisão em "Decisões registradas" do progresso.md como "decidido pelo agente, conferir no fim", com a alternativa e o que muda, e ponha a pergunta em "## Esperando a pessoa": a pessoa confere tudo numa lista só, no fim, antes da junção. Ação sem volta (migração destrutiva, apagar dado, publicar em produção) e junção na principal não se fazem: ficam na fila do fim, e o resto segue.`;

const stopReason = (id) => `BACO, execução autônoma: a ${id} está rodando (progresso.md, Situação: rodando) e esta conversa é a condutora. Não encerre a resposta: siga para o próximo passo da "## Retomada". Se há chamada em segundo plano (teste, subagente, outra ferramenta de IA), espere por ela aqui, em primeiro plano, em trechos de até 9 minutos. Dúvida não para a entrega: decida pela sua recomendação, registre como "decidido pelo agente, conferir no fim" e siga. Para encerrar de verdade, mude antes a Situação na "## Retomada": "parado para conversa nova" na troca de conversa, "fim" quando a entrega estiver pronta para testar, "parado por pergunta" só quando nada mais pode andar sem a pessoa (ação sem volta ou junção na principal), ou "parado a pedido" quando a pessoa pediu para parar.`;

// Whether this Stop may still be blocked, counting blocks without progress and blocks in the last hour.
function mayBlockStop(session, key, now = Date.now()) {
  const file = sessionStateFile(session, '-autonomy-stop');
  let st = {};
  try { st = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first time */ }
  const times = (Array.isArray(st.times) ? st.times : []).filter((t) => Number.isFinite(t) && now - t < HOUR_MS);
  const blocks = st.key === key && Number.isInteger(st.blocks) ? st.blocks : 0;
  if (blocks >= STOP_BLOCK_LIMIT || times.length >= STOP_HOURLY_LIMIT) return false;
  try {
    mkdirSync(hookStateDir(), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, blocks: blocks + 1, times: [...times, now] }));
  } catch { /* state that cannot be saved still blocks this time */ }
  return true;
}

// `hook` is the normalized input of host.mjs. Returns { pre } or { stop } for either host, or null.
export function decide(hook) {
  if (!(hook.host in ASK_TOOL) || hook.subagent()) return ALLOW;
  const isAsk = hook.event === 'PreToolUse' && hook.tool === ASK_TOOL[hook.host];
  const isStop = hook.event === 'Stop';
  if (!isAsk && !isStop) return ALLOW;
  if (isStop && hook.host === 'antigravity' && hook.terminationReason && hook.terminationReason !== 'NO_TOOL_CALL') return ALLOW;
  const d = conductedDelivery(hook.cwd, hook.session);
  if (!d) return ALLOW;
  if (isAsk) return { pre: { deny: true, reason: askReason(d.id) } };
  if (!mayBlockStop(hook.session, progressKey(d.root, d.id))) return ALLOW;
  return { stop: { block: true, reason: stopReason(d.id) } };
}

function formatAnswer(hook, result) {
  if (hook.event === 'PreToolUse') return preToolAnswer(hook.host, result?.pre ?? { deny: false });
  if (hook.event === 'Stop') return stopAnswer(hook.host, result?.stop ?? { block: false });
  // Unknown event or unreadable input: `decision: "allow"` fails open for both PreToolUse and Stop in Antigravity.
  return preToolAnswer(hook.host, { deny: false });
}

if (isMainModule(import.meta.url)) {
  let hook = readHookInput(null);
  let result = ALLOW;
  try {
    hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    result = decide(hook);
  } catch (err) {
    if (err?.message) process.stderr.write(`baco autonomy-guard: ${err.message} (permitido)\n`);
  }
  process.stdout.write(formatAnswer(hook, result));
  process.exit(0);
}
