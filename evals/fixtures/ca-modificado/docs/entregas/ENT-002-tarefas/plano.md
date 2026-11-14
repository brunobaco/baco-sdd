# Plano | ENT-002 `Ajuste da soma`

**Specs:** docs/specs/spec-tarefas.md@1.1

**Base:** __BASE_SHA__

**Entrega:** ENT-002 | `Ajuste da soma`

**Nível:** leve

## Restrições globais

- a spec 1.1 já está aprovada e é a base desta entrega

## Foco de revisão

- o novo valor de CA-TAR-001 no teste e no código

## Entregas e tarefas

| Tarefa | CAs | Interfaces (consome/produz) | Arquivos prováveis | Classe (mecânica/padrão/arriscada) | Modelo/esforço | Faixa | Depende de |
|---|---|---|---|---|---|---|---|
| `T-001` | `CA-TAR-001` | `produz: soma` | `src/soma.mjs`, `test/soma.test.mjs` | `mecânica` | `sonnet/low` | `A` | nenhuma |

## Faixas paralelas

| Faixa | Tarefas | Pode rodar ao mesmo tempo que |
|---|---|---|
| `A` | `T-001` | nenhuma |

## Varredura de conflitos

nenhum conflito encontrado

## Cobertura

| Critério de aceite | Tarefa | Cenário de QA |
|---|---|---|
| `CA-TAR-001` | `T-001` | `CT-TAR-001` |

## Reconciliação

ainda não executado
