# ADR-NNN | `<decisão em uma frase>`

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar o ADR real)
- ADR é o registro de uma decisão importante: o que se escolheu, o que ficou de fora e por quê.
- Copie para `docs/arquitetura/adr/ADR-NNN-<nome>.md`, com número em sequência, e troque tudo que está entre `<` e `>`.
- Escreva em linguagem de negócio. Fale de prazo, risco e dinheiro, não só de tecnologia.
- Uma decisão aceita não se apaga. Se mudar, crie um novo ADR e marque este como "Substituída".
- Não invente custo. Se ainda não há número, escreva "a estimar" e diga quem vai estimar.
-->

| Campo | Valor |
|---|---|
| Status | `<Proposta, Aceita ou Substituída>` |
| Data | `<AAAA-MM-DD>` |
| Aprovada por | `<nome da pessoa; vazio enquanto for proposta>` |

## Contexto

`<qual problema ou necessidade levou a esta decisão>`

## Decisão

`<o que foi escolhido, em uma ou duas frases>`

## Alternativas

- **`<alternativa A>`:** `<por que ficou de fora>`
- **`<alternativa B>`:** `<por que ficou de fora>`

## Por quê

`<os motivos da escolha, em linguagem de negócio: prazo, risco, equipe, custo>`

## Critério que decidiu

`<qual critério, e com que peso, decidiu esta escolha>`

## Custo de reverter

`<quanto trabalho e quanto risco para voltar atrás depois, e o que fica mais difícil depois desta decisão; diga se é fácil, médio ou difícil e por quê>`

## Custo mensal estimado

`<quanto isto custa por mês, em reais, e do que depende; ou "a estimar">`

## Injeção de instruções

<!-- Opcional: só quando a decisão faz o sistema mandar texto para um modelo de IA. Sem IA, apague esta seção. Nenhuma medida elimina o risco: conte que algum ataque passa e limite o estrago. Filtro ou classificador de ataque é camada extra, nunca a fronteira. -->

- **De onde vem cada texto e quanto se confia nele:** `<o próprio sistema, a pessoa logada, outro usuário, terceiros (planilha, e-mail, integração)>`
- **O que a resposta pode fazer:** `<só sugerir para uma pessoa, ou gravar e agir>`
- **Instrução separada de dado:** `<texto de fora nunca entra nas instruções do sistema; vai só na mensagem do usuário ou no resultado de ferramenta, marcado com a origem, e texto de terceiros vai codificado em JSON>`
- **Formato fixo da resposta:** `<esquema ou lista fechada de valores, conferido pelo código antes do uso; resposta fora dele é recusada; a resposta é tratada como não confiável antes de chegar ao banco, ao HTML, ao SQL, a um comando ou a outra chamada>`
- **Menor privilégio:** `<que segredos, ferramentas e dados a chamada recebe, e por quê; a chamada que lê texto de fora fica sem ferramenta de escrita quando possível; a permissão é conferida no código, fora do modelo>`
- **Ação que pede confirmação:** `<quais ações mostram à pessoa a ação exata, o alvo e os argumentos e esperam o sim>`
- **Registro:** `<o que se guarda do que foi enviado e recebido, sem credenciais nem dado pessoal desnecessário>`
- **Testes de ataque:** `<os cenários de ataque da spec que viram teste automático>`
