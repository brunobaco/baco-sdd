#!/usr/bin/env node
// PreToolUse (AskUserQuestion) and Stop hook: keeps an autonomous delivery from stopping in the
// middle. While a delivery's progresso.md says `Execução autônoma: sim` and `Situação: rodando`,
// the conversation recorded in `Conversa condutora` (matched by its session id) may not ask a
// blocking question, which would hold the whole delivery until the person answers, nor end its
// turn: the rule in prose (implementation.md, section 7) was not enough on its own.
// Any other conversation, a subagent, and a delivery that is not running are left alone. The
// conductor ends legitimately by changing the situation (`parado para conversa nova`, `pronta para
// testar`, `parado pela pessoa`). Against a loop, Stop goes through after three blocks in a row
// with progresso.md unchanged. The progresso.md read is the main checkout's, also from a task
// worktree. Claude Code only. Fails open: any error allows and exits 0.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseRetomada } from '../skills/baco-sdd/scripts/commands/check-stalled.mjs';
import { hookStateDir, sessionStateFile } from '../skills/baco-sdd/scripts/lib/hookrules.mjs';
import { isMainModule } from '../skills/baco-sdd/scripts/lib/entrypoint.mjs';
import { readHookInput, preToolAnswer } from './host.mjs';

export const STOP_BLOCK_LIMIT = 3;
const ALLOW = null;

// Root of the main checkout: from a worktree, git's common dir is the main repo's .git.
function mainRoot(cwd) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const dir = dirname(isAbsolute(common) ? common : resolve(cwd, common));
  return existsSync(join(dir, '.baco', 'config.yaml')) ? dir : null;
}

function docsRoot(root) {
  try {
    const m = /^docs_root:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/m.exec(readFileSync(join(root, '.baco', 'config.yaml'), 'utf8'));
    if (m) return m[1].trim();
  } catch { /* default */ }
  return 'docs';
}

// The running autonomous delivery this session conducts, or null.
export function conductedDelivery(cwd, session) {
  if (!cwd || !session) return null;
  const root = mainRoot(cwd);
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
    if (!info.conductor || !info.conductor.includes(session)) continue;
    return { id: m[1], file, mtimeMs: statSync(file).mtimeMs };
  }
  return null;
}

const askReason = (id) => `BACO, execução autônoma: esta conversa conduz a ${id}, e uma pergunta aqui travaria a entrega inteira até a pessoa responder (pode ser a noite toda). Não pergunte. Decida pela sua recomendação e siga. Registre a decisão em "Decisões registradas" do progresso.md como "decidido pelo agente, conferir no fim", com a alternativa e o que muda, e ponha a pergunta em "## Esperando a pessoa": a pessoa confere tudo numa lista só, no fim, antes da junção. Ação sem volta (migração destrutiva, apagar dado, publicar em produção) e junção na principal não se fazem: ficam na fila do fim, e o resto segue.`;

const stopReason = (id) => `BACO, execução autônoma: a ${id} está rodando (progresso.md, Situação: rodando) e esta conversa é a condutora. Não encerre a resposta: siga para o próximo passo da "## Retomada". Se há chamada em segundo plano (teste, subagente, outra ferramenta de IA), espere por ela aqui, em primeiro plano, em trechos de até 9 minutos. Dúvida não para a entrega: decida pela sua recomendação, registre como "decidido pelo agente, conferir no fim" e siga. Para encerrar de verdade, mude antes a Situação na "## Retomada": "parado para conversa nova" na troca de conversa, "pronta para testar" no fim, "esperando a pessoa" só quando nada mais pode andar sem ela (ação sem volta ou junção na principal), ou "parado pela pessoa" quando a pessoa pediu para parar.`;

// Consecutive Stop blocks for this session while progresso.md stays the same.
function countStopBlock(session, mtimeMs, again) {
  const file = sessionStateFile(session, '-autonomy-stop');
  let st = { mtimeMs: null, blocks: 0 };
  try { st = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first time */ }
  const blocks = again && st.mtimeMs === mtimeMs ? st.blocks : 0;
  if (blocks >= STOP_BLOCK_LIMIT) return false;
  try {
    mkdirSync(hookStateDir(), { recursive: true });
    writeFileSync(file, JSON.stringify({ mtimeMs, blocks: blocks + 1 }));
  } catch { /* state that cannot be saved still blocks this time */ }
  return true;
}

// `hook` is the normalized input of host.mjs. Returns the Claude Code answer object, or null.
export function decide(hook) {
  if (hook.host !== 'claude' || hook.subagent()) return ALLOW;
  const isAsk = hook.event === 'PreToolUse' && hook.tool === 'AskUserQuestion';
  const isStop = hook.event === 'Stop';
  if (!isAsk && !isStop) return ALLOW;
  const d = conductedDelivery(hook.cwd, hook.session);
  if (!d) return ALLOW;
  if (isAsk) return { pre: { deny: true, reason: askReason(d.id) } };
  if (!countStopBlock(hook.session, d.mtimeMs, hook.raw.stop_hook_active === true)) return ALLOW;
  return { stop: { decision: 'block', reason: stopReason(d.id) } };
}

if (isMainModule(import.meta.url)) {
  let out = '';
  try {
    const hook = readHookInput(JSON.parse(readFileSync(0, 'utf8')));
    const r = decide(hook);
    if (r?.pre) out = preToolAnswer(hook.host, r.pre);
    else if (r?.stop) out = JSON.stringify(r.stop);
  } catch (err) {
    if (err?.message) process.stderr.write(`baco autonomy-guard: ${err.message} (permitido)\n`);
  }
  process.stdout.write(out);
  process.exit(0);
}
