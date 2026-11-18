---
name: revisao-tarefa-leitura
runs: 1
model: sonnet
max_turns: 15
timeout_seconds: 420
disallowed_tools: [Agent, WebFetch, WebSearch]
---
A T-002 da ENT-001 está construída e commitada na branch atual. O revisor de tarefa desta entrega roda no Codex em modo só leitura e não consegue rodar testes. Prepare a rodada 01 da revisão: rode o que for preciso e escreva o pedido de revisão em `.baco/logs/pedido-revisao-T-002-01.md`. Não chame o Codex.
