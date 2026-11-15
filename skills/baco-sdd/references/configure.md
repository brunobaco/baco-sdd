# Phase 0: Configure

Output: `.baco/config.yaml`. Gate: none. Load this reference when the user asks to set up or change the configuration, or when you offer it (see "Missing config").

## Missing config

Without `.baco/config.yaml` the engine uses its defaults (pt-BR, `docs/`, tracker `files`, main `main`, integration `develop`, protected `main`/`master`/`develop`, parallel 3, default gates, `manual_pending` main `block` and others `warn`, default models, no harness listed besides the one in use, the delivery's PR reviewed by an agent with automatic fixes, 3 external review rounds, a new conversation suggested from 400000 tokens of context and never switched without asking). Every phase works on defaults.

So: offer phase 0 once, at the start of the first phase you run in a project without config, in these words:

> Antes de começar: posso fazer umas 7 perguntas rápidas para ajustar o método ao seu projeto (idioma, onde registrar as tarefas, branches ou linhas de trabalho do código, paradas e testes). Se preferir, uso os valores padrão e você ajusta depois. O que prefere?

If the user declines or ignores it, proceed on defaults and never block, delay or re-ask in that session. If `.baco/config.yaml` already exists, read it, summarize it in plain words, and ask only what the user wants to change; never overwrite it wholesale.

## Existing config without the new keys

A project configured with an older version lacks keys this version brought: `harnesses`, `review.pr` (inside `review`) and `context`. At startup (SKILL.md, "Startup checks"), when `.baco/config.yaml` exists and any of them is missing, offer once, before building (phase 6), to ask only the questions of the missing keys: 8 for `context`, 9 for `harnesses`, 10 for `review.pr`. In these words:

> Esta versão do método trouxe ajustes novos que este projeto ainda não tem: [quais, em palavras simples: tamanho da conversa, ferramentas de IA, revisão do pedido de junção (PR)]. Posso fazer só essas perguntas agora, antes de construir? Se preferir, uso os padrões e você ajusta depois.

If the user declines, go on with the defaults and do not ask again in that session. With a yes, ask only those questions and add only those keys, keeping every other line of the file as it is.

When `review.pr` is missing, also say once, as a statement, whether they answered or declined (the PR review is the default either way):

> Uma mudança desta versão: durante a construção, eu envio a linha de trabalho da entrega para o GitHub e abro o pedido de junção (PR) como rascunho, sem perguntar, para a revisão de fora. A parada "pedido de junção" passa a valer para o momento de marcar esse rascunho como pronto para juntar. Juntar na linha principal continua esperando você.

## How to ask

- One question at a time; wait for the answer. Offer the default so "pode ser o padrão" is a valid answer.
- Use the pt-BR wording below as written. Fill brackets from what you detected (git branches, existing `docs/`, `package.json` scripts, CI files). Never invent facts about the project; if you did not detect something, say so.
- Do not explain config keys to the user; map the answers yourself.

## Questions

**1. Language** (`language`; accepted `pt-BR` or `en`)

> Em que idioma você quer os documentos e as mensagens? O padrão é português do Brasil.

`en` makes the engine's messages English. The document templates shipped with the skill are pt-BR only; tell the user so if they choose English.

**2. Tracker** (`tracker`: a list of `files`, `github`)

> Onde você quer registrar as tarefas? (a) só em arquivos dentro do projeto, na pasta de documentos; (b) em arquivos e também no GitHub, como itens de acompanhamento (issues). O padrão é só arquivos.

(a) -> `[files]`; (b) -> `[files, github]`. Do not test GitHub access here; phase 5 checks it when it publishes.

**3. Branch roles** (`branches.main`, `branches.integration`)

> Detectei estas branches (linhas de trabalho do código) no projeto: [lista]. Qual é a principal, onde só entra o que foi aprovado? [padrão: main] E qual é a de integração, onde as entregas se juntam antes da principal? [padrão: develop]

If the project has no integration branch, keep `develop` as the name and say that nothing is created now.

**4. Protected branches** (`branches.protected`)

> Quais branches (linhas de trabalho do código) ninguém deve editar direto? [padrão: main, master e develop]. A principal e a de integração ficam protegidas sempre.

**5. Parallelism** (`parallel`; 0 = one task at a time)

> Quantas tarefas podem andar ao mesmo tempo? Mais tarefas juntas termina mais rápido, mas gasta mais e dá mais conflitos. O padrão é 3; 0 significa uma de cada vez.

**6. Gates to adjust** (`gates`)

Name each adjustable stop in plain words and ask which to change:

> Por padrão, o trabalho para e espera sua aprovação nestes pontos: início do projeto, arquitetura, plano da entrega, lote de tarefas e o pedido de junção (PR) pronto para juntar, depois da revisão. Entre eles, as tarefas rodam sozinhas. Quer mudar algum? Dá também para pedir uma parada depois de cada tarefa. Três paradas nunca desligam: aprovação da spec, ação sem volta (apagar dados, publicar em produção) e junção na branch principal.

Map: início do projeto `project_start`; arquitetura `architecture`; plano `plan`; lote `task_batch`; depois de cada tarefa `each_task`; pedido de junção `before_pr`. Write `on` or `off`. If the user asks to turn off a never-off gate, refuse as in `gates.md` and leave it out of the file or `on`. Ask also, only if the user brings it up, how pending manual scenarios are treated (`manual_pending`: `block` or `warn`; role keys `main` and `integration`, a literal branch name wins, `"*"` is the fallback).

**7. Test commands per layer** (`tests.<layer>`, for example `unit`, `e2e_web`; quick version in `tests_quick.<layer>`)

> Quais comandos rodam os testes do projeto? Por exemplo, um para os testes das regras e funções, e outro para os testes do site no navegador. Pode me dizer o comando de cada um? Se não souber, eu procuro no projeto e confirmo com você.

Detect candidates from `package.json` scripts and CI files; show them and ask for confirmation. Skip layers the project does not have.

For a layer that runs in a browser, ask for two versions: the full one (every browser the product must work in; phase 1 records which) in `tests.<layer>`, and a quick one (Chromium only) in `tests_quick.<layer>`. The quick one is what runs during construction; without it the engine falls back to the full command.

> Para os testes no navegador, preciso de duas versões do comando: a completa, que roda em todos os navegadores, e a rápida, que roda só no Chrome (Chromium) e serve para o dia a dia da construção. Se ainda não tiver a rápida, eu proponho uma.

Layers that start with `e2e` are serialized machine-wide by the engine (`tests.queue` lists them; default is every layer starting with `e2e`). Change `tests.queue` only if the user's layers are named otherwise.

Every command of the project must run without asking anything: a command that waits for typing fails in `baco run-tests` (stdin is closed). If a command asks (a confirmation, a password), fix it with a flag or a variable before saving it.

**7B. Start the app** (`app.smoke`)

> Existe um comando que sobe o sistema do jeito que o usuário usa, confere que ele responde e termina? Se não existir, deixo marcado para a fase de arquitetura criar.

`app.smoke` is a command that starts the app as the user does, checks it answers, and exits 0, with no interactive prompt. If the project has no app yet, or no such command, write nothing under `app` and note in the summary that phase 3 creates it. Run it with `baco run-tests --smoke` to check it, with the user's consent.

**8. Conversation size** (`context.handoff_at`, default 400000; `context.auto_handoff`, default `off`)

Before showing the default, in Claude Code read the `autoCompactWindow` setting (`.claude/settings.local.json` of the project, then `.claude/settings.json`, then `~/.claude/settings.json`; the first that has it wins; a missing or unreadable file is skipped). Claude Code summarizes the conversation by itself at about 80% of that window, before a larger `handoff_at` would ever fire. The warning is read only after the step that crossed the line, and a step adds 10000 to 20000 tokens, so the plugin hook warns 30000 tokens before that point: the value that really counts (the effective limit) is the smaller of `handoff_at` and 80% of `autoCompactWindow` minus 30000 (with a window of 400000: 320000 minus 30000, 290000). The hook names both numbers in its warning.

When the setting exists, propose that effective limit as the value and write it as `handoff_at`, not the plain default: a `handoff_at` above it is never reached and misleads whoever reads the configuration. When the person's answer is above the effective limit, explain in pt-BR that the Claude Code would summarize the conversation before that and the warning will come at the effective limit anyway, and write the effective limit (or a smaller value they choose).

The context does not start at zero: the host's instructions, tools and skills already take some room before the first question (in some environments close to 130000 tokens). The room for work is the limit minus that starting size, so with a limit near 300000 the first switch may come before the plan is written. Say this in one sentence when the person picks a small value.

Show the default first, then ask the two questions one at a time:

> Conversa muito longa fica mais cara a cada passo e lembra pior dos detalhes. Como tudo fica salvo nos arquivos, continuar numa conversa nova custa pouco. O padrão é este: a partir de 400 mil tokens de contexto, sugiro continuar numa conversa nova. Quer outro valor?

When `autoCompactWindow` exists, use this wording instead, filling the brackets (for example 320 mil and 290 mil):

> Conversa muito longa fica mais cara a cada passo e lembra pior dos detalhes. Como tudo fica salvo nos arquivos, continuar numa conversa nova custa pouco. O seu Claude Code resume a conversa sozinho perto de [80% da janela de resumo automático] tokens. Para dar tempo de terminar o passo e trocar antes disso, proponho avisar em [limite efetivo] tokens. Lembre que a conversa já começa com uma parte ocupada pelas instruções e ferramentas, então a primeira troca pode vir cedo. Pode ser esse valor, ou quer um menor?

> Durante a construção, quando a conversa passar desse tamanho, posso trocar para uma conversa nova sem te perguntar? Eu termino a tarefa em andamento, salvo onde parei e continuo na conversa nova. O padrão é perguntar antes.

A number -> `handoff_at` (a positive whole number of tokens; above the effective limit, the effective limit, as said above); "pode ser o padrão" keeps 400000, or the effective limit when `autoCompactWindow` exists. Yes to the second -> `auto_handoff: on`; otherwise `off`. Outside the Ratoeira the agent cannot open a conversation by itself, so say that there the switch is only suggested, with a ready request to paste. The plugin hook reads these keys in Claude Code; in another host they guide the agent only.

**9. AI tools** (`harnesses`)

First, the tool you run in. In Claude Code, ask how free it is in this project (`harnesses.claude-code.sandbox`; [ambientes.md](ambientes.md), section 2, "Claude Code's sandbox"), and recommend `rede`:

> Antes das outras ferramentas, uma pergunta sobre mim. Neste projeto, quanta liberdade eu tenho nos comandos? (a) rede: eu gravo só na pasta do projeto e acesso a internet só nos endereços que você aprovar (GitHub e o registro de pacotes do projeto); se um texto malicioso lido de fora me mandasse enviar suas chaves para outro lugar, a caixa recusaria; (b) livre: como hoje, gravo onde você pode e acesso qualquer endereço, protegido só pelas regras e pela confirmação das ações arriscadas. Recomendo a rede. Ela vale para todas as conversas deste projeto, inclusive as suas.

With `rede`, propose the network list from the project's stack (GitHub, its package registries) and ask:

> Vou liberar estes endereços: [lista]. Precisa de mais algum, como uma API que os testes chamam?

and, when the project has an app the person tests in the browser:

> Para você testar o sistema no navegador, eu deixo ele rodando com um comando. Dentro da caixa, um sistema iniciado assim só fica visível para o próprio comando, então esse comando roda fora dela. Qual é ele? [detectado: por exemplo npm run dev]

Save the answer as `sandbox` under `harnesses.claude-code`, and keep the list and the command for the settings (step 7 of "Write the file" and "Execution rules"). Then detect what else this machine has (for example `claude`, `codex`, `opencode` on the PATH), then ask:

> Além de mim, você tem outras ferramentas de IA para usar neste projeto, como Codex ou OpenCode? Com mais de uma, uma pode revisar o trabalho da outra, o que deixa a revisão mais independente. Detectei: [lista]. Quais quer usar?

For each tool the user wants, list its models from the tool itself and recommend the level of each ([ambientes.md](ambientes.md), section 5, "Adding one"), in plain words:

> No [ferramenta], recomendo: forte = [modelo], para revisar e decidir o que é difícil; médio = [modelo], para o trabalho comum; leve = [modelo], para tarefas simples e buscas. Pode ser assim?

Save each approved tool under `harnesses.<name>` with its `models`. The tool you run in gets `implementers: on`. Every other tool gets `implementers: off` and only reviews and searches, never changes code, until it has been tested end to end with BACO; set `on` only when the user asks for it after such a test and its write check (below) passed, and say what it changes:

> Por enquanto, as outras ferramentas só revisam e procuram informação; quem constrói é a ferramenta em que eu estou. Quando você tiver testado uma delas de ponta a ponta, posso liberar para ela construir também.

When a tool other than yours gets `implementers: on` (now or later), ask how free it is when it builds (`harnesses.<name>.sandbox`; [ambientes.md](ambientes.md), section 5, "Sandbox"), and recommend `rede`:

> Quando o [ferramenta] construir, quanta liberdade ele tem? (a) protegida: grava só na pasta da tarefa e não tem internet, então eu instalo as dependências e rodo os testes de tela por ele, o que gasta mais do meu lado; (b) rede: grava só na pasta da tarefa, mas tem internet e pode abrir o app para testar, então faz o trabalho inteiro sozinho; (c) livre: sem caixa nenhuma, lê e grava onde você pode, como eu hoje. Nas três, as regras do BACO recusam os comandos proibidos (administrador, enviar ao GitHub, fazer commit, apagar pastas inteiras), mas elas são um filtro, não uma barreira. Com internet, um texto malicioso lido de fora (um pacote, uma página) teria caminho para mandar suas chaves para fora, o mesmo risco que eu já corro. Recomendo a rede: dá a ele o que a tarefa precisa e mantém a gravação presa na pasta. O padrão é rede.

Save the answer as `sandbox` (`protegida`, `rede` or `livre`). A tool with no command-rules mechanism of its own takes only `protegida`; say so. For Codex, whenever it is listed in `harnesses`, copy [templates/codex/baco.rules](../templates/codex/baco.rules) to `.codex/rules/baco.rules` in the project; it is committed with the setup (step 7 of "Write the file"), so every task folder carries it.

Then check each tool other than yours on this machine, before any plan relies on it ([ambientes.md](ambientes.md), section 5, "Check before relying on it"): the read call always, the write call only for a tool marked `implementers: on`, in its configured `sandbox`, which also tries a network fetch, binding a local port and a forbidden command, and records `rede`, `porta` and `regra` in `.baco/logs/harnesses.md` (a missing capability is reported, never fixed by widening the sandbox beyond its value) (also when the user turns it on later; `on` takes effect only after that check passed). Say the result in one line per tool. A tool that fails stays in the config, but no plan gives it work until a new check passes; tell the person with the message of that section and never widen its sandbox beyond the configured value.

**Suggested split when Codex is available.** When Codex is installed and its read check passed, suggest (never impose) this split, with the one-line reason, and let the person accept it or change any part. When only your own harness is available, skip this and keep the usual setup (implementers by risk class, every role on your harness):

> Como o Codex está funcionando aqui, sugiro esta divisão: eu conduzo o trabalho, os implementadores e os revisores de tarefa ficam no Claude (cada implementador no modelo da classe de risco da tarefa, ou no modelo mais forte, se você preferir), a revisão do pedido de junção (PR) fica no Codex, com o modelo mais capaz, esforço alto e só leitura, e o localizador usa o modelo mais leve do Claude. O motivo: em testes ponta a ponta, o Codex como revisor custou cerca de 1% do uso e achou defeitos graves que as revisões do Claude não acharam, enquanto o Codex construindo, na caixa protegida (sem rede e sem abrir porta), devolveu a instalação e os testes de navegador para mim e encareceu o trabalho. Se você quiser que o Codex construa, a caixa com rede resolve essa parte, mas ainda não foi testada numa entrega inteira. Pode ser assim, ou prefere mudar alguma parte?

If accepted, record the PR reviewer on `codex` (its model and effort in the agents table of the plan) and leave `implementers: off` for Codex; the plan shows the split for approval like any other.

When the user later says they added a subscription, come back to this question for that tool only.

**10. Review of the delivery's PR** (`review.pr.reviewer`, default `agente`; `review.pr.auto_fix`, default `on`)

Ask the two questions one at a time:

> No fim de cada entrega, o pedido de junção (PR) passa por uma revisão de fora, além das revisões internas. Quem faz essa revisão: (a) outra IA, de preferência uma ferramenta diferente da que construiu, sem você precisar fazer nada; (b) uma pessoa do time; (c) as duas, primeiro a IA e depois a pessoa. O padrão é a IA.

> Quando a revisão apontar problemas, posso corrigir sozinho, no mesmo pedido de junção, e pedir para o mesmo revisor conferir só as correções, até ele aprovar ou chegar ao limite de rodadas? O padrão é sim.

(a) -> `agente`; (b) -> `pessoa`; (c) -> `ambos`. Yes to the second -> `auto_fix: on`; no -> `off` (then each round of findings waits for the person before fixing). Then say once, as a statement, what the PR review changes in the run:

> Para essa revisão, durante a construção eu envio a linha de trabalho da entrega para o GitHub e abro o pedido de junção (PR) como rascunho, sem perguntar. Um rascunho não pede para juntar nada. A parada "pedido de junção" passa a valer para o momento de marcar esse rascunho como pronto para juntar, e juntar a entrega na linha principal continua esperando você, sempre.

### Known gap: each command must write its own JUnit file

The engine reads every `*.xml` in `tests.junit_dir` (default `.baco/junit`). It does not turn the command's output into a report (`baco run-tests` only saves that output to `.baco/logs/` for reading). So each test command must itself write its JUnit XML into `.baco/junit/`, for example with an output-file flag or variable. A bare `--reporter=junit` often prints to the terminal and writes nothing.

Examples (verify against the project's tool and version before using):
- Vitest: `npx vitest run --reporter=junit --outputFile=.baco/junit/unit.xml`
- Node test runner: `node --test --test-reporter=junit --test-reporter-destination=.baco/junit/unit.xml`
- Playwright: `PLAYWRIGHT_JUNIT_OUTPUT_FILE=.baco/junit/e2e.xml npx playwright test --reporter=junit`
- Jest (with `jest-junit`): `JEST_JUNIT_OUTPUT_DIR=.baco/junit npx jest --reporters=jest-junit`

Verify, do not assume: with the user's consent, run each command once and check that a new `.xml` appeared under `.baco/junit/` and that it lists the tests. If it did not, fix the command (flag or variable) and run again. In a project with no code yet the command cannot run; it stays unverified until the plan's skeleton task proves it with a clean install ([planning.md](planning.md), section 4, "Skeleton task"). If the user declines to run it, write the command and tell them it is unverified:

> Ainda não conferi se esse comando gera o relatório de testes na pasta certa. Sem isso, a conferência dos critérios de aceite não enxerga os testes. Posso rodar uma vez para checar?

Test titles must carry the criterion ID (`[CA-…]` or `[CT-…]`); that matters in phase 6, not here.

### Machine settings: `.baco/local.env`

Things that differ per machine (for example `PLAYWRIGHT_BROWSERS_PATH`, a local database URL for tests) go in `.baco/local.env`, one `KEY=VALUE` per line. `baco run-tests` loads it before each command. It is never versioned: add `.baco/local.env` to `.gitignore` and create the file only when there is something to put in it. If a test command only works with a path or variable specific to this machine, put it here, not in the command.

Do not change `tests.patterns` unless the project's tests live outside the defaults (`*.test.*`, `*.spec.*`, `e2e/`, `.maestro/`).

## Write the file

0. **Branches first.** Before writing any file (`.baco/config.yaml`, `.gitignore`, `.claude/settings.local.json`), the repository must be past the startup check on git (SKILL.md, "Startup checks", step 1): the initial commit exists on the main branch and the integration branch (`branches.integration`) exists. In a brand-new project, with the user's consent, make the initial commit and create the integration branch from it first. Then write the setup on a short-lived branch cut from the integration branch, `git switch -c baco/configuracao <integration>`: the main and the integration branches are both protected, and once `.baco/config.yaml` exists the branch guard blocks every write on them outside `.baco/` (`.gitignore`, `.claude/settings.local.json`). The same holds for a later change of the setup: cut `baco/configuracao` again.

1. Start from [config.yaml](../templates/pt-BR/config.yaml) (the pt-BR template, with its comments).
2. Change only the values the user answered; keep untouched keys at the template value (the user may delete any key to get the default). Keep `models` and `review.external_rounds_max` as in the template unless asked; write `harnesses` and `review.pr` from questions 9 and 10 (delete the template's example harness lines the project does not use). `models` holds levels, not model names: `forte`, `medio` or `leve`, each with an effort `alto`, `medio` or `baixo`; the real model comes from the environment in use (see [ambientes.md](ambientes.md)). If the user asks to change it, talk in levels and say what each costs and gives in plain words; never ask them to pick a model name.
3. Add `docs_root: <folder>` only when the project's documents live somewhere other than `docs/`.
4. Use spaces only (no tabs), `on`/`off` for gates, comments with `#`. Replace the template's example test commands with the confirmed ones; delete example layers the project lacks.
5. Add `.baco/junit/`, `.baco/logs/` and `.baco/local.env` to `.gitignore` (create the file if needed): test reports and the full test output that `baco run-tests` writes to `.baco/logs/` are regenerated by every run, and machine settings are never committed.
6. Save as `.baco/config.yaml`, creating `.baco/` if needed, on `baco/configuracao` from step 0.
7. Write the execution rules (next section), still on `baco/configuracao`. Then commit `.baco/config.yaml`, `.gitignore` and, when Codex is in `harnesses`, `.codex/rules/baco.rules` there (`.claude/settings.local.json` is not versioned), and bring the setup into the integration branch: `git switch <integration>` and `git merge --no-ff baco/configuracao` (moving onto the integration branch asks the person, as the rules say), then `git branch -d baco/configuracao`. Writing straight to a protected branch is a project decision: if the person wants it, ask where to save the change.

## Execution rules (permissions and blocks)

Autonomous execution ([implementation.md](implementation.md)) runs many commands without a person watching. So the project gets explicit rules: what runs without asking, and what never runs, even when the user chose to skip confirmations. Create them here, after the config is saved, on `baco/configuracao` (step 0 of "Write the file"); in an older project that never had them, create them before the first `executar`, on `baco/configuracao` or on the delivery branch, never on a protected branch.

Build the list from what you know of the project: its test commands (`tests`, `tests_quick`, `app.smoke`), the `baco` engine, and git on the delivery and task branches (`baco/ENT-*`).

- Allow: the test commands above; `baco` engine commands (except what "Ask" below names); `git status`, `git diff`, `git log`, `git add`, `git commit`, `git branch`, `git switch`, `git checkout`, `git merge` and `git push`, each only with a `baco/*` branch (the delivery branch `baco/ENT-NNN` and the task branches `baco/ENT-NNN-<TASK-ID>`); `git worktree add` and `git worktree list` (every task uses them), and removing only the scratch copies made to prove a command in a clean folder (`Bash(git worktree remove --force .worktrees/copia-*)`); when the project has a GitHub remote, opening the delivery's PR as a draft and reading it (`Bash(gh pr create --draft --base * --head baco/*)`, `Bash(gh pr view *)`, `Bash(gh pr diff *)`, `Bash(gh pr checks *)`); when `review.pr.reviewer` is `agente` or `ambos`, importing the agent reviewer's answer with the one command that takes no file and only accepts the latest round's answer (`Bash(node *baco.mjs import-pr-verdict ENT-*)`); and, for each harness in `harnesses` other than the one in use that has a real read-only sandbox, its read-only call only ([ambientes.md](ambientes.md), section 5; for Codex, `Bash(codex exec * -s read-only *)`, with the Codex asks and denies below; the call is made without a prefix such as `timeout <n>`, which would not match: the time limit is the Bash tool's own `timeout` setting, as in ambientes.md, section 5). Write the git allows with the branch in the pattern (for example `Bash(git switch baco/*)`, `Bash(git merge --no-ff baco/*)`), never a bare `git switch *` or `git push *`, which would also catch the main and integration branches.
- Ask (the human decides, even when the user chose to skip confirmations). Use the configured names (`branches.main`, `branches.integration`), not the literal `main` and `develop`; `<m>` and `<i>` below stand for them:
  - moving onto or pushing into the main or the integration branch, which is what backs the never-off gate `merge_main` ([gates.md](gates.md)): `git checkout <m>*`, `git switch <m>*`, `git checkout <i>*`, `git switch <i>*`, `git push * <m>*`, `git push *:<m>*`, `git push * <i>*`, `git push *:<i>*`;
  - merging the delivery's PR on GitHub, which is the same move (`Bash(gh pr merge*)`);
  - `baco waive-review`, and every `baco import-verdict` (a file, standard input, a here-document, `/dev/stdin`), because the engine has no human check of its own: only the human waives the external review or brings a person's verdict (`Bash(node *baco.mjs waive-review*)`, `Bash(node *baco.mjs import-verdict*)`). Never narrow this ask to one form of the command. The agent reviewer's answer goes through `baco import-pr-verdict`, allowed above: its harness wrote the file, you never write or edit it, and the engine takes only the latest round's answer;
  - a call to another harness that is not read-only or not sandboxed: OpenCode (`Bash(opencode run*)`: its `plan` agent cannot edit files, but its shell is not sandboxed), and a Codex call that widens what Codex may write (`Bash(codex exec *workspace-write*)`, `Bash(codex exec *--add-dir*)`, `Bash(codex exec *--profile*)`, `Bash(codex exec * -p *)`, `Bash(codex exec *--worktree*)`, and, only when its `sandbox` is `livre`, `Bash(codex exec *danger-full-access*)`), so that an extra flag after `-s read-only` never runs unseen. A harness marked `implementers: on` therefore stops for its write calls unless the person approves an allow for exactly that call; say so.
- Never (deny): `sudo`; `git push --force*` and `git push -f*`; `git reset --hard*`; a Codex call outside its configured sandbox or without BACO's rules (`Bash(codex exec *--dangerously-bypass-approvals-and-sandbox*)`, `Bash(codex exec *--approve-for-me*)`, whose reviewer can approve leaving the sandbox, `Bash(codex exec *--dangerously-bypass-hook-trust*)`, `Bash(codex exec *--ignore-rules*)`, `Bash(codex exec *--ignore-user-config*)`, and the `-c`/`--config` overrides `Bash(codex exec *sandbox_mode*)`, `Bash(codex exec *sandbox_permissions*)`, `Bash(codex exec *writable_roots*)`, `Bash(codex exec *default_permissions*)`; with `sandbox: protegida`, also `Bash(codex exec *network_access*)`; with `protegida` or `rede`, also `Bash(codex exec *danger-full-access*)`); deleting the `develop` or `main` branches (local or remote; again the configured names); `rm -rf`; writing outside the project folder, except one place: the review copy folder that `baco build-handoff --mode repositorio` creates next to the project (`<projeto>-revisao-ENT-NNN-rNN`). In Claude Code a deny cannot be overridden by an allow, so write the outside-the-project rule without catching that path. A command that looks destructive goes through a project script that has its own check, never loose in a command.

In Claude Code the order is deny, then ask, then allow: the first that matches wins, so an `ask` rule is not swallowed by a broader `allow`, and a `deny` beats both. Write them to `.claude/settings.local.json` (not versioned; add it to `.gitignore` if it is not already there), under `permissions.allow`, `permissions.ask` and `permissions.deny`. Keep what the file already has. Check that no allow pattern matches an ask pattern (for example `git push *`); if one does, narrow the allow. Show the user the rules in plain words before saving:

> Para o trabalho rodar sozinho sem arriscar nada, vou deixar estas regras no projeto. Pode rodar sem perguntar: os testes do projeto, os comandos do BACO, o git nas linhas de trabalho desta entrega, enviar a linha de trabalho da entrega e abrir o pedido de junção (PR) dela como rascunho, chamar as outras ferramentas de IA que têm um modo só leitura garantido, só para ler e revisar, e registrar a resposta do revisor de IA da última rodada. Sempre pergunta a você, mesmo se você pedir para não confirmar nada: ir para as linhas principais do código (onde fica o que já foi aprovado) ou enviar algo para elas, juntar o pedido de junção, dispensar a revisão externa, registrar qualquer veredito que não seja a resposta do revisor de IA (como a revisão de uma pessoa) e chamar uma ferramenta de IA que pode gravar ou não tem proteção de só leitura (como o OpenCode). Nunca roda: comandos de administrador (sudo), envio forçado, voltar o código à força, apagar as linhas principais, apagar pastas inteiras, rodar o Codex fora da caixa que você escolheu ou sem as regras do BACO e escrever fora do projeto, exceto a cópia para o revisor, ao lado do projeto. Posso salvar assim?

Save only after the user agrees. In another environment (Codex or another host), describe the equivalent in that tool's own mechanism, as in [ambientes.md](ambientes.md). If the tool cannot enforce a block, say so plainly and keep the rule as an instruction only:

> Neste ambiente não consigo impedir esses comandos por regra, só pedir para não rodarem. Se quiser a garantia de verdade, é preciso configurar o bloqueio na própria ferramenta.

Never claim a block is in force until you have read the saved file back.

**Claude Code's sandbox.** When `harnesses.claude-code.sandbox` is `rede`, write the `sandbox` block of [ambientes.md](ambientes.md), section 2, into the same `.claude/settings.local.json`: `enabled: true`, `allowUnsandboxedCommands: false`, `excludedCommands` with `codex exec *` when Codex is in `harnesses` and the command that keeps the app running (question 9), `filesystem.allowWrite` with the package manager's cache, and `network.allowedDomains` with the approved list. Keep what the file already has. Add to the summary for the person, before saving:

> Também vou ligar a minha caixa neste projeto: gravo só na pasta dele e acesso só [lista]. O [Codex / comando do app] roda fora da minha caixa, [o Codex com a caixa e as regras dele / para você conseguir abrir o sistema no navegador].

After saving, run the check of that section (a refused connection to a host outside the list) and say the result in one line. If the sandbox does not come on, say why (for example `bubblewrap` or `socat` missing on Linux) and ask whether to go on as `livre`.

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

Then close with:

> Pronto: a configuração está salva em `.baco/config.yaml` e conferida. Resumo: [idioma, tarefas em arquivos/GitHub, branch principal e de integração, quantas tarefas em paralelo, paradas ligadas, comandos de teste completos e rápidos e se foram conferidos, comando de subir o sistema, tamanho da conversa para continuar numa nova e se a troca na construção pode ser sem perguntar, ferramentas de IA e o modelo de cada nível, quem revisa o PR e se as correções são automáticas, regras de execução salvas ou não]. Você pode pedir para mudar qualquer item quando quiser.
