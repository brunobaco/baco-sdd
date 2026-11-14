# Cenários de QA | Tarefas

## Metadados

| Campo | Valor |
|---|---|
| Código | `TAR` |
| Arquivo | `docs/qa/cenarios-qa-spec-tarefas.md` |
| Spec de origem | `docs/specs/spec-tarefas.md` |
| Versão da spec | `1.1` |
| Responsável | Ana Souza |

**Objetivo:** verificar o cadastro e a listagem de tarefas.

## Matriz de cobertura

| Contrato | CA | CT | Estratégia | Cobertura | Lacuna ou justificativa |
|---|---|---|---|---|---|
| `RF-TAR-001` | `CA-TAR-001` | `CT-TAR-001` | manual | total | nenhuma |
| `RF-TAR-001` | `CA-TAR-002` | `CT-TAR-002` | manual | total | nenhuma |
| `RF-TAR-001` | `CA-TAR-003` | `CT-TAR-003` | manual | total | nenhuma |

## Cenários

### CT-TAR-001 | Soma de duas parcelas

- **Tipo:** positivo
- **Contratos:** RF-TAR-001, CA-TAR-001
- **Automação:** manual
- **Dado:** duas parcelas numéricas.
- **Quando:** a pessoa pede a soma.
- **Então:** o resultado aparece correto.

### CT-TAR-002 | Cadastro válido

- **Tipo:** positivo
- **Contratos:** RF-TAR-001, CA-TAR-002
- **Automação:** manual
- **Dado:** uma tarefa com título válido.
- **Quando:** a pessoa a cadastra.
- **Então:** a tarefa aparece na lista.

### CT-TAR-003 | Cadastro sem título

- **Tipo:** negativo
- **Contratos:** RF-TAR-001, CA-TAR-003
- **Automação:** manual
- **Dado:** uma tarefa sem título.
- **Quando:** a pessoa tenta cadastrá-la.
- **Então:** o sistema recusa e explica o motivo.

## Evidências de execução

| CT | Resultado | Data | Onde | Entrega |
|---|---|---|---|---|
