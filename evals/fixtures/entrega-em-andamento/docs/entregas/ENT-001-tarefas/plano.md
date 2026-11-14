# Plano | ENT-001 `Tarefas`

**Specs:** docs/specs/spec-tarefas.md@1.0

**Base:** __BASE_SHA__

**Entrega:** ENT-001 | `Tarefas`

**Nível:** leve

## Restrições globais

- não alterar a spec durante a entrega

## Foco de revisão

- validação do título da tarefa

## Entregas e tarefas

| Tarefa | CAs | Interfaces (consome/produz) | Arquivos prováveis | Classe (mecânica/padrão/arriscada) | Modelo/esforço | Faixa | Depende de |
|---|---|---|---|---|---|---|---|
| `T-001` | `CA-TAR-002` | `produz: cadastrar` | `src/tarefas.mjs` | `padrão` | `sonnet/medium` | `A` | nenhuma |
| `T-002` | `CA-TAR-003` | `consome: cadastrar` | `src/tarefas.mjs` | `padrão` | `sonnet/medium` | `A` | `T-001` |

## Faixas paralelas

| Faixa | Tarefas | Pode rodar ao mesmo tempo que |
|---|---|---|
| `A` | `T-001`, `T-002` | nenhuma |

## Varredura de conflitos

nenhum conflito encontrado

## Cobertura

| Critério de aceite | Tarefa | Cenário de QA |
|---|---|---|
| `CA-TAR-002` | `T-001` | `CT-TAR-002` |
| `CA-TAR-003` | `T-002` | `CT-TAR-003` |

## Reconciliação

ainda não executado
