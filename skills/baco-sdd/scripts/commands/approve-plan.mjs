import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deliveryDir, readPlanHeader, readPlanScope, ENT_ID } from '../lib/delivery.mjs';
import { readText } from '../lib/markdown.mjs';
import { readSpec } from '../lib/spec.mjs';
import { readQa, qaPathFor } from '../lib/qa.mjs';
import { PLAN_APPROVAL_FILE, renderPlanApproval, sha256Text } from '../lib/plan-approval.mjs';
import { formatZoned } from './waive-review.mjs';

export const usage = 'baco approve-plan <ENT-NNN> --by <name> [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Records the human approval of the plan gate: the hash of plano.md and the approved out-of-scope
// criteria and unlinked scenarios. Refuses with exit 1 when plano.md or QA has a scope contradiction
// (a criterion marked out of scope that also has a real task in ## Cobertura).
export async function run(args, ctx) {
  const entId = args._[0];
  const by = str(args.flags.by);
  if (!entId || !ENT_ID.test(entId) || args._.length > 1 || !by) return usageError();

  const dir = deliveryDir(ctx.root, ctx.config, entId);
  const planPath = join(dir, 'plano.md');
  const planText = readText(planPath); // ENOENT -> 65 in dispatcher
  const { specs: planSpecs } = readPlanHeader(planText);
  const scope = readPlanScope(planText);

  const outOfScope = new Set(scope.outOfScope);
  const outOfScopeScenarios = new Set();
  for (const { path } of planSpecs) {
    const specAbs = resolve(ctx.root, path);
    if (!existsSync(specAbs)) continue;
    const spec = readSpec(specAbs);
    const qaAbs = qaPathFor(specAbs);
    if (!existsSync(qaAbs)) continue;
    const qa = readQa(qaAbs, { specialist: ctx.config?.qa?.specialist });
    const caIds = new Set(spec.definitions.filter((d) => d.kind === 'CA').map((d) => d.id));
    for (const caId of caIds) {
      const linked = qa.scenarios.filter((s) => s.contracts.includes(caId));
      if (linked.length > 0 && linked.every((s) => s.automation === 'out_of_scope')) outOfScope.add(caId);
    }
    for (const sc of qa.scenarios.filter((s) => !s.contracts.some((id) => caIds.has(id)))) {
      if (sc.automation === 'out_of_scope') outOfScopeScenarios.add(sc.id);
    }
  }

  const contradictions = [...new Set([
    ...scope.contradictions,
    ...[...outOfScope].filter((id) => scope.coveredByTask.has(id)),
  ])].sort();
  if (contradictions.length) {
    return {
      code: 1,
      data: { contradictions },
      messages: [{ key: 'approve_plan.contradiction', params: { ids: contradictions.join(', ') } }],
    };
  }

  const date = formatZoned(ctx.now ? ctx.now() : new Date());
  const planSha256 = sha256Text(planText);
  const sortedCas = [...outOfScope].sort();
  const sortedScenarios = [...outOfScopeScenarios].sort();
  const file = join(dir, PLAN_APPROVAL_FILE);
  writeFileSync(file, renderPlanApproval({
    entId,
    by,
    date,
    planSha256,
    outOfScope: sortedCas,
    outOfScopeScenarios: sortedScenarios,
  }));
  return {
    code: 0,
    data: { file, by, date, planSha256, outOfScope: sortedCas, outOfScopeScenarios: sortedScenarios },
    messages: [{ key: 'approve_plan.written', params: { file, by, date, count: sortedCas.length } }],
  };
}
