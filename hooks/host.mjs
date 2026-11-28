// The two hosts whose hooks BACO ships, Claude Code and the Antigravity CLI, read and answer in
// different formats. Each hook reads its input through readHookInput and answers through the
// functions below, so its rules stay the same in both. The Antigravity hooks.json passes
// `--host antigravity`, so the answer keeps that host's format even when the input is unreadable:
// there, a PreToolUse answer without a `decision` denies the tool (checked with CLI 1.5.10).
import { closeSync, openSync, readSync } from 'node:fs';

const FIRST_LINE_BYTES = 16 * 1024;
const str = (v) => (typeof v === 'string' && v ? v : null);

// Antigravity has no field that marks a subagent: each subagent is a conversation of its own, whose
// transcript starts with a system message sent by the parent conversation (`sender=<id>`), while a
// main conversation starts with the person's request. Any doubt reads as the main conversation.
export function isAntigravitySubagent(transcriptPath) {
  if (!str(transcriptPath)) return false;
  let fd;
  try {
    fd = openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(FIRST_LINE_BYTES);
    const n = readSync(fd, buf, 0, FIRST_LINE_BYTES, 0);
    const line = buf.subarray(0, n).toString('utf8').split('\n')[0];
    const first = JSON.parse(line);
    return first?.type === 'SYSTEM_MESSAGE' && /sender=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(String(first.content ?? ''));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function readHookInput(input, argv = process.argv.slice(2)) {
  const i = argv.indexOf('--host');
  const host = i >= 0 && argv[i + 1] === 'antigravity' ? 'antigravity' : 'claude';
  const raw = input && typeof input === 'object' ? input : {};
  if (host === 'antigravity') {
    const args = raw.toolCall?.args && typeof raw.toolCall.args === 'object' ? raw.toolCall.args : {};
    const transcript = str(raw.transcriptPath);
    return {
      host, raw,
      event: str(raw.hookEventName),
      session: str(raw.conversationId),
      transcript,
      cwd: str(raw.cwd),
      tool: str(raw.toolCall?.name),
      filePath: str(args.Path) ?? str(args.TargetFile) ?? str(args.AbsolutePath) ?? str(args.FilePath),
      command: str(args.CommandLine),
      terminationReason: str(raw.terminationReason),
      stopHookActive: raw.continuationActive === true,
      compact: false,
      subagent: () => isAntigravitySubagent(transcript),
    };
  }
  const ti = raw.tool_input && typeof raw.tool_input === 'object' ? raw.tool_input : {};
  return {
    host, raw,
    event: str(raw.hook_event_name),
    session: str(raw.session_id),
    transcript: str(raw.transcript_path),
    cwd: str(raw.cwd),
    tool: str(raw.tool_name),
    filePath: str(ti.file_path) ?? str(ti.notebook_path),
    command: str(ti.command),
    terminationReason: null,
    stopHookActive: raw.stop_hook_active === true,
    compact: raw.source === 'compact',
    // Claude Code sends `agent_id` only inside a subagent.
    subagent: () => raw.agent_id !== undefined && raw.agent_id !== null,
  };
}

// PreToolUse: Claude Code takes no output as "no objection"; Antigravity needs `allow`, which leaves
// its permission rules in charge (unlike `auto_approve`).
export function preToolAnswer(host, result) {
  if (host === 'antigravity') return JSON.stringify(result.deny ? { decision: 'deny', reason: result.reason } : { decision: 'allow' });
  return result.deny
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } })
    : '';
}

// Stop: Claude Code blocks a turn end with `{ decision: "block", reason }`; Antigravity CLI 1.5.15
// re-enters the loop with `{ decision: "continue", reason }` and lets it end with `{}` (or any
// decision other than "continue").
export function stopAnswer(host, result) {
  if (host === 'antigravity') return result?.block ? JSON.stringify({ decision: 'continue', reason: result.reason }) : '{}';
  return result?.block ? JSON.stringify({ decision: 'block', reason: result.reason }) : '';
}

// Text for the model: Claude Code's additionalContext, or an Antigravity system message.
export function contextAnswer(host, event, text) {
  if (host === 'antigravity') return JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: text } }] });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

// Nothing to say: Antigravity expects a JSON object on stdout.
export const quietAnswer = (host) => (host === 'antigravity' ? '{}' : '');
