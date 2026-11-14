---
description: Gera o relatório de aceite e conduz o pedido de junção até a aprovação.
argument-hint: "[número da entrega, ex.: ENT-001]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 8: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/delivery.md` and follow it. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
