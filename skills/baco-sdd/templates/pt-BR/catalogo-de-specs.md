# Catálogo de specs

Este documento é o índice oficial das specs do produto e a única fonte do estado atual de implementação e de validação de cada contrato.

As specs registram comportamento, aprovação e histórico. Os cenários de QA registram a cobertura de testes e, quando executados, as evidências. Quando o código muda, só este catálogo e as evidências de QA são atualizados. A spec não precisa mudar.

## Estados permitidos

### Situação documental

- `Rascunho`
- `Em descoberta`
- `Em revisão`
- `Aprovada`
- `Substituída`

### Estado da implementação

- `não verificada`
- `não iniciada`
- `em implementação`
- `implementada`

### Estado da validação

- `não verificada`
- `pendente`
- `parcialmente validada`
- `validada sem revisão externa`
- `validada`
- `não conforme`

Implementada não quer dizer validada. Situação documental, implementação e validação são independentes entre si.

As colunas `Versão implementada` e `Versão validada` dizem qual versão da spec está de fato no código e qual foi de fato testada. O formato é `2.1 @ abc1234 (ENT-003)`: versão, commit e entrega. Se estiver vazia, o valor é o sinal de vazio que o motor grava (um traço longo).

## Specs vigentes

Apague a linha de exemplo ao registrar a primeira spec.

| Código | Spec | Versão | Situação documental | Implementação | Validação | Versão implementada | Versão validada | Aprovação | Resumo |
|---|---|---:|---|---|---|---|---|---|---|
| `<COD>` | `specs/spec-<nome>.md` | `<1.0>` | `Rascunho` | `não verificada` | `não verificada` | — | — | `<nome de quem aprovou, data>` | `<uma frase com o que a spec garante>` |

## Specs substituídas

Specs que deixaram de valer ficam aqui, com o código da spec que as substituiu.

| Código | Spec | Substituída por | Data |
|---|---|---|---|
