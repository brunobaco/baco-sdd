# Environments: levels, efforts and harnesses

Load this file when you dispatch a role or an implementer, when the plan assigns work to a harness, or when the person adds an AI subscription. BACO speaks of a level and an effort; the environment (harness: Claude Code, Codex, OpenCode or another AI tool) decides which real model and effort that means.

## 1. Levels and efforts

- Level: `forte` (the most capable model the environment offers), `medio` (the intermediate one), `leve` (the fastest and cheapest).
- Effort: `alto`, `medio`, `baixo`.
- Implementers take theirs from `models.<class>` in `.baco/config.yaml` (classes `mechanical`, `standard`, `risky`; defaults `leve/baixo`, `medio/medio`, `forte/medio`). The old form `model: opus|sonnet|haiku` still loads and means the same levels.
- Every other role has a fixed level and effort. Role file headers write them as `Level` and `Effort`; translate them with the table of the environment in use.

| Role | Level | Effort |
|---|---|---|
| cold-reader | medio | medio |
| spec-auditor | forte | alto |
| architect | forte | alto |
| devils-advocate | forte | medio |
| planner | forte | medio |
| publisher | leve | baixo |
| implementer | per task class | per task class |
| task-reviewer | medio | alto |
| ci-triage | medio | medio |
| final-reviewer | forte | alto |
| acceptance-validator | medio | medio |
| writer | leve | baixo |
| reconciler | forte | medio |
| simplifier | medio | alto |
| pr-reviewer | forte | alto |
| locator | leve | baixo |

The locator is dispatched only by the conductor (review roles cannot start agents), only when a read would be large (several files or a long document), on the harness and model the plan gives it: it returns path, line range and the literal excerpt, never an interpretation, and the conductor reads the original excerpt before deciding. Its output never replaces a spec, criterion, test or code in a review or an acceptance ([locator](roles/locator.md)).

## 2. Claude Code

| BACO | Claude Code |
|---|---|
| forte | `opus` |
| medio | `sonnet` |
| leve | `haiku` |
| alto | `high` |
| medio | `medium` |
| baixo | `low` |

- Each role runs as agent `baco:<role>`; the implementer as `baco:implementer-<class>`. The agent file carries the default model and effort of its role.
- Pass both the model and the effort in every call, even when they match the agent file: the call accepts an explicit effort, and what you pass is what runs. This is how a `models.<class>` override reaches the implementer.
- `xhigh` and `max` only when the human asks for them.

## 3. Codex

Codex model names change often, so this skill names none.

1. At the start of a delivery, read which models the environment offers: the model picker, `~/.codex/config.toml`, and `.codex/agents/*.toml` in the project.
2. Map them: the most capable to `forte`, the intermediate one to `medio`, the fastest or cheapest to `leve`. Effort goes to `model_reasoning_effort`: `alto` to `high`, `medio` to `medium`, `baixo` to `low`.
3. Spawn each role's agent with its model and `model_reasoning_effort`. The config keys `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort` only give defaults; pass the values per spawn anyway. Source: https://developers.openai.com/codex/config-reference.
4. Tell the user the mapping once, in plain words, for example: "Neste ambiente, forte é o modelo X, médio é o Y e leve é o Z."

If you cannot tell which model is which, ask the user once instead of guessing.

## 4. Other environments

Same rule as Codex: read what the environment offers, map most capable, intermediate and fastest to the three levels, tell the user once, and pass model and effort per call when the environment allows it. If it accepts no effort, say so once and go on.

## 5. Harnesses of the project

`harnesses` in `.baco/config.yaml` lists the AI tools this project uses (for example `claude-code`, `codex`, `opencode`), each with `models`, its model name for each level, and `implementers` (default `off`).

**Adding one.** When the person says they have a new subscription or tool, list its models from the tool itself (Codex: the model picker and `~/.codex/config.toml`; OpenCode: `opencode models`; another tool: its own list command or settings), recommend which fits `forte`, `medio` and `leve` and why, in plain words, and save only after the person approves. Never guess a model name. A model only this machine has stays out of versioned files (section 6).

**Who runs what is decided in the plan, never at run time.** The plan gives each task and each role its harness, model and effort ([planning.md](planning.md), sections 4 and 7), and the person approves them with the plan. During construction you follow the plan; when the plan does not name a harness for a role, it runs on yours. If a planned harness is unavailable (not installed, no login, quota), the work it holds waits and goes into the end-of-run summary; never move it to another harness or model on your own.

**Conservative rule.** Until a harness has been tested end to end with BACO, a harness other than the one you run in may take only read-only roles: the reviewers (including `pr-reviewer`) and the `locator`. Implementers stay on your harness, unless the config marks that harness `implementers: on`. The planner applies the same rule.

**Suggested split.** When Codex is installed and its read check passes, configuration suggests to the person (never imposes) this split: conductor, implementers and task reviewers on Claude, the PR reviewer on Codex (most capable model, high effort, read-only), the locator on the lightest Claude model ([configure.md](configure.md), step 9). Reason: in end-to-end runs Codex as the PR reviewer cost about 1% of the usage and found defects the Claude reviews missed, while Codex implementing in its protected mode (no network, no ports) sent installs and browser tests back to the conductor. With only Claude, nothing changes.

**Check before relying on it.** A harness that is installed and logged in may still fail in this machine's sandbox, so before a plan gives it any work, run one short call per mode BACO will use, with its `leve` model and low effort (cheap), and record the result. The checks live in `.baco/logs/harness-check/` (git-ignored); create it first by writing an empty `LEIA.md` there with the edit tool.
- Read mode, for every harness other than yours: from the project root, ask it to run `git rev-parse --short HEAD` and answer only with the output (Codex: `codex exec -m <leve model> -c model_reasoning_effort=low -s read-only -C <project root> -o .baco/logs/harness-check/<harness>-leitura.md "Rode o comando git rev-parse --short HEAD e responda só com a saída dele."`). It passed when the call exits 0 and the answer is the same short sha you get yourself.
- Write mode, only for a harness marked `implementers: on`: in a scratch folder `.baco/logs/harness-check/<harness>-escrita/` (create it the same way), ask it to run `pwd` and write the output to `ok.txt` (Codex: `-s workspace-write -C <scratch folder>`, same prompt shape). It passed when the call exits 0 and `ok.txt` holds that folder's path. This call widens what the harness may write, so it stops for the person's confirmation (configure.md, "Execution rules"): run it when the person is there, at configuration or at planning.
- Capabilities, only for a harness marked `implementers: on`, in the same write call (the scratch folder, the same sandbox): ask it also to (a) fetch from the network, for example `npm view <a small public package> version` or `git ls-remote <a public repository> HEAD`, and (b) bind a local port, for example `node -e "require('net').createServer().listen(0,'127.0.0.1',function(){console.log('porta',this.address().port);this.close()})"`, writing each output to its own file in the scratch folder (`rede.txt`, `porta.txt`). Each is a capability: `rede` and `porta` are `sim` when the call succeeded and the file shows the output, `não` otherwise. A protected mode may have no network and may refuse to bind a port (Codex: no network, `EPERM` on listen); that is a result to report, never something to fix by widening the sandbox. Never turn network on in a sandbox to make a check pass.
- Record each result as one row in `.baco/logs/harnesses.md` (git-ignored, per machine): date and time (from `date`), machine (`hostname`), harness, mode, model, `passou` or `falhou`, for the write mode the capabilities `rede: sim|não` and `porta: sim|não`, and the first line of the error. The planner gives that harness only tasks whose needs it has ([planning.md](planning.md), section 4): a task that installs dependencies needs `rede`, one that opens a local server or runs a browser test needs `porta`. A task that needs what the harness lacks stays on the conductor's harness, or the plan has the conductor do the install and the browser tests and states that cost.
- When a check fails, the harness stays out of the plan for that mode; never retry with the sandbox off (no `--dangerously-bypass-approvals-and-sandbox`, no `danger-full-access`, no sandbox override). Tell the person, in plain words:

> Testei o [ferramenta] aqui e ele não conseguiu [ler o projeto / gravar numa pasta de teste] no modo protegido que eu uso: [primeira linha do erro]. Por isso ele fica fora do plano por enquanto, e [a revisão / a construção] fica com [outra ferramenta]. Para resolver, vale conferir se o login dele está ativo, se o modelo [modelo] existe na sua conta e se o isolamento dele funciona nesta máquina (em alguns servidores e contêineres não funciona). Não vou desligar a proteção para contornar.

A check counts for planning when it is from this machine and at most 7 days old; otherwise run it again. Phase 6 repeats it at its start under the same rule and, whatever its age, whenever the plan assigns implementers to a harness other than yours, because the call is cheap ([implementation.md](implementation.md), section 1A).

**Calling another harness.** Run it non-interactively, from the project root (or, for an implementer, the task's folder), with the model and effort of the plan. Its answer is written to a file, and you read that file:
- Codex, read-only role: `codex exec -m <model> -c model_reasoning_effort=<high|medium|low> -s read-only -C <folder> -o <answer file> "<prompt>"`. `-s read-only` is Codex's sandbox: it may read and run read commands, never write. `-o` writes its last message to the answer file (Codex writes it, not the sandboxed agent). No `--ephemeral`, in any Codex call: Codex keeps the session in its own folder (`~/.codex/sessions/`, outside the project), and `baco cost measure` reads the tokens there; nothing of that session goes into the project. Implementer, only when allowed and its write check passed: `-s workspace-write -C <task folder>`, and its report goes to the path in its brief, as for any implementer.
- OpenCode: `opencode run -m <provider/model> [--variant <effort>] --dir <folder> --agent plan "<prompt>" > <answer file>`. The built-in `plan` agent has file edits denied, but its shell is not sandboxed, so the check below matters more here. It prints the answer: the shell redirection to the answer file is the one exception to the edit-tool rule, because you never write a reviewer's answer yourself. `--variant` is the provider's own effort name (for example `high`, `minimal`); if the model has none, say so once and go on.
- Another tool: read its non-interactive help (`<tool> --help`) and use the same shape: model, effort, a read-only mode for read-only roles, the working folder, the answer to a file. If it has no read-only mode, do not give it a review role.

The prompt is short: what to read (for the PR review, `Leia o arquivo <pedido.md> e siga as instruções dele. Responda somente no formato pedido lá.`), never copied text. The answer files live under `.baco/logs/` (git-ignored): for the PR review, the `resposta.md` that `baco build-handoff --mode pr` names. These runs can take long: run them in the background and read the file when they end, and limit the time with the Bash tool's own `timeout` setting, never by putting the `timeout <n>` command in front of the call: that changes the start of the command, so it no longer matches the permission rule `Bash(codex exec * -s read-only *)` and stops for a prompt (the same for `nice`, `env` and other prefixes). Before and after each run, the `git status` check of SKILL.md, "Roles", also of ignored paths, in the folder it worked in. Record it with `baco cost add ... --harness <name>`, naming the real model and effort.

**Implementer on another harness: you commit.** Its sandbox lets it write only in the task's folder, and a linked worktree keeps its git data in the main repository (`.git/worktrees/<name>`), outside that folder, so it cannot commit. Its brief says so: leave the changes in the folder, uncommitted; do not run `git commit`, `baco check-branch` or `baco guard-tests`; run the task's tests with `baco run-tests` when the sandbox lets it, and otherwise write "não rodado" in the report; write the report at its path. When it returns:
0. Some environments commit by themselves at the end of each session (the message is the truncated prompt). If the task branch already has a commit the environment made, treat its content like an uncommitted change (steps 1 and 2 on that commit's diff) and rewrite only its message with `git commit --amend` (the last commit) or a rebase of the unpushed task commits to the standard of step 3, with the `Implementado por:` line. Never amend or rewrite a commit already pushed or merged.
1. `git status` in the task's folder: only files inside the task's scope and its report may have changed; anything else is reverted and goes back to it as a finding.
2. `baco check-branch` there, then run the task's tests yourself (`baco run-tests --layer <layer> --quick -- <Testes da tarefa files>`). Your run is the proof, never the report's claim; a failure goes back to it as a fix round.
3. Commit on the task branch, the code and the report, with a message that names the task, and a last line `Implementado por: <harness>, <model>, <effort>` (for example `Implementado por: codex, <modelo>, medium`).
4. `baco guard-tests --base <Base>`, then the review as for any task ([implementation.md](implementation.md), section 4). Fix rounds go the same way: it changes, you verify and commit.

## 6. Recording and overrides

- Record every run with `baco cost add`, naming the real model and effort that ran (for example `--model opus --effort high`), never the level, and the harness with `--harness` (for example `claude-code`, `codex`).
- The tokens come from the transcripts, not from those rows: `baco cost measure` (SKILL.md, "Cost") reads the session files of Claude Code (`~/.claude/projects/`) and Codex (`~/.codex/sessions/`) of this machine. A run on another tool (OpenCode or another) is not measured: say so where the cost is reported.
- A machine-specific choice (a model only this computer has, a personal preference) never goes into versioned files: not `.baco/config.yaml`, not the agent files. Use the environment's own user settings, or say it in the session.

## 7. Without subagents

When the environment has no separate agents, roles run one after another in this same conversation. Before the first review role (cold-reader, spec-auditor, devils-advocate, task-reviewer, final-reviewer, acceptance-validator), tell the user that the review runs in the same conversation that wrote the work, so it is not independent, and offer to run it in a fresh session (section 8) or on another harness of section 5. Record the run with the real model and effort of the conversation.

The pr-reviewer never runs in this conversation: its verdict can be imported without the person, so it must come from outside the session that built. Without subagents it runs on another harness when the plan names one (section 5); otherwise in a fresh session the person opens (section 8), whose answer is imported only with the person's confirmation; if the person does not open one, the review of that round falls back to `pessoa` ([review.md](review.md), section 4).

## 8. Running a role in a fresh session

When a role must not run in this conversation and no subagent or other harness can take it, the person opens a new session of an AI tool in the project root and pastes a short request you give them in a fenced code block: the role file to follow (its full path), the input paths its brief lists (for the PR review, `Leia o arquivo <pedido.md> e siga as instruções dele. Responda somente no formato pedido lá.`), and the one file to write the answer to (for the PR review, the round's `resposta.md`). Nothing from this conversation goes in it. When the person says it ended, run the check of SKILL.md, "Roles" (only the answer file may be new), show the person the first lines of the answer and the path, and act on it only after they confirm it came from that session, unchanged. Record the run with `baco cost add`, with the model and effort the person tells you, or `—` when they do not know.
