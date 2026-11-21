# <TASK-ID> | <título>

<!--
COMO USAR ESTE MODELO (apague este bloco ao criar a tarefa real)
- Copie para `docs/entregas/ENT-NNN-<nome>/tarefas/T-NNN.md` e troque tudo que está entre `<` e `>`.
- A tarefa precisa ser pequena o bastante para uma pessoa ou um agente terminar e conferir de uma vez.
- Critério de pronto é algo que dá para conferir rodando um comando ou olhando uma tela. "Ficou bom" não serve.
- Branch: use sempre `baco/ENT-NNN-<TASK-ID>`, sem mexer em branch protegida.
- Parada humana: escreva `sim` só quando uma pessoa precisa olhar o resultado desta tarefa antes de a próxima começar (por exemplo, mexe em dados, login ou dinheiro). Com `sim`, escreva também o motivo. Na dúvida, `não`.
-->

| Campo | Valor |
|---|---|
| Entrega | `ENT-NNN` |
| CAs | `<critérios de aceite que esta tarefa cumpre, como CA-XYZ-001>` |
| Classe | `<mecânica, padrão ou arriscada>` |
| Nível/esforço | `<ex.: medio/medio>` |
| Harness e modelo | `<copiado da linha do plano, com as reservas, ex.: claude-code: sonnet, medium>` |
| Parte | `<só com back-end e front-end separados: contrato, back-end ou front-end; senão, apague a linha>` |
| Faixa | `<faixa paralela da linha do plano, como A>` |
| Arquivos prováveis | `<arquivos que a tarefa deve tocar, copiados da linha do plano>` |
| Branch | `baco/ENT-NNN-<TASK-ID>` |
| Dependências | `<tarefas que precisam estar prontas antes, ou "nenhuma">` |
| Parada humana | `<não, ou sim com o motivo em uma frase>` |

## Resultado esperado

`<o que existe ou funciona depois desta tarefa, em linguagem simples>`

## Critério de pronto

- `<como conferir, por exemplo: o teste [CT-XYZ-001] passa>`
- `<outra conferência, se houver>`

## Testes da tarefa

Os testes que rodam durante a construção desta tarefa (versão rápida, só no Chromium).

- `<os testes que esta tarefa cria, com o caminho>`
- `<testes que já existem nos arquivos que ela mexe, com o caminho>`

## Interfaces

- **Consome:** `<o que vem de outras tarefas ou do código existente>`
- **Produz:** `<o que esta tarefa deixa para as próximas>`
