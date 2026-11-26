import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryDir, computeDeliveryScope, unmarkedCriteria, ENT_ID } from '../lib/delivery.mjs';
import { readText } from '../lib/markdown.mjs';
import { PLAN_APPROVAL_FILE, renderPlanApproval, portraitInHistory } from '../lib/plan-approval.mjs';
import { formatZoned } from './waive-review.mjs';

export const usage = 'baco approve-plan <ENT-NNN> [--by <name>] [--replace] [--json] [--cwd <dir>]';

const usageError = () => ({ code: 64, data: {}, messages: [{ key: 'cli.usage', params: { usage } }] });

// Records the approved delivery cut portrait in aprovacao-plano.md:
// specs (plan header and spec file versions), CA hashes, CA/CT universe (`path#ID`),
// out-of-scope CAs/CTs, approver, and plan gate state.
// Refuses to overwrite an existing portrait unless --replace is passed (exit 2), and also when the
// file is gone but a commit of the branch history had it (exit 2, `deletedInHistory`).
// With empty --by (or omitted --by when gates.plan is off), records gate: 'off'.
// With gates.plan off, a first recording is always gate: 'off' (--by ignored).
export async function run(args, ctx) {
  const entId = args._[0];
  if (!entId || !ENT_ID.test(entId) || args._.length > 1) return usageError();
  const replace = args.flags.replace === true;
  const rawBy = args.flags.by;

  let by = '';
  let gate = 'on';
  if (rawBy === undefined) {
    if (ctx.config?.gates?.plan === false) gate = 'off';
    else return usageError();
  } else if (rawBy === true || (typeof rawBy === 'string' && !rawBy.trim())) {
    by = '';
    gate = 'off';
  } else if (typeof rawBy === 'string') {
    by = rawBy.trim();
    gate = 'on';
  } else {
    return usageError();
  }
  // With the plan gate off nobody approved the plan: a first recording never
  // names an approver, whatever --by says. The person confirms the cut only
  // through --replace, which the execution rules always ask for.
  if (ctx.config?.gates?.plan === false && !replace) {
    by = '';
    gate = 'off';
  }

  const dir = deliveryDir(ctx.root, ctx.config, entId);
  const file = join(dir, PLAN_APPROVAL_FILE);
  if (existsSync(file) && !replace) {
    return {
      code: 2,
      data: { file, alreadyExists: true },
      messages: [{ key: 'approve_plan.already_exists', params: { file } }],
    };
  }
  // Deleting the file must not reopen a first recording: a portrait that ever existed in a commit of
  // the branch (under any folder name of this delivery) also needs --replace.
  if (!replace) {
    const past = portraitInHistory({ root: ctx.root, config: ctx.config, entId });
    if (past) {
      return {
        code: 2,
        data: { file, deletedInHistory: { commit: past.commit, path: past.path } },
        messages: [{ key: 'approve_plan.deleted_in_history', params: { file, path: past.path, commit: past.commit.slice(0, 12) } }],
      };
    }
  }

  const planText = readText(join(dir, 'plano.md')); // ENOENT -> 65 in dispatcher
  const scope = computeDeliveryScope({ root: ctx.root, planText, config: ctx.config });
  const warnings = scope.unrecognizedTasks.map((u) => ({
    key: 'plan.unrecognized_task_marker',
    params: { cas: u.cas.join(', '), value: u.value, line: u.line },
  }));
  // Criteria of the plan specs with neither a task nor the out-of-scope mark: in a slice delivery
  // they would surface at the end as manual tests the person never had to do. The planner decides.
  const unmarked = unmarkedCriteria(scope);
  if (unmarked.length) warnings.push({ key: 'approve_plan.unmarked', params: { ids: unmarked.join(', ') } });

  if (scope.contradictions.length) {
    return {
      code: 1,
      data: { contradictions: scope.contradictions, unrecognizedTasks: scope.unrecognizedTasks },
      messages: [...warnings, { key: 'approve_plan.contradiction', params: { ids: scope.contradictions.join(', ') } }],
    };
  }

  const date = formatZoned(ctx.now ? ctx.now() : new Date());
  writeFileSync(file, renderPlanApproval({
    entId,
    by,
    gate,
    date,
    specs: scope.specs,
    specVersions: scope.specVersions,
    criteria: scope.criteria,
    universeCas: scope.universeCaKeys,
    universeScenarios: scope.universeScenarioKeys,
    outOfScope: scope.outOfScope,
    outOfScopeScenarios: scope.outOfScopeScenarios,
  }));
  const msgKey = gate === 'off' ? 'approve_plan.written_gate_off' : 'approve_plan.written';
  return {
    code: 0,
    data: {
      file,
      by,
      gate,
      date,
      specs: scope.specs,
      specVersions: scope.specVersions,
      universeCas: scope.universeCaKeys,
      universeScenarios: scope.universeScenarioKeys,
      outOfScope: scope.outOfScope,
      outOfScopeScenarios: scope.outOfScopeScenarios,
      ...(scope.unrecognizedTasks.length ? { unrecognizedTasks: scope.unrecognizedTasks } : {}),
      ...(unmarked.length ? { unmarked } : {}),
    },
    messages: [
      ...warnings,
      {
        key: msgKey,
        params: { file, by, date, cas: scope.outOfScope.length, scenarios: scope.outOfScopeScenarios.length },
      },
    ],
  };
}
