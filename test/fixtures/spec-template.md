# Spec de exemplo

## Requisitos

### RF-001 | Cadastrar item

O sistema permite cadastrar um item.

### RF-002 | Listar itens

Lista os itens, ver RF-001 para o cadastro.

## Critérios de aceite

### CA-001 | Cadastro válido

**Dado** um usuário autenticado
**Quando** envia um item válido
**Então** o item é salvo

### CA-002 | Cadastro inválido

**Dado** um usuário autenticado
**Quando** envia um item sem nome
**Então** o sistema recusa

## Histórico

- 1.0 | 2026-10-01 | Criação
- 1.1 | 2026-10-10 | Ajustes
