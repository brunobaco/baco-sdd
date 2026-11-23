# Phase 0: Configuration questions 8 to 12B

Questions 8 to 12B of the configuration interview: conversation size, AI tools and review. Load this file when you run the interview, after [configure.md](configure.md), whose "How to ask" rules (numbering, format, plain words, "não entendi") apply to every block here. Questions 1 to 7B are in [configure-questions.md](configure-questions.md); 13 and 14 in [ambientes.md](ambientes.md), section 9.

**8. Conversation size** (`context.handoff_at`, default 290000; `context.auto_handoff`, default `off`)

Before showing the default, in Claude Code read the `autoCompactWindow` setting (`.claude/settings.local.json` of the project, then `.claude/settings.json`, then `~/.claude/settings.json`; the first that has it wins; a missing or unreadable file is skipped). Claude Code summarizes the conversation by itself at about that window minus 33000 tokens (measured: 18 automatic summaries between 366000 and 375000 with a window of 400000), before a larger `handoff_at` would ever fire. The warning is read only after the step that crossed the line, and a step adds 10000 to 20000 tokens, so the plugin hook warns 30000 tokens before that point: the value that really counts (the effective limit) is the smaller of `handoff_at` and `autoCompactWindow` minus 33000 minus 30000 (with a window of 400000: 337000). The hook names both numbers in its warning.

When the setting exists, propose the smaller of the default 290000 and that effective limit as the value and write it as `handoff_at`: a `handoff_at` above the effective limit is never reached and misleads whoever reads the configuration. When the person's answer is above the effective limit, explain in pt-BR that the Claude Code would summarize the conversation before that and the warning will come at the effective limit anyway, and write the effective limit (or a smaller value they choose).

Suggest a window of 400000 (follow-up after the question, below) when `autoCompactWindow` is missing or smaller: the default 290000 is made for that window, leaving room to finish the step and save the state before the summary. The setting belongs to the person's Claude Code, outside the project: write it only with their ok, into `~/.claude/settings.json` (keeping what the file has), and say that it applies from the next conversation.

The context does not start at zero: the host's instructions, tools and skills already take some room before the first question (in some environments close to 130000 tokens). The room for work is the limit minus that starting size, so with a limit near 300000 the first switch may come before the plan is written. Say this in one sentence when the person picks a small value.

Show the default first, then ask the two questions one at a time:

> Pergunta [N] de [total] · Tamanho da conversa
>
> O que é: a IA mede o texto em tokens, pedaços pequenos de texto, mais ou menos do tamanho de uma sílaba. O contexto é tudo o que esta conversa já tem: as suas mensagens, as minhas e os arquivos que eu li.
>
> Por que importa: conversa muito longa fica mais cara a cada passo e lembra pior dos detalhes. Como tudo fica salvo nos arquivos, continuar numa conversa nova custa pouco.
>
> Opções:
> (a) o padrão: a partir de 290 mil tokens de contexto, sugiro continuar numa conversa nova.
> (b) outro valor (diga qual): um valor menor troca mais cedo e mais vezes; um maior deixa a conversa crescer mais, mais cara e com mais chance de esquecer detalhes.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (a), porque o projeto é pequeno e cada entrega cabe numa conversa].
>
> Padrão: (a) 290 mil tokens.

When `autoCompactWindow` exists, use this wording instead, filling the brackets (for example, with a window of 400000: the automatic summary at about 367 mil, and the warning at 290 mil, the default, which is smaller than the effective limit of 337 mil):

> Pergunta [N] de [total] · Tamanho da conversa
>
> O que é: a IA mede o texto em tokens, pedaços pequenos de texto, mais ou menos do tamanho de uma sílaba. O contexto é tudo o que esta conversa já tem: as suas mensagens, as minhas e os arquivos que eu li.
>
> Por que importa: conversa muito longa fica mais cara a cada passo e lembra pior dos detalhes. Como tudo fica salvo nos arquivos, continuar numa conversa nova custa pouco. O seu Claude Code resume a conversa sozinho perto de [janela de resumo automático menos 33 mil] tokens. Lembre que a conversa já começa com uma parte ocupada pelas instruções e ferramentas, então a primeira troca pode vir cedo.
>
> Opções:
> (a) avisar em [limite efetivo] tokens: dá tempo de terminar o passo e trocar de conversa antes do resumo automático.
> (b) um valor menor (diga qual): a troca vem mais cedo e mais vezes.
>
> Minha recomendação: (a) [limite efetivo] tokens, porque é o maior valor em que a troca ainda vem antes do resumo automático.
>
> Padrão: (a) [limite efetivo] tokens.

Then the second question:

> Pergunta [N] de [total] · Troca de conversa sem perguntar
>
> O que é: durante a construção, quando a conversa passar desse tamanho, você decide se posso trocar para uma conversa nova sem te perguntar. Nesse caso, eu termino a tarefa em andamento, salvo onde parei e continuo na conversa nova.
>
> Por que importa: trocando sem perguntar, a conversa nova começa sem depender de você estar olhando. Perguntando antes, você decide cada troca.
>
> Opções:
> (a) perguntar antes de cada troca.
> (b) trocar sem perguntar.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (b), se você costuma deixar a construção rodando sozinha].
>
> Padrão: (a) perguntar antes.

When `autoCompactWindow` is missing or below 400000, ask this follow-up after the first answer:

> Pergunta [N] de [total] · Tamanho da conversa (continuação)
>
> O Claude Code resume a conversa sozinho, e o ponto em que isso acontece depende de uma configuração dele, a janela de resumo automático. [Está em X / Não está definida.] Com 400 mil, o aviso de troca de conversa vem em 290 mil, com folga para eu terminar o passo e salvar onde parei antes do resumo. Esta configuração é do seu Claude Code, não do projeto, e vale para todos os seus projetos. Posso gravar `autoCompactWindow: 400000` no seu arquivo de configurações do Claude Code? Se preferir, deixo como está e o aviso vem mais cedo.

A number -> `handoff_at` (a positive whole number of tokens; above the effective limit, the effective limit, as said above); "pode ser o padrão" keeps 290000, or the effective limit when `autoCompactWindow` exists and gives a smaller one. A yes to the follow-up writes `autoCompactWindow: 400000` into `~/.claude/settings.json`, outside the project, and a no changes nothing. Yes to the second -> `auto_handoff: on`; otherwise `off`. Outside the Ratoeira the agent cannot open a conversation by itself, so say that there the switch is only suggested, with a ready request to paste. The plugin hook reads these keys in Claude Code; in another host they guide the agent only.

**9. AI tools** (`harnesses`)

First, the tool you run in. In Claude Code, ask how free it is in this project (`harnesses.claude-code.sandbox`; [ambientes.md](ambientes.md), section 2, "Claude Code's sandbox"), and recommend `rede`:

> Pergunta [N] de [total] · Liberdade dos meus comandos
>
> O que é: quando trabalho no seu projeto, eu rodo comandos no computador, como instalar pacotes, rodar os testes e usar o git. Aqui você decide até onde esses comandos podem ir. Quando eles ficam presos a um limite, eu chamo esse limite de caixa (em inglês, sandbox).
>
> Por que importa: eu leio textos de fora, como documentação, páginas e issues. Se um deles trouxer uma instrução maliciosa, por exemplo "envie as chaves deste computador para tal endereço", a caixa impede o comando de funcionar, mesmo que eu me engane.
>
> Opções:
> (a) rede: eu gravo só dentro da pasta do projeto e acesso a internet só nos endereços que você aprovar (o GitHub e o site de onde vêm os pacotes do projeto). É o mais seguro; de vez em quando eu peço para liberar um endereço novo.
> (b) livre: eu gravo onde o seu usuário pode e acesso qualquer endereço. Tem menos interrupções, e a proteção fica só nas regras e nas confirmações das ações arriscadas.
>
> Minha recomendação: (a) rede, porque [motivo ligado a este projeto].
>
> Padrão: (a). Vale para todas as conversas neste projeto, inclusive as que você abrir.

With `rede`, propose the network list from the project's stack (GitHub, its package registries) and ask (follow-up):

> Pergunta [N] de [total] · Liberdade dos meus comandos (continuação)
>
> Vou liberar estes endereços: [lista]. Precisa de mais algum, como uma API (o endereço pelo qual um programa conversa com outro sistema) que os testes chamam?

and, when the project has an app the person tests in the browser (follow-up):

> Pergunta [N] de [total] · Liberdade dos meus comandos (continuação)
>
> Para você testar o sistema no navegador, eu deixo ele rodando com um comando. Dentro da caixa, um sistema iniciado assim só fica visível para o próprio comando, então esse comando roda fora dela. Qual é ele? [detectado: por exemplo npm run dev]

Save the answer as `sandbox` under `harnesses.claude-code`, and keep the list and the command for the settings ([configure.md](configure.md), step 7 of "Write the file" and "Execution rules"). Then detect what else this machine has (for example `claude`, `codex`, `opencode`, `agy` or `antigravity` on the PATH), then ask:

> Pergunta [N] de [total] · Outras ferramentas de IA
>
> O que é: uma ferramenta de IA é o programa em que uma IA trabalha no seu computador, como eu aqui no [ferramenta em uso]. Outros exemplos são Codex, OpenCode e Antigravity. Detectei nesta máquina: [lista].
>
> Por que importa: com mais de uma, uma pode revisar o trabalho da outra, o que deixa a revisão mais independente: uma IA diferente enxerga erros que a primeira deixou passar.
>
> Opções:
> [uma linha por ferramenta detectada: "[ferramenta]: passa a revisar e procurar informação neste projeto"]
> nenhuma: só eu trabalho neste projeto.
> Pode escolher mais de uma.
>
> Minha recomendação: [as ferramentas e o motivo ligado a este projeto].
>
> Padrão: nenhuma além de mim.

For each tool the user wants, list its models from the tool itself and recommend the level of each ([ambientes.md](ambientes.md), section 5, "Adding one"), in plain words (follow-up):

> Pergunta [N] de [total] · Outras ferramentas de IA (continuação)
>
> Cada ferramenta tem vários modelos, que são as versões da IA: umas mais capazes e caras, outras mais rápidas e baratas. Eu organizo os modelos em três níveis: forte, médio e leve. No [ferramenta], recomendo: forte = [modelo], para revisar e decidir o que é difícil; médio = [modelo], para o trabalho comum; leve = [modelo], para tarefas simples e buscas. Pode ser assim?

Save the models as families, not exact names, when the tool has them: Codex `{ forte: sol, medio: terra, leve: luna }` style, Antigravity `{ forte: neon, medio: neon, leve: neon }` style, Claude Code its aliases (`opus`, `sonnet`, `haiku`). A family is a name that appears in the model names (`sol`, `neon`); the plan resolves it to the newest exact model in the tool's list, so a newer version needs no change here ([ambientes.md](ambientes.md), section 5, "Model families"). Show the person the exact model each family resolves to today, and write an exact name only when they ask to pin one. Say it in the follow-up above: "recomendo a família X; o plano usa sempre a versão mais nova dela".

Save each approved tool under `harnesses.<name>` with its `models`; a tool with models of more than one maker gets one entry per family, when the person wants ([ambientes.md](ambientes.md), section 9). The tool you run in gets `implementers: on`. Every other tool gets `implementers: off` and only reviews and searches, never changes code, until it has been tested end to end with BACO; set `on` only when the user asks for it after such a test and its write check (below) passed, and say what it changes:

> Por enquanto, as outras ferramentas só revisam e procuram informação; quem constrói (escreve o código das tarefas) é a ferramenta em que eu estou. Quando você tiver testado uma delas de ponta a ponta, posso liberar para ela construir também.

When a tool other than yours gets `implementers: on` (now or later), ask how free it is when it builds (`harnesses.<name>.sandbox`; [ambientes.md](ambientes.md), section 5, "Sandbox"), and recommend `rede`:

> Pergunta [N] de [total] · Liberdade do [ferramenta] ao construir
>
> O que é: quando o [ferramenta] construir, ele também roda comandos no computador. Aqui você decide até onde esses comandos podem ir, como na pergunta sobre a minha caixa.
>
> Por que importa: nas três opções, as regras do BACO recusam os comandos proibidos (administrador, enviar ao GitHub, fazer commit, que é gravar uma versão no histórico do código, e apagar pastas inteiras), mas elas são um filtro, não uma barreira. Com internet, um texto malicioso lido de fora (um pacote, uma página) teria caminho para mandar suas chaves para fora, o mesmo risco que eu já corro.
>
> Opções:
> (a) protegida: grava só na pasta da tarefa e não tem internet, então eu instalo as dependências (os pacotes de que o projeto precisa) e rodo os testes de tela por ele, o que gasta mais do meu lado.
> (b) rede: grava só na pasta da tarefa, mas tem internet e pode abrir o app para testar, então faz o trabalho inteiro sozinho.
> (c) livre: sem caixa nenhuma, lê e grava onde você pode.
>
> Minha recomendação: (b) rede, porque dá a ele o que a tarefa precisa e mantém a gravação presa na pasta.
>
> Padrão: (b) rede.

Save the answer as `sandbox` (`protegida`, `rede` or `livre`). A tool with no command-rules mechanism of its own takes only `protegida`; say so. For Codex, whenever it is listed in `harnesses`, copy [templates/codex/baco.rules](../templates/codex/baco.rules) to `.codex/rules/baco.rules` in the project; it is committed with the setup ([configure.md](configure.md), step 7 of "Write the file"), so every task folder carries it. For Antigravity, whenever it is listed in `harnesses`, copy [templates/antigravity/leitura.json](../templates/antigravity/leitura.json) to `.baco/antigravity/leitura.json`, committed the same way: it is the read-only mode of its calls ([ambientes.md](ambientes.md), section 5). Antigravity has its own three values, made of BACO's hook and command rules because its terminal sandbox does not start on every machine ([ambientes.md](ambientes.md), section 5, "Sandbox"). When the person turns its `implementers` on, ask this instead of the generic question above, recommending `rede` and defaulting to `protegida` (also for a profile of it, such as `antigravity-claude`):

> Pergunta [N] de [total] · Liberdade do Antigravity ao construir
>
> O que é: quando o Antigravity construir, ele roda comandos no computador. O Antigravity não tem uma caixa de verdade aqui: o BACO usa uma trava que só vale para as ferramentas dele de gravar arquivos (elas só gravam na pasta da tarefa) e uma lista de comandos permitidos.
>
> Por que importa: o BACO recusa publicar pacotes e baixar pacotes novos pelo `npx`, mas o `node` ainda pode rodar qualquer programa com o seu usuário, e a trava não alcança o que um programa assim faz. Então as opções com mais liberdade têm um risco real: um teste ou pacote mal feito, ou um texto malicioso lido de fora, poderia ler arquivos seus ou mandar algo para a internet. Eu confiro tudo o que ele mudou e rodo os testes de novo antes de cada versão gravada no histórico.
>
> Opções:
> (a) protegida: grava só na pasta da tarefa e só roda testes e comandos de leitura. Eu instalo as dependências e rodo os testes de tela por ele, o que gasta mais do meu lado. É a mais segura.
> (b) rede: a mesma trava de gravação, mais `npm`, `npx` e `node` liberados. Ele instala e roda os testes de tela sozinho, e o trabalho sai mais rápido; em troca, o risco acima. É mais fraca do que a rede do Codex, que tem uma caixa de verdade.
> (c) livre: sem a trava de gravação, só a lista fechada de comandos. Grava onde o seu usuário pode. Só para quem aceita isso.
>
> Minha recomendação: (b) rede, [motivo ligado a este projeto, por exemplo: porque as telas têm testes no navegador que ele precisa rodar].
>
> Padrão: (a) protegida.

Save the answer as `sandbox` (`protegida`, `rede` or `livre`). The check of each value is in [ambientes.md](ambientes.md), section 5.

Then check each tool other than yours on this machine, before any plan relies on it ([ambientes.md](ambientes.md), section 5, "Check before relying on it"): the read call always, the write call only for a tool marked `implementers: on`, in its configured `sandbox`, which also tries a network fetch, binding a local port and a forbidden command, and records `rede`, `porta` and `regra` in `.baco/logs/harnesses.md` (a missing capability is reported, never fixed by widening the sandbox beyond its value) (also when the user turns it on later; `on` takes effect only after that check passed). Say the result in one line per tool. A tool that fails stays in the config, but no plan gives it work until a new check passes; tell the person with the message of that section and never widen its sandbox beyond the configured value.

**Suggested split when Codex is available.** When Codex is installed and its read check passed, suggest (never impose) this split, with the one-line reason, and let the person accept it or change any part. When only your own harness is available, skip this and keep the usual setup (implementers by risk class, every role on your harness):

> Pergunta [N] de [total] · Divisão do trabalho com o Codex
>
> O que é: como o Codex está funcionando aqui, sugiro dividir o trabalho entre ele e o Claude, que sou eu. Construir é escrever o código das tarefas; conduzir é organizar a entrega e chamar cada etapa; revisar é conferir o trabalho feito. O esforço é quanto a IA pensa antes de agir: mais esforço, mais cuidado e mais gasto.
>
> Por que importa: nas duas divisões, quem revisa o PR é uma ferramenta diferente da que construiu, o que dá um olhar mais independente. O que muda é quem constrói e quanto do limite de cada plano você gasta.
>
> Opções:
> (a) O Codex constrói, com o modelo mais capaz e esforço muito alto, na caixa com rede, e eu conduzo e faço as revisões no Claude. Em teste ponta a ponta foi a construção mais rápida e quase sem correção, e o Codex instalou e testou sozinho; em troca, gasta uma boa parte do limite do Codex.
> (b) Eu conduzo, quem constrói e quem revisa cada tarefa fica no Claude, e a revisão do pedido de junção (PR) fica no Codex, com o modelo mais capaz, esforço alto e só leitura: custou cerca de 1% do uso e achou defeitos que as revisões do Claude não acharam.
> Nas duas, o localizador (o ajudante que só procura informação nos arquivos) usa o modelo mais leve do Claude. Você também pode mudar qualquer parte.
>
> Minha recomendação: a (a) se o seu plano do Codex tiver folga, e a (b) se não tiver. [No seu caso: a opção e o motivo, se você me disse como está o seu plano do Codex.]
>
> Padrão: nenhuma divisão fixa. Sem escolha, o Codex só revisa e procura informação, e o plano de cada entrega mostra quem faz cada papel para você aprovar.

With (a), set `implementers: on` and `sandbox: rede` for Codex (its write check must pass with `rede: sim`, `porta: sim` and `regra: sim`) and keep every review role on Claude. With (b), record the PR reviewer on `codex` (its model and effort in the agents table of the plan) and leave `implementers: off` for Codex. The plan shows the split for approval like any other.

When the user later says they added a subscription, come back to this question for that tool only.

For a back-end and front-end split, the example of `roles` with three reviewer entries (`task_reviewer: [codex, antigravity, claude-code]`) is in [ambientes.md](ambientes.md), section 9, under question 14.

**10. Review of the delivery's PR** (`review.pr.reviewer`, default `agente`; `review.pr.auto_fix`, default `on`)

Ask the two questions one at a time:

> Pergunta [N] de [total] · Quem revisa o pedido de junção
>
> O que é: no fim de cada entrega, o pedido de junção (PR) passa por uma revisão de fora, além das revisões internas feitas durante a construção. Aqui você escolhe quem faz essa revisão de fora.
>
> Por que importa: é o último olhar sobre a entrega inteira antes de ela ficar pronta para você testar e juntar.
>
> Opções:
> (a) outra IA, de preferência uma ferramenta diferente da que construiu: a revisão acontece na hora, sem você precisar fazer nada.
> (b) uma pessoa do time: traz o olhar de quem conhece o negócio, e a entrega espera essa pessoa revisar.
> (c) as duas, primeiro a IA e depois a pessoa: a pessoa recebe a entrega já com os problemas óbvios corrigidos, e é o caminho mais lento.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (a), porque você trabalha sozinho neste projeto].
>
> Padrão: (a) outra IA.

Then the second question:

> Pergunta [N] de [total] · Correções da revisão
>
> O que é: quando a revisão apontar problemas, posso corrigir sozinho, no mesmo pedido de junção, e pedir para o mesmo revisor conferir só as correções, até ele aprovar ou chegar ao limite de rodadas. Cada conferência do revisor é uma rodada.
>
> Por que importa: decide se a entrega anda sozinha depois da revisão ou se espera você a cada rodada.
>
> Opções:
> (a) sim: eu corrijo sozinho, e a entrega anda sem esperar você.
> (b) não: cada rodada de problemas espera você ler e decidir o que corrigir.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: (a) sim.

(a) -> `agente`; (b) -> `pessoa`; (c) -> `ambos`. Yes to the second -> `auto_fix: on`; no -> `off` (then each round of findings waits for the person before fixing). Then say once, as a statement, what the PR review changes in the run:

> Para essa revisão, durante a construção eu envio a linha de trabalho da entrega para o GitHub e abro o pedido de junção (PR) como rascunho, sem perguntar. Um rascunho não pede para juntar nada. A parada "pedido de junção" passa a valer para o momento de marcar esse rascunho como pronto para juntar, e juntar a entrega na linha principal continua esperando você, sempre.

**11. AI level per task type** (`models.mechanical`, `models.standard`, `models.risky`; each a `level` `forte`, `medio` or `leve` and an `effort` `alto`, `medio` or `baixo`)

> Pergunta [N] de [total] · Nível da IA por tipo de tarefa
>
> O que é: na construção, cada tarefa recebe um tipo conforme o risco, e cada tipo usa um nível de IA e um esforço. O nível vai do modelo mais capaz (forte) ao mais simples (leve); o esforço é quanto a IA pensa antes de agir. Neste ambiente, os níveis são: [forte = modelo, médio = modelo, leve = modelo, de `harnesses` da ferramenta em que você está].
>
> Por que importa: subir o nível ou o esforço deixa a tarefa mais cuidadosa, mais cara e mais lenta; descer faz o contrário e aumenta a chance de a revisão pedir correção. O plano de cada entrega mostra o modelo de cada tarefa para você aprovar.
>
> Opções (o padrão de cada tipo; você pode mudar qualquer um):
> tarefa mecânica (troca simples, sem decisão): o modelo mais leve e esforço baixo, o mais rápido e barato.
> tarefa padrão (o trabalho comum): o intermediário e esforço médio.
> tarefa arriscada (dados, login, dinheiro ou algo difícil de desfazer): o mais capaz e esforço médio.
>
> Minha recomendação: [manter ou mudar, e o motivo ligado a este projeto, por exemplo: manter, porque o projeto tem poucas tarefas arriscadas].
>
> Padrão: os três como acima.

Talk in levels and efforts, never ask the person to pick a model name; name the real models only to make the levels concrete ([ambientes.md](ambientes.md)). Write only the classes the person changed; keep the others as in the template.

**12. External review rounds** (`review.external_rounds_max`, default 3)

> Pergunta [N] de [total] · Rodadas da revisão de fora
>
> O que é: quando a revisão de fora acha problemas e eles são corrigidos, o revisor confere de novo; cada conferência é uma rodada. Aqui você decide quantas rodadas posso fazer antes de parar e pedir a sua decisão.
>
> Por que importa: às vezes a revisão e a correção não convergem, e cada nova volta gasta mais sem resolver.
>
> Opções (diga o número):
> mais rodadas: deixam a entrega se resolver sozinha por mais tempo, gastando mais a cada volta.
> menos rodadas: te chamam mais cedo, quando a revisão e a correção não convergem.
>
> Minha recomendação: [o número e o motivo ligado a este projeto].
>
> Padrão: 3.

A positive whole number -> `review.external_rounds_max`. Every verdict counts as a round, from an agent or a person ([review.md](review.md), section 4).

**12B. Reviews of a task** (`review.task_rounds`, the maximum of reviews counting the first, default `{ mechanical: 2, standard: 3, risky: 4 }`, three positive whole numbers; then `review.last_round_importante`, default `seguir`, (a) -> `seguir`, (b) -> `parar`; ask the two one at a time; not asked at startup of a project already configured, which keeps the defaults; the 1.4.0 name `round5_importante` is still read)

> Pergunta [N] de [total] · Revisões de cada tarefa
>
> O que é: cada tarefa pronta passa por uma revisão. Se ela acha problema que quebra o que a tarefa promete, a IA corrige e o revisor confere só a correção; problema fora do que a tarefa promete vira pendência (fica anotado para depois), sem correção. Aqui você decide quantas revisões cada tipo de tarefa pode ter, contando a primeira.
>
> Por que importa: mais revisões resolvem mais sozinho e gastam mais; menos revisões te chamam mais cedo. Só a correção antes da última revisão usa um nível de IA acima, mais caro.
>
> Opções: um número máximo para cada tipo de tarefa (mecânica, padrão e arriscada). Esse é o valor que o plano de cada entrega sugere, e você pode mudar ali para aquela entrega.
>
> Minha recomendação: [manter ou mudar, e o motivo ligado a este projeto].
>
> Padrão: até 2 revisões na tarefa mecânica, 3 na padrão e 4 na arriscada, contando a primeira.

Then the second question:

> Pergunta [N] de [total] · O que sobra na última revisão
>
> O que é: se na última revisão de uma tarefa ainda sobrar só achado "importante" (um caso raro, como dois cliques no mesmo milissegundo, ou um erro de efeito pequeno), eu preciso saber se sigo ou paro.
>
> Por que importa: parar segura a construção; seguir deixa os achados para você decidir depois, todos juntos. Achado "crítico" (dado errado gravado, dado restrito à mostra ou permissão indevida no uso normal) sempre para a tarefa; esta pergunta vale só para o "importante".
>
> Opções:
> (a) juntar a tarefa, anotar cada achado como pendência e seguir a construção; antes da revisão final eu te mostro todas numa lista só, com a minha recomendação para cada uma.
> (b) parar a tarefa e esperar você decidir na hora, o que segura também as tarefas que dependem dela.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: (a).
