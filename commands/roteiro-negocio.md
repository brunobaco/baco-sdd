---
description: Prepara o roteiro de teste para uma pessoa de negócio e registra as respostas dela.
argument-hint: "[número da entrega, ex.: ENT-001]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to the business test script: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/delivery.md` and follow section 4b. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question which delivery the script is for.
