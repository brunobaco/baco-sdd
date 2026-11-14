---
description: Mostra onde o projeto está: specs, entregas em andamento e o próximo passo.
argument-hint: "[spec ou entrega específica, opcional]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Report status only; write nothing and start no phase.
- Read `docs/catalogo-de-specs.md` (or the project's catalog). For one spec the user names, `baco catalog get <CODE>` gives its row.
- For each folder in `docs/entregas/`, read its `progresso.md`: the situation in `## Retomada` (running, stopped and why, finished), the open items of `## Esperando a pessoa` and `## Pendências`, and the last recorded decision.
- For a delivery whose `## Retomada` says it is running, run `baco queue-status` and say in plain words who is using the machine's test queue (browser tests, one at a time) and who is waiting, so a slow run is explained.
- Answer in the project's language (default pt-BR), plain words: a short table of specs (situação, implementação, validação), deliveries in progress, and the next step, chosen with the "When" column of the phase router in `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md`.
- With no catalog or config, say so and offer `/baco:iniciar` or `/baco:configurar`.

The user's request: $ARGUMENTS

If the request is empty, report the whole project; do not ask first.
