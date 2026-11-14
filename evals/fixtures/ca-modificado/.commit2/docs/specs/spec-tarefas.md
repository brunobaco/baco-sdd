# Spec | Tarefas

## Porta de entrada

- **O quê:** cadastro e consulta de tarefas.
- **Para quem:** pessoas que organizam o próprio trabalho.
- **Por quê:** hoje as tarefas ficam em papel e se perdem.
- **Fica de fora:** prazos, lembretes e compartilhamento.
- **Como saber se deu certo:** a definir.

## Controle documental

| Campo | Valor |
|---|---|
| Código da spec | `TAR` |
| Arquivo | `docs/specs/spec-tarefas.md` |
| Título | Tarefas |
| Versão | `1.1` |
| Situação do documento | `Aprovada` |
| Responsável | Ana Souza |
| QA correspondente | `docs/qa/cenarios-qa-spec-tarefas.md` |

**Fontes consultadas:** nenhuma até agora

## Problema, objetivo e fronteiras

- **Problema, objetivo, atores e escopo:** a pessoa cadastra tarefas e as consulta depois.

## Contrato normativo

- **RF-TAR-001 | Cadastrar tarefa:** a pessoa usuária pode cadastrar uma tarefa com título, produzindo uma tarefa listada.
- **RF-TAR-002 | Listar tarefas:** a pessoa usuária pode listar as tarefas cadastradas, produzindo a lista em ordem de criação.

## Critérios de aceite

| ID | Dado | Quando | Então |
|---|---|---|---|
| **CA-TAR-001** | duas parcelas numéricas e um ajuste fixo de 1 | a soma é pedida | o resultado é 3 |
| **CA-TAR-002** | uma tarefa com título válido | a pessoa a cadastra | a tarefa aparece na lista |
| **CA-TAR-003** | uma tarefa sem título | a pessoa tenta cadastrá-la | o sistema recusa e explica o motivo |


## Aprovação e histórico

| Versão | Responsável | Data | Alteração |
|---|---|---|---|
| 1.0 | Ana Souza | 2026-10-01 | Criação da spec. |
| 1.1 | Ana Souza | 2026-10-10 | CA-TAR-001 modificado: com o ajuste fixo de 1, a soma de 1 e 1 passa a ser 3. |
