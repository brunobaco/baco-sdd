# Decisões

## 2026-11-02 | Execução autônoma como padrão

Depois do plano aprovado, o `executar` roda até o pacote da revisão externa pronto e só para quando não há jeito: portão que nunca desliga, ou tudo o que resta depende de algo bloqueado. Dúvidas reversíveis seguem com a recomendação do agente e vão para o resumo do fim.

## 2026-11-02 | Testes por tarefa e bateria completa

Durante a tarefa, só os testes dela e os existentes dos arquivos que ela mexe, só no Chromium. Bateria completa uma vez, depois das correções da revisão interna, e de novo só antes de cada nova rodada externa, porque o veredito precisa valer para o código final.

## 2026-11-02 | Revisão externa dispensável só pela pessoa

Pedida por padrão; só a pessoa dispensa, com motivo, e o aceite registra. A revisão interna independente nunca é dispensada. A regra de permissão do projeto pede confirmação para `waive-review` e `import-verdict`.

## 2026-11-02 | Conceitos do EGM e do ub-mode

Entram: revisor de simplicidade, regras para tratar achados, conferir no código o que o plano cita, testar comportamento e corrigir a causa, seis olhares antes da spec quando há sinal de risco ou a pedido. Ficam de fora por enquanto: metas numéricas (complexidade, duplicação, mutação).

## 2026-11-02 | Orientações do projeto em `.claude/CLAUDE.md` (substituída em 2026-11-23)

A validação do plugin trata um `CLAUDE.md` na raiz do plugin como problema. As orientações ficam em `.claude/CLAUDE.md`, e o `AGENTS.md` aponta para lá. Substituída por "Orientações do projeto no `AGENTS.md`".

## 2026-11-03 | Validação com revisão externa dispensada

Com todos os critérios provados e a revisão externa dispensada, o catálogo marca "validada sem revisão externa". Descartado: manter "parcialmente validada", que deixava a spec presa nesse estado.

## 2026-11-03 | Repositório sem dados pessoais

O repositório guarda só o plugin, a skill, o motor, os testes e documentos genéricos. Registros de sessão, planos de trabalho, pesquisas e resultados de rodadas com dados de pessoas, empresas ou projetos foram apagados e não voltam. O histórico de versões ainda os contém; antes de tornar o repositório público, decidir entre publicar num repositório novo ou reescrever o histórico.

## 2026-11-12 | Documentos só com o estado atual

Spec e QA descrevem só o que vale hoje: item retirado sai do documento e o texto anterior fica no Git. A tabela de versões continua, com uma linha por versão dizendo por ID o que mudou, e a linha `Próximos números livres` impede reaproveitar número. Projeto que mantém tabela de IDs aposentados segue valendo, e o motor a reconhece. ADRs ficam de fora, porque neles o histórico é o propósito. Descartados: manter itens marcados como obsoletos no corpo como padrão, e conferir a linha pelo histórico do Git agora (fica a conferência local no `validate-spec`).

## 2026-11-12 | Conteúdo em um só lugar

Cada conteúdo mora num único documento e os outros apontam para ele, sem repetir o texto; os revisores apontam a repetição. Descartado: aviso do motor para trechos idênticos entre documentos, por falso positivo e por não pegar paráfrase.

## 2026-11-12 | Retomada depois da cota fica com o ambiente

A rotina de retomada que o BACO oferecia criar na Ratoeira saiu. Retomar depois da cota fica com o ambiente (na Ratoeira, a troca de conta ou de agente pelo aviso de limite e a retomada que ela venha a ter) e com o "continuar" da pessoa. Continuam a seção Retomada, `parado por cota` e o dono da execução. Descartado: manter a rotina enquanto a Ratoeira não faz a retomada automática.

## 2026-11-12 | Conversa nova por tamanho, não só resumo automático

Um hook mede o contexto da conversa e avisa ao passar de `context.handoff_at` (padrão 400 mil tokens). Com a pessoa presente, o condutor pergunta; na construção, com `context.auto_handoff` ligado, termina a tarefa, grava a Retomada e segue numa conversa nova. O motivo é custo por passo e qualidade em conversa longa, não falta de espaço na janela. Descartados: confiar só no resumo automático, e um limite perto do tamanho da janela.

## 2026-11-12 | Harness e modelo decididos no plano

Cada tarefa e papel tem harness, modelo e esforço no plano aprovado; o condutor não escolhe na hora. Até haver teste ponta a ponta, outro harness só roda papéis de leitura, salvo `implementers: on`. Descartado: o agente decidir na hora qual modelo é mais barato, porque decisão do momento varia e o agente não conhece o preço real.

## 2026-11-12 | Revisão externa vira revisão do PR

A revisão externa padrão passa a ser a do PR da entrega, por agente, pessoa ou ambos, com correções automáticas e rodadas de delta até aprovar ou chegar ao limite. O veredito do agente entra pelo `import-pr-verdict`, que só aceita a resposta da rodada mais recente; o de pessoa só entra com a confirmação dela. O revisor nunca roda na sessão de quem construiu. Descartado como padrão: a cópia do projeto em pasta separada, que continua disponível quando o plano exigir isolamento.

## 2026-11-13 | Custo medido nas transcrições

O custo real vem das transcrições das conversas, não do que o agente informa. O comando `baco cost measure` lê os arquivos de sessão do Claude Code (conversa do condutor e transcrições dos subagentes) e do Codex, conta cada resposta uma vez (o Claude Code grava a mesma resposta em várias linhas, com o mesmo id; o Codex repete eventos de contagem), separa condutor e subagentes por harness e modelo e mostra o maior contexto do condutor numa resposta e a parte dele no total. A medição da entrega vai para uma seção própria do `custo.md`, com a janela a partir da linha `Início` do plano; as etapas fora de entrega (fases 0 a 3, evolução de spec) vão para `docs/custo-projeto.md`, uma etapa por rótulo. O `cost add` continua, como lista de quem rodou, e os `custo.md` antigos seguem valendo. Motivo: no teste ponta a ponta, o `custo.md` somou cerca de 2,6 milhões de tokens, contra cerca de 100 milhões nas transcrições, e as fases sem entrega não tinham onde ser registradas. Descartados: somar o que o Claude Code informa ao fim de cada subagente (não inclui o condutor e não conta o cache por inteiro), trocar o `cost add` pela medição (perderia a lista de agentes do aceite) e gravar ids de sessão no repositório.

## 2026-11-13 | Harness conferido antes do plano, e o condutor faz o commit de quem roda fora

Antes de um plano dar trabalho a um harness que não é o do condutor, uma chamada curta, com o modelo leve, confere nesta máquina o modo que o BACO vai usar: leitura sempre, escrita numa pasta de teste quando `implementers: on`. O resultado fica em `.baco/logs/harnesses.md` (fora do git, por máquina) e vale por 7 dias; a fase 6 confere de novo no começo quando está velho ou é outra máquina. Se falha, o harness fica fora do plano naquele modo, a pessoa fica sabendo o que conferir, e o isolamento nunca é desligado para contornar. O implementador em outro harness deixa as mudanças sem commit na pasta da tarefa; o condutor confere o `git status`, roda os testes da tarefa pelo `baco run-tests` e faz o commit com uma linha que diz harness e modelo. Motivo: no teste ponta a ponta, o plano mandou construir no Codex e todas as chamadas falharam no isolamento da máquina só na fase 6; e um agente que só escreve na pasta do worktree não alcança os dados do git, que ficam no `.git/worktrees/` do repositório principal. Descartados: um comando do motor para a conferência (as chamadas são próprias de cada ferramenta e passam pelas regras de permissão do condutor, e o registro é uma linha), liberar a escrita do implementador no `.git` do repositório principal, e trocar o harness na hora quando a conferência falha.

## 2026-11-13 | Instalação limpa provada na primeira tarefa, e revisor só afirma o que rodou

A tarefa do plano que cria o esqueleto do projeto tem, no critério de pronto, a instalação limpa e os comandos de teste rodando numa cópia nova (um worktree novo do ramo, sem dependências instaladas na pasta), com a saída no relatório como prova; vale também para tarefa que traz dependência com parte nativa ou muda a instalação. Na fase 3, sem código, os comandos ficam escritos e marcados como não conferidos até essa tarefa. Os revisores (de tarefa, final, do PR, e os pedidos de revisão externa) não afirmam pela leitura que um comando funciona ou falha: rodam e citam a saída, numa cópia descartável em `.worktrees/copia-*` quando o comando grava, ou marcam como não verificado; o condutor remove a cópia depois. Motivo: no teste ponta a ponta, o `npm ci` limpo só falhou na fase 7, por falta de uma ferramenta de compilação na máquina, e o revisor final afirmou pela leitura se ele funcionaria, e errou. Descartados: uma chave nova de comando de instalação na configuração (o comando fica na arquitetura e a prova na tarefa) e conferir a instalação só na revisão final.

## 2026-11-13 | Guarda de testes também compara com o início da tarefa

O `guard-tests` continua comparando com a `Base` do plano e, num ramo de tarefa `baco/ENT-NNN-<tarefa>`, compara também com o ponto onde a tarefa saiu do ramo da entrega (merge-base com `baco/ENT-NNN`), achado pelo nome dos ramos, sem mudar a chamada do condutor; `--task-base` cobre ramo com outro nome. Achado visto pelas duas comparações aparece uma vez. Motivo: no teste ponta a ponta, um teste criado por uma tarefa anterior da mesma entrega não existia na `Base`, e três tarefas seguintes o enfraqueceram sem o guarda parar. Descartados: trocar a `Base` pelo início da tarefa (perderia a visão da entrega inteira, usada também na fase 7) e exigir o `--task-base` em toda chamada (o condutor ou o implementador podem esquecer).

Complemento (rodada D): para não atribuir a um teste o código escrito depois dele (uma função de apoio depois do último teste), o fim de um teste é o mais tardio de duas leituras independentes, o fechamento dos parênteses da chamada (lido sem contar texto, modelos de texto, expressões regulares e comentários) e a regra de recuo (a primeira linha seguinte, no recuo do teste ou menor e fora de modelo de texto ou comentário de bloco, que começa com `})`, `)` ou, depois de aberta a função do teste, `},`, ou que abre outro teste ou uma declaração). A regra de recuo usa um leitor próprio, mais simples, sem o palpite entre expressão regular e divisão, para que um mesmo erro não engane as duas leituras. Motivo: a revisão externa mostrou que a leitura dos parênteses sozinha sempre terá casos que ela erra; com o fim mais tardio, um erro em qualquer das duas só deixa a proteção ligada por mais tempo, nunca a corta. Descartado: seguir remendando a leitura dos parênteses até virar um leitor de JavaScript completo.

## 2026-11-13 | Cenário de QA sem critério de aceite conta no aceite

Cenário ligado só a regra de negócio ou requisito, sem CA da spec, entra no `trace` em `otherScenarios`, com o resultado calculado como os outros. No aceite, pendente segue a mesma regra `manual_pending` dos cenários de critério (por padrão bloqueia a integração na `main` e avisa nas outras); reprovado ou falhando bloqueia como falha de verificação. Motivo: no teste ponta a ponta, um cenário manual ligado só a uma regra nunca apareceu, e o aceite disse que não havia teste manual pendente. Descartados: só avisar sempre (o cenário existe para provar a regra, e a regra configurável já decide por ramo) e bloquear sempre (seria mais duro que o cenário de um critério).

## 2026-11-13 | Corte do simplificador no código só com teste

Na fase 7, o simplificador só marca um corte como `seguro` quando nomeia os testes existentes que pegariam uma mudança de comportamento; sem eles, o corte é `precisa de teste` ou `muda comportamento`, e verificação acrescentada por uma correção nunca é `seguro`. O condutor aplica corte só por uma tarefa INT com teste, e o `muda comportamento` vai para a pessoa. Motivo: no teste ponta a ponta, um corte marcado como seguro tirou um filtro e reabriu um defeito real, sem nenhum teste falhar. Descartados: o simplificador aplicar o corte numa cópia e rodar os testes (ele só escreve o próprio relatório) e deixar de cortar código na fase 7.

## 2026-11-13 | Aviso de tamanho com margem antes do resumo automático

Quando o Claude Code resume a conversa sozinho antes do `context.handoff_at` (80% do `autoCompactWindow`), o gancho avisa 30 mil tokens antes desse ponto, e a configuração propõe esse limite efetivo como `handoff_at`. Motivo: no teste ponta a ponta, o aviso veio só depois de passar dos 320 mil e, com passos de 10 a 20 mil, a conversa chegou a 328 mil antes da troca, perto do resumo. Margem fixa, sem chave de configuração: ninguém pediu outro valor, e a chave `handoff_at` já permite avisar antes. Descartados: margem em porcentagem (com janelas grandes ficaria larga demais) e recusar na configuração um `handoff_at` acima do limite (o motor não lê as configurações do Claude Code ao validar).

## 2026-11-13 | Camada do teste conferida pelo rastreio

A camada de um cenário (`regra` ou `navegador`) é declarada como palavra na linha `Automação`, onde o planejador já escreve o caminho do teste, e não numa coluna nova nem na tabela de cobertura do plano (que o `trace` não lê). A camada de um teste vem do arquivo que o JUnit nomeia (`file`, ou `classname` com caminho, como no Playwright e no Vitest), comparado com os caminhos declarados para cada camada no mesmo QA. Cenário `navegador` só é provado por teste sabidamente de arquivo `navegador` (sem caminho de navegador declarado, ou com nome curto que casa com as duas camadas, não há prova); cenário `regra` só é recusado quando o teste é sabidamente de navegador. O resultado `layer_mismatch` faz o critério falhar (e não ficar pendente), porque a prova não corresponde ao que o critério diz, como na falha de verificação, e não deve virar aviso em ramo que não é a `main`. Motivo: no teste ponta a ponta, dois critérios de tela foram dados como provados por testes de regra; o validador do aceite pegou, mas tarde. Descartados: deduzir a camada pelo nome da pasta (`e2e`) ou pelo nome da camada de `tests` na configuração (nomes livres) e um estado novo de critério (todos os leitores do rastreio teriam de mudar). Sem camada declarada, nada muda.

## 2026-11-13 | Gancho contra gravação fora do projeto

Além da regra no papel do implementador, o plugin ganha um gancho antes de cada comando de terminal que recusa, para subagentes em projeto BACO, um redirecionamento ou `tee` para fora da pasta do projeto (a cópia de trabalho e, numa cópia ligada, o projeto principal). Motivo: na rodada D um implementador gravou `../a.log` mesmo com a regra escrita. É uma proteção contra descuido do agente, não uma barreira de segurança contra um agente mal-intencionado. Para ficar confiável e sem ruído, o gancho só recusa o que tem certeza: lê o comando respeitando aspas, comentários e heredoc, lê como comando à parte o que está em `$( )` e crases (também entre aspas duplas) e em substituição de processo, pula as opções de `sudo`, `env`, `timeout` e parecidos antes do `tee`, segue cada parte do caminho pelos atalhos (symlinks) antes de aplicar `..`, e deixa passar `/dev/*` alcançado sem `..`, destinos com variável ou curinga e caminhos relativos depois de um `cd` no mesmo comando; em qualquer erro deixa passar. Lacunas conhecidas e aceitas: texto de `sh -c` e `eval`, apelidos e funções, expansões dentro do corpo de heredoc e arquivos que os próprios programas gravam (`cp`, `dd of=`, `node -e`); cobri-las pediria um interpretador de shell inteiro. Recusa não abre pergunta de permissão: o agente recebe o motivo e refaz. O condutor fica de fora (roda comandos do motor e conversa com a pessoa). Descartados: só documentar (a regra já existia e foi quebrada) e conferir a pasta de cima depois de cada tarefa (caro e tardio). Implementador em outra ferramenta (Codex) não passa por esse gancho; lá vale a regra escrita e o isolamento da própria ferramenta.

## 2026-11-13 | Divisão de modelos sugerida quando o Codex está disponível

Na configuração, com o Codex instalado e a verificação de leitura passando, o BACO sugere (sem impor) esta divisão: condutor, implementadores e revisores de tarefa no Claude (implementadores pela classe de risco, ou o modelo mais forte se a pessoa preferir), revisor do PR no Codex (modelo mais capaz, esforço alto, só leitura) e localizador no modelo mais leve do Claude. A pessoa aceita ou muda qualquer parte; só com o Claude, nada muda. Motivo: nas rodadas ponta a ponta, o Codex implementando no modo protegido (sem rede e sem abrir porta) devolveu a instalação e os testes de navegador ao condutor (condutor com 67% do uso e 7 rodadas de correção), e o Codex como revisor do PR custou cerca de 1% e achou 2 defeitos críticos que as revisões do Claude não acharam. Descartados: impor a divisão e liberar o Codex como implementador por padrão.

## 2026-11-13 | Prazo de chamada a outra ferramenta pelo limite do próprio terminal

Para limitar o tempo de uma chamada ao Codex, o condutor usa o limite de tempo da ferramenta de terminal e não o comando `timeout` na frente, que muda o começo do comando e deixa de casar com a regra de permissão `codex exec * -s read-only *`. Descartado: acrescentar à configuração um padrão extra para a forma com `timeout`, que alarga o que roda sem perguntar.

## 2026-11-13 | Plano traz resultado esperado, critério e testes de cada tarefa

O plano ganha `Detalhes das tarefas`, uma subseção por tarefa com `Resultado esperado`, `Critério de pronto` e `Testes da tarefa`, escrita pelo planejador. O publicador só copia; o que o plano não traz vira `a definir pelo implementador`. Motivo: o publicador escrevia resultado e interfaces que o plano não dava. Descartado: o publicador inventar com base na linha do plano.

## 2026-11-13 | Resposta do revisor do PR diz o que foi conferido

O `import-pr-verdict` recusa a resposta sem a seção `## O que foi conferido` com texto, mesmo com `VEREDITO: aprovado`, porque uma resposta só com o veredito não mostra o que o revisor olhou. O `import-verdict` (arquivo de uma pessoa) não exige a seção, e veredito já importado não muda.

## 2026-11-14 | Caixa por ferramenta de IA, com regras de comando do BACO

Cada ferramenta de IA ganha `sandbox` na configuração: `protegida`, `rede` ou `livre`, com `rede` como padrão. Para o Codex, `rede` é a caixa de gravação na pasta da tarefa com internet e porta local liberadas, e as três caixas carregam as regras de comando do BACO (`.codex/rules/baco.rules`), que recusam o que o método nunca deixa um implementador fazer. Motivo: na rodada C, o Codex na caixa sem rede devolveu a instalação e os testes de navegador ao condutor, e foi isso que encareceu a rodada; testado nesta máquina, `rede` instala pacote, abre porta e continua sem gravar fora da pasta, e as regras valem no modo não interativo. A caixa é um limite de verdade na gravação; as regras são um filtro, como as permissões do Claude Code. Descartados: a revisão automática do Codex (`--approve-for-me`), porque o revisor aprovou gravar fora da caixa num teste, o que afrouxa em vez de proteger; o gancho do Codex antes de cada comando na caixa `rede`, porque a caixa já impede a gravação fora da pasta e o gancho de projeto só roda com aprovação da pessoa ou com uma opção que pula essa aprovação; manter `protegida` como padrão, porque a configuração pergunta e explica a caixa a quem libera uma ferramenta para construir.

## 2026-11-14 | Caixa do Claude Code em rede, com lista de endereços

Com `harnesses.claude-code.sandbox: rede`, a configuração liga o isolamento próprio do Claude Code no `.claude/settings.local.json`: os comandos gravam só na pasta do projeto e na pasta temporária da sessão, a internet só alcança os endereços aprovados, a saída de emergência fica desligada e o Codex e o comando que deixa o app rodando ficam na lista de exceções. Motivo: com as proteções do BACO como base em qualquer ferramenta, o Claude passa a ter a mesma caixa de gravação do Codex em `rede` e, além disso, uma lista de endereços, que reduz o risco de mandar chaves para fora. Testado nesta máquina com o Claude Code 2.1: gravação fora recusada, endereço fora da lista recusado, npm, `gh` e teste de navegador com servidor local no mesmo comando funcionando, Codex rodando pela exceção. Limites aceitos: um servidor iniciado num comando só é visível para ele mesmo, por isso o comando que deixa o app rodando para a pessoa fica fora da caixa; e a exceção não reconhece comando com redirecionamento, por isso a chamada do Codex não leva `< /dev/null` e começa sempre em segundo plano. Descartados: `protegida` para a ferramenta do condutor, que precisa de internet para o GitHub e para instalar; ligar `allowNestedUserNamespaces` para o Codex abrir a caixa dele dentro da do Claude, porque desliga uma barreira de segurança e só vale na configuração do usuário.

## 2026-11-15 | Sem marcação de pasta confiável na chamada do Codex

O Codex 0.165 ignora a marcação de pasta confiável passada na chamada e marca sozinho, na configuração dele, a pasta onde roda. O BACO deixa de passar a marcação e confia na verificação `regra: sim`, feita numa pasta git como as de tarefa: se uma versão futura do Codex não carregar as regras, a verificação falha e o Codex não constrói. Descartado: manter a marcação "por garantia", porque ela não faz nada e esconde de onde vem a confiança.

## 2026-11-15 | Remoção de pasta de tarefa fora da caixa do Claude

Dentro da caixa do Claude Code, o git não consegue apagar os dados da pasta de tarefa em `.git/worktrees/<nome>` ("Device or resource busy"), porque a caixa protege arquivos do `.git` montando por cima deles. `git worktree remove *` entra nas exceções da caixa, e o condutor remove as pastas listadas antes de `baco cleanup-branches --apply`. Descartado: deixar a limpeza para a pessoa fazer à mão, porque sobram branches e pastas a cada entrega.

## 2026-11-16 | Quadro do GitHub Project como espelho, com a coluna decidida pelo motor

O quadro de um GitHub Project acompanha a entrega, só de ida: os arquivos da entrega decidem o estado de cada tarefa e o quadro só recebe a mudança. A coluna de cada issue sai de um comando do motor (`baco board`), não do condutor, porque a regra tem casos que se perdem de cabeça (rodada de correção volta para em andamento, conferência da pessoa fica em revisão, a issue mãe só vai para concluída depois da junção na integração). O motor não chama o `gh`: devolve o comando, o condutor roda, confere e registra com `--applied` num arquivo de `.baco/logs/`, e o motor lista só o que mudou desde o registro. Assim o motor continua sem rede e testável, e um registro perdido só faz tudo ser listado de novo. O comando muda a coluna pelo nome do campo e da opção, que o `gh` atual aceita; a rota pelos ids do `field-list` fica nas instruções para versões antigas do `gh`. Falha no quadro vira pendência e nunca para a entrega; sem a permissão `project`, a pessoa roda `gh auth refresh -s project`. Descartados: o condutor decidir a coluna sozinho a partir das instruções; o motor chamar o `gh` direto, que traria rede e login para dentro dos testes; ler o quadro para saber o que já foi aplicado, que faria o quadro influir no estado.

## 2026-11-18 | Configuração completa, explicada e opcional

A fase 0 explica o que cada opção muda e pergunta todos os ajustes que dependem da pessoa, incluindo os que antes só mudavam se ela pedisse (`manual_pending`, `models`, `review.external_rounds_max`, e `docs_root` quando o projeto já tem documentos fora de `docs/`). Motivo: com só o padrão oferecido, a pessoa aceitava valores que não entendia, e ajustes que pesam no custo e na segurança ficavam no padrão sem ela saber que existiam. A configuração continua opcional: oferecida uma vez, sem bloquear, e "o resto pode ser o padrão" encerra as perguntas. Os ajustes técnicos (`tests.patterns`, `tests.junit_dir`, `tests.queue`, `provenance.ignore`) continuam com o agente, a partir do que ele detecta. Descartados: tornar a configuração obrigatória no início do projeto, porque nem toda pessoa quer configurar antes de começar e o padrão já funciona; perguntar também os ajustes técnicos, que alongariam a conversa com escolhas que a pessoa não tem como avaliar.

## 2026-11-18 | Gravidade pela chance de acontecer e rodada 5 que não para por "importante"

A gravidade de um achado de código passa a combinar a chance de acontecer com o efeito: "crítico" só no uso normal e com dado errado gravado, dado restrito à mostra ou permissão indevida; caso atípico é no máximo "importante". Na rodada 5, só "importante" aberto junta a tarefa e vira pendência, decidida pela pessoa numa lista antes da revisão final; "crítico" aberto continua parando. Motivo: num projeto real, tarefas pararam depois de 5 rodadas só por achados de concorrência atípica, e a pessoa juntou todas; a parada custava tempo sem mudar a decisão. O critério fica no protocolo de revisão e nos papéis (e nos modelos de pedido externo), não no pedido de cada revisão, para valer sem depender do condutor. A chave `review.round5_importante` (`seguir` padrão, `parar`) existe para projeto que prefere parar; valor inválido vira `parar`, o lado que espera a pessoa. Projeto já configurado não recebe a pergunta no início, porque o padrão serve. Descartados: deixar o critério só no pedido do condutor, que se perde entre conversas; juntar com qualquer achado aberto, inclusive "crítico"; perguntar cada pendência na hora, que voltaria a segurar a construção.

## 2026-11-18 | Limite de rodadas de correção por tipo de tarefa, ajustável por entrega

O máximo de rodadas de correção de uma tarefa sai do fixo 5 e passa a ser por tipo de tarefa, com padrão do projeto (`review.task_rounds`: mecânica 2, padrão 3, arriscada 4). O plano de cada entrega sugere esses números, com o motivo quando muda, e a pessoa ajusta na aprovação. Só a última rodada sobe o nível de IA. Motivo: 5 rodadas custavam caro e demoravam, e o que sobrava nas últimas era em geral caso atípico. O limite fica por tipo e não só por entrega porque o risco já está no tipo; como a classificação de risco é do agente, o número vem como sugestão no plano, e não como regra fechada. Descartados: um número único por entrega, que trataria igual uma troca mecânica e uma tarefa de dinheiro; manter duas rodadas no nível acima, que com limite 3 deixaria só uma rodada no nível da tarefa.

## 2026-11-19 | Revisão de tarefa por promessa, por conserto e por classe

Quatro regras para a revisão de tarefa parar de girar. O limite conta revisões, contando a primeira, e fica escrito na tabela de tarefas em andamento, porque um condutor retomado repetiu o limite antigo que lia no histórico em vez do número do plano. Só abre correção o achado que quebra uma promessa escrita da tarefa (critério, regra da spec, restrição global); o resto vira pendência na hora. Da segunda revisão em diante, o revisor confere só o que a correção mudou, porque um olhar novo sobre a tarefa inteira sempre acha algo novo e a tarefa não converge. Quando a mesma classe de problema volta depois de duas correções, não há terceira: refazer pela raiz, simplificar ou estreitar a promessa, esta última só com a pessoa. Nada disso para a execução inteira: "importante" vira pendência e "crítico" segura só a tarefa e as que dependem dela. A ideia veio de uma conversa sobre revisão com agentes. Descartados: aumentar ou diminuir o número de rodadas sem mudar o que cada uma revisa, que só muda onde a tarefa para; variar o revisor a cada rodada da mesma tarefa, que aumentaria o gasto da revisão completa, já coberto pelos revisores diferentes da revisão final e do PR.

## 2026-11-20 | Antigravity construindo: gancho na pasta da tarefa e só caixa `protegida`

O Antigravity pode construir, chamado pelo condutor, só na caixa `protegida`. Nos testes, as ferramentas de arquivo dele gravaram fora da pasta da tarefa com `accept-edits`, sem ele e com regra `write_file(<pasta>)`; só uma recusa explícita segura, e a recusa vence a liberação. Por isso o limite da gravação é um gancho `PreToolUse` posto na pasta da tarefa (`.agents/hooks.json`, fora do git) pelo comando `baco antigravity-task`, que recusa caminho fora dela, em `.agents/` e `.git`, e na dúvida recusa. Os comandos ficam em leitura e `baco run-tests`, sem instalar, sem git que grava e sem internet, com o modo de aprovação fixo. Fica aberto, e é dito à pessoa: os testes que ele escreve rodam com o usuário dela. Descartados: `rede` e `livre` para ele, sem caixa que limite a rede; liberar `node` e `npx`, que rodam qualquer programa; gancho no nível do usuário (`~/.gemini/config/hooks.json`), que valeria para toda conversa do Antigravity da pessoa.

## 2026-11-20 | Antigravity: revisor por regras de comando e plugin gerado

O Antigravity entra primeiro como revisor só leitura, e não constrói. A garantia vem de uma lista de comandos liberados por expressão regular (só leitura), da recusa de gravar arquivo e acessar a internet, da conferência do que a revisão mudou e de um teste de recusa na verificação. Descartados: a caixa de terminal do Antigravity, que não roda neste tipo de Linux e é ignorada sem aviso; regras de recusa por expressão regular, que a CLI 1.5.10 ignorou em parte; e `--dangerously-skip-permissions`. O plugin do Antigravity é gerado na máquina de quem usa (`tools/antigravity.mjs`), porque a instalação de um plugin do Claude Code pelo Antigravity deixa os agentes de fora, não troca `${CLAUDE_PLUGIN_ROOT}` e não liga os ganchos; o caminho absoluto dos arquivos de papel só existe na máquina. Os comandos viram skills chamadas pelo nome, porque `/comando` de plugin não é expandido. Os ganchos ficam num arquivo só para os dois formatos (`hooks/host.mjs`), em vez de cópias por ferramenta. O detalhe do SKILL.md foi para `references/dispatch.md` para caber nos 24 KB que o Antigravity carrega.

## 2026-11-21 | Back-end e front-end separados, papéis com reservas e perfis por família

O plano pode separar back-end e front-end (`planning.task_split: front-back`), como opção do projeto que a pessoa troca na aprovação de cada entrega; o padrão continua por funcionalidade, porque cada tarefa já sai testável de ponta a ponta. Na divisão, o contrato da API vem antes, numa tarefa pequena, para o back-end e o front-end andarem em paralelo; a tela entra depois do servidor e os testes de tela rodam com os dois juntos. Cada papel ganha uma lista de ferramentas em ordem (`roles`): a reserva assume sozinha quando a cota da anterior acaba, sem parar a entrega, porque a lista foi aprovada com o plano; antes, toda falta de cota parava o papel até a pessoa decidir. O revisor nunca é da mesma família de modelo de quem construiu. Uma ferramenta com modelos de várias empresas ganha uma entrada por família (`harnesses.<nome>.tool`), porque cada família tem a própria cota. A troca da conversa principal fica com o ambiente: a fila de contas da Ratoeira já move a conversa para a próxima conta, mas só a conversa, e não vê as chamadas que o condutor faz a outras ferramentas pelo terminal; o BACO só lê a ordem da fila para mostrar no plano. Descartados: o BACO gravar ou depender dos arquivos internos da fila da Ratoeira, que podem mudar a cada versão; descobrir a cota pelos arquivos de estado da Ratoeira em vez da resposta da própria chamada; e separar back-end e front-end sempre, que dobra as tarefas sem ganho quando a mesma ferramenta faz as duas partes.

## 2026-11-22 | Custo do Antigravity por registro do motor e do OpenCode pelo banco dele

O uso do Antigravity em papéis entra na medição por um registro que o `baco harness-answer` grava a cada chamada (`.baco/logs/uso-ferramentas.jsonl`, fora do git, só números, ferramenta, modelo, papel e o identificador da conversa), porque a resposta em JSON da chamada é o único lugar legível com os tokens; e o uso que ele informa é o acumulado da conversa, então cada chamada conta só a diferença para a anterior da mesma conversa. O OpenCode entra pelo próprio banco (`opencode.db`), lido só para leitura com o `node:sqlite` do Node. Descartados: ler os arquivos de conversa do Antigravity, em formato binário sem descrição, que mudam a cada versão; e somar o total de cada chamada, que contava a conversa de novo a cada retomada.

## 2026-11-22 | Configuração explicada para quem não é da área

A configuração passa a fazer uma pergunta por vez, numerada, sempre no formato o que é, por que importa, opções com o que muda, recomendação com o motivo e padrão, com os termos explicados na primeira vez e "não entendi" valendo sempre. Motivo: a configuração é a primeira conversa de quem chega ao BACO, e o texto anterior, correto, pedia que a pessoa já conhecesse os termos. O comportamento, as opções, os padrões e o que é gravado ficam iguais. Descartado: um glossário separado, que a pessoa teria de abrir fora da conversa.

## 2026-11-22 | Evals só para o que quebrar na entrega real

Os evals ainda não escritos (conversa que passa do limite, retomada, harness por tarefa e outros) ficam para depois da primeira entrega real com o Antigravity construindo, e só para o que quebrar ou der trabalho nela. Motivo: a entrega real passa por essas situações ao vivo e testa melhor; escrever os dez antes custa caro e protege partes que ainda podem mudar. A revisão do PR continua no modo `pr`: o `repositorio` garante o isolamento, mas leva cada rodada pela pessoa.

## 2026-11-23 | Bateria completa uma vez, com carimbo do motor

A bateria completa roda uma vez, depois do último veredito aprovado, e o motor grava um carimbo (commit, tempo, falhas) que o `baco merge-check` confere. Antes ela rodava a cada rodada externa, e a mesma bateria rodava duas vezes sobre o mesmo código. Cada rodada externa passa a receber só os testes da tarefa e a bateria rápida do CI do PR. O CI completo na junção segue como padrão (`test_runs.ci_full: merge`), com a opção de rodar só à mão (`manual`). Descartado: manter o CI completo em toda junção na integração como única opção, que gasta minutos do plano de CI em projetos com bateria longa.

## 2026-11-23 | Junção automática na integração só quando limpa; na principal, sempre pergunta

Com `delivery.integration_merge: auto`, o condutor junta na linha de integração sem perguntar apenas quando o `baco merge-check` sai limpo (bateria válida, veredito aprovado ou dispensado, nenhum cenário manual bloqueando, nada esperando a pessoa, CI do PR verde, política ligada). Qualquer condição fora volta a perguntar. Motivo: a junção na integração é reversível e publica só num ambiente de teste, e a conferência é mecânica. Descartado: desligar a parada de junção na principal; ela nunca desliga.

## 2026-11-23 | Cenário manual de especialista nunca bloqueia

Cenário manual que só um QA especialista roda (`qa.specialist`) fica fora do que é perguntado à pessoa e nunca bloqueia junção, nem na principal; vira pendência própria no relatório de aceite. Motivo: a pessoa de negócio não tem como executá-lo, e travar a entrega esperando alguém que não está no fluxo a parava sem ganho. Descartado: bloquear a junção na principal por esse tipo de cenário.

## 2026-11-23 | Antigravity na caixa `rede`

O Antigravity ganha a caixa `rede`: a mesma trava de gravação na pasta da tarefa, mais `npm`, `npx` e `node` nas regras de comando, para instalar e rodar os testes de navegador sozinho. Limite dito à pessoa: a trava vale só para as ferramentas de arquivo dele, e `node` roda qualquer programa com o usuário da pessoa, então é mais fraca que a `rede` do Codex, que é uma caixa do sistema. Substitui, para a `rede` e a `livre`, o descarte de 2026-11-20, tomado quando ainda não havia como aceitar esse limite de forma explícita.

## 2026-11-23 | Ponto do resumo da conversa medido pela janela menos 33 mil tokens

O gancho de tamanho da conversa usa o ponto em que o Claude Code resume sozinho, medido em 18 resumos automáticos entre 366 mil e 375 mil tokens com janela de 400 mil: a janela configurada menos cerca de 33 mil tokens. O padrão de `context.handoff_at` cai de 400000 para 290000, e a configuração sugere `autoCompactWindow: 400000` nas configurações da pessoa, só com o ok dela. Descartado: considerar 80% da janela, que era o que se supunha e errava o ponto em dezenas de milhares de tokens.

## 2026-11-23 | Texto de fora é dado; sistema que chama uma IA precisa de defesa contra injeção de instruções

Todo texto que vem de fora (página, e-mail, issue, documento, resposta de ferramenta) é dado para todos os papéis, nunca ordem. Em sistema que chama uma IA (`product.uses_ai`), o BACO pede um ADR de injeção de instruções, critérios de ataque na spec e foco fixo na revisão. Fontes: OWASP LLM01:2025 e o guia de prevenção do projeto, e as orientações da Anthropic e da OpenAI sobre o tema. Descartado: tratar a defesa como regra só do condutor, já que quem lê o texto de fora é qualquer papel.

## 2026-11-23 | Orientações do projeto no `AGENTS.md`

As orientações de quem desenvolve o BACO ficam no `AGENTS.md` da raiz, lido por Claude Code, Codex e Antigravity, e o `CLAUDE.md` da raiz é um link para ele. O aviso da validação do plugin sobre o `CLAUDE.md` na raiz continua sendo o único aceito. Descartado: manter o `CLAUDE.md` como fonte e o `AGENTS.md` só apontando para ele, que obrigava as outras ferramentas a um passo a mais.

## 2026-11-25 | Confiança do Codex 0.169 na raiz do projeto e conferência em worktree

Medido no Codex 0.169 (três chamadas com modelo leve e esforço baixo): pasta solta com `git init` não carrega `.codex/rules/baco.rules` nem se marca como confiável sozinha, e `-c projects."<pasta>".trust_level="trusted"` por chamada continua sendo ignorado; já uma worktree ligada (`git worktree add`) de um repositório cuja raiz está marcada como `trusted` em `~/.codex/config.toml` herda a confiança da raiz e carrega `.codex/rules/baco.rules` sem gravar entrada nova no `config.toml`. Por isso a conferência de escrita do Codex passa a usar uma worktree ligada do projeto (como as tarefas reais) e a conferir ou gravar, com aprovação da pessoa, apenas a raiz do projeto no `config.toml`, nunca pastas de tarefa ou de rascunho. Complementa a decisão de 2026-11-15. Descartado: adicionar cada pasta de tarefa no `config.toml` do usuário.

## 2026-11-25 | Junção automática na integração pelo `baco merge-check --apply`

Com `delivery.integration_merge: auto`, o próprio `baco merge-check ENT-NNN --target <integração> --pr <n> --apply` executa `gh pr merge <n> --merge` (sem `--delete-branch`) e sincroniza o quadro, mas só depois de todas as sete condições passarem e com verificação explícita de que o destino é `branches.integration` (nunca `branches.main`). Assim o projeto libera o comando do motor sem abrir `gh pr merge` solto. Descartado: liberar `gh pr merge` nas permissões ou exigir script improvisado em cada projeto.

## 2026-11-25 | Quadro do GitHub Project aplicado pelo motor e por gancho `PostToolUse`

`baco board ENT-NNN --apply` move cada card com `gh project item-edit` (adicionando com `item-add` se faltar), lê o quadro de volta com `gh project item-list --format json` e só grava no registro o que foi conferido; o gancho `hooks/board-sync.mjs` dispara `--apply` em segundo plano a cada edição de `progresso.md` sem travar a edição. O modo padrão sem `--apply` permanece sem chamadas de rede. Descartado: deixar a sincronia só como instrução manual para o condutor, que esquecia de mover cards no meio de entregas longas.

## 2026-11-25 | Esforço opcional nas entradas de `roles` com `@<esforço>`

Cada item de `roles` passa a aceitar `<harness>@<esforço>` e `<harness>/<modelo>@<esforço>` (`alto`, `medio`, `baixo`, com aliases `high`/`medium`/`low`), mantendo compatibilidade total com `<harness>` e `<harness>/<modelo>` e evitando colisão com `provedor/modelo` e `:tag` de ferramentas como o OpenCode. Descartado: usar `:` como separador ou trocar a lista por lista de mapas YAML (quebraria configurações existentes e o parser simples do motor).

## 2026-11-25 | Retrato do recorte aprovado do plano (`baco approve-plan`) e proteção contra forjamento

Em toda entrega, logo após a aprovação do plano, o condutor roda `baco approve-plan` para gravar `aprovacao-plano.md` com o retrato do recorte aprovado: lista de specs (`caminho@versão`), universo de CAs e de cenários dessas specs, conjunto fora de escopo (CAs e cenários), quem aprovou e se o portão `plan` estava ligado (`gate: on` ou `off`). A primeira gravação não pede confirmação de permissão (a pessoa acabou de aprovar o plano no chat); `approve-plan` recusa sobrescrever um retrato existente sem `--replace`, e somente `approve-plan*--replace*` entra na lista `ask` (e na proposta de atualização de regras de projetos da 1.10). Com o portão `plan` desligado, o condutor grava o retrato com `--by` vazio (`gate: off`, nunca no nome do agente) e, se houver algo fora de escopo, o `acceptance-report` e o `merge-check` bloqueiam como portão humano no fim para a pessoa confirmar o recorte. O `branch-guard` nega `Write` e `Edit` diretos em `entregas/*/aprovacao-plano.md` e `entregas/*/revisao/dispensa-revisao-externa.md` em qualquer branch, garantindo que só o motor grave esses arquivos. Um cálculo único (`computeSpecScope` / `computeDeliveryScope`) serve a `approve-plan`, `trace`, `acceptance-report` e `merge-check`: em `## Cobertura` só `T-NNN` conta como tarefa real (texto livre gera aviso apontando `fora desta entrega`), só a marca `fora desta entrega` conta como fora de escopo, um CA só fica fora de escopo quando declarado no plano ou quando todos os seus cenários estão fora, e um CA com cenários misturados segue no escopo com os cenários marcados em `outOfScopeScenarios`. `acceptance-report` e `merge-check` bloqueiam como portão humano quando uma spec sai ou muda de versão, o universo encolhe ou o conjunto fora de escopo muda; edições no plano que não tocam nisso não bloqueiam. Descartados: pedir confirmação de permissão a cada primeira aprovação do plano (criava pergunta extra logo depois do "sim" no chat), gravar hash SHA-256 do `plano.md` inteiro (não era comparado em lugar nenhum e não descrevia o recorte) e aceitar texto livre na coluna `Tarefa` de `## Cobertura`.

## 2026-11-25 | Limpeza segura de `.worktrees/` (só pastas vazias) e remoção sem `--force`

`baco cleanup-branches` remove em `.worktrees/` apenas pastas soltas **vazias** (via `rmdir`). Qualquer pasta não vazia (repositório com `.git` próprio, worktree quebrada, arquivos soltos ou ignorados) nunca é apagada pelo motor: apenas listada para a pessoa conferir. Para worktrees registradas de branches já juntadas, tanto o condutor quanto `cleanup-branches` removem um por um apenas os arquivos vazios (0 bytes e fora do git) conhecidos da montagem da caixa `rede` do Claude Code (`.claude/settings*.json`, `.mcp.json`, arquivos de shell e git) e executam `git worktree remove` sem `--force` (se o git recusar, vira pendência com `git status`; a regra de liberação em `configure.md` também fica sem `--force`). Para `cleanup.commands`, o condutor grava o hash SHA-256 dos comandos já mostrados em `.baco/logs/cleanup-commands.sha256` para só voltar a mostrar quando mudarem. Descartados: flag `--orphans` no `cleanup-branches` (mesmo conferindo `git status`, `git status` não enxerga arquivo ignorado nem commit que só existe naquela cópia local) e `git worktree remove --force` em pastas de tarefa (que podia apagar trabalho não commitado).

## 2026-11-25 | Vigia sem IA via `baco check-stalled`

O motor ganha `baco check-stalled [ENT-NNN] [--minutes N]` (saída 0 quando não há entrega parada; saída 2 quando uma entrega com `Execução autônoma: sim` e `Situação: rodando` está sem atualização em `progresso.md` há N minutos ou mais), usando o horário de modificação do arquivo (independente de fuso) e devolvendo a `Conversa condutora` e o próximo passo para uma automação externa opcional. Descartado: instalar cron ou rotina automaticamente pelo BACO (o agendamento pertence ao ambiente e à pessoa).
