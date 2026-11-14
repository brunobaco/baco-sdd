# Spec | Empresas

## 1. Controle documental e fontes

| Campo | Valor |
|---|---|
| Código | `EMP` |
| Versão | `1.2` |
| Situação | `Aprovada` |

## 5. Requisitos e regras

- **RF-EMP-001 | Criar Empresa:** permitir que pessoa autenticada crie uma Empresa.
  Continuação indentada do requisito.
- **RF-EMP-002 | Vincular proprietário:** conforme RF-EMP-001, o criador vira proprietário.
- **RF-EMP-003 | Resultado da criação:** informar o resultado, observando RN-EMP-001/002.
- **RN-EMP-001 | Isolamento:** a Empresa não compartilha dados com outro tenant.
- **RN-EMP-002 | Posição única:** uma identidade possui no máximo um vínculo vigente.
- **RNF-EMP-001 | Integridade:** criação atômica sob concorrência.

## 10. Critérios de aceite

| ID | Dado | Quando | Então |
|---|---|---|---|
| **CA-EMP-001** | Identidade livre e dados válidos | Confirma a criação | Empresa criada atomicamente |
| **CA-EMP-002** | Identidade com vínculo `Ativo` | Tenta criar | Criação recusada |
| **CA-EMP-003** | Falha ao gravar o vínculo | Confirma a criação | Nada é persistido |

## 12. QA e rastreabilidade

| Itens | CT |
|---|---|
| RF-EMP-001/002, RN-EMP-001 | CT-EMP-001–003 |

## 13. Aprovação e histórico

| Versão | Responsável | Data | Alteração |
|---|---|---|---|
| 1.0 | Ana Souza | 2026-10-01 | Criação |
| 1.1 | Ana Souza | 2026-10-10 | Ajuste de regras |
| 1.2 | Ana Souza | 2026-10-20 | Aprovação |
