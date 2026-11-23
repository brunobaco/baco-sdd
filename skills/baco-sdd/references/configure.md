# Phase 0: Configure

Output: `.baco/config.yaml`. Gate: none. Load this reference when the user asks to set up or change the configuration, or when you offer it (see "Missing config"). The questions themselves are in two more files (see "Questions"): load them when you run the interview.

## Missing config

Without `.baco/config.yaml` the engine uses its defaults (pt-BR, `docs/`, tracker `files`, main `main`, integration `develop`, protected `main`/`master`/`develop`, parallel 3, default gates, `manual_pending` main `block` and others `warn`, default models, no harness listed besides the one in use, the delivery's PR reviewed by an agent with automatic fixes, 3 external review rounds, a new conversation suggested from 290000 tokens of context and never switched without asking, the generic risk criterion, no review focus, 2 rounds of final review, at most 8 tasks and 60 criteria per delivery with the specs frozen after the plan, the full battery in CI on each merge, deliveries ending in the integration branch with a question before each merge, no specialist scenarios). Every phase works on defaults.

So: offer phase 0 once, at the start of the first phase you run in a project without config, with this opening message. Fill `[total]` with the number of questions that will actually be asked in this project (see "How to ask") and `[tempo]` with about one minute per question, rounded (for example "uns 15 minutos"):

> Antes de começar, posso fazer algumas perguntas para ajustar o método ao seu projeto. São [total] perguntas, uma de cada vez, em [tempo]. Elas seguem esta ordem:
>
> 1. Idioma e pasta dos documentos.
> 2. Onde registrar as tarefas.
> 3. Linhas de trabalho do código.
> 4. Ritmo do trabalho e paradas para a sua aprovação.
> 5. Testes do projeto.
> 6. Tamanho da conversa.
> 7. Ferramentas de IA e revisão do trabalho.
> 8. Tamanho das entregas, o que as revisões procuram, onde rodam os testes e onde a entrega termina.
>
> Em cada pergunta eu digo o que é, por que importa, o que cada opção muda na prática, o que eu recomendo para este projeto e qual é o padrão. Duas respostas valem sempre: "pode ser o padrão", e eu sigo com o valor padrão; e "não entendi", e eu explico de outro jeito, com um exemplo do seu projeto.
>
> Se preferir, uso os valores padrão em tudo agora e você ajusta depois. O que prefere?

When the person asked for the configuration themselves (`/baco:configurar`), send the same opening without its last paragraph and follow it with the first question.

If the user declines or ignores it, proceed on defaults and never block, delay or re-ask in that session. If `.baco/config.yaml` already exists, read it, summarize it in plain words, and ask only what the user wants to change; never overwrite it wholesale.

## Existing config without the new keys

A project configured with an older version lacks keys this version brought: `harnesses`, `review.pr` (inside `review`), `context`, when `tracker` lists `github`, `github.project`, and, from 1.10.0, `planning.risk`, `planning.max_tasks` and `planning.max_criteria`, `planning.freeze_specs`, `review.focus`, `review.final_rounds_max`, `test_runs.screen_task_full`, `test_runs.ci_full`, `ci.monthly_minutes`, `delivery.target`, `delivery.integration_merge` and `qa.specialist`. At startup (SKILL.md, "Startup checks"), when `.baco/config.yaml` exists and any of them is missing, offer once, before building (phase 6), to ask only the questions of the missing keys: 8 for `context`, 9 for `harnesses` (and, for an Antigravity entry without `sandbox`, its sandbox question), 10 for `review.pr`, 2B for `github.project`, and, in [configure-questions-delivery.md](configure-questions-delivery.md), 15 for `planning.risk`, 16 for `max_tasks` and `max_criteria`, 17 for `freeze_specs`, 18 for `review.focus`, 19 for `final_rounds_max`, 20 for `screen_task_full`, 21 for `ci_full`, 22 for `ci.monthly_minutes`, 23 for `delivery.target`, 24 for `delivery.integration_merge`, 25 for `qa.specialist` (each keeps its own condition, such as 22 only for a private repository on GitHub). A `handoff_at` of 400000 written by an older version is not "missing": mention once that the default is now 290000 and offer question 8 again. In these words:

> Esta versão do método trouxe ajustes novos que este projeto ainda não tem: [quais, em palavras simples: tamanho da conversa, ferramentas de IA, revisão do pedido de junção (o PR, a página do GitHub em que a entrega pronta espera para entrar no código principal), quadro do GitHub em dia com as tarefas, critério de risco das tarefas, tamanho máximo da entrega, o que as revisões procuram, onde rodam os testes, onde a entrega termina, testes que só um especialista faz].
>
> São [total] perguntas, uma de cada vez. Em cada uma, "pode ser o padrão" e "não entendi" valem como resposta.
>
> Posso fazer só essas perguntas agora, antes de construir? Se preferir, uso os padrões e você ajusta depois.

If the user declines, go on with the defaults and do not ask again in that session. With a yes, ask only those questions and add only those keys, keeping every other line of the file as it is.

When `review.pr` is missing, also say once, as a statement, whether they answered or declined (the PR review is the default either way):

> Uma mudança desta versão: durante a construção, eu envio a linha de trabalho da entrega para o GitHub e abro o pedido de junção (PR) como rascunho, sem perguntar, para a revisão de fora. O pedido de junção é a página do GitHub em que a entrega espera para entrar no código principal; como rascunho, ele não junta nada.
>
> A parada "pedido de junção" passa a valer para o momento de marcar esse rascunho como pronto para juntar. Juntar na linha principal continua esperando você.

## How to ask

- One question at a time, one question per message; wait for the answer. Offer the default so "pode ser o padrão" is a valid answer.
- Numbering. Before the opening message, count the questions that will actually be asked in this project: every block of the question files that starts with `Pergunta [N] de [total]` and whose condition holds, from what you detected (for example 1B only when the documents live outside `docs/`, 13 only with a server side and screens). Number them 1, 2, 3 in the order asked, with no gaps and never with the files' numbers (1B, 6B, 12B). A question in two parts (8, 10, 12B) has two blocks, so two numbers. A follow-up message inside a question (marked "follow-up" in the files) keeps the number of its question and ends its first line with "(continuação)"; it is not a new question. When an answer adds or removes questions (GitHub in 2 brings 2B; another tool in 9 brings its questions and 14; turning an implementer on brings its sandbox question), use the new total from the next header on and say in one short sentence why the count changed. In "Existing config without the new keys", count only the questions of the missing keys.
- Format of a question, always the same, each part in its own short paragraph and in this order: the first line `Pergunta [N] de [total] · [tema]` with the theme given in the block; `O que é:` in plain words; `Por que importa:` with a concrete consequence or example; `Opções:` with one option per line, each saying what changes in practice; `Minha recomendação:` with the reason tied to this project (fill the bracket from what you detected; with no project-specific reason, give the general one, never an invented fact); `Padrão:`. Informational messages (something that will happen, not a question) keep a simple form, in plain words.
- Plain words. Every technical term (token, branch or linha de trabalho, pedido de junção or PR, caixa, ferramenta de IA, nível and esforço, spec, commit and others) is explained in simple words the first time it comes up in this interview. The blocks explain each term where it appears; when a term was already explained earlier in this interview, drop the repeated explanation, and when the question that explains it was skipped, keep the explanation in the next question that uses it.
- "Não entendi". Any sign of doubt ("não entendi", "como assim?", "o que é isso?", a question back, an answer that matches no option) is always a valid answer. Then never repeat the same text and never choose for the person: explain again in other words, with a concrete example from this project (its folders, its branches, its test commands, what the system does), and ask the same question again, with the same header.
- Explain every option before asking: for each alternative, one plain sentence on what it changes in the work and what it costs (time, money, interruptions, risk). The wordings in the question files already do it; keep that when you adapt them to what you detected. Never offer an option without saying what it does.
- Ask every question whose condition holds, including the ones about models (11), review rounds (12) and pending manual scenarios (6B), and, after 12B, questions 13 (how the plan splits the tasks), 14 (who does each role, and the reserves) and 15 to 25 ([configure-questions-delivery.md](configure-questions-delivery.md)). The configuration is still optional (see "Missing config"); once the person accepts it, cover all of it, unless they say "o resto pode ser o padrão", which keeps the defaults for everything not yet asked.
- Technical keys are not questions: `tests.patterns`, `tests.junit_dir`, `tests.queue` and `provenance.ignore` are set by you from what you detect, as the question files and the sections below say, and named in the final summary only when they differ from the default.
- Use the pt-BR wording of the question files as written. Fill brackets from what you detected (git branches, existing `docs/`, `package.json` scripts, CI files). Never invent facts about the project; if you did not detect something, say so.
- Do not explain config keys to the user; map the answers yourself.

## Questions

Each question is a bold heading with its number (for example **9. AI tools**), followed by its condition, its pt-BR wording, its follow-ups and how the answer maps to the config. They live in these files, in the order asked:

| Questions | Subject | File |
|---|---|---|
| 1, 1B | Language; documents folder | [configure-questions.md](configure-questions.md) |
| 2, 2B | Tracker; GitHub Project board | [configure-questions.md](configure-questions.md) |
| 3, 4 | Branch roles; protected branches | [configure-questions.md](configure-questions.md) |
| 5, 6, 6B | Parallelism; gates; pending manual scenarios | [configure-questions.md](configure-questions.md) |
| 7, 7B | Test commands per layer; start the app | [configure-questions.md](configure-questions.md) |
| 8 | Conversation size | [configure-questions-tools.md](configure-questions-tools.md) |
| 9 | AI tools: Claude Code's sandbox, other tools and their levels, an implementer's sandbox, the suggested split when Codex is available, the tool check | [configure-questions-tools.md](configure-questions-tools.md) |
| 10 | Review of the delivery's PR | [configure-questions-tools.md](configure-questions-tools.md) |
| 11, 12, 12B | AI level per task type; external review rounds; reviews of a task | [configure-questions-tools.md](configure-questions-tools.md) |
| 13, 14 | How the plan splits the tasks; who does each role, and the reserves | [ambientes.md](ambientes.md), section 9 |
| 15 to 25 | Risk criterion; size of a delivery and frozen specs; review focus and final rounds; screen tests per task, full battery in CI and CI minutes; where a delivery ends and the merge without asking; specialist scenarios | [configure-questions-delivery.md](configure-questions-delivery.md) |

## Write the file

0. **Branches first.** Before writing any file (`.baco/config.yaml`, `.gitignore`, `.claude/settings.local.json`), the repository must be past the startup check on git (SKILL.md, "Startup checks", step 1): the initial commit exists on the main branch and the integration branch (`branches.integration`) exists. In a brand-new project, with the user's consent, make the initial commit and create the integration branch from it first. Then write the setup on a short-lived branch cut from the integration branch, `git switch -c baco/configuracao <integration>`: the main and the integration branches are both protected, and once `.baco/config.yaml` exists the branch guard blocks every write on them outside `.baco/` (`.gitignore`, `.claude/settings.local.json`). The same holds for a later change of the setup: cut `baco/configuracao` again.

1. Start from [config.yaml](../templates/pt-BR/config.yaml) (the pt-BR template, with its comments).
2. Change only the values the user answered; keep untouched keys at the template value (the user may delete any key to get the default). Write `manual_pending` from question 6B, `harnesses` and `review.pr` from questions 9 and 10 (delete the template's example harness lines the project does not use), `models` from question 11, `review.external_rounds_max` from question 12, `review.task_rounds` and `review.last_round_importante` from question 12B, `planning.task_split` from question 13 and `roles` from question 14, and, from [configure-questions-delivery.md](configure-questions-delivery.md), `planning.risk` (15), `planning.max_tasks` and `max_criteria` (16), `planning.freeze_specs` (17), `review.focus` (18), `review.final_rounds_max` (19), `test_runs.screen_task_full` (20), `test_runs.ci_full` (21), `ci.monthly_minutes` (22), `delivery.target` (23), `delivery.integration_merge` (24) and `qa.specialist` (25). The `harnesses.*.models` values are families when the tool has them (question 9). `models` holds levels, not model names: `forte`, `medio` or `leve`, each with an effort `alto`, `medio` or `baixo`; the real model comes from the environment in use (see [ambientes.md](ambientes.md)).
3. Add `docs_root: <folder>` only when the person chose it in question 1B.
4. Use spaces only (no tabs), `on`/`off` for gates, comments with `#`. Replace the template's example test commands with the confirmed ones; delete example layers the project lacks.
5. Add `.baco/junit/`, `.baco/logs/` and `.baco/local.env` to `.gitignore` (create the file if needed): test reports and the full test output that `baco run-tests` writes to `.baco/logs/` are regenerated by every run, and machine settings are never committed.
6. Save as `.baco/config.yaml`, creating `.baco/` if needed, on `baco/configuracao` from step 0.
7. Write the execution rules (next section), still on `baco/configuracao`. Then commit `.baco/config.yaml`, `.gitignore` and, when Codex is in `harnesses`, `.codex/rules/baco.rules` there, and, when Antigravity is, `.baco/antigravity/leitura.json` (`.claude/settings.local.json` is not versioned), and bring the setup into the integration branch: `git switch <integration>` and `git merge --no-ff baco/configuracao` (moving onto the integration branch asks the person, as the rules say), then `git branch -d baco/configuracao`. Writing straight to a protected branch is a project decision: if the person wants it, ask where to save the change.

## Execution rules (permissions and blocks)

Autonomous execution ([implementation.md](implementation.md)) runs many commands without a person watching. So the project gets explicit rules: what runs without asking, and what never runs, even when the user chose to skip confirmations. Create them here, after the config is saved, on `baco/configuracao` (step 0 of "Write the file"); in an older project that never had them, create them before the first `executar`, on `baco/configuracao` or on the delivery branch, never on a protected branch.

Build the list from what you know of the project: its test commands (`tests`, `tests_quick`, `app.smoke`), the `baco` engine, and git on the delivery and task branches (`baco/ENT-*`).

- Allow: the test commands above; `baco` engine commands (except what "Ask" below names); `git status`, `git diff`, `git log`, `git add`, `git commit`, `git branch`, `git switch`, `git checkout`, `git merge` and `git push`, each only with a `baco/*` or `docs/*` branch (the delivery branch `baco/ENT-NNN`, the task branches `baco/ENT-NNN-<TASK-ID>`, `baco/configuracao` and the document branches `docs/<nome>` of phases 1 to 3); `git worktree add` and `git worktree list` (every task uses them), and removing only the scratch copies made to prove a command in a clean folder (`Bash(git worktree remove --force .worktrees/copia-*)`), and, with Claude Code's sandbox in `rede`, the task folders that `baco cleanup-branches` lists as merged, removed before `--apply` because the cleanup cannot remove them inside the sandbox (`Bash(git worktree remove --force .worktrees/*)`; ambientes.md, section 2); when the project has a GitHub remote, opening the delivery's PR as a draft and reading it (`Bash(gh pr create --draft --base * --head baco/*)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr checks *)`); when `github.project` is set, reading the board and moving its cards (`Bash(gh project view *)`, `Bash(gh project field-list *)`, `Bash(gh project item-add *)`, `Bash(gh project item-edit *)`, `Bash(gh project item-list *)`); when `review.pr.reviewer` is `agente` or `ambos`, importing the agent reviewer's answer with the one command that takes no file and only accepts the latest round's answer (`Bash(node *baco.mjs import-pr-verdict ENT-*)`); and, for each harness in `harnesses` other than the one in use that has a real read-only sandbox, its read-only call only ([ambientes.md](ambientes.md), section 5; for Codex, `Bash(codex exec * -s read-only *)`, with the Codex asks and denies below; for Antigravity, `Bash(antigravity -p * --settings .baco/antigravity/leitura.json *)` and, when its `implementers` is on, the implementer call from a task folder `Bash(antigravity -p * --settings .agents/baco-construcao.json * --mode accept-edits --print-timeout 0 *)` (the `--mode accept-edits` is part of that call, so the `--mode` ask below is written only for the read-only call), with the same rules for `agy` when that is the machine's name, and the Antigravity asks and denies below; the call is made without a prefix such as `timeout <n>`, which would not match: the time limit is the Bash tool's own `timeout` setting, as in ambientes.md, section 5). Write the git allows with the branch in the pattern (for example `Bash(git switch baco/*)`, `Bash(git switch docs/*)`, `Bash(git switch -c docs/*)`, `Bash(git merge --no-ff baco/*)`), never a bare `git switch *` or `git push *`, which would also catch the main and integration branches.
- Ask (the human decides, even when the user chose to skip confirmations). Use the configured names (`branches.main`, `branches.integration`), not the literal `main` and `develop`; `<m>` and `<i>` below stand for them:
  - moving onto or pushing into the main or the integration branch, which is what backs the never-off gate `merge_main` ([gates.md](gates.md)): `git checkout <m>*`, `git switch <m>*`, `git checkout <i>*`, `git switch <i>*`, `git push * <m>*`, `git push *:<m>*`, `git push * <i>*`, `git push *:<i>*`;
  - merging the delivery's PR on GitHub, which is the same move (`Bash(gh pr merge*)`);
  - so merging `baco/configuracao` or a `docs/<nome>` branch into the integration branch asks too. Do it right after the person approves that step, while they are there, as its own command (not chained with `&&` to other git commands, so the prompt says plainly what it is). An unattended run that reaches it records it in the Retomada and waits, never looks for another way;
  - `baco waive-review`, and every `baco import-verdict` (a file, standard input, a here-document, `/dev/stdin`), because the engine has no human check of its own: only the human waives the external review or brings a person's verdict (`Bash(node *baco.mjs waive-review*)`, `Bash(node *baco.mjs import-verdict*)`). Never narrow this ask to one form of the command. The agent reviewer's answer goes through `baco import-pr-verdict`, allowed above: its harness wrote the file, you never write or edit it, and the engine takes only the latest round's answer;
  - a call to another harness that is not read-only or not sandboxed: OpenCode (`Bash(opencode run*)`: its `plan` agent cannot edit files, but its shell is not sandboxed), and a Codex call that widens what Codex may write (`Bash(codex exec *workspace-write*)`, `Bash(codex exec *--add-dir*)`, `Bash(codex exec *--profile*)`, `Bash(codex exec * -p *)`, `Bash(codex exec *--worktree*)`, and, only when its `sandbox` is `livre`, `Bash(codex exec *danger-full-access*)`), so that an extra flag after `-s read-only` never runs unseen; and an Antigravity call that adds to or replaces its read-only rules (`Bash(antigravity * --settings * --settings *)`, `Bash(antigravity *--add-dir*)`, `Bash(antigravity *leitura.json*--mode*)`, `Bash(antigravity *--agent*)`, `Bash(antigravity *--remote*)`, and the same with `agy`). A harness marked `implementers: on` therefore stops for its write calls unless the person approves an allow for exactly that call; say so.
- Never (deny): `sudo`; `git push --force*` and `git push -f*`; `git reset --hard*`; a Codex call outside its configured sandbox or without BACO's rules (`Bash(codex exec *--dangerously-bypass-approvals-and-sandbox*)`, `Bash(codex exec *--approve-for-me*)`, whose reviewer can approve leaving the sandbox, `Bash(codex exec *--dangerously-bypass-hook-trust*)`, an Antigravity call that approves everything (`Bash(antigravity *--dangerously-skip-permissions*)`, `Bash(agy *--dangerously-skip-permissions*)`), `Bash(codex exec *--ignore-rules*)`, `Bash(codex exec *--ignore-user-config*)`, and the `-c`/`--config` overrides `Bash(codex exec *sandbox_mode*)`, `Bash(codex exec *sandbox_permissions*)`, `Bash(codex exec *writable_roots*)`, `Bash(codex exec *default_permissions*)`; with `sandbox: protegida`, also `Bash(codex exec *network_access*)`; with `protegida` or `rede`, also `Bash(codex exec *danger-full-access*)`); deleting the `develop` or `main` branches (local or remote; again the configured names); `rm -rf`; writing outside the project folder, except one place: the review copy folder that `baco build-handoff --mode repositorio` creates next to the project (`<projeto>-revisao-ENT-NNN-rNN`). In Claude Code a deny cannot be overridden by an allow, so write the outside-the-project rule without catching that path. A command that looks destructive goes through a project script that has its own check, never loose in a command.

In Claude Code the order is deny, then ask, then allow: the first that matches wins, so an `ask` rule is not swallowed by a broader `allow`, and a `deny` beats both. Write them to `.claude/settings.local.json` (not versioned; add it to `.gitignore` if it is not already there), under `permissions.allow`, `permissions.ask` and `permissions.deny`. Keep what the file already has. Check that no allow pattern matches an ask pattern (for example `git push *`); if one does, narrow the allow. Show the user the rules in plain words before saving:

> Para o trabalho rodar sozinho sem arriscar nada, vou deixar estas regras no projeto. Elas dizem o que eu posso fazer sem te perguntar, o que sempre pergunta e o que nunca roda.
>
> Pode rodar sem perguntar: os testes do projeto, os comandos do BACO, o git nas linhas de trabalho desta entrega, enviar a linha de trabalho da entrega e abrir o pedido de junção (PR) dela como rascunho, chamar as outras ferramentas de IA só para ler e revisar, quando elas têm um modo só leitura (a caixa do Codex, ou as regras de leitura do BACO no Antigravity), e registrar a resposta do revisor de IA da última rodada.
>
> Sempre pergunta a você, mesmo se você pedir para não confirmar nada: ir para as linhas principais do código (onde fica o que já foi aprovado) ou enviar algo para elas, juntar o pedido de junção, dispensar a revisão externa, registrar qualquer veredito (a conclusão de uma revisão) que não seja a resposta do revisor de IA, como a revisão de uma pessoa, e chamar uma ferramenta de IA que pode gravar ou não tem proteção de só leitura (como o OpenCode).
>
> Nunca roda: comandos de administrador (sudo), envio forçado (que apaga o histórico que está no GitHub), voltar o código à força (que descarta mudanças sem volta), apagar as linhas principais, apagar pastas inteiras, rodar o Codex fora da caixa que você escolheu ou sem as regras do BACO, rodar o Antigravity aprovando tudo sozinho e escrever fora do projeto, exceto a cópia para o revisor, ao lado do projeto.
>
> Posso salvar assim?

Save only after the user agrees. In another environment (Codex or another host), describe the equivalent in that tool's own mechanism, as in [ambientes.md](ambientes.md). If the tool cannot enforce a block, say so plainly and keep the rule as an instruction only:

> Neste ambiente não consigo impedir esses comandos por regra, só pedir para não rodarem. Se quiser a garantia de verdade, é preciso configurar o bloqueio na própria ferramenta.

Never claim a block is in force until you have read the saved file back.

**Claude Code's sandbox.** When `harnesses.claude-code.sandbox` is `rede`, write the `sandbox` block of [ambientes.md](ambientes.md), section 2, into the same `.claude/settings.local.json`: `enabled: true`, `allowUnsandboxedCommands: false`, `excludedCommands` with `codex exec *` when Codex is in `harnesses` and `antigravity -p *` (or `agy -p *`) when Antigravity is, `git worktree remove *` and the command that keeps the app running (question 9, [configure-questions-tools.md](configure-questions-tools.md)), `filesystem.allowWrite` with the package manager's cache, and `network.allowedDomains` with the approved list. Keep what the file already has. Add to the summary for the person, before saving:

> Também vou ligar a minha caixa neste projeto: gravo só na pasta dele e acesso só [lista]. O [Codex / comando do app] roda fora da minha caixa, [o Codex com a caixa e as regras dele / para você conseguir abrir o sistema no navegador].

The sandbox applies from the next conversation on, because Claude Code reads it when a conversation starts. After saving, tell the person:

> A caixa vale a partir da próxima conversa. Abra uma conversa nova neste projeto para seguir; nela eu confiro se a caixa ligou.

In that next conversation (the startup check of SKILL.md), run the check of that section (a refused connection to a host outside the list) and say the result in one line. If the sandbox does not come on, say why (for example `bubblewrap` or `socat` missing on Linux) and ask whether to go on as `livre`.

### When a write is blocked

If saving `.claude/settings.local.json` (above) fails because a hook or policy of another plugin blocks it:

1. Tell the user in plain words what was blocked and the effect: the run may ask for confirmations.
2. Show the exact file path and its full content, ready to copy, in a fenced code block.
3. In the Ratoeira (detected as in implementation.md, section 10), also generate a ready prompt, in a fenced code block, that the user can paste into another AI of the Ratoeira (for example Codex). It must ask that AI to write exactly that file, at that path, with exactly that content, to touch nothing else, and to show the file back. When the file may already exist with other settings (for example `.claude/settings.local.json`), first read it if you can and put in the prompt the full merged file, or ask the other AI to add only the new keys and keep the rest.
4. After the user says it is done, read the file again and compare it with what was meant. Only then say the rule is in force.

Never try to get around the block yourself: no other tool, no shell trick, no different path.

### Records outside the delivery folder

Run logs and notes about a delivery belong inside `docs/entregas/ENT-NNN-<slug>/`. Anything else the project writes automatically outside it (for example an environment that commits every few minutes) would make traces, verdicts and waivers stale on every commit: list those paths in `provenance.ignore` in `.baco/config.yaml`, only exact files or record folders (for example `docs/registros/**`), never code or test folders; the engine refuses broad entries, entries that reach `.baco/` and entries that cover tests. Adding or changing an entry needs the human's explicit ok, recorded in `progresso.md` (`guard-tests` stops with `CONFIG_PROVENANCE_CHANGED` until then). When the engine reports something stale, first check which files changed after it (`git diff --stat <recorded commit> HEAD`) and explain in plain words before re-running anything.

## Validate

Run `baco check-branch`. It loads the config, so a bad file shows up here.
- Exit 0 or 1 with no config warning: the config loaded. Exit 1 here only means the current branch is protected (for example after the merge into the integration branch); it is not a config failure.
- A warning on stderr (`config.invalid_section`: a section that must be a map was something else; `config.mandatory_gate_ignored`: a never-off gate was set to off): fix the file, run again. Tell the user in plain words what was ignored.
- Exit 65 with a config error naming a line: fix that line (usually a tab, an unbalanced quote or bracket, or a bad indent) and run again.

Then close with this summary, in everyday words, one short line per subject, saying what was agreed and what it means in practice (not the config keys). Fill each bracket with the real answer:

> Pronto: a configuração está salva e conferida, no arquivo `.baco/config.yaml`. Em palavras simples, combinamos isto:
>
> Idioma: [os documentos e as mensagens saem em português / as mensagens saem em inglês e os documentos começam com títulos em português].
> Tarefas: [ficam registradas em arquivos do projeto / em arquivos e também no GitHub], [e eu mantenho o quadro "[nome]" do GitHub em dia / sem quadro do GitHub].
> Linhas de trabalho: a principal é [nome], onde só entra o que você aprovar; a de integração é [nome], onde as entregas se juntam primeiro.
> Ritmo: até [número] tarefas ao mesmo tempo; eu paro para você aprovar em [paradas ligadas, em palavras simples].
> Testes: [cada tipo de teste com o comando completo e o rápido, e se eu já conferi que rodam]; [o comando que liga o sistema é X / a fase de arquitetura vai criar o comando que liga o sistema].
> Conversa: a partir de [número] mil tokens, eu [sugiro continuar numa conversa nova / troco sozinho para uma conversa nova durante a construção].
> Entregas: no máximo [número] tarefas e [número] critérios; [as specs ficam congeladas depois do plano / as specs podem mudar no meio]; terminam na linha [integração / principal], [e eu pergunto antes de cada junção / e junto sozinho quando tudo estiver conferido, menos na principal].
> Revisões: [o critério de risco e o que procuram, se você definiu]; revisão final em até [número] rodadas.
> Testes: [a bateria completa roda no CI a cada junção / só quando você disparar]; [testes de tela nos outros navegadores em cada tarefa / só no fim]; [testes que ficam com um especialista, se houver].
> Ferramentas de IA: [quais ferramentas, quem constrói e quem revisa, e o modelo de cada nível].
> Revisão do pedido de junção: [quem revisa], e [eu corrijo sozinho o que ela apontar / cada rodada espera você].
> Regras de segurança: [salvas no projeto / não salvas, e por quê].
>
> Você pode pedir para mudar qualquer item quando quiser.
