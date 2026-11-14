import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deliveryDir, latestHandoff, latestVerdict, ENT_ID } from '../lib/delivery.mjs';
import { showFile } from '../lib/git.mjs';
import { readText } from '../lib/markdown.mjs';
import { importVerdictText } from './import-verdict.mjs';

export const usage = 'baco import-pr-verdict <ENT-NNN> [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const toPosix = (p) => p.split('\\').join('/');

// The automatic import of the agent reviewer's answer in mode pr. It takes no file: it resolves the
// answer of the LATEST round only, `.baco/logs/revisao-pr/ENT-NNN-rNN/resposta.md`, where NN is the
// latest handoff-NN.md, which must be committed. It refuses a round already answered by a verdict, a
// missing answer and an answer older than its pedido.md; then it imports exactly like import-verdict.
export async function run(args, ctx) {
  const [entId, ...extra] = args._;
  if (!entId || !ENT_ID.test(entId) || extra.length) return usageError();
  const revDir = join(deliveryDir(ctx.root, ctx.config, entId), 'revisao');
  const handoff = latestHandoff(revDir);
  if (!handoff) return { code: 64, data: {}, messages: [{ key: 'prverdict.no_handoff', params: { id: entId } }] };
  const handoffRel = toPosix(relative(ctx.root, join(revDir, handoff.name)));
  if (showFile('HEAD', handoffRel, ctx.root) === null) {
    return { code: 64, data: {}, messages: [{ key: 'prverdict.handoff_not_committed', params: { file: handoffRel } }] };
  }
  if (latestVerdict(revDir)?.handoff === handoff.name) {
    return { code: 64, data: {}, messages: [{ key: 'prverdict.already_imported', params: { file: handoff.name } }] };
  }
  const round = /-(\d+)\.md$/.exec(handoff.name)[1];
  const folder = join(ctx.root, '.baco', 'logs', 'revisao-pr', `${entId}-r${round}`);
  const answer = join(folder, 'resposta.md');
  const request = join(folder, 'pedido.md');
  const answerRel = toPosix(relative(ctx.root, answer));
  if (!existsSync(answer)) return { code: 65, data: {}, messages: [{ key: 'prverdict.no_answer', params: { path: answerRel } }] };
  if (!existsSync(request) || statSync(answer).mtimeMs < statSync(request).mtimeMs) {
    return { code: 65, data: {}, messages: [{ key: 'prverdict.answer_stale', params: { path: answerRel } }] };
  }
  const result = importVerdictText(readText(answer), entId, ctx, { requireScope: true });
  if (result.code === 0 || result.code === 3) result.data = { ...result.data, answer: answerRel };
  return result;
}
