# Roteiro da rodada ponta a ponta

Objetivo: usar o plugin do começo ao fim em um projeto de verdade e anotar o que atrapalha. Não conserte a skill no meio, a menos que ela trave. Anote tudo e conserte depois.

## Antes de começar

1. Crie a pasta do projeto, fora deste repositório, e rode `git init -b main` nela.
2. Carregue a cópia local desta branch do plugin, de um destes jeitos:
   - Com linha de comando (terminal): desligue o plugin do marketplace, para não carregar duas cópias (`claude plugin disable baco@baco-sdd`), e abra o Claude Code na pasta do projeto com `claude --plugin-dir <pasta do baco-sdd> --add-dir <pasta do baco-sdd>`. O `--add-dir` dá permissão de leitura para os arquivos da skill. Ao terminar, religue com `claude plugin enable baco@baco-sdd`.
   - Sem linha de comando (portal da Ratoeira, extensão do VS Code): aponte o marketplace `baco-sdd` para a pasta local (`claude plugin marketplace add <pasta do baco-sdd>`), instale ou atualize `baco@baco-sdd` no escopo de usuário (`claude plugin update baco@baco-sdd` depois de mudar a branch ou o código) e garanta a regra `Read(~/.claude/plugins/cache/baco-sdd/**)` em `~/.claude/settings.json`. Abra uma conversa nova para o plugin ser relido. Depois da rodada, volte o marketplace para o GitHub.
3. Confirme com `/help` que os comandos `/baco:*` aparecem uma única vez. Não use `/agents`: foi removido do Claude Code.
4. Deixe `semente.md` à mão. Anote a hora de início e o `/usage` inicial.
5. Rodada automática, em que uma conversa faz o papel do dono e ninguém responde na tela: as regras de perguntar (`ask`) que o `/baco:configurar` grava para a junção na `main` e para ações sem volta abririam uma caixa de confirmação que ninguém vai clicar. Só nesse caso, a conversa de teste deixa essas ações de fora das regras de permitir e confere cada uma dessas paradas na própria conversa, anotando no relatório. No uso real, as regras de perguntar ficam: são a trava que não depende do agente. Também confira antes se cada harness além do Claude Code roda no modo protegido nesta máquina (a configuração faz essa chamada curta).

## Sequência

Em cada parada: confira o que está escrito, aprove ou peça ajuste, e anote.

| # | Comando | O que conferir |
|---|---|---|
| 1 | `/baco:configurar` | Pergunta pouco e em linguagem simples. Cria `.baco/config.yaml`. Oferece a permissão de leitura da skill. **Depois, abra uma sessão nova** (ou `/clear` não basta: reinicie o `claude`) e confira o **hook**: sem você dizer "BACO", peça "quero ver as specs deste projeto" e veja se a skill `baco-sdd` é carregada sozinha. |
| 2 | `/baco:iniciar` | Faz as perguntas da entrevista; responda com a semente. Pede licença antes de `git init`/commit. Cria `docs/` e o catálogo. Parada `project_start`. |
| 3 | `/baco:spec` (`tarefas`) | Spec com 4 CAs e cenários de QA. O leitor frio roda antes da aprovação. Parada `spec_approval`. |
| 4 | `/baco:spec` (`responsaveis`) | Spec com 3 CAs, ligada à anterior. Mesma parada. |
| 5 | `/baco:arquitetura` | Propõe stack (esperado: TypeScript, Vitest, Playwright) e ADRs em linguagem de negócio. O advogado do diabo roda. Parada `architecture`. |
| 6 | `/baco:plano` | O padrão do BACO é uma spec por entrega: o plano propõe ENT-001 só com `tarefas` (4 CAs) e deixa `responsaveis` (3 CAs) para a ENT-002. Nesta rodada, peça no plano que as duas specs entrem juntas na ENT-001 (7 CAs); o BACO permite, com o motivo escrito no plano. Entrega ENT-001 com tarefas, faixas e nível. Todo CA aparece em alguma tarefa. Parada `plan`. |
| 7 | `/baco:publicar` | Tarefas gravadas (arquivos; sem remoto, não há issues). Tudo lido de volta. Parada `task_batch`. |
| 8 | `/baco:executar` | Roda sozinho até a entrega ficar **pronta para testar**, sem parar por dúvida reversível: tarefas, revisões internas, revisão do PR e correções, e o relatório de aceite. Cada tarefa em branch própria, com teste primeiro, só os testes dela no Chromium; revisor roda os testes; app sobe antes de juntar. Nunca edita `main`. No fim, um resumo único do que espera você (o PR, os cenários manuais e as aprovações que faltam). |
| 9 | (dentro do `/baco:executar`, ou `/baco:revisar` para repetir) | Bateria completa uma vez, revisão interna e de simplicidade, e a **revisão do PR**: com GitHub, o PR é aberto como rascunho (sem remoto, a diferença local). Com revisor de IA, o pedido fica em `.baco/logs/revisao-pr/ENT-001-r01/pedido.md`, sem o endereço do PR, e a resposta em `resposta.md` é registrada com `baco import-pr-verdict ENT-001`, sem passar por você. Com revisor pessoa, você diz o veredito e a gravidade de cada comentário, e o BACO só copia e pede sua confirmação antes de registrar. Confira que o revisor não abriu `docs/entregas/` e que, com `ajustes`, as correções voltam ao mesmo PR e o mesmo revisor confere só elas. |
| 10 | `/baco:entregar` | Relatório de aceite com cada CA provado. Paradas `before_pr` e `merge_main`. Sem remoto, a CI roda local. |
| 11 | `/baco:reconciliar` | Catálogo, QA e ADRs atualizados conforme o que foi entregue. |
| 12 | `/baco:spec` (evoluir `tarefas` para 1.1) | Peça o CA 5 (prazo vencido destacado). O `spec-diff` mostra só o CA novo (e o que mudou por causa do prazo). Parada `spec_approval`. |
| 13 | `/baco:plano` | Entrega ENT-002 (a ENT-001 já levou as duas specs) só com a diferença; não refaz o que já foi entregue. Pare aqui (não precisa executar). |

Em qualquer ponto, `/baco:status` deve dizer onde você está e qual é o próximo passo.

## Conferir em toda parada

- **Linhas "Motor:":** o relatório da fase lista os comandos do motor que rodaram de verdade (`comando → saída N`) e, em "Não rodado", o que ficou de fora e por quê. Compare com o que você viu rodar na tela. Comando listado que não rodou é falha grave.
- **Paradas:** nenhuma parada obrigatória foi pulada.
- **Linguagem:** texto em português simples, sem jargão do motor.
- **Agentes:** cada papel rodou no contexto certo (aparece na tela como subagente), com o modelo e o esforço que o plano mostrou.
- **Cota:** ao fim de cada fase, rode `/usage` e anote quanto da janela de 5 horas foi usado.

## Onde anotar

Anote, fora deste repositório (o resultado de uma rodada é registro de trabalho, não parte do plugin):

- **Tempo por fase:** hora de início e fim de cada linha da tabela.
- **Uso da cota (assinatura):** turnos da conversa e quanto da janela de 5 horas foi consumido ao fim de cada fase (veja `/usage`). Nada de valores em dinheiro.
- **Estimativa do motor:** ao final, rode `baco cost summary ENT-001` (via `node <plugin>/skills/baco-sdd/scripts/baco.mjs cost summary ENT-001`) e cole a saída. É a estimativa do próprio motor, não a medição real.
- **Surpresas e atritos**, uma linha cada, com a fase e o quanto atrapalhou (1 = detalhe, 3 = travou).
- **Correções sugeridas**, para virarem mudanças do plugin.

## Ao terminar

`claude plugin enable baco@baco-sdd` para religar o plugin do marketplace.
