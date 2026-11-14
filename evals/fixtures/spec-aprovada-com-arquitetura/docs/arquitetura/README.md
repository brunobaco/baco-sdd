# Arquitetura | Tarefas

## Visão geral

Um sistema web simples para cadastrar e listar tarefas pessoais. A pessoa usa o navegador; o servidor guarda as tarefas e as devolve em ordem de criação.

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Interface (o que a pessoa vê) | Página web simples em HTML, sem biblioteca extra | Poucas peças, custo baixo e fácil de manter |
| Servidor (as regras de negócio) | Node.js | A equipe já conhece; roda em qualquer hospedagem barata |
| Dados (onde as informações ficam) | SQLite (arquivo local) | A escala inicial é pequena; não exige servidor de banco |
| Hospedagem | Servidor virtual pequeno | Custo mensal baixo e previsível |

## Ferramentas de teste por plataforma

| Plataforma | Ferramenta | O que ela confere | Comando |
|---|---|---|---|
| Regras e funções | Executor de testes do Node (`node --test`) | cada regra isolada | `node --test` |

Os comandos que geram relatório JUnit (o arquivo com o resultado dos testes) são os mesmos configurados em `.baco/config.yaml`.

## Ambientes

| Ambiente | Para que serve | Endereço | Quem pode mexer |
|---|---|---|---|
| Local | desenvolvimento do dia a dia | na máquina de quem desenvolve | quem desenvolve |
| Homologação | testes antes de publicar | a definir na primeira entrega | quem desenvolve |
| Produção | uso real | a definir | mudanças aqui exigem aprovação humana |

## Aprovação

Aprovada por Ana Souza em 2026-10-02.

## Lista de ADRs

| ADR | Decisão | Status |
|---|---|---|
| `ADR-001` | Servidor em Node.js com dados em SQLite | Aceita |
