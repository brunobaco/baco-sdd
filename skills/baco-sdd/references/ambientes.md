# Environments: levels, efforts and harnesses

Load this file when you dispatch a role or an implementer, when the plan assigns work to a harness, or when the person adds an AI subscription. BACO speaks of a level and an effort; the environment (harness: Claude Code, Codex, OpenCode, Antigravity or another AI tool) decides which real model and effort that means.

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

**Claude Code's sandbox.** `harnesses.claude-code.sandbox` (section 5) also governs the conversation you run in, because Claude Code's own sandbox covers the whole session (the conductor and its subagents) and only its terminal commands: reading and editing files keep following the permission rules, and MCP servers and hooks run outside it. For the harness you run in, only two values make sense, because you need the network for GitHub and for installs: `rede` and `livre`; `protegida` there is read as `rede`, and you say so once.
- `livre`: no `sandbox` key in the settings, as Claude Code comes.
- `rede`: in `.claude/settings.local.json` (per machine, not versioned; configure.md, "Execution rules"):
  ```json
  "sandbox": {
    "enabled": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": ["codex exec *", "git worktree remove *"],
    "filesystem": { "allowWrite": ["~/.npm"] },
    "network": { "allowedDomains": ["github.com", "api.github.com", "codeload.github.com", "objects.githubusercontent.com", "raw.githubusercontent.com", "registry.npmjs.org"] }
  }
  ```
  What each part does, as checked on a Linux machine with Claude Code 2.1:
  - Terminal commands write only in the project folder and the session's temporary folder (`$TMPDIR`, not all of `/tmp`); everything else is read-only. Reads stay open, including the person's keys, which is why the network list matters.
  - The network reaches only `allowedDomains`; any other host is refused (a `curl` gets `CONNECT tunnel failed, response 403`). This is the one protection against sending keys out that Codex's sandbox does not give. Start from GitHub and the package registries of the project's stack (for example `pypi.org` and `files.pythonhosted.org` for Python) and add only what the person approves.
  - `allowUnsandboxedCommands: false` removes the escape hatch: the agent cannot retry a blocked command outside the sandbox. `excludedCommands` still run outside it.
  - `excludedCommands`: `codex exec *` when Codex is in `harnesses`, because Codex opens its own sandbox and cannot start inside Claude's (it fails with `Read-only file system`); it keeps its own sandbox and BACO's rules. The exception matches only a command that starts with `codex exec` and has nothing after the prompt: no `cd <folder> &&` in front (use `-C`), no `> file`, `2>&1`, `< /dev/null`, pipe or `;` after it (use `-o`). Anything else runs inside the sandbox, and Codex dies in a second with `Read-only file system`.
  - `antigravity -p *` (or `agy -p *`, the name the machine has) when Antigravity is in `harnesses`: its call needs the network to reach its models and writes its conversations under `~/.gemini/`, both outside the sandbox. The same matching limit applies, so in `rede` its call has no `> file` at the end: start it in the background with no redirection and give `baco harness-answer` the output file the Bash tool reports for that run (section 5, Antigravity). Checked with Claude Code 2.1 and Antigravity CLI 1.5.10: started that way, the call leaves the sandbox and answers, and `harness-answer` reads the output file even with the tool's log lines in it; with `> file` at the end it runs inside and fails (`Eligibility check failed ... user denied`, and a read-only `~/.gemini`).
  - `git worktree remove *`: the sandbox protects some files (`.claude/settings*.json`, `.mcp.json`, shell and git configuration files, `.git/hooks`) by mounting over them, also inside the task folders under `.worktrees/`. Inside the sandbox, removing a task folder fails with `Device or resource busy` (git cannot delete its data under `.git/worktrees/<name>`), so removal runs outside it; checked with Claude Code 2.1. Before `baco cleanup-branches --apply`, remove each worktree it lists with `git worktree remove --force <path>` (merged branches only; `--force` because of the empty files below), then run the cleanup. The same mounts leave empty files with those names in the project and in task folders: never commit them; stage files by path, never `git add -A` or `git add .`.
  - The command that keeps the app running for the person to test, when the project has one (configure-questions-tools.md, question 9), exactly as configured: a server started inside the sandbox is reachable only by that same command, never by a later command or by the person's browser. So every check that needs the app running (homologation, a manual case run by script, a `curl` against it) is one command or one project script that starts the app, waits for it, checks and stops it; never start the app in one command and check it in the next. A server on another port or with other variables is not the excluded command. `app.smoke` and browser tests that start their own server (for example Playwright's `webServer`) work inside, because they start and check in one command. When this sandbox is on, the planner writes the homologation steps of `docs/operacao.md` that way ([planning.md](planning.md), section 4).
  - `filesystem.allowWrite`: the package manager's cache in the home folder (`~/.npm` for npm; another manager, its own cache folder), so installs work. If npm still fails writing under `~/.npm` (its `_logs`), it is not the registry: run it with `--cache "$TMPDIR/npm-cache"`.
  - BACO's test queue lives in the shared `/tmp`, which the sandbox makes read-only; the engine then falls back to `$TMPDIR/baco-queue`. Hand that same folder to a Codex implementer (`BACO_QUEUE_DIR` in its `set` map, section 5), so both use one queue.
  - The settings are read when a conversation starts: after writing or changing the `sandbox` block, the sandbox and the network list apply in the next conversation, not in the one that wrote them. Run the check below in a new conversation.
  - Check that it is on: `curl -sS -m 5 https://example.com -o /dev/null` must fail with the refused connection above. Record it in `.baco/logs/harnesses.md` as a row for your own harness, mode `caixa`, `passou` or `falhou`. If it is not on (the settings missing, or the machine cannot run the sandbox: Linux needs `bubblewrap` and `socat`), tell the person and go on as `livre` only with their yes.
  - In `rede`, a review copy folder next to the project (`baco build-handoff --mode repositorio`) is outside the sandbox's write area: add that folder to `filesystem.allowWrite` when the plan uses that mode, with the person's yes.

## 3. Codex

Codex model names change often, so this skill names none.

1. At the start of a delivery, read which models the environment offers: the model picker, `~/.codex/config.toml`, and `.codex/agents/*.toml` in the project.
2. Map them (a family in `models`, such as `sol`, resolves to its newest model: section 5, "Model families"): the most capable to `forte`, the intermediate one to `medio`, the fastest or cheapest to `leve`. Effort goes to `model_reasoning_effort`: `alto` to `high`, `medio` to `medium`, `baixo` to `low`.
3. Spawn each role's agent with its model and `model_reasoning_effort`. The config keys `agents.default_subagent_model` and `agents.default_subagent_reasoning_effort` only give defaults; pass the values per spawn anyway. Source: https://developers.openai.com/codex/config-reference.
4. Tell the user the mapping once, in plain words, for example: "Neste ambiente, forte é o modelo X, médio é o Y e leve é o Z."

If you cannot tell which model is which, ask the user once instead of guessing.

## 4. Other environments

Same rule as Codex: read what the environment offers, map most capable, intermediate and fastest to the three levels, tell the user once, and pass model and effort per call when the environment allows it. If it accepts no effort, say so once and go on.

Antigravity (CLI `antigravity` or `agy`, checked with 1.5.10), with the BACO plugin installed by `node tools/antigravity.mjs` from the BACO repository (it writes the plugin to `~/.gemini/config/plugins/baco`, with the role files at absolute paths of that machine; run it again after each BACO update):

- Each role runs as subagent `baco-<role>` (`baco-implementer-<class>` for the implementer). Its model is the conductor's (`inherit`) or the light tier (`flash`) for the locator; Antigravity takes no model or effort per call, and the effort is part of the model name (`-low`, `-medium`, `-high`, `-xhigh`). So the levels collapse to the conductor's model: tell the user once, and record the model the transcript shows.
- The commands are skills `baco-<name>`, which the person asks for by name (for example, the skill `baco-executar` for "executar ENT-001"): `/name` does not expand plugin skills in this CLI.
- The plugin's hooks guard the protected branch and writes outside the project, as in Claude Code, and inject the BACO note and the conversation-size warning.
- `baco cost measure` does not read Antigravity transcripts yet: say so when you measure.

## 5. Harnesses of the project

`harnesses` in `.baco/config.yaml` lists the AI tools this project uses (for example `claude-code`, `codex`, `opencode`, `antigravity`), each with `models`, its model name for each level, `implementers` (default `off`) and `sandbox` (default `rede`).

**Sandbox.** `sandbox` says how free a harness is when it implements (read-only roles always run read-only):
- `protegida`: writes only in the task's folder (and `/tmp`), no network, no local port. It cannot install dependencies or run browser tests, so the conductor does those for it, at the conductor's cost.
- `rede`: the same folder limit, with network and local ports. It installs, starts the app and runs browser tests by itself, and still cannot write outside the task's folder. Default.
- `livre`: no sandbox; it reads and writes wherever the person can, like Claude Code without its own sandbox. Only the command rules below stand between it and a mistake. Use only when the person chose it knowing that.

Antigravity has the same three values, but all of them are made of rules, not a sandbox (its terminal sandbox does not start on every machine, and its file tools write anywhere the person can whatever the permission rules say; checked with CLI 1.5.10). `baco antigravity-task <task folder> --sandbox protegida|rede|livre` (default `protegida`) puts the rules in the task folder, hidden from git, and prints the exact test command and `callArgs`:
- `protegida`: a hook that refuses every file write outside that folder (and in its `.agents/` and `.git`), and command rules that allow only reading and BACO's test runner, with the approval mode pinned and the web denied. It cannot install, commit or fetch anything by itself, and the conductor installs for it.
- `rede`: the same hook, plus `npm`, `npx` and `node` in the command rules, so it installs and runs the browser tests itself. `npm` passes only with `ci`, `install`, `i`, `test`, `run`, `ls` or `view`, so publishing a package, its tokens, login and registry settings are refused; `npx` passes only as `npx --no ...` or `npx --no-install ...`, so it never downloads a package from the registry. The hook binds only its file tools, and `node` (and a package script run through `npm`) can still run any program with the person's user, so this is weaker than Codex's `rede` (an OS sandbox). Say that when the person chooses it.
- `livre`: no write hook; only the closed list of commands (read commands, `git status|diff|log|show`, `ls`, `grep`, `cat`, `head`, `tail`, `wc`, `npm` and `npx` as in `rede`, `node` and BACO's test runner). Never `--dangerously-skip-permissions`, in any value.

What stays open in every value: the tests it runs are code it may have written, and they run with the person's permissions, so a test can still read the person's files or reach the network. The `git status` check after the run and the conductor's own test run are what catch a mistake.

In every value, BACO's command rules apply: the harness's own mechanism for refusing commands, filled with what the method never lets an implementer do (`sudo`, `git push`, `git commit`, `git reset --hard`, `rm -rf`, `gh`). For Codex they are the file [templates/codex/baco.rules](../templates/codex/baco.rules), installed at `.codex/rules/baco.rules` in the project and committed with it (configure-questions-tools.md, question 9). The rules are a filter, not a wall: a command hidden inside a more complex shell script can slip past, the same limit Claude Code's permission rules have. With network on (`rede`, `livre`), an agent that reads a malicious text (a package, a page) could still read the person's keys and send them out; the rules lower that risk, they do not remove it, and the same holds for Claude Code without its sandbox. A harness without a rules mechanism takes only `protegida`.

**Adding one.** When the person says they have a new subscription or tool, list its models from the tool itself (Codex: the model picker and `~/.codex/config.toml`; OpenCode: `opencode models`; Antigravity: `antigravity models`, or `agy models`; another tool: its own list command or settings), recommend which fits `forte`, `medio` and `leve` and why, in plain words, and save only after the person approves. Save a model family when the list has one (below), the exact name only when the person pins it. Never guess a model name. A model only this machine has stays out of versioned files (section 6).

**Model families.** A value of `models` may be a family (`sol`, `terra`, `luna`, `neon`, `opus`) or an exact model name; the engine accepts any non-empty string. When planning, list the tool's models as above and resolve each family to the NEWEST version whose name contains the family as a whole word or a dash-separated part (`gemini-4-neon` over `gemini-3-neon`). For a tool that puts the effort in the model name (Antigravity: `gemini-4-neon-high`), append the role's effort (`alto` `-high`, `medio` `-medium`, `baixo` `-low`) when the list has it. The exact name goes ONLY into the plan (agents table) and into `baco cost add`, never back into the config. A family with no model in the list: say so, and leave that harness out of the plan until the person picks another family. An exact name in the config that has a newer version of the same family in the list: warn once and suggest the family. Claude Code already works with its aliases (`opus`, `sonnet`, `haiku`).

**Who runs what is decided in the plan, never at run time.** The plan gives each task and each role its harness, model and effort ([planning.md](planning.md), sections 4 and 7), and the person approves them with the plan. During construction you follow the plan; when the plan does not name a harness for a role, it runs on yours. If a planned harness is unavailable (not installed, no login, quota), the work it holds goes to the next reserve the plan lists for that role (`roles` in the config, [implementation.md](implementation.md), section 10, "Reserves"); with no reserve left, it waits and goes into the end-of-run summary. Never move it to a harness or model the plan does not list.

**Profiles of one tool.** A tool that offers models of several makers (Antigravity has Gemini and Claude, each with its own quota) may have one entry per family in `harnesses`, each with `tool: <the program>` and its own `models`, for example `antigravity` (Gemini) and `antigravity-claude` (`tool: antigravity`, Claude models). Each entry is a harness for the plan, its checks and its rows in `.baco/logs/harnesses.md` and `baco cost add --harness <entry>`; the call is the one of the program `tool` names, with that entry's model. A role entry `<harness>/<model>` pins one model of that harness for that role (for example `antigravity/gemini-4-argon` for a last review); Antigravity adds the effort suffix as below.

**Conservative rule.** Until a harness has been tested end to end with BACO, a harness other than the one you run in may take only read-only roles: the reviewers (including `pr-reviewer`) and the `locator`. Implementers stay on your harness, unless the config marks that harness `implementers: on`. The planner applies the same rule.

**Suggested split.** When Codex is installed and its read check passes, configuration suggests to the person (never imposes) one of two splits ([configure-questions-tools.md](configure-questions-tools.md), question 9): (a) implementers on Codex in `rede` (most capable model, very high effort), conductor and every review role on Claude; (b) conductor, implementers and task reviewers on Claude, the PR reviewer on Codex (most capable model, high effort, read-only). In both the PR reviewer is on a different harness from the implementers, and the locator is on the lightest Claude model. Reason, from end-to-end runs: (a) had the shortest build phase and almost no fix rounds, with Codex installing and running browser tests itself, at the cost of a good share of the Codex limit and a heavier conductor; (b) cost about 1% of the usage for the PR review, which found defects the Claude reviews missed. Codex implementing in `protegida` (no network, no ports) sent installs and browser tests back to the conductor; do not suggest it. With only Claude, nothing changes.

**Check before relying on it.** A harness that is installed and logged in may still fail in this machine's sandbox, so before a plan gives it any work, run one short call per mode BACO will use, with its `leve` model and low effort (cheap), and record the result. The checks live in `.baco/logs/harness-check/` (git-ignored); create it first by writing an empty `LEIA.md` there with the edit tool.
- Read mode, for every harness other than yours: from the project root, ask it to run `git rev-parse --short HEAD` and answer only with the output (Codex: `codex exec -m <leve model> -c model_reasoning_effort=low -s read-only -C <project root> -o .baco/logs/harness-check/<harness>-leitura.md "Rode o comando git rev-parse --short HEAD e responda só com a saída dele."`). It passed when the call exits 0 and the answer is the same short sha you get yourself. Antigravity: the call of "Calling another harness" below with the `leve` model, that prompt and the answer under `.baco/logs/harness-check/antigravity-leitura.*`; it passed when `baco harness-answer` exits 0 and the answer is that sha. Its read-only mode is a list of rules, not a sandbox, so its read check has a second call that must fail: the same call with the prompt `Rode o comando touch .baco/logs/harness-check/antigravity-regra.txt e responda só com a saída dele.` and the answer under `antigravity-regra.*`. `regra: sim` when `harness-answer` says `denied` (exit 1) and the file `antigravity-regra.txt` does not exist; otherwise `regra: não` (the rules did not load, or the person's own Antigravity settings allow more), and the harness takes no role. Record both in the row (mode `leitura`, with `regra`).
- Write mode, only for a harness marked `implementers: on`:
  - For Codex (checked with 0.169): Codex loads `.codex/rules/baco.rules` only when the main repository root is marked `trust_level = "trusted"` in `~/.codex/config.toml`, ignores a per-call `-c projects."<folder>".trust_level="trusted"`, and does not mark new folders as trusted on its own. A linked worktree inherits trust from its main repository root without adding an entry to `~/.codex/config.toml`. So first check whether `~/.codex/config.toml` has `[projects."<project root>"]` with `trust_level = "trusted"`; if missing, explain why in plain words and, only with the person's approval, add that entry for the project root (never for a task folder or a scratch folder). Then create the scratch folder as a linked worktree of the project (`git worktree add --detach .baco/logs/harness-check/codex-escrita HEAD`), matching how task worktrees work, and ensure `.codex/rules/baco.rules` is present there (if not yet committed on `HEAD`, copy it from the project into the scratch worktree's `.codex/rules/`). Run the implementer call below asking it to run `pwd` and write the output to `ok.txt`, with the scratch folder as the task folder; remove the scratch worktree afterward (`git worktree remove --force .baco/logs/harness-check/codex-escrita`).
  - For any other harness: in a scratch folder `.baco/logs/harness-check/<harness>-escrita/` created with `git init -q`, ask it to run `pwd` and write the output to `ok.txt`, with the exact call of its `sandbox` value.
  - It passed when the call exits 0 and `ok.txt` holds that folder's path. This call widens what the harness may write, so it stops for the person's confirmation (configure.md, "Execution rules"): run it when the person is there, at configuration or at planning.
- Capabilities, only for a harness marked `implementers: on`, in the same write call (the scratch folder, the same sandbox): ask it also to (a) fetch from the network, for example `npm view <a small public package> version` or `git ls-remote <a public repository> HEAD`, and (b) bind a local port, for example `node -e "require('net').createServer().listen(0,'127.0.0.1',function(){console.log('porta',this.address().port);this.close()})"`, writing each output to its own file in the scratch folder (`rede.txt`, `porta.txt`), and (c) run `sudo -n true` and write what happened to `regra.txt`. Each is a capability: `rede` and `porta` are `sim` when the call succeeded and the file shows the output, `não` otherwise; `regra` is `sim` when the command was refused with a message that starts with `BACO:` (the rules loaded), `não` otherwise. Expected: `protegida` gives `rede: não` and `porta: não` (Codex: no network, `EPERM` on listen), which is that value working, not a failure; `rede` and `livre` must give `rede: sim` and `porta: sim`. Every value must give `regra: sim`. Never widen the sandbox beyond the configured value to make a check pass.
- Antigravity, write mode and capabilities: create the scratch folder with `git init -q -b baco/verificacao` (a branch that is not protected), run `baco antigravity-task <scratch folder> --sandbox <the configured value>`, and from that folder make the implementer call below with the `leve` model, one call per item, because a denied command ends the run: (1) `pwd` written to `ok.txt` with the file tool, passed when `ok.txt` holds the folder's path; (2) the network and port commands above, expected `rede: não` and `porta: não` in `protegida` (`harness-answer` says `denied`), `rede: sim` and `porta: sim` in `rede` and `livre`; (3) `sudo -n true`, `regra: sim` when `harness-answer` says `denied`; (4) in `protegida` and `rede`, a write with the file tool to `../antigravity-fora.txt`, `trava: sim` when the answer says the hook refused it and the file does not exist next to the scratch folder (`livre` has no hook: skip it, `trava: não se aplica`). Record `trava` with the other capabilities. With `regra: não`, or `trava: não` in a value that has the hook, Antigravity builds in no value. Then `baco antigravity-task <scratch folder> --clean`.
- Record each result as one row in `.baco/logs/harnesses.md` (git-ignored, per machine): date and time (from `date`), machine (`hostname`), harness, mode, model, `passou` or `falhou`, for the write mode the `sandbox` value and the capabilities `rede: sim|não`, `porta: sim|não` and `regra: sim|não`, and the first line of the error. The planner gives that harness only tasks whose needs it has ([planning.md](planning.md), section 4): a task that installs dependencies needs `rede`, one that opens a local server or runs a browser test needs `porta`. A task that needs what the harness lacks stays on the conductor's harness, or the plan has the conductor do the install and the browser tests and states that cost.
- When a check fails, the harness stays out of the plan for that mode, with two exceptions for the write mode: with `rede` or `livre` and only `rede` or `porta` missing, it may implement as `protegida` (the conductor installs and runs the browser tests), and you say so; with `regra: não`, it implements in no value, because the rules are what keeps it from the forbidden commands. Never retry with a sandbox wider than the configured value (no `danger-full-access` unless the value is `livre`, no `--dangerously-bypass-approvals-and-sandbox`, no other sandbox override). Tell the person, in plain words:

> Testei o [ferramenta] aqui e ele não conseguiu [ler o projeto / gravar numa pasta de teste / acessar a internet ou abrir porta / respeitar as regras do BACO] na caixa configurada ([protegida / rede / livre]): [primeira linha do erro]. Por isso ele fica fora do plano por enquanto, e [a revisão / a construção] fica com [outra ferramenta]. Para resolver, vale conferir se o login dele está ativo, se o modelo [modelo] existe na sua conta e se o isolamento dele funciona nesta máquina (em alguns servidores e contêineres não funciona). Não vou desligar a proteção para contornar.

A check counts for planning when it is from this machine and at most 7 days old; otherwise run it again. Phase 6 repeats it at its start under the same rule and, whatever its age, whenever the plan assigns implementers to a harness other than yours, because the call is cheap ([implementation.md](implementation.md), section 1A).

**Calling another harness.** Run it non-interactively, from the project root (or, for an implementer, the task's folder), with the model and effort of the plan. Its answer is written to a file, and you read that file:
- Codex, read-only role: `codex exec -m <model> -c model_reasoning_effort=<high|medium|low> -s read-only -C <folder> -o <answer file> "<prompt>"`. `-s read-only` is Codex's sandbox: it may read and run read commands, never write. `-o` writes its last message to the answer file (Codex writes it, not the sandboxed agent). No `--ephemeral`, in any Codex call: Codex keeps the session in its own folder (`~/.codex/sessions/`, outside the project), and `baco cost measure` reads the tokens there; nothing of that session goes into the project. Start every Codex call in the background from the beginning (the Bash tool's background option), never as a foreground call that the tool may move to the background later: such a call keeps its input open, and Codex waits for input that never comes ("Reading additional input from stdin") until the time limit. Do not add `< /dev/null` instead: in Claude Code's sandbox, the exception for `codex exec *` matches only a command that starts with `codex exec` and ends with the prompt (section 2).
- Codex, implementer, only when allowed and its write check passed: `codex exec -m <model> -c model_reasoning_effort=<effort> <sandbox flags> -C <task folder> -o <answer file> "<prompt>"`, and its report goes to the path in its brief, as for any implementer. Codex loads the project's `.codex/rules/baco.rules` only when the project's main repository root is trusted in `~/.codex/config.toml` (checked with 0.169: linked worktrees inherit trust from the main repository root, while Codex ignores a per-call trust override, so BACO adds none and trusts only the project root with the person's approval, never individual task folders, relying on the write check `regra: sim`, made in a linked worktree of the project). Codex also loads anything else in the project's `.codex/` folder, so before each call check that the task folder's `.codex/` holds only `rules/baco.rules`, identical to the skill's template (`cmp`); anything else, stop and show it to the person. The sandbox flags, by value:
  - `protegida`: `-s workspace-write`.
  - `rede`: `-s workspace-write -c sandbox_workspace_write.network_access=true -c 'shell_environment_policy.set={npm_config_cache="/tmp/baco-npm-cache"}'`. npm keeps its cache in the home folder, outside the sandbox, and fails there; the `set` map moves it under `/tmp`. When Claude Code's sandbox is on, add `BACO_QUEUE_DIR="<your $TMPDIR>/baco-queue"` to the same map (the literal path, from `echo $TMPDIR` in your session), so Codex's browser tests wait in your queue. Another package manager that caches in the home folder gets its cache variable in the same map, pointing under `/tmp` (for example `PIP_CACHE_DIR`, `UV_CACHE_DIR`).
  - `livre`: `-s danger-full-access`.
  - Never `--approve-for-me`: its reviewer can approve leaving the sandbox (in a check here it approved a write to the home folder). Never `--dangerously-bypass-approvals-and-sandbox` or `--dangerously-bypass-hook-trust`.
- OpenCode: `opencode run -m <provider/model> [--variant <effort>] --dir <folder> --agent plan "<prompt>" > <answer file>`. The built-in `plan` agent has file edits denied, but its shell is not sandboxed, so the check below matters more here. It prints the answer: the shell redirection to the answer file is the one exception to the edit-tool rule, because you never write a reviewer's answer yourself. `--variant` is the provider's own effort name (for example `high`, `minimal`); if the model has none, say so once and go on.
- Antigravity (its CLI is `agy`, installed on some machines as `antigravity`: use the name `command -v` finds), read-only role. From the folder the role reads (the project root or the review copy): `antigravity -p "<prompt>" --settings .baco/antigravity/leitura.json --model <model> --output-format json > <answer file>.json`, then `baco harness-answer <answer file>.json --out <answer file> --harness <harness entry, for example antigravity or antigravity-claude> --model <model> --agent <role>`, which writes the answer file from the tool's JSON (the engine writes it, never you), gives the tokens, turns and seconds, and records the call in `.baco/logs/uso-ferramentas.jsonl` for `baco cost measure`. Antigravity reports the usage of the whole conversation so far, so on a resume `harness-answer` gives only what that call added (and no seconds). The redirection to the `.json` file is the same exception to the edit-tool rule as for OpenCode. Start it in the background, like Codex. Before each call, check that `.baco/antigravity/leitura.json` is identical to the skill's [templates/antigravity/leitura.json](../templates/antigravity/leitura.json) (`cmp`); anything else, stop and show it to the person.
  - What the read-only mode is: that file denies the file-writing tool and the web, and allows in the terminal only `git diff`, `show`, `log`, `blame`, `status` and `rev-parse` without the options that write or run another program (`--output`, `--ext-diff`, `--textconv`), and `ls`, `cat`, `head`, `tail` (not `-f`), `wc`, `grep` and `pwd`, each with no `;`, `&`, `|`, `<`, `>`, `$`, backtick or parenthesis outside quotes; every other command is denied. The file also pins the approval mode (`toolPermission: request-review`, `agentMode` empty): a personal `toolPermission: always-proceed` in `~/.gemini/antigravity-cli/settings.json` otherwise let any command run, and the session's `--settings` overrides it, while the person's own allow rules are not added to BACO's (checked with CLI 1.5.10). It is a filter, not a sandbox: like Codex read-only, it may read any file the person can (`cat`), but it has no network command. BACO does not pass `--sandbox`: on Linux machines whose AppArmor restricts unprivileged user namespaces, Antigravity's terminal sandbox does not start, and the CLI then runs without it and without saying so (checked with CLI 1.5.10). The `git status` check before and after the run ([dispatch.md](dispatch.md), section 1) stays.
  - Every prompt starts with this line, which keeps it inside the list: `Você só lê: use suas ferramentas de ler e buscar arquivos; no terminal, só git diff, show, log, blame e status, ls, cat, head, tail, wc e grep, sem redirecionamento, pipe ou encadeamento.`
  - In this mode a command outside the list ends the whole run with no answer (contrary to its documentation): `harness-answer` says `denied` (exit 1) and gives the conversation. Resume it, at most twice: `antigravity -p "Esse comando foi negado e não será liberado: aqui você só lê. Siga a instrução original sem ele." --conversation <id> --settings .baco/antigravity/leitura.json --model <model> --output-format json > <answer file>.json`, then `harness-answer` again, with the same `--harness`, `--model` and `--agent`. A third denial, `failed` (quota, error, time limit) or `empty` is a failed call: the work waits, as for an unavailable harness. Never retry with wider permissions: no `--dangerously-skip-permissions`, no second `--settings`, no `--add-dir`, `--mode`, `--agent` or `--remote-agent`.
  - Model and effort: Antigravity's model names carry the effort (`-low`, `-medium`, `-high`, `-xhigh`, for example `gemini-4-neon-high`). `models` records one name per level; at call time, the plan's effort picks the name with that suffix (`alto` `-high`, `medio` `-medium`, `baixo` `-low`) when `antigravity models` lists it; if it does not, run the recorded name and say so once.
  - Record each call, resumes included, with `baco cost add ... --harness <harness entry> --tokens <tokens> --turns <turns> --seconds <seconds>`, from what `harness-answer` printed (on a resume, what that call added; seconds `—`).
- Antigravity, implementer, only with `implementers: on`, its `sandbox` value (`protegida`, `rede` or `livre`) and its write check passed with `regra: sim` (and `trava: sim` where the value has the hook). Before each call (first run and every fix round), in `protegida` install what the task needs yourself (in `rede` and `livre` it installs by itself), then run `baco antigravity-task <task folder> --sandbox <value>`; if it refuses (the project has its own `.agents/hooks.json`), stop and show it to the person. Change to the task folder with `cd <task folder>` alone, then call `antigravity -p "<prompt>" --settings .agents/baco-construcao.json --model <exact model> --mode accept-edits --print-timeout 0 --output-format json < /dev/null` (the arguments are the `callArgs` of `antigravity-task`'s `data`), in the background, with `> <answer file>.json` only when Claude Code's sandbox is off (section 2), then `baco harness-answer` as for a reviewer (`--agent` the implementer of the task's class). `--mode accept-edits` is what lets it write files with no person to approve; `--print-timeout 0` removes the call's own time limit and `< /dev/null` closes its input, so it never waits for typing. The prompt names the brief and these limits: write only in this folder; no commit; in `protegida`, no install; in the terminal, only reading, the commands of its value and the exact test command `antigravity-task` printed (`node <path>/baco.mjs run-tests ...`); `|`, `&&`, `;` and `>` are denied, and so is reading outside the task folder (what it must read is copied into the folder first). A denied command ends the run: resume as for a reviewer, with `Esse comando foi negado e não será liberado. Siga a tarefa sem ele.`. A file write the hook refused does not end it. When it returns, `baco antigravity-task <task folder> --clean`, then the steps of "Implementer on another harness" below, with the trailer line `Implemented-by: antigravity, <model>` (a pt-BR project may write `Implementado por: antigravity, <modelo>`; the model name carries the effort). Antigravity never commits: you verify, run the tests and commit.
- Another tool: read its non-interactive help (`<tool> --help`) and use the same shape: model, effort, a read-only mode for read-only roles, the working folder, the answer to a file. If it has no read-only mode, do not give it a review role.

The prompt is short: what to read (for the PR review, `Leia o arquivo <pedido.md> e siga as instruções dele. Responda somente no formato pedido lá.`), never copied text. The answer files live under `.baco/logs/` (git-ignored): for the PR review, the `resposta.md` that `baco build-handoff --mode pr` names. These runs can take long: run them in the background and read the file when they end, and limit the time with the Bash tool's own `timeout` setting, never by putting the `timeout <n>` command in front of the call: that changes the start of the command, so it no longer matches the permission rule `Bash(codex exec * -s read-only *)` and stops for a prompt (the same for `nice`, `env` and other prefixes). Before and after each run, the `git status` check of SKILL.md, "Roles", also of ignored paths, in the folder it worked in. Record it with `baco cost add ... --harness <name>`, naming the real model and effort.

**Implementer on another harness: you commit.** The rules forbid it to commit or push, and in `protegida` and `rede` its sandbox lets it write only in the task's folder, while a linked worktree keeps its git data in the main repository (`.git/worktrees/<name>`), outside that folder. Its brief says so: leave the changes in the folder, uncommitted; do not run `git commit`, `baco check-branch` or `baco guard-tests`; run the task's tests with `baco run-tests` when the sandbox lets it (in `rede` and `livre`, including installs and browser tests), and otherwise write "não rodado" in the report; write the report at its path. When it returns:
0. Some environments commit by themselves at the end of each session (the message is the truncated prompt). If the task branch already has a commit the environment made, treat its content like an uncommitted change (steps 1 and 2 on that commit's diff) and rewrite only its message with `git commit --amend` (the last commit) or a rebase of the unpushed task commits to the standard of step 3, with the `Implementado por:` line. Never amend or rewrite a commit already pushed or merged.
1. `git status` in the task's folder: only files inside the task's scope and its report may have changed; anything else is reverted and goes back to it as a finding.
2. `baco check-branch` there, then run the task's tests yourself (`baco run-tests --layer <layer> --quick -- <Testes da tarefa files>`). Your run is the proof, never the report's claim; a failure goes back to it as a fix round.
3. Commit on the task branch, the code and the report, with a message that names the task, and a last line `Implementado por: <harness>, <model>, <effort>` (for example `Implementado por: codex, <modelo>, medium`).
4. `baco guard-tests --base <Base>`, then the review as for any task ([implementation.md](implementation.md), section 4). Fix rounds go the same way: it changes, you verify and commit.

**Ratoeira notes.** When the session runs in the Ratoeira (detected as in implementation.md, section 10):
- The conversation goes to sleep when you end your turn while waiting, and what you were waiting for is lost to it. Never end the turn with a test battery, a harness call or a subagent still running: wait in the foreground, in stretches of up to 9 minutes (a tool call of at most 9 minutes, repeated), and end the turn only when the work you wait for is done or the person must answer.
- Calling Antigravity from the terminal uses the login of the default Antigravity account of the Ratoeira. If the call asks for login, never log in from the terminal: ask the person to sign out and in again in the Ratoeira.
- Pass the project's `PATH` in the call's environment, and a short `TMPDIR` (`mktemp -d /tmp/<task>.XXXX`) so the Chrome of the browser tests opens (a long path breaks its socket).

## 6. Recording and overrides

- Record every run with `baco cost add`, naming the real model and effort that ran (for example `--model opus --effort high`), never the level, and the harness with `--harness` (for example `claude-code`, `codex`).
- The tokens come from the transcripts, not from those rows: `baco cost measure` (SKILL.md, "Cost") reads the session files of Claude Code (`~/.claude/projects/`) and Codex (`~/.codex/sessions/`) of this machine, OpenCode's own database (`~/.local/share/opencode/opencode.db`) and the Antigravity calls `baco harness-answer` recorded in `.baco/logs/uso-ferramentas.jsonl` (so pass it `--harness`, `--model` and `--agent`). Antigravity as the conductor, and any other tool, is not measured: say so where the cost is reported.
- A machine-specific choice (a model only this computer has, a personal preference) never goes into versioned files: not `.baco/config.yaml`, not the agent files. Use the environment's own user settings, or say it in the session.

## 7. Without subagents

When the environment has no separate agents, roles run one after another in this same conversation. Before the first review role (cold-reader, spec-auditor, devils-advocate, task-reviewer, final-reviewer, acceptance-validator), tell the user that the review runs in the same conversation that wrote the work, so it is not independent, and offer to run it in a fresh session (section 8) or on another harness of section 5. Record the run with the real model and effort of the conversation.

The pr-reviewer never runs in this conversation: its verdict can be imported without the person, so it must come from outside the session that built. Without subagents it runs on another harness when the plan names one (section 5); otherwise in a fresh session the person opens (section 8), whose answer is imported only with the person's confirmation; if the person does not open one, the review of that round falls back to `pessoa` ([review.md](review.md), section 4).

## 8. Running a role in a fresh session

When a role must not run in this conversation and no subagent or other harness can take it, the person opens a new session of an AI tool in the project root and pastes a short request you give them in a fenced code block: the role file to follow (its full path), the input paths its brief lists (for the PR review, `Leia o arquivo <pedido.md> e siga as instruções dele. Responda somente no formato pedido lá.`), and the one file to write the answer to (for the PR review, the round's `resposta.md`). Nothing from this conversation goes in it. When the person says it ended, run the check of SKILL.md, "Roles" (only the answer file may be new), show the person the first lines of the answer and the path, and act on it only after they confirm it came from that session, unchanged. Record the run with `baco cost add`, with the model and effort the person tells you, or `—` when they do not know.

## 9. Task split, roles and reserves at configuration

Questions 13 and 14 of [configure.md](configure.md) (its "How to ask" rules apply here too), asked one at a time after 12B of [configure-questions-tools.md](configure-questions-tools.md). Not asked at startup of a project already configured, which keeps the defaults; asked when the person runs the configuration again.

**Profiles.** When question 9 adds a tool that lists models of more than one maker (Antigravity: Gemini and Claude), offer one entry per family, each with its own levels and `tool: <program>` on the extra ones (section 5, "Profiles of one tool"):

> Pergunta [N] de [total] · Outras ferramentas de IA (continuação)
>
> O [ferramenta] tem modelos de mais de uma empresa: [famílias]. Cada uma tem a própria cota, que é o limite de uso do seu plano com ela. Posso registrar uma entrada para cada, assim uma pode ser reserva da outra quando a cota acabar, e o plano escolhe a empresa de cada papel. Quer assim?

**13. How the plan splits the tasks** (`planning.task_split`, default `funcionalidade`; only when the project has both a server side and screens)

> Pergunta [N] de [total] · Como dividir as tarefas
>
> O que é: este projeto tem duas partes. O back-end é o lado do servidor: as regras, o banco de dados e a API (o endereço pelo qual a tela pede e recebe os dados). O front-end são as telas que o usuário vê. Aqui você decide se cada tarefa faz as duas partes de uma funcionalidade ou só uma delas.
>
> Por que importa: com as partes separadas, dá para pôr uma IA no back-end e outra no front-end, trabalhando ao mesmo tempo. Com as partes juntas, cada tarefa já sai testável de ponta a ponta.
>
> Opções:
> (a) Por funcionalidade: cada tarefa entrega uma funcionalidade inteira, o servidor e a tela juntos, feita por uma ferramenta de IA só. Cada tarefa já sai testável de ponta a ponta.
> (b) Back-end e front-end separados: cada funcionalidade vira uma tarefa de back-end (servidor, banco e API) e uma de front-end (as telas). Primeiro sai uma tarefa pequena com o contrato da API, o formato do que a tela pede e do que o servidor responde, e depois o back-end e o front-end andam em paralelo, cada um com a ferramenta de IA que você escolher. A tela só entra na entrega depois do servidor, e eu rodo os testes de tela com os dois juntos. Vale a pena quando você quer uma IA no back-end e outra no front-end, ou quando há muita tela.
> Em qualquer das duas, o plano de cada entrega mostra a divisão, e você pode trocar só para aquela entrega ao aprovar.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (a), porque o projeto tem poucas telas].
>
> Padrão: (a) por funcionalidade.

(a) -> `funcionalidade`; (b) -> `front-back`.

**14. Who does each role, and the reserves** (`roles`; only when `harnesses` has more than the tool you run in, or a profile of another family)

Show the roles that apply (with `front-back`, `backend` and `frontend` instead of `implementer`) and propose a list for each from the tools that passed their checks, the reviewers on a model family other than the builders':

> Pergunta [N] de [total] · Quem faz cada papel, e as reservas
>
> O que é: um papel é uma parte do trabalho, como construir ou revisar. Para cada papel, uma lista em ordem: a primeira ferramenta faz o trabalho; se a cota dela (o limite de uso do seu plano) acabar no meio da entrega, a seguinte continua sozinha, sem esperar você. Essa seguinte é a reserva.
>
> Por que importa: sem reserva, uma cota que acaba no meio da entrega para aquele papel. A revisão sempre fica com um modelo de outra empresa que não a de quem construiu, para ser um olhar independente. A conversa principal, a que conduz a entrega, não entra aqui: se a conta dela acabar, quem continua é [na Ratoeira: a fila de contas, hoje na ordem X; fora dela: ninguém, a entrega para até a cota voltar].
>
> Opções:
> (a) assim como proponho:
> [papel: ferramenta (modelo), reserva: ferramenta (modelo); um por linha, em palavras simples: "construção do back-end", "construção do front-end", "revisão de cada tarefa", "última revisão de cada tarefa", "revisão final", "revisão do PR"]
> A última revisão de cada tarefa pode ter outro revisor, para uma segunda visão mais crítica; ela só acontece nas tarefas que chegam até ela.
> (b) mudar algum papel, reserva ou modelo (diga qual).
> Em qualquer caso, o plano de cada entrega mostra essas listas e você pode mudar qualquer papel, reserva ou modelo só para aquela entrega.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: sem lista. O plano de cada entrega escolhe quem faz cada papel, e você aprova no plano.

Example for a back-end and front-end split, with three reviewer entries, so a task built by a Gemini model is reviewed by Claude when Codex is out of quota:

```yaml
planning:
  task_split: front-back
roles:
  backend: [codex, claude-code]
  frontend: [antigravity, claude-code]
  task_reviewer: [codex, antigravity, claude-code]
  final_reviewer: [claude-code, codex]
  pr_reviewer: [codex, claude-code]
```

A reviewer of the whole delivery (final, PR) never belongs to the family of ANY builder of the delivery: the plan drops that entry; with none left, it splits the final review by part (back-end and front-end), each part reviewed by a family that did not build it.

Save each approved list under `roles.<role>`, entries as `<harness>` or `<harness>/<model>` (only when the person wants one model pinned for that role). A role the person leaves to the plan stays out. In the Ratoeira, read the queue order from `~/.config/ratoeira/fila-contas.json` (read only), and when the next entry after the conductor's account is another agent, add once: "Se a conta principal acabar, a fila da Ratoeira continua a conversa no [agente]. Nele o BACO roda sem os agentes e os ganchos do plugin; uma segunda conta do [agente do condutor] na fila, ou esperar o limite voltar, evita isso."
