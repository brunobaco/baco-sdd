# Phase 0: Configuration questions 1 to 7B

Questions 1 to 7B of the configuration interview: language and documents, tasks, branches, pace and stops, tests. Load this file when you run the interview, after [configure.md](configure.md), whose "How to ask" rules (numbering, format, plain words, "não entendi") apply to every block here. Questions 8 to 12B are in [configure-questions-tools.md](configure-questions-tools.md); 13 and 14 in [ambientes.md](ambientes.md), section 9.

**1. Language** (`language`; accepted `pt-BR` or `en`)

> Pergunta [N] de [total] · Idioma
>
> O que é: o idioma dos documentos que eu escrevo e das mensagens do método. Entre os documentos estão as specs (especificações: o texto que diz o que o sistema deve fazer), o plano de cada entrega e os relatórios.
>
> Por que importa: quem vai ler esses documentos precisa ler o idioma deles. Os modelos de documento (os arquivos-base que eu preencho) só existem em português.
>
> Opções:
> (a) português do Brasil: os modelos de documento e as mensagens do método já vêm nele.
> (b) inglês: as mensagens do método passam a sair em inglês, mas os modelos de documento só existem em português, então os documentos novos começam com títulos em português.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (a), porque o projeto e o time escrevem em português].
>
> Padrão: (a) português do Brasil.

`en` makes the engine's messages English. The document templates shipped with the skill are pt-BR only.

**1B. Documents folder** (`docs_root`; only when the project's documents already live outside `docs/`)

Ask only when you detected a documents folder other than `docs/` (for example `documentacao/` or `doc/`); otherwise keep the default and do not ask.

> Pergunta [N] de [total] · Pasta dos documentos
>
> O que é: a pasta onde ficam os documentos do método: specs, plano e o registro de cada entrega (uma entrega é um conjunto de funcionalidades que fica pronto e entra no sistema de uma vez). Os documentos deste projeto ficam em [pasta detectada], e o método usa `docs/` por padrão.
>
> Por que importa: com tudo numa pasta só, quem procura um documento acha num lugar; com pastas separadas, o que é do método não se mistura com o que vocês já têm.
>
> Opções:
> (a) uso [pasta detectada]: specs, plano e entregas ficam junto do que já existe.
> (b) uso `docs/`: os documentos do método ficam separados dos que vocês já têm.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: (b) `docs/`.

(a) -> `docs_root: <folder>`; (b) -> no key.

**2. Tracker** (`tracker`: a list of `files`, `github`)

> Pergunta [N] de [total] · Onde registrar as tarefas
>
> O que é: cada entrega (um conjunto de funcionalidades que fica pronto e entra no sistema de uma vez) é dividida em tarefas pequenas. Aqui você escolhe onde essas tarefas ficam registradas.
>
> Por que importa: é ali que você e o time acompanham o que está sendo feito, o que já terminou e o que falta. Nas duas opções, os arquivos continuam valendo como registro oficial.
>
> Opções:
> (a) só em arquivos dentro do projeto, na pasta de documentos: ficam versionadas junto com o código (o histórico guarda cada mudança) e não dependem de nenhum serviço de fora.
> (b) em arquivos e também no GitHub, como itens de acompanhamento (issues): o time acompanha e comenta pelo GitHub, cada tarefa ganha um link, e precisa do login do GitHub nesta máquina com permissão de criar issues.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (b), porque o time já acompanha o trabalho pelo GitHub; ou (a), porque só você acompanha].
>
> Padrão: (a) só arquivos.

(a) -> `[files]`; (b) -> `[files, github]`. Do not test the permission to create issues here; phase 5 checks it when it publishes.

**2B. Project board** (`github.project`: `owner`, `number`, optional `field` and `status`; only when the answer to 2 included GitHub)

A GitHub Project board can mirror the delivery: each issue moves through the columns of its `Status` field as the task is published, built, reviewed and merged. The files stay the source of truth; the board only receives updates and is never read to decide anything ([task-publication.md](task-publication.md), "Project board").

1. Find the owner: the user or organization of the git remote (`git remote get-url origin`). Without a GitHub remote, skip this question and say the board can be set later.
2. Check the login: `gh auth status`. Its `Token scopes` line must list `project` (reading and writing boards). When `gh` is missing or not logged in, skip the question and say the board can be set later with `/baco:configurar`. When the scope is missing, do not try another way: tell the user, and ask the question again after they say it is done:

> Para eu mover os cartões no quadro do GitHub (uma página com colunas, em que cada tarefa é um cartão), o login do GitHub nesta máquina precisa da permissão de quadros (project), que ele ainda não tem.
>
> Rode no terminal `gh auth refresh -s project` e me avise quando terminar. Se preferir, sigo sem o quadro e você liga depois.

3. List the boards: `gh project list --owner <owner> --format json` (title and number of each). Then ask:

> Pergunta [N] de [total] · Quadro do GitHub
>
> O que é: um quadro do GitHub (GitHub Projects) é uma página com colunas, como "a fazer", "em andamento" e "feito", em que cada tarefa aparece como um cartão. Encontrei estes quadros de [owner]: [lista: número e título].
>
> Por que importa: com o quadro em dia, quem acompanha pelo GitHub vê em que pé cada tarefa está sem abrir os arquivos. O registro oficial continua nos arquivos; o quadro só recebe as atualizações.
>
> Opções:
> (a) um dos quadros acima (diga qual): eu mantenho esse quadro em dia com as tarefas, movendo cada cartão conforme o trabalho anda (publicada, em construção, em revisão, juntada).
> (b) nenhum: as tarefas ficam nos arquivos e nos itens do GitHub, sem quadro.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: (b) nenhum.

With no board found, say so and ask whether to go on without one (the user creates it on GitHub and runs the configuration again).

4. With a board chosen, read its fields: `gh project field-list <number> --owner <owner> --format json`. Find the single-select field named `Status` and its options. When its options include `Backlog`, `In progress`, `In review` and `Done`, write only `owner` and `number`: the defaults match. Otherwise ask which option fits each moment, offering the closest names you found (follow-up):

> Pergunta [N] de [total] · Quadro do GitHub (continuação)
>
> O campo de etapa desse quadro (o que diz em que coluna cada cartão está) tem estas opções: [lista]. Qual delas uso para cada momento: tarefa publicada, construção começou, em revisão e juntada na entrega?

Write the answers under `status` (`published`, `started`, `review`, `merged`); a field with another name than `Status` goes in `field`. Invent no option: when a moment has none, the user creates it on GitHub, or picks the nearest. The parent issue of the delivery uses the same options: `started` when phase 6 begins and `merged` only when the delivery is merged into the integration branch.

```yaml
github:
  project:
    owner: <dono>
    number: <n>
    # field: Status
    # status: {published: Backlog, started: In progress, review: In review, merged: Done}
```

**3. Branch roles** (`branches.main`, `branches.integration`)

> Pergunta [N] de [total] · Linhas de trabalho do código
>
> O que é: uma branch, que eu chamo de linha de trabalho, é uma versão do código em que dá para mudar coisas sem mexer nas outras. Detectei estas no projeto: [lista]. O método usa duas com papéis fixos. A principal é a que vale: só entra nela o que você aprovou, sempre com a sua confirmação. A de integração é onde cada entrega se junta primeiro, depois das revisões.
>
> Por que importa: na de integração dá para testar várias entregas juntas antes de levar para a principal, então um problema aparece ali, e não no que já está valendo.
>
> Opções:
> principal: uma das linhas acima.
> integração: uma das linhas acima, ou o nome de uma linha nova.
>
> Minha recomendação: [as linhas e o motivo ligado a este projeto, por exemplo: main como principal, porque é nela que está o que já foi entregue].
>
> Padrão: principal main, integração develop.

If the project has no integration branch, keep `develop` as the name and say that nothing is created now; it is created from the main branch when the setup is written ([configure.md](configure.md), "Write the file", step 0).

**4. Protected branches** (`branches.protected`)

> Pergunta [N] de [total] · Linhas protegidas
>
> O que é: uma linha de trabalho protegida é uma que ninguém edita direto. Nela eu não mudo arquivo nenhum: toda mudança nasce numa linha da entrega e chega por junção (o passo que leva as mudanças de uma linha para outra), depois das revisões.
>
> Por que importa: proteger mais linhas evita mudança sem revisão; uma linha fora da lista pode ser editada direto. A principal e a de integração ficam protegidas sempre, mesmo fora da lista.
>
> Opções:
> (a) manter a lista padrão: main, master e develop.
> (b) mudar a lista: acrescentar ou tirar linhas (diga quais).
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (a), porque as linhas deste projeto são main e develop].
>
> Padrão: (a) main, master e develop.

**5. Parallelism** (`parallel`; 0 = one task at a time)

> Pergunta [N] de [total] · Tarefas ao mesmo tempo
>
> O que é: quantas tarefas da entrega podem estar em construção ao mesmo tempo.
>
> Por que importa: o número muda a velocidade, o gasto do limite de uso do seu plano de IA e a chance de duas tarefas atrapalharem uma à outra.
>
> Opções:
> (a) mais tarefas juntas: termina mais rápido, mas gasta mais do limite de uso de uma vez e dá mais conflitos quando duas tarefas mexem nos mesmos arquivos.
> (b) menos tarefas: é mais lento e mais previsível.
> (c) 0: uma de cada vez.
> Diga o número que quer.
>
> Minha recomendação: [o número e o motivo ligado a este projeto, por exemplo: 3, porque as partes do sistema são bem separadas].
>
> Padrão: 3.

**6. Gates to adjust** (`gates`)

Name each adjustable stop in plain words and ask which to change:

> Pergunta [N] de [total] · Paradas para a sua aprovação
>
> O que é: uma parada é um ponto em que o trabalho para e espera você aprovar antes de seguir. Por padrão, o trabalho para nestes pontos:
> (1) início do projeto, em que você confirma a visão e o escopo antes de qualquer spec;
> (2) arquitetura, em que você aprova as tecnologias e as decisões técnicas propostas;
> (3) plano da entrega, em que você aprova o que entra, as tarefas e quem faz cada uma;
> (4) lote de tarefas, em que você confere as tarefas publicadas antes de a construção começar;
> (5) pedido de junção (PR) pronto para juntar, em que você vê a entrega já revisada. O pedido de junção é o pedido para levar a entrega para a linha principal; no GitHub ele se chama pull request, ou PR.
> Entre essas paradas, as tarefas rodam sozinhas.
>
> Por que importa: desligar uma parada deixa o trabalho andar sem esperar você, mas aquele ponto passa sem o seu olhar. Três paradas nunca desligam: aprovação da spec, ação sem volta (apagar dados, publicar em produção) e junção na linha principal.
>
> Opções:
> (a) manter as paradas como estão.
> (b) desligar uma ou mais das cinco paradas acima (diga quais): o trabalho anda sem esperar você naquele ponto.
> (c) ligar também uma parada depois de cada tarefa: você acompanha tudo de perto, e a construção fica bem mais lenta, porque cada tarefa espera você.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto, por exemplo: (a), porque é a primeira entrega e vale você ver cada ponto].
>
> Padrão: (a), as cinco paradas ligadas e nenhuma parada depois de cada tarefa.

Map: início do projeto `project_start`; arquitetura `architecture`; plano `plan`; lote `task_batch`; depois de cada tarefa `each_task`; pedido de junção `before_pr`. Write `on` or `off`. If the user asks to turn off a never-off gate, refuse as in `gates.md` and leave it out of the file or `on`.

**6B. Pending manual scenarios** (`manual_pending`: `block` or `warn` per target branch; role keys `main` and `integration`, a literal branch name wins, `"*"` is the fallback)

> Pergunta [N] de [total] · Testes feitos à mão
>
> O que é: alguns cenários de teste só uma pessoa consegue executar, como conferir um e-mail que chegou ou testar no celular. Aqui você decide o que eu faço se um deles ainda não foi feito quando a entrega vai ser juntada. A decisão é pela linha onde a entrega termina, que é [a de integração, `nome`, ou a principal, `nome`, conforme `delivery.target`; antes da pergunta 23, a de integração, que é o padrão].
>
> Por que importa: um teste à mão que ficou para trás pode esconder um defeito que só aparece no celular ou no e-mail de verdade. Os cenários que só um especialista faz não entram aqui: eles nunca travam.
>
> Opções:
> (a) travar: a junção no destino espera até alguém executar e registrar o resultado. É mais seguro e pode segurar a entrega.
> (b) avisar: eu mostro o que falta e deixo juntar. É mais rápido e deixa o teste para depois.
>
> Minha recomendação: [a opção para o destino da entrega e o motivo ligado a este projeto; para a linha de integração que publica um ambiente de teste, (b) costuma servir, porque o teste à mão acontece nesse ambiente].
>
> Padrão: travar na linha principal e só avisar nas outras, inclusive na de integração.
>
> No destino da entrega ([nome da linha]), (a) travar ou (b) avisar?

Then the other line (follow-up), main when the destination is the integration branch, and the integration branch when the destination is main:

> Pergunta [N] de [total] · Testes feitos à mão (continuação)
>
> E na [linha principal / linha de integração] e nas demais: (a) travar ou (b) avisar? O padrão da principal é (a) travar, o das outras é (b) avisar.

Ask first about the delivery's destination, then about the other. The role keys are `main`, `integration` and `"*"`: write the answer for the destination under its role key (`integration` or `main`), the other under its own key, and `"*"` as `warn` unless the person says otherwise. Write `integration` only when it differs from `"*"`, or when it is the destination. A rule on the destination is what `baco merge-check` and the acceptance report apply to the merge ([gates.md](gates.md)). When question 23 later changes the destination, come back to this one for the new destination. Never edit this key later to make a merge pass.

**7. Test commands per layer** (`tests.<layer>`, for example `unit`, `e2e_web`; quick version in `tests_quick.<layer>`)

> Pergunta [N] de [total] · Comandos de teste
>
> O que é: testes são programas que conferem sozinhos se o sistema faz o que deve. Cada tipo de teste roda com um comando, por exemplo um para os testes das regras e funções, e outro para os testes do site no navegador.
>
> Por que importa: é com esses comandos que eu provo que cada tarefa funciona antes de dizer que terminou.
>
> Opções: encontrei no projeto [comandos detectados, um por linha, com o tipo de teste de cada um; ou: não encontrei nenhum]. Você pode confirmar, corrigir ou me dizer o comando de cada tipo de teste.
>
> Minha recomendação: [usar os comandos detectados, ou o que fazer se não houver testes, e o motivo ligado a este projeto].
>
> Padrão: se você não souber, eu procuro no projeto e confirmo com você.

Detect candidates from `package.json` scripts and CI files; show them and ask for confirmation. Skip layers the project does not have.

For a layer that runs in a browser, ask for two versions: the full one (every browser the product must work in; phase 1 records which) in `tests.<layer>`, and a quick one (Chromium only) in `tests_quick.<layer>`. The quick one is what runs during construction; without it the engine falls back to the full command.

Ask it as a follow-up:

> Pergunta [N] de [total] · Comandos de teste (continuação)
>
> Para os testes no navegador, preciso de duas versões do comando. A completa roda em todos os navegadores em que o sistema precisa funcionar. A rápida roda só no Chrome (Chromium, a base aberta do Chrome) e serve para o dia a dia da construção. Se ainda não tiver a rápida, eu proponho uma.

Layers that start with `e2e` are serialized machine-wide by the engine (`tests.queue` lists them; default is every layer starting with `e2e`). Change `tests.queue` only if the user's layers are named otherwise.

Every command of the project must run without asking anything: a command that waits for typing fails in `baco run-tests` (stdin is closed). If a command asks (a confirmation, a password), fix it with a flag or a variable before saving it.

Each command must write its own JUnit report, and machine-specific paths and variables go in `.baco/local.env`: follow [test-commands.md](test-commands.md) when you confirm the commands. Do not change `tests.patterns` unless the project's tests live outside the defaults (`*.test.*`, `*.spec.*`, `e2e/`, `.maestro/`).

**7B. Start the app** (`app.smoke`)

> Pergunta [N] de [total] · Comando que liga o sistema
>
> O que é: um comando que sobe o sistema do jeito que o usuário usa, confere que ele responde e termina.
>
> Por que importa: ele é a prova de que o sistema liga de verdade, não só de que os testes passam. Um sistema pode passar em todos os testes e mesmo assim não abrir, por exemplo por uma configuração faltando.
>
> Opções:
> (a) existe: me diga qual é [detectado: o comando, se encontrei um], e eu confiro rodando uma vez, com o seu ok.
> (b) não existe: deixo marcado para a fase de arquitetura (a etapa em que se decidem as tecnologias do sistema) criar.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: se não existir, a fase de arquitetura cria.

`app.smoke` is a command that starts the app as the user does, checks it answers, and exits 0, with no interactive prompt. If the project has no app yet, or no such command, write nothing under `app` and note in the summary that phase 3 creates it. Run it with `baco run-tests --smoke` to check it, with the user's consent.
