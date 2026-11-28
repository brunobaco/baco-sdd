# Plano | ENT-NNN `<nome da entrega>`

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar o plano real)
- Copie para `docs/entregas/ENT-NNN-<nome>/plano.md` e troque tudo que está entre `<` e `>`.
- Specs: informe o caminho da spec e a versão exata, no formato `docs/specs/spec-<nome>.md@<versão>`. Com mais de uma spec, separe por vírgula.
- Base: precisa ser o código (sha) de um commit real, por exemplo `a1b2c3d`. Nome de branch não vale, porque a branch se move. Use o commit atual da branch de integração (a branch onde as entregas se juntam) e descubra o sha com `git rev-parse <branch de integração>`.
- Início: a hora em que o planejamento desta entrega começou, tirada do comando `date`. É daí que o motor mede nas conversas o custo real da entrega (`baco cost measure`).
- O plano só vale depois que uma pessoa aprova. Recomendação da IA não conta como aprovação.
- Classe da tarefa: mecânica (troca simples, sem decisão), padrão (trabalho comum) ou arriscada (mexe em dados, login, dinheiro ou algo difícil de desfazer). A classe define o nível e o esforço.
- Por que esta classe: uma linha por tarefa, nos detalhes dela, dizendo qual critério decidiu a classe (o de `planning.risk` da configuração, quando existe, ou o critério geral). Quem aprova pode contestar a classe aqui.
- Foco de revisão: copie `review.focus` da configuração nas duas listas (sempre olhar e sugestão) e acrescente o que é próprio desta entrega.
- Harness e modelo: a ferramenta de IA (por exemplo Claude Code, Codex) e o modelo real que roda cada tarefa e cada papel, tirados de `harnesses` em `.baco/config.yaml`, seguidos das reservas em ordem quando a configuração tem `roles` (a reserva assume só se a cota da anterior acabar). Ficam decididos aqui e são aprovados com o plano; na construção ninguém troca fora dessa lista. Uma ferramenta que não é a do agente principal só faz papéis que leem e revisam, a não ser que a configuração diga `implementers: on` para ela.
- Divisão das tarefas: por funcionalidade (cada tarefa leva servidor e tela juntos) ou back-end e front-end separados (`planning.task_split: front-back`), com a parte de cada tarefa (contrato, back-end ou front-end) nos detalhes dela. Quem aprova o plano pode trocar a divisão, as listas de cada papel e qualquer modelo só para esta entrega; o plano diz o que difere da configuração e por quê.
- Parada humana: uma tarefa que exige que uma pessoa olhe o resultado antes de seguir leva `Parada humana: sim` (com o motivo) no arquivo dela. O padrão é `não`. Quem aprova o plano aprova também essas paradas.
- Nível da entrega: leve (pequena, fácil de desfazer, sem dinheiro nem dados pessoais, sem tecnologia nova, uma spec só, nenhuma tarefa arriscada), normal (o caminho de sempre) ou completo (basta um sinal de risco: várias specs, difícil de desfazer, dinheiro, dados pessoais, tecnologia nova, trabalho longo ou migração que apaga dados). Na dúvida, escolha o nível acima.
- Uma spec por entrega é o padrão; juntar duas exige um motivo escrito.
- Duas tarefas só andam em paralelo se não mexem nos mesmos arquivos e uma não depende da outra.
-->

**Specs:** docs/specs/spec-<nome>.md@<versão>

**Base:** <sha do commit>

**Início:** <AAAA-MM-DD HH:MM>

**Entrega:** ENT-NNN | `<nome da entrega>`

**Nível:** <leve, normal ou completo>

**Divisão das tarefas:** <por funcionalidade (cada tarefa leva servidor e tela juntos), ou back-end e front-end separados: primeiro o contrato da API, depois back-end (<ferramenta e modelo>) e front-end (<ferramenta e modelo>) em paralelo; e de onde veio: da configuração, ou escolhida para esta entrega>

**Revisão externa:** <revisão do PR (recomendado), por agente, pessoa ou ambos, como em `review.pr.reviewer`, com o harness, o modelo e o esforço do revisor agente e se as correções são automáticas; ou modo repositório, quando o isolamento da pasta da entrega precisa ser garantido, ou pacote, quando a pessoa pedir; ou dispensada com o motivo>

## Restrições globais

- `<regra que vale para todas as tarefas, por exemplo: não alterar o banco sem aprovação>`
- `<outra restrição, se houver>`

## Foco de revisão

**Sempre olhar** (de `review.focus.always`):

- `<item da configuração, por exemplo: login, permissão, dado de outro cliente; apague a lista se estiver vazia>`

**Sugestão** (de `review.focus.suggestion`; um achado desta classe é só sugestão, a menos que toque um item de "sempre olhar"):

- `<item da configuração, por exemplo: virada da meia-noite; apague a lista se estiver vazia>`

**Desta entrega:**

- `<o que a revisão deve olhar com mais cuidado só nesta entrega, por exemplo: valores em dinheiro>`

## Entregas e tarefas

| Tarefa | CAs | Interfaces (consome/produz) | Arquivos prováveis | Classe (mecânica/padrão/arriscada) | Nível/esforço | Harness e modelo | Faixa | Depende de |
|---|---|---|---|---|---|---|---|---|
| `T-001` | `CA-XYZ-001` | `produz: <função ou tela>` | `<caminhos>` | `padrão` | `medio/medio` | `<harness>: <modelo>, <esforço real>` | `A` | nenhuma |
| `T-002` | `CA-XYZ-002` | `consome: <o que T-001 produz>` | `<caminhos>` | `padrão` | `medio/medio` | `<harness>: <modelo>, <esforço real>` | `A` | `T-001` |

## Detalhes das tarefas

Uma subseção por tarefa, com o que o publicador copia para o arquivo dela (ele não inventa nada que não esteja aqui).

### `T-001`

- **Parte:** `<só com back-end e front-end separados: contrato, back-end ou front-end; senão, apague a linha>`
- **Por que esta classe:** `<uma linha: o critério que decidiu mecânica, padrão ou arriscada, por exemplo "arriscada: mexe em login (planning.risk)">`
- **Resultado esperado:** `<o que existe ou funciona depois desta tarefa, em linguagem simples>`
- **Critério de pronto:** `<como conferir, por exemplo: o teste [CT-XYZ-001] passa>`
- **Testes da tarefa:** `<os testes que ela cria, com o caminho, e os que já existem nos arquivos que ela mexe>`
- **Issue de origem:** `<só quando a tarefa veio de uma issue do GitHub: o link dela, uma linha por issue; senão, apague a linha>`

Tarefa com parada humana leva a palavra `PARADA` ao lado do código na coluna `Tarefa` (por exemplo `T-003 PARADA`), e o campo `Parada humana` do arquivo dela diz `sim` com o motivo. Os dois precisam combinar.

## Agentes desta entrega

| Papel | O que faz | Nível | Harness | Modelo e esforço | Máximo de revisões |
|---|---|---|---|---|---|
| `<ex.: implementador padrão>` | `<o que faz>` | `<leve, medio ou forte>` | `<ferramenta de IA, de harnesses; com roles, também as reservas em ordem: "reserva: <ferramenta>">` | `<modelo e esforço reais, de cada uma>` | `<revisões por tarefa, contando a primeira: de review.task_rounds (mecânica 2, padrão 3, arriscada 4) ou outro com o motivo; só a correção antes da última revisão usa um nível acima>` |
| `<revisor do PR>` | `revisa o PR da entrega, só leitura, sem ver docs/entregas/` | `forte` | `<de preferência outro que não o de quem construiu>` | `<modelo e esforço reais>` | `<review.external_rounds_max>` |
| `<localizador, se for usado>` | `acha onde está a informação e devolve o trecho literal` | `leve` | `<ferramenta>` | `<modelo e esforço reais>` | `não se aplica` |

**Condutor:** `<a ferramenta e o modelo da conversa principal; se a conta dela acabar, quem continua: na Ratoeira, a próxima conta da fila de contas (e, se for um agente sem o plugin do BACO, como Codex, Grok ou OpenCode, que o BACO segue sem os agentes e os ganchos do plugin); fora dela, a entrega para até a cota voltar>`

**Estimativa de uso da cota:** `<em três partes, tiradas de baco cost history: o condutor por tarefa, os construtores por revisão e os revisores por revisão, com as revisões esperadas por tarefa; ou "sem histórico">`

**Estimativa de minutos de CI:** `<minutos de uma rodada rápida e de uma completa (de gh run list das entregas anteriores) vezes os envios e junções esperados, comparados com ci.monthly_minutes e com o que já foi usado no mês, se a pessoa souber; ou "sem histórico">`

## Faixas paralelas

| Faixa | Tarefas | Pode rodar ao mesmo tempo que |
|---|---|---|
| `A` | `T-001`, `T-002` | `<outras faixas, ou "nenhuma">` |

## Varredura de conflitos

`<liste os arquivos que mais de uma tarefa pode tocar e diga como o conflito foi evitado; se não houver, escreva "nenhum conflito encontrado">`

## Cobertura

| Critério de aceite | Tarefa | Cenário de QA | Camada do teste |
|---|---|---|---|
| `CA-XYZ-001` | `T-001` | `CT-XYZ-001` | `regra` |
| `CA-XYZ-002` | `T-002` | `CT-XYZ-002` | `navegador` |

A camada é `regra` (teste de unidade, por dentro) ou `navegador`; navegador só para os caminhos principais. Todo critério de aceite das specs deste plano precisa aparecer aqui. Critério de função ainda não construída leva `fora desta entrega` na coluna `Tarefa` (ou no cabeçalho `**Fora desta entrega:** CA-...`) para que o aceite o liste à parte, sem contar como teste manual pendente.

## Se der errado

Obrigatória quando o nível é completo ou há tarefa arriscada; nos outros casos, apague a seção.

- **Como voltar atrás:** `<passos para desfazer a entrega, quanto tempo leva e o que se perde>`
- **Como vamos saber que quebrou:** `<o sinal ou alarme que avisa, e quem recebe o aviso>`

## Reconciliação

`<ao fim da entrega, compare o que foi planejado com o que foi feito: tarefas que mudaram, cortes, sobras e por quê; antes disso, escreva "ainda não executado">`
