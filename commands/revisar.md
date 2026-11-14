---
description: Revisa a entrega inteira e conduz a revisão do PR por outra IA, por uma pessoa ou pelas duas, ou registra a dispensa dela.
argument-hint: "[número da entrega, ex.: ENT-001]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 7: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/review.md` and follow it. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
