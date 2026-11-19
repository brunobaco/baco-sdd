# Estado do trabalho

Atualizado em 2026-11-18.

## Pronto

1. Versão 1.0.0: tudo o que estava na seção não lançada do CHANGELOG desde a 0.1.2, com 614 testes do motor passando. Manifesto do plugin, marketplace, `SKILL.md` e CHANGELOG em 1.0.0.
2. Cinco rodadas de teste ponta a ponta com um app de exemplo (roteiro e semente em `evals/e2e/`). Duas divisões funcionaram bem: Claude constrói e Codex revisa o PR em modo só leitura (mais barata), ou Codex constrói na caixa `rede` e as revisões ficam no Claude (construção mais rápida, quase sem correção).
3. README reescrito para a 1.0 e atualizado na 1.1 (caixa das ferramentas de IA e divisões sugeridas): proteções com o que garante cada uma (motor, plugin, ferramenta ou método) e tabela do que funciona com o plugin, só com a skill e nas outras ferramentas.
4. Licença MIT.
5. Versão 1.1.0: caixa por ferramenta de IA (`protegida`, `rede`, `livre`; padrão `rede`), regras de comando do BACO para o Codex, caixa do próprio Claude Code em `rede` e as correções da rodada E (Codex construindo em `rede`, revisões no Claude: 7 de 7 critérios, 1 rodada de correção em 7 tarefas, construção em 51 minutos, cerca de 110 milhões de tokens até a junção). 619 testes do motor passando.

6. Versão 1.2.0: quadro do GitHub Project acompanhando a entrega como espelho dos arquivos (`github.project` na configuração, comando `baco board`, sincronia na publicação, a cada evento de tarefa e depois da junção na integração; falha no quadro vira pendência). Publicada (marca `v1.2.0` e release com o pacote da skill). Variante com GitHub e quadro no roteiro ponta a ponta, ainda não rodada.

7. Versão 1.3.0: a configuração explica o que cada opção muda e pergunta todos os ajustes que dependem da pessoa (cenário manual pendente, nível de IA por tipo de tarefa, rodadas da revisão externa, pasta de documentos quando já existe outra), e continua opcional. Instruções de relatório JUnit e de `.baco/local.env` em `references/test-commands.md`. 641 testes do motor passando. Publicada (marca `v1.3.0` e release com o pacote da skill).

8. Versão 1.3.1: com o revisor de tarefa numa ferramenta só leitura, o condutor roda por ele só os testes da tarefa, na forma rápida, uma vez por rodada; nunca a camada inteira nem todos os navegadores. Eval `revisao-tarefa-leitura` passando. Publicada (marca `v1.3.1` e release com o pacote da skill).

9. Versão 1.4.0: gravidade dos achados com a chance de acontecer (caso atípico nunca é "crítico") e rodada 5 só com "importante" aberto juntando a tarefa, com os achados como pendências decididas pela pessoa numa lista antes da revisão final. Chave `review.round5_importante` (`seguir` padrão, ou `parar`). 642 testes do motor passando. Publicada (marca `v1.4.0` e release com o pacote da skill).

10. Versão 1.5.0: limite de rodadas de correção por tipo de tarefa (`review.task_rounds`, padrão mecânica 2, padrão 3, arriscada 4), sugerido no plano e ajustável por entrega; só a última rodada sobe o nível de IA; `round5_importante` renomeada para `last_round_importante`, com o nome antigo aceito. 644 testes do motor passando. Publicada (marca `v1.5.0` e release com o pacote da skill).

11. Versão 1.6.0: o limite conta revisões (com "revisão N de M" na tabela de tarefas em andamento); só abre correção o achado que quebra uma promessa da tarefa; da segunda revisão em diante, só o que a correção mudou; classe de problema que volta depois de duas correções muda a pergunta (refazer, simplificar ou estreitar a promessa). 645 testes do motor passando. Publicada (marca `v1.6.0` e release com o pacote da skill).

## Em andamento

Liberdade das ferramentas de IA quando constroem, em quatro etapas. As etapas 1 (caixa por ferramenta e regras do Codex) e 2 (Claude em `rede`) saíram na 1.1.0. A etapa 3 saiu na 1.3.0: a configuração explica o que cada opção muda e pergunta todos os ajustes que dependem da pessoa, e continua opcional (decisão de 2026-11-18). Falta:

4. Configuração de um projeto real já em andamento como teste. É o próximo passo, e serve também para conferir as perguntas novas da etapa 3.

Gancho do BACO para o Codex na caixa `livre`: fica para depois. O Codex roda gancho antes de cada comando (`PreToolUse`, mesmo formato do Claude Code), mas gancho de projeto só roda aprovado pela pessoa ou com `--dangerously-bypass-hook-trust`, e o comando do gancho precisaria de um caminho que sirva em qualquer máquina.

## Pendente

1. Eval `afrouxar-teste` sem conclusão num Linux em que o isolamento do executor não monta a rede (provável `bwrap` sem liberação no AppArmor). Repetir.
2. Rodar a variante com GitHub e quadro do roteiro ponta a ponta (`evals/e2e/roteiro.md`); o comando `gh project item-edit` com `--field` e `--value` só foi conferido pela ajuda do `gh` 2.103, sem quadro real.
3. Evals a escrever: conversa que passa do limite no meio da construção; retomada pela tabela "Tarefas em andamento"; plano com harness por tarefa; revisão do PR por agente com rodada de correção; harness único; revisor `pessoa` e `ambos`; saída 3; localizador; configuração antiga recebendo só as perguntas novas; projeto sem GitHub.
4. Não testado de ponta a ponta: OpenCode, regras de permissão com `*` no meio do comando.
5. Limites conhecidos: o `baco board` dá a entrega como juntada quando a branch dela está contida na de integração, o que também acontece se a branch da entrega ainda não tiver nenhum commit próprio (o plano já faz o primeiro, então não ocorre no fluxo normal); `provenance.ignore` não distingue pasta de código de pasta de registro pelo nome (a proteção é a aprovação humana); no modo `pr` o isolamento do revisor é só instrução; os logs em `.baco/logs/` se acumulam sem limpeza; `cost measure` não lê o OpenCode; faixas paralelas pouco usadas quando as tarefas dividem arquivos.

## Evoluções futuras

Sem data. Pequenas evoluções do método que ficaram para depois da 1.0; versão para o Codex sem perder o que o plugin dá (agentes próprios, bloqueio de edição em `main` e `develop`, reconhecimento automático do projeto, comandos); adaptar para OpenCode e Antigravity; metas numéricas de código na revisão; documentar sistema legado; resultado do CI como gatilho; comando do motor que lista as tarefas prontas para começar; conferência de `Próximos números livres` pelo histórico do Git.

## Próximo passo

Etapa 4: configurar um projeto real já em andamento com a fase 0 nova.
