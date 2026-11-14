# ADR-001 | Servidor em Node.js com dados em SQLite

| Campo | Valor |
|---|---|
| Status | Aceita |
| Data | 2026-10-02 |
| Aprovada por | Ana Souza |

## Contexto

A spec `TAR` pede cadastro e listagem de tarefas por pessoas que organizam o próprio trabalho (`RF-TAR-001`, `RF-TAR-002`). A escala inicial é pequena e a equipe é de uma pessoa.

## Decisão

Servidor em Node.js, com as tarefas guardadas em SQLite (um arquivo no próprio servidor).

## Alternativas

- **Banco de dados em servidor separado:** custa mais por mês e exige mais cuidado, sem necessidade na escala inicial.
- **Guardar em arquivo de texto:** mais frágil quando duas pessoas usam ao mesmo tempo.

## Por quê

Poucas peças, custo baixo e prazo curto. A equipe já conhece Node.js.

## Critério que decidiu

Custo mensal baixo (peso alto).

## Custo de reverter

Médio: trocar o SQLite por outro banco exige migrar os dados, mas o acesso fica concentrado em um só lugar do código.

## Custo mensal estimado

Até R$ 100 por mês, dependendo da hospedagem escolhida; a estimar na primeira entrega.
