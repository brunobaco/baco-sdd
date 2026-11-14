import { currentBranch } from '../lib/git.mjs';
import { protectedBranches } from '../lib/config.mjs';

export const usage = 'baco check-branch [--json] [--cwd <dir>]';
export const needsRepo = true;

export async function run(args, ctx) {
  const branch = currentBranch(ctx.root);
  const isProtected = protectedBranches(ctx.config).includes(branch);
  return {
    code: isProtected ? 1 : 0,
    data: { branch, protected: isProtected },
    messages: [{ key: isProtected ? 'branch.protected' : 'branch.ok', params: { branch } }],
  };
}
