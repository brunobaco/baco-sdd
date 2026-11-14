---
description: Monta o plano de uma entrega a partir das specs aprovadas.
argument-hint: "[o que você quer entregar]"
disable-model-invocation: true
---

Use the BACO-SDD skill: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/SKILL.md` first; its startup checks, core rules and gates apply.

Go to phase 4: read `${CLAUDE_PLUGIN_ROOT}/skills/baco-sdd/references/planning.md` and follow it. Check its inputs first; if one is missing, say so in plain words and offer the phase that produces it.

The user's request: $ARGUMENTS

If the request is empty, ask in one plain question what they want to do.
