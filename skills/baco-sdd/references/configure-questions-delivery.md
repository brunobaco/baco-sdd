# Phase 0: Configuration questions 15 to 26

Questions 15 to 26 of the configuration interview: how the plan sizes and judges the work, what the reviews look for, which tests run where, where the delivery ends, which scenarios only a specialist runs and whether the system uses AI. Load this file when you run the interview, after [configure-questions-tools.md](configure-questions-tools.md) and the questions 13 and 14 of [ambientes.md](ambientes.md), section 9; the "How to ask" rules of [configure.md](configure.md) (numbering, format, plain words, "não entendi") apply to every block here. All these keys are optional: "pode ser o padrão" keeps the default of each.

**15. Risk of a task** (`planning.risk.arriscada`, `planning.risk.mecanica`; free text with examples; default: the generic criterion of [planning.md](planning.md))

> Pergunta [N] de [total] · O que é uma tarefa arriscada
>
> O que é: cada tarefa recebe um tipo conforme o risco: arriscada (dados, login, dinheiro ou algo difícil de desfazer), mecânica (troca simples, sem decisão) ou padrão (todo o resto). O tipo decide qual IA constrói e quantas revisões a tarefa tem. Aqui você diz, com as suas palavras e exemplos do seu sistema, o que conta como arriscada e o que conta como mecânica.
>
> Por que importa: o critério genérico não conhece o seu negócio. Uma tarefa que mexe em "separação entre clientes" parece comum para quem lê o código, e é a que mais custa se der errado. Com os seus exemplos, o plano acerta o tipo e dá o cuidado certo.
>
> Opções:
> (a) usar o critério genérico: o plano decide pelo texto padrão do método.
> (b) escrever o seu critério: uma frase para arriscada e outra para mecânica, com exemplos. Por exemplo, arriscada: "login, permissão, separação entre clientes, dado pessoal cifrado, migração com dados"; mecânica: "texto de tela, estilo, renomear sem mudar comportamento".
>
> Minha recomendação: [a opção e o motivo ligado a este projeto; com dados sensíveis ou várias empresas no mesmo sistema, (b), propondo exemplos tirados das specs e da arquitetura].
>
> Padrão: (a) o critério genérico.

Write the person's sentences under `planning.risk` as `arriscada` and `mecanica`; a missing key keeps the generic criterion. The plan cites the criterion in the line "Por que esta classe" of each task ([planning.md](planning.md)).

**16. Size of a delivery** (`planning.max_tasks`, default 8; `planning.max_criteria`, default 60; positive whole numbers)

> Pergunta [N] de [total] · Tamanho máximo de uma entrega
>
> O que é: uma entrega muito grande demora para ficar pronta, gasta mais em cada revisão e é difícil de testar de uma vez. Aqui você define o limite de tarefas e de critérios de aceite (as frases que dizem quando algo está certo) de uma entrega. Passando de um deles, o plano propõe dividir a entrega em duas.
>
> Por que importa: entregas menores chegam mais cedo para você testar e deixam as revisões mais baratas; entregas maiores reduzem o número de paradas para você.
>
> Opções (diga os dois números):
> (a) manter 8 tarefas e 60 critérios.
> (b) limites menores: entregas mais curtas e mais frequentes.
> (c) limites maiores: menos entregas, cada uma mais pesada.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: (a) 8 tarefas e 60 critérios.

**17. Specs frozen during a delivery** (`planning.freeze_specs`, default `on`)

> Pergunta [N] de [total] · Mudar a spec no meio da entrega
>
> O que é: depois que você aprova o plano, as specs da entrega ficam congeladas. Se surgir uma mudança de spec no meio da construção, ela vai para a próxima entrega, a não ser que você decida trazê-la para esta.
>
> Por que importa: trazer uma mudança para dentro reabre tarefas já feitas e solta testes que já passavam, o que gasta e atrasa. Congelar mantém a entrega estável; em troca, a mudança espera.
>
> Opções:
> (a) congelar: a mudança vai para a próxima entrega, e eu só trago para esta se você decidir, depois de ver o custo.
> (b) não congelar: a mudança entra na entrega em andamento sem essa conversa.
>
> Minha recomendação: (a), [motivo ligado a este projeto].
>
> Padrão: (a) congelar.

(a) -> `true`; (b) -> `false`.

**18. What the reviews look for** (`review.focus.always` and `review.focus.suggestion`, two lists of short phrases; default empty)

> Pergunta [N] de [total] · O que as revisões devem procurar
>
> O que é: duas listas curtas para os revisores. A primeira, "sempre": o que conta como achado grave neste projeto se aparecer, como login, permissão, dado de outro cliente ou dado pessoal à mostra. A segunda, "só sugestão": casos raros que você quer ver anotados, mas sem travar a entrega, como duas pessoas clicando no mesmo milissegundo ou a virada da meia-noite.
>
> Por que importa: sem as listas, cada revisor decide sozinho o que importa, e uma tarefa pode gastar rodadas atrás de um caso raro enquanto o que mais custa fica sem atenção. As listas vão no pedido de cada revisão e no plano.
>
> Opções:
> (a) sem listas: os revisores usam o critério geral.
> (b) escrever as listas: me diga os itens de cada uma.
>
> Minha recomendação: [a opção; com login, dinheiro ou dados de vários clientes, (b), propondo itens para "sempre" tirados das specs].
>
> Padrão: (a) sem listas.

Write `review.focus.always` and `review.focus.suggestion` as lists of strings. A finding that falls in a `suggestion` item is only a suggestion, unless it touches an `always` item.

**19. Rounds of the final review** (`review.final_rounds_max`, default 2, a positive whole number)

> Pergunta [N] de [total] · Rodadas da revisão final
>
> O que é: no fim da construção, uma revisão interna olha a entrega inteira de uma vez. Depois das correções, ela confere só o que as correções mudaram, em quantas rodadas você permitir, contando a primeira, que é a completa.
>
> Por que importa: a cada rodada a revisão tende a achar casos cada vez mais raros, e cada volta gasta mais. Passando do limite, o que não for crítico vira pendência anotada, e um achado crítico espera você.
>
> Opções (diga o número):
> mais rodadas: pegam mais coisas sozinhas, com mais gasto.
> menos rodadas: te chamam mais cedo.
>
> Minha recomendação: [o número e o motivo ligado a este projeto].
>
> Padrão: 2.

**20. Screen tests in every browser, per task** (`test_runs.screen_task_full`, default `off`; ask only when the project has a browser or mobile test layer with more than one project, for example more than one browser)

> Pergunta [N] de [total] · Testes de tela em todos os navegadores
>
> O que é: durante a construção, os testes rodam na versão rápida, só no Chrome (Chromium). Aqui você decide se uma tarefa que muda uma tela roda também os testes dela nos outros navegadores ou no celular, uma vez, depois da última revisão aprovada e antes de ser juntada.
>
> Por que importa: um defeito que só aparece no Safari ou no celular, descoberto só no fim da entrega, custa uma correção e uma nova rodada de revisão. Ligar gasta mais tempo de teste em cada tarefa de tela.
>
> Opções:
> (a) ligar: cada tarefa de tela confere nos outros navegadores antes de entrar. Pega o defeito mais cedo e demora mais.
> (b) deixar desligado: só a bateria completa do fim da entrega confere os outros navegadores.
>
> Minha recomendação: (a) quando o projeto testa outros navegadores ou o celular, porque [motivo ligado a este projeto]; senão, (b).
>
> Padrão: (b) desligado.

**21. The full test battery in CI** (`test_runs.ci_full`, default `merge`; ask only when the project has a CI workflow or `tracker` lists `github`)

> Pergunta [N] de [total] · Bateria completa na integração contínua
>
> O que é: a integração contínua (CI) é a verificação automática que o GitHub roda quando algo é enviado. A bateria completa é a que roda todos os testes, em todos os navegadores. Aqui você decide quando ela roda lá.
>
> Por que importa: a bateria completa é a parte mais demorada e a que mais gasta minutos do plano do GitHub. Em repositório privado com plano limitado, os minutos podem acabar no meio do mês.
>
> Opções:
> (a) a cada junção na linha de integração: a bateria completa roda sozinha toda vez que uma entrega entra. É o jeito de antes, mais seguro e mais caro.
> (b) só manual: o CI roda a bateria rápida no pedido de junção (PR) e na junção na linha de integração, que publica o ambiente de teste, e a completa só quando alguém a dispara à mão, de preferência antes de promover para a linha principal. Gasta bem menos minutos.
>
> Minha recomendação: [(b) se o repositório é privado e o plano de CI é limitado; senão, (a)].
>
> Padrão: (a) a cada junção.

(a) -> `merge`; (b) -> `manual` (the CI template then has a manual trigger, `workflow_dispatch`). When the answer changes `test_runs` (in 20 or 21) and the project has an accepted ADR stating what runs when, offer a new ADR that supersedes that item: [architecture.md](architecture.md), "Technical change without behavior change", step 7. The person approves it; never write it alone.

**22. Minutes of the CI plan** (`ci.monthly_minutes`, a positive whole number, default absent; ask only for a private repository on GitHub that has CI; detect it with `gh repo view --json isPrivate`)

> Pergunta [N] de [total] · Minutos do plano de CI
>
> O que é: o GitHub dá uma quantidade de minutos por mês para rodar a verificação automática em repositório privado, e cobra ou para quando acabam. Se você me disser quantos são, o plano de cada entrega estima quantos minutos ela vai gastar.
>
> Por que importa: sem o número, eu só consigo dizer quanto cada entrega gasta, não se cabe no mês.
>
> Opções:
> (a) informar o número de minutos do seu plano (por exemplo 2000).
> (b) não informar: o plano mostra a estimativa sem comparar com o seu limite.
>
> Minha recomendação: (a) se você sabe o número, porque [motivo ligado a este projeto].
>
> Padrão: (b) não informar.

**23. Where a delivery ends** (`delivery.target`, `integration` or `main`, default `integration`)

> Pergunta [N] de [total] · Onde a entrega termina
>
> O que é: cada entrega é juntada em uma linha de trabalho. Na de integração (`[nome de branches.integration]`), as entregas se juntam e você testa antes de ir para a principal. Na principal (`[nome de branches.main]`), a entrega vai direto para o que já foi aprovado.
>
> Por que importa: terminar na integração dá um passo a mais de teste antes da principal; terminar direto na principal é mais curto, com menos rede de proteção. Juntar na principal sempre pede a sua aprovação, em qualquer das duas.
>
> Opções:
> (a) integração: a entrega termina na linha de integração, e a principal recebe depois, em outro passo.
> (b) principal: a entrega termina direto na linha principal.
>
> Minha recomendação: [(a) quando o projeto tem uma linha de integração que publica um ambiente de teste; (b) quando não tem e o projeto é pequeno].
>
> Padrão: (a) integração.

**24. Merge into the integration branch without asking** (`delivery.integration_merge`, `ask` or `auto`, default `ask`; ask only when `branches.integration` differs from `branches.main`)

> Pergunta [N] de [total] · Juntar na integração sem perguntar
>
> O que é: quando a entrega está pronta, o método confere sozinho se pode entrar: a bateria completa passou sobre o mesmo código, a revisão aprovou, não há teste feito à mão pendente nem pergunta aberta para você, e o CI do pedido de junção (PR) passou. Aqui você decide se, estando tudo certo, eu junto na linha de integração sem perguntar.
>
> Por que importa: perguntando, você decide cada junção; sem perguntar, a entrega anda e vai para o ambiente de teste sozinha, e a parada de "pronto para testar" passa a vir depois da junção, quando você testa o que a integração publicou. Se qualquer item não estiver certo, eu paro e pergunto como hoje. Juntar na linha principal sempre pergunta.
>
> Opções:
> (a) perguntar a cada junção.
> (b) juntar sozinho quando a conferência passar.
>
> Minha recomendação: [(b) quando a linha de integração publica um ambiente de teste que você usa; senão, (a)].
>
> Padrão: (a) perguntar.

(a) -> `ask`; (b) -> `auto`.

**25. Scenarios only a specialist runs** (`qa.specialist`, a list of short phrases, default empty)

> Pergunta [N] de [total] · Testes que só um especialista faz
>
> O que é: alguns cenários de teste à mão pedem um especialista ou equipamento específico, como acessibilidade, leitor de tela (a tecnologia que lê a tela em voz alta), idioma e localização, aparelho físico ou aplicativo instalado. Aqui você lista os tipos de cenário que ficam com um especialista, não com você.
>
> Por que importa: esses cenários nunca são pedidos a você, nunca travam uma junção (nem na linha principal) e nunca aparecem nas perguntas nem nos resumos no chat para você (mostro no chat apenas se você pedir); nos arquivos da entrega, o `aceite.md` e o PR listam esses cenários à parte. Sem a lista, um cenário assim aparece para você como qualquer teste à mão. Conferência de segurança ou de permissão nunca entra aqui: ela sempre trava a junção até ser feita.
>
> Opções:
> (a) nenhum: todos os testes à mão são seus.
> (b) listar os tipos (por exemplo "acessibilidade", "leitor de tela", "idioma", "aparelho físico", "aplicativo instalado"): ficam com um especialista.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto].
>
> Padrão: (a) nenhum.

Write the list under `qa.specialist`. A security or permission check never goes in this list, even when the person names one: say in pt-BR that it must keep blocking the merge, and leave it out. A scenario marks itself with an `Automação` value that starts with `manual, especialista: <tipo>` (the QA scenarios template), and the kind must be one of this list (case and accents ignored); `manual, especialista` without a kind counts only when the list has exactly one kind, and means that one. Any other marker is an ordinary manual scenario, asked to the person.

**26. The system uses AI** (`product.uses_ai`, a boolean, default `false`; skip it when phase 1 already answered it)

> Pergunta [N] de [total] · O sistema usa IA
>
> O que é: alguns sistemas mandam texto para um modelo de IA, para resumir, classificar, responder um cliente ou decidir um próximo passo. Se esse texto vem de fora (um formulário, uma planilha importada, um e-mail, outra integração), ele pode trazer instruções escondidas que a IA obedece. Isso se chama injeção de instruções.
>
> Por que importa: com "sim", a arquitetura registra como o sistema se protege disso, as specs ganham testes de ataque e as revisões conferem essas proteções no código. Sem isso, um texto malicioso pode fazer o sistema agir sozinho ou mostrar dado que não devia.
>
> Opções:
> (a) não: o sistema não chama IA.
> (b) sim: o sistema chama ou vai chamar um modelo de IA.
>
> Minha recomendação: [a opção e o motivo ligado a este projeto; se as specs ou a visão falam em IA, (b)].
>
> Padrão: (a) não.

(a) -> `false`; (b) -> `true`. Later, when a spec or an ADR brings an AI call, the conductor sets it to `true` and tells the person ([project-bootstrap.md](project-bootstrap.md)).

**27. Cleanup commands at delivery closeout** (`cleanup.commands`, a list of shell commands, default empty; optional)

> Pergunta [N] de [total] · Limpeza ao encerrar uma entrega
>
> O que é: no fim de uma entrega, o BACO remove branches juntadas, pastas soltas em `.worktrees/` e registros antigos em `.baco/logs/`. Ele nunca decide sozinho o que mais é descartável no seu projeto (como bancos de teste, contêineres ou imagens). Aqui você pode listar comandos de limpeza próprios do projeto para rodar no encerramento.
>
> Por que importa: sem a lista, recursos temporários do projeto ficam acumulados; com ela, só sai o que você declarou.
>
> Opções:
> (a) nenhum: só a limpeza padrão do BACO.
> (b) listar os comandos do projeto (por exemplo `docker compose -f docker-compose.test.yml down -v`).
>
> Minha recomendação: [(b) se o projeto sobe banco ou contêiner descartável para testes; senão, (a)].
>
> Padrão: (a) nenhum.

Write the list under `cleanup.commands`. Only run commands declared here (and never destructive commands against production data). The engine keeps the SHA-256 hash of `cleanup.commands` in `.baco/logs/cleanup-commands.sha256` (written by `baco cleanup-branches --confirm-commands <hash>`, with the hash shown next to the commands, after the person has seen them); the conductor shows the commands to the person on the first run and whenever `baco cleanup-branches` reports them as `unconfirmed` or `changed`; when `confirmed`, it runs them at closeout without asking again ([delivery.md](delivery.md), section 7).
