# Progresso | ENT-NNN `<nome da entrega>`

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar o registro real)
- Copie para `docs/entregas/ENT-NNN-<nome>/progresso.md`. Cada tarefa que termina ganha uma linha nova no fim da tabela.
- Toda data e hora vem do relógio do computador (comando `date`), nunca de estimativa, no fuso da pessoa e com o deslocamento (por exemplo `TZ=America/Sao_Paulo date -Iminutes`), mesmo que o servidor esteja em UTC.
- Retomada: o estado da execução. É atualizada a cada tarefa que termina, a cada etapa longa (início e fim de uma bateria de testes, espera na fila) e a cada parada, e uma conversa nova continua daqui. Quem começa ou retoma escreve primeiro `rodando`, a hora e a linha "Dono da execução". Uma conversa nova só assume sem perguntar se a situação é `parado por cota`, `parado para conversa nova`, ou `rodando` sem atualização há mais de 6 horas. Situação: `rodando`, `parado por cota`, `parado para conversa nova`, `parado por pergunta`, `parado por bloqueio`, `parado a pedido` ou `fim`. Trocas de conversa: cada vez que a execução continuou numa conversa nova por causa do tamanho da conversa.
- Estado: FEITO (tudo certo), FEITO_COM_RESSALVAS (feito, mas com um aviso na nota), PRECISA_CONTEXTO (faltou informação, uma pessoa precisa responder) ou BLOQUEADO (não dá para seguir).
- Commits: os códigos curtos (sha) dos commits da tarefa.
- Não registre estado que não aconteceu. Linha só entra depois que a tarefa terminou.
- Esperando a pessoa: tudo o que a execução deixou para a pessoa ver no fim (tarefa para conferir, decisão tomada pelo agente, pergunta, achado de revisão contestado, ação sem volta, junção na principal). Situação: `esperando` ou `resolvido`.
- Pendências: o que ficou em aberto na entrega (uma decisão adiada, um limite conhecido, um bloqueio do ambiente, algo para outra entrega). Situação: `aberta` ou `resolvida`. O relatório de aceite lista como risco toda pendência que não está `resolvida`.
- Decisões tomadas pelo agente que a pessoa precisa confirmar levam no fim a marca "decidido pelo agente, conferir no fim".
- Issue mãe: só com as tarefas também no GitHub. A publicação grava aqui o endereço da issue da entrega, e o motor (`baco board`) lê desta linha.
-->

- **Issue mãe:** `<endereço da issue da entrega no GitHub, ou apague a linha se as tarefas ficam só em arquivos>`

## Retomada

- **Atualizado em:** `<AAAA-MM-DD HH:MM>`
- **Situação:** `<rodando, parado por cota, parado para conversa nova, parado por pergunta, parado por bloqueio, parado a pedido ou fim>`
- **Execução autônoma:** `<sim ou não>`
- **Conversa condutora:** `<endereço ou link da conversa que conduz a entrega, ou "não informado">`
- **Onde está:** `<fase 6 ou 7; tarefas prontas, em andamento e esperando>`
- **Rodando agora:** `<tarefas ou agentes em andamento, ou "nada">`
- **Próximo passo:** `<o que a próxima conversa faz primeiro>`
- **Preparação:** `<regras de execução conferidas, aviso dos plugins dado, agentes e cota mostrados: sim ou não>`
- **Dono da execução:** `<hora em que a conversa que conduz a execução começou, AAAA-MM-DD HH:MM; quem começa ou retoma troca esta linha antes de tudo>`
- **Trocas de conversa:** `<AAAA-MM-DD HH:MM, conversa anterior <identificador>, conversa nova "<título>"; uma linha por troca, ou "nenhuma">`

### Tarefas em andamento

Uma linha por tarefa começada e ainda não juntada na entrega. Atualizada junto com o resto da Retomada. Na retomada, o git é conferido e vence quando discorda desta tabela.

| Tarefa | Ramo | Pasta de trabalho | Relatório | Último commit | Etapa | Revisões |
|---|---|---|---|---|---|---|
| `<T-002>` | `<baco/ENT-NNN-T-002>` | `<caminho da pasta da tarefa>` | `<docs/entregas/ENT-NNN-<nome>/relatorios/T-002.md>` | `<sha curto>` | `<construção, revisão, correção ou esperando a pessoa>` | `<revisão N de M, com M da tabela de agentes do plano>` |

## Registro das tarefas

| Data/hora | Tarefa | Estado (FEITO, FEITO_COM_RESSALVAS, PRECISA_CONTEXTO ou BLOQUEADO) | Commits | Nota |
|---|---|---|---|---|
| `<AAAA-MM-DD HH:MM>` | `T-001` | `FEITO` | `<sha>` | `<o que mais vale saber>` |

## Esperando a pessoa

| Item | Tipo | O que a pessoa precisa decidir ou fazer | Desde | Situação |
|---|---|---|---|---|

## Pendências

| ID | Pendência | Impacto | Responsável | Destino | Situação |
|---|---|---|---|---|---|

## Instruções da pessoa

Instruções, respostas ou ajustes ditos pela pessoa durante a entrega. Gravadas aqui assim que aparecem, para toda conversa nova ler daqui sem repasse entre conversas.

- `<AAAA-MM-DD HH:MM | instrução ou decisão da pessoa>`

## Decisões registradas

- `<AAAA-MM-DD> | <decisão tomada durante a entrega, quem decidiu e por quê>`
